"""
src/train.py — Training pipeline for the RL trading agent
==========================================================

Trains a Stable-Baselines3 PPO agent on the custom ``TradingEnv`` using
historical data for "RELIANCE.NS" downloaded via yfinance.

Key Features:
    • Train/validation split:
        - Train set: First 80% of the historical data
        - Validation set: Next 10% of the historical data (for EvalCallback)
        - Test set (optional): Remaining 10% (reserved for backtesting)
    • Model selection: PPO with MlpPolicy
    • Callbacks:
        - EvalCallback: Evaluates the model on the validation set every
          10,000 steps, saving the best-performing model to
          ``models/best_model.zip``.
        - Custom progress callback: Prints training progress indicators
          every 10,000 timesteps.
    • Visualization: Plots the rolling episodic reward curve from the
      training monitor log and saves it to ``logs/reward_curve.png``.
"""

from __future__ import annotations

import os
import sys
import argparse
from pathlib import Path
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, EvalCallback
from stable_baselines3.common.monitor import Monitor, load_results
from stable_baselines3.common.vec_env import DummyVecEnv

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.env import TradingEnv
from src.utils import fetch_stock_data


# ======================================================================
#  Progress Logging Callback
# ======================================================================

class ProgressLoggingCallback(BaseCallback):
    """Callback to print training progress and diagnostics every N steps."""

    def __init__(self, log_freq: int = 10_000, verbose: int = 1):
        super().__init__(verbose)
        self.log_freq = log_freq
        self.last_logged_step = 0
        self.action_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}

    def _on_step(self) -> bool:
        # Accumulate actions chosen on this step
        actions = self.locals.get("actions", [])
        for a in actions:
            act_int = int(a)
            if act_int in self.action_counts:
                self.action_counts[act_int] += 1

        # Check if the number of steps matches the frequency
        if self.num_timesteps - self.last_logged_step >= self.log_freq:
            self.last_logged_step = self.num_timesteps
            
            # Retrieve current reward and info if available
            info = self.locals.get("infos", [{}])[0]
            current_net_worth = info.get("net_worth", "N/A")
            current_profit = info.get("total_profit", "N/A")
            
            print(
                f"[PROGRESS] Timestep: {self.num_timesteps:>7,d} │ "
                f"Net Worth: ₹{current_net_worth} │ "
                f"Realised P&L: ₹{current_profit}"
            )

            print(
                f"           Action dist → "
                f"0%:{self.action_counts[0]}  25%:{self.action_counts[1]}  50%:{self.action_counts[2]}  75%:{self.action_counts[3]}  100%:{self.action_counts[4]}"
            )
            # Reset action counts
            self.action_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
        return True


# ======================================================================
#  Reward Curve Plotting
# ======================================================================

def plot_reward_curve(monitor_log_dir: Path, output_image_path: Path) -> None:
    """Load SB3 monitor logs, plot cumulative episodic rewards, and save the figure.

    Parameters
    ----------
    monitor_log_dir : Path
        Directory where the training monitor log CSV is saved.
    output_image_path : Path
        Target filepath for the PNG plot.
    """
    try:
        df_results = load_results(str(monitor_log_dir))
        if df_results.empty:
            print("Warning: Monitor log is empty. Cannot plot reward curve.")
            return

        # Prepare plots
        plt.style.use("seaborn-v0_8-darkgrid")
        plt.figure(figsize=(10, 5))
        
        rewards = df_results["r"].values
        episodes = np.arange(len(rewards)) + 1
        
        # Plot individual episode rewards
        plt.plot(episodes, rewards, color="#3498DB", alpha=0.4, label="Raw Episode Reward")
        
        # Plot rolling mean (smoothed curve)
        window = min(10, len(rewards))
        if window > 1:
            rolling_mean = pd.Series(rewards).rolling(window=window, min_periods=1).mean()
            plt.plot(episodes, rolling_mean, color="#E74C3C", linewidth=2, 
                     label=f"Rolling Mean (Window={window})")

        plt.title("PPO Training Reward Curve", fontsize=14, fontweight="bold")
        plt.xlabel("Episode", fontsize=12)
        plt.ylabel("Realised PnL Reward", fontsize=12)
        plt.legend(loc="upper left")
        
        # Ensure directories exist
        output_image_path.parent.mkdir(parents=True, exist_ok=True)
        plt.savefig(output_image_path, dpi=150, bbox_inches="tight")
        plt.close()
        print(f"✓ Reward curve successfully plotted and saved to: {output_image_path}")

    except Exception as e:
        print(f"Error while plotting reward curve: {e}")


# ======================================================================
#  Main Pipeline
# ======================================================================

