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
];
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
function homePage() {
  const m = D.meta;
  return `
  <div class="hero">
    <h1>See how much of your job AI can already do.</h1>
    <p class="lede">Type your job. In plain English, we'll show which parts AI handles, which parts still need you, and who's making money from it.</p>
    <form class="ask" id="ask" novalidate>
      <div class="field"><label for="q-job">What's your job?</label>
        <div class="combo"><input id="q-job" type="text" autocomplete="off" placeholder="Nurse, truck driver, accountant…"></div>
        <p class="err" id="job-err" hidden></p></div>
      <div class="field"><label for="q-emp">Where do you work? <span class="hint">Optional</span></label>
        <div class="combo"><input id="q-emp" type="text" autocomplete="off" placeholder="Company name"></div></div>
      <div><button class="btn" type="submit">Check my job</button></div>
    </form>
    <div class="chips"><span class="muted">Or try:</span>${POPULAR.map(([n, s]) => `<a class="chip" href="#/job/${s}">${n}</a>`).join("")}</div>
  </div>
  <div class="facts">
    <div class="fact"><div class="big">${Math.round(m.workers_high / 1e6)} million</div><p>Americans work in jobs where AI can do or help with much of the work.</p></div>
    <div class="fact"><div class="big">${m.jobs}</div><p>jobs checked, covering nearly every kind of work in the US.</p></div>
    <div class="fact"><div class="big">5 sources</div><p>ChatGPT, Claude, Microsoft Copilot, human experts and university researchers.</p></div>
  </div>`;
}

function wireHome() {
  const job = $("#q-job"), emp = $("#q-emp");
  let picked = null;
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

function advice(j) {
  const lv = level(j.score);
  const items = {
    High: ["Learn the AI tools for the tasks in blue and orange. People who use them well tend to replace people who don't.",
      "Spend more of your time on the green tasks. That's where you're hardest to replace.",
      "Keep your resume current and your skills easy to carry to a nearby job."],
    Medium: ["Try the AI tools for the tasks in orange. They can save you hours each week.",
      "The green tasks are your strength. Make them a bigger part of your role.",
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

  return `
  <a class="back" href="#/">← Check another job</a>
  <div class="report-head">
    <h1>${esc(j.title)}</h1>
    <p class="meta">${j.workers ? `${fmtInt(j.workers)} people in the US do this job` : "US job"}${j.median_pay ? `. Typical pay ${fmtMoney(j.median_pay)} a year.` : "."}</p>
  </div>
  <p class="verdict">${verdictText(j)}</p>
  <span class="level ${lv}">${LEVEL_WORDS[lv]}</span>
  <span class="muted" style="margin-left:8px">More exposed than ${Math.round(j.score)} out of 100 jobs.</span>

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

  <section class="block">
    <h2>Do the AIs agree?</h2>
    <p class="muted">We asked five sources. Further right means more exposed than other jobs. ${j.spread >= 20 ? "They disagree a lot on this job, so treat the score with care." : "They mostly agree on this job."}</p>
    <div class="agree">${SOURCES.map(([k, name]) => j.src[k] == null ? "" :
      `<div class="agree-row"><span>${name}</span><div class="track"><span style="left:${j.src[k]}%"></span></div><b>${j.src[k]}</b></div>`).join("")}</div>
  </section>

  <div class="share"><button class="btn quiet" id="copy">Copy link to this page</button></div>`;
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
  return `<div class="page-head"><h1>All ${D.jobs.length} jobs</h1>
    <p class="muted">Ranked by how exposed each job is to AI. Tap any job for the full breakdown.</p></div>
    <div class="tools">
      <input id="jf" type="search" placeholder="Search jobs" aria-label="Search jobs">
      <select id="jg" aria-label="Job area" class="chip"><option value="">All areas</option>${groups.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <select id="js" aria-label="Sort" class="chip"><option value="high">Most exposed first</option><option value="low">Least exposed first</option><option value="az">A to Z</option><option value="workers">Most workers</option></select>
    </div>
    <div id="jlist"></div>`;
}

function wireJobs() {
  const paint = () => {
    const q = $("#jf").value.trim().toLowerCase(), g = $("#jg").value, s = $("#js").value;
    let rows = D.jobs.filter((j) => (!g || j.soc.startsWith(g)) && (!q || j.title.toLowerCase().includes(q)));
    const sorters = { high: (a, b) => b.score - a.score, low: (a, b) => a.score - b.score,
      az: (a, b) => a.title.localeCompare(b.title), workers: (a, b) => (b.workers || 0) - (a.workers || 0) };
    rows.sort(sorters[s]);
    const colorFor = (sc) => ({ High: "var(--can)", Medium: "var(--helps)", Low: "var(--you)" }[level(sc)]);
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
          <span class="bar" aria-hidden="true"><span style="width:${j.score}%;background:var(--can)"></span></span><b>${Math.round(j.score)}</b></a>`).join("")}
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

function aboutPage() {
  return `<div class="page-head"><h1>How it works</h1></div>
  <section class="block"><h2>The score</h2>
    <p>Every job is a list of tasks, from the US Labor Department's job database (O*NET). For each job we check five sources:</p>
    <ul>
      <li><b>ChatGPT's own rating</b> and <b>human experts' rating</b> of which tasks AI can speed up, from OpenAI's "GPTs are GPTs" study.</li>
      <li><b>What people really use Claude for</b>, from Anthropic's Economic Index.</li>
      <li><b>What people really use Microsoft Copilot for</b>, from Microsoft's "Working with AI" study.</li>
      <li><b>University researchers' rating</b>, from Felten, Raj and Seamans, who matched AI progress to job skills.</li>
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

/* ---------- Router ---------- */
async function route() {
  const main = $("#main");
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
    else if (page === "job") {
      main.innerHTML = `<p class="loading">Loading your report…</p>`;
      main.innerHTML = await jobPage(decodeURIComponent(parts[1] || ""), params.get("at"));
      wireToggles(main);
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
    else if (page === "jobs") { main.innerHTML = jobsPage(); wireJobs(); }
    else if (page === "companies") { main.innerHTML = companiesPage(); wireCompanies(main); }
    else if (page === "company") { main.innerHTML = companyPage(decodeURIComponent(parts[1] || "")); wireToggles(main); }
    else if (page === "about") { main.innerHTML = aboutPage(); }
    else if (page === "signals") { main.innerHTML = signalsPage(); wireToggles(main); }
    else { main.innerHTML = homePage(); wireHome(); }
  } catch (err) {
    main.innerHTML = `<h1 style="margin-top:40px">Something went wrong loading this page.</h1><p class="muted">${esc(err.message)}. Refresh the page to try again.</p>`;
  }
  window.scrollTo(0, 0);
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
