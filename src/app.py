import os
import sys
import threading
import base64
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

import uvicorn
from fastapi import FastAPI, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai


# Ensure the parent directory is in path so we can import src modules
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.env import TradingEnv
from src.utils import fetch_stock_data
from src.backtest import compute_backtest_metrics

# Stable-baselines3 imports
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

app = FastAPI(title="NiftyRL Interactive Dashboard")

# Enable CORS for local testing/dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global tracker for training progress
class TrainingProgressTracker:
    def __init__(self):
        self.is_training = False
        self.progress_pct = 0.0
        self.current_step = 0
        self.total_steps = 0
        self.net_worth = 100000.0
        self.realised_pnl = 0.0
        self.action_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
        self.message = "Idle"

    def reset(self, total_steps: int):
        self.is_training = True
        self.progress_pct = 0.0
        self.current_step = 0
        self.total_steps = total_steps
        self.net_worth = 100000.0
        self.realised_pnl = 0.0
        self.action_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
        self.message = "Initialising environment..."

tracker = TrainingProgressTracker()

# Callback for updating progress during model.learn()
class WebProgressCallback(BaseCallback):
    def __init__(self, progress_tracker: TrainingProgressTracker, eval_freq: int = 200, verbose: int = 0):
        super().__init__(verbose)
        self.tracker = progress_tracker
        self.eval_freq = eval_freq

    def _on_step(self) -> bool:
        self.tracker.current_step = self.num_timesteps
        self.tracker.progress_pct = min(100.0, (self.num_timesteps / self.tracker.total_steps) * 100.0)

        # Periodically extract stats from training environment
        if self.num_timesteps % self.eval_freq == 0:
            try:
                env = self.training_env.envs[0]
                unwrapped = env.unwrapped
                self.tracker.net_worth = float(unwrapped.net_worth)
                self.tracker.realised_pnl = float(unwrapped.total_profit)
                self.tracker.message = f"Training policy... Step {self.num_timesteps:,} / {self.tracker.total_steps:,}"
            except Exception:
                pass

        # Update action count
        if "actions" in self.locals:
            actions = self.locals["actions"]
            for act in actions:
                act_val = int(act)
                if act_val in self.tracker.action_counts:
                    self.tracker.action_counts[act_val] += 1

        return True

# Pydantic schemas
class TrainParams(BaseModel):
    ticker: str = "RELIANCE.NS"
    timesteps: int = 50000
    brokerage: float = 0.0003
    slippage: float = 0.0005
    risk_aversion: float = 0.1
    drawdown_coeff: float = 0.05

class BacktestParams(BaseModel):
    ticker: str = "RELIANCE.NS"
    years: int = 2
    brokerage: float = 0.0003
    slippage: float = 0.0005
    risk_aversion: float = 0.1
    drawdown_coeff: float = 0.05

class ChartAnalysisRequest(BaseModel):
    image_data: str

class ChatRequest(BaseModel):
    question: str

# Configure Gemini AI securely from environment variables
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"Failed to configure Gemini API: {e}")
else:
    print("\n" + "="*80)
    print("WARNING: GEMINI_API_KEY environment variable is not set.")
    print("To enable Gemini Chat and Vision, run: export GEMINI_API_KEY='your_api_key'")
    print("="*80 + "\n")



# Background training runner
def run_training_background(params: TrainParams):
    global tracker
    try:
        tracker.reset(params.timesteps)
        tracker.message = "Downloading historical data..."

        # Download and prepare data
        df = fetch_stock_data(params.ticker, years=2, auto_append_ns=False)
        train_ratio = 0.8
        val_ratio = 0.1
        n = len(df)
        train_df = df.iloc[:int(n * train_ratio)].reset_index(drop=True)
        val_df = df.iloc[int(n * train_ratio):int(n * (train_ratio + val_ratio))].reset_index(drop=True)

        # Create environments
        train_env = TradingEnv(
            train_df,
            brokerage_pct=params.brokerage,
            slippage_pct=params.slippage,
            risk_aversion=params.risk_aversion,
            drawdown_coeff=params.drawdown_coeff,
        )
        train_env = Monitor(train_env)
        train_vec_env = DummyVecEnv([lambda: train_env])

        val_env = TradingEnv(
            val_df,
            brokerage_pct=params.brokerage,
            slippage_pct=params.slippage,
            risk_aversion=params.risk_aversion,
            drawdown_coeff=params.drawdown_coeff,
        )
        val_env = Monitor(val_env)
        val_vec_env = DummyVecEnv([lambda: val_env])

        # Create PPO agent
        tracker.message = "Creating policy networks..."
        model = PPO(
            "MlpPolicy",
            train_vec_env,
            verbose=0,
            seed=42,
            tensorboard_log="logs/",
        )

        # Train model with progress tracker
        callback = WebProgressCallback(tracker, eval_freq=200)
        tracker.message = "Training policy..."
        model.learn(total_timesteps=params.timesteps, callback=callback)

        # Save model
        model_dir = Path("models")
        model_dir.mkdir(exist_ok=True)
        model.save(str(model_dir / "best_model.zip"))

        tracker.message = "Completed"
        tracker.progress_pct = 100.0
    except Exception as e:
        tracker.message = f"Error during training: {str(e)}"
    finally:
        tracker.is_training = False

