"""College majors ranked by AI exposure.

Each major (CIP code) is linked to the jobs it leads to with the official NCES CIP 2020 to SOC 2018
crosswalk. A major's score is the average exposure of those jobs, weighted by how many people work in each.
College teaching jobs (SOC 25-1xxx) are left out, because nearly every major links to "professor of X".
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "majors"
PROC = ROOT / "data" / "processed"
OUT = ROOT / "docs" / "data"

FAMILIES = {
    "01": "Agriculture", "03": "Natural resources", "04": "Architecture", "05": "Area and cultural studies",
    "09": "Communication", "10": "Communication technology", "11": "Computer science", "12": "Culinary and personal services",
    "13": "Education", "14": "Engineering", "15": "Engineering technology", "16": "Languages", "19": "Human sciences",
    "22": "Law", "23": "English", "24": "Liberal arts", "25": "Library science", "26": "Biology", "27": "Math and statistics",
    "29": "Military technology", "30": "Interdisciplinary", "31": "Recreation and fitness", "38": "Philosophy and religion",
    "39": "Theology", "40": "Physical sciences", "41": "Science technology", "42": "Psychology",
    "43": "Security and public safety", "44": "Public policy and social work", "45": "Social sciences",
    "46": "Construction trades", "47": "Repair and maintenance", "48": "Precision production", "49": "Transportation",
    "50": "Arts", "51": "Health", "52": "Business", "54": "History", "60": "Medical residency",
}

# Virginia Tech's own names for its majors (from the VT Registrar's major list), keyed by the federal CIP code
# VT reports each major under. Where one code covers several VT majors, the main one is named.
VT_NAMES = {
    "52.1301": "Business Information Technology", "11.0101": "Computer Science", "14.1901": "Mechanical Engineering",
    "52.0801": "Finance (incl. FinTech and Big Data Analytics)", "26.0101": "Biological Sciences",
    "52.1401": "Marketing Management", "42.0101": "Psychology", "09.0101": "Communication",
    "19.0501": "Human Nutrition, Foods and Exercise", "52.0201": "Management", "26.1501": "Neuroscience",
    "14.0801": "Civil Engineering", "14.3501": "Industrial and Systems Engineering",
    "14.0201": "Aerospace and Ocean Engineering", "14.0901": "Computer Engineering", "45.1001": "Political Science",
    "19.0701": "Human Development", "45.1101": "Sociology (incl. Criminology)",
    "30.7001": "Computational Modeling and Data Analytics (CMDA)", "01.0901": "Animal and Poultry Sciences",
    "04.0902": "Architecture and Building Science", "52.0301": "Accounting and Information Systems",
    "45.0901": "International Studies", "26.0202": "Biochemistry", "14.1001": "Electrical Engineering",
    "51.2201": "Public Health", "52.2001": "Building Construction", "45.0601": "Economics", "03.0501": "Forestry",
    "52.1501": "Real Estate", "23.0101": "English", "14.0701": "Chemical Engineering", "27.0101": "Mathematics",
    "03.0601": "Fish and Wildlife Conservation", "14.3301": "Construction Engineering and Management",
    "14.0501": "Biomedical Engineering", "19.0201": "Apparel, Housing, and Resource Management",
    "16.0101": "Foreign Languages", "50.0701": "Art", "40.0501": "Chemistry", "38.0101": "Philosophy",
    "40.0801": "Physics", "44.0501": "Public and Urban Affairs", "03.0104": "Environmental Science",
    "52.0901": "Hospitality and Tourism Management", "54.0101": "History", "40.0404": "Meteorology",
    "50.0408": "Interior Design", "14.1801": "Materials Science and Engineering", "50.0404": "Industrial Design",
    "01.0102": "Agribusiness", "45.0701": "Geography", "14.0301": "Biological Systems Engineering",
    "01.1103": "Plant Science (Horticulture)", "26.0502": "Microbiology", "50.0501": "Theatre Arts and Cinema",
    "01.1001": "Food Science and Technology", "27.0501": "Statistics", "40.0601": "Geosciences",
    "04.0601": "Landscape Architecture", "45.0602": "Agricultural and Applied Economics",
    "15.1503": "Packaging Systems and Design", "50.0901": "Music", "01.1102": "Crop and Soil Environmental Sciences",
    "01.0905": "Dairy Science", "14.2101": "Mining Engineering", "01.0000": "Agricultural Sciences",
    "26.1104": "Systems Biology", "13.1205": "Secondary Education",
}


def clean_name(t):
    t = str(t).strip().rstrip(".")
    for tail in [", General", ", Other"]:
        if t.endswith(tail):
            t = t[: -len(tail)] + (" (other)" if tail == ", Other" else "")
    return t


def build():
    xw = pd.read_csv(RAW / "cip_soc.csv", dtype=str)
    grads = pd.read_csv(RAW / "ipeds_bachelors.csv", dtype={"cip": str})
    jobs = pd.read_csv(PROC / "jobs.csv", dtype={"soc": str})
    jobs = jobs[jobs["exposure_score"].notna()]
    jobs = jobs[["soc", "title", "exposure_score", "employment", "median_wage"]]

    links = xw.merge(jobs, on="soc", how="inner")
    teach = links["soc"].str.startswith("25-1")
    has_other = links.assign(t=~teach).groupby("cip")["t"].transform("any")
    links = links[~teach | ~has_other]
    links["employment"] = links["employment"].fillna(0)

    rows = []
    for cip, g in links.groupby("cip"):
        w = g["employment"].clip(lower=1)
        score = (g["exposure_score"] * w).sum() / w.sum()
        paid = g[g["median_wage"].notna()]
        pay = (paid["median_wage"] * paid["employment"].clip(lower=1)).sum() / paid["employment"].clip(lower=1).sum() if len(paid) else None
        high = w[g["exposure_score"] >= 75].sum() / w.sum()
        top = g.sort_values("employment", ascending=False).head(8)
        rows.append({
            "cip": cip, "name": clean_name(g["cip_title"].iloc[0]), "vt_name": VT_NAMES.get(cip), "family": FAMILIES.get(cip[:2], "Other"),
            "score": round(float(score), 1), "high_share": round(float(high) * 100),
            "pay": int(round(pay, -2)) if pay else None, "workers": int(g["employment"].sum()), "n_jobs": int(len(g)),
            "jobs": [r.soc for r in top.itertuples()],
        })
    majors = pd.DataFrame(rows).merge(grads, on="cip", how="left")
    majors[["us_grads", "vt_grads"]] = majors[["us_grads", "vt_grads"]].fillna(0).astype(int)
    majors = majors[majors["us_grads"] > 0].sort_values("score", ascending=False)

    year = int(grads["year"].iloc[0])
    vt = majors[majors["vt_grads"] > 0]
    def wavg(df, col):
        return round(float((df["score"] * df[col]).sum() / df[col].sum()), 1)
    summary = {
        "year": f"{year - 1}-{str(year)[2:]}",
        "us_majors": int(len(majors)), "vt_majors": int(len(vt)),
        "us_grads": int(majors["us_grads"].sum()), "vt_grads": int(vt["vt_grads"].sum()),
        "us_avg": wavg(majors, "us_grads"), "vt_avg": wavg(vt, "vt_grads"),
        "vt_high_share": round(float(vt.loc[vt["score"] >= 75, "vt_grads"].sum() / vt["vt_grads"].sum() * 100)),
    }
    records = majors.drop(columns=["year"]).to_dict("records")
    for r in records:
        r["pay"] = None if pd.isna(r["pay"]) else int(r["pay"])
        if not r["vt_name"] or r["vt_grads"] == 0:
            del r["vt_name"]
    out = {"summary": summary, "majors": records}
    (OUT / "majors.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    majors.drop(columns=["jobs"]).to_csv(PROC / "majors.csv", index=False)
    return summary, majors


if __name__ == "__main__":
    s, m = build()
    print(json.dumps(s, indent=1))
    cols = ["vt_name", "score", "pay", "vt_grads"]
    vt = m[m["vt_grads"] > 0]
    print("\nVirginia Tech majors most exposed to AI:\n", vt[cols].head(12).to_string(index=False))
    print("\nVirginia Tech majors least exposed:\n", vt[cols].tail(8).to_string(index=False))
