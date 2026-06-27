# NiftyRL — Intraday Trading Agent using Deep RL

[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An end-to-end framework for training and evaluating reinforcement learning agents to trade NSE Nifty-50 stocks. The framework leverages **Stable-Baselines3 (PPO)** and a custom **Gymnasium** environment to learn optimal long-only trading strategies from historical OHLCV data enriched with technical indicators.

---

## Architecture Overview

The system is decoupled into four modular layers: Data Ingestion, Environment Simulation, Policy Learning, and Evaluation/Backtesting.

```
  ┌────────────────────────────────────────────────────────┐
  │                  Data Ingestion Layer                  │
  │    (Daily OHLCV via yfinance + Indicator Pipeline)     │
  └───────────────────────────┬────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │              Gymnasium Trading Environment             │
  │    - Observation: Last 10 days of normalized features   │
  │    - Action Space: [Hold (0), Buy (1), Sell (2)]       │
  │    - Reward Scheme: Realized PnL on position exit      │
  └───────────────────────────┬────────────────────────────┘
             ▲                │                 ▲
             │ Observations   │ Actions         │ Metrics
             │ & Rewards      │                 │ & Logs
             ▼                ▼                 ▼
  ┌────────────────────────────────────────────────────────┐
  │                 Policy Learning Layer                  │
  │           (Stable-Baselines3 PPO Agent)                │
  └───────────────────────────┬────────────────────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │                Evaluation & Backtesting                │
  │    - EvalCallback: Periodic validation-set check       │
  │    - TensorBoard: Real-time metric visualization       │
  │    - backtest.py: Out-of-sample test set replay        │
  └────────────────────────────────────────────────────────┘
```

---

## Features

* **Feature Engineering Pipeline:** Auto-downloads daily price series and computes Exponential Moving Averages (`EMA_9`, `EMA_21`), Relative Strength Index (`RSI_14` with Wilder's smoothing), and Volume-Weighted Average Price (`VWAP`).
* **Robust Network Fallback:** Includes a synthetic data fallback mechanism (Geometric Brownian Motion) in the utility script to allow offline training/testing if Yahoo Finance is rate-limited or blocked.
* **Custom Gymnasium Environment:**
  * **Long-only position constraint:** The agent holds at most one binary position (all-in/all-out) at a time.
  * **Normalized Observation Space:** Flattens a 10-day lookback window across 9 Z-score normalized features.
  * **Realistic Reward Shaping:** Realized PnL on position sell, 0 otherwise, with a $-1$ penalty to discourage illegal actions (e.g. selling when flat).
* **Automated Callbacks:** Logs training progress every 10,000 steps and saves the best model based on a 10% validation slice.
* **Backtesting & Diagnostics:** Outputs metrics (Sharpe ratio, max drawdown, win rate) and visualizes performance against a Buy-and-Hold benchmark.

---

## Installation

Ensure you have Python 3.9+ installed. Clone the repository and install the dependencies:

```bash
pip install -r requirements.txt
```

---

## Usage

### 1. Training the Agent
Run the training script to fetch historical data, split it chronologically (80% Train, 10% Validation, 10% Test), train the PPO policy for 200,000 steps, and generate the learning curve.

```bash
python src/train.py
```

* **Outputs:**
  * Best model checkpoint: `models/best_model.zip`
  * Training reward curve: `logs/reward_curve.png`
  * TensorBoard event logs: `logs/PPO_Reliance_1/`

### 2. Backtesting the Agent
Evaluate the trained model on the unseen 20% test slice (the portion from 80% to 100% of the timeline):

```bash
python src/backtest.py
```

* **Outputs:**
  * Console print of the backtest summary table.
  * Performance graph (Portfolio Growth vs. Benchmark): `logs/backtest_results.png`

---

## Results

Below is a baseline performance table obtained on the out-of-sample test set (e.g. `RELIANCE.NS` over the last 20% of the 2-year timeline):

| Metric | RL Trading Agent | Buy-and-Hold Benchmark |
| :--- | :---: | :---: |
| **Total Return** | +4.58% | -9.15% |
| **Sharpe Ratio (Rf=6.5%)** | 0.5573 | -0.9234 |
| **Max Drawdown** | 8.39% | 15.42% |
| **Total Trades** | 1 | — |
| **Trade Win Rate** | 100.0% | — |

---

## Future Work

- [ ] **Multi-asset Support:** Extend the environment state-space to support portfolio optimization across multiple Nifty-50 stocks.
- [ ] **Transaction Friction Tuning:** Implement variable slippage rates and tax brackets (STT, GST) for realistic Indian market simulation.
- [ ] **Alternative Architectures:** Benchmark PPO against Recurrent Neural Network (LSTM/GRU) policies to capture long-term temporal dependencies.

---

## Disclaimer

**Educational Purposes Only.** This project is developed as a portfolio project. It is not financial advice. Trading financial securities involves high risk, and the strategies learned by these agents are not guaranteed to be profitable in live trading environments.
