"""Did owning a field's AI stocks offset falling hiring in that field?"""

from pathlib import Path

import pandas as pd

import config

RAW = Path(__file__).parent.parent / "data" / "raw"
CHATGPT_LAUNCH = "2022-11-30"


def load_hiring():
    df = pd.read_csv(RAW / "indeed_sectors_us.csv", parse_dates=["date"])
    df = df[df["variable"] == "total postings"]
    wide = df.pivot_table(index="date", columns="display_name", values="indeed_job_postings_index")
    return wide.resample("ME").mean()


def load_prices():
    prices = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True)
    return prices.resample("ME").last()


def field_backtest(field_id, hiring, prices):
    field = config.FIELDS[field_id]
    hire = hiring[field["indeed_sectors"]].mean(axis=1).rename("hiring_index")
    tickers = [t for t in field["hedge_basket"] if t in prices]
    rets = prices[tickers].pct_change()
    basket = (1 + rets.mean(axis=1).fillna(0)).cumprod() * 100
    market = prices["SPY"] / prices["SPY"].iloc[0] * 100
    df = pd.concat([hire, basket.rename("basket"), market.rename("market")], axis=1).dropna()
    return df


def summarize(field_id, df, start=CHATGPT_LAUNCH):
    since = df[df.index >= start]
    first, last = since.iloc[0], since.iloc[-1]
    hiring_chg = last["hiring_index"] / first["hiring_index"] - 1
    basket_ret = last["basket"] / first["basket"] - 1
    market_ret = last["market"] / first["market"] - 1
    # Negative correlation means the basket rose in months when hiring fell
    monthly = since.pct_change().dropna()
    corr = monthly["hiring_index"].corr(monthly["basket"] - monthly["market"])
    return {
        "field": field_id,
        "since": start,
        "hiring_change": round(hiring_chg, 3),
        "basket_return": round(basket_ret, 3),
        "market_return": round(market_ret, 3),
        "basket_vs_market": round(basket_ret - market_ret, 3),
        "hedge_correlation": round(corr, 2),
        "hedge_worked": bool(hiring_chg < 0 and basket_ret > 0),
        "beat_market": bool(basket_ret > market_ret),
    }
