"""Implied Automation: the pipeline that ties the eight languages together.

  python quant/run_q.py              1. q/kdb+     point-in-time panel of prices and SEC fundamentals
  python quant/pipeline.py ocaml     2. OCaml      reverse DCF: the growth each AI stock prices in
  python quant/pipeline.py apl       3. APL        spread that AI revenue over the 809 jobs
  python quant/pipeline.py stan      4. Stan + R   Bayesian estimate of the automation really happening
  python quant/pipeline.py gap       5. R          does the gap between the two predict the stocks?
  julia -t auto quant/julia/careers.jl  6. Julia   hazard curves and Monte Carlo careers
  python quant/pipeline.py haskell   7. Haskell    price career insurance with a contract language
  python quant/pipeline.py octave    8. Octave     best hedge for every job
  python quant/pipeline.py export    write docs/data/implied.json for the website

`python quant/pipeline.py all` runs steps 2 to 8 and the export, skipping any tool that isn't installed.
"""

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
Q = ROOT / "quant"
OUT = Q / "out"
OUT.mkdir(exist_ok=True)
RAW = ROOT / "data" / "raw"
sys.path.insert(0, str(ROOT / "src"))
import companies  # noqa: E402

HORIZONS = [1, 3, 5, 10]
CAPTURE = [0.15, 0.3, 0.5]    # for every $1 of pay AI replaces, AI sellers earn this much: low, central, high
CENTRAL = 0.3
# Share of each company's extra AI revenue that comes from doing work people are paid for.
# Chips (NVDA) are left out so the same AI spending isn't counted twice. Cloud capacity (AMZN, ORCL),
# ads and consumer apps (GOOGL, META) count for less than workplace software (MSFT) and AI services (IBM).
LABOR_SHARE = {"NVDA": 0.0, "META": 0.1, "AMZN": 0.2, "ORCL": 0.2, "GOOGL": 0.25, "MSFT": 0.5, "IBM": 0.8}


def run(cmd, **kw):
    print("$", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], cwd=ROOT, check=True, **kw)


def have(tool):
    return shutil.which(tool) is not None


# ---------- shared inputs ----------
def jobs_table():
    j = pd.read_csv(ROOT / "data" / "processed" / "jobs.csv", dtype={"soc": str})
    j = j[j["exposure_score"].notna()].copy()
    j["wage"] = j["median_wage"].fillna(j["mean_wage"])
    j = j[j["employment"].notna() & j["wage"].notna() & (j["employment"] > 0)].reset_index(drop=True)
    j["pool_bn"] = j["employment"] * j["wage"] / 1e9
    return j


def weights(jobs, syms):
    """Company x job weights: wage pool times AI exposure wherever the company's AI does that kind of work."""
    groups = {s[0]: s[3] for s in companies.SELLERS}
    W = np.zeros((len(syms), len(jobs)))
    for i, s in enumerate(syms):
        fit = np.array([companies.match(groups.get(s, []), soc) > 0 for soc in jobs["soc"]])
        W[i] = fit * jobs["pool_bn"].to_numpy() * jobs["exposure_score"].to_numpy() / 100
    return W


def ai_revenue():
    a = pd.read_csv(OUT / "ai_revenue.csv", parse_dates=["date"])
    a["labor"] = a["sym"].map(LABOR_SHARE).fillna(1.0)
    return a


# ---------- 2. OCaml ----------
def step_ocaml():
    exe = Q / "ocaml" / ("reverse_dcf.exe" if sys.platform == "win32" else "reverse_dcf")
    run(["ocamlopt", Q / "ocaml" / "reverse_dcf.ml", "-o", exe])
    run([exe, OUT])


