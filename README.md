# HedgeMyJob

**Type in your job. See how much of it AI can already do, who is selling that AI, and what their stocks have done since ChatGPT came out.**

Everyone has an opinion on whether AI is coming for their job. Most of those opinions come from one study or one headline. I wanted one place where a normal person (my test user is a 55-year-old who has never opened a terminal) could look up their own job and get a straight answer backed by real data: which tasks AI handles today, which still need a human, which companies make money from it, and which nearby jobs are safer.

It also asks a finance question I couldn't find answered anywhere: **if AI is a risk to your paycheck, can you hedge it by owning the companies selling that AI?** I built the backtests to find out. The answer was more interesting than I expected (see [What I found](#what-i-found)).

> Free, educational research tool. Nothing here is investment, financial or career advice.

---

## What it does

| Page | What you get |
|---|---|
| **Check a job** | Search any of 809 US jobs (with plain-English aliases, so "cpa" or "rn" work). You get an AI exposure score from 0 to 100, a split of the job's actual tasks into *AI can do this* / *AI helps with this* / *still you*, how each source rated it, and how many people do the job and what it pays. |
| **Who sells the AI** | The public companies selling AI for that kind of work, with a link to the stock, what the company actually sells, a trend label, and private players like OpenAI, Anthropic and Harvey with notes on who backs them. |
| **Your employer** | Look up any of about 8,000 SEC-listed companies and pull in recent AI news about them. |
| **Safer nearby jobs** | Jobs that use similar knowledge, need the same or less training, pay at least 85% as much, and are noticeably less exposed. |
| **Hedge backtest** | What $1,000 in that job's AI basket would have done since November 2022, compared with the S&P 500 and with job postings in your field. |
| **Stock trends** | A simple 4-check trend label for every AI stock, with its full track record shown right next to it so nobody mistakes it for a stock tip. |
| **Findings** | The research results below, updated whenever the data is rebuilt. |
| **Excel model** | A downloadable workbook. Pick your job, type your pay and how much you'd put aside, and it works out your exposure, pay at risk and a hedge basket with live formulas. |

---

## What I found

**1. Better-paid jobs are more exposed, not less.**
The highest-paid fifth of jobs scores about 70 out of 100. The lowest-paid fifth scores about 42. Every 10 points of exposure goes with roughly 9% higher pay (p < 0.001). AI is aimed squarely at office work.

**2. About 41 million Americans work in highly exposed jobs** (score 75 or above), out of 144 million covered. Together they earn roughly $3 trillion a year.

**3. Five AI models agree on the ranking but not on how bad it is.**
I had GPT, Gemini, Claude, Llama and DeepSeek each rate all 18,428 work tasks in the O\*NET database using the same rubric. Their rankings line up well (correlations from 0.77 to 0.88). But the average score they give a job ranges from 22 (Gemini) to 52 (GPT). How worried you "should" be depends a lot on which AI you ask, which is why the site averages them and shows the spread.

**4. Real usage data predicts hiring better than opinions do.**
Across 33 sectors, Microsoft's data on how people actually use Copilot had the strongest link to falling job postings (r = -0.41, p = 0.017). Ratings from models and experts were weaker. With 11 sources tested, I treat this as a strong lead rather than a proven result.

**5. More exposed sectors are hiring a bit less, but it isn't proven yet.**
Every 10 points of exposure goes with about 1.2 points weaker hiring since ChatGPT launched, but with only 33 sectors the result isn't significant (p = 0.14).

**6. The "hedge" mostly doesn't work, unless you just buy the giants.**
Since November 2022:

| Basket | Yearly return | Sharpe | Max drawdown |
|---|---|---|---|
| Big AI platforms (MSFT, GOOGL, AMZN, META, IBM, NVDA) | 44.4% | 1.47 | 23.0% |
| S&P 500 | 19.2% | 0.96 | 18.8% |
| All public AI sellers | 23.0% | 0.77 | 37.5% |
| Customer service AI | 24.5% | 0.74 | 32.3% |
| Legal AI | 3.3% | 0.07 | 55.6% |
| Finance and accounting AI | 0.5% | 0.02 | 52.7% |

The specialist companies selling AI to accountants and lawyers did worse than just holding the index, with drawdowns over 50%. Only the big platforms beat the market on a risk-adjusted basis.

**7. Trend signals are close to a coin flip.**
"Strong uptrend" stocks beat the market over the next 3 months only 47.5% of the time (583 signals since 2021). That's exactly why the site shows the track record next to every label instead of hiding it.

---

## How the exposure score works

Each job gets a score from up to six independent sources:

1. **OpenAI, GPT-4 ratings** of every task (*GPTs are GPTs*, Eloundou et al.)
2. **OpenAI, human expert ratings** of the same tasks
3. **Anthropic Economic Index**, what people actually use Claude for
4. **Microsoft Working with AI**, what people actually use Copilot for
5. **Felten, Raj and Seamans AIOE**, the academic AI occupational exposure index
6. **My own 5-model panel**, GPT, Gemini, Claude, Llama and DeepSeek each rating 18,428 tasks (E0 = no help, E1 = AI can do it, E2 = AI helps with tools). Total cost was about $4 through OpenRouter.

Every source is turned into a percentile so they're on the same scale, then averaged. The **spread** between sources is shown too, because a job everyone agrees on is different from one where the sources are all over the place. Older data on 2010 job codes is mapped to 2018 codes with the BLS crosswalk, so 765 of the 809 jobs have all six sources.

**Trend labels** use four checks: price above its 200-day average, 50-day above 200-day, positive 12-month momentum (skipping the last month), and beating the S&P over the last 3 months. 4 checks = Strong uptrend, 3 = Uptrend, 2 = Mixed, 0 or 1 = Downtrend.

**Safer jobs** come from O\*NET's own Related Occupations list plus how similar two jobs' knowledge profiles are, then filtered for same or lower training, at least 10,000 workers, at least 10 points less exposure and at least 85% of the pay.

---

## How it's built

I wanted each part done in the language people in finance actually use for it, so the project ended up with six.

| Language | What it does here |
|---|---|
| **Python** | The data pipeline: downloads, cleaning, crosswalks, scoring, the AI panel, and exporting everything for the site. pandas, NumPy, yfinance, requests, huggingface_hub |
| **SQL (DuckDB)** | One local database with jobs, tasks, hiring, prices and baskets, plus views like wages at risk and most disputed jobs |
| **R** | The statistics (regressions, correlations, Spearman agreement between models) and the quant side with `xts` and `PerformanceAnalytics` (Sharpe, drawdowns, beta, performance charts) |
| **Java** | A standalone backtest engine for the trend signals, written from scratch with no libraries. It runs the full backtest in about 300 ms |
| **q / kdb+** | The same backtest again in q, the language a lot of trading desks use for time series. Runs in about 15 ms |
| **Excel** | The downloadable model, built with real formulas (149 of them) so it recalculates when you change the inputs |
| **HTML, CSS, JavaScript** | The website. No framework, no build step, hash routing and hand-drawn SVG charts, light and dark mode |

**The signal backtest is written three times, in Python, Java and q, and all three give identical results.** That was the point: one is a check on the other two.

---

## Data sources

All public and free:

- **O\*NET** 31.0 (US Department of Labor): tasks, knowledge, job zones, related occupations
- **BLS Occupational Employment and Wage Statistics**, May 2025: workers and pay for every job
- **BLS SOC 2010 to 2018 crosswalk**
- **Anthropic Economic Index** (March 2025 release)
- **OpenAI**, *GPTs are GPTs* task labels
- **Microsoft**, *Working with AI*
- **Felten, Raj and Seamans**, AI Occupational Exposure
- **Indeed Hiring Lab**: job postings by sector
- **Yahoo Finance**: daily prices
- **SEC EDGAR**: the list of public companies
- **GDELT**: live news in the employer lookup

---

## Project layout

```
download_data.py      get every dataset
build.py              score jobs, run backtests, build the database
export_site.py        write the JSON files the website reads
src/                  the Python modules (exposure, AI panel, signals, companies, safer jobs, Excel model...)
sql/                  DuckDB views
analysis/             R statistics and quant scripts
java/                 Java backtest engine
q/                    q/kdb+ backtest
docs/                 the website (served by GitHub Pages)
```

---

## Run it yourself

**Python (everything starts here)**
```
pip install -r requirements.txt
python download_data.py
python build.py
python export_site.py
python src/excel_model.py
```
Re-running the AI panel needs an `OPENROUTER_API_KEY` in a `.env` file (`python src/ai_panel.py --run`). The ratings I already collected are used otherwise.

**The website**
```
python -m http.server 8000 --directory docs
```
Then open http://localhost:8000

**R**
```
Rscript analysis/quant.R
Rscript analysis/stats.R
```

**Java** (JDK 22 or newer, no build needed)
```
java java/src/hedgemyjob/Main.java
```

**q / kdb+** (needs a free KDB-X Community license, put in `.env` as `KDB_LICENSE_B64`)
```
pip install pykx
python src/kdb_signals.py
```

---

## Limits, honestly

- Exposure means AI *could* do or help with the work, not that the job will disappear. Plenty of exposed jobs will just change.
- Hiring data is by sector, not by individual job, so the hiring results are broad.
- The stock baskets are my own picks of companies selling AI into each field. A different list would give different numbers.
- Past returns say nothing certain about future ones, and the trend labels have a track record close to random. They are there to teach, not to tell anyone what to buy.

## License

MIT. Use it, fork it, build on it.
