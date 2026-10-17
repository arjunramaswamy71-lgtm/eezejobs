"""Writes the small JSON files the website reads into docs/data. Run after build.py."""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent / "src"))
import companies  # noqa: E402
import signals  # noqa: E402

ROOT = Path(__file__).parent
PROC = ROOT / "data" / "processed"
RAW = ROOT / "data" / "raw"
OUT = ROOT / "docs" / "data"
OUT.mkdir(parents=True, exist_ok=True)
START = "2022-11-30"

# Which Indeed hiring sector best tracks each job group
HIRING_SECTORS = [
    ("13-2011", "Accounting"), ("43-3031", "Accounting"), ("13-2", "Banking & Finance"),
    ("23", "Legal"), ("43-6012", "Legal"), ("43-4051", "Customer Service"), ("41-9041", "Customer Service"),
    ("43-4", "Administrative Assistance"), ("43-6", "Administrative Assistance"), ("43", "Administrative Assistance"),
    ("15-12", "Software Development"), ("15-2", "Data & Analytics"), ("13-1161", "Marketing"), ("11-2", "Marketing"),
    ("13-1071", "Human Resources"), ("13-1141", "Human Resources"), ("11-3121", "Human Resources"),
    ("13-1082", "Project Management"), ("13-1", "Management"), ("11", "Management"),
    ("27-3", "Media & Communications"), ("27-1", "Arts & Entertainment"), ("25", "Education & Instruction"),
    ("29-1141", "Nursing"), ("29-2", "Medical Technician"), ("29-1", "Physicians & Surgeons"),
    ("31", "Personal Care & Home Health"), ("19", "Scientific Research & Development"), ("17-2", "Civil Engineering"),
    ("41-2", "Retail"), ("41", "Sales"), ("35", "Food Preparation & Service"), ("47", "Construction"),
    ("49", "Installation & Maintenance"), ("51", "Production & Manufacturing"), ("53-3", "Driving"),
    ("53-7", "Loading & Stocking"), ("33", "Security & Public Safety"), ("37", "Cleaning & Sanitation"),
    ("21", "Community & Social Service"), ("39-9011", "Childcare"), ("13-2053", "Insurance"),
]


def hiring_sector(soc):
    best = None
    for prefix, sector in HIRING_SECTORS:
        if soc.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, sector)
    return best[1] if best else None


def task_bucket(row):
    if row["gpt4_exposure"] == "E1" or (row["claude_used"] and row["claude_automation_share"] >= 0.5):
        return "can"
    if row["gpt4_exposure"] == "E2" or row["human_exposure"] in ("E1", "E2") or row["claude_used"]:
        return "helps"
    return "you"


def r(x, n=1):
    return None if pd.isna(x) else round(float(x), n)


jobs = pd.read_csv(PROC / "jobs.csv", dtype={"soc": str})
tasks = pd.read_csv(PROC / "tasks.csv", dtype={"soc": str})
# Some jobs have several O*NET versions (like nurse specialties). Keep the main one so tasks aren't repeated.
tasks["is_main"] = tasks["onet_code"].str.endswith(".00")
main_code = tasks.sort_values(["soc", "is_main", "onet_code"], ascending=[True, False, True]).groupby("soc")["onet_code"].first()
tasks = tasks[tasks["onet_code"] == tasks["soc"].map(main_code)].drop_duplicates(["soc", "task"])
tasks["bucket"] = tasks.apply(task_bucket, axis=1)
prices = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True)
hiring = pd.read_csv(RAW / "indeed_sectors_us.csv", parse_dates=["date"])
hiring = hiring[hiring["variable"] == "total postings"].pivot_table(
    index="date", columns="display_name", values="indeed_job_postings_index").resample("ME").mean()

# Monthly prices since ChatGPT launch, every series starts at 1000 dollars
monthly = prices.resample("ME").last()
monthly = monthly[monthly.index >= START]
grow = monthly / monthly.iloc[0] * 1000
year_ago = prices.index[-1] - pd.Timedelta(days=365)

