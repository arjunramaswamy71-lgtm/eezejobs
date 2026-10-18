// eezejobs browser engine: C++ compiled to WebAssembly.
//
// Everything heavy on the website runs here, inside the browser, at near-native speed:
//   1. The job universe: lays out all 809 jobs as 3D points and finds the dot under the mouse.
//      Positions, colours and sizes live in this module's memory, and WebGL uploads them straight
//      from it, so nothing is copied through JavaScript.
//   2. The career engine: bootstraps hazard curves, values a career, prices career insurance,
//      and Monte Carlo simulates hundreds of thousands of careers each time a visitor changes an input.
//
// No allocator, no exceptions, no JavaScript imports: fixed buffers and pure maths from wasi-libc's libm.
// Build:  bash engine/build.sh   (clang++ --target=wasm32-wasi, see the script)

#include <math.h>
#include <stdint.h>

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

static const int MAXJ = 1024;

// ---------- Shared buffers (JavaScript reads and writes these through typed-array views) ----------
static float  g_score[MAXJ], g_pay[MAXJ], g_workers[MAXJ];
static char   g_soc[MAXJ * 8];                 // job codes like "15-2021", 8 bytes each
static float  g_pos[MAXJ * 3], g_start[MAXJ * 3], g_color[MAXJ * 3], g_size[MAXJ], g_id[MAXJ], g_match[MAXJ];
static float  g_mvp[16];
static double g_F[4], g_lam[4], g_out[16];
static const int BINS = 64, FINE = 2048;
static float  g_hist_ai[BINS], g_hist_none[BINS];
static uint32_t g_fine_ai[FINE], g_fine_none[FINE];

EXPORT(score_ptr) float* score_ptr() { return g_score; }
EXPORT(pay_ptr) float* pay_ptr() { return g_pay; }
EXPORT(workers_ptr) float* workers_ptr() { return g_workers; }
EXPORT(soc_ptr) char* soc_ptr() { return g_soc; }
EXPORT(pos_ptr) float* pos_ptr() { return g_pos; }
EXPORT(start_ptr) float* start_ptr() { return g_start; }
EXPORT(color_ptr) float* color_ptr() { return g_color; }
EXPORT(size_ptr) float* size_ptr() { return g_size; }
EXPORT(id_ptr) float* id_ptr() { return g_id; }
EXPORT(match_ptr) float* match_ptr() { return g_match; }
EXPORT(mvp_ptr) float* mvp_ptr() { return g_mvp; }
EXPORT(F_ptr) double* F_ptr() { return g_F; }
EXPORT(lam_ptr) double* lam_ptr() { return g_lam; }
EXPORT(out_ptr) double* out_ptr() { return g_out; }
EXPORT(hist_ai_ptr) float* hist_ai_ptr() { return g_hist_ai; }
EXPORT(hist_none_ptr) float* hist_none_ptr() { return g_hist_none; }
EXPORT(bins) int bins() { return BINS; }
EXPORT(max_jobs) int max_jobs() { return MAXJ; }

// ---------- Small helpers ----------
static inline double clampd(double x, double lo, double hi) { return x < lo ? lo : (x > hi ? hi : x); }

// Same FNV-1a hash the JavaScript version used, so the map looks identical either way
static double hash01(const char* s, int seed) {
  uint32_t h = 2166136261u ^ (uint32_t)seed;
  for (int i = 0; i < 8 && s[i]; i++) { h ^= (uint8_t)s[i]; h *= 16777619u; }
  return (double)(h % 100000u) / 100000.0;
}

// Green (safe) to amber to coral (exposed), matching the CSS tokens and the GLSL shaders
static void ramp(double s, float* out) {
  static const double A[3] = {0.18, 0.83, 0.64}, B[3] = {0.96, 0.71, 0.27}, C[3] = {1.0, 0.36, 0.43};
  s = clampd(s, 0, 100);
  const double* p = s <= 50 ? A : B;
  const double* q = s <= 50 ? B : C;
  double t = s <= 50 ? s / 50 : (s - 50) / 50;
  for (int i = 0; i < 3; i++) out[i] = (float)(p[i] + (q[i] - p[i]) * t);
}

