"""Runs the trend signal backtest in q (kdb+) through PyKX and checks it matches the Python version.

Needs KDB_LICENSE_B64 in the .env file (free KDB-X Community Edition license from KX).
Run from the project folder:  python src/kdb_signals.py
"""

import base64
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "src"))

# PyKX only installs a license by itself in an interactive session, so write the
# license file into your user folder (outside the project, never uploaded) and point PyKX at it
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

import signals  # noqa: E402


def main():
    wide = pd.read_csv(ROOT / "data" / "raw" / "prices.csv", index_col=0, parse_dates=True)
    long = wide.reset_index().melt(id_vars=wide.index.name or "index", var_name="sym", value_name="close")
    long.columns = ["date", "sym", "close"]

    t0 = time.perf_counter()
    kx.q["raw"] = kx.toq(long)
    kx.q('prices:update date:`date$date, sym:`$string sym from raw')
    kx.q(f'system "l {(ROOT / "q" / "signals.q").as_posix()}"')
    t1 = time.perf_counter()
    res = kx.q("backtest[prices;`SPY;2021.01.01]").pd()
    now = kx.q("current[prices;`SPY]").pd()
    t2 = time.perf_counter()

    rows = kx.q("count prices").py()
    print(f"Loaded {rows:,} price rows into kdb+ in {(t1 - t0) * 1000:.0f} ms. Backtest in q ran in {(t2 - t1) * 1000:.0f} ms.\n")
    res["label"] = res["label"].astype(str)
    order = ["Strong uptrend", "Uptrend", "Mixed", "Downtrend"]
    res = res.set_index("label").reindex(order)
    print(res.round(1).to_string())

    py = signals.backtest(wide)
    print("\nCheck against the Python engine:")
    ok = True
    for g in py["groups"]:
        q = res.loc[g["label"]]
        same = (int(q["times"]) == g["times"]
                and abs(q["beat_market_pct"] - g["beat_market_pct"]) <= 0.6
                and abs(q["avg_3m_return_pct"] - g["avg_3m_return_pct"]) <= 0.06
                and abs(q["avg_vs_market_pct"] - g["avg_vs_market_pct"]) <= 0.06)
        ok &= same
        print(f"  {g['label']:16s} {'matches' if same else 'DIFFERENT'}")
    print("q and Python agree." if ok else "q and Python disagree, worth a look.")

    now["sym"] = now["sym"].astype(str)
    now["signal"] = now["signal"].astype(str)
    py_now = signals.current(wide)
    diff = [s for s, sig in zip(now["sym"], now["signal"]) if py_now.get(s, {}).get("label") != sig]
    print("Today's signals match Python." if not diff else f"Today's signals differ for: {diff}")
    res.reset_index().to_json(ROOT / "analysis" / "kdb_signals.json", orient="records", indent=2)


if __name__ == "__main__":
    main()
