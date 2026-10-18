// Checks the WebAssembly engine against the Julia and Haskell results. Run: node engine/test.js
const fs = require("fs");
const { instance } = { instance: new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync("docs/engine.wasm")), {}) };
const E = instance.exports;
const mem = () => E.memory.buffer;
const I = JSON.parse(fs.readFileSync("docs/data/implied.json", "utf8"));
const jobs = JSON.parse(fs.readFileSync("docs/data/jobs.json", "utf8"));
const F = new Float64Array(mem(), E.F_ptr(), 4), out = new Float64Array(mem(), E.out_ptr(), 16);
let worst = 0;
for (const soc of ["15-2021", "13-2011", "47-2061", "29-1141", "15-1252"]) {
  const x = I.jobs[soc], pay = jobs.find((j) => j.soc === soc).median_pay;
  F.set([x.a1, x.a3, x.a5, x.a10]);
  E.hazard();
  const s5 = E.survival(5), spread = E.insurance(5);
  const t0 = performance.now();
  E.simulate(pay, 30, 200000, 2026);
  const ms = performance.now() - t0;
  const haircut = 1 - out[0] / out[1];
  console.log(`${soc}  survival5 ${s5.toFixed(4)} vs Haskell ${x.survival_5y}  spread ${(spread * 100).toFixed(3)}% vs ${x.cds_spread_pct}%  ` +
    `MC haircut ${(haircut * 100).toFixed(2)}% vs Julia ${(x.ai_haircut * 100).toFixed(2)}%  P(10y) ${out[5].toFixed(3)} vs ${x.prob_automated_10y}  200k careers in ${ms.toFixed(0)} ms`);
  worst = Math.max(worst, Math.abs(s5 - x.survival_5y), Math.abs(spread * 100 - x.cds_spread_pct) / 100, Math.abs(haircut - x.ai_haircut));
}
// Universe layout and picking
const n = jobs.length;
new Float32Array(mem(), E.score_ptr(), n).set(jobs.map((j) => j.score));
new Float32Array(mem(), E.pay_ptr(), n).set(jobs.map((j) => j.median_pay || 0));
new Float32Array(mem(), E.workers_ptr(), n).set(jobs.map((j) => j.workers || 0));
const soc = new Uint8Array(mem(), E.soc_ptr(), n * 8);
jobs.forEach((j, i) => { for (let k = 0; k < 8; k++) soc[i * 8 + k] = k < j.soc.length ? j.soc.charCodeAt(k) : 0; });
E.layout(n);
const pos = new Float32Array(mem(), E.pos_ptr(), n * 3);
console.log("layout first job", Array.from(pos.slice(0, 3)).map((v) => v.toFixed(3)).join(" "), "max abs difference vs engines", worst.toFixed(4));
