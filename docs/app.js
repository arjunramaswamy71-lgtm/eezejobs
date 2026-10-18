"use strict";

/* ---------- Data and helpers ---------- */
const D = { jobs: [], bySoc: {}, companies: [], byKey: {}, series: null, tasks: null, employers: null, meta: {} };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtInt = (n) => (n == null ? "not available" : Math.round(n).toLocaleString("en-US"));
const fmtMoney = (n) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (x) => Math.round(Math.abs(x) * 100) + "%";
const upDown = (x) => (x >= 0 ? `Up ${pct(x)}` : `Down ${pct(x)}`);
const coKey = (c) => c.ticker || c.name;
const KEEP_CAPS = new Set(["IBM", "AI", "USA", "US", "AT&T", "LLC", "HP", "UPS", "CVS", "AMD", "ADP", "PNC", "BNY", "NRG"]);
const SPECIAL = { JPMORGAN: "JPMorgan", MCDONALDS: "McDonald's", EBAY: "eBay" };
/* SEC names come like "MICROSOFT CORP /DE". Make them read like normal names. */
function niceName(n) {
  n = String(n).replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").trim();
  if (n === n.toUpperCase()) {
    const small = new Set(["OF", "AND", "THE", "FOR", "IN", "ON", "AT", "TO"]);
    n = n.split(/\s+/).map((w, i) => {
      if (i > 0 && small.has(w)) return w.toLowerCase();
      if (SPECIAL[w]) return SPECIAL[w];
      if (KEEP_CAPS.has(w) || (w.length <= 2 && !small.has(w))) return w;
      return w[0] + w.slice(1).toLowerCase();
    }).join(" ");
  }
  return n;
}
const shortName = (n) => niceName(n).replace(/,?\s+(&\s+)?(Inc|Corp|Corporation|Co|Ltd|Plc|LLC|Holdings|Group|Company|N\.?V|S\.?A|AG|SE)\.?$/i, "").trim();

const GROUPS = {
  "11": "Management", "13": "Business and finance", "15": "Computers and math", "17": "Engineering",
  "19": "Science", "21": "Social services", "23": "Legal", "25": "Education", "27": "Arts, design and media",
  "29": "Healthcare", "31": "Healthcare support", "33": "Police, fire and security", "35": "Food service",
  "37": "Cleaning and grounds", "39": "Personal care", "41": "Sales", "43": "Office and admin",
  "45": "Farming and fishing", "47": "Construction", "49": "Repair and maintenance", "51": "Factory and production",
  "53": "Transportation and warehouse",
};
const SOURCES = [
  ["openai_gpt4", "ChatGPT's own rating of the tasks"],
  ["openai_human", "Human experts' rating"],
  ["anthropic_claude", "What people really use Claude for"],
  ["microsoft_copilot", "What people really use Microsoft Copilot for"],
  ["felten_aioe", "University researchers' rating"],
  ["ai_panel", "Our 5-AI panel (average)"],
];
const PANEL_NAMES = { openai: "GPT", google: "Gemini", anthropic: "Claude", meta: "Llama", deepseek: "DeepSeek", xai: "Grok" };
const ALIASES = {
  "accountant": "13-2011", "auditor": "13-2011", "cpa": "13-2011", "bookkeeper": "43-3031", "cashier": "41-2011",
  "nurse": "29-1141", "rn": "29-1141", "teacher": "25-2021", "elementary teacher": "25-2021", "high school teacher": "25-2031",
  "lawyer": "23-1011", "attorney": "23-1011", "paralegal": "23-2011", "software engineer": "15-1252",
  "software developer": "15-1252", "programmer": "15-1251", "coder": "15-1252", "web developer": "15-1254",
  "data scientist": "15-2051", "data analyst": "15-2051", "truck driver": "53-3032", "driver": "53-3032",
  "customer service": "43-4051", "call center": "43-4051", "receptionist": "43-4171", "financial analyst": "13-2051",
  "marketing": "13-1161", "marketer": "13-1161", "hr": "13-1071", "human resources": "13-1071", "recruiter": "13-1071",
  "graphic designer": "27-1024", "designer": "27-1024", "translator": "27-3091", "interpreter": "27-3091",
  "writer": "27-3043", "copywriter": "27-3043", "journalist": "27-3023", "reporter": "27-3023",
  "retail": "41-2031", "salesperson": "41-2031", "sales rep": "41-4012", "project manager": "13-1082",
  "manager": "11-1021", "electrician": "47-2111", "plumber": "47-2152", "mechanic": "49-3023", "cook": "35-2014",
  "chef": "35-1011", "waiter": "35-3031", "waitress": "35-3031", "server": "35-3031", "police": "33-3051",
  "cop": "33-3051", "pharmacist": "29-1051", "dentist": "29-1021", "realtor": "41-9022", "real estate agent": "41-9022",
  "insurance agent": "41-3021", "loan officer": "13-2072", "bank teller": "43-3071", "teller": "43-3071",
  "secretary": "43-6014", "admin assistant": "43-6014", "administrative assistant": "43-6014", "it support": "15-1232",
  "help desk": "15-1232", "warehouse": "53-7062", "social worker": "21-1021", "construction worker": "47-2061",
  "doctor": "29-1215", "physician": "29-1215", "pilot": "53-2011", "firefighter": "33-2011", "tax preparer": "13-2082",
};
const POPULAR = [["Nurse", "29-1141"], ["Teacher", "25-2021"], ["Truck driver", "53-3032"], ["Software developer", "15-1252"],
  ["Customer service", "43-4051"], ["Accountant", "13-2011"], ["Lawyer", "23-1011"], ["Cashier", "41-2011"]];

async function getJSON(name) {
  const r = await fetch(`data/${name}`);
  if (!r.ok) throw new Error(`Couldn't load ${name}`);
  return r.json();
}
async function needTasks() { if (!D.tasks) D.tasks = await getJSON("tasks.json"); return D.tasks; }
async function needEmployers() { if (!D.employers) D.employers = await getJSON("employers.json"); return D.employers; }

function level(score) {
  if (score >= 75) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}
const LEVEL_WORDS = { High: "High AI exposure", Medium: "Medium AI exposure", Low: "Low AI exposure" };

/* ---------- Job search ---------- */
function searchJobs(q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const seen = new Set();
  const add = (j) => { if (j && !seen.has(j.soc)) { seen.add(j.soc); out.push(j); } };
  if (ALIASES[q]) add(D.bySoc[ALIASES[q]]);
  for (const [k, soc] of Object.entries(ALIASES)) if (k.startsWith(q)) add(D.bySoc[soc]);
  const words = q.split(/\s+/);
  const scored = [];
  for (const j of D.jobs) {
    const t = j.title.toLowerCase();
    if (!words.every((w) => t.includes(w.replace(/s$/, "")))) continue;
    scored.push([t.startsWith(q) ? 0 : t.indexOf(words[0]), j]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].title.length - b[1].title.length);
  scored.forEach(([, j]) => add(j));
  return out.slice(0, limit);
}

function searchEmployers(q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q || !D.employers) return [];
  const starts = [], has = [];
  for (const e of D.employers) {
    const n = e[0].toLowerCase();
    if (n.startsWith(q) || e[1].toLowerCase() === q) starts.push(e);
    else if (n.includes(" " + q)) has.push(e);
    if (starts.length >= limit) break;
  }
  return starts.concat(has).slice(0, limit);
}

