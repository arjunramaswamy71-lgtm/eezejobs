"""Trend signals for each stock, from recent price moves, plus an honest test of how well they worked.

Four simple checks, one point each:
  1. Price is above its 200 day average (long term trend is up)
  2. 50 day average is above the 200 day average (trend is getting stronger)
  3. Return over the past 12 months, skipping the latest month, is positive (momentum)
  4. Return over the past 3 months beat the S&P 500 (doing better than the market)
"""

import pandas as pd

LABELS = {4: "Strong uptrend", 3: "Uptrend", 2: "Mixed", 1: "Downtrend", 0: "Downtrend"}
HORIZON = 63  # about 3 months of trading days


def checks(prices, market="SPY"):
    """Daily table of the four checks for every ticker. Columns are (check, ticker)."""
    ma50 = prices.rolling(50).mean()
    ma200 = prices.rolling(200).mean()
    mom = prices.shift(21) / prices.shift(252) - 1
    r3 = prices / prices.shift(63) - 1
    beat = r3.sub(r3[market], axis=0)
    return {
        "above_200": prices > ma200,
        "50_over_200": ma50 > ma200,
        "momentum_12m": mom > 0,
        "beat_market_3m": beat > 0,
    }, ma200.notna() & mom.notna()


def score(prices, market="SPY"):
    parts, valid = checks(prices, market)
    total = sum(p.astype(int) for p in parts.values())
    return total.where(valid), parts


def current(prices, market="SPY"):
    total, parts = score(prices, market)
    last = prices.index[-1]
    out = {}
    for t in prices.columns:
        if t == market or pd.isna(total.at[last, t]):
            continue
        s = int(total.at[last, t])
        out[t] = {"score": s, "label": LABELS[s], "checks": {k: bool(v.at[last, t]) for k, v in parts.items()}}
    return out


def backtest(prices, market="SPY", start="2021-01-01"):
    """Every month, group stocks by signal and see how they did over the next 3 months versus the S&P 500."""
    total, _ = score(prices, market)
    fwd = prices.shift(-HORIZON) / prices - 1
    excess = fwd.sub(fwd[market], axis=0)
    month_ends = prices.index.to_series().groupby(prices.index.to_period("M")).last()
    month_ends = month_ends[(month_ends >= start) & (month_ends <= prices.index[-HORIZON - 1])]
    rows = []
    for d in month_ends:
        for t in prices.columns:
            if t == market:
                continue
            s, e, f = total.at[d, t], excess.at[d, t], fwd.at[d, t]
            if pd.notna(s) and pd.notna(e):
                rows.append({"date": d, "ticker": t, "score": int(s), "fwd": f, "excess": e})
    df = pd.DataFrame(rows)
    df["label"] = df["score"].map(LABELS)
    order = ["Strong uptrend", "Uptrend", "Mixed", "Downtrend"]
    stats = []
    for lab in order:
        g = df[df["label"] == lab]
        if g.empty:
            continue
        stats.append({
            "label": lab,
            "times": len(g),
            "beat_market_pct": int(round(float((g["excess"] > 0).mean()) * 100)),
            "avg_3m_return_pct": round(float(g["fwd"].mean()) * 100, 1),
            "avg_vs_market_pct": round(float(g["excess"].mean()) * 100, 1),
        })
    return {
        "from": df["date"].min().strftime("%B %Y"),
        "to": df["date"].max().strftime("%B %Y"),
        "months": int(df["date"].nunique()),
        "stocks": int(df["ticker"].nunique()),
        "groups": stats,
    }
