"use strict";
/* Loads the C++ engine compiled to WebAssembly (engine.wasm, built from engine/engine.cpp).
   The engine's memory holds the job universe's positions, colours and sizes; WebGL uploads them
   straight from typed-array views of that memory, with no copying in JavaScript.
   If WebAssembly isn't available, the site falls back to the JavaScript versions automatically. */
const Engine = (() => {
  let E = null;
  const ready = (async () => {
    try {
      if (typeof WebAssembly !== "object") return null;
      const res = await fetch("engine.wasm");
      if (!res.ok) throw new Error(`engine.wasm ${res.status}`);
      let inst;
      if (WebAssembly.instantiateStreaming && (res.headers.get("content-type") || "").includes("wasm")) {
        inst = (await WebAssembly.instantiateStreaming(res, {})).instance;
      } else {
        inst = (await WebAssembly.instantiate(await res.arrayBuffer(), {})).instance;
      }
      E = inst.exports;
    } catch (err) {
      console.warn("WebAssembly engine not loaded, using JavaScript:", err.message);
      E = null;
    }
    return E;
  })();

  const f32 = (ptr, n) => new Float32Array(E.memory.buffer, ptr, n);
  const f64 = (ptr, n) => new Float64Array(E.memory.buffer, ptr, n);
  let loadedJobs = null;

  return {
    ready,
    get ok() { return !!E; },

    /* ---- Job universe ---- */
    loadJobs(jobs) {
      const n = Math.min(jobs.length, E.max_jobs());
      if (loadedJobs !== jobs) {
        f32(E.score_ptr(), n).set(jobs.slice(0, n).map((j) => j.score));
        f32(E.pay_ptr(), n).set(jobs.slice(0, n).map((j) => j.median_pay || 0));
        f32(E.workers_ptr(), n).set(jobs.slice(0, n).map((j) => j.workers || 0));
        const soc = new Uint8Array(E.memory.buffer, E.soc_ptr(), n * 8);
        soc.fill(0);
        jobs.slice(0, n).forEach((j, i) => { for (let k = 0; k < Math.min(8, j.soc.length); k++) soc[i * 8 + k] = j.soc.charCodeAt(k); });
        loadedJobs = jobs;
      }
      E.layout(n);
      return {
        n,
        pos: f32(E.pos_ptr(), n * 3), start: f32(E.start_ptr(), n * 3), color: f32(E.color_ptr(), n * 3),
        size: f32(E.size_ptr(), n), id: f32(E.id_ptr(), n), match: f32(E.match_ptr(), n),
      };
    },
    /* Heightfield of where people work; call after loadJobs. Returns views into engine memory. */
    terrain(n, res, sigma, scale) {
      E.terrain(n, res, sigma, scale);
      const w = res + 1;
      return { res, height: f32(E.height_ptr(), w * w), normal: f32(E.normal_ptr(), w * w * 3), pos: f32(E.pos_ptr(), n * 3) };
    },
    pick(mvp, n, mx, my, W, H, sizeScale, dimOnly) {
      f32(E.mvp_ptr(), 16).set(mvp);
      return E.pick(n, mx, my, W, H, sizeScale, dimOnly ? 1 : 0);
    },

    /* ---- Career engine ---- */
    setCurve(F) { f64(E.F_ptr(), 4).set(F); E.hazard(); return Array.from(f64(E.lam_ptr(), 4)); },
    survival(t) { return E.survival(t); },
    career(pay, years) { E.career(pay, years); const o = f64(E.out_ptr(), 2); return { ai: o[0], none: o[1] }; },
    insurance(years) { return E.insurance(years); },
    simulate(pay, years, paths, seed = 2026) {
      const t0 = performance.now();
      E.simulate(pay, years, paths, seed);
      const ms = performance.now() - t0;
      const o = f64(E.out_ptr(), 9), b = E.bins();
      return {
        ms, meanAI: o[0], meanNone: o[1], p5: o[2], p50: o[3], p95: o[4], prob10: o[5], lo: o[6], hi: o[7], paths: o[8],
        histAI: Array.from(f32(E.hist_ai_ptr(), b)), histNone: Array.from(f32(E.hist_none_ptr(), b)),
      };
    },
  };
})();