/* A small accessible autocomplete. onPick gets the chosen item. */
function combo(input, getItems, render, onPick) {
  const list = document.createElement("ul");
  list.className = "list";
  list.id = input.id + "-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.parentElement.appendChild(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const paint = () => {
    list.innerHTML = items.map((it, i) =>
      `<li role="option" id="${list.id}-${i}" aria-selected="${i === active}">${render(it)}</li>`).join("");
    list.hidden = !items.length;
    input.setAttribute("aria-expanded", String(!!items.length));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
  };
  input.addEventListener("input", async () => { items = await getItems(input.value); active = -1; paint(); });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { onPick(items[active]); close(); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    onPick(items[[...list.children].indexOf(li)]);
    close();
    e.preventDefault();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

/* ---------- Charts ---------- */
function lineChart(dates, series, yFmt, opts = {}) {
  const W = 760, H = 260, L = 64, R = 16, T = 14, B = 34;
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  let lo = Math.min(...all, opts.base ?? Infinity), hi = Math.max(...all, opts.base ?? -Infinity);
  // Round the axis to friendly numbers like 500, 1,000, 1,500
  const raw = (hi - lo) / 4 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (i) => L + (i / (dates.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    grid.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`);
  }
  const years = [];
  dates.forEach((d, i) => { if (d.endsWith("-01")) years.push(`<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${d.slice(0, 4)}</text>`); });
  const base = opts.base != null ? `<line x1="${L}" x2="${W - R}" y1="${y(opts.base)}" y2="${y(opts.base)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="4 4"/>` : "";
  const paths = series.map((s) => {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");
  const id = "c" + Math.random().toString(36).slice(2);
  const svg = `<div class="chart-wrap" id="${id}">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Chart")}">
      ${grid.join("")}${years.join("")}${base}${paths}
      <line class="hover-line" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="currentColor" stroke-opacity=".3" style="display:none"/>
      ${series.map((s, k) => `<circle class="hover-dot" data-k="${k}" r="5" fill="${s.color}" stroke="var(--card)" stroke-width="2" style="display:none"/>`).join("")}
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/>
    </svg><div class="tip"></div></div>
    <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  setTimeout(() => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    const svgEl = $("svg", wrap), tip = $(".tip", wrap), line = $(".hover-line", wrap);
    const dots = [...wrap.querySelectorAll(".hover-dot")];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const show = (evt) => {
      const r = svgEl.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - L) / (W - L - R)) * (dates.length - 1))));
      line.setAttribute("x1", x(i)); line.setAttribute("x2", x(i)); line.style.display = "";
      dots.forEach((dot, k) => {
        const v = series[k].values[i];
        if (v == null) { dot.style.display = "none"; return; }
        dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(v)); dot.style.display = "";
      });
      const [yy, mm] = dates[i].split("-");
      tip.innerHTML = `<b>${MONTHS[+mm - 1]} ${yy}</b><br>` + series.map((s) =>
        `<span style="color:${s.color}">●</span> ${esc(s.name)}: <b>${s.values[i] == null ? "n/a" : esc(yFmt(s.values[i]))}</b>`).join("<br>");
      tip.style.display = "block";
      const left = (x(i) / W) * r.width;
      tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth - 4) + "px";
      tip.style.top = "8px";
    };
    const hide = () => { tip.style.display = "none"; line.style.display = "none"; dots.forEach((d) => (d.style.display = "none")); };
    const hit = $(".hit", wrap);
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", hide);
  });
  return svg;
}

/* ---------- Pieces ---------- */
function logo(c) {
  const letter = esc(c.name[0]);
  if (!c.site) return `<div class="logo">${letter}</div>`;
  return `<div class="logo"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.site)}&sz=64" alt="" onerror="this.parentElement.textContent='${letter}'"></div>`;
}

const CHECK_WORDS = {
  above_200: "Price is above its 200-day average",
  "50_over_200": "Short-term trend is above the long-term trend",
  momentum_12m: "Up over the past year",
  beat_market_3m: "Beat the S&P 500 over the last 3 months",
};
const SIG_CLASS = { "Strong uptrend": "s4", Uptrend: "s3", Mixed: "s2", Downtrend: "s1" };
function signalBadge(c) {
  if (!c.signal) return "";
  return `<span class="sig ${SIG_CLASS[c.signal.label]}" title="Trend signal from recent price moves">${c.signal.label}</span>`;
}
function signalDetail(c) {
  if (!c.signal) return "";
  const rows = Object.entries(c.signal.checks).map(([k, v]) =>
    `<li>${v ? "✓" : "✗"} ${CHECK_WORDS[k]}</li>`).join("");
  return `<div class="sigbox"><b>Trend signal: ${c.signal.label}</b> (${c.signal.score} of 4 checks)<ul>${rows}</ul>
    <p class="small">Based only on recent price moves. In our test since 2021, these signals were right about as often as a coin flip. <a href="#/signals">See the track record</a>. Not a recommendation to buy or sell.</p></div>`;
}

function companyLinks(c, cik) {
  const out = [];
  if (c.site) out.push(`<a href="https://${esc(c.site)}" target="_blank" rel="noopener">Company website</a>`);
  if (c.ticker) {
    out.push(`<a href="https://finance.yahoo.com/quote/${encodeURIComponent(c.ticker)}" target="_blank" rel="noopener">Stock price on Yahoo Finance</a>`);
    const q = cik ? `CIK=${cik}` : `CIK=${encodeURIComponent(c.ticker)}`;
    out.push(`<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&${q}" target="_blank" rel="noopener">Official SEC filings</a>`);
  }
  out.push(`<a href="https://news.google.com/search?q=${encodeURIComponent(`"${c.name}" AI`)}" target="_blank" rel="noopener">Latest AI news</a>`);
  return `<div class="links">${out.join("")}</div>`;
}

function companyRow(c, open = false) {
  const key = coKey(c);
  const chg = c.public && c.since_chatgpt != null
    ? `<div class="chg ${c.since_chatgpt >= 0 ? "up" : "down"}">${c.since_chatgpt >= 0 ? "▲" : "▼"} ${upDown(c.since_chatgpt)}<small>since ChatGPT came out</small></div>`
    : c.public ? `<div class="chg"><small>Price coming soon</small></div>` : `<div class="chg private">Private<small>no stock to buy</small></div>`;
  const tick = c.ticker ? `<a class="tick" href="https://finance.yahoo.com/quote/${encodeURIComponent(c.ticker)}" target="_blank" rel="noopener" title="See ${esc(c.name)} stock">${esc(c.ticker)}</a>` : "";
  const more = `<div class="co-more" ${open ? "" : "hidden"}>
      ${c.public && c.one_year != null ? `<p class="muted">${upDown(c.one_year)} in the last 12 months. Latest price ${fmtMoney(c.price)} per share.</p>` : ""}
      ${!c.public ? `<p class="muted">${esc(c.backer)}.</p>` : ""}
      ${signalDetail(c)}
      ${companyLinks(c)}
      <p class="small" style="margin-top:10px"><a href="#/company/${encodeURIComponent(key)}">See which jobs ${esc(c.name)}'s AI targets</a></p>
    </div>`;
  return `<div class="co">
    <div class="co-row">${logo(c)}
      <div><span class="co-name">${esc(c.name)}</span>${tick}${signalBadge(c)}
        <div class="co-what">${esc(c.what)}</div>
        <button class="toggle" aria-expanded="${open}">${open ? "Hide details" : "Company info and links"}</button>
      </div>${chg}
    </div>${more}</div>`;
}

function wireToggles(root) {
  root.querySelectorAll(".co .toggle").forEach((b) => b.addEventListener("click", () => {
    const more = b.closest(".co").querySelector(".co-more");
    more.hidden = !more.hidden;
    b.setAttribute("aria-expanded", String(!more.hidden));
    b.textContent = more.hidden ? "Company info and links" : "Hide details";
  }));
}

/* ---------- Pages ---------- */
function mapLegend(extra = "") {
  return `<div class="u-legend"><span>Safer<span class="ramp" aria-hidden="true"></span>More exposed to AI</span>
    <span class="sz"><i style="width:5px;height:5px"></i><i style="width:10px;height:10px"></i> Bigger dot = more workers</span>${extra}</div>`;
}

function homePage() {
  const m = D.meta;
  return `
  <div class="band"><div class="band-in hero">
    <div>
      <p class="eyebrow">Free · ${m.jobs} US jobs · 10 viewpoints</p>
      <h1>See how much of your job <em>AI can already do.</em></h1>
      <p class="lede">Type your job. In plain English, we'll show which parts AI handles, which parts still need you, and who's making money from it.</p>
      <form class="ask" id="ask" novalidate>
        <div class="field"><label for="q-job">What's your job?</label>
          <div class="combo"><input id="q-job" type="text" autocomplete="off" placeholder="Nurse, truck driver, accountant…"></div>
          <p class="err" id="job-err" hidden></p></div>
        <div class="field"><label for="q-emp">Where do you work? <span class="hint">Optional</span></label>
          <div class="combo"><input id="q-emp" type="text" autocomplete="off" placeholder="Company name"></div></div>
        <div><button class="btn" type="submit">Check my job</button></div>
      </form>
      <div class="chips"><span class="muted">Or try:</span>${POPULAR.map(([n, s]) => `<a class="chip" data-soc="${s}" href="#/job/${s}">${n}</a>`).join("")}</div>
    </div>
    <div class="hero-map">
      <div id="umap"></div>
      ${mapLegend(`<span>Every dot is a job. Point at one to see it.</span>`)}
    </div>
  </div></div>
  <div class="facts">
    <div class="fact"><div class="big">${Math.round(m.workers_high / 1e6)} million</div><p>Americans work in jobs where AI can do or help with much of the work.</p></div>
    <div class="fact"><div class="big">${m.jobs}</div><p>jobs checked, covering nearly every kind of work in the US.</p></div>
    <div class="fact"><div class="big">10</div><p>viewpoints: real ChatGPT, Claude and Copilot usage, human experts, researchers, and our own panel of 5 AI models.</p></div>
  </div>
  <h2 class="section-title">Keep exploring</h2>
  <div class="teasers">
    <a class="teaser" href="#/majors"><h3>College majors</h3><p>Which majors lead to the most AI-exposed jobs, with every Virginia Tech major ranked.</p><span class="go">See the majors →</span></a>
    <a class="teaser" href="#/companies"><h3>Who sells the AI</h3><p>The public companies getting paid when AI does the work, and how their stocks have moved.</p><span class="go">See the companies →</span></a>
    <a class="teaser" href="#/research"><h3>What we found</h3><p>Better-paid jobs are more exposed, and five AIs disagree on how much. The full research.</p><span class="go">Read the findings →</span></a>
  </div>`;
}

function wireHome() {
  const job = $("#q-job"), emp = $("#q-emp");
  let picked = null;
  U = Universe.mount($("#umap"), D.jobs, { onPick: (j) => (location.hash = `#/job/${j.soc}`) });
  const light = () => {
    const q = job.value.trim();
    U.setMatch(q.length >= 2 ? new Set(searchJobs(q, 80).map((j) => j.soc)) : null);
  };
  job.addEventListener("input", light);
  document.querySelectorAll(".chip[data-soc]").forEach((c) => {
    c.addEventListener("mouseenter", () => U.setMatch(new Set([c.dataset.soc])));
    c.addEventListener("mouseleave", light);
  });
  combo(job, async (q) => searchJobs(q), (j) => `${esc(j.title)}`, (j) => { picked = j; job.value = j.title; $("#job-err").hidden = true; });
  job.addEventListener("input", () => (picked = null));
  emp.addEventListener("focus", () => needEmployers().catch(() => {}), { once: true });
  combo(emp, async (q) => { await needEmployers().catch(() => {}); return searchEmployers(q); },
    (e) => `${esc(niceName(e[0]))} <span class="sub">${esc(e[1])}</span>`, (e) => { emp.value = shortName(e[0]); });
  $("#ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const j = picked || searchJobs(job.value, 1)[0];
    if (!j) {
      $("#job-err").textContent = job.value.trim() ? "We couldn't find that job. Try a simpler word, like nurse or driver." : "Type your job first.";
      $("#job-err").hidden = false;
      job.focus();
      return;
    }
    const at = emp.value.trim();
    location.hash = `#/job/${j.soc}` + (at ? `?at=${encodeURIComponent(at)}` : "");
  });
}

function verdictText(j) {
  const t = j.tasks, total = t.can + t.helps + t.you;
  if (!total) return "We don't have a task list for this job yet.";
  if (t.can) return `AI can already do ${t.can} of your ${total} main tasks, and can help with ${t.helps} more.`;
  if (t.helps) return `AI can't fully do your tasks yet, but it can help with ${t.helps} of your ${total}.`;
  return `AI can't do much of your work yet. All ${total} of your main tasks still need a person.`;
}

function saferSection(j) {
  const picks = (j.safer || []).map(([soc, , rel, shared]) => ({ o: D.bySoc[soc], rel, shared })).filter((p) => p.o);
  if (!picks.length) {
    return `<section class="block"><h2>Safer jobs near yours</h2>
      <p class="muted">We didn't find a nearby job that uses similar skills, pays about the same, and is clearly less exposed to AI. You can browse <a href="#/jobs">all jobs</a> sorted by AI exposure.</p></section>`;
  }
  return `<section class="block"><h2>Safer jobs near yours</h2>
    <p class="muted">Jobs that use similar skills, need a similar level of training, pay about the same or more, and are less exposed to AI.</p>
    <div class="safer">${picks.map(({ o, rel, shared }) => `
      <a class="safe-card" href="#/job/${o.soc}">
        <span class="safe-title">${esc(o.title)}</span>
        <span class="safe-nums"><b>${Math.round(o.score)}</b> AI exposure <span class="muted">vs ${Math.round(j.score)} for you</span></span>
        ${o.median_pay ? `<span class="safe-nums">Typical pay ${fmtMoney(o.median_pay)}${j.median_pay ? ` <span class="${o.median_pay >= j.median_pay ? "up" : "muted"}">(${o.median_pay >= j.median_pay ? "+" : ""}${fmtMoney(o.median_pay - j.median_pay).replace("$-", "-$")})</span>` : ""}</span>` : ""}
        ${shared && shared.length ? `<span class="small">Skills you already use: ${esc(shared.join(", "))}</span>` : ""}
        ${rel ? `<span class="tag">Officially related job</span>` : ""}
      </a>`).join("")}</div>
    <p class="small" style="margin-top:12px">"Officially related" means the US Labor Department lists it as a related job. Switching may still need some training.</p>
  </section>`;
}

function advice(j) {
  const lv = level(j.score);
  const items = {
    High: ["Learn the AI tools for the tasks marked red and orange. People who use them well tend to replace people who don't.",
      "Spend more of your time on the tasks marked green. That's where you're hardest to replace.",
      "Keep your resume current and your skills easy to carry to a nearby job."],
    Medium: ["Try the AI tools for the tasks marked orange. They can save you hours each week.",
      "The tasks marked green are your strength. Make them a bigger part of your role.",
      "Watch how your company is using AI, so changes don't surprise you."],
    Low: ["Most of your work still needs a person. That's a good position to be in.",
      "AI may still change the paperwork side of your job, so it's worth learning the basics.",
      "Hands-on and people skills are your edge. Keep building them."],
  }[lv];
  return `<div class="advice"><h2>What this means for you</h2><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    <p class="small" style="margin:10px 0 0">General guidance, not personal career or financial advice.</p></div>`;
}

async function jobPage(soc, at) {
  const j = D.bySoc[soc];
  if (!j) return `<p class="back"><a href="#/">Back</a></p><h1>We couldn't find that job.</h1><p class="muted">Try searching again from the start page.</p>`;
  const tasks = (await needTasks())[soc] || [];
  await needImplied().catch(() => null);
  const lv = level(j.score);
  const t = j.tasks, total = t.can + t.helps + t.you || 1;
  const col = { can: "var(--can)", helps: "var(--helps)", you: "var(--you)" };
  const byB = (b) => tasks.filter((x) => x[1] === b).sort((a, c) => c[2] - a[2]);
  const aiTasks = byB("can").concat(byB("helps"));
  const youTasks = byB("you");
  const li = (x) => `<li style="--c:${col[x[1]]}">${esc(x[0])}</li>`;
  const companies = j.companies.map((k) => D.byKey[k]).filter(Boolean);
  const specific = companies.filter((c) => !c.groups.includes("ALL"));
  const platforms = companies.filter((c) => c.groups.includes("ALL"));
  document.title = `${j.title}: AI exposure | HedgeMyJob`;

  const hasSafer = (j.safer || []).some(([s]) => D.bySoc[s]);
  return `
  <div class="band"><div class="band-in report-band">
    <div class="report-head">
      <a class="back" href="#/">← Check another job</a>
      <h1>${esc(j.title)}</h1>
      <p class="meta">${j.workers ? `${fmtInt(j.workers)} people in the US do this job` : "US job"}${j.median_pay ? `. Typical pay ${fmtMoney(j.median_pay)} a year.` : "."}</p>
      <div class="score-big"><div class="orb" id="orb" title="The orb glows hotter and churns faster the more of this job AI can touch"></div><span class="n">${Math.round(j.score)}</span><span class="of">out of 100<br>AI exposure score</span></div>
      <span class="level ${lv}">${LEVEL_WORDS[lv]}</span>
      <p class="verdict">${verdictText(j)}</p>
      <p class="muted">More exposed than ${Math.round(j.score)} out of 100 jobs.</p>
    </div>
    <div>
      <div id="umap"></div>
      ${mapLegend(`<span><i class="pulse" aria-hidden="true"></i>Your job</span>${hasSafer ? `<span><i class="link" aria-hidden="true"></i>Safer jobs near yours</span>` : ""}`)}
    </div>
  </div></div>

  <div class="split" aria-hidden="true">
    <div class="k-can" style="flex:${t.can}"></div><div class="k-helps" style="flex:${t.helps}"></div><div class="k-you" style="flex:${t.you}"></div>
  </div>
  <div class="key">
    <span><i class="dot k-can"></i>AI can do it: ${t.can}</span>
    <span><i class="dot k-helps"></i>AI can help: ${t.helps}</span>
    <span><i class="dot k-you"></i>Still needs you: ${t.you}</span>
  </div>

  <section class="block">
    <h2>Your tasks, one by one</h2>
    <p class="muted">Each task is rated using what AI can do today and what people actually use it for.</p>
    <div class="cols">
      <div><h3>AI can do or help with</h3><ul class="tasklist">${aiTasks.slice(0, 6).map(li).join("") || "<li>None found</li>"}</ul></div>
      <div><h3>Still needs you</h3><ul class="tasklist">${youTasks.slice(0, 6).map(li).join("") || "<li>None found</li>"}</ul></div>
    </div>
    ${tasks.length > 12 ? `<details><summary>Show all ${tasks.length} tasks</summary><ul class="tasklist" style="margin-top:12px">${aiTasks.concat(youTasks).map(li).join("")}</ul></details>` : ""}
  </section>

  ${advice(j)}

  ${saferSection(j)}

  ${at ? `<section class="block" id="employer"><h2>Your employer: ${esc(at)}</h2><p class="muted">Looking it up…</p></section>` : `
  <section class="block"><h2>Add where you work</h2>
    <p class="muted">See your company's stock, filings and latest AI news. We don't save it.</p>
    <form id="add-emp" class="tools"><div class="combo" style="flex:1 1 260px"><input id="q-emp2" type="text" autocomplete="off" placeholder="Company name" aria-label="Where you work"></div>
    <button class="btn" type="submit">Add</button></form></section>`}

  <section class="block">
    <h2>Who's selling the AI that does this work</h2>
    <p class="muted">If AI takes on more of this job, these companies get paid for it. Tap a company for its stock, website and news.</p>
    ${specific.length ? specific.map((c) => companyRow(c)).join("") : `<p class="muted">No company focuses on this job yet, so the big AI platforms below are the main players.</p>`}
    <h3 style="margin-top:22px">Big AI platforms used across most jobs</h3>
    ${platforms.filter((c) => c.public).map((c) => companyRow(c)).join("")}
    <details><summary>Private AI makers you can't buy stock in</summary>
      ${platforms.filter((c) => !c.public).concat(specific.filter((c) => !c.public)).map((c) => companyRow(c)).join("")}
    </details>
  </section>

  ${hedgeSection(j)}

  ${impliedSection(soc)}

  <section class="block">
    <h2>Do the AIs agree?</h2>
    <p class="muted">We compared six sources. Further right means more exposed than other jobs. ${j.spread >= 20 ? "They disagree a lot on this job, so treat the score with care." : "They mostly agree on this job."}</p>
    <div class="agree">${SOURCES.map(([k, name]) => j.src[k] == null ? "" :
      `<div class="agree-row"><span>${name}</span><div class="track"><span style="left:${j.src[k]}%"></span></div><b>${j.src[k]}</b></div>`).join("")}</div>
    ${j.panel && Object.keys(j.panel).length ? `
    <h3 style="margin-top:24px">How each AI rated this job</h3>
    <p class="small">We asked ${Object.keys(j.panel).length} AI models to rate every task of every job, using the same rules for all of them.</p>
    <div class="agree">${Object.entries(j.panel).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div class="agree-row"><span>${esc(PANEL_NAMES[k] || k)}${D.meta.panel_models && D.meta.panel_models[k] ? ` <span class="small">${esc(D.meta.panel_models[k].split("/")[1])}</span>` : ""}</span><div class="track"><span style="left:${v}%;background:var(--helps)"></span></div><b>${v}</b></div>`).join("")}</div>` : ""}
  </section>

  <div class="share"><button class="btn quiet" id="copy">Copy link to this page</button>
    <a class="btn quiet" href="data/HedgeMyJob_model.xlsx" download>Download the Excel model</a></div>
  <p class="small">The Excel model has every job, with live formulas. Pick your job, type your pay, and it does the rest.</p>`;
}

function hedgeSection(j) {
  const S = D.series;
  const basket = (j.basket || []).filter((t) => S.prices[t]);
  if (!basket.length || !S.prices.SPY) return "";
  const n = S.dates.length;
  const bv = S.dates.map((_, i) => {
    const vals = basket.map((t) => S.prices[t][i]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const mv = S.prices.SPY;
  const endB = bv[n - 1], endM = mv[n - 1];
  const names = basket.map((t) => D.byKey[t]?.name || t);
  const better = endB > endM;
  const hire = j.sector && S.hiring[j.sector];
  const hireEnd = hire ? hire[n - 1] : null;
  return `
  <section class="block">
    <h2>Would owning these companies have helped?</h2>
    <p class="muted">Say you'd put $1,000 into the AI companies for this job (${esc(names.join(", "))}) when ChatGPT came out in November 2022.</p>
    <div class="money">
      <div><span class="muted">The AI companies</span><b class="${endB >= 1000 ? "up" : "down"}">${fmtMoney(endB)}</b></div>
      <div><span class="muted">The whole stock market (S&amp;P 500)</span><b class="${endM >= 1000 ? "up" : "down"}">${fmtMoney(endM)}</b></div>
      ${hire ? `<div><span class="muted">Job postings for ${esc(j.sector)}</span><b class="${hireEnd >= 100 ? "up" : "down"}">${hireEnd >= 100 ? "Up" : "Down"} ${Math.abs(Math.round(hireEnd - 100))}%</b></div>` : ""}
    </div>
    <p>${better ? "These AI companies did better than the overall market." : "A simple fund that tracks the whole market did better than these AI companies."}
      ${hire ? (hireEnd < 100 ? ` Meanwhile, job postings in this area fell.` : ` Job postings in this area held up.`) : ""}</p>
    ${lineChart(S.dates, [
      { name: "$1,000 in the AI companies", color: "var(--chart-ai)", values: bv },
      { name: "$1,000 in the S&P 500", color: "var(--chart-mkt)", values: mv },
    ], (v) => fmtMoney(v), { base: 1000, label: "Value of $1,000 invested since November 2022" })}
    ${hire ? `<h3 style="margin-top:26px">Job postings for ${esc(j.sector)} on Indeed</h3>
      <p class="small">November 2022 = 100. Below 100 means fewer job openings than when ChatGPT came out.</p>
      ${lineChart(S.dates, [{ name: `${j.sector} job postings`, color: "var(--helps)", values: hire }],
        (v) => Math.round(v), { base: 100, label: `Job postings index for ${j.sector}` })}` : ""}
    <p class="small" style="margin-top:14px">Past results don't predict the future. This is for learning, not a recommendation to buy anything.</p>
  </section>`;
}

async function fillEmployer(name, soc) {
  const box = $("#employer");
  if (!box) return;
  await needEmployers().catch(() => {});
  const q = name.toLowerCase();
  const hit = (D.employers || []).find((e) => e[0].toLowerCase() === q || e[1].toLowerCase() === q)
    || (D.employers || []).find((e) => e[0].toLowerCase().startsWith(q));
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(`"${name}" AI`)}`;
  const label = hit ? shortName(hit[0]) : name;
  let html = `<h2>Your employer: ${esc(label)}</h2>`;
  if (hit) {
    const c = { name: label, ticker: hit[1] };
    const seller = D.byKey[hit[1]];
    html += `<p class="muted">${esc(label)} is a public company. Its stock symbol is <b>${esc(hit[1])}</b>.</p>`;
    if (seller) {
      html += `<p>${esc(label)} also sells AI: ${esc(seller.what)}${seller.since_chatgpt != null ? ` Its stock is ${upDown(seller.since_chatgpt).toLowerCase()} since ChatGPT came out.` : ""}</p>`;
    }
    html += `<div class="note"><b>Something to know:</b> if your job and a big part of your savings both depend on ${esc(label)}, one bad year can hit you twice. Spreading savings out lowers that risk.</div>
      ${companyLinks(c, hit[2])}`;
  } else {
    html += `<p class="muted">We couldn't find ${esc(name)} on the US stock market. It may be private or listed in another country.</p>`;
  }
  html += `<h3 style="margin-top:22px">Recent AI news</h3><ul class="news" id="news"><li class="muted">Searching the news…</li></ul>`;
  box.innerHTML = html;
  loadNews(label);
}

async function loadNews(name) {
  const ul = $("#news");
  const clean = name.replace(/\b(inc|corp|corporation|co|ltd|plc|llc|holdings|group|company)\b\.?/gi, "").replace(/[,.]/g, "").trim();
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${clean}" ("artificial intelligence" OR AI)`)}&mode=artlist&maxrecords=6&format=json&sort=datedesc&timespan=3months`;
  const fallback = `<li><a href="https://news.google.com/search?q=${encodeURIComponent(`"${clean}" AI`)}" target="_blank" rel="noopener">See the latest AI news about ${esc(clean)} on Google News</a></li>`;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(url, { signal: ctl.signal });
    const data = await r.json();
    const arts = (data.articles || []).filter((a) => a.language === "English" || !a.language).slice(0, 5);
    if (!ul) return;
    ul.innerHTML = arts.length
      ? arts.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><br><span class="small">${esc(a.domain)}</span></li>`).join("") + fallback
      : `<li class="muted">No AI news found in the last 3 months.</li>${fallback}`;
  } catch {
    if (ul) ul.innerHTML = fallback;
  }
}

function jobsPage() {
  const groups = Object.entries(GROUPS);
  return `<div class="band"><div class="band-in explore">
      <div class="page-head"><h1>All ${D.jobs.length} jobs</h1>
      <p class="muted">Every dot is a job. Further right means more exposed to AI, higher up means better paid. Search or pick an area below and the map lights up those jobs.</p></div>
      <div id="umap" style="height:clamp(340px,52vh,520px)"></div>
      ${mapLegend(`<span>Click a dot to open that job.</span>`)}
    </div></div>
    <div class="tools">
      <input id="jf" type="search" placeholder="Search jobs" aria-label="Search jobs">
      <select id="jg" aria-label="Job area" class="chip"><option value="">All areas</option>${groups.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <select id="js" aria-label="Sort" class="chip"><option value="high">Most exposed first</option><option value="low">Least exposed first</option><option value="az">A to Z</option><option value="workers">Most workers</option></select>
    </div>
    <div id="jlist"></div>`;
}

function wireJobs() {
  U = Universe.mount($("#umap"), D.jobs, { onPick: (j) => (location.hash = `#/job/${j.soc}`), introMs: 1400 });
  const paint = () => {
    const q = $("#jf").value.trim().toLowerCase(), g = $("#jg").value, s = $("#js").value;
    let rows = D.jobs.filter((j) => (!g || j.soc.startsWith(g)) && (!q || j.title.toLowerCase().includes(q)));
    const sorters = { high: (a, b) => b.score - a.score, low: (a, b) => a.score - b.score,
      az: (a, b) => a.title.localeCompare(b.title), workers: (a, b) => (b.workers || 0) - (a.workers || 0) };
    rows.sort(sorters[s]);
    if (U) U.setMatch(q || g ? new Set(rows.map((j) => j.soc)) : null);
    $("#jlist").innerHTML = rows.length ? rows.map((j) => `<a class="jobrow" href="#/job/${j.soc}">
      <span>${esc(j.title)}<br><span class="small">${j.workers ? fmtInt(j.workers) + " workers" : GROUPS[j.soc.slice(0, 2)] || ""}</span></span>
      <span class="bar" aria-hidden="true"><span style="width:${j.score}%;background:${colorFor(j.score)}"></span></span>
      <b title="AI exposure score out of 100">${Math.round(j.score)}</b></a>`).join("") : `<p class="muted">No jobs match. Try a shorter word.</p>`;
  };
  ["jf", "jg", "js"].forEach((id) => $("#" + id).addEventListener("input", paint));
  paint();
}

function companiesPage() {
  const pub = D.companies.filter((c) => c.public).sort((a, b) => (b.since_chatgpt ?? -9) - (a.since_chatgpt ?? -9));
  const priv = D.companies.filter((c) => !c.public);
  return `<div class="page-head"><h1>The companies selling AI</h1>
    <p class="muted">Public companies whose AI does work people used to do, and how their stock has moved since ChatGPT came out in November 2022.</p></div>
    <div class="tools"><input id="cf" type="search" placeholder="Search companies or what they do" aria-label="Search companies"></div>
    <section class="block" id="clist">${pub.map((c) => companyRow(c)).join("")}</section>
    <section class="block"><h2>Private AI makers</h2><p class="muted">You can't buy these directly. Where a public company owns part of one, we say so.</p>
      ${priv.map((c) => companyRow(c)).join("")}</section>`;
}

function wireCompanies(root) {
  wireToggles(root);
  $("#cf").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    $("#clist").querySelectorAll(".co").forEach((el) => { el.hidden = q && !el.textContent.toLowerCase().includes(q); });
  });
}

function companyPage(key) {
  const c = D.byKey[key];
  if (!c) return `<a class="back" href="#/companies">← All AI companies</a><h1>We couldn't find that company.</h1>`;
  const all = c.groups.includes("ALL");
  const targets = all ? [] : D.jobs.filter((j) => c.groups.some((g) => j.soc.startsWith(g))).sort((a, b) => (b.workers || 0) - (a.workers || 0)).slice(0, 20);
  document.title = `${c.name} | HedgeMyJob`;
  return `<a class="back" href="#/companies">← All AI companies</a>
    <section class="block">${companyRow(c, true)}</section>
    <section class="block"><h2>Jobs ${esc(c.name)}'s AI does work for</h2>
      ${all ? `<p class="muted">${esc(c.name)} sells general AI used in almost every office job.</p>` :
        targets.map((j) => `<a class="jobrow" href="#/job/${j.soc}"><span>${esc(j.title)}<br><span class="small">${fmtInt(j.workers)} workers</span></span>
          <span class="bar" aria-hidden="true"><span style="width:${j.score}%;background:${colorFor(j.score)}"></span></span><b>${Math.round(j.score)}</b></a>`).join("")}
    </section>`;
}

function signalsPage() {
  const S = D.signals;
  const pub = D.companies.filter((c) => c.signal).sort((a, b) => b.signal.score - a.signal.score || (b.since_chatgpt ?? 0) - (a.since_chatgpt ?? 0));
  const best = S.groups.find((g) => g.label === "Strong uptrend");
  return `<div class="page-head"><h1>AI stock trend signals</h1>
    <p class="muted">A quick read on which AI companies' stocks are trending up or down, based only on recent price moves.</p></div>
    <div class="note"><b>Read this first:</b> a trend is not a prediction. In our test, when a stock had a "Strong uptrend," it beat the market over the next 3 months only ${best ? best.beat_market_pct : "about 50"}% of the time. That's about as good as a coin flip. This is for learning, not a recommendation to buy or sell anything.</div>
    <section class="block"><h2>Today's signals</h2>
      <p class="muted">Each stock gets one point for each check it passes: above its 200-day average, short-term trend above long-term, up over the past year, and beating the S&amp;P 500 over 3 months.</p>
      ${pub.map((c) => companyRow(c)).join("")}</section>
    <section class="block"><h2>How well these signals worked in the past</h2>
      <p class="muted">We checked every month from ${esc(S.from)} to ${esc(S.to)} across ${S.stocks} AI stocks, then looked at the next 3 months.</p>
      <div class="sigtable" role="table">
        <div role="row" class="sh"><span role="columnheader">Signal</span><span role="columnheader">Times seen</span><span role="columnheader">Beat the market</span><span role="columnheader">Average 3-month return</span><span role="columnheader">Versus the market</span></div>
        ${S.groups.map((g) => `<div role="row"><span role="cell"><span class="sig ${SIG_CLASS[g.label]}">${g.label}</span></span><span role="cell">${g.times.toLocaleString()}</span><span role="cell"><b>${g.beat_market_pct}%</b> of the time</span><span role="cell">${g.avg_3m_return_pct > 0 ? "+" : ""}${g.avg_3m_return_pct}%</span><span role="cell">${g.avg_vs_market_pct > 0 ? "+" : ""}${g.avg_vs_market_pct}%</span></div>`).join("")}
      </div>
      <p style="margin-top:16px">What it means: the trend labels describe the past well, but they barely predict the next few months. Simple price trends are widely watched, so most of their edge is already priced in.</p>
    </section>`;
}

const SOURCE_NAMES = {
  anthropic_claude: "Real Claude usage", microsoft_copilot: "Real Copilot usage", openai_gpt4: "ChatGPT's own rating",
  openai_human: "Human experts", felten_aioe: "University researchers", ai_panel: "Our 5-AI panel (average)",
  panel_openai: "GPT (our panel)", panel_google: "Gemini (our panel)", panel_anthropic: "Claude (our panel)",
  panel_meta: "Llama (our panel)", panel_deepseek: "DeepSeek (our panel)", panel_xai: "Grok (our panel)",
};

async function researchPage() {
  let R;
  try { R = await getJSON("research.json"); } catch {
    return `<div class="page-head"><h1>Research findings</h1></div><p class="muted">The research results haven't been generated yet.</p>`;
  }
  const q1 = R.exposure_vs_hiring, q3 = R.ai_agreement || {}, q4 = R.pay_vs_exposure;
  const dir = q1.slope_per_10_points < 0 ? "fell" : "rose";
  const sig = q1.p_value < 0.05;
  const avg = q3.average_exposure_by_model || {};
  const avgRows = Object.entries(avg).sort((a, b) => b[1] - a[1]);
  const srcs = (R.sources_vs_hiring || []).slice().sort((a, b) => a.correlation - b.correlation);
  return `<div class="page-head"><h1>Research findings</h1>
    <p class="muted">What the data says when you put all of it together. Statistics run in R on ${q1.sectors} job sectors and ${R.sectors ? R.sectors.length : ""} hiring series from Indeed.</p></div>

  <section class="block"><h2>1. Did AI-exposed fields lose more hiring?</h2>
    <p class="verdict" style="font-size:1.4rem;margin:10px 0">${sig
      ? `Yes. For every 10 points more AI exposure, job postings ${dir} about ${Math.abs(q1.slope_per_10_points)} percentage points more since ChatGPT came out.`
      : `Not clearly. More exposed fields didn't lose clearly more hiring than less exposed ones.`}</p>
    <p class="muted">Correlation ${q1.correlation}, R² ${q1.r_squared}, p-value ${q1.p_value}${sig ? " (statistically significant)" : " (not statistically significant)"}. Hiring also fell for reasons that have nothing to do with AI, like interest rates, so this shows a link, not proof of cause.</p>
    <img src="data/sector_exposure_vs_hiring.png" alt="Scatter chart of AI exposure against change in job postings by sector" style="width:100%;border-radius:10px;margin-top:10px" onerror="this.remove()">
  </section>

  <section class="block"><h2>2. Which way of measuring AI exposure tracks hiring best?</h2>
    <p class="muted">A more negative number means fields that source calls exposed lost more hiring.</p>
    <div class="sigtable" role="table">
      <div role="row" class="sh" style="grid-template-columns:2fr 1fr 1fr"><span role="columnheader">Source</span><span role="columnheader">Link to hiring change</span><span role="columnheader">p-value</span></div>
      ${srcs.map((x) => `<div role="row" style="grid-template-columns:2fr 1fr 1fr"><span role="cell">${esc(SOURCE_NAMES[x.source] || x.source)}</span><span role="cell"><b>${x.correlation}</b></span><span role="cell">${x.p_value}</span></div>`).join("")}
    </div>
  </section>

  ${avgRows.length ? `<section class="block"><h2>3. Do the AI models agree?</h2>
    <p class="verdict" style="font-size:1.4rem;margin:10px 0">They agree on which jobs are most exposed (rank agreement ${q3.average_rank_agreement} out of 1), but not on how much.</p>
    <p class="muted">Average share of a job's work each AI says it can do or speed up:</p>
    <div class="agree">${avgRows.map(([k, v]) => `<div class="agree-row"><span>${esc(PANEL_NAMES[k] || k)}</span><div class="track"><span style="left:${v}%;background:var(--helps)"></span></div><b>${v}</b></div>`).join("")}</div>
  </section>` : ""}

  <section class="block"><h2>4. Are better-paid jobs more exposed?</h2>
    <p class="verdict" style="font-size:1.4rem;margin:10px 0">${q4.pay_change_per_10_points_pct > 0
      ? `Yes. Every 10 points of AI exposure goes with about ${q4.pay_change_per_10_points_pct}% higher typical pay.`
      : `No. More exposed jobs tend to pay ${Math.abs(q4.pay_change_per_10_points_pct)}% less per 10 points of exposure.`}</p>
    <div class="agree">${Object.entries(q4.exposure_by_pay_fifth).map(([k, v]) => `<div class="agree-row"><span>${esc(k)}</span><div class="track"><span style="left:${v}%"></span></div><b>${v}</b></div>`).join("")}</div>
    <p class="small">AI exposure score, weighted by how many people do each job.</p>
  </section>
  ${await quantSection()}`;
}

async function quantSection() {
  let Q;
  try { Q = await getJSON("quant.json"); } catch { return ""; }
  const cols = "1.8fr 1fr 1fr 0.8fr 1fr 0.8fr";
  const row = (b, head) => `<div role="row" class="${head ? "sh" : ""}" style="grid-template-columns:${cols}">
    ${head ? b.map((h) => `<span role="columnheader">${h}</span>`).join("") :
      `<span role="cell"><b>${esc(b.name)}</b></span><span role="cell">${b.yearly_return}%</span><span role="cell">${b.yearly_volatility}%</span>
       <span role="cell">${b.sharpe}</span><span role="cell">-${b.max_drawdown}%</span><span role="cell">${b.beta_vs_market}</span>`}</div>`;
  return `<section class="block"><h2>5. How risky were the AI stocks?</h2>
    <p class="muted">Fund-style statistics since ChatGPT came out, calculated in R with PerformanceAnalytics. Each basket holds its stocks in equal amounts, rebalanced monthly.</p>
    <div class="sigtable" role="table">
      ${row(["Basket", "Yearly return", "Yearly ups and downs", "Sharpe ratio", "Worst drop", "Beta"], true)}
      ${Q.baskets.map((b) => row(b)).join("")}
    </div>
    <details><summary>What these numbers mean</summary>
      <ul class="small" style="margin-top:8px">
        <li><b>Yearly ups and downs</b> (volatility): how much the price swings. Higher means a bumpier ride.</li>
        <li><b>Sharpe ratio</b>: return earned per unit of risk, after the ${Q.risk_free_yearly_pct}% you'd get from safe Treasury bills. Above 1 is strong.</li>
        <li><b>Worst drop</b> (max drawdown): the biggest fall from a peak before recovering.</li>
        <li><b>Beta</b>: how much it moves with the market. 1.5 means about 1.5 times the market's moves.</li>
      </ul></details>
    <img src="data/quant_performance.png" alt="Growth of $1, daily returns and drawdowns for each AI basket and the S&P 500" style="width:100%;border-radius:10px;margin-top:14px" onerror="this.remove()">
    <p class="small" style="margin-top:10px">Past results, not predictions. Not a recommendation to buy or sell.</p>
  </section>`;
}

function aboutPage() {
  return `<div class="page-head"><h1>How it works</h1></div>
  <section class="block"><h2>The score</h2>
    <p>Every job is a list of tasks, from the US Labor Department's job database (O*NET). For each job we check six sources:</p>
    <ul>
      <li><b>ChatGPT's own rating</b> and <b>human experts' rating</b> of which tasks AI can speed up, from OpenAI's "GPTs are GPTs" study.</li>
      <li><b>What people really use Claude for</b>, from Anthropic's Economic Index.</li>
      <li><b>What people really use Microsoft Copilot for</b>, from Microsoft's "Working with AI" study.</li>
      <li><b>University researchers' rating</b>, from Felten, Raj and Seamans, who matched AI progress to job skills.</li>
      <li><b>Our own 5-AI panel.</b> We asked GPT, Gemini, Claude, Llama and DeepSeek to rate all 18,000+ job tasks with the same rules OpenAI's researchers used. Each AI's rating is shown on every job page, so you can see where they disagree.</li>
    </ul>
    <p>Each source ranks all jobs. We average those rankings into one score from 0 to 100. A score of 84 means the job is more exposed than 84 out of 100 jobs.</p>
  </section>
  <section class="block"><h2>The companies</h2>
    <p>We matched public companies to the kinds of work their AI does, like Intuit for bookkeeping or Thomson Reuters for legal research. Stock prices come from Yahoo Finance. Job postings come from Indeed Hiring Lab. Jobs and pay come from the Bureau of Labor Statistics (May 2025).</p>
  </section>
  <section class="block"><h2>What it can't tell you</h2>
    <ul><li>Exposed doesn't mean replaced. Many exposed jobs will change, not disappear.</li>
      <li>Your own job may differ from the average version of it.</li>
      <li>Past stock prices don't predict future ones. Nothing here is a recommendation to buy or sell.</li></ul>
  </section>
  <section class="block"><h2>Your privacy</h2><p>Everything runs in your browser. We don't save your job or employer, and there are no accounts or ads.</p></section>`;
}

/* ---------- College majors ---------- */
const colorFor = (sc) => ({ High: "var(--can)", Medium: "var(--helps)", Low: "var(--you)" }[level(sc)]);

async function majorsPage() {
  if (!D.majors) D.majors = await getJSON("majors.json");
  const S = D.majors.summary;
  return `<div class="page-head"><h1>College majors and AI</h1>
    <p class="muted">Each major is linked to the jobs its graduates usually go into, using the government's official major-to-job list.
    A major's score is the average AI exposure of those jobs, weighted by how many people work in each. Tap a major to see its jobs.</p></div>
    <div class="facts" style="padding:12px 0 18px">
      <div class="fact"><div class="big">${S.vt_avg}</div><p>average score for a Virginia Tech graduate, out of 100 (all US graduates: ${S.us_avg})</p></div>
      <div class="fact"><div class="big">${S.vt_high_share}%</div><p>of VT's ${fmtInt(S.vt_grads)} bachelor's graduates in ${S.year} studied a major scoring 75 or more (high exposure)</p></div>
      <div class="fact"><div class="big">${S.vt_majors}</div><p>VT majors ranked, out of ${fmtInt(S.us_majors)} majors offered across the US</p></div>
    </div>
    <div class="tools">
      <div class="seg" role="group" aria-label="Which colleges">
        <button class="chip" data-where="vt" aria-pressed="true">Virginia Tech</button>
        <button class="chip" data-where="us" aria-pressed="false">All US colleges</button>
      </div>
      <input id="mf" type="search" placeholder="Search majors, like finance or nursing" aria-label="Search majors">
      <select id="ms" aria-label="Sort" class="chip"><option value="high">Most exposed first</option><option value="low">Least exposed first</option><option value="grads">Most graduates</option><option value="pay">Best paid jobs</option><option value="az">A to Z</option></select>
    </div>
    <div id="mlist"></div>
    <p class="small" style="margin-top:18px">Graduates are bachelor's degrees (first major) from the US Department of Education, ${S.year}. Jobs come from the NCES CIP 2020 to SOC 2018 crosswalk.
    College teaching jobs are left out because almost every major links to them. A high score means AI can do or help with much of the work in these jobs, not that the jobs will disappear.</p>`;
}

function majorJobs(m) {
  const jobs = m.jobs.map((soc) => D.bySoc[soc]).filter(Boolean);
  return `<div class="maj-more">
    <p class="muted">${m.high_share}% of people in these jobs are in high-exposure work.${m.pay ? ` Typical pay across them: <b>${fmtMoney(m.pay)}</b> a year.` : ""}
    ${m.n_jobs > jobs.length ? `Showing the ${jobs.length} biggest of ${m.n_jobs} jobs.` : ""}${m.n_jobs <= 2 ? " The official list links this major to only a few jobs, so treat this score as rough." : ""}
    ${m.vt_name && m.vt_name !== m.name ? `<br><span class="small">Reported to the government as: ${esc(m.name)}</span>` : ""}</p>
    ${jobs.map((j) => `<a class="jobrow" href="#/job/${j.soc}"><span>${esc(j.title)}<br><span class="small">${j.workers ? fmtInt(j.workers) + " workers" : ""}${j.median_pay ? " · " + fmtMoney(j.median_pay) : ""}</span></span>
      <span class="bar" aria-hidden="true"><span style="width:${j.score}%;background:${colorFor(j.score)}"></span></span><b>${Math.round(j.score)}</b></a>`).join("")}
  </div>`;
}

function wireMajors() {
  let where = "vt";
  const paint = () => {
    const q = $("#mf").value.trim().toLowerCase(), s = $("#ms").value;
    const key = where === "vt" ? "vt_grads" : "us_grads";
    let rows = D.majors.majors.filter((m) => m[key] > 0 && (!q || (m.name + " " + (m.vt_name || "") + " " + m.family).toLowerCase().includes(q)));
    const title = (m) => (where === "vt" && m.vt_name) || m.name;
    const sorters = { high: (a, b) => b.score - a.score, low: (a, b) => a.score - b.score, grads: (a, b) => b[key] - a[key],
      pay: (a, b) => (b.pay || 0) - (a.pay || 0), az: (a, b) => title(a).localeCompare(title(b)) };
    rows.sort(sorters[s]);
    $("#mlist").innerHTML = rows.length ? rows.map((m) => `<details class="maj"><summary class="jobrow">
      <span>${esc(title(m))}<br><span class="small">${esc(m.family)} · ${fmtInt(m[key])} graduates${where === "vt" ? " at VT a year" : " a year"}</span></span>
      <span class="bar" aria-hidden="true"><span style="width:${m.score}%;background:${colorFor(m.score)}"></span></span>
      <b title="AI exposure score out of 100">${Math.round(m.score)}</b></summary>${majorJobs(m)}</details>`).join("")
      : `<p class="muted">No majors match. Try a shorter word.</p>`;
  };
  document.querySelectorAll("[data-where]").forEach((b) => b.addEventListener("click", () => {
    where = b.dataset.where;
    document.querySelectorAll("[data-where]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    paint();
  }));
  ["mf", "ms"].forEach((id) => $("#" + id).addEventListener("input", paint));
  paint();
}

/* ---------- Implied Automation: what the stock market is betting AI will do ---------- */
async function needImplied() { if (!D.implied) D.implied = await getJSON("implied.json"); return D.implied; }
const pct1 = (x) => (x == null ? "n/a" : (x * 100).toFixed(x * 100 < 0.1 ? 2 : x * 100 < 10 ? 1 : 0) + "%");
const bn = (x) => (x >= 1000 ? `$${(x / 1000).toFixed(1)} trillion` : `$${Math.round(x)} billion`);

const PIPELINE = [
  ["q / kdb+", "Lines up 50,000 daily prices with 7,000 SEC filings by the date each was filed, so the model never sees the future. Rolling betas with vectorised moving sums."],
  ["OCaml", "Reverse discounted cash flow. Brent's root-finding method solves the growth rate each AI stock is pricing in, for 1,734 company-months."],
  ["APL", "Matrix maths that spreads each company's extra AI revenue over the 775 jobs its AI does work for, in three capture-rate scenarios."],
  ["Stan", "A Bayesian hierarchical model of how employment really changed from 2022 to 2025, with partial pooling across job families and robust Student-t errors."],
  ["R", "Frequentist checks: robust (HC3) regressions, Fama-MacBeth slopes with Newey-West errors, two-way clustered errors and a long-short test."],
  ["Julia", "Bootstraps a hazard curve for every job, the way credit desks read default odds from bond prices, then simulates 15.5 million careers in about a second."],
  ["Haskell", "A small contract language in the style of Peyton Jones's 'Composing contracts'. Prices career insurance for every job from its hazard curve."],
  ["MATLAB / Octave", "Constrained quadratic programming: the mix of AI stocks that best offsets the swings in each job's market-implied career value."],
];

async function impliedPage() {
  const I = await needImplied();
  const T = I.totals, rs = I.realized_summary || {}, gt = I.gap_test || {};
  const share5 = T.automated_5y_bn / T.pay_bn;
  const perYear = 1 - Math.pow(1 - share5, 1 / 5);
  const curveDates = I.curve.map((c) => c[0].slice(0, 7));
  const topJobs = Object.entries(I.jobs).map(([soc, v]) => ({ soc, ...v, j: D.bySoc[soc] })).filter((x) => x.j)
    .sort((a, b) => b.a5 - a.a5);
  const comps = I.companies.filter((c) => c.before != null);
  const maxChg = Math.max(...comps.map((c) => Math.abs(c.now - c.before)));
  const asOf = new Date(I.as_of + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return `
  <div class="band"><div class="band-in implied-hero">
    <p class="eyebrow">Part 2 · Implied Automation</p>
    <h1>What Wall Street is betting AI will do to jobs.</h1>
    <p class="lede">Traders read "implied volatility" out of option prices. We read <b>implied automation</b> out of AI stock prices: run each company's valuation backwards, find the revenue the market expects from AI, and match it to the paychecks it would replace.</p>
    <div class="bignums">
      <div><span class="n">${pct1(share5)}</span><span>of US pay the market expects AI to do within 5 years<br><b>${bn(T.automated_5y_bn)}</b> a year · range ${pct1(T.automated_5y_lo_bn / T.pay_bn)} to ${pct1(T.automated_5y_hi_bn / T.pay_bn)}</span></div>
      <div><span class="n">${pct1(T.automated_10y_bn / T.pay_bn)}</span><span>within 10 years, if the market's longer view is right</span></div>
    </div>
    <p class="small">As of ${asOf}. Built from ${comps.length} US-listed AI sellers and ${Object.keys(I.jobs).length} jobs. Research estimate, not a forecast or advice.</p>
  </div></div>

  <section class="block">
    <h2>How the market's bet grew since ChatGPT</h2>
    <p class="muted">Share of US pay the stock market prices AI to do within 5 years, re-estimated every month from that month's prices and the filings public at the time.</p>
    ${lineChart(curveDates, [{ name: "Market-implied automation, 5 years", color: "var(--hi)", values: I.curve.map((c) => c[1]) }],
      (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + "%", { base: 0, label: "Market-implied share of US pay automated within 5 years, by month" })}
  </section>

  <section class="block vs-block">
    <h2>The market's bet versus what's really happening</h2>
    <div class="vs">
      <div><span class="tag-hi">The market expects</span><b>${pct1(perYear)}</b><span>of US pay automated every year</span></div>
      <div class="vs-mid" aria-hidden="true">vs</div>
      <div><span class="tag-lo">Jobs data shows so far</span><b>${T.realized_per_year == null ? "n/a" : pct1(T.realized_per_year)}</b><span>a year, from employment in ${rs.jobs || ""} jobs, May 2022 to May 2025</span></div>
    </div>
    ${rs.bayesian ? `<p>A Bayesian model (Stan) finds no clear link yet between how much people use AI for a job's tasks and that job losing workers: the estimated effect is ${rs.bayesian.delta_mean.toFixed(3)}, with a 90% interval of ${rs.bayesian.delta_ci90[0].toFixed(3)} to ${rs.bayesian.delta_ci90[1].toFixed(3)}, which includes zero. A standard regression with robust errors agrees (p = ${rs.frequentist.p_value.toFixed(2)}).</p>` : ""}
    ${gt.fama_macbeth ? `<p class="muted">Does that gap predict the stocks? Not so far. Companies the market is most optimistic about, relative to the jobs data, haven't done worse afterwards (Fama-MacBeth t = ${gt.fama_macbeth.nw_t.toFixed(2)}, ${gt.verdict}). If anything they kept rising.</p>` : ""}
    <details><summary>The statistics in full</summary>
      <ul class="small">
        ${rs.bayesian ? `<li>Stan: 4 chains, max R-hat ${rs.bayesian.max_rhat.toFixed(3)}, ${rs.bayesian.divergent} divergent transitions, posterior predictive 90% interval covers ${Math.round(rs.bayesian.ppc_90_coverage * 100)}% of jobs.</li>` : ""}
        ${gt.pooled ? `<li>Pooled regression with errors clustered by company and month: t = ${gt.pooled.t.toFixed(2)} on ${gt.pooled.obs} company-months.</li>` : ""}
        ${gt.ic ? `<li>Information coefficient ${gt.ic.mean_ic.toFixed(3)} (t = ${gt.ic.nw_t.toFixed(2)}). Long low-gap, short high-gap: ${(gt.long_short.yearly * 100).toFixed(1)}% a year (t = ${gt.long_short.nw_t.toFixed(2)}).</li>` : ""}
      </ul></details>
  </section>

  <section class="block">
    <h2>Who the market thinks wins and loses</h2>
    <p class="muted">The 10-year revenue growth each stock is pricing in, the day before ChatGPT launched and now. The market moved its bet to the big platforms and away from software sold for specific jobs.</p>
    <div class="wl">${comps.map((c) => {
      const d = c.now - c.before, w = (Math.abs(d) / maxChg) * 50;
      const name = D.byKey[c.sym]?.name || c.sym;
      return `<a class="wl-row" href="#/company/${c.sym}"><span>${esc(name)} <span class="small">${esc(c.sym)}</span></span>
        <span class="wl-track" aria-hidden="true"><span class="${d >= 0 ? "pos" : "neg"}" style="${d >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%"></span></span>
        <b class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)} pts</b><span class="small wl-from">${(c.before * 100).toFixed(0)}% → ${(c.now * 100).toFixed(0)}%</span></a>`;
    }).join("")}</div>
  </section>

  <section class="block">
    <h2>Jobs the market is betting on most</h2>
    <p class="muted">Share of each job's pay the market prices AI to do within 5 years. The bar shows the range across our three capture-rate scenarios.</p>
    ${topJobs.slice(0, 15).map((x) => `<a class="jobrow" href="#/job/${x.soc}"><span>${esc(x.j.title)}<br><span class="small">Insurance against it: ${x.cds_spread_pct != null ? x.cds_spread_pct.toFixed(1) + "% of pay a year" : "n/a"}</span></span>
      <span class="bar range" aria-hidden="true"><span style="left:${x.a5_lo * 100}%;width:${(x.a5_hi - x.a5_lo) * 100}%"></span><i style="left:${x.a5 * 100}%"></i></span><b>${pct1(x.a5)}</b></a>`).join("")}
    <p class="small" style="margin-top:12px">Open any job to see its full market-implied numbers: career value, chance of being automated, insurance price and best hedge.</p>
  </section>

  <section class="block">
    <h2>How it's built: one pipeline, eight languages</h2>
    <ol class="pipeline">${PIPELINE.map(([lang, what]) => `<li><b>${lang}</b><span>${what}</span></li>`).join("")}</ol>
  </section>

  <section class="block">
    <h2>What could make this wrong</h2>
    <ul>
      <li>Running a stock price backwards needs assumptions: long-run margins, the discount rate and growth after year 10. Each one moves the answer, which is why we show ranges.</li>
      <li>Not all extra AI revenue replaces paid work. We count only part of it for cloud, ads and chips (for example ${Math.round(I.labor_share.GOOGL * 100)}% for Alphabet, none for Nvidia), but the split is a judgment call.</li>
      <li>The capture rate, how much AI sellers earn for each $1 of pay their AI replaces, is unknown. Our scenarios use ${I.capture.map((k) => Math.round(k * 100) + "¢").join(", ")}.</li>
      <li>Some changes since November 2022 aren't about AI at all, like Meta recovering from a 2022 slump or interest rates moving.</li>
    </ul>
  </section>`;
}

function impliedSection(soc) {
  const I = D.implied;
  const x = I && I.jobs[soc];
  if (!x) return "";
  const j = D.bySoc[soc];
  const tops = [[x.top1, x.w1], [x.top2, x.w2], [x.top3, x.w3]].filter(([t, w]) => t && w > 0);
  return `<section class="block implied-job">
    <h2>The stock market's bet on this job</h2>
    <p class="muted">From what AI stocks are priced to earn, worked back to this job's pay. <a href="#/implied">How this works</a></p>
    <div class="money">
      <div><span class="muted">Pay the market expects AI to do within 5 years</span><b>${pct1(x.a5)}</b><span class="small">range ${pct1(x.a5_lo)} to ${pct1(x.a5_hi)}</span></div>
      <div><span class="muted">Chance a job like this is automated within 10 years</span><b>${pct1(x.prob_automated_10y)}</b><span class="small">from 20,000 simulated careers</span></div>
      <div><span class="muted">What AI risk takes off lifetime pay</span><b class="down">${pct1(x.ai_haircut)}</b><span class="small">${x.hc_no_ai ? `${fmtMoney(x.hc_mean)} vs ${fmtMoney(x.hc_no_ai)} with no AI` : ""}</span></div>
      <div><span class="muted">Fair price to insure a year's pay for 5 years</span><b>${x.cds_premium_dollars != null ? fmtMoney(x.cds_premium_dollars) : "n/a"}</b><span class="small">${x.cds_spread_pct != null ? x.cds_spread_pct.toFixed(2) + "% of pay a year" : ""}</span></div>
    </div>
    ${tops.length ? `<p>The stocks whose moves best offset swings in the market's view of this career: ${tops.map(([t]) => `<b>${esc(D.byKey[t]?.name || t)}</b>`).join(", ")}.${x.variance_cut != null ? ` Together they cancel about ${Math.round(x.variance_cut * 100)}% of those swings, partly by design, because the career value is itself read from these stocks.` : ""}</p>` : ""}
    ${x.realized_hi != null ? `<p class="small">Reality check: from 2022 to 2025, the jobs data shows no clear AI-linked job loss for ${esc(j ? j.title.toLowerCase() : "this job")} (at most about ${pct1(x.realized_hi)} a year).</p>` : ""}
    <p class="small">Research estimate built from stock prices, not advice and not a prediction for you personally.</p>
  </section>`;
}

/* ---------- Router ---------- */
let U = null;
let FX = [];

async function route() {
  const main = $("#main");
  if (U) { U.destroy(); U = null; }
  FX.forEach((f) => f && f.destroy());
  FX = [];
  main.classList.remove("enter");
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const params = new URLSearchParams(qs || "");
  const page = parts[0] || "home";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === (page === "job" ? "home" : page === "company" ? "companies" : page);
    on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  document.title = "HedgeMyJob";
  try {
    if (page === "home") { main.innerHTML = homePage(); wireHome(); }
    else if (page === "majors") { main.innerHTML = `<p class="loading">Loading majors…</p>`; main.innerHTML = await majorsPage(); wireMajors(); document.title = "College majors and AI · HedgeMyJob"; }
    else if (page === "job") {
      main.innerHTML = `<p class="loading">Loading your report…</p>`;
      main.innerHTML = await jobPage(decodeURIComponent(parts[1] || ""), params.get("at"));
      wireToggles(main);
      const me = D.bySoc[parts[1]];
      if (me && $("#orb") && typeof Shaders !== "undefined") FX.push(Shaders.orb($("#orb"), me.score));
      if (me && $("#umap")) U = Universe.mount($("#umap"), D.jobs, { focus: me.soc, links: (me.safer || []).map((x) => x[0]), introMs: 1200,
        onPick: (j) => (location.hash = `#/job/${j.soc}`), label: `Map of all jobs with ${me.title} highlighted` });
      if (params.get("at")) fillEmployer(params.get("at"), parts[1]);
      const add = $("#add-emp");
      if (add) {
        const inp = $("#q-emp2");
        combo(inp, async (q) => { await needEmployers().catch(() => {}); return searchEmployers(q); },
          (e) => `${esc(niceName(e[0]))} <span class="sub">${esc(e[1])}</span>`, (e) => { inp.value = shortName(e[0]); });
        add.addEventListener("submit", (e) => { e.preventDefault(); if (inp.value.trim()) location.hash = `#/job/${parts[1]}?at=${encodeURIComponent(inp.value.trim())}`; });
      }
      const copy = $("#copy");
      if (copy) copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(location.href); copy.textContent = "Link copied"; } catch { copy.textContent = "Copy the address bar to share"; }
      });
    }
    else if (page === "implied") { main.innerHTML = `<p class="loading">Loading the market's bet…</p>`; main.innerHTML = await impliedPage(); document.title = "Implied Automation · HedgeMyJob"; }
    else if (page === "jobs") { main.innerHTML = jobsPage(); wireJobs(); }
    else if (page === "companies") { main.innerHTML = companiesPage(); wireCompanies(main); }
    else if (page === "company") { main.innerHTML = companyPage(decodeURIComponent(parts[1] || "")); wireToggles(main); }
    else if (page === "about") { main.innerHTML = aboutPage(); }
    else if (page === "signals") { main.innerHTML = signalsPage(); wireToggles(main); }
    else if (page === "research") { main.innerHTML = await researchPage(); }
    else { main.innerHTML = homePage(); wireHome(); }
  } catch (err) {
    main.innerHTML = `<h1 style="margin-top:40px">Something went wrong loading this page.</h1><p class="muted">${esc(err.message)}. Refresh the page to try again.</p>`;
  }
  if (typeof Shaders !== "undefined") main.querySelectorAll(".band").forEach((b) => FX.push(Shaders.nebula(b)));
  window.scrollTo(0, 0);
  void main.offsetWidth;
  main.classList.add("enter");
  if (page !== "home") main.focus({ preventScroll: true });
}

(async function start() {
  try {
    const [jobs, companies, series, meta, sig] = await Promise.all(
      ["jobs.json", "companies.json", "series.json", "meta.json", "signals.json"].map(getJSON));
    D.jobs = jobs; D.companies = companies; D.series = series; D.meta = meta; D.signals = sig;
    jobs.forEach((j) => (D.bySoc[j.soc] = j));
    companies.forEach((c) => (D.byKey[coKey(c)] = c));
    $("#updated").textContent = `Data last updated ${meta.updated}. Sources: O*NET, BLS, Anthropic, OpenAI, Microsoft, Indeed, Yahoo Finance, SEC.`;
  } catch (err) {
    $("#main").innerHTML = `<h1 style="margin-top:40px">The data didn't load.</h1><p class="muted">Refresh the page. If you opened the file directly, run it with a local server instead.</p>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
})();
