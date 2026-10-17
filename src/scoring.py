"""AI exposure score for each job, built task by task from the Anthropic Economic Index."""

from pathlib import Path

import pandas as pd

import config

AEI = Path(__file__).parent.parent / "data" / "raw" / "aei" / config.AEI_RELEASE


def load_task_signals():
    """One row per task: how much people use AI on it, and how much AI does it outright."""
    usage = pd.read_csv(AEI / "task_pct_v2.csv")
    modes = pd.read_csv(AEI / "automation_vs_augmentation_by_task.csv")
    df = usage.merge(modes, on="task_name", how="left").fillna(0)
    # Automation means AI does the task, augmentation means it helps a person do it
    real = (1 - df["filtered"]).clip(lower=1e-9)
    df["automation_share"] = ((df["directive"] + df["feedback_loop"]) / real).clip(0, 1)
    df["key"] = df["task_name"].str.strip().str.lower()
    return df[["key", "pct", "automation_share"]]


def score_occupation(code, signals, statements):
    tasks = statements[statements["O*NET-SOC Code"] == code].copy()
    tasks["key"] = tasks["Task"].str.strip().str.lower()
    tasks = tasks.merge(signals, on="key", how="left")
    tasks["ai_used"] = tasks["pct"].fillna(0) > 0
    tasks["automation_share"] = tasks["automation_share"].fillna(0)
    # Each task scores 0 if nobody uses AI for it, 50 to 100 if they do,
    # higher when AI is doing the work instead of helping
    tasks["task_score"] = tasks["ai_used"] * (50 + 50 * tasks["automation_share"])
    tasks["level"] = pd.cut(tasks["task_score"], [-1, 0, 70, 101], labels=["Low", "Medium", "High"])
    return tasks[["Task", "Task Type", "ai_used", "automation_share", "task_score", "level"]]


def build_scores():
    signals = load_task_signals()
    statements = pd.read_csv(AEI / "onet_task_statements.csv")
    summary, details = [], []
    for field_id, field in config.FIELDS.items():
        for code, title in field["occupations"].items():
            tasks = score_occupation(code, signals, statements)
            if tasks.empty:
                print(f"No tasks found for {code} {title}")
                continue
            summary.append({
                "field": field_id,
                "code": code,
                "occupation": title,
                "risk_score": round(tasks["task_score"].mean(), 1),
                "tasks_total": len(tasks),
                "tasks_using_ai": int(tasks["ai_used"].sum()),
                "automation_share": round(tasks.loc[tasks["ai_used"], "automation_share"].mean(), 2),
            })
            details.append(tasks.assign(field=field_id, code=code, occupation=title))
    return pd.DataFrame(summary), pd.concat(details, ignore_index=True)
