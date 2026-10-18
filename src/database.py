"""Loads every dataset into one DuckDB database so the whole project can be queried with SQL."""

from pathlib import Path

import os

import duckdb
import pandas as pd

import config
import exposure
import scoring

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
DB_PATH = Path(os.environ.get("EEZEJOBS_DB", ROOT / "data" / "eezejobs.duckdb"))


def jobs_table():
    jobs = exposure.build_exposure()
    oews = pd.read_csv(RAW / "oews_national.csv", low_memory=False)
    oews = oews[oews["O_GROUP"] == "detailed"]
    cols = {"OCC_CODE": "soc", "OCC_TITLE": "bls_title", "TOT_EMP": "employment", "A_MEAN": "mean_wage", "A_MEDIAN": "median_wage"}
    oews = oews[list(cols)].rename(columns=cols)
    # BLS marks hidden values with symbols like * or #, treat them as missing
    for c in ["employment", "mean_wage", "median_wage"]:
        oews[c] = pd.to_numeric(oews[c], errors="coerce")
    jobs = jobs.merge(oews, on="soc", how="left")
    # O*NET splits some BLS jobs into narrower ones, so prefer the BLS name when there is one
    jobs["title"] = jobs["bls_title"].fillna(jobs["title"])
    return jobs.drop(columns="bls_title")


def tasks_table():
    statements = pd.read_csv(scoring.AEI / "onet_task_statements.csv")
    statements["key"] = statements["Task"].str.strip().str.lower()
    tasks = statements.merge(scoring.load_task_signals(), on="key", how="left")
    cols = ["gpt4_exposure", "human_exposure_agg", "gpt4_automation"]
    gpt = pd.read_csv(exposure.EXP / "openai_full_labelset.tsv", sep="\t",
                      usecols=["Task ID", "Task"] + cols)
    gpt["key"] = gpt["Task"].str.strip().str.lower()
    # Match OpenAI ratings by task ID first, then by task wording,
    # since O*NET renumbers some tasks between versions
    by_id = tasks[["Task ID"]].merge(gpt.drop_duplicates("Task ID")[["Task ID"] + cols], on="Task ID", how="left")
    by_text = tasks[["key"]].merge(gpt.drop_duplicates("key")[["key"] + cols], on="key", how="left")
    for c in cols:
        tasks[c] = by_id[c].values
        tasks[c] = tasks[c].fillna(pd.Series(by_text[c].values, index=tasks.index))
    tasks["soc"] = tasks["O*NET-SOC Code"].map(exposure.soc6)
    tasks = exposure.to2018(tasks)
    return tasks.rename(columns={
        "O*NET-SOC Code": "onet_code", "Title": "title", "Task ID": "task_id", "Task": "task",
        "Task Type": "task_type", "pct": "claude_usage_pct", "automation_share": "claude_automation_share",
    })[["soc", "onet_code", "title", "task_id", "task", "task_type", "claude_usage_pct",
        "claude_automation_share", "gpt4_exposure", "human_exposure_agg", "gpt4_automation"]]


def hiring_table():
    df = pd.read_csv(RAW / "indeed_sectors_us.csv", parse_dates=["date"])
    df = df[df["variable"] == "total postings"]
    return df.rename(columns={"display_name": "sector", "indeed_job_postings_index": "postings_index"})[
        ["date", "sector", "postings_index"]]


def prices_table():
    wide = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True)
    wide.index.name = "date"
    return wide.reset_index().melt(id_vars="date", var_name="ticker", value_name="close").dropna()


def baskets_table():
    rows = []
    for field_id, field in config.FIELDS.items():
        for ticker, why in field["hedge_basket"].items():
            rows.append({"field": field_id, "ticker": ticker, "reason": why})
    return pd.DataFrame(rows)


def build():
    tables = {
        "jobs": jobs_table(),
        "tasks": tasks_table(),
        "hiring": hiring_table(),
        "prices": prices_table(),
        "hedge_baskets": baskets_table(),
    }
    con = duckdb.connect(str(DB_PATH))
    for name, df in tables.items():
        con.register("tmp", df)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM tmp")
        con.unregister("tmp")
    # Views written in plain SQL live in the sql folder
    for f in sorted((ROOT / "sql").glob("*.sql")):
        con.execute(f.read_text())
    return con
