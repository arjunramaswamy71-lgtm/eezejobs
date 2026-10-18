"""Run this once on your own computer. It saves all raw data into data/raw."""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent / "src"))
import config  # noqa: E402

RAW = Path(__file__).parent / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)
results = {}


def get_indeed():
    df = pd.read_csv(config.INDEED_SECTOR_URL)
    df.to_csv(RAW / "indeed_sectors_us.csv", index=False)
    return f"{len(df):,} rows, up to {df['date'].max()}"


def get_aei():
    from huggingface_hub import snapshot_download

    path = snapshot_download(
        repo_id=config.AEI_REPO,
        repo_type="dataset",
        allow_patterns=[f"{config.AEI_RELEASE}/*.csv"],
        local_dir=RAW / "aei",
    )
    files = sorted(p.name for p in Path(path, config.AEI_RELEASE).glob("*.csv"))
    return f"{len(files)} files: " + ", ".join(files)


def get_prices():
    import yfinance as yf

    tickers = config.all_tickers()
    data = yf.download(tickers, start=config.START_DATE, auto_adjust=True, progress=False)
    close = data["Close"]
    close.to_csv(RAW / "prices.csv")
    missing = [t for t in tickers if t not in close or close[t].dropna().empty]
    note = f", missing: {missing}" if missing else ""
    return f"{len(tickers)} tickers, {len(close):,} days{note}"


def get_exposure():
    import requests

    folder = RAW / "exposure"
    folder.mkdir(exist_ok=True)
    for name, url in config.EXPOSURE_FILES.items():
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        (folder / name).write_bytes(r.content)
    return f"{len(config.EXPOSURE_FILES)} files"


def get_oews():
    import io
    import zipfile

    import requests

    if not config.CONTACT_EMAIL:
        raise ValueError("set CONTACT_EMAIL in src/config.py first")
    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    for url in config.OEWS_URLS:
        r = requests.get(url, headers=headers, timeout=120)
        if r.status_code != 200:
            continue
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            xlsx = [n for n in z.namelist() if n.endswith(".xlsx")][0]
            df = pd.read_excel(z.open(xlsx))
        df.to_csv(RAW / "oews_national.csv", index=False)
        return f"{url.split('/')[-1]}, {len(df):,} rows"
    raise RuntimeError("no OEWS file found")


def get_sec_companies():
    import requests

    if not config.CONTACT_EMAIL:
        raise ValueError("set CONTACT_EMAIL in src/config.py first")
    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    r = requests.get(config.SEC_TICKERS_URL, headers=headers, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json().values())
    df.to_csv(RAW / "sec_companies.csv", index=False)
    return f"{len(df):,} companies"


def get_crosswalk():
    import requests

    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    r = requests.get(config.SOC_CROSSWALK_URL, headers=headers, timeout=60)
    r.raise_for_status()
    (RAW / "soc_crosswalk.xlsx").write_bytes(r.content)
    return f"{len(r.content) / 1e3:.0f} KB"


def get_onet():
    import io
    import re
    import zipfile

    import requests

    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    urls = []
    try:
        page = requests.get(config.ONET_PAGE, headers=headers, timeout=60).text
        urls += [("https://www.onetcenter.org" + m if m.startswith("/") else m)
                 for m in re.findall(r'href="([^"]*db_\d+_\d+_text\.zip)"', page)]
    except Exception:
        pass
    urls += [f"https://www.onetcenter.org/dl_files/database/db_{v}_text.zip" for v in config.ONET_VERSIONS]
    folder = RAW / "onet"
    folder.mkdir(exist_ok=True)
    for url in dict.fromkeys(urls):
        r = requests.get(url, headers=headers, timeout=180)
        if r.status_code != 200:
            continue
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            got = 0
            for name in z.namelist():
                base = name.split("/")[-1]
                if base in config.ONET_FILES or base.lower() in [f.lower() for f in config.ONET_FILES]:
                    (folder / base).write_bytes(z.read(name))
                    got += 1
        return f"{url.split('/')[-1]}, {got} files"
    raise RuntimeError("no O*NET database file found")


