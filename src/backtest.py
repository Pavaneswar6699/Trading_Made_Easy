"""
src/backtest.py — Backtesting engine for trained RL trading agents
===================================================================

Loads the trained PPO model from ``models/best_model.zip``, replays it
on the unseen 20% test data of "RELIANCE.NS", and evaluates its performance
relative to a simple Buy-and-Hold benchmark.

Output Metrics:
    1. Total Return % vs Buy-and-Hold benchmark.
    2. Sharpe Ratio (assuming a 6.5% annual risk-free rate — Indian T-bill).
    3. Max Drawdown %
    4. Win Rate (% of trades that were profitable)
    5. Visualization: Plot of portfolio value over time vs. Buy-and-Hold
       saved as ``logs/backtest_results.png``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from stable_baselines3 import PPO

# Ensure project root is in the path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.env import TradingEnv
from src.utils import fetch_stock_data


# ======================================================================
#  Core Backtesting Loop & Evaluation
# ======================================================================

def run_backtest(
    model_path: str = "models/best_model.zip",
    ticker: str = "RELIANCE.NS",
    data_years: int = 2,
    train_ratio: float = 0.8,
    initial_capital: float = 100_000.0,
    risk_free_rate: float = 0.065,
    save_image_path: str = "logs/backtest_results.png",
) -> None:
    """Load a trained agent, simulate on hold-out test data, and plot performance."""
    project_root = Path(__file__).resolve().parent.parent
    model_file = project_root / model_path
    image_file = project_root / save_image_path

    # Ensure output logs directory exists
    image_file.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 70)
    print(f"  Backtesting Pipeline — {ticker}")
    print(f"  Model Source: {model_path}")
    print("=" * 70)

    # 1. Load data
    print(f"→ Downloading {data_years} years of historical data for {ticker}...")
    df = fetch_stock_data(ticker, years=data_years, auto_append_ns=False)
    
    # 2. Slice the unseen 20% test data (the portion from 80% to 100%)
    split_idx = int(len(df) * train_ratio)
    test_df = df.iloc[split_idx:].reset_index(drop=True)
    
    print(f"  Dataset Breakdown:")
    print(f"    - Total rows      : {len(df)}")
    print(f"    - Unseen test (20%): {len(test_df)} rows")
    print("-" * 70)

    if not model_file.exists():
        raise FileNotFoundError(
            f"Trained model not found at {model_file}. "
            "Please run 'python src/train.py' first to train the model."
        )

    # 3. Initialize test environment
    # Note: render_mode is None for fast execution; status is tracked in lists.
    env = TradingEnv(test_df, initial_capital=initial_capital, render_mode=None)
    
    # 4. Load the PPO agent
    print("→ Loading trained model...")
    model = PPO.load(str(model_file), env=env)

    # 5. Run the backtest loop
    obs, info = env.reset()
    done = False
    
    net_worths: List[float] = [info["net_worth"]]
    prices: List[float] = [info["current_price"]]
    steps: List[int] = [info["current_step"]]
    exposures: List[float] = [0.0]

    print("→ Replaying historical bars...")
    while not done:
        action, _states = model.predict(obs, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(int(action))
        done = terminated or truncated
        
        net_worths.append(info["net_worth"])
        prices.append(info["current_price"])
        steps.append(info["current_step"])
        
        # calculate exposure for the step
        current_exposure = (info["shares_held"] * info["current_price"]) / info["net_worth"] if info["net_worth"] > 0 else 0.0
        exposures.append(current_exposure)

    # 6. Compute metrics
    metrics = compute_backtest_metrics(
        net_worths=net_worths,
        prices=prices,
        initial_capital=initial_capital,
        trade_log=env.trade_log,
        risk_free_rate=risk_free_rate,
    )

    # 7. Print summary table
    print_summary_table(metrics, ticker)

    # 8. Generate and save performance chart
    print(f"→ Plotting performance chart...")
    plot_backtest_results(
        steps=steps,
        net_worths=net_worths,
        prices=prices,
        exposures=exposures,
        trade_log=env.trade_log,
        ticker=ticker,
        metrics=metrics,
        output_path=image_file,
    )
    print("=" * 70)


# ======================================================================
#  Metrics Calculation
# ======================================================================

def compute_backtest_metrics(
    net_worths: List[float],
    prices: List[float],
    initial_capital: float,
    trade_log: List[Dict[str, Any]],
    risk_free_rate: float,
) -> Dict[str, Any]:
    """Compute performance indicators for the backtested run."""
    nw = np.array(net_worths, dtype=np.float64)
    p = np.array(prices, dtype=np.float64)

    # --- Total Return % ---
    final_net_worth = nw[-1]
    total_return_pct = ((final_net_worth - initial_capital) / initial_capital) * 100

    # --- Buy & Hold Return % ---
    buy_hold_return_pct = ((p[-1] - p[0]) / p[0]) * 100

    # --- Daily returns & Sharpe Ratio ---
    daily_returns = np.diff(nw) / nw[:-1]
    
    # Sharpe Ratio formula with 6.5% annual risk-free rate
    # Daily risk-free rate proxy
    daily_rf = (1.0 + risk_free_rate) ** (1.0 / 252.0) - 1.0
    
    if len(daily_returns) > 1 and daily_returns.std() > 0:
        excess_daily_returns = daily_returns - daily_rf
        sharpe = (excess_daily_returns.mean() / daily_returns.std()) * np.sqrt(252)
    else:
        sharpe = 0.0

    # --- Max Drawdown % ---
    peaks = np.maximum.accumulate(nw)
    drawdowns = (peaks - nw) / peaks
    max_drawdown_pct = drawdowns.max() * 100

    # --- Win Rate & Trades ---
    total_trades = 0
    profitable_trades = 0
    
    # In a fractional sizing environment, we count every sell/reduce action as a trade
    for trade in trade_log:
        if "SELL_REDUCE" in trade["action"]:
            total_trades += 1
            if trade.get("pnl", 0) > 0:
                profitable_trades += 1

    win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0.0

    return {
        "final_net_worth": final_net_worth,
        "total_return_pct": total_return_pct,
        "buy_hold_return_pct": buy_hold_return_pct,
        "sharpe_ratio": sharpe,
        "max_drawdown_pct": max_drawdown_pct,
        "total_trades": total_trades,
        "win_rate_pct": win_rate,
    }


# ======================================================================
#  Summary Table Formatting
# ======================================================================

def print_summary_table(metrics: Dict[str, Any], ticker: str) -> None:
    """Print a clean ASCII summary table of the backtest metrics."""
    print("\n" + "═" * 56)
    print(f"║ {'BACKTEST PERFORMANCE SUMMARY: ' + ticker:<52s} ║")
    print("═" * 56)
    print(f"║ {'Metric':<28s} │ {'Value':<21s} ║")
    print("╟" + "─" * 29 + "┼" + "─" * 22 + "╢")
    print(f"║ {'Final Portfolio Value':<28s} │ ₹{metrics['final_net_worth']:>18,.2f} ║")
    print(f"║ {'RL Agent Return':<28s} │ {metrics['total_return_pct']:>+17.2f}% ║")
    print(f"║ {'Buy-and-Hold Return':<28s} │ {metrics['buy_hold_return_pct']:>+17.2f}% ║")
    print(f"║ {'Sharpe Ratio (Rf=6.5%)':<28s} │ {metrics['sharpe_ratio']:>18.4f} ║")
    print(f"║ {'Max Drawdown':<28s} │ {metrics['max_drawdown_pct']:>17.2f}% ║")
    print(f"║ {'Total Executed Trades':<28s} │ {metrics['total_trades']:>18d} ║")
    print(f"║ {'Trade Win Rate':<28s} │ {metrics['win_rate_pct']:>17.2f}% ║")
    print("═" * 56 + "\n")


# ======================================================================
#  Visualization
# ======================================================================

def plot_backtest_results(
    steps: List[int],
    net_worths: List[float],
    prices: List[float],
    exposures: List[float],
    trade_log: List[Dict[str, Any]],
    ticker: str,
    metrics: Dict[str, Any],
    output_path: Path,
) -> None:
    """Plot portfolio growth vs. buy-and-hold benchmark with trade markers."""
    plt.style.use("seaborn-v0_8-darkgrid")
    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(14, 8), sharex=True,
        gridspec_kw={"height_ratios": [2, 1]},
    )
    
    # Title
    fig.suptitle(
        f"RL Trading Agent Backtest — {ticker} (Test Set)",
        fontsize=16, fontweight="bold", y=0.98,
    )

    # --- Top Panel: stock price and trade executions ---
    ax1.plot(steps, prices, color="#4A90D9", linewidth=1.5, label=f"{ticker} Close Price")
    
    # Annotate buy and sell markers on stock chart
    for trade in trade_log:
        s = trade["step"]
        p = trade["price"]
        if "BUY_ADD" in trade["action"]:
            ax1.scatter(s, p, marker="^", color="#2ECC71", s=100, zorder=5, 
                        edgecolors="black", linewidth=0.5, label="Buy Add")
        elif "SELL_REDUCE" in trade["action"]:
            ax1.scatter(s, p, marker="v", color="#E74C3C", s=100, zorder=5, 
                        edgecolors="black", linewidth=0.5, label="Sell Reduce")

    ax1.set_ylabel("Stock Price (₹)", fontsize=12)
    
    # Remove duplicate labels in legend
    handles, labels = ax1.get_legend_handles_labels()
    unique_labels = dict(zip(labels, handles))
    ax1.legend(unique_labels.values(), unique_labels.keys(), loc="upper left", fontsize=10)

    # --- Bottom Panel: portfolio values vs Buy-and-Hold ---
    # Compute normalized Buy-and-Hold portfolio growth
    prices_arr = np.array(prices)
    buy_hold_portfolio = net_worths[0] * (prices_arr / prices_arr[0])

    ax2.plot(steps, net_worths, color="#F39C12", linewidth=2.0, label="RL Trading Agent", zorder=3)
    ax2.plot(steps, buy_hold_portfolio, color="#7F8C8D", linewidth=1.5, 
             linestyle="--", label="Buy-and-Hold Benchmark", zorder=2)

    # Plot exposure on secondary axis
    ax2_sub = ax2.twinx()
    ax2_sub.fill_between(steps, 0, np.array(exposures) * 100, color="#BDC3C7", alpha=0.12, label="Agent Exposure %", zorder=1)
    ax2_sub.set_ylabel("Exposure %", color="#7F8C8D", fontsize=11)
    ax2_sub.tick_params(colors="#7F8C8D")
    ax2_sub.set_ylim(-5, 105)
    ax2_sub.grid(False)

    # Fill shaded areas for outperformance/underperformance
    ax2.fill_between(
        steps, buy_hold_portfolio, net_worths, alpha=0.15,
        where=[nw >= bh for nw, bh in zip(net_worths, buy_hold_portfolio)],
        color="#2ECC71", interpolate=True
    )
    ax2.fill_between(
        steps, buy_hold_portfolio, net_worths, alpha=0.15,
        where=[nw < bh for nw, bh in zip(net_worths, buy_hold_portfolio)],
        color="#E74C3C", interpolate=True
    )

    ax2.set_xlabel("Time-Step", fontsize=12)
    ax2.set_ylabel("Portfolio Value (₹)", fontsize=12)
    
    # Combine legends from ax2 and ax2_sub
    h2, l2 = ax2.get_legend_handles_labels()
    h2s, l2s = ax2_sub.get_legend_handles_labels()
    ax2.legend(h2 + h2s, l2 + l2s, loc="upper left", fontsize=10)

    # --- Statistics box ---
    textstr = (
        f"Agent Return:  {metrics['total_return_pct']:+.2f}%\n"
        f"B&H Return:    {metrics['buy_hold_return_pct']:+.2f}%\n"
        f"Sharpe Ratio:  {metrics['sharpe_ratio']:.4f}\n"
        f"Max Drawdown:  {metrics['max_drawdown_pct']:.2f}%\n"
        f"Win Rate:      {metrics['win_rate_pct']:.1f}%"
    )
    props = dict(boxstyle="round,pad=0.6", facecolor="#2C3E50", edgecolor="#34495E", alpha=0.9)
    ax2.text(
        0.98, 0.95, textstr, transform=ax2.transAxes,
        fontsize=10, verticalalignment="top", horizontalalignment="right",
        bbox=props, color="white", fontfamily="monospace",
    )

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"✓ Backtest performance chart saved to: {output_path}")


if __name__ == "__main__":
    run_backtest()
