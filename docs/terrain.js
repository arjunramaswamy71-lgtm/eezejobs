// The terrain of work: Three.js sets up the scene, camera and mouse; GLSL does the rest.
//   Vertex shader:   bends a flat grid into hills (one hill per crowd of workers), rising out of the ground on load,
//                    and ripples the water surface.
//   Fragment shader: survey-map colouring by AI exposure, sun shading, contour lines, and a tide that floods
//                    the exposed side of the map with moving water.
// Heights, normals and job positions come from the C++/WebAssembly engine's memory (engine.js).
// Left to right is AI exposure, near to far is pay, height is how many people do that kind of work.
import * as THREE from "./vendor/three.module.min.js";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const RES = 160, SIGMA = 0.05, HEIGHT = 0.5;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const col = (name) => new THREE.Color(css(name) || "#888");

const TERRAIN_VS = /* glsl */ `
  attribute float aHeight;
  uniform float uScale, uGrow, uTime;
  varying vec3 vNormal;
  varying float vH;
  varying vec2 vXZ;
  void main() {
    // stagger the rise from left to right so the land unrolls across the map
    float g = clamp(uGrow * 1.6 - (position.x + 1.0) * 0.3, 0.0, 1.0);
    g = 1.0 - pow(1.0 - g, 3.0);
    vec3 p = vec3(position.x, aHeight * uScale * g, position.z);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vH = aHeight * g;
    vXZ = position.xz;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }`;

const TERRAIN_FS = /* glsl */ `
  uniform vec3 uLow, uMid, uHigh, uInk, uSea, uPaper;
  uniform float uShore, uTime, uDark, uDim;
  varying vec3 vNormal;
  varying float vH;
  varying vec2 vXZ;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    float e = vXZ.x * 0.5 + 0.5;                                   // AI exposure, 0 to 1
    vec3 land = e < 0.5 ? mix(uLow, uMid, e * 2.0) : mix(uMid, uHigh, e * 2.0 - 1.0);
    land = mix(uPaper, land, 0.25 + 0.75 * smoothstep(0.02, 0.35, vH));   // flat ground fades to paper
    vec3 sun = normalize(vec3(-0.5, 0.9, 0.35));
    float diff = max(dot(normalize(vNormal), sun), 0.0);
    vec3 c = land * (0.62 + 0.48 * diff);

    // contour lines: every 1/14 of the height, with a heavier index line every fifth
    float h = vH * 14.0;
    float w = fwidth(h);
    float line = 1.0 - smoothstep(0.0, w * 1.1, abs(fract(h - 0.5) - 0.5));
    float idx = 1.0 - smoothstep(0.0, w * 1.6, abs(fract(h / 5.0 - 0.5) - 0.5) * 5.0);
    c = mix(c, uInk, (line * 0.22 + idx * 0.28) * smoothstep(0.015, 0.05, vH));

    // faint survey grid at 25, 50 and 75 exposure
    float gx = abs(fract(e * 4.0 - 0.5) - 0.5) / fwidth(e * 4.0);
    c = mix(c, uInk, (1.0 - smoothstep(0.0, 1.0, gx)) * 0.12);

    // the tide: everything right of the shoreline is under moving water
    float under = smoothstep(uShore - 0.004, uShore + 0.004, vXZ.x);
    if (under > 0.0) {
      float t = uTime * 0.35;
      float ripple = noise(vXZ * 18.0 + vec2(t, -t * 0.6)) * 0.6 + noise(vXZ * 41.0 - vec2(t * 1.3, t)) * 0.4;
      float depth = 1.0 - smoothstep(0.0, 0.5, vH);
      vec3 water = mix(uSea * 1.15, uSea * 0.72, depth) + vec3(0.9) * smoothstep(0.72, 0.95, ripple) * 0.18;
      float foam = 1.0 - smoothstep(0.0, 0.018, abs(vXZ.x - uShore));
      c = mix(c, water, under * 0.82) + vec3(1.0) * foam * 0.35 * under;
    }
    c = mix(c, uPaper, uDim * 0.45);
    gl_FragColor = vec4(c, 1.0);
  }`;

const PIN_VS = /* glsl */ `
  attribute float aSize, aMatch, aId;
  attribute vec3 aColor;
  uniform float uScale, uGrow, uPx, uHover, uFocus, uDimAll, uTime;
  varying vec3 vColor;
  varying float vAlpha, vRing;
  void main() {
    float g = clamp(uGrow * 1.6 - (position.x + 1.0) * 0.3 - 0.25, 0.0, 1.0);
    vec3 p = vec3(position.x, position.y * g + 0.012, position.z);
    vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float hov = 1.0 - step(0.5, abs(aId - uHover));
    float foc = 1.0 - step(0.5, abs(aId - uFocus));
    float on = mix(1.0, aMatch, uDimAll);
    gl_PointSize = (aSize * (0.55 + 0.9 * on) + hov * 7.0 + foc * (9.0 + 2.0 * sin(uTime * 3.0))) * uPx / -mv.z * g;
    vColor = aColor;
    vAlpha = mix(0.18, 1.0, on);
    vRing = max(hov, foc);
  }`;