# ---------- 3. APL ----------
def step_apl():
    jobs = jobs_table()
    a = ai_revenue()
    syms = sorted(s for s in a["sym"].unique() if LABOR_SHARE.get(s, 1.0) > 0)
    W = weights(jobs, syms)
    keep = W.sum(axis=1) > 0
    syms = [s for s, k in zip(syms, keep) if k]
    W = W[keep]
    cols = [f"ai_rev_{h}y" for h in HORIZONS]

    def rmatrix(frame):
        f = frame.set_index("sym").reindex(syms)
        R = (f[cols].clip(lower=0).fillna(0).to_numpy() * f["labor"].fillna(1.0).to_numpy()[:, None]) / 1e9
        return np.round(R, 4).tolist()

    dates = sorted(a["date"].unique())
    latest = a[a["date"] == dates[-1]]
    runs = [{"id": f"latest_{k}", "R": rmatrix(latest), "k": k} for k in CAPTURE]
    runs += [{"id": f"m_{pd.Timestamp(d):%Y-%m-%d}", "R": rmatrix(a[a["date"] == d]), "k": CENTRAL} for d in dates]
    payload = {"W": np.round(W, 5).tolist(), "P": np.round(jobs["pool_bn"].to_numpy(), 5).tolist(), "runs": runs}
    (OUT / "apl_input.json").write_text(json.dumps(payload))
    if not (Q / "node_modules" / "apl").exists():
        run(["npm", "install", "--prefix", Q], shell=sys.platform == "win32")
    run(["node", Q / "apl" / "run_apl.js", OUT], env={**__import__("os").environ, "NODE_PATH": str(Q / "node_modules")})
    res = json.loads((OUT / "apl_output.json").read_text())

    lat = jobs[["soc", "wage", "employment", "pool_bn", "exposure_score"]].copy()   # no titles: they contain commas
    for k, tag in zip(CAPTURE, ["hi", "mid", "lo"]):          # a lower capture rate means more pay replaced
        m = np.array(res[f"latest_{k}"])
        for i, h in enumerate(HORIZONS):
            lat[f"a{h}" if tag == "mid" else f"a{h}_{tag}"] = m[:, i]
    lat["date"] = f"{pd.Timestamp(dates[-1]):%Y-%m-%d}"
    lat.to_csv(OUT / "automation_latest.csv", index=False, float_format="%.6g")
    rows = []
    for d in dates:
        m = np.array(res[f"m_{pd.Timestamp(d):%Y-%m-%d}"])
        df = pd.DataFrame(m, columns=[f"a{h}" for h in HORIZONS])
        df.insert(0, "date", f"{pd.Timestamp(d):%Y-%m-%d}")
        df.insert(0, "soc", jobs["soc"])
        rows.append(df)
    pd.concat(rows).to_csv(OUT / "automation_monthly.csv", index=False, float_format="%.6g")
    pd.DataFrame(W, index=syms, columns=jobs["soc"]).to_csv(OUT / "weights.csv", float_format="%.6g")
    tot = (lat["a5"] * lat["pool_bn"]).sum()
    print(f"Market-implied pay automated within 5 years (central): ${tot:,.0f}bn, "
          f"{tot / lat['pool_bn'].sum():.1%} of the ${lat['pool_bn'].sum() / 1000:,.1f}tn pay in these jobs")


# ---------- 4. Stan + R ----------
def oews(path):
    d = pd.read_csv(path, dtype=str)
    d.columns = [c.upper() for c in d.columns]
    if "O_GROUP" in d:
        d = d[d["O_GROUP"].str.lower() == "detailed"]
    d = d[["OCC_CODE", "TOT_EMP"]].copy()
    d["TOT_EMP"] = pd.to_numeric(d["TOT_EMP"].str.replace(",", ""), errors="coerce")
    return d.dropna().drop_duplicates("OCC_CODE").set_index("OCC_CODE")["TOT_EMP"]


def step_stan():
    e22 = oews(RAW / "oews_2022.csv")
    e25 = oews(RAW / "oews_national.csv")
    j = pd.read_csv(ROOT / "data" / "processed" / "jobs.csv", dtype={"soc": str})
    usage_cols = [c for c in ["anthropic_claude_pct", "microsoft_copilot_pct"] if c in j]
    j["usage"] = j[usage_cols].mean(axis=1) / 100
    d = j[["soc", "usage"]].dropna().copy()
    d["e22"] = d["soc"].map(e22)
    d["e25"] = d["soc"].map(e25)
    d = d[(d["e22"] >= 1000) & (d["e25"] >= 1000)].copy()
    d["y"] = np.log(d["e25"] / d["e22"])
    d["family"] = d["soc"].str[:2]
    d["w"] = (d["e22"] / d["e22"].median()).clip(0.2, 20)
    d[["soc", "family", "y", "usage", "w"]].to_csv(OUT / "realized_input.csv", index=False)
    print(f"{len(d)} jobs with employment in both May 2022 and May 2025")
    run(["Rscript", Q / "R" / "realized.R"])


