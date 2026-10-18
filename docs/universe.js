"use strict";
/* The job universe: every US job drawn as a point of light with raw WebGL, no libraries.
   Left to right is AI exposure, bottom to top is typical pay (log scale), dot size is how many people do the job.
   Usage: const u = Universe.mount(el, jobs, { focus, links, onPick }); u.setMatch(setOfSocs); u.destroy(); */
const Universe = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const POINT_VS = `
precision mediump float;
attribute vec3 a_pos; attribute vec3 a_start; attribute vec3 a_color;
attribute float a_size; attribute float a_id; attribute float a_match;
uniform mat4 u_mvp; uniform float u_intro, u_time, u_hover, u_focus, u_dim, u_px, u_motion;
varying vec3 v_color; varying float v_alpha; varying float v_ring;
void main() {
  float delay = fract(a_id * 0.61803) * 0.45;
  float k = clamp((u_intro - delay) / 0.55, 0.0, 1.0);
  k = 1.0 - pow(1.0 - k, 3.0);
  vec3 p = mix(a_start, a_pos, k);
  p.y += sin(u_time * 0.7 + a_id * 1.7) * 0.007 * u_motion;
  gl_Position = u_mvp * vec4(p, 1.0);
  float hov = 1.0 - step(0.5, abs(a_id - u_hover));
  float foc = 1.0 - step(0.5, abs(a_id - u_focus));
  float on = mix(1.0, a_match, u_dim);
  float lit = step(0.5, u_dim) * a_match;
  float pulse = 1.0 + foc * (0.7 + 0.25 * sin(u_time * 3.0) * u_motion);
  gl_PointSize = a_size * u_px * pulse * (1.0 + hov * 0.8) * (1.0 + lit * 0.6) * (3.6 / gl_Position.w);
  v_color = a_color;
  v_alpha = max(mix(0.1, 1.0, on), max(hov, foc));
  v_ring = max(max(hov, foc), lit * 0.8);
}`;

  const POINT_FS = `
precision mediump float;
varying vec3 v_color; varying float v_alpha; varying float v_ring;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float glow = exp(-r * 3.2);
  float core = 1.0 - smoothstep(0.0, 0.35, r);
  float ring = v_ring * smoothstep(0.55, 0.68, r) * (1.0 - smoothstep(0.8, 0.95, r));
  vec3 col = v_color * glow + vec3(1.0) * (core * 0.45 + ring);
  float a = clamp(glow * 0.95 + ring, 0.0, 1.0) * v_alpha;
  gl_FragColor = vec4(col * a, a);
}`;

  const LINE_VS = `
precision mediump float;
attribute vec3 a_pos; attribute vec4 a_col;
uniform mat4 u_mvp; uniform float u_fade;
varying vec4 v_col;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); v_col = vec4(a_col.rgb, a_col.a * u_fade); }`;

  const LINE_FS = `
precision mediump float;
varying vec4 v_col;
void main() { gl_FragColor = vec4(v_col.rgb * v_col.a, v_col.a); }`;

  /* ---- Small column-major 4x4 matrix helpers ---- */
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  };
  const perspective = (fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  };
  const translate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const scale = (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  const rotX = (t) => { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  const rotY = (t) => { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };

  /* ---- Colors: green (safe) to amber to coral (exposed), matching the CSS tokens ---- */
  const STOPS = [[0, [0.18, 0.83, 0.64]], [50, [0.96, 0.71, 0.27]], [100, [1.0, 0.36, 0.43]]];
  function ramp(score) {
    const s = Math.max(0, Math.min(100, score));
    const [a, b] = s <= 50 ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]];
    const t = (s - a[0]) / (b[0] - a[0]);
    return a[1].map((v, i) => v + (b[1][i] - v) * t);
  }
  /* Deterministic 0..1 noise from a job code, so the map looks the same every visit */
  function hash(str, seed) {
    let h = 2166136261 ^ seed;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }

  function compile(gl, vs, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  const fmtPay = (v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);
  const fmtWorkers = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0));
  const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function mount(root, jobs, opts = {}) {
    const noop = { setMatch() {}, destroy() {} };
    root.classList.add("universe");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", opts.label || `Map of ${jobs.length} US jobs. Further right means more exposed to AI, higher up means better paid, bigger dots have more workers.`);
    const labels = document.createElement("div");
    labels.className = "u-labels";
    labels.setAttribute("aria-hidden", "true");
    const tip = document.createElement("div");
    tip.className = "u-tip";
    tip.hidden = true;
    root.append(canvas, labels, tip);

    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) { root.classList.add("u-off"); return noop; }

    let pointProg, lineProg;
    try {
      pointProg = compile(gl, POINT_VS, POINT_FS);
      lineProg = compile(gl, LINE_VS, LINE_FS);
    } catch (err) {
      console.warn("Universe shaders failed:", err);
      root.classList.add("u-off");
      return noop;
    }

    /* ---- Lay the jobs out ---- */
    const pays = jobs.map((j) => j.median_pay).filter(Boolean).map(Math.log);
    const lo = Math.log(28000), hi = Math.log(240000);
    const midPay = pays.sort((a, b) => a - b)[Math.floor(pays.length / 2)];
    const maxW = Math.max(...jobs.map((j) => j.workers || 0));
    const yOf = (pay) => Math.max(-1, Math.min(1, ((pay - lo) / (hi - lo)) * 2 - 1));
    const N = jobs.length;
    const pos = new Float32Array(N * 3), start = new Float32Array(N * 3), color = new Float32Array(N * 3);
    const size = new Float32Array(N), ids = new Float32Array(N), match = new Float32Array(N).fill(1);
    const index = {};
    jobs.forEach((j, i) => {
      index[j.soc] = i;
      const lp = j.median_pay ? Math.log(j.median_pay) : midPay;
      pos[i * 3] = (j.score / 100) * 2 - 1 + (hash(j.soc, 1) - 0.5) * 0.025;
      pos[i * 3 + 1] = yOf(lp);
      pos[i * 3 + 2] = (hash(j.soc, 2) - 0.5) * 0.7;
      const ang = i * 2.39996, rad = 0.25 + Math.sqrt(hash(j.soc, 3)) * 1.5;
      start[i * 3] = Math.cos(ang) * rad;
      start[i * 3 + 1] = (hash(j.soc, 4) - 0.5) * 0.25;
      start[i * 3 + 2] = Math.sin(ang) * rad;
      color.set(ramp(j.score), i * 3);
      size[i] = 4 + 20 * Math.sqrt((j.workers || 0) / maxW);
      ids[i] = i;
    });
    const focusIdx = opts.focus != null && index[opts.focus] != null ? index[opts.focus] : -1;
    const linkIdx = (opts.links || []).map((s) => index[s]).filter((i) => i != null);

    const buf = (data, usage = gl.STATIC_DRAW) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b; };
    const B = { pos: buf(pos), start: buf(start), color: buf(color), size: buf(size), id: buf(ids), match: buf(match, gl.DYNAMIC_DRAW) };

    /* Grid lines plus links from the focus job to its safer neighbours */
    const lines = [];
    const push = (a, b, c) => lines.push(...a, ...c, ...b, ...c);
    const gridC = [0.55, 0.62, 0.8, 0.16];
    for (const x of [0, 25, 50, 75, 100]) push([(x / 50) - 1, -1.06, 0], [(x / 50) - 1, 1.06, 0], gridC);
    const payTicks = [40000, 70000, 120000, 200000];
    for (const p of payTicks) { const y = yOf(Math.log(p)); push([-1.04, y, 0], [1.04, y, 0], gridC); }
    const gridVerts = lines.length / 7;
    if (focusIdx >= 0) {
      const f = [pos[focusIdx * 3], pos[focusIdx * 3 + 1], pos[focusIdx * 3 + 2]];
      for (const i of linkIdx) push(f, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], [0.18, 0.83, 0.64, 0.75]);
    }
    const lineVerts = lines.length / 7;
    const lineBuf = buf(new Float32Array(lines));

    if (focusIdx >= 0) {
      match.fill(0);
      match[focusIdx] = 1;
      linkIdx.forEach((i) => (match[i] = 1));
      gl.bindBuffer(gl.ARRAY_BUFFER, B.match);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, match);
    }
    let dim = focusIdx >= 0 ? 0.55 : 0;

    /* HTML tick labels that follow the 3D rotation */
    const ticks = [
      ...[0, 25, 50, 75, 100].map((x) => ({ p: [(x / 50) - 1, -1.13, 0], t: String(x), cls: "x" })),
      ...payTicks.map((p) => ({ p: [-1.09, yOf(Math.log(p)), 0], t: fmtPay(p), cls: "y" })),
    ];
    labels.innerHTML = ticks.map((k) => `<span class="u-tick ${k.cls}">${k.t}</span>`).join("") +
      `<span class="u-axis y">Higher pay ↑</span>`;
    const tickEls = [...labels.querySelectorAll(".u-tick")];

    const A = (prog, name) => gl.getAttribLocation(prog, name);
    const U = (prog, name) => gl.getUniformLocation(prog, name);
    const PA = { pos: A(pointProg, "a_pos"), start: A(pointProg, "a_start"), color: A(pointProg, "a_color"), size: A(pointProg, "a_size"), id: A(pointProg, "a_id"), match: A(pointProg, "a_match") };
    const PU = Object.fromEntries(["u_mvp", "u_intro", "u_time", "u_hover", "u_focus", "u_dim", "u_px", "u_motion"].map((n) => [n, U(pointProg, n)]));
    const LA = { pos: A(lineProg, "a_pos"), col: A(lineProg, "a_col") };
    const LU = { mvp: U(lineProg, "u_mvp"), fade: U(lineProg, "u_fade") };

    /* ---- Camera and interaction ---- */
    let W = 1, H = 1, dpr = 1, sizeScale = 1, mvp = null;
    let yaw = -0.16, pitch = 0.1, tYaw = -0.16, tPitch = 0.1;
    let hover = -1, selected = -1, raf = 0, visible = true, alive = true;
    const t0 = performance.now();
    const introLen = opts.intro === false || REDUCED ? 0 : (opts.introMs || 2200);

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      sizeScale = Math.max(0.65, Math.min(1.25, Math.min(W, H) / 560));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function matrix() {
      const aspect = W / H;
      const fov = 0.62, dist = 3.3;
      const halfH = Math.tan(fov / 2) * dist;
      const sx = Math.min(halfH * aspect * (aspect < 1.1 ? 0.72 : 0.84), 2.4), sy = halfH * 0.74;
      const shift = aspect < 1.1 ? 0.1 : 0.04;
      let m = mul(rotY(yaw), scale(sx, sy, sy));
      m = mul(rotX(pitch), m);
      m = mul(translate(shift * sx, -0.02, -dist), m);
      return mul(perspective(fov, aspect, 0.1, 20), m);
    }

    function project(x, y, z) {
      const m = mvp;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [((cx / cw) + 1) / 2 * W, (1 - (cy / cw)) / 2 * H, cw];
    }

    function pick(mx, my) {
      if (!mvp) return -1;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < N; i++) {
        if (dim === 1 && !match[i]) continue;
        const [sx, sy, w] = project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        const rad = Math.max(9, (size[i] * sizeScale * (3.6 / w)) / 2);
        const d = Math.hypot(sx - mx, sy - my);
        if (d < rad && d < bestD) { best = i; bestD = d; }
      }
      return best;
    }

    function showTip(i, touch) {
      if (i < 0) { tip.hidden = true; return; }
      const j = jobs[i];
      const [sx, sy] = project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      tip.innerHTML = `<b>${escape(j.title)}</b><span>AI exposure <strong>${Math.round(j.score)}</strong> of 100</span>` +
        `<span>${j.workers ? fmtWorkers(j.workers) + " workers" : ""}${j.median_pay ? ` · ${fmtPay(j.median_pay)} typical pay` : ""}</span>` +
        (touch && opts.onPick ? `<a href="#/job/${j.soc}" class="u-open">Open this job →</a>` : (opts.onPick ? `<em>Click to open</em>` : ""));
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = sx + 14, top = sy - th - 12;
      if (left + tw > W - 8) left = sx - tw - 14;
      if (top < 8) top = sy + 16;
      tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
    }

    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (!REDUCED) { tYaw = -0.16 + (mx / W - 0.5) * 0.4; tPitch = 0.1 + (my / H - 0.5) * 0.22; }
      if (e.pointerType === "touch") return;
      const i = pick(mx, my);
      if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 && opts.onPick ? "pointer" : ""; }
      showTip(hover, false);
      if (!raf) loop();
    }
    function onLeave() { hover = -1; tip.hidden = true; tYaw = -0.16; tPitch = 0.1; }
    function onUp(e) {
      const r = canvas.getBoundingClientRect();
      const i = pick(e.clientX - r.left, e.clientY - r.top);
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        selected = i; hover = i; showTip(i, true);
      } else if (i >= 0 && opts.onPick) {
        opts.onPick(jobs[i]);
      }
      if (!raf) loop();
    }
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerup", onUp);

    function bindAttr(prog, loc, buffer, n) {
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    }

    function draw(now) {
      const time = (now - t0) / 1000;
      const intro = introLen ? Math.min(1, (now - t0) / introLen) : 1;
      if (!REDUCED) {
        const drift = Math.sin(time * 0.18) * 0.1;
        yaw += (tYaw + drift - yaw) * 0.05;
        pitch += (tPitch - pitch) * 0.05;
      }
      mvp = matrix();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // Lines
      gl.useProgram(lineProg);
      gl.uniformMatrix4fv(LU.mvp, false, mvp);
      gl.uniform1f(LU.fade, intro);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.enableVertexAttribArray(LA.pos);
      gl.vertexAttribPointer(LA.pos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(LA.col);
      gl.vertexAttribPointer(LA.col, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.LINES, 0, gridVerts);
      if (lineVerts > gridVerts) {
        gl.uniform1f(LU.fade, Math.max(0, (intro - 0.7) / 0.3));
        gl.drawArrays(gl.LINES, gridVerts, lineVerts - gridVerts);
      }
      gl.disableVertexAttribArray(LA.pos);
      gl.disableVertexAttribArray(LA.col);

      // Points
      gl.useProgram(pointProg);
      bindAttr(pointProg, PA.pos, B.pos, 3);
      bindAttr(pointProg, PA.start, B.start, 3);
      bindAttr(pointProg, PA.color, B.color, 3);
      bindAttr(pointProg, PA.size, B.size, 1);
      bindAttr(pointProg, PA.id, B.id, 1);
      bindAttr(pointProg, PA.match, B.match, 1);
      gl.uniformMatrix4fv(PU.u_mvp, false, mvp);
      gl.uniform1f(PU.u_intro, intro);
      gl.uniform1f(PU.u_time, time);
      gl.uniform1f(PU.u_hover, hover);
      gl.uniform1f(PU.u_focus, focusIdx);
      gl.uniform1f(PU.u_dim, dim);
      gl.uniform1f(PU.u_px, dpr * sizeScale);
      gl.uniform1f(PU.u_motion, REDUCED ? 0 : 1);
      gl.drawArrays(gl.POINTS, 0, N);
      Object.values(PA).forEach((loc) => loc >= 0 && gl.disableVertexAttribArray(loc));

      // Labels follow the projection
      ticks.forEach((k, i) => {
        const [x, y] = project(...k.p);
        tickEls[i].style.transform = `translate(${x}px, ${y}px)`;
        tickEls[i].style.opacity = intro;
      });
      if (hover >= 0 && !tip.hidden) showTip(hover, selected === hover);
      return intro;
    }

    function loop() {
      raf = 0;
      if (!alive || !visible) return;
      const intro = draw(performance.now());
      // Keep animating while moving; when motion is reduced, only redraw on demand.
      if (!REDUCED || intro < 1) raf = requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(() => { resize(); if (!raf) loop(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible && !raf) loop(); });
    io.observe(root);
    const onVis = () => { visible = !document.hidden; if (visible && !raf) loop(); };
    document.addEventListener("visibilitychange", onVis);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); alive = false; root.classList.add("u-off"); });
    resize();
    loop();

    return {
      /* Light up only these jobs (a Set of job codes), or pass null to light everything */
      setMatch(set) {
        if (focusIdx >= 0) return;
        if (!set) { match.fill(1); dim = 0; }
        else { for (let i = 0; i < N; i++) match[i] = set.has(jobs[i].soc) ? 1 : 0; dim = 1; }
        gl.bindBuffer(gl.ARRAY_BUFFER, B.match);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, match);
        if (!raf) loop();
      },
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        ro.disconnect(); io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      },
    };
  }

  return { mount, ramp };
})();
