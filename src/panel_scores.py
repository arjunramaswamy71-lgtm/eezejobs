"""Turns the AI panel's task ratings into one exposure score per job, per AI model.

Scoring follows "GPTs are GPTs": E1 (AI can do it alone) counts 1, E2 (AI with tools) counts 0.5, E0 counts 0.
A job's score is the average over its tasks.
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
PANEL = ROOT / "data" / "raw" / "ai_panel"
POINTS = {"E0": 0.0, "E1": 1.0, "E2": 0.5}
NAMES = {"openai": "GPT", "google": "Gemini", "anthropic": "Claude", "meta": "Llama", "deepseek": "DeepSeek", "xai": "Grok"}


def load_ratings():
    rows = []
    for f in sorted(PANEL.glob("*.jsonl")):
        fam = f.stem
        for line in f.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            rows.append({"fam": fam, "model": r["model"], "low": r["task"].strip().lower(), "label": r["label"]})
    return pd.DataFrame(rows)


def job_scores(tasks):
    """tasks has columns soc and task. Returns one row per job, one column per AI, values 0 to 1."""
    ratings = load_ratings()
    if ratings.empty:
        return pd.DataFrame()
    ratings["points"] = ratings["label"].map(POINTS)
    t = tasks[["soc", "task"]].copy()
    t["low"] = t["task"].str.strip().str.lower()
    t = t.drop_duplicates(["soc", "low"])
    merged = t.merge(ratings, on="low", how="inner")
    out = merged.pivot_table(index="soc", columns="fam", values="points", aggfunc="mean")
    out.columns = [f"panel_{c}" for c in out.columns]
    return out


def models_used():
    ratings = load_ratings()
    if ratings.empty:
        return {}
    return ratings.groupby("fam")["model"].first().to_dict()
