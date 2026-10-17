"""Combines AI exposure from several sources into one score for every job."""

from pathlib import Path

import pandas as pd

import config
import panel_scores
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
    "ai_panel": "Our own panel: 5 AI models rated every task (GPT, Gemini, Claude, Llama, DeepSeek)",
}


def soc6(code):
    """Turn an O*NET code like 13-2011.01 into the 6 digit SOC 13-2011."""
    return str(code).strip()[:7]


def load_crosswalk():
    """Map old 2010 job codes to the 2018 codes. Returns an empty map if the file isn't downloaded."""
    path = RAW / "soc_crosswalk.xlsx"
    if not path.exists():
        print("Job code converter missing, run download_data.py")
        return {}
    raw = pd.read_excel(path, header=None, dtype=str)
    head = raw.index[raw.apply(lambda r: r.str.contains("2010 SOC Code", na=False).any(), axis=1)][0]
    df = raw.iloc[head + 1:].copy()
    df.columns = raw.iloc[head].str.strip()
    old = [c for c in df.columns if "2010" in str(c) and "Code" in str(c)][0]
    new = [c for c in df.columns if "2018" in str(c) and "Code" in str(c)][0]
    df = df[[old, new]].dropna()
    out = {}
    for a, b in zip(df[old].str.strip(), df[new].str.strip()):
        out.setdefault(a, []).append(b)
    return out


XWALK = None


def to2018(df, col="soc"):
    """Rewrite a table's 2010 codes as 2018 codes. One old code can split into several new ones."""
    global XWALK
    if XWALK is None:
        XWALK = load_crosswalk()
    if not XWALK:
        return df
    df = df.copy()
    df[col] = df[col].map(lambda c: XWALK.get(c, [c]))
    return df.explode(col)


def anthropic_scores():
    signals = scoring.load_task_signals()
    tasks = pd.read_csv(scoring.AEI / "onet_task_statements.csv")
    tasks["key"] = tasks["Task"].str.strip().str.lower()
    tasks = tasks.merge(signals, on="key", how="left")
    used = tasks["pct"].fillna(0) > 0
    tasks["task_score"] = used * (50 + 50 * tasks["automation_share"].fillna(0))
    tasks["soc"] = tasks["O*NET-SOC Code"].map(soc6)
    tasks = to2018(tasks)
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
    df = to2018(df)
    return df.groupby("soc")["AIOE"].mean().rename("felten_aioe")


def job_titles():
    new = pd.read_csv(EXP / "openai_occ_level.csv")
    new["soc"] = new["O*NET-SOC Code"].map(soc6)
    new["is_main"] = new["O*NET-SOC Code"].str.endswith(".00")
    new = new.sort_values(["soc", "is_main"], ascending=[True, False]).groupby("soc")["Title"].first()
    tasks = pd.read_csv(scoring.AEI / "onet_task_statements.csv")
    tasks["soc"] = tasks["O*NET-SOC Code"].map(soc6)
    tasks = to2018(tasks)
    # Use the plain title for codes ending in .00, otherwise the first one listed
    tasks["is_main"] = tasks["O*NET-SOC Code"].str.endswith(".00")
    tasks = tasks.sort_values(["soc", "is_main"], ascending=[True, False])
    old = tasks.groupby("soc")["Title"].first()
    return new.combine_first(old).rename("title")


def panel_by_job():
    """The AI panel's score for each job, one column per model, plus their average."""
    tasks = pd.read_csv(scoring.AEI / "onet_task_statements.csv")
    tasks["soc"] = tasks["O*NET-SOC Code"].map(soc6)
    tasks = to2018(tasks).rename(columns={"Task": "task"})
    out = panel_scores.job_scores(tasks)
    if out.empty:
        return out
    out["ai_panel"] = out.mean(axis=1)
    return out


def build_exposure():
    panel = panel_by_job()
    raw = pd.concat(
        [job_titles(), anthropic_scores(), openai_scores(), microsoft_scores(), felten_scores(), panel],
        axis=1,
    )
    raw = raw[raw["title"].notna()]
    sources = [k for k in SOURCES if k in raw]
    # Each panel model also gets its own percentile, for the "do the AIs agree" view
    for c in [c for c in raw.columns if c.startswith("panel_")]:
        raw[f"{c}_pct"] = raw[c].rank(pct=True) * 100
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
