"""Combines AI exposure from several sources into one score for every job."""

from pathlib import Path

import pandas as pd

import config
import scoring

RAW = Path(__file__).parent.parent / "data" / "raw"
EXP = RAW / "exposure"

# Source name, what it measures, and who made it
SOURCES = {
    "anthropic_claude": "Real Claude usage across job tasks (Anthropic Economic Index)",
    "openai_gpt4": "GPT-4 rating of which tasks GPT can speed up (Eloundou et al.)",
    "openai_human": "Human expert rating of the same tasks (Eloundou et al.)",
    "microsoft_copilot": "Real Bing Copilot usage across job tasks (Tomlinson et al.)",
    "felten_aioe": "AI benchmark progress mapped to job abilities (Felten, Raj, Seamans)",
}


def soc6(code):
    """Turn an O*NET code like 13-2011.01 into the 6 digit SOC 13-2011."""
    return str(code).strip()[:7]


def anthropic_scores():
    signals = scoring.load_task_signals()
    tasks = pd.read_csv(scoring.AEI / "onet_task_statements.csv")
    tasks["key"] = tasks["Task"].str.strip().str.lower()
    tasks = tasks.merge(signals, on="key", how="left")
    used = tasks["pct"].fillna(0) > 0
    tasks["task_score"] = used * (50 + 50 * tasks["automation_share"].fillna(0))
    tasks["soc"] = tasks["O*NET-SOC Code"].map(soc6)
    return tasks.groupby("soc")["task_score"].mean().rename("anthropic_claude")


def openai_scores():
    df = pd.read_csv(EXP / "openai_occ_level.csv")
    df["soc"] = df["O*NET-SOC Code"].map(soc6)
    out = df.groupby("soc")[["dv_rating_beta", "human_rating_beta"]].mean()
    return out.rename(columns={"dv_rating_beta": "openai_gpt4", "human_rating_beta": "openai_human"})


def microsoft_scores():
    df = pd.read_csv(EXP / "microsoft_ai_applicability.csv")
    df["soc"] = df["SOC Code"].map(soc6)
    return df.groupby("soc")["ai_applicability_score"].mean().rename("microsoft_copilot")


def felten_scores():
    df = pd.read_excel(EXP / "felten_aioe.xlsx", sheet_name="Appendix A")
    df["soc"] = df["SOC Code"].map(soc6)
    return df.groupby("soc")["AIOE"].mean().rename("felten_aioe")


def job_titles():
    tasks = pd.read_csv(scoring.AEI / "onet_task_statements.csv")
    tasks["soc"] = tasks["O*NET-SOC Code"].map(soc6)
    # Use the plain title for codes ending in .00, otherwise the first one listed
    tasks["is_main"] = tasks["O*NET-SOC Code"].str.endswith(".00")
    tasks = tasks.sort_values(["soc", "is_main"], ascending=[True, False])
    return tasks.groupby("soc")["Title"].first().rename("title")


def build_exposure():
    raw = pd.concat(
        [job_titles(), anthropic_scores(), openai_scores(), microsoft_scores(), felten_scores()],
        axis=1,
    )
    raw = raw[raw["title"].notna()]
    sources = list(SOURCES)
    # Each source uses a different scale, so compare jobs by percentile, 0 to 100
    pct = raw[sources].rank(pct=True) * 100
    pct.columns = [f"{c}_pct" for c in sources]
    out = pd.concat([raw, pct], axis=1)
    pcols = list(pct.columns)
    out["sources_used"] = out[pcols].notna().sum(axis=1)
    out["exposure_score"] = out[pcols].mean(axis=1).round(1)
    # High spread means the sources disagree about this job
    out["disagreement"] = out[pcols].std(axis=1).round(1)
    out.index.name = "soc"
    return out.reset_index().sort_values("exposure_score", ascending=False)