# ---------- 5. R gap test ----------
def step_gap():
    a = ai_revenue()
    a = a[a["sym"].map(LABOR_SHARE).fillna(1.0) > 0]
    a["uplift"] = a["ai_rev_5y"] / a["revenue"]
    W = pd.read_csv(OUT / "weights.csv", index_col=0)
    real = pd.read_csv(OUT / "realized.csv", dtype={"soc": str}).set_index("soc")["realized_mean"]
    r = real.reindex(W.columns).fillna(real.median()).to_numpy()
    comp_real = pd.Series((W.to_numpy() * r).sum(axis=1) / W.to_numpy().sum(axis=1), index=W.index)
    a = a[a["sym"].isin(comp_real.index)].copy()
    a["realized"] = a["sym"].map(comp_real)
    z = lambda s: (s - s.mean()) / s.std(ddof=0) if s.std(ddof=0) > 0 else s * 0
    a["signal"] = a.groupby("date")["uplift"].transform(z) - z(a["realized"])

    px = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True).sort_index()
    fwd = px.shift(-63) / px - 1
    ex = fwd.sub(fwd["SPY"], axis=0)
    def look(row):
        s = ex[row.sym] if row.sym in ex else None
        if s is None:
            return np.nan
        s = s.loc[:row.date].dropna()
        return s.iloc[-1] if len(s) and (row.date - s.index[-1]).days < 7 else np.nan
    a["fwd_excess"] = [look(r) for r in a.itertuples()]
    a[["sym", "date", "signal", "uplift", "realized", "fwd_excess"]].dropna().to_csv(OUT / "signal_panel.csv", index=False)
    run(["Rscript", Q / "R" / "gap_test.R"])


# ---------- 6. Julia ----------
def step_julia():
    if not have("julia"):
        print("Julia isn't installed here. On your PC run:  julia -t auto quant/julia/careers.jl")
        return
    run(["julia", "-t", "auto", Q / "julia" / "careers.jl", OUT])


# ---------- 7. Haskell ----------
def step_haskell():
    exe = Q / "haskell" / ("contracts.exe" if sys.platform == "win32" else "contracts")
    build = OUT / "hs_build"
    run(["ghc", "-O2", "-outputdir", build, Q / "haskell" / "Contracts.hs", "-o", exe])
    run([exe, OUT])


# ---------- 8. Octave ----------
def step_octave():
    hc = pd.read_csv(OUT / "hc_monthly.csv", dtype={"soc": str}, parse_dates=["date"])
    wide = hc.pivot(index="date", columns="soc", values="hc").sort_index()
    hr = wide.pct_change().iloc[1:].fillna(0)
    W = pd.read_csv(OUT / "weights.csv", index_col=0)
    px = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True).sort_index()
    syms = [s for s in W.index if s in px]
    me = px[syms].reindex(wide.index, method="ffill")
    sr = me.pct_change().iloc[1:]
    ok = sr.notna().all()
    syms = [s for s in syms if ok[s]]
    sr = sr[syms]
    socs = [s for s in hr.columns if s in W.columns]
    E = (W.loc[syms, socs].T.to_numpy() > 0).astype(int)
    np.savetxt(OUT / "hedge_returns.csv", sr.to_numpy(), delimiter=",", fmt="%.8f")
    np.savetxt(OUT / "hedge_career.csv", hr[socs].to_numpy(), delimiter=",", fmt="%.8f")
    np.savetxt(OUT / "hedge_eligible.csv", E, delimiter=",", fmt="%d")
    (OUT / "hedge_tickers.txt").write_text("\n".join(syms))
    (OUT / "hedge_jobs.txt").write_text("\n".join(socs))
    tool = "octave" if have("octave") else "octave-cli"
    run([tool, "--no-gui", "--quiet", Q / "octave" / "hedge.m", OUT])


# ---------- export for the website ----------
def clean(x):
    if isinstance(x, float):
        if not math.isfinite(x):
            return None
        return round(x) if abs(x) >= 100 else round(x, 5)
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x