def get_majors():
    """College majors: the CIP to SOC crosswalk and IPEDS bachelor's degrees by major (all US + Virginia Tech)."""
    import io
    import re
    import zipfile

    import requests

    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    folder = RAW / "majors"
    folder.mkdir(exist_ok=True)

    def cip(x):
        try:
            return f"{float(str(x).strip().strip('=').strip(chr(34))):07.4f}"
        except ValueError:
            return None

    # 1. CIP 2020 to SOC 2018 crosswalk
    urls = list(config.CIP_SOC_URLS)
    try:
        page = requests.get(config.CIP_RESOURCES_PAGE, headers=headers, timeout=60).text
        for link in re.findall(r'href="([^"]+\.xlsx)"', page, re.I):
            if "soc" in link.lower() and "cip" in link.lower():
                urls.append(requests.compat.urljoin(config.CIP_RESOURCES_PAGE, link))
    except Exception:
        pass
    xw = None
    for url in urls:
        r = requests.get(url, headers=headers, timeout=120)
        if r.status_code != 200 or r.content[:2] != b"PK":
            continue
        sheets = pd.read_excel(io.BytesIO(r.content), sheet_name=None, dtype=str)
        for name, df in sheets.items():
            cols = {c: c.lower().replace(" ", "") for c in df.columns}
            c_code = next((c for c, l in cols.items() if "cip" in l and "code" in l), None)
            c_title = next((c for c, l in cols.items() if "cip" in l and "title" in l), None)
            s_code = next((c for c, l in cols.items() if "soc" in l and "code" in l), None)
            if c_code and s_code and c_title and df.columns.get_loc(c_code) < df.columns.get_loc(s_code):
                xw = pd.DataFrame({"cip": df[c_code].map(cip), "cip_title": df[c_title].str.strip().str.rstrip("."),
                                   "soc": df[s_code].astype(str).str.strip()})
                break
        if xw is not None:
            break
    if xw is None:
        raise RuntimeError("CIP-SOC crosswalk not found, tried: " + ", ".join(urls))
    xw = xw.dropna()
    xw = xw[xw["soc"].str.match(r"^\d\d-\d{4}$")]
    xw.to_csv(folder / "cip_soc.csv", index=False)

    # 2. IPEDS completions: bachelor's degrees (award level 5), first major, by CIP
    for year in config.IPEDS_YEARS:
        url = f"https://nces.ed.gov/ipeds/datacenter/data/C{year}_A.zip"
        r = requests.get(url, headers=headers, timeout=300)
        if r.status_code != 200 or r.content[:2] != b"PK":
            continue
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".csv")]
            name = next((n for n in names if "_rv" in n.lower()), names[0])
            df = pd.read_csv(z.open(name), dtype=str, encoding="latin-1")
        df.columns = [c.replace("\ufeff", "").replace("ï»¿", "").strip().strip('"').upper() for c in df.columns]
        if "UNITID" not in df.columns:
            raise RuntimeError(f"unexpected columns in {name}: {list(df.columns)[:8]}")
        df = df[(df["AWLEVEL"].str.strip() == "5") & (df["MAJORNUM"].str.strip() == "1")]
        df["cip"] = df["CIPCODE"].map(cip)
        df["grads"] = pd.to_numeric(df["CTOTALT"], errors="coerce").fillna(0)
        df = df[df["cip"].notna() & ~df["cip"].str.startswith("99")]
        nat = df.groupby("cip")["grads"].sum().rename("us_grads")
        vt = df[df["UNITID"].str.strip() == config.VT_UNITID].groupby("cip")["grads"].sum().rename("vt_grads")
        out = pd.concat([nat, vt], axis=1).fillna(0).reset_index()
        out["year"] = year
        out.to_csv(folder / "ipeds_bachelors.csv", index=False)
        return (f"crosswalk {len(xw):,} links; IPEDS {year}: {int(out['us_grads'].sum()):,} US bachelor's, "
                f"{int(out['vt_grads'].sum()):,} at Virginia Tech in {int((out['vt_grads'] > 0).sum())} majors")
    raise RuntimeError("no IPEDS completions file found")



