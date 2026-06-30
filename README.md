# NiftyRL — Intraday Trading Agent using Deep RL

This repository contains my research codebase for training and evaluating reinforcement learning (RL) agents on NSE Nifty-50 stocks. The project uses a custom **Gymnasium** environment paired with **Stable-Baselines3 (PPO)** to experiment with reward shaping, transaction friction, and out-of-sample validation.

---

## Why PPO? (Design Decisions & Hard Lessons)

In the initial phases of this project, I experimented with Deep Q-Networks (DQN). However, DQN proved highly unstable: the policy suffered from severe value estimation spikes and frequently collapsed into repetitive buy-sell loops. 

I transitioned to **Proximal Policy Optimization (PPO)**. PPO’s clipped objective function prevents catastrophic policy updates, making it far more suited for noisy financial data. Even with PPO, I learned that the policy is incredibly sensitive to hyperparameter tuning—particularly the entropy coefficient (which controls exploration vs. exploitation). Setting the entropy coefficient too low causes the agent to quickly overfit to a single action sequence, while setting it too high leads to random trading.

---

## Technical Architecture & State Design

The framework is structured into modular layers:
1. **Data Ingestion (`src/utils.py`):** Automatically downloads daily price series via `yfinance` and computes basic technical features. If Yahoo Finance is rate-limited, it falls back to a Geometric Brownian Motion (GBM) simulation to allow offline verification.
2. **Gymnasium Environment (`src/env.py`):** Implements a long-only position constraint (the agent holds either a 1.0 full position or 0.0 flat cash position). The state representation flattens a 10-day lookback window across normalized indicators.
3. **Training & Callbacks (`src/train.py`):** Manages training over historical segments and saves model checkpoints.

---

## The Reward Shaping Problem (What Didn't Work)

One of the biggest hurdles was defining a stable reward signal. 
* **Attempt 1 (Real-Time Equity Changes):** I initially rewarded the agent on every step based on the change in net asset value (NAV). This caused the agent to panic and sell early during minor, healthy pullbacks because it was overly sensitive to intermediate noise.
* **Attempt 2 (Realized PnL Only):** Next, I switched to rewarding the agent *only* when it closed a position (Realized PnL). This solved the early panic issue but introduced a sparse reward problem; the agent spent hundreds of steps receiving a reward of 0, making it very slow to converge.
* **Current Setup:** I settled on rewarding realized PnL on exit, but combined it with a minor step-by-step drawdown penalty (`drawdown_coeff`) and action-space bounds. This penalizes the agent for sitting in losing positions for too long, but it remains a delicate balance.

---

## Backtest Performance & Critical Limitations

Below are the results obtained on a 20% out-of-sample test set for `RELIANCE.NS`:

| Metric | RL Trading Agent | Buy-and-Hold Benchmark |
| :--- | :---: | :---: |
| **Total Return** | -3.96% | -6.05% |
| **Sharpe Ratio** | -1.0487 | -1.2504 |
| **Max Drawdown** | 7.71% | ~10.00% |
| **Total Trades** | 8 | — |

### Crucial Limitations (Honest Analysis)
1. **Sample Size Warning:** The backtest only executed **8 trades** during the test period. Calculating a Sharpe ratio or a win rate (62.5% here) on such a small number of trades is statistically meaningless. These metrics are reported here purely for pipeline validation, not as proof of trading efficacy.
2. **The "Cash" Bias:** The apparent outperformance (+2.09% relative return) is not due to active, profitable trading. Instead, it is an artifact of the agent choosing to remain flat in cash during a major bearish downtrend. While capital preservation is a valid risk-mitigation strategy, the agent is not yet showing an ability to find positive alpha in down-markets.
3. **Continuous Execution:** Intraday slippage and bid-ask spreads are simplified in this model. In a live trading setup, friction costs would likely erode these marginal relative gains.

---

## Future Research Directions

- [ ] **Short-selling Integration:** Allow the action space to support short positions so the agent can generate absolute returns in bearish regimes.
- [ ] **Multi-Asset Training:** Train the policy on a broader basket of Nifty-50 stocks (TCS, HDFCBANK, etc.) to evaluate generalization.
- [ ] **Action Masking:** Implement action masking to prevent the agent from selecting illegal actions (like selling when it doesn't hold shares) instead of relying on heavy negative reward penalties.

---

## AI Assistance Disclosure

To remain fully transparent with recruiters and reviewers: **This repository contains AI-assisted work.**
* **Core RL Logic & Math:** The mathematical formulation of the Gymnasium environment, state spaces, and Stable-Baselines3 integration represent my own core quant research code.
* **Dashboard & UI Code:** I used AI agents (Gemini Antigravity / Claude Code) to build the dashboard shell, design the websocket/polling endpoints in FastAPI, generate the frontend styling layout, and integrate the helper widgets (such as speech-to-text and the chat assistant).
* **Disclaimer:** This is an academic and portfolio project. It is not financial advice.
