"""Finds nearby jobs: ones whose tasks look a lot like yours, pay about the same or more, and are less exposed to AI.

Similarity is TF-IDF on each job's task descriptions, compared with cosine similarity.
Written with numpy only so it runs anywhere.
"""

import re
from pathlib import Path

import numpy as np
import pandas as pd

STOP = set("""a an and or the of to for in on at by with from as into onto over under about such other
these those this that their them they it its be is are was were been being do does done using use used
may might must can could would should will including include includes etc per via within without
all any each some more most such than then also only own same so very new one two""".split())


def tokens(text):
    words = re.findall(r"[a-z]+", text.lower())
    out = []
    for w in words:
        if len(w) < 3 or w in STOP:
            continue
        for suffix in ("ing", "ions", "ion", "es", "s", "ed"):
            if w.endswith(suffix) and len(w) - len(suffix) >= 4:
                w = w[: -len(suffix)]
                break
        out.append(w)
    return out


def similarity(tasks):
    """tasks has columns soc and task. Returns (list of socs, similarity matrix)."""
    docs = tasks.groupby("soc")["task"].apply(lambda s: " ".join(s.drop_duplicates()))
    socs = list(docs.index)
    vocab, rows = {}, []
    for text in docs:
        counts = {}
        for w in tokens(text):
            idx = vocab.setdefault(w, len(vocab))
            counts[idx] = counts.get(idx, 0) + 1
        rows.append(counts)
    m = np.zeros((len(rows), len(vocab)), dtype=np.float32)
    for i, counts in enumerate(rows):
        for j, c in counts.items():
            m[i, j] = 1 + np.log(c)
    df = (m > 0).sum(axis=0)
    m *= np.log((1 + len(rows)) / (1 + df)) + 1
    m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-9
    return socs, m @ m.T


def safer_jobs(jobs, tasks, top=4, min_drop=10, pay_floor=0.85):
    """For each job, nearby jobs with lower AI exposure and similar or better pay."""
    socs, sim = similarity(tasks)
    pos = {s: i for i, s in enumerate(socs)}
    info = jobs.set_index("soc")
    out = {}
    for s in socs:
        if s not in info.index:
            continue
        me = info.loc[s]
        order = np.argsort(-sim[pos[s]])
        picks = []
        for k in order[1:80]:
            other = socs[k]
            if other not in info.index or sim[pos[s], k] < 0.12:
                continue
            o = info.loc[other]
            if o["exposure_score"] > me["exposure_score"] - min_drop:
                continue
            if pd.notna(me["median_wage"]) and (pd.isna(o["median_wage"]) or o["median_wage"] < pay_floor * me["median_wage"]):
                continue
            picks.append([other, round(float(sim[pos[s], k]), 2)])
            if len(picks) == top:
                break
        out[s] = picks
    return out


ONET = Path(__file__).parent.parent / "data" / "raw" / "onet"
TIER_BONUS = {"Primary-Short": 0.15, "Primary-Long": 0.10, "Supplemental": 0.05}


def _read(name):
    return pd.read_csv(ONET / name, sep="\t", dtype=str)


def skill_profiles():
    """One row per job, one column per skill or knowledge area, value = how important it is (1 to 5)."""
    parts = []
    for f in ["Skills.txt", "Knowledge.txt", "Work Activities.txt"]:
        if not (ONET / f).exists():
            continue
        df = _read(f)
        df = df[df["Scale ID"] == "IM"]
        df["value"] = pd.to_numeric(df["Data Value"], errors="coerce")
        parts.append(df[["O*NET-SOC Code", "Element Name", "value"]])
    df = pd.concat(parts)
    df["soc"] = df["O*NET-SOC Code"].str[:7]
    return df.pivot_table(index="soc", columns="Element Name", values="value", aggfunc="mean").fillna(1)


def job_zones():
    df = _read("Job Zones.txt")
    df["soc"] = df["O*NET-SOC Code"].str[:7]
    df["zone"] = pd.to_numeric(df["Job Zone"], errors="coerce")
    return df.groupby("soc")["zone"].min()


def related_pairs():
    df = _read("Related Occupations.txt")
    df["a"] = df["O*NET-SOC Code"].str[:7]
    df["b"] = df["Related O*NET-SOC Code"].str[:7]
    tier = "Relatedness Tier" if "Relatedness Tier" in df else df.columns[2]
    out = {}
    for a, b, t in zip(df["a"], df["b"], df[tier]):
        if a != b:
            out[(a, b)] = max(out.get((a, b), 0), TIER_BONUS.get(t, 0.05))
    return out


def safer_jobs_onet(jobs, top=4, min_drop=10, pay_floor=0.85):
    """Nearby jobs using O*NET's official related jobs list plus shared skills and education level."""
    prof = skill_profiles()
    centered = prof.sub(prof.mean(axis=1), axis=0)
    unit = centered.div(np.linalg.norm(centered.values, axis=1) + 1e-9, axis=0)
    sim = pd.DataFrame(unit.values @ unit.values.T, index=prof.index, columns=prof.index)
    zones, related = job_zones(), related_pairs()
    info = jobs.set_index("soc")
    out = {}
    for s in info.index:
        if s not in sim.index:
            out[s] = []
            continue
        me = info.loc[s]
        my_zone = zones.get(s, 3)
        cands = set(sim.loc[s].nlargest(40).index) | {b for (a, b) in related if a == s}
        scored = []
        for o in cands:
            if o == s or o not in info.index or o not in sim.index:
                continue
            x = info.loc[o]
            if "All Other" in str(x["title"]):
                continue
            bonus = related.get((s, o), 0)
            # Only jobs that need the same or less training, so the switch is realistic
            if zones.get(o, 3) > my_zone:
                continue
            # Skip tiny jobs with few openings
            if pd.isna(x["employment"]) or x["employment"] < 10000:
                continue
            if x["exposure_score"] > me["exposure_score"] - min_drop:
                continue
            if pd.notna(me["median_wage"]) and (pd.isna(x["median_wage"]) or x["median_wage"] < pay_floor * me["median_wage"]):
                continue
            score = float(sim.at[s, o]) + bonus
            if bonus == 0 and sim.at[s, o] < 0.72:
                continue
            both = prof.loc[[s, o]].min().drop(labels=["English Language"], errors="ignore")
            shared = [k for k in both.sort_values(ascending=False).index[:3] if both[k] >= 3]
            scored.append((score, o, bonus > 0, shared))
        scored.sort(reverse=True)
        out[s] = [[o, round(sc, 2), int(rel), shared] for sc, o, rel, shared in scored[:top]]
    return out