# Companies
comp_rows = []
for tk, name, what, groups, site in companies.SELLERS:
    row = {"ticker": tk, "name": name, "what": what, "groups": groups, "site": site, "public": True}
    if tk in prices and prices[tk].dropna().size:
        p = prices[tk].dropna()
        row["since_chatgpt"] = r(p.iloc[-1] / p[p.index >= START].iloc[0] - 1, 3)
        row["one_year"] = r(p.iloc[-1] / p[p.index >= year_ago].iloc[0] - 1, 3)
        row["price"] = r(p.iloc[-1], 2)
    comp_rows.append(row)
for name, what, groups, backer, site in companies.PRIVATE:
    comp_rows.append({"ticker": None, "name": name, "what": what, "groups": groups, "site": site,
                      "public": False, "backer": backer})

# Trend signals from recent price moves, and how well they worked in the past
sig_now = signals.current(prices)
for row in comp_rows:
    if row.get("ticker") in sig_now:
        row["signal"] = sig_now[row["ticker"]]

# Jobs, with matched companies and a simple backtest
job_rows, task_map = [], {}
for _, j in jobs.iterrows():
    soc = j["soc"]
    jt = tasks[tasks["soc"] == soc]
    counts = jt["bucket"].value_counts().to_dict()
    matches = []
    for c in comp_rows:
        score = companies.match(c["groups"], soc)
        if score:
            matches.append((score, c["public"], c["ticker"] or c["name"]))
    matches.sort(key=lambda m: (-m[0], not m[1]))
    specific = [m[2] for m in matches if m[0] > 1 and m[1]]
    basket = specific or [m[2] for m in matches if m[1] and m[2] in ("MSFT", "GOOGL", "AMZN")]
    basket = [t for t in basket if t in grow]
    sector = hiring_sector(soc)
    job_rows.append({
        "soc": soc, "title": j["title"], "score": r(j["exposure_score"]),
        "sources": int(j["sources_used"]), "spread": r(j["disagreement"]),
        "src": {k: r(j[f"{k}_pct"], 0) for k in
                ["anthropic_claude", "microsoft_copilot", "openai_gpt4", "openai_human", "felten_aioe"]},
        "workers": None if pd.isna(j["employment"]) else int(j["employment"]),
        "median_pay": None if pd.isna(j["median_wage"]) else int(j["median_wage"]),
        "tasks": {"can": counts.get("can", 0), "helps": counts.get("helps", 0), "you": counts.get("you", 0)},
        "companies": [m[2] for m in matches],
        "basket": basket,
        "sector": sector if sector in hiring else None,
    })
    task_map[soc] = [[t["task"], t["bucket"], 1 if t["task_type"] == "Core" else 0] for _, t in jt.iterrows()]

# All public companies for the employer search
sec = []
if (RAW / "sec_companies.csv").exists():
    s = pd.read_csv(RAW / "sec_companies.csv", dtype={"ticker": str}).dropna(subset=["title", "ticker"]).drop_duplicates("cik_str")
    sec = [[row.title, row.ticker, int(row.cik_str)] for row in s.itertuples()]


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False))
    print(f"{name}: {(OUT / name).stat().st_size / 1e3:.0f} KB")


dump("jobs.json", job_rows)
# Shared monthly series: dollars from 1000 for each ticker, hiring index from 100 for each sector
h = hiring.reindex(grow.index)
dump("series.json", {
    "dates": [d.strftime("%Y-%m") for d in grow.index],
    "prices": {t: [r(v, 0) for v in grow[t]] for t in grow.columns if grow[t].notna().any()},
    "hiring": {c: [r(v, 1) for v in (h[c] / h[c].dropna().iloc[0] * 100)] for c in h.columns if h[c].notna().any()},
})
dump("tasks.json", task_map)
dump("companies.json", comp_rows)
dump("employers.json", sec)
dump("signals.json", signals.backtest(prices))
dump("meta.json", {
    "updated": prices.index[-1].strftime("%B %-d, %Y") if sys.platform != "win32" else prices.index[-1].strftime("%B %#d, %Y"),
    "jobs": len(job_rows),
    "workers_high": int(jobs.loc[jobs["exposure_score"] >= 75, "employment"].sum()),
    "workers_total": int(jobs["employment"].sum()),
})