def train_agent(
    ticker: str = "RELIANCE.NS",
    data_years: int = 2,
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    total_timesteps: int = 500_000,
    eval_freq: int = 10_000,
    brokerage_pct: float = 0.0003,
    slippage_pct: float = 0.0005,
    seed: int = 42,
) -> None:
    """Download data, configure environments, run the PPO agent training,
    and save outputs.
    """
    project_root = Path(__file__).resolve().parent.parent
    
    # Establish absolute paths
    logs_dir = project_root / "logs"
    models_dir = project_root / "models"
    
    logs_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 70)
    print(f"  PPO Agent Training Pipeline — {ticker}")
    print("=" * 70)

    # 1. Fetch data
    print(f"→ Downloading {data_years} years of daily data for {ticker}...")
    df = fetch_stock_data(ticker, years=data_years, auto_append_ns=False)
    total_len = len(df)
    
    # 2. Slice data chronologically
    train_split = int(total_len * train_ratio)
    val_split = int(total_len * (train_ratio + val_ratio))
    
    train_df = df.iloc[:train_split].reset_index(drop=True)
    val_df = df.iloc[train_split:val_split].reset_index(drop=True)
    
    print(f"  Dataset Breakdown:")
    print(f"    - Total rows      : {total_len}")
    print(f"    - Train (80%)     : {len(train_df)} rows")
    print(f"    - Validation (10%): {len(val_df)} rows")
    print(f"    - Test/Holdout    : {total_len - len(train_df) - len(val_df)} rows")
    print("-" * 70)

    # 3. Create Gymnasium environments
    # Training environment with Monitor to log rewards for reward curve
    train_env = TradingEnv(train_df, brokerage_pct=brokerage_pct, slippage_pct=slippage_pct)
    train_env = Monitor(train_env, str(logs_dir / "train_monitor"))
    train_vec_env = DummyVecEnv([lambda: train_env])

    # Validation environment for EvalCallback
    val_env = TradingEnv(val_df, brokerage_pct=brokerage_pct, slippage_pct=slippage_pct)
    val_env = Monitor(val_env, str(logs_dir / "val_monitor"))
    val_vec_env = DummyVecEnv([lambda: val_env])

    # 4. Set up Callbacks
    # EvalCallback evaluates validation set, saves best_model.zip
    eval_callback = EvalCallback(
        val_vec_env,
        best_model_save_path=str(models_dir),
        log_path=str(logs_dir),
        eval_freq=eval_freq,
        n_eval_episodes=1,
        deterministic=True,
        verbose=0,  # Suppress internal EvalCallback logs since we print custom progress
    )
    
    # Progress logger prints output every 10,000 steps
    progress_callback = ProgressLoggingCallback(log_freq=eval_freq)

    # 5. Initialize PPO agent
    print("→ Initialising PPO agent with MlpPolicy...")
    model = PPO(
        policy="MlpPolicy",
        env=train_vec_env,
        tensorboard_log=str(logs_dir),
        seed=seed,
        ent_coef=0.01,       # Force exploration — prevents policy collapse
        learning_rate=3e-4,  # Explicit LR (try 1e-4 if still collapsing)
        verbose=0,           # Managed by custom callbacks
    )

    # 6. Train the model
    print(f"→ Starting training for {total_timesteps:,} steps...")
    try:
        model.learn(
            total_timesteps=total_timesteps,
            callback=[eval_callback, progress_callback],
            tb_log_name="PPO_Reliance",
            progress_bar=True,
        )
        print("✓ Training completed successfully.")
    except KeyboardInterrupt:
        print("\n⚠ Training interrupted by user.")
    
    # 7. Plot and save reward curve
    print("→ Plotting training reward curve...")
    plot_reward_curve(logs_dir, logs_dir / "reward_curve.png")
    
    print(f"\n✓ Best model saved to: {models_dir / 'best_model.zip'}")
    print(f"✓ Reward curve saved to: {logs_dir / 'reward_curve.png'}")
    print(f"✓ TensorBoard logs path: {logs_dir}")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train PPO Trading Agent")
    parser.add_argument("--ticker", type=str, default="RELIANCE.NS", help="NSE stock ticker")
    parser.add_argument("--years", type=int, default=2, help="Years of data to download")
    parser.add_argument("--timesteps", type=int, default=500_000, help="Total training timesteps")
    parser.add_argument("--eval_freq", type=int, default=10_000, help="Evaluation frequency in steps")
    parser.add_argument("--brokerage", type=float, default=0.0003, help="Brokerage percentage (0.03% = 0.0003)")
    parser.add_argument("--slippage", type=float, default=0.0005, help="Slippage percentage (0.05% = 0.0005)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    train_agent(
        ticker=args.ticker,
        data_years=args.years,
        total_timesteps=args.timesteps,
        eval_freq=args.eval_freq,
        brokerage_pct=args.brokerage,
        slippage_pct=args.slippage,
        seed=args.seed,
    )
