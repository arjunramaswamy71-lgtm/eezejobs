// Runs alloc.apl with ngn/apl, an APL implementation for Node.
// Usage (from the project folder): node quant/apl/run_apl.js quant/out
// Reads quant/out/apl_input.json  { W, P, runs: [{ id, R, k }] }  and writes quant/out/apl_output.json  { id: jobs x horizons }
const fs = require("fs");
const path = require("path");
const apl = require("apl");

const dir = process.argv[2] || "quant/out";
const input = JSON.parse(fs.readFileSync(path.join(dir, "apl_input.json"), "utf8"));
const num = (x) => (x < 0 ? "¯" + String(-x) : String(x));
const program = fs.readFileSync(path.join(__dirname, "alloc.apl"), "utf8")
  .split("\n").filter((l) => l.trim() && !l.trim().startsWith("⍝"));

// One workspace keeps W and P loaded across all runs.
// Long number lists are read in chunks because the parser slows down sharply on very long lines.
const ws = apl.ws();
function load(name, values, shape) {
  ws(`${name}←⍬`);
  for (let i = 0; i < values.length; i += 200) ws(`${name}←${name},${values.slice(i, i + 200).map(num).join(" ")}`);
  if (shape) ws(`${name}←(${shape.join(" ")})⍴${name}`);
}

const t0 = process.hrtime.bigint();
load("W", input.W.flat(), [input.W.length, input.W[0].length]);
load("P", input.P);
const out = {};
for (const run of input.runs) {
  load("R", run.R.flat(), [run.R.length, run.R[0].length]);
  program.forEach((line) => ws(line));
  const r = ws(`Share ${num(run.k)}`);
  const [rows, cols] = r.shape;
  const flat = r.toArray();
  out[run.id] = Array.from({ length: rows }, (_, i) => flat.slice(i * cols, (i + 1) * cols));
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
fs.writeFileSync(path.join(dir, "apl_output.json"), JSON.stringify(out));
console.log(`APL: spread ${input.W.length} companies' AI revenue over ${input.P.length} jobs, ${input.runs.length} runs in ${(ms / 1000).toFixed(1)} s`);
