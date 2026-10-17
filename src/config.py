"""Settings for HedgeMyJob: fields, occupations, sectors and starter hedge baskets."""

START_DATE = "2020-02-01"

# Each field: O*NET occupation codes, Indeed sectors that track its hiring,
# and a starter basket of public companies that sell AI for that field's tasks.
# The baskets are a first draft. Check every ticker before launch.
FIELDS = {
    "finance_accounting": {
        "label": "Finance and accounting",
        "occupations": {
            "13-2011.01": "Accountants",
            "43-3031.00": "Bookkeeping, Accounting, and Auditing Clerks",
            "13-2051.00": "Financial Analysts",
        },
        "indeed_sectors": ["Accounting", "Banking & Finance"],
        "hedge_basket": {
            "INTU": "Intuit, AI in QuickBooks and TurboTax",
            "BL": "BlackLine, automated close and reconciliation",
            "WK": "Workiva, AI financial reporting",
            "SAP": "SAP, AI in finance software",
        },
    },
    "legal": {
        "label": "Legal",
        "occupations": {
            "23-2011.00": "Paralegals and Legal Assistants",
            "23-1011.00": "Lawyers",
            "43-6012.00": "Legal Secretaries and Administrative Assistants",
        },
        "indeed_sectors": ["Legal"],
        "hedge_basket": {
            "TRI": "Thomson Reuters, owns CoCounsel",
            "RELX": "RELX, owns Lexis+ AI",
            "WTKWY": "Wolters Kluwer, legal and tax AI tools",
        },
    },
    "customer_service": {
        "label": "Customer service",
        "occupations": {
            "43-4051.00": "Customer Service Representatives",
            "41-9041.00": "Telemarketers",
            "43-4171.00": "Receptionists and Information Clerks",
        },
        "indeed_sectors": ["Customer Service"],
        "hedge_basket": {
            "CRM": "Salesforce, Agentforce service agents",
            "NOW": "ServiceNow, AI service workflows",
            "GOOGL": "Alphabet, AI customer agents",
        },
    },
}

# Broad AI leaders and the market, used as comparisons
BENCHMARKS = {"SPY": "S&P 500", "NVDA": "Nvidia", "MSFT": "Microsoft"}

INDEED_SECTOR_URL = (
    "https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/"
    "master/US/job_postings_by_sector_US.csv"
)
AEI_REPO = "Anthropic/EconomicIndex"
AEI_RELEASE = "release_2025_03_27"


def all_tickers():
    import companies

    tickers = set(BENCHMARKS) | set(companies.tickers())
    for field in FIELDS.values():
        tickers.update(field["hedge_basket"])
    return sorted(tickers)

# Government sites (BLS, SEC) block downloads unless you say who you are.
# Put your own email here before running download_data.py
CONTACT_EMAIL = "arjunramaswamy71@gmail.com"

EXPOSURE_FILES = {
    "openai_occ_level.csv": "https://raw.githubusercontent.com/openai/GPTs-are-GPTs/main/data/occ_level.csv",
    "openai_full_labelset.tsv": "https://raw.githubusercontent.com/openai/GPTs-are-GPTs/main/data/full_labelset.tsv",
    "microsoft_ai_applicability.csv": "https://raw.githubusercontent.com/microsoft/working-with-ai/main/ai_applicability_scores.csv",
    "felten_aioe.xlsx": "https://raw.githubusercontent.com/AIOE-Data/AIOE/main/AIOE_DataAppendix.xlsx",
}

# BLS national jobs and wages file, newest first
OEWS_URLS = [
    "https://www.bls.gov/oes/special-requests/oesm25nat.zip",
    "https://www.bls.gov/oes/special-requests/oesm24nat.zip",
]

# Every company listed with the SEC, for the "where do you work" search
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

# Official converter from 2010 job codes to the 2018 codes BLS uses now
SOC_CROSSWALK_URL = "https://www.bls.gov/soc/2018/soc_2010_to_2018_crosswalk.xlsx"

# O*NET database (related jobs, skills, education level). Newest version first.
ONET_PAGE = "https://www.onetcenter.org/database.html"
ONET_VERSIONS = ["31_0", "30_3", "30_2", "30_1", "30_0", "29_3", "29_2"]
ONET_FILES = ["Related Occupations.txt", "Skills.txt", "Knowledge.txt", "Work Activities.txt", "Job Zones.txt", "Occupation Data.txt"]
