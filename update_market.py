"""Weekly refresh of the market parts of the website: stock prices, trend signals, growth charts and hiring.

Leaves the job scores, tasks and AI ratings alone (those only change when the research is rebuilt).
Run after:  python download_data.py prices indeed "sec company"
Then:       python update_market.py
"""

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "src"))
import companies  # noqa: E402
import signals  # noqa: E402

RAW = ROOT / "data" / "raw"
OUT = ROOT / "docs" / "data"
START = "2022-11-30"


def r(x, n=2):
    return None if pd.isna(x) else round(float(x), n)


def load(name):
    return json.loads((OUT / name).read_text())


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False))
    print(f"updated {name}")


prices = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True)
year_ago = prices.index[-1] - pd.Timedelta(days=365)

# Companies: latest price, change since ChatGPT and over a year, and today's trend signal
sig_now = signals.current(prices)
comp = load("companies.json")
for row in comp:
    tk = row.get("ticker")
    if tk and tk in prices and prices[tk].dropna().size:
        p = prices[tk].dropna()
        row["since_chatgpt"] = r(p.iloc[-1] / p[p.index >= START].iloc[0] - 1, 3)
        row["one_year"] = r(p.iloc[-1] / p[p.index >= year_ago].iloc[0] - 1, 3)
        row["price"] = r(p.iloc[-1], 2)
    if tk in sig_now:
        row["signal"] = sig_now[tk]
dump("companies.json", comp)

# How well the signals worked in the past, with this week's data included
dump("signals.json", signals.backtest(prices))

# Monthly growth of $1,000 since ChatGPT, and the hiring index for each sector
monthly = prices.resample("ME").last()
monthly = monthly[monthly.index >= START]
grow = monthly / monthly.iloc[0] * 1000
series = {"dates": [d.strftime("%Y-%m") for d in grow.index],
          "prices": {t: [r(v, 0) for v in grow[t]] for t in grow.columns if grow[t].notna().any()}}
hiring_path = RAW / "indeed_sectors_us.csv"
if hiring_path.exists():
    hiring = pd.read_csv(hiring_path, parse_dates=["date"])
    hiring = hiring[hiring["variable"] == "total postings"].pivot_table(
        index="date", columns="display_name", values="indeed_job_postings_index").resample("ME").mean()
    h = hiring.reindex(grow.index)
    series["hiring"] = {c: [r(v, 1) for v in (h[c] / h[c].dropna().iloc[0] * 100)] for c in h.columns if h[c].notna().any()}
else:
    series["hiring"] = load("series.json").get("hiring", {})
dump("series.json", series)

# Employer search list
sec_path = RAW / "sec_companies.csv"
if sec_path.exists():
    s = pd.read_csv(sec_path, dtype={"ticker": str}).dropna(subset=["title", "ticker"]).drop_duplicates("cik_str")
    dump("employers.json", [[row.title, row.ticker, int(row.cik_str)] for row in s.itertuples()])

# The "data last updated" date in the footer
meta = load("meta.json")
d = prices.index[-1]
meta["updated"] = f"{d:%B} {d.day}, {d.year}"
dump("meta.json", meta)
print(f"Market data now runs to {meta['updated']}")
