"""Companies that sell AI, and which kinds of jobs their AI does work for.

Job groups use SOC code prefixes. "13-2" means all finance jobs, "23" means all legal jobs.
This is a hand-made starter list. Check each entry before launch.
"""

# Public companies: ticker, name, what their AI does, job groups it targets, website
SELLERS = [
    # Big AI platforms, used across almost every office job
    ("MSFT", "Microsoft", "Copilot in Word, Excel, Outlook and Teams. Biggest investor in OpenAI.", ["ALL"], "microsoft.com"),
    ("GOOGL", "Alphabet (Google)", "Gemini in Gmail, Docs and Sheets. Investor in Anthropic.", ["ALL"], "abc.xyz"),
    ("AMZN", "Amazon", "Sells AI models to businesses through AWS. Investor in Anthropic.", ["ALL"], "amazon.com"),
    ("META", "Meta", "Builds the Llama AI models and AI ad tools.", ["ALL"], "meta.com"),
    ("IBM", "IBM", "Watsonx AI for businesses, plus AI consulting.", ["ALL"], "ibm.com"),
    ("NVDA", "Nvidia", "Makes the chips almost all AI runs on.", ["ALL"], "nvidia.com"),
    # Finance, accounting, payroll
    ("INTU", "Intuit", "AI in QuickBooks and TurboTax that does bookkeeping and tax prep.", ["13-2", "43-3"], "intuit.com"),
    ("BL", "BlackLine", "Automates month-end closing and account matching.", ["13-2", "43-3"], "blackline.com"),
    ("WK", "Workiva", "AI for financial and ESG reports.", ["13-2", "11-3031"], "workiva.com"),
    ("SAP", "SAP", "Joule AI inside finance and supply chain software.", ["13-2", "43-3", "13-1", "43-5"], "sap.com"),
    ("ORCL", "Oracle", "AI agents in Oracle and NetSuite finance software.", ["13-2", "43-3", "15-12"], "oracle.com"),
    ("ADP", "ADP", "AI in payroll and HR software.", ["43-3051", "13-1071", "13-1141"], "adp.com"),
    ("WDAY", "Workday", "AI agents for HR, hiring and finance teams.", ["13-1071", "13-1141", "13-2", "11-3121"], "workday.com"),
    # Legal
    ("TRI", "Thomson Reuters", "CoCounsel AI for legal research, tax and audit.", ["23", "43-6012", "13-2"], "thomsonreuters.com"),
    ("RELX", "RELX", "Lexis+ AI for legal research and drafting.", ["23", "43-6012"], "relx.com"),
    ("WTKWY", "Wolters Kluwer", "AI tools for tax, legal and medical professionals.", ["23", "13-2", "29"], "wolterskluwer.com"),
    # Customer service, sales, marketing
    ("CRM", "Salesforce", "Agentforce AI agents that answer customers and handle sales.", ["43-4", "41", "11-2", "13-1161"], "salesforce.com"),
    ("NOW", "ServiceNow", "AI agents for IT help desks and customer service.", ["43-4", "15-1232", "15-1244"], "servicenow.com"),
    ("NICE", "NICE", "AI for call centers that answers and scores calls.", ["43-4", "41-9041"], "nice.com"),
    ("HUBS", "HubSpot", "Breeze AI for marketing emails, sales and support.", ["41", "11-2", "13-1161", "43-4"], "hubspot.com"),
    ("ADBE", "Adobe", "Firefly AI that makes images, video and marketing content.", ["27-1", "27-3", "11-2", "13-1161"], "adobe.com"),
    # Software and data
    ("GTLB", "GitLab", "GitLab Duo AI that writes and reviews code.", ["15-12"], "gitlab.com"),
    ("TEAM", "Atlassian", "Rovo AI in Jira and Confluence for software and project teams.", ["15-12", "13-1082"], "atlassian.com"),
    ("PLTR", "Palantir", "AIP platform that automates analysis for governments and companies.", ["15-2", "13-1111", "13-1"], "palantir.com"),
    ("SNOW", "Snowflake", "AI for data analysts on top of company data.", ["15-2", "15-12", "43-9111"], "snowflake.com"),
    # Writing, translation, education
    ("DUOL", "Duolingo", "AI tutoring and AI-made lessons.", ["27-3091", "25"], "duolingo.com"),
    # Healthcare paperwork
    ("VEEV", "Veeva Systems", "AI for drug companies' sales and research teams.", ["19-1", "41-4011"], "veeva.com"),
    # Physical work: robots and self-driving
    ("SYM", "Symbotic", "Robots that run warehouses.", ["53-7", "43-5"], "symbotic.com"),
    ("TSLA", "Tesla", "Self-driving software and Optimus robots.", ["53-3"], "tesla.com"),
    ("ISRG", "Intuitive Surgical", "da Vinci surgical robots.", ["29-1248", "29-2055"], "intuitive.com"),
]

# Private AI makers: no stock to buy directly, so we show who backs them
PRIVATE = [
    ("OpenAI", "Makes ChatGPT and GPT models.", ["ALL"], "Microsoft (MSFT) is the largest outside investor", "openai.com"),
    ("Anthropic", "Makes Claude.", ["ALL"], "Amazon (AMZN) and Alphabet (GOOGL) are major investors", "anthropic.com"),
    ("xAI", "Makes Grok.", ["ALL"], "No public backer you can buy", "x.ai"),
    ("Mistral AI", "European AI models.", ["ALL"], "No public backer you can buy", "mistral.ai"),
    ("Harvey", "AI for law firms.", ["23", "43-6012"], "No public backer you can buy", "harvey.ai"),
    ("Cursor (Anysphere)", "AI that writes code.", ["15-12"], "No public backer you can buy", "cursor.com"),
    ("Replit", "AI that builds apps from a prompt.", ["15-12"], "No public backer you can buy", "replit.com"),
    ("Lovable", "AI that builds websites and apps from a prompt.", ["15-12", "15-1255", "27-1024"], "No public backer you can buy", "lovable.dev"),
    ("Sierra", "AI customer service agents.", ["43-4"], "No public backer you can buy", "sierra.ai"),
]


def match(groups, soc):
    """How well a company's job groups fit a job code. 0 means no fit, higher is more specific."""
    best = 0
    for g in groups:
        if g == "ALL":
            best = max(best, 1)
        elif soc.startswith(g):
            best = max(best, 1 + len(g))
    return best


def tickers():
    return sorted(s[0] for s in SELLERS)
