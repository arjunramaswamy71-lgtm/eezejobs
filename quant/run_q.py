"""Implied Automation, step 1: build the point-in-time company panel in q/kdb+ (through PyKX).

Needs KDB_LICENSE_B64 in .env and data from:  python download_data.py fundamentals
Run from the project folder:                 python quant/run_q.py
Writes quant/out/panel.csv
"""

import base64
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

LIC_DIR = Path.home() / ".kx"
for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
    m = re.match(r"\s*KDB_LICENSE_B64\s*=\s*(.+)", line)
    if m:
        LIC_DIR.mkdir(exist_ok=True)
        (LIC_DIR / "kc.lic").write_bytes(base64.b64decode(m.group(1).strip().strip('"').strip("'")))
        os.environ["QLIC"] = str(LIC_DIR)

import pykx as kx  # noqa: E402  (must come after the license is set)

if not kx.licensed:
    sys.exit(f"kdb+ is running without a license: {kx.config.unlicensed_reason}")


def main():
    wide = pd.read_csv(RAW / "prices.csv", index_col=0, parse_dates=True)
    px = wide.reset_index().melt(id_vars=wide.index.name or "index", var_name="sym", value_name="close").dropna()
    px.columns = ["date", "sym", "close"]

    f = pd.read_csv(RAW / "fundamentals.csv", parse_dates=["end", "filed"])
    shr = f[f["item"] == "shares"].rename(columns={"ticker": "sym", "end": "adate", "val": "shares"})[["sym", "adate", "shares"]]
    fund = f[f["item"] != "shares"].rename(columns={"ticker": "sym", "end": "fyend"})[["sym", "item", "tag", "fyend", "filed", "val"]]
    fund["val"] = fund["val"].astype(float)
    shr["shares"] = shr["shares"].astype(float)

    t0 = time.perf_counter()
    kx.q["px0"] = kx.toq(px)
    kx.q["fund0"] = kx.toq(fund)
    kx.q["shr0"] = kx.toq(shr)
    kx.q('px:update date:`date$date, sym:`$string sym from `date`sym`close#0!px0')
    kx.q('fund:update sym:`$string sym, item:`$string item, tag:`$string tag, fyend:`date$fyend, filed:`date$filed from `sym`item`tag`fyend`filed`val#0!fund0')
    kx.q('shr:update sym:`$string sym, adate:`date$adate from `sym`adate`shares#0!shr0')
    kx.q(f'system "l {(Path(__file__).parent / "q" / "panel.q").as_posix()}"')
    t1 = time.perf_counter()
    panel = kx.q("build[px;fund;shr;`SPY;2021.01.01]").pd()
    t2 = time.perf_counter()

    panel["sym"] = panel["sym"].astype(str)
    panel.to_csv(OUT / "panel.csv", index=False, float_format="%.6g")
    print(f"kdb+: loaded {len(px):,} prices and {len(fund):,} SEC facts in {(t1 - t0) * 1000:.0f} ms, "
          f"built the point-in-time panel in {(t2 - t1) * 1000:.0f} ms.")
    print(f"{panel['sym'].nunique()} companies, {len(panel):,} company-months, "
          f"{panel['date'].min():%b %Y} to {panel['date'].max():%b %Y}. Saved quant/out/panel.csv")
    last = panel.sort_values("date").groupby("sym").tail(1)
    show = last.assign(mcap_bn=last["mcap"] / 1e9, rev_bn=last["revenue"] / 1e9)[["sym", "fyend", "mcap_bn", "rev_bn", "fcf_margin", "nopat_margin", "beta"]]
    print(show.round(2).to_string(index=False))


if __name__ == "__main__":
    main()