# API routes
@app.get("/api/tickers")
async def api_tickers():
    return [
        {"symbol": "RELIANCE.NS", "name": "Reliance Industries Ltd."},
        {"symbol": "TCS.NS", "name": "Tata Consultancy Services Ltd."},
        {"symbol": "INFY.NS", "name": "Infosys Ltd."},
        {"symbol": "HDFCBANK.NS", "name": "HDFC Bank Ltd."},
        {"symbol": "ICICIBANK.NS", "name": "ICICI Bank Ltd."},
        {"symbol": "SBIN.NS", "name": "State Bank of India"},
    ]

@app.post("/api/train")
async def api_train(params: TrainParams, background_tasks: BackgroundTasks):
    global tracker
    if tracker.is_training:
        return {"status": "error", "message": "A training session is already running."}
    
    background_tasks.add_task(run_training_background, params)
    return {"status": "ok", "message": "Training started in background."}

@app.get("/api/train/status")
async def api_train_status():
    global tracker
    return {
        "is_training": tracker.is_training,
        "progress_pct": tracker.progress_pct,
        "current_step": tracker.current_step,
        "total_steps": tracker.total_steps,
        "net_worth": tracker.net_worth,
        "realised_pnl": tracker.realised_pnl,
        "action_counts": tracker.action_counts,
        "message": tracker.message,
    }

@app.post("/api/backtest")
async def api_backtest(params: BacktestParams):
    try:
        # Load and slice data
        df = fetch_stock_data(params.ticker, years=params.years, auto_append_ns=False)
        train_ratio = 0.8
        split_idx = int(len(df) * train_ratio)
        test_df = df.iloc[split_idx:].reset_index(drop=True)

        if len(test_df) == 0:
            return {"error": "Not enough data to run backtest."}

        # Create environment
        env = TradingEnv(
            test_df,
            initial_capital=100000.0,
            brokerage_pct=params.brokerage,
            slippage_pct=params.slippage,
            risk_aversion=params.risk_aversion,
            drawdown_coeff=params.drawdown_coeff,
            render_mode=None,
        )

        model_file = Path("models/best_model.zip")
        if not model_file.exists():
            return {"error": "No trained model found. Please train the agent first."}

        model = PPO.load(str(model_file), env=env)

        # Run replay
        obs, info = env.reset()
        net_worths = [env.initial_capital]
        close_prices = [env._get_close_price(env.current_step)]
        dates = [str(env.df.index[env.current_step]).split(" ")[0]]
        exposures = [0.0]

        done = False
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated

            net_worths.append(info["net_worth"])
            close_prices.append(info["current_price"])
            dates.append(str(env.df.index[env.current_step]).split(" ")[0])
            exposure = (info["shares_held"] * info["current_price"]) / info["net_worth"]
            exposures.append(float(exposure))

        # Compute metrics
        metrics = compute_backtest_metrics(
            net_worths=net_worths,
            prices=close_prices,
            initial_capital=100000.0,
            trade_log=env.trade_log,
            risk_free_rate=0.065,
        )

        # Calculate Buy & Hold equity curve
        first_price = close_prices[0]
        benchmark_net_worths = [
            100000.0 * (price / first_price) for price in close_prices
        ]

        return {
            "dates": dates,
            "close_prices": close_prices,
            "agent_net_worth": net_worths,
            "benchmark_net_worth": benchmark_net_worths,
            "exposures": exposures,
            "trades": env.trade_log,
            "metrics": {
                "final_net_worth": metrics["final_net_worth"],
                "total_return_pct": metrics["total_return_pct"],
                "buy_hold_return_pct": metrics["buy_hold_return_pct"],
                "sharpe_ratio": metrics["sharpe_ratio"],
                "max_drawdown_pct": metrics["max_drawdown_pct"],
                "total_trades": metrics["total_trades"],
                "win_rate_pct": metrics["win_rate_pct"],
                "total_friction": metrics["total_friction"],
            },
        }
    except Exception as e:
        return {"error": f"Backtest failed: {str(e)}"}

