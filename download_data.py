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
    headers = {"User-Agent": f"HedgeMyJob student research {config.CONTACT_EMAIL}"}
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


for name, job in [("Indeed job postings", get_indeed),
                  ("Anthropic Economic Index", get_aei),
                  ("Stock prices", get_prices),
                  ("AI exposure studies", get_exposure),
                  ("BLS jobs and wages", get_oews)]:
    print(f"Downloading {name}...")
    try:
        results[name] = "OK, " + job()
    except Exception as err:
        results[name] = f"FAILED, {type(err).__name__}: {err}"

print("\n=== Summary ===")
for name, status in results.items():
    print(f"{name}: {status}")