def get_fundamentals():
    """Point-in-time company fundamentals from SEC XBRL (annual 10-K values with their filing dates) for the AI sellers."""
    import time

    import requests
    import companies

    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    sec = pd.read_csv(RAW / "sec_companies.csv")
    cik = dict(zip(sec["ticker"], sec["cik_str"]))
    concepts = {
        "revenue": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
                    "RevenueFromContractWithCustomerIncludingAssessedTax"],
        "op_cash": ["NetCashProvidedByUsedInOperatingActivities"],
        "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
        "op_income": ["OperatingIncomeLoss"],
        "cash": ["CashAndCashEquivalentsAtCarryingValue"],
        "debt": ["LongTermDebt", "LongTermDebtNoncurrent"],
    }
    rows, skipped = [], []
    for t in companies.tickers():
        if t not in cik:
            skipped.append(t)
            continue
        r = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik[t]):010d}.json", headers=headers, timeout=60)
        time.sleep(0.15)  # SEC asks for under 10 requests a second
        if r.status_code != 200:
            skipped.append(t)
            continue
        facts = r.json().get("facts", {})
        gaap = facts.get("us-gaap", {})
        if not gaap:
            skipped.append(t)
            continue
        for name, tags in concepts.items():
            for tag in tags:
                for unit, vals in gaap.get(tag, {}).get("units", {}).items():
                    if unit != "USD":
                        continue
                    for v in vals:
                        annual = v.get("form") in ("10-K", "10-K/A", "20-F", "20-F/A", "40-F")
                        if annual and (v.get("fp") == "FY" and "start" in v or name in ("cash", "debt")):
                            rows.append({"ticker": t, "item": name, "tag": tag, "end": v["end"], "filed": v["filed"], "val": v["val"]})
        # Diluted share count covers every share class (Alphabet, Meta and others have several)
        for v in gaap.get("WeightedAverageNumberOfDilutedSharesOutstanding", {}).get("units", {}).get("shares", []):
            rows.append({"ticker": t, "item": "shares", "tag": "diluted", "end": v["end"], "filed": v["filed"], "val": v["val"]})
    df = pd.DataFrame(rows)
    df.to_csv(RAW / "fundamentals.csv", index=False)
    return f"{df['ticker'].nunique()} companies, {len(df):,} facts; skipped (not US filers): {', '.join(skipped) or 'none'}"



def get_oews_2022():
    """BLS jobs and pay for May 2022, the last survey before ChatGPT, to measure what changed since."""
    import io
    import zipfile

    import requests

    headers = {"User-Agent": f"eezejobs student research {config.CONTACT_EMAIL}"}
    r = requests.get("https://www.bls.gov/oes/special-requests/oesm22nat.zip", headers=headers, timeout=120)
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        xlsx = [n for n in z.namelist() if n.endswith(".xlsx")][0]
        df = pd.read_excel(z.open(xlsx))
    df.columns = [c.upper() for c in df.columns]
    df.to_csv(RAW / "oews_2022.csv", index=False)
    return f"{len(df):,} rows"


STEPS = [("Indeed job postings", get_indeed),
                  ("Anthropic Economic Index", get_aei),
                  ("Stock prices", get_prices),
                  ("AI exposure studies", get_exposure),
                  ("BLS jobs and wages", get_oews),
                  ("SEC company list", get_sec_companies),
                  ("Job code converter", get_crosswalk),
                  ("O*NET related jobs and skills", get_onet),
                  ("College majors", get_majors),
                  ("Company fundamentals", get_fundamentals),
                  ("BLS jobs and pay in 2022 (before ChatGPT)", get_oews_2022)]
only = [a.lower() for a in sys.argv[1:]]
for name, job in STEPS:
    if only and not any(o in name.lower() for o in only):
        continue
    print(f"Downloading {name}...")
    try:
        results[name] = "OK, " + job()
    except Exception as err:
        results[name] = f"FAILED, {type(err).__name__}: {err}"

print("\n=== Summary ===")
for name, status in results.items():
    print(f"{name}: {status}")
