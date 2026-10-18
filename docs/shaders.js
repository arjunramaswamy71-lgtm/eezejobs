"use strict";
/* Custom GLSL effects, written by hand with raw WebGL.
   Shaders.nebula(el)       domain-warped fbm nebula with twinkling stars, behind every dark band
   Shaders.orb(el, score)   a living sphere whose color, turbulence and energy veins grow with a job's AI exposure
   Both pause when off screen, and draw a single still frame when the visitor prefers reduced motion. */
const Shaders = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const QUAD_VS = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  /* Shared noise library: value noise plus fractal Brownian motion with a rotating octave matrix */
  const NOISE = `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}`;

  const NEBULA_FS = `
precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_scale;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  p += (u_mouse - 0.5) * 0.06;
  float t = u_time * 0.03;

  // Domain warping: noise feeding noise feeding noise gives the slow, smoky flow
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  vec2 r = vec2(fbm(p * 2.0 + q * 2.2 + vec2(1.7, 9.2) + t * 1.4), fbm(p * 2.0 + q * 2.2 + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.7 + r * 1.8);

  vec3 deep = mix(vec3(0.020, 0.030, 0.068), vec3(0.045, 0.068, 0.180), uv.y);
  vec3 indigo = vec3(0.32, 0.37, 1.0), mint = vec3(0.18, 0.83, 0.64), coral = vec3(1.0, 0.36, 0.43);
  vec3 col = deep;
  col += indigo * pow(f, 2.2) * 0.78;
  col += mint * smoothstep(0.5, 0.95, r.x) * 0.16 * (1.15 - uv.x);
  col += coral * smoothstep(0.5, 0.95, r.y) * 0.16 * (0.2 + uv.x);
  col += indigo * 0.05 * smoothstep(0.6, 1.0, q.y);

  // Twinkling star field on a coarse grid, so stars stay crisp at low render resolution
  // Kept faint and sparse so they never get confused with the job dots
  vec2 cell = floor(gl_FragCoord.xy / max(1.0, u_scale * 0.5));
  float h = hash(cell);
  float tw = 0.5 + 0.5 * sin(u_time * (0.6 + h * 2.0) + h * 60.0);
  col += vec3(0.8, 0.86, 1.0) * step(0.9993, h) * tw * 0.28;

  // Soft vignette and a touch of film grain to stop banding
  col *= 1.0 - 0.38 * length((uv - vec2(0.62, 0.48)) * vec2(1.1, 1.3));
  col += (hash(gl_FragCoord.xy + u_time) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}`;

  const ORB_FS = `
precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_score; uniform vec3 u_col; uniform vec2 u_mouse;
${NOISE}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / (0.5 * min(u_res.x, u_res.y));
  p *= 1.32;
  float r = length(p);
  float turb = mix(0.35, 1.8, u_score);
  float t = u_time * (0.10 + 0.22 * u_score);
  vec3 col = vec3(0.0);
  float a = 0.0;

  if (r < 1.0) {
    // Shade the disc as a sphere: rebuild the surface normal from x, y
    float z = sqrt(1.0 - r * r);
    vec3 n = vec3(p, z);
    // Flow noise across spherical coordinates so it wraps around the ball
    vec2 sp = vec2(atan(n.x, n.z) * 1.3 + t, asin(n.y) * 1.6);
    float warp = fbm(sp * 2.2 - t * 0.7);
    float f = fbm(sp * 2.6 + vec2(warp * turb, -t * 0.5));
    // Energy veins: thin bright contours of the noise field, stronger when the job is more exposed
    float vein = 1.0 - smoothstep(0.0, 0.035 + 0.02 * u_score, abs(f - 0.52));
    vec3 light = normalize(vec3(-0.45 + (u_mouse.x - 0.5) * 0.6, 0.55 - (u_mouse.y - 0.5) * 0.6, 0.75));
    float diff = max(dot(n, light), 0.0);
    float spec = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    float rim = pow(1.0 - z, 2.5);
    vec3 body = mix(u_col * 0.16, u_col * 0.95, smoothstep(0.25, 0.85, f));
    col = body * (0.3 + 0.85 * diff) + u_col * rim * 0.9 + vec3(1.0) * spec * 0.45 + mix(u_col, vec3(1.0), 0.5) * vein * (0.25 + 0.9 * u_score);
    a = 1.0;
    // Anti-aliased edge
    float edge = 1.0 - smoothstep(0.985, 1.0, r);
    col *= edge; a *= edge;
  }
  // Outer halo that breathes
  float halo = exp(-max(r - 1.0, 0.0) * 5.5) * (0.35 + 0.1 * sin(u_time * 1.6)) * step(0.985, r);
  col += u_col * halo * (0.6 + 0.6 * u_score);
  a = max(a, halo * 0.9);
  gl_FragColor = vec4(col, a);
}`;

  function setup(root, fs, opts) {
    const canvas = document.createElement("canvas");
    canvas.className = opts.className || "";
    canvas.setAttribute("aria-hidden", "true");
    root.prepend(canvas);
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { canvas.remove(); return null; }
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, make(gl.VERTEX_SHADER, QUAD_VS));
      gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (err) {
      console.warn("Shader failed:", err);
      canvas.remove();
      return null;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle covers the screen
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);

    let raf = 0, visible = true, alive = true, mouse = [0.5, 0.5], target = [0.5, 0.5];
    const t0 = performance.now() - (opts.timeOffset || 0);
    const res = opts.resolution || 1;
    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * res;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U("u_res"), canvas.width, canvas.height);
      if (U("u_scale")) gl.uniform1f(U("u_scale"), Math.max(1, dpr));
      if (!raf) frame();
    }
    function frame() {
      raf = 0;
      if (!alive || !visible) return;
      const time = REDUCED ? 24 : (performance.now() - t0) / 1000;
      mouse[0] += (target[0] - mouse[0]) * 0.04;
      mouse[1] += (target[1] - mouse[1]) * 0.04;
      gl.uniform1f(U("u_time"), time);
      gl.uniform2f(U("u_mouse"), mouse[0], mouse[1]);
      if (opts.uniforms) opts.uniforms(gl, U);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!REDUCED) raf = requestAnimationFrame(frame);
    }
    const onMove = (e) => {
      const r = root.getBoundingClientRect();
      target = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    const moveTarget = opts.mouseTarget || root;
    moveTarget.addEventListener("pointermove", onMove);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible && !raf) frame(); });
    io.observe(root);
    const onVis = () => { visible = !document.hidden; if (visible && !raf) frame(); };
    document.addEventListener("visibilitychange", onVis);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); alive = false; canvas.remove(); });
    root.classList.add("fx-on");
    return {
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        ro.disconnect(); io.disconnect();
        moveTarget.removeEventListener("pointermove", onMove);
        document.removeEventListener("visibilitychange", onVis);
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      },
    };
  }

  /* Distribution of simulated lifetime pay, drawn entirely in a fragment shader.
     The histogram bins arrive as a 64x1 texture (red = with AI risk, green = without); linear texture
     filtering smooths them, and every pixel decides for itself whether it sits under a curve or on its glowing edge. */
  const HIST_FS = `
precision highp float;
uniform vec2 u_res; uniform sampler2D u_bins; uniform float u_t; uniform vec3 u_hot; uniform vec3 u_cool;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 b = texture2D(u_bins, vec2(uv.x, 0.5));
  float hA = b.r * u_t * 0.88, hN = b.g * u_t * 0.88;
  float px = 1.0 / u_res.y;
  float underA = 1.0 - smoothstep(hA - px, hA + px, uv.y);
  float underN = 1.0 - smoothstep(hN - px, hN + px, uv.y);
  float edgeA = exp(-abs(uv.y - hA) / (2.5 * px)) * step(0.002, hA);
  float lineN = exp(-abs(uv.y - hN) / (1.6 * px)) * step(0.002, hN);
  vec3 fill = mix(u_hot * 0.55, u_hot, clamp(uv.y / max(hA, 0.001), 0.0, 1.0));
  vec3 col = fill * underA * 0.55 + u_hot * edgeA + u_cool * lineN + u_cool * underN * 0.06;
  float a = clamp(underA * 0.55 + edgeA + lineN + underN * 0.06, 0.0, 1.0);
  for (int i = 1; i < 4; i++) {                       // faint horizontal guides
    float g = 1.0 - smoothstep(0.0, px * 1.2, abs(uv.y - float(i) * 0.22));
    a = max(a, g * 0.07); col = max(col, vec3(0.5) * g * 0.07);
  }
  gl_FragColor = vec4(col * (a > 0.0 ? 1.0 : 0.0), a);
}`;

  function histogram(el, colors = { hot: [0.66, 0.28, 0.23], cool: [0.17, 0.42, 0.53] }) {
    const canvas = document.createElement("canvas");
    canvas.className = "fx-hist";
    canvas.setAttribute("aria-hidden", "true");
    el.prepend(canvas);
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { canvas.remove(); return null; }
    let prog;
    try {
      const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, make(gl.VERTEX_SHADER, QUAD_VS));
      gl.attachShader(prog, make(gl.FRAGMENT_SHADER, HIST_FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (err) { console.warn("Histogram shader failed:", err); canvas.remove(); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]
      .forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v));
    const U = (n) => gl.getUniformLocation(prog, n);
    gl.uniform1i(U("u_bins"), 0);
    gl.uniform3fv(U("u_hot"), colors.hot);
    gl.uniform3fv(U("u_cool"), colors.cool);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let raf = 0, t0 = 0;
    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U("u_res"), canvas.width, canvas.height);
    }
    function frame() {
      const t = REDUCED ? 1 : Math.min(1, (performance.now() - t0) / 550);
      gl.uniform1f(U("u_t"), 1 - Math.pow(1 - t, 3));
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = t < 1 ? requestAnimationFrame(frame) : 0;
    }
    const ro = new ResizeObserver(() => { resize(); if (!raf) frame(); });
    ro.observe(canvas);
    resize();
    return {
      update(histAI, histNone, animate = true) {
        const n = histAI.length, max = Math.max(1, ...histAI, ...histNone);
        const px = new Uint8Array(n * 4);
        for (let i = 0; i < n; i++) { px[i * 4] = Math.round((histAI[i] / max) * 255); px[i * 4 + 1] = Math.round((histNone[i] / max) * 255); px[i * 4 + 3] = 255; }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        t0 = animate ? performance.now() : 0;
        cancelAnimationFrame(raf);
        frame();
      },
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); const ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); },
    };
  }

  return {
    histogram,
    nebula(band) {
      return setup(band, NEBULA_FS, { className: "fx-nebula", resolution: 0.5, timeOffset: 40000 });
    },
    orb(el, score) {
      const c = (typeof Universe !== "undefined") ? Universe.ramp(score) : [1, 0.36, 0.43];
      return setup(el, ORB_FS, {
        className: "fx-orb", resolution: 1, mouseTarget: document,
        uniforms: (gl, U) => { gl.uniform1f(U("u_score"), score / 100); gl.uniform3f(U("u_col"), c[0], c[1], c[2]); },
      });
    },
  };
})();