const PIN_FS = /* glsl */ `
  uniform vec3 uInk;
  varying vec3 vColor;
  varying float vAlpha, vRing;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float edge = smoothstep(0.62, 0.78, r);                  // inked outline like a map symbol
    vec3 colr = mix(vColor, uInk, edge * 0.85);
    colr = mix(colr, vec3(1.0), vRing * (1.0 - smoothstep(0.0, 0.35, r)) * 0.6);
    gl_FragColor = vec4(colr, vAlpha * (1.0 - smoothstep(0.92, 1.0, r)));
  }`;

const WATER_VS = /* glsl */ `
  uniform float uTime, uLevel;
  varying vec2 vXZ;
  varying float vWave;
  void main() {
    vec3 p = position;
    float wave = sin(p.x * 22.0 + uTime * 1.4) * 0.5 + sin(p.z * 17.0 - uTime * 1.1) * 0.5;
    p.y = uLevel + wave * 0.0035;
    vXZ = p.xz; vWave = wave;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }`;

const WATER_FS = /* glsl */ `
  uniform vec3 uSea;
  uniform float uShore;
  varying vec2 vXZ;
  varying float vWave;
  void main() {
    if (vXZ.x < uShore) discard;
    float glint = smoothstep(0.75, 1.0, vWave) * 0.12;
    float edge = smoothstep(uShore, uShore + 0.05, vXZ.x);
    gl_FragColor = vec4(uSea + glint, 0.28 * edge + 0.06);
  }`;