def step_export():
    lat = pd.read_csv(OUT / "automation_latest.csv", dtype={"soc": str})
    out = {"as_of": str(lat["date"].iloc[0]), "capture": CAPTURE, "labor_share": LABOR_SHARE, "horizons": HORIZONS}
    g = pd.read_csv(OUT / "implied_growth.csv", parse_dates=["date"])
    a = ai_revenue()
    last = a.sort_values("date").groupby("sym").tail(1)
    comp = []
    for r in last.itertuples():
        s = g[g["sym"] == r.sym].sort_values("date")
        comp.append({"sym": r.sym, "before": r.base_growth, "now": r.implied_growth, "revenue": r.revenue,
                     "ai_rev_5y": r.ai_rev_5y, "ai_rev_10y": r.ai_rev_10y, "labor_share": LABOR_SHARE.get(r.sym, 1.0),
                     "series": [[f"{d:%Y-%m}", v] for d, v in zip(s["date"], s["implied_growth"].round(4))]})
    out["companies"] = sorted(comp, key=lambda c: -(c["now"] - c["before"]))
    jobs = lat[["soc"] + [f"a{h}{t}" for t in ["", "_lo", "_hi"] for h in HORIZONS]].copy()
    for name, cols in [("realized.csv", ["realized_mean", "realized_lo", "realized_hi", "emp_change"]),
                       ("careers.csv", ["hc_mean", "hc_no_ai", "ai_haircut", "hc_p5", "prob_automated_10y"]),
                       ("contracts.csv", ["survival_5y", "cds_spread_pct", "cds_premium_dollars", "income_floor_pv_dollars"]),
                       ("hedges.csv", ["hedge_dollars_per_dollar", "variance_cut", "top1", "w1", "top2", "w2", "top3", "w3"])]:
        p = OUT / name
        if p.exists():
            jobs = jobs.merge(pd.read_csv(p, dtype={"soc": str})[["soc"] + cols], on="soc", how="left")
    jobs = jobs.replace({np.nan: None})
    out["jobs"] = {r["soc"]: {k: v for k, v in r.items() if k != "soc" and v is not None} for r in jobs.to_dict("records")}
    tot5 = float((lat["a5"] * lat["pool_bn"]).sum())
    out["totals"] = {"pay_bn": float(lat["pool_bn"].sum()), "automated_5y_bn": tot5,
                     "automated_5y_lo_bn": float((lat["a5_lo"] * lat["pool_bn"]).sum()),
                     "automated_5y_hi_bn": float((lat["a5_hi"] * lat["pool_bn"]).sum()),
                     "automated_10y_bn": float((lat["a10"] * lat["pool_bn"]).sum())}
    if (OUT / "realized.csv").exists():
        rz = pd.read_csv(OUT / "realized.csv", dtype={"soc": str}).merge(lat[["soc", "pool_bn"]], on="soc")
        out["totals"]["realized_per_year"] = float((rz["realized_mean"] * rz["pool_bn"]).sum() / rz["pool_bn"].sum())
        out["totals"]["realized_per_year_hi"] = float((rz["realized_hi"] * rz["pool_bn"]).sum() / rz["pool_bn"].sum())
    monthly = pd.read_csv(OUT / "automation_monthly.csv", dtype={"soc": str})
    monthly = monthly.merge(lat[["soc", "pool_bn"]], on="soc")
    out["curve"] = [[d, float((x["a5"] * x["pool_bn"]).sum() / x["pool_bn"].sum())] for d, x in monthly.groupby("date")]
    for name in ["realized_summary.json", "gap_test.json"]:
        p = OUT / name
        if p.exists():
            out[name.replace(".json", "")] = json.loads(p.read_text())
    (ROOT / "docs" / "data" / "implied.json").write_text(json.dumps(clean(out), separators=(",", ":")))
    print(f"Saved docs/data/implied.json ({(ROOT / 'docs' / 'data' / 'implied.json').stat().st_size / 1e3:.0f} KB)")


STEPS = {"ocaml": step_ocaml, "apl": step_apl, "stan": step_stan, "gap": step_gap, "julia": step_julia,
         "haskell": step_haskell, "octave": step_octave, "export": step_export}

if __name__ == "__main__":
    wanted = sys.argv[1:] or ["all"]
    if wanted == ["all"]:
        wanted = list(STEPS)
    for w in wanted:
        print(f"\n=== {w} ===")
        STEPS[w]()
