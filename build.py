"""Turns raw data into the tables the website uses. Run after download_data.py."""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent / "src"))
import backtest  # noqa: E402
import config  # noqa: E402
import scoring  # noqa: E402

OUT = Path(__file__).parent / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

summary, details = scoring.build_scores()
summary.to_csv(OUT / "occupation_scores.csv", index=False)
details.to_csv(OUT / "task_scores.csv", index=False)

hiring, prices = backtest.load_hiring(), backtest.load_prices()
rows, series = [], []
for field_id in config.FIELDS:
    df = backtest.field_backtest(field_id, hiring, prices)
    series.append(df.assign(field=field_id))
    rows.append(backtest.summarize(field_id, df))
pd.DataFrame(rows).to_csv(OUT / "backtest_summary.csv", index=False)
pd.concat(series).to_csv(OUT / "backtest_series.csv")

pd.set_option("display.width", 160)
print(summary.to_string(index=False))
print()
print(pd.DataFrame(rows).to_string(index=False))

# All jobs, all sources
import exposure  # noqa: E402

allx = exposure.build_exposure()
allx.to_csv(OUT / "exposure_all_jobs.csv", index=False)
print(f"\nAll jobs scored: {len(allx)}, with 3+ sources: {(allx['sources_used'] >= 3).sum()}")
print(allx[["soc", "title", "exposure_score", "sources_used", "disagreement"]].head(10).to_string(index=False))
print("...")
print(allx[["soc", "title", "exposure_score", "sources_used", "disagreement"]].tail(5).to_string(index=False))
look = allx[allx["soc"].isin(["13-2011", "43-3031", "13-2051", "23-2011", "23-1011", "43-4051", "41-9041"])]
print(look[["title", "exposure_score", "anthropic_claude_pct", "openai_gpt4_pct", "microsoft_copilot_pct", "felten_aioe_pct"]].round(0).to_string(index=False))

# Everything into one SQL database
import database  # noqa: E402

con = database.build()
print("\nDatabase tables:", [r[0] for r in con.execute("SHOW TABLES").fetchall()])
print(con.execute("SELECT COUNT(*) AS jobs, SUM(employment) AS workers, ROUND(SUM(total_pay_billions)) AS pay_b, SUM(employment) FILTER (WHERE high_exposure) AS high_exp_workers, ROUND(SUM(total_pay_billions) FILTER (WHERE high_exposure)) AS high_exp_pay_b FROM wages_at_risk").df().round(0).to_string(index=False))
print(con.execute("SELECT title, ROUND(exposure_score) AS score, employment, ROUND(total_pay_billions,1) AS pay_b FROM wages_at_risk WHERE high_exposure ORDER BY total_pay_billions DESC LIMIT 10").df().to_string(index=False))
con.close()