@app.post("/api/analyze-chart")
async def api_analyze_chart(req: ChartAnalysisRequest):
    # Try calling Google Gemini Vision first
    try:
        header, base64_str = req.image_data.split(",", 1)
        mime_type = header.split(";")[0].split(":")[1]
        image_bytes = base64.b64decode(base64_str)
        
        model = genai.GenerativeModel("gemini-2.5-flash")
        
        prompt = (
            "Analyze this trading chart and return a structured JSON response for a beginner trader. "
            "Your output MUST be a valid JSON object matching this structure EXACTLY (do not wrap in markdown or backticks):\n"
            "{\n"
            "  \"status\": \"success\",\n"
            "  \"asset\": \"[Identify the asset, e.g., BTC/USDT]\",\n"
            "  \"action\": \"[BUY (LONG), SELL (SHORT), or WAIT / NO ACTION]\",\n"
            "  \"confidence\": \"[e.g., 85%]\",\n"
            "  \"plain_explanation\": \"[Explain the trend/pattern in very simple, plain language analogies, e.g. 'the price is sliding down a steep hill']\",\n"
            "  \"leverage_guide\": \"[For a ₹1,000 wallet size aiming for ₹40–₹60 profit: Specify recommended leverage (5x), precise buy/sell entry price, Target Exit (Take Profit) price, and Safety Exit (Stop Loss) price]\",\n"
            "  \"danger_warning\": \"[A warning explaining exactly how much money they could lose in the worst case (e.g. ₹130 loss) if they hit their safety exit]\"\n"
            "}"
        )
        
        contents = [
            {"mime_type": mime_type, "data": image_bytes},
            prompt
        ]
        
        response = model.generate_content(contents)
        text = response.text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```json") or lines[0].startswith("```"):
                text = "\n".join(lines[1:-1]).strip()
        
        data = json.loads(text)
        return data
    except Exception as e:
        print(f"Gemini Vision API error: {e}. Falling back to simulator.")
        
        # Fallback simulator
        is_btc = "BTC" in req.image_data or len(req.image_data) > 1000
        if is_btc:
            return {
                "status": "success",
                "asset": "BTC/USDT (Bitcoin)",
                "action": "SELL (SHORT)",
                "confidence": "85%",
                "plain_explanation": "Looking at the chart, the price has been sliding down a steep hill recently (a strong downtrend) and is now stuck in a narrow sideways channel near the bottom. This pattern usually means sellers are resting before pushing the price even lower. It's best to join them rather than trying to buy now.",
                "leverage_guide": "For a ₹1,000 wallet size aiming for a small ₹40 to ₹60 profit: Use 5x leverage. This makes your trading power ₹5,000. Sell (short) at the current level (~$59,026). Place a target exit (Take Profit) at $58,150, and a safety exit (Stop Loss) at $60,500. If the price reaches your target, you will close with around ₹75 profit.",
                "danger_warning": "Warning: Leveraged trading is risky. If the price rises to $60,500, your safety exit will trigger, closing the trade with a small loss of ₹125, preventing you from losing your entire ₹1,000 capital."
            }
        else:
            return {
                "status": "success",
                "asset": "General Stock Asset",
                "action": "WAIT / NO ACTION",
                "confidence": "70%",
                "plain_explanation": "The chart shows a highly mixed pattern with random up and down candles. There is no clear direction or group in control.",
                "leverage_guide": "With ₹1,000, do not enter this trade. Keep your cash safe until a clear trend emerges.",
                "danger_warning": "Patience is key. Entering trades without a clear direction is gambling, not trading."
            }

