"""
src/env.py — Custom OpenAI Gym environment for intraday stock trading
======================================================================

Implements ``TradingEnv``, a ``gymnasium.Env`` subclass that lets an
RL agent learn to trade a single NSE stock using daily OHLCV data
enriched with technical indicators from ``utils.fetch_stock_data``.

Design decisions (matching project spec):
    ┌─────────────────────┬──────────────────────────────────────────┐
    │ Observation space    │ Last 10 days × 14 features, z-normalised│
    │ Action space         │ Discrete(3): 0=Hold, 1=Buy, 2=Sell      │
    │ Starting capital     │ ₹1,00,000                               │
    │ Position constraint  │ Long-only, one position at a time        │
    │ Reward               │ Realised PnL on sell + unrealised PnL    │
    │                      │ shaping while holding (×0.001 scale)     │
    │ Illegal action       │ −1 penalty (sell with no position, buy   │
    │                      │ while already holding)                   │
    │ Episode termination  │ Data exhausted  OR  capital < ₹10,000   │
    └─────────────────────┴──────────────────────────────────────────┘

Expected DataFrame columns (from utils.py):
    Open, High, Low, Close, Volume, EMA_9, EMA_21, RSI_14, VWAP,
    MACD, MACD_Signal, MACD_Hist, BB_Width, Momentum_10
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import gymnasium as gym
import numpy as np
import pandas as pd
from collections import deque
from gymnasium import spaces


class TradingEnv(gym.Env):
    """Single-stock, long-only trading environment.

    The agent can hold **at most one position** at a time.  A "Buy"
    action converts all available capital into shares at the current
    Close price.  A "Sell" action liquidates the entire position.
    Reward is only granted on sell (realised PnL); every other step
    returns 0.  Attempting an illegal action (buy when already holding,
    or sell when flat) incurs a **−1 penalty**.

    Parameters
    ----------
    df : pd.DataFrame
        Pre-processed DataFrame from ``utils.fetch_stock_data``.
        Must contain: Open, High, Low, Close, Volume, EMA_9, EMA_21,
        RSI_14, VWAP.
    initial_capital : float, default 1_00_000
        Starting cash in ₹.
    window_size : int, default 10
        Number of past trading days included in each observation.
    brokerage_pct : float, default 0.0003
        Brokerage commission as a fraction (0.03 %).
    slippage_pct : float, default 0.0005
        Execution slippage as a fraction (0.05 %).
    render_mode : str or None
        Set to ``"human"`` to print status on every step.
    """

    # Gymnasium requires this for render mode validation
    metadata = {"render_modes": ["human"]}

    # -----------------------------------------------------------------
    #  Feature columns expected from utils.fetch_stock_data()
    # -----------------------------------------------------------------
    FEATURE_COLS: List[str] = [
        "Open", "High", "Low", "Close", "Volume",
        "EMA_9", "EMA_21", "RSI_14", "VWAP",
        "MACD", "MACD_Signal", "MACD_Hist",
        "BB_Width", "Momentum_10",
    ]

    # =====================================================================
    #  __init__  — set up spaces, store config, pre-compute normalisation
    # =====================================================================
    def __init__(
        self,
        df: pd.DataFrame,
        initial_capital: float = 1_00_000.0,
        window_size: int = 10,
        brokerage_pct: float = 0.0003,
        slippage_pct: float = 0.0005,
        risk_aversion: float = 0.1,
        drawdown_coeff: float = 0.05,
        rolling_window_size: int = 10,
        render_mode: Optional[str] = None,
    ) -> None:
        super().__init__()

        # ---------- validate incoming data ----------
        missing = [c for c in self.FEATURE_COLS if c not in df.columns]
        if missing:
            raise ValueError(
                f"DataFrame is missing required columns: {missing}. "
                f"Expected: {self.FEATURE_COLS}"
            )

        # ---------- store configuration ----------
        self.df: pd.DataFrame = df.reset_index(drop=True)
        self.initial_capital: float = initial_capital
        self.window_size: int = window_size
        self.brokerage_pct: float = brokerage_pct
        self.slippage_pct: float = slippage_pct
        self.risk_aversion: float = risk_aversion
        self.drawdown_coeff: float = drawdown_coeff
        self.rolling_window_size: int = rolling_window_size
        self.render_mode = render_mode
        self.n_features: int = len(self.FEATURE_COLS)

        # ---------- pre-compute z-score normalised feature matrix ----------
        # Shape: (n_rows, 9).  Normalisation uses the FULL dataset so that
        # train and val splits stay on the same scale when computed from the
        # same parent DataFrame.
        raw = self.df[self.FEATURE_COLS].values.astype(np.float64)
        self._means = raw.mean(axis=0)
        self._stds  = raw.std(axis=0)
        self._stds[self._stds == 0] = 1.0          # avoid div-by-zero
        self._norm_features = ((raw - self._means) / self._stds).astype(
            np.float32
        )

        # ---------- define observation space ----------
        # The agent sees the last `window_size` rows of normalised
        # features (flattened) + 1 feature for the current position flag.
        obs_dim = self.window_size * self.n_features + 1
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(obs_dim,),
            dtype=np.float32,
        )

        # ---------- define action space ----------
        # Discrete(5): Target portfolio exposure levels
        # 0 = 0% exposure (flat)
        # 1 = 25% exposure
        # 2 = 50% exposure
        # 3 = 75% exposure
        # 4 = 100% exposure (all-in)
        self.action_space = spaces.Discrete(5)

        # ---------- episode state (initialised properly in reset()) ----------
        self.capital: float = 0.0         # available cash
        self.shares_held: int = 0         # number of shares currently held
        self.buy_price: float = 0.0       # entry price of current position
        self.current_step: int = 0        # pointer into the DataFrame
        self.total_profit: float = 0.0    # cumulative realised PnL
        self.trade_log: List[Dict[str, Any]] = []  # for backtest analysis

    # =====================================================================
    #  reset()  — start a new episode from the beginning of the data
    # =====================================================================
    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Reset the environment to the start of a new episode.

        The first valid step is at index ``window_size`` so that the
        observation look-back buffer is fully populated.

        Returns
        -------
        observation : np.ndarray
            Flattened (90,) vector of normalised features.
        info : dict
            Auxiliary information (capital, position, etc.).
        """
        super().reset(seed=seed)

        # Restore starting state
        self.capital = self.initial_capital
        self.shares_held = 0
        self.buy_price = 0.0
        self.current_step = self.window_size   # need `window_size` rows behind us
        self.total_profit = 0.0
        self.trade_log = []
        self.max_net_worth = self.initial_capital
        self.returns_history = deque(maxlen=self.rolling_window_size)

        observation = self._get_observation()
        info = self._get_info()
        return observation, info

    # =====================================================================
    #  step()  — execute one trading day
    # =====================================================================
    def step(
        self, action: int
    ) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        """Advance the environment by one time-step.

        Parameters
        ----------
        action : int
            Target exposure: 0=0%, 1=25%, 2=50%, 3=75%, 4=100%.

        Returns
        -------
        observation : np.ndarray   — next state
        reward      : float        — percentage change in portfolio Net Worth
        terminated  : bool         — True if capital < ₹10,000 (bankrupt)
        truncated   : bool         — True if we've reached the end of data
        info        : dict         — auxiliary diagnostics
        """
        # Current closing price for this step
        current_price = self._get_close_price(self.current_step)

        # Net worth before executing the action
        prev_net_worth = self.capital + self.shares_held * current_price

        # ---- ACTION DISPATCH (Fractional Position Adjustments) ----
        target_exposure = action * 0.25
        target_value = target_exposure * prev_net_worth
        current_value = self.shares_held * current_price

        commission = 0.0

        if target_value > current_value:
            # BUY order to increase exposure
            value_to_buy = target_value - current_value
            value_to_buy = min(value_to_buy, self.capital)  # bound by cash on hand
            
            # Estimate shares to buy by accounting for execution price + slippage + taxes
            # Approx cost multiplier: 1 + c_buy
            cost_multiplier = 1.0 + self.brokerage_pct + 0.001 + 0.0000345 + 0.000001 + 0.00015 + self.slippage_pct + 0.18 * (self.brokerage_pct + 0.0000345)
            shares_to_buy = int(value_to_buy // (current_price * cost_multiplier))
            
            if shares_to_buy > 0:
                cost_of_shares = shares_to_buy * current_price
                friction = self._calculate_frictions(cost_of_shares, is_buy=True)
                
                # Check if we have enough cash to cover cost + friction
                if cost_of_shares + friction > self.capital:
                    shares_to_buy = max(0, int(self.capital // (current_price * cost_multiplier)))
                    cost_of_shares = shares_to_buy * current_price
                    friction = self._calculate_frictions(cost_of_shares, is_buy=True)
                
                if shares_to_buy > 0:
                    # update weighted average cost basis
                    total_cost_basis = self.shares_held * self.buy_price + cost_of_shares
                    self.shares_held += shares_to_buy
                    self.buy_price = total_cost_basis / self.shares_held
                    self.capital -= (cost_of_shares + friction)
                    
                    # Log the trade
                    self.trade_log.append({
                        "step": self.current_step,
                        "action": f"BUY_ADD ({int(target_exposure * 100)}%)",
                        "price": current_price,
                        "shares": shares_to_buy,
                        "commission": round(friction, 2),
                        "capital_after": round(self.capital, 2),
                    })

        elif target_value < current_value:
            # SELL order to decrease exposure
            value_to_sell = current_value - target_value
            shares_to_sell = int(value_to_sell // current_price)
            
            # If target exposure is 0%, fully liquidate to clear rounding errors
            if action == 0:
                shares_to_sell = self.shares_held
                
            if shares_to_sell > 0:
                shares_to_sell = min(shares_to_sell, self.shares_held)
                revenue = shares_to_sell * current_price
                friction = self._calculate_frictions(revenue, is_buy=False)
                net_revenue = revenue - friction
                
                # Realised PnL on the sold portion
                cost_basis_sold = shares_to_sell * self.buy_price
                realised_pnl = net_revenue - cost_basis_sold
                
                self.shares_held -= shares_to_sell
                self.capital += net_revenue
                self.total_profit += realised_pnl
                
                if self.shares_held == 0:
                    self.buy_price = 0.0
                
                # Log the trade
                self.trade_log.append({
                    "step": self.current_step,
                    "action": f"SELL_REDUCE ({int(target_exposure * 100)}%)",
                    "price": current_price,
                    "shares": shares_to_sell,
                    "commission": round(friction, 2),
                    "capital_after": round(self.capital, 2),
                    "pnl": round(realised_pnl, 2),
                })

        # ---- ADVANCE TO NEXT DAY ----
        self.current_step += 1

        # ---- CALCULATE NEW PORTFOLIO VALUE & ACTUAL REWARD ----
        next_price = self._get_close_price(self.current_step)
        next_net_worth = self.capital + self.shares_held * next_price
        
        # Calculate actual return of this step
        step_return = ((next_net_worth - prev_net_worth) / prev_net_worth) * 100.0 if prev_net_worth > 0 else 0.0
        self.returns_history.append(step_return)
        
        # Step reward: percentage return relative to initial capital
        actual_reward = ((next_net_worth - prev_net_worth) / self.initial_capital) * 100.0
        reward = actual_reward

        # ---- APPLY VOLATILITY & DRAWDOWN SHAPING PENALTIES ----
        # Volatility penalty: standard deviation of rolling returns
        if len(self.returns_history) >= 2:
            volatility = np.std(self.returns_history)
            volatility_penalty = self.risk_aversion * volatility
            reward -= volatility_penalty
            
        # Drawdown penalty: percentage drawdown from running peak net worth
        self.max_net_worth = max(self.max_net_worth, next_net_worth)
        drawdown = (self.max_net_worth - next_net_worth) / self.max_net_worth if self.max_net_worth > 0 else 0.0
        drawdown_penalty = self.drawdown_coeff * drawdown * 100.0
        reward -= drawdown_penalty

        # ---- CHECK TERMINATION CONDITIONS ----
        terminated = next_net_worth < 10_000.0
        truncated = self.current_step >= len(self.df) - 1

        # ---- BUILD NEXT OBSERVATION ----
        observation = self._get_observation()
        info = self._get_info()

        # ---- OPTIONAL HUMAN RENDER ----
        if self.render_mode == "human":
            self.render()

        return observation, float(reward), terminated, truncated, info

    # =====================================================================
    #  render()  — print current step, price, position, capital
    # =====================================================================
    def render(self) -> None:
        """Print a human-readable one-line status of the environment.

        Format:
            Step  42 | Close ₹ 2,543.50 | Position: LONG  35 shares @ ₹2,480.00 | Capital ₹ 13,197.50 | Total P&L ₹ 1,200.00
        or:
            Step  42 | Close ₹ 2,543.50 | Position: FLAT                        | Capital ₹100,000.00 | Total P&L ₹     0.00
        """
        idx = min(self.current_step, len(self.df) - 1)
        price = self._get_close_price(idx)

        if self.shares_held > 0:
            unrealised = self.shares_held * (price - self.buy_price)
            position_str = (
                f"LONG {self.shares_held:>5d} shares "
                f"@ ₹{self.buy_price:>10,.2f}  "
                f"(unrealised: ₹{unrealised:>+10,.2f})"
            )
        else:
            position_str = "FLAT"

        print(
            f"Step {self.current_step:>5d} │ "
            f"Close ₹{price:>10,.2f} │ "
            f"Position: {position_str:<50s} │ "
            f"Capital ₹{self.capital:>12,.2f} │ "
            f"Total P&L ₹{self.total_profit:>+10,.2f}"
        )

    # =====================================================================
    #  _get_observation()  — build the normalised feature window
    # =====================================================================
    def _get_observation(self) -> np.ndarray:
        """Construct the observation for the current step.

        Takes the last ``window_size`` rows (10 days) of z-score
        normalised features and flattens them into a 1-D array of
        shape ``(window_size * n_features,)`` = ``(140,)``.

        Z-score normalisation:
            x_norm = (x − μ) / σ
        where μ and σ are computed column-wise over the ENTIRE dataset
        at init time (stored in ``self._norm_features``).

        Returns
        -------
        np.ndarray
            Flattened observation vector, dtype float32.
        """
        # Clamp step index so we never read past the end
        step = min(self.current_step, len(self.df) - 1)

        # Slice the look-back window: rows [step-10, step)
        start = step - self.window_size
        end = step
        window = self._norm_features[start:end]   # shape (10, 14)

        # Flatten to 1-D for MLP-friendly policy networks
        flattened = window.flatten().astype(np.float32)
        
        # Append position flag: current exposure fraction
        current_price = self._get_close_price(step)
        net_worth = self.capital + self.shares_held * current_price
        exposure = (self.shares_held * current_price) / net_worth if net_worth > 0 else 0.0
        position_flag = np.array([exposure], dtype=np.float32)
        
        return np.concatenate([flattened, position_flag])

    # =====================================================================
    #  _get_info()  — auxiliary diagnostics dict
    # =====================================================================
    def _get_info(self) -> Dict[str, Any]:
        """Return a dict of auxiliary information for logging / debugging.

        Keys
        ----
        capital       : current cash on hand
        shares_held   : number of shares in the open position (0 if flat)
        buy_price     : entry price of the current position (0 if flat)
        current_price : Close price at the current step
        total_profit  : cumulative realised PnL across all closed trades
        current_step  : index into the DataFrame
        net_worth     : capital + market value of holdings
        n_trades      : total number of trade entries in the log
        """
        idx = min(self.current_step, len(self.df) - 1)
        current_price = self._get_close_price(idx)
        net_worth = self.capital + self.shares_held * current_price

        return {
            "capital": round(self.capital, 2),
            "shares_held": self.shares_held,
            "buy_price": self.buy_price,
            "current_price": current_price,
            "total_profit": round(self.total_profit, 2),
            "current_step": self.current_step,
            "net_worth": round(net_worth, 2),
            "n_trades": len(self.trade_log),
        }

    # =====================================================================
    #  _get_close_price()  — safe accessor for the Close column
    # =====================================================================
    def _get_close_price(self, step: int) -> float:
        """Return the Close price at a given step index.

        Clamps the index to ``[0, len(df)-1]`` to prevent out-of-bounds
        access at episode boundaries.

        Parameters
        ----------
        step : int
            Row index into ``self.df``.

        Returns
        -------
        float
            The closing price.
        """
        idx = max(0, min(step, len(self.df) - 1))
        return float(self.df.loc[idx, "Close"])

    # =====================================================================
    #  _calculate_frictions()  — calculate NSE taxes, charges and slippage
    # =====================================================================
    def _calculate_frictions(self, trade_value: float, is_buy: bool) -> float:
        """Calculate NSE transaction costs, taxes, and slippage for a trade.

        Includes:
            - Brokerage: percentage of trade value
            - STT (Securities Transaction Tax): 0.1% on delivery
            - Exchange Transaction Charges: 0.00345%
            - SEBI Turnover Fees: 0.0001%
            - GST: 18% on (Brokerage + Exchange Charges)
            - Stamp Duty: 0.015% on BUY side only
            - Slippage: percentage of trade value
        """
        brokerage = trade_value * self.brokerage_pct
        stt = trade_value * 0.001
        exchange_charges = trade_value * 0.0000345
        sebi_fees = trade_value * 0.000001
        gst = 0.18 * (brokerage + exchange_charges)
        
        stamp_duty = trade_value * 0.00015 if is_buy else 0.0
        slippage = trade_value * self.slippage_pct
        
        return brokerage + stt + exchange_charges + sebi_fees + gst + stamp_duty + slippage


# =========================================================================
#  Quick self-test — run with:  python3 src/env.py
# =========================================================================
if __name__ == "__main__":
    import sys
    from pathlib import Path

    # Ensure project root is on sys.path so we can import utils
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from src.utils import fetch_stock_data

    print("=" * 70)
    print("  TradingEnv — Smoke Test")
    print("=" * 70)

    # Fetch real data
    df = fetch_stock_data("RELIANCE")
    print(f"\n  Data shape: {df.shape}")

    # Create the environment
    env = TradingEnv(df, window_size=10, render_mode="human")
    print(f"  Obs space : {env.observation_space}")
    print(f"  Act space : {env.action_space}")

    # Reset and play through a few actions manually
    obs, info = env.reset()
    print(f"\n  Initial obs shape: {obs.shape}")
    print(f"  Initial info: {info}\n")

    # Sequence: Hold → Buy → Hold → Sell → Sell (illegal) → Buy
    test_actions = [0, 1, 0, 2, 2, 1]
    action_names = {0: "HOLD", 1: "BUY", 2: "SELL"}

    for i, action in enumerate(test_actions):
        print(f"\n  >>> Action {i+1}: {action_names[action]}")
        obs, reward, terminated, truncated, info = env.step(action)
        print(f"      Reward: {reward:+.2f}  |  Terminated: {terminated}  |  Truncated: {truncated}")

        if terminated or truncated:
            print("      Episode ended.")
            break

    print(f"\n  Trade log ({len(env.trade_log)} entries):")
    for t in env.trade_log:
        print(f"    {t}")

    print(f"\n{'=' * 70}")
    print("  Smoke test complete ✓")
    print(f"{'=' * 70}")