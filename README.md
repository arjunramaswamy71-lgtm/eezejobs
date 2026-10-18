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
| **College majors** | Every bachelor's major in the US (1,079 of them), with Virginia Tech's 72 majors under their real VT names. Each major is scored by the jobs its graduates usually go into, and you can open it to see those jobs. |
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

**7. Virginia Tech graduates are a little more exposed than the average US graduate.**
Scoring each major by the jobs it leads to and weighting by how many students graduate in it, the average VT graduate lands at 72.6 out of 100, against 70.0 for all US bachelor's graduates. About a third of VT's 7,689 graduates in 2023-24 studied a major scoring 75 or above. Computer Science (84), CMDA (85) and Accounting (84) sit near the top. Forestry, dairy and animal sciences sit near the bottom. My own major, Finance (which includes FinTech and Big Data Analytics), scores 67.5.

**8. Trend signals are close to a coin flip.**
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

I wanted each part done in the language people in finance actually use for it, so part 1 ended up with seven (part 2 adds OCaml, Haskell, APL, Stan and Julia).

| Language | What it does here |
|---|---|
| **Python** | The data pipeline: downloads, cleaning, crosswalks, scoring, the AI panel, and exporting everything for the site. pandas, NumPy, yfinance, requests, huggingface_hub |
| **SQL (DuckDB)** | One local database with jobs, tasks, hiring, prices and baskets, plus views like wages at risk and most disputed jobs |
| **R** | The statistics (regressions, correlations, Spearman agreement between models) and the quant side with `xts` and `PerformanceAnalytics` (Sharpe, drawdowns, beta, performance charts) |
| **Java** | A standalone backtest engine for the trend signals, written from scratch with no libraries. It runs the full backtest in about 300 ms |
| **q / kdb+** | The same backtest again in q, the language a lot of trading desks use for time series. Runs in about 15 ms |
| **Excel** | The downloadable model, built with real formulas (149 of them) so it recalculates when you change the inputs |
| **JavaScript + WebGL + GLSL, HTML, CSS** | The website, with three hand-written GLSL shader programs and no 3D library. The **job universe** draws every job as a point of light you can hover and click (custom point shader, my own matrix math and picking). A **nebula** background uses domain-warped fractal noise. Each job page has an **exposure orb**, a shader-lit sphere whose color, turbulence and energy veins grow with the job's AI score. Everything else is plain JavaScript with no framework or build step, hand-drawn SVG charts, light and dark mode, and all motion turns off for people who prefer reduced motion |

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
- **NCES CIP 2020 to SOC 2018 crosswalk**: which majors lead to which jobs
- **IPEDS Completions** (US Department of Education): bachelor's degrees by major at every US college
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
python download_data.py          (or: python download_data.py majors, to fetch one part)
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

---

## Part 2: Implied Automation

**Traders read "implied volatility" out of option prices. This project reads *implied automation* out of AI stock prices.**

Every AI seller's stock price says how much revenue investors expect. Run each valuation backwards, keep the extra revenue the market started expecting after ChatGPT, and match it to the paychecks that AI would replace. The result is the stock market's own forecast of automation, job by job, with a range.

### What it found (as of October 2026)

- **The market is pricing in AI doing about 7% of US pay within 5 years** (about $680 billion a year; range 4% to 14% depending on how much AI sellers earn per dollar of pay replaced), and about 27% within 10 years.
- **It moved its bet to the platforms and away from job-specific software.** The 10-year growth priced into Palantir rose 25 points and Alphabet 12, while Intuit fell 23, HubSpot 33 and GitLab 41.
- **The jobs data doesn't show it yet.** A Bayesian hierarchical model of employment change from May 2022 to May 2025 across 769 jobs finds no clear link between AI usage and job losses (effect +0.02, 90% interval -0.02 to +0.06). A robust frequentist regression agrees (p = 0.46).
- **The gap between the two doesn't predict the stocks** (Fama-MacBeth t = 0.5). If anything, the stocks the market is most optimistic about kept rising.
- **Per job:** a market-implied chance of being automated, the hit to lifetime pay from 15.5 million simulated careers, a fair price for "career default swap" insurance, and the best hedge.

### One pipeline, eight languages

| Step | Language | What it does |
|---|---|---|
| 1 | **q / kdb+** | Point-in-time panel: as-of joins line up 50,000 daily prices with 7,000 SEC filings by filing date, so nothing uses data that wasn't public yet. Rolling betas from vectorised moving sums. About 50 ms. |
| 2 | **OCaml** | Reverse DCF: Brent's method solves the 10-year growth rate each stock prices in, for 1,734 company-months, in about 6 ms. |
| 3 | **APL** | Array maths that spreads each company's extra AI revenue across the 775 jobs its AI works on, under three capture-rate scenarios, with a smooth 1 - e^-x saturation. |
| 4 | **Stan** | Bayesian hierarchical model of realized automation: family effects with partial pooling, robust Student-t errors, convergence and posterior predictive checks. |
| 5 | **R** | Frequentist tests: HC3 robust regression, Fama-MacBeth with Newey-West errors, two-way clustered errors, a long-short portfolio and the information coefficient. Also drives Stan. |
| 6 | **Julia** | Bootstraps a hazard curve per job (the way credit desks read default odds from CDS prices), then Monte Carlo of 15.5 million careers with antithetic draws, in about 1.3 s on 12 threads. |
| 7 | **Haskell** | A contract-combinator language after Peyton Jones, Eber and Seward's "Composing contracts", with a compositional pricing semantics. Prices career default swaps and income floors for every job. |
| 8 | **MATLAB / Octave** | Constrained quadratic programming: the long-only, unlevered mix of AI stocks that best offsets swings in each job's market-implied career value. |

### Run it

```
python download_data.py fundamentals 2022     # SEC financials and the 2022 BLS baseline
python quant/run_q.py                         # 1. q/kdb+ (needs a free KDB-X licence in .env)
python quant/pipeline.py ocaml apl stan gap   # 2-5. OCaml, APL (Node), Stan + R
julia -t auto quant/julia/careers.jl          # 6. Julia
python quant/pipeline.py haskell octave export   # 7-8. Haskell (GHC), Octave, then the website data
```

Tools: OCaml, GHC, GNU Octave, R with rstan and sandwich, Node.js, Julia 1.10+, PyKX. Everything is free.

### What could make it wrong

- Reverse DCFs depend on long-run margins, the discount rate and terminal growth. Margins use the better of after-tax operating and free-cash-flow margins, so today's AI capex doesn't distort them.
- Not all extra AI revenue replaces paid work. Only part is counted for cloud, ads and chips (Nvidia none, Meta 10%, Alphabet 25%, Microsoft 50%). That split is a judgment call and is listed in `quant/pipeline.py`.
- The capture rate, what AI sellers earn per $1 of pay replaced, is unknown, so results are shown at 15, 30 and 50 cents.
- Some repricing since November 2022 isn't about AI, for example Meta's recovery from its 2022 slump.
- The hedge partly works by construction, because the career value is itself read from the same stocks.


## License

MIT. Use it, fork it, build on it.