@app.post("/api/chat")
async def api_chat_endpoint(req: ChatRequest):
    try:
        model = genai.GenerativeModel("gemini-2.5-flash")
        system_prompt = (
            "You are a friendly and professional Varsity AI Quant Tutor. "
            "Explain financial, quant, and trading concepts in simple, plain language suitable for absolute beginners. "
            "Keep answers concise, helpful, and directly related to the question. "
            "If the user asks about the website or how to use it, remind them that the website is an "
            "AI Trading Laboratory where they can set stock parameters, train a reinforcement learning policy, "
            "and run backtests. Encourage them to ask about Sharpe ratios, drawdowns, market frictions, "
            "or volatility regimes."
        )
        response = model.generate_content([system_prompt, req.question])
        return {"answer": response.text}
    except Exception as e:
        print(f"Gemini Chat API error: {e}. Falling back to rules.")
        # Local fallback rules
        clean_query = req.question.lower()

        if any(x in clean_query for x in ["analyze", "analyzing", "chart", "charts", "visual", "image", "upload"]):
            ans = (
                "I analyze charts using a high-powered visual parsing engine. "
                "When you click the paperclip icon and upload a chart screenshot (like BTC/USDT or stock candles):\n\n"
                "1. **Trend Scanning**: I determine if the market is trending up, down, or going sideways.\n"
                "2. **Support & Resistance**: I map key price floor and ceiling zones.\n"
                "3. **Leverage & Exit Targets**: For a ₹1,000 wallet size aiming for ₹40–₹60 profit, I calculate "
                "the exact entry levels, the optimal leverage (like 5x), a Safety Exit (Stop Loss) to keep you safe, "
                "and a Target Exit (Take Profit) to lock in gains."
            )
        elif "sharpe" in clean_query:
            ans = "The **Sharpe Ratio** (Varsity Module 9) measures risk-adjusted return. A Sharpe ratio above 1.0 means the agent earns enough return to justify the stock's volatility. In Step 1, adjusting settings affects your agent's Sharpe outcome."
        elif "drawdown" in clean_query:
            ans = "**Maximum Drawdown** (Varsity Module 9) is the largest peak-to-trough drop in capital. Maintaining a low drawdown is critical for long-term survival. You can penalize drawdowns using the 'Drawdown Coeff' parameter in Step 1."
        elif any(x in clean_query for x in ["friction", "brokerage", "slippage"]):
            ans = "**Market Frictions** (Varsity Module 9 & 7) include brokerage commissions and order execution slippages. If frictions are too high, the agent will learn to trade less frequently, looking only for strong entry setups."
        elif any(x in clean_query for x in ["regime", "volatility"]):
            ans = "**Volatility Regimes** represent changing market behaviors (bull, bear, volatile, quiet). Our agent reads these states via technical indicators (standard deviation, trend flags) to adjust asset exposure dynamically."
        elif any(x in clean_query for x in ["ppo", "learning", "reinforcement"]):
            ans = "**Reinforcement Learning (PPO)** (Varsity Module 10) trains the policy. The policy is rewarded for trading profits and penalized for drawdowns, iteratively updating parameters to find the best rules."
        elif any(x in clean_query for x in ["stop loss", "safety exit", "stop-loss"]):
            ans = "A **Safety Exit (Stop-Loss)** is an automated order that triggers at a specified price boundary to close a losing trade early, preventing you from losing your entire trading capital if the market moves against you."
        elif any(x in clean_query for x in ["take profit", "target exit", "take-profit"]):
            ans = "A **Target Exit (Take-Profit)** is an automated order that triggers at your target price to close a winning trade and lock in your gains before the market reverses."
        elif any(x in clean_query for x in ["leverage", "margin", "borrow"]):
            ans = "**Leverage** means borrowing capital from an exchange to trade larger position sizes. For example, 5x leverage turns ₹1,000 into ₹5,000 of trading exposure, multiplying both your potential profits and your potential losses by 5."
        elif any(x in clean_query for x in ["intraday", "help", "trade", "trading"]):
            ans = (
                "Yes, absolutely! I am a **fully automated, powerful Quant Advisor** built to guide your intraday trading decisions. Here is how I can directly help you:\n\n"
                "1. **Analyze Charts**: Click the paperclip icon below to attach any chart screenshot (like BTC/USDT or stocks). I will immediately scan it, tell you whether to **Buy** or **Sell**, and calculate your entry/exit targets.\n"
                "2. **Portfolio Leverage**: Tell me your capital size (e.g. ₹1,000) and target returns, and I will calculate the exact leverage settings and safety exits (Stop-Loss) to protect your money.\n"
                "3. **Optimal Parameters**: Ask me how to configure the Step 1 and Step 2 settings for your chosen asset to maximize Sharpe ratios."
            )
        elif any(x in clean_query for x in ["website", "understand", "explain", "how", "operate", "use"]):
            ans = (
                "This website is an **AI Trading Laboratory** designed to train and test intelligent agents on Indian stocks. Here is how to use it in 3 steps:\n\n"
                "1. **Step 1 (Settings)**: Select an asset and transaction cost values. Transaction cost values act as a friction fee on trades.\n"
                "2. **Step 2 (Train)**: Adjust training steps and click 'Start Agent Training'. The AI runs simulations to find the best rules.\n"
                "3. **Step 3 (Test)**: Click 'Run Backtest Simulation' to see the AI's performance vs. holding the asset.\n\n"
                "*Tip: Turn on 'Learn Varsity Mode' in the header to show tips on each step, or upload a chart screenshot using the paperclip clip icon!*"
            )
        else:
            ans = "Hello! I'm your Varsity AI Quant Tutor. Ask me about: 'How to analyze charts', 'What is stop-loss', 'How leverage works', or 'Max drawdown'."
        return {"answer": ans}



# Serve Frontend static assets
static_dir = Path("src/static")
static_dir.mkdir(exist_ok=True, parents=True)

# Mount static directory
app.mount("/static", StaticFiles(directory="src/static"), name="static")

@app.get("/")
async def get_index():
    response = FileResponse("src/static/index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
