"""The 6-AI panel: ask several AI models to rate every job task, using the same rubric OpenAI used in "GPTs are GPTs".

Run a small test first:   python src/ai_panel.py --test
Then the full run:        python src/ai_panel.py --run

Results are saved as they come in (data/raw/ai_panel), so a stopped run picks up where it left off.
Your key is read from the .env file and is never printed or saved anywhere else.
"""

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "raw" / "ai_panel"
API = "https://openrouter.ai/api/v1"
BATCH = 60
BUDGET = 7.50  # stop before the key's $8 cap

# One cheap model from each AI company. The newest matching model is picked automatically.
FAMILIES = {
    "openai": r"^openai/gpt-[\d.]+-mini$",
    "google": r"^google/gemini-[\d.]+-flash$",
    "xai": r"^x-ai/grok-[\w.-]*(mini|fast)[\w.-]*$",
    "anthropic": r"^anthropic/claude-([\d.-]+-)?haiku(-[\d.-]+)?$",
    "meta": r"^meta-llama/llama-[\w.-]*instruct$",
    "deepseek": r"^deepseek/deepseek-(chat|v[\d.]+)[\w.-]*$",
}
# If the strict pattern finds nothing, take the newest model under this output price from the loose pattern
LOOSE = {
    "xai": (r"^x-ai/grok", 2.0),
}

RUBRIC = """You rate how exposed job tasks are to large language models (LLMs) like ChatGPT.
For each task pick one label:
E0 = No exposure. Using an LLM would not cut the time to do this task by half or more at the same quality, or the task is mainly physical, hands-on, or needs being there in person.
E1 = Direct exposure. An LLM on its own (chat, writing, reading, summarizing, coding, answering questions) could cut the time to do this task by at least half at the same quality.
E2 = Exposure with tools. An LLM alone could not, but LLM-powered software that is easy to imagine (connected to company data, search, images, or other apps) could cut the time by at least half.
Answer with one line per task, the task number then its label, like:
1:E1
2:E0
3:E2
Rate every task. No other text."""


def api_key():
    env = ROOT / ".env"
    if not env.exists():
        sys.exit("No .env file found in the project folder.")
    for line in env.read_text(encoding="utf-8-sig").splitlines():
        m = re.match(r"\s*OPENROUTER_API_KEY\s*=\s*(.+)", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    sys.exit("OPENROUTER_API_KEY missing from .env")


SKIP = set()


def pick_models():
    """Look up the current model list and pick the newest model for each family."""
    data = requests.get(f"{API}/models", timeout=60).json()["data"]

    def price(m, k):
        return float(m.get("pricing", {}).get(k, 0) or 0) * 1e6

    chosen = {}
    for fam, pattern in FAMILIES.items():
        if fam in SKIP:
            print(f"  {fam}: skipped")
            continue
        hits = [m for m in data if re.match(pattern, m["id"]) and ":" not in m["id"]]
        if not hits and fam in LOOSE:
            loose, cap = LOOSE[fam]
            hits = [m for m in data if re.match(loose, m["id"]) and ":" not in m["id"] and 0 < price(m, "completion") <= cap]
        if not hits:
            print(f"  {fam}: no matching model found, skipping")
            continue
        best = max(hits, key=lambda m: m.get("created", 0))
        chosen[fam] = {"id": best["id"], "in": price(best, "prompt"), "out": price(best, "completion")}
    return chosen


def load_tasks():
    t = pd.read_csv(ROOT / "data" / "processed" / "tasks.csv", dtype={"soc": str})
    t["key"] = t["task"].str.strip()
    uniq = t.assign(low=t["key"].str.lower()).drop_duplicates("low")
    return list(uniq["key"])


class Spend:
    def __init__(self):
        self.total, self.lock = 0.0, threading.Lock()

    def add(self, x):
        with self.lock:
            self.total += x
            return self.total


def rate_batch(key, model, tasks, spend, costs):
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(tasks))
    body = {
        "model": model,
        "messages": [{"role": "system", "content": RUBRIC}, {"role": "user", "content": numbered}],
        "temperature": 0,
        "usage": {"include": True},
        # Hidden "thinking" is billed as output, so switch it off where the model allows
        "reasoning": {"enabled": False},
    }
    headers = {"Authorization": f"Bearer {key}", "X-Title": "eezejobs research"}
    for attempt in range(4):
        try:
            r = requests.post(f"{API}/chat/completions", json=body, headers=headers, timeout=180)
            if r.status_code == 402:
                raise SystemExit("OpenRouter says you're out of credits. Add credits and run again.")
            # Some models don't accept every option. Drop the extras one at a time and try again
            if r.status_code == 400 and "reasoning" in body:
                body.pop("reasoning")
                continue
            if r.status_code == 400 and "response_format" in body:
                body.pop("response_format")
                continue
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            j = r.json()
            cost = float(j.get("usage", {}).get("cost", 0) or 0)
            spend.add(cost)
            costs[model] = costs.get(model, 0) + cost
            text = j["choices"][0]["message"]["content"] or ""
            # Each answer carries its task number, so a label can never land on the wrong task
            out = {}
            for num, lab in re.findall(r"(\d+)\s*[:.)=-]\s*\**\s*(E[012])\b", text.upper()):
                i = int(num) - 1
                if 0 <= i < len(tasks):
                    out[tasks[i]] = lab
            if len(out) < len(tasks) * 0.8 and attempt < 3:
                continue
            return out
        except (requests.RequestException, ValueError, KeyError, AttributeError):
            time.sleep(3 * (attempt + 1))
    return {}