// ---------- 1. The job universe ----------
// x = AI exposure, y = typical pay on a log scale, z = depth; start = a spiral the dots fly in from
EXPORT(layout) void layout(int n) {
  if (n > MAXJ) n = MAXJ;
  const double lo = log(28000.0), hi = log(240000.0);
  float maxw = 1;
  for (int i = 0; i < n; i++) if (g_workers[i] > maxw) maxw = g_workers[i];
  for (int i = 0; i < n; i++) {
    const char* soc = g_soc + i * 8;
    double lp = g_pay[i] > 0 ? log((double)g_pay[i]) : log(55000.0);
    g_pos[i * 3] = (float)(g_score[i] / 50.0 - 1.0 + (hash01(soc, 1) - 0.5) * 0.025);
    g_pos[i * 3 + 1] = (float)clampd((lp - lo) / (hi - lo) * 2 - 1, -1, 1);
    g_pos[i * 3 + 2] = (float)((hash01(soc, 2) - 0.5) * 0.7);
    double ang = i * 2.39996, rad = 0.25 + sqrt(hash01(soc, 3)) * 1.5;
    g_start[i * 3] = (float)(cos(ang) * rad);
    g_start[i * 3 + 1] = (float)((hash01(soc, 4) - 0.5) * 0.25);
    g_start[i * 3 + 2] = (float)(sin(ang) * rad);
    ramp(g_score[i], g_color + i * 3);
    g_size[i] = (float)(4 + 20 * sqrt(g_workers[i] / maxw));
    g_id[i] = (float)i;
    g_match[i] = 1;
  }
}