function mount(root, jobs, opts = {}) {
  const noop = { setMatch() {}, setShore() {}, destroy() {} };
  root.classList.add("terrain");
  if (typeof Engine === "undefined" || !Engine.ok) { root.classList.add("t-off"); return noop; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) { root.classList.add("t-off"); return noop; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.label || `Map of ${jobs.length} US jobs as terrain: further right is more exposed to AI, further back is better paid, and higher ground means more people do that work.`);
  const labels = document.createElement("div"); labels.className = "t-labels"; labels.setAttribute("aria-hidden", "true");
  const tip = document.createElement("div"); tip.className = "t-tip"; tip.hidden = true;
  root.append(canvas, labels, tip);

  // ---- data from the WebAssembly engine ----
  const N = jobs.length;
  const v = Engine.loadJobs(jobs);
  const t = Engine.terrain(N, RES, SIGMA, HEIGHT);
  const index = {}; jobs.forEach((j, i) => (index[j.soc] = i));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  const palette = () => ({
    uLow: { value: col("--t-low") }, uMid: { value: col("--t-mid") }, uHigh: { value: col("--t-high") },
    uInk: { value: col("--ink") }, uSea: { value: col("--sea") }, uPaper: { value: col("--t-paper") },
  });
  const shared = { uTime: { value: 0 }, uGrow: { value: REDUCED || opts.intro === false ? 1 : 0 }, uScale: { value: HEIGHT },
    uShore: { value: opts.shore ?? 1.2 } };

  // ---- terrain mesh: the grid comes from JS, heights and normals straight from engine memory ----
  const w = RES + 1;
  const positions = new Float32Array(w * w * 3);
  for (let iz = 0; iz < w; iz++) for (let ix = 0; ix < w; ix++) {
    const k = (iz * w + ix) * 3;
    positions[k] = (ix / RES) * 2 - 1; positions[k + 1] = 0; positions[k + 2] = (iz / RES) * 2 - 1;
  }
  const idx = [];
  for (let iz = 0; iz < RES; iz++) for (let ix = 0; ix < RES; ix++) {
    const a = iz * w + ix, b = a + 1, c = a + w, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aHeight", new THREE.BufferAttribute(t.height, 1));
  geo.setAttribute("normal", new THREE.BufferAttribute(t.normal, 3));
  geo.setIndex(idx);
  const terrainMat = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
    uniforms: { ...shared, ...palette(), uDark: { value: 0 }, uDim: { value: opts.focus ? 0.35 : 0 } },
  });
  scene.add(new THREE.Mesh(geo, terrainMat));

  // ---- water surface over the flooded side ----
  const waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false,
    uniforms: { uTime: shared.uTime, uShore: shared.uShore, uLevel: { value: 0.035 }, uSea: { value: col("--sea") } },
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 120, 120).rotateX(-Math.PI / 2), waterMat));

  // ---- job pins, sitting on the ground (positions from engine memory) ----
  const pinGeo = new THREE.BufferGeometry();
  pinGeo.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
  pinGeo.setAttribute("aColor", new THREE.BufferAttribute(v.color, 3));
  pinGeo.setAttribute("aSize", new THREE.BufferAttribute(v.size, 1));
  pinGeo.setAttribute("aId", new THREE.BufferAttribute(v.id, 1));
  const matchAttr = new THREE.BufferAttribute(v.match, 1);
  matchAttr.setUsage(THREE.DynamicDrawUsage);
  pinGeo.setAttribute("aMatch", matchAttr);
  const focusIdx = opts.focus != null && index[opts.focus] != null ? index[opts.focus] : -1;
  const pinMat = new THREE.ShaderMaterial({
    vertexShader: PIN_VS, fragmentShader: PIN_FS, transparent: true, depthTest: true,
    uniforms: { ...shared, uPx: { value: 1 }, uHover: { value: -1 }, uFocus: { value: focusIdx }, uDimAll: { value: 0 }, uInk: { value: col("--ink") } },
  });
  scene.add(new THREE.Points(pinGeo, pinMat));

  // ---- routes from your job to safer ones, arcing over the land ----
  const links = (opts.links || []).map((s) => index[s]).filter((i) => i != null);
  if (focusIdx >= 0) {
    const P = (i) => new THREE.Vector3(t.pos[i * 3], t.pos[i * 3 + 1] + 0.012, t.pos[i * 3 + 2]);
    const from = P(focusIdx);
    for (const i of links) {
      const to = P(i), mid = from.clone().lerp(to, 0.5); mid.y += 0.18 + from.distanceTo(to) * 0.25;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
        new THREE.LineDashedMaterial({ color: col("--t-low"), dashSize: 0.025, gapSize: 0.015, linewidth: 1 }));
      line.computeLineDistances();
      scene.add(line);
    }
    // a survey flag over your job
    const flag = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, from.clone().add(new THREE.Vector3(0, 0.3, 0))]),
      new THREE.LineBasicMaterial({ color: col("--ink") }));
    scene.add(flag);
    const m = new Float32Array(N); m[focusIdx] = 1; links.forEach((i) => (m[i] = 1));
    v.match.set(m); matchAttr.needsUpdate = true; pinMat.uniforms.uDimAll.value = 0.8;
  }

  // ---- axis labels that stay attached to the map ----
  const tick = (x, z, text, cls) => ({ p: new THREE.Vector3(x, 0, z), el: Object.assign(document.createElement("span"), { className: `t-tick ${cls}`, textContent: text }) });
  const ticks = [
    tick(-0.82, 1.12, "Safer from AI", "x"), tick(0, 1.12, "AI exposure", "x mid"), tick(0.82, 1.12, "More exposed", "x"),
    tick(-1.04, -1.0, "Higher pay", "z"),
  ];
  if (focusIdx >= 0) {
    const f = tick(t.pos[focusIdx * 3], t.pos[focusIdx * 3 + 2], opts.focusLabel || "Your job", "flag");
    f.p.y = t.pos[focusIdx * 3 + 1] + 0.31; ticks.push(f);
  }
  ticks.forEach((k) => labels.append(k.el));

  // ---- camera, mouse and picking ----
  let W = 1, H = 1, raf = 0, alive = true, visible = true, hover = -1, selected = -1;
  let az = 0, el = 0, tAz = 0, tEl = 0;
  const t0 = performance.now(), introMs = opts.introMs || 2600;
  const base = { dist: opts.dist || 3.15, height: opts.height || 1.65 };
  const mvp = new THREE.Matrix4();
  // step back on tall screens so the whole map fits; move in on wide strips so it fills them
  const fitFor = (a) => (a < 1.05 ? 1.15 / a : Math.max(0.74, Math.sqrt(1.5 / a)));

  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    canvas.style.width = "100%"; canvas.style.height = "100%";
    camera.aspect = W / H;
    // keep the whole map in view on narrow screens by stepping back
    const fit = fitFor(camera.aspect);
    camera.position.set(0, base.height * fit, base.dist * fit);
    camera.updateProjectionMatrix();
    pinMat.uniforms.uPx.value = renderer.getPixelRatio() * 2.1 * Math.min(1.2, Math.max(0.7, H / 700));
    // leave room for panels that sit over the map (the home page's title block)
    const shift = W > 900 ? (opts.shiftX || 0) * W : 0;
    if (shift) camera.setViewOffset(W, H, -shift, 0, W, H); else camera.clearViewOffset();
    if (!raf) loop();
  }

  function placeCamera() {
    const fit = fitFor(camera.aspect);
    const d = base.dist * fit, hgt = base.height * fit;
    camera.position.set(Math.sin(az) * d, hgt + el, Math.cos(az) * d);
    camera.lookAt(0, 0.04, 0.04);
    camera.updateMatrixWorld();
    mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  const fmtPay = (x) => (x >= 1000 ? `$${Math.round(x / 1000)}k` : `$${x}`);
  const fmtW = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function showTip(i, touch) {
    if (i < 0) { tip.hidden = true; return; }
    const j = jobs[i];
    const p = new THREE.Vector3(t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]).project(camera);
    const sx = (p.x + 1) / 2 * W, sy = (1 - p.y) / 2 * H;
    tip.innerHTML = `<b>${esc(j.title)}</b><span>AI exposure ${Math.round(j.score)} of 100</span><span>${j.workers ? fmtW(j.workers) + " workers" : ""}${j.median_pay ? `, typical pay ${fmtPay(j.median_pay)}` : ""}</span>` +
      (opts.onPick ? (touch ? `<a href="#/job/${j.soc}">Open this job</a>` : `<em>Click to open</em>`) : "");
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = sx + 14, top = sy - th - 14;
    if (left + tw > W - 8) left = sx - tw - 14;
    if (top < 8) top = sy + 16;
    tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }

  const pickAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return Engine.pick(mvp.elements, N, e.clientX - r.left, e.clientY - r.top, W, H, 0.3, pinMat.uniforms.uDimAll.value > 0.5 && focusIdx < 0);
  };
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    if (!REDUCED) { tAz = ((e.clientX - r.left) / W - 0.5) * 0.34; tEl = ((e.clientY - r.top) / H - 0.5) * -0.25; }
    if (e.pointerType === "touch") return;
    hover = shared.uGrow.value >= 1 ? pickAt(e) : -1;
    canvas.style.cursor = hover >= 0 && opts.onPick ? "pointer" : "";
    showTip(hover, false);
    if (!raf) loop();
  }
  function onLeave() { hover = -1; tip.hidden = true; tAz = 0; tEl = 0; }
  function onUp(e) {
    const i = pickAt(e);
    if (e.pointerType === "touch" || e.pointerType === "pen") { hover = selected = i; showTip(i, true); }
    else if (i >= 0 && opts.onPick) opts.onPick(jobs[i]);
    if (!raf) loop();
  }
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerup", onUp);

  let shoreTarget = shared.uShore.value;
  function loop() {
    raf = 0;
    if (!alive || !visible) return;
    const now = performance.now(), time = (now - t0) / 1000;
    if (!REDUCED) {
      shared.uTime.value = time;
      if (shared.uGrow.value < 1) shared.uGrow.value = Math.min(1, (now - t0) / introMs);
      az += (tAz - az) * 0.05; el += (tEl - el) * 0.05;
      shared.uShore.value += (shoreTarget - shared.uShore.value) * 0.06;
    } else { shared.uShore.value = shoreTarget; }
    placeCamera();
    pinMat.uniforms.uHover.value = hover;
    renderer.render(scene, camera);
    for (const k of ticks) {
      const p = k.p.clone().project(camera);
      k.el.style.transform = `translate(${(p.x + 1) / 2 * W}px, ${(1 - p.y) / 2 * H}px)`;
      k.el.style.opacity = Math.min(1, shared.uGrow.value * 1.5);
    }
    if (hover >= 0 && !tip.hidden) showTip(hover, selected === hover);
    if (!REDUCED) raf = requestAnimationFrame(loop);
  }

  const ro = new ResizeObserver(resize); ro.observe(root);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting && !document.hidden; if (visible && !raf) loop(); });
  io.observe(root);
  const onVis = () => { visible = !document.hidden; if (visible && !raf) loop(); };
  document.addEventListener("visibilitychange", onVis);
  // re-read the palette when the visitor switches light / dark
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => { Object.assign(terrainMat.uniforms, palette()); waterMat.uniforms.uSea.value = col("--sea"); pinMat.uniforms.uInk.value = col("--ink"); if (!raf) loop(); };
  mq.addEventListener("change", onScheme);
  resize();

  return {
    setMatch(set) {
      if (focusIdx >= 0) return;
      if (!set) { v.match.fill(1); pinMat.uniforms.uDimAll.value = 0; }
      else { for (let i = 0; i < N; i++) v.match[i] = set.has(jobs[i].soc) ? 1 : 0; pinMat.uniforms.uDimAll.value = 1; }
      matchAttr.needsUpdate = true;
      if (!raf) loop();
    },
    setShore(x) { shoreTarget = x; if (!raf) loop(); },
    destroy() {
      alive = false; cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onScheme);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose(); renderer.forceContextLoss();
    },
  };
}

window.Terrain = { mount };
if (window.__terrainReady) window.__terrainReady(window.Terrain);