def run(limit=None, budget=BUDGET, out=OUT, offset=0):
    key = api_key()
    print("Picking the newest cheap model from each AI company...")
    models = pick_models()
    for fam, m in models.items():
        print(f"  {fam:9s} {m['id']:45s} ${m['in']:.2f} in / ${m['out']:.2f} out per million tokens")
    tasks = load_tasks()
    if limit:
        tasks = tasks[offset:offset + limit]
    out.mkdir(parents=True, exist_ok=True)
    spend, costs = Spend(), {}
    for fam, m in models.items():
        path = out / f"{fam}.jsonl"
        done = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                if row.get("model") == m["id"]:
                    done[row["task"]] = row["label"]
        todo = [t for t in tasks if t not in done]
        batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
        print(f"\n{fam}: {len(done)} already rated, {len(todo)} to go in {len(batches)} requests")
        lock = threading.Lock()
        with path.open("a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=4) as pool:
            for k, res in enumerate(pool.map(lambda b: rate_batch(key, m["id"], b, spend, costs), batches)):
                with lock:
                    for task, lab in res.items():
                        f.write(json.dumps({"model": m["id"], "task": task, "label": lab}) + "\n")
                    f.flush()
                if spend.total > budget:
                    print(f"  Stopping: spent ${spend.total:.2f}, over the ${budget:.2f} budget.")
                    return spend.total, models, len(tasks), costs
                if (k + 1) % 25 == 0:
                    print(f"  {k + 1}/{len(batches)} requests, ${spend.total:.3f} spent so far")
    return spend.total, models, len(tasks), costs


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="rate 40 tasks with each model and estimate the full cost")
    ap.add_argument("--run", action="store_true", help="rate every task")
    ap.add_argument("--list", metavar="PREFIX", help="list models whose name starts with PREFIX, like x-ai")
    ap.add_argument("--debug", metavar="MODEL", help="show one raw answer from MODEL for 5 tasks")
    ap.add_argument("--skip", nargs="*", default=[], help="AI companies to leave out, like: --skip xai")
    ap.add_argument("--grok", metavar="MODEL", help="use this exact Grok model, like x-ai/grok-4-fast")
    a = ap.parse_args()
    SKIP.update(a.skip)
    if a.grok:
        FAMILIES["xai"] = "^" + re.escape(a.grok) + "$"
    if a.debug:
        tasks = load_tasks()[:5]
        body = {"model": a.debug, "messages": [{"role": "system", "content": RUBRIC},
                {"role": "user", "content": "\n".join(f"{i + 1}. {t}" for i, t in enumerate(tasks))}], "temperature": 0}
        r = requests.post(f"{API}/chat/completions", json=body, timeout=120,
                          headers={"Authorization": f"Bearer {api_key()}"})
        print(r.status_code, r.text[:800])
    elif a.list:
        data = requests.get(f"{API}/models", timeout=60).json()["data"]
        for m in sorted(data, key=lambda m: -m.get("created", 0)):
            if m["id"].startswith(a.list):
                p = m.get("pricing", {})
                print(f"{m['id']:45s} ${float(p.get('prompt', 0)) * 1e6:6.2f} in / ${float(p.get('completion', 0)) * 1e6:6.2f} out")
    elif a.test:
        # Test on a fresh sample in its own folder, so the cost estimate is real
        n_test = 120
        cost, models, n, costs = run(limit=n_test, budget=1.0, out=OUT.parent / "ai_panel_test", offset=500)
        total_tasks = len(load_tasks())
        print(f"\nTest done: {len(models)} models x {n} tasks cost ${cost:.4f}.")
        for mid, c in costs.items():
            print(f"  {mid:45s} full run about ${c / n * total_tasks:.2f}")
        print(f"Estimated full run: about ${cost / n * total_tasks:.2f}.")
    elif a.run:
        cost, models, n, costs = run()
        print(f"\nDone. Spent ${cost:.2f} in total.")
    else:
        ap.print_help()