// Project every point with the current camera matrix and return the one under the mouse (or -1)
EXPORT(pick) int pick(int n, float mx, float my, float W, float H, float sizeScale, int dimOnly) {
  const float* m = g_mvp;
  int best = -1; float bestD = 1e30f;
  for (int i = 0; i < n; i++) {
    if (dimOnly && g_match[i] < 0.5f) continue;
    float x = g_pos[i * 3], y = g_pos[i * 3 + 1], z = g_pos[i * 3 + 2];
    float cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    float cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    float cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    float sx = (cx / cw + 1) * 0.5f * W, sy = (1 - cy / cw) * 0.5f * H;
    float rad = g_size[i] * sizeScale * (3.6f / cw) * 0.5f;
    if (rad < 9) rad = 9;
    float dx = sx - mx, dy = sy - my, d = sqrtf(dx * dx + dy * dy);
    if (d < rad && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

// ---------- 2. The career engine ----------
static const double KN[4] = {1, 3, 5, 10};
static const double RATE = 0.04, DRIFT = 0.01, VOL = 0.06, CUT = 0.20, GAP = 0.5;

// Cumulative automation share at 1, 3, 5, 10 years -> piecewise-flat hazard (credit-curve bootstrapping)
EXPORT(hazard) void hazard() {
  double prevS = 1, prevT = 0;
  for (int k = 0; k < 4; k++) {
    double s = clampd(1 - g_F[k], 1e-9, prevS);
    g_lam[k] = fmax(0, -log(s / prevS) / (KN[k] - prevT));
    prevS = s; prevT = KN[k];
  }
}
static double cumhaz(double t) {
  double total = 0, prev = 0;
  for (int k = 0; k < 4; k++) {
    double stop = t < KN[k] ? t : KN[k];
    if (stop > prev) total += g_lam[k] * (stop - prev);
    prev = KN[k];
    if (t <= prev) return total;
  }
  return total + g_lam[3] * (t - prev);
}
static double lam_at(double t) { for (int k = 0; k < 4; k++) if (t < KN[k]) return g_lam[k]; return g_lam[3]; }
EXPORT(survival) double survival(double t) { return exp(-cumhaz(t)); }

// Expected value of a career today, with and without AI risk -> out[0], out[1]
EXPORT(career) void career(double pay, int years) {
  double ai = 0, none = 0;
  for (int y = 1; y <= years; y++) {
    double w = pay * exp(DRIFT * y) * exp(-RATE * y), s = survival(y), sp = survival(y - 1);
    none += w;
    ai += w * (s + (1 - s) * (1 - CUT) - (sp - s) * GAP);
  }
  g_out[0] = ai; g_out[1] = none;
}

// Fair yearly premium (share of pay) for cover that pays one year's pay if the job is automated within `years`
EXPORT(insurance) double insurance(int years) {
  int steps = years * 52; double h = (double)years / steps, prot = 0, annuity = 0;
  for (int i = 0; i <= steps; i++) {
    double u = i * h, f = lam_at(u) * survival(u) * exp(-RATE * u);
    prot += (i == 0 || i == steps ? 0.5 : 1.0) * f * h;
  }
  for (int k = 1; k <= years; k++) annuity += survival(k) * exp(-RATE * k);
  return prot / annuity;
}

// xoshiro128** random numbers and Box-Muller normals
static uint32_t rs[4];
static inline uint32_t rotl(uint32_t x, int k) { return (x << k) | (x >> (32 - k)); }
static inline uint32_t next_u32() {
  uint32_t r = rotl(rs[1] * 5, 7) * 9, t = rs[1] << 9;
  rs[2] ^= rs[0]; rs[3] ^= rs[1]; rs[1] ^= rs[2]; rs[0] ^= rs[3]; rs[2] ^= t; rs[3] = rotl(rs[3], 11);
  return r;
}
static inline double uniform() { return ((next_u32() >> 8) + 0.5) * (1.0 / 16777216.0); }
static double spare; static int has_spare = 0;
static inline double normal() {
  if (has_spare) { has_spare = 0; return spare; }
  double u = uniform(), v = uniform(), r = sqrt(-2 * log(u));
  spare = r * sin(6.283185307179586 * v); has_spare = 1;
  return r * cos(6.283185307179586 * v);
}
static double automation_time(double e) {
  double total = 0, prev = 0;
  for (int k = 0; k < 4; k++) {
    double piece = g_lam[k] * (KN[k] - prev);
    if (total + piece >= e) return prev + (e - total) / g_lam[k];
    total += piece; prev = KN[k];
  }
  return g_lam[3] > 0 ? prev + (e - total) / g_lam[3] : 1e9;
}

// Monte Carlo: `paths` careers (antithetic pairs), each `years` long.
// Writes histograms of lifetime pay with and without AI risk, plus out[0..9]:
// mean AI, mean no-AI, p5, p50, p95 (AI), share automated within 10 years, axis max, paths, worst-case loss p5
EXPORT(simulate) void simulate(double pay, int years, int paths, uint32_t seed) {
  rs[0] = seed ^ 0x9E3779B9u; rs[1] = seed * 2654435761u + 1; rs[2] = 0xDEADBEEFu ^ seed; rs[3] = 0x12345678u + seed;
  for (int i = 0; i < 16; i++) next_u32();
  has_spare = 0;
  if (years > 60) years = 60;
  double z[60];
  // Axis: generous bound on lifetime pay so the histogram fits
  double top = 0; for (int y = 1; y <= years; y++) top += pay * exp((DRIFT + 2.5 * VOL) * y) * exp(-RATE * y);
  for (int i = 0; i < FINE; i++) { g_fine_ai[i] = 0; g_fine_none[i] = 0; }
  double sum_ai = 0, sum_none = 0; int hit10 = 0;
  for (int p = 0; p < paths; p += 2) {
    for (int y = 0; y < years; y++) z[y] = normal();
    double tau = automation_time(-log(uniform()));
    if (tau <= 10) hit10 += 2;
    for (int side = 0; side < 2; side++) {
      double sgn = side ? -1 : 1, w = pay, a = 0, n = 0;
      for (int y = 1; y <= years; y++) {
        w *= exp(DRIFT - VOL * VOL / 2 + VOL * sgn * z[y - 1]);
        double df = exp(-RATE * y);
        n += w * df;
        if (tau >= y) a += w * df;
        else {
          double lost = clampd(fmin(y, tau + GAP) - fmax(y - 1, tau), 0, 1);
          double before = clampd(tau - (y - 1), 0, 1);
          a += w * df * (before + (1 - lost - before) * (1 - CUT));
        }
      }
      sum_ai += a; sum_none += n;
      int ba = (int)(a / top * FINE), bn = (int)(n / top * FINE);
      g_fine_ai[ba < 0 ? 0 : (ba >= FINE ? FINE - 1 : ba)]++;
      g_fine_none[bn < 0 ? 0 : (bn >= FINE ? FINE - 1 : bn)]++;
    }
  }
  int total = paths - (paths % 2);
  // Percentiles from the fine histogram
  double q[3] = {0.05, 0.5, 0.95}, qv[3] = {0, 0, 0};
  for (int k = 0; k < 3; k++) {
    uint32_t need = (uint32_t)(q[k] * total), acc = 0;
    for (int i = 0; i < FINE; i++) { acc += g_fine_ai[i]; if (acc >= need) { qv[k] = (i + 0.5) / FINE * top; break; } }
  }
  // Trim the axis to the middle 99.6% of all outcomes, then fold into display bins as densities
  // (dividing by how many fine bins fed each display bin, so the curve doesn't come out saw-toothed)
  uint32_t lo_need = (uint32_t)(0.002 * 2 * total), hi_need = (uint32_t)(0.998 * 2 * total), acc = 0;
  int first = 0, last = FINE - 1; int found = 0;
  for (int i = 0; i < FINE; i++) {
    acc += g_fine_ai[i] + g_fine_none[i];
    if (!found && acc >= lo_need) { first = i; found = 1; }
    if (acc >= hi_need) { last = i; break; }
  }
  static int cnt[BINS];
  for (int b = 0; b < BINS; b++) { g_hist_ai[b] = 0; g_hist_none[b] = 0; cnt[b] = 0; }
  int span = last - first + 1; if (span < 1) span = 1;
  for (int i = first; i <= last; i++) {
    int b = (int)((i - first + 0.5) / span * BINS); if (b >= BINS) b = BINS - 1;
    g_hist_ai[b] += g_fine_ai[i]; g_hist_none[b] += g_fine_none[i]; cnt[b]++;
  }
  for (int b = 0; b < BINS; b++) if (cnt[b]) { g_hist_ai[b] /= cnt[b]; g_hist_none[b] /= cnt[b]; }
  g_out[0] = sum_ai / total; g_out[1] = sum_none / total;
  g_out[2] = qv[0]; g_out[3] = qv[1]; g_out[4] = qv[2];
  g_out[5] = (double)hit10 / total;
  g_out[6] = (double)first / FINE * top; g_out[7] = (double)(last + 1) / FINE * top;
  g_out[8] = total;
}

// ---------- 3. The terrain of work ----------
// A heightfield over (AI exposure, pay): every job adds a hill sized by how many people do it.
// Heights, surface normals and each job's ground height are written into this module's memory;
// Three.js turns them into GPU buffers straight from these views.
static const int TMAX = 161;                      // up to 160 x 160 cells
static float g_height[TMAX * TMAX], g_normal[TMAX * TMAX * 3];

EXPORT(height_ptr) float* height_ptr() { return g_height; }
EXPORT(normal_ptr) float* normal_ptr() { return g_normal; }

static inline float sample_h(int res, float x, float z) {     // bilinear sample at world x, z in [-1, 1]
  float gx = (x + 1) * 0.5f * res, gz = (z + 1) * 0.5f * res;
  int ix = (int)gx, iz = (int)gz;
  if (ix < 0) ix = 0; if (iz < 0) iz = 0; if (ix > res - 1) ix = res - 1; if (iz > res - 1) iz = res - 1;
  float fx = gx - ix, fz = gz - iz; int w = res + 1;
  float a = g_height[iz * w + ix], b = g_height[iz * w + ix + 1], c = g_height[(iz + 1) * w + ix], d = g_height[(iz + 1) * w + ix + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

// layout() must run first. scale = world height of the tallest hill. Job positions in g_pos become (x, ground, z).
EXPORT(terrain) void terrain(int n, int res, float sigma, float scale) {
  if (res > TMAX - 1) res = TMAX - 1;
  int w = res + 1;
  for (int i = 0; i < w * w; i++) g_height[i] = 0;
  float cell = 2.0f / res, rad = 3 * sigma, inv2s = 1.0f / (2 * sigma * sigma);
  for (int j = 0; j < n; j++) {
    float x = g_pos[j * 3], z = -g_pos[j * 3 + 1];             // pay runs into the distance
    float wt = powf(g_workers[j] > 0 ? g_workers[j] : 1, 0.75f);
    int x0 = (int)((x - rad + 1) / cell), x1 = (int)((x + rad + 1) / cell) + 1;
    int z0 = (int)((z - rad + 1) / cell), z1 = (int)((z + rad + 1) / cell) + 1;
    if (x0 < 0) x0 = 0; if (z0 < 0) z0 = 0; if (x1 > res) x1 = res; if (z1 > res) z1 = res;
    for (int iz = z0; iz <= z1; iz++) for (int ix = x0; ix <= x1; ix++) {
      float dx = ix * cell - 1 - x, dz = iz * cell - 1 - z;
      g_height[iz * w + ix] += wt * expf(-(dx * dx + dz * dz) * inv2s);
    }
  }
  float mx = 1e-9f; for (int i = 0; i < w * w; i++) if (g_height[i] > mx) mx = g_height[i];
  for (int i = 0; i < w * w; i++) g_height[i] = powf(g_height[i] / mx, 0.7f);
  // Normals by central differences on the scaled surface
  for (int iz = 0; iz < w; iz++) for (int ix = 0; ix < w; ix++) {
    int xl = ix > 0 ? ix - 1 : ix, xr = ix < res ? ix + 1 : ix, zl = iz > 0 ? iz - 1 : iz, zr = iz < res ? iz + 1 : iz;
    float dhx = (g_height[iz * w + xr] - g_height[iz * w + xl]) * scale / ((xr - xl) * cell);
    float dhz = (g_height[zr * w + ix] - g_height[zl * w + ix]) * scale / ((zr - zl) * cell);
    float nx = -dhx, ny = 1, nz = -dhz, len = sqrtf(nx * nx + ny * ny + nz * nz);
    float* o = g_normal + (iz * w + ix) * 3; o[0] = nx / len; o[1] = ny / len; o[2] = nz / len;
  }
  // Put every job on the ground: g_pos becomes world coordinates (x, height, z)
  for (int j = 0; j < n; j++) {
    float x = g_pos[j * 3], z = -g_pos[j * 3 + 1];
    g_pos[j * 3 + 1] = sample_h(res, x, z) * scale;
    g_pos[j * 3 + 2] = z;
  }
}
