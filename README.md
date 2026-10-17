# HedgeMyJob

Type your job and see how much of it AI can already do, which parts still need you,
which companies sell that AI, and how their stocks moved compared with hiring in your field.

- 809 US jobs, each scored by 5 sources: OpenAI (GPT-4 and human ratings), Anthropic Economic Index (Claude usage),
  Microsoft Working with AI (Copilot usage), and Felten, Raj and Seamans (AIOE).
- Jobs and pay from BLS (May 2025), hiring from Indeed Hiring Lab, prices from Yahoo Finance, companies from the SEC.
- Python for the data pipeline, SQL (DuckDB) for the database, a plain HTML and JavaScript website in `docs/`.

Free educational research tool. Not investment, financial or career advice.

## Rebuild the data

```
pip install -r requirements.txt
python download_data.py
python build.py
python export_site.py
```

## See the site on your computer

```
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000
