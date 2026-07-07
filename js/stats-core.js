/*
 * stats-core.js — Numerical foundation for StatLab
 * ------------------------------------------------
 * Special functions and probability distributions used by every test.
 * Implementations follow Numerical Recipes (gamma/beta) and well-known
 * published algorithms (Acklam inverse-normal, R's ptukey port).
 *
 * Loaded as a classic <script> in the browser (exposes global `StatCore`)
 * and via require() in Node for verification.
 */
const StatCore = (function () {
  'use strict';

  const SQRT2 = Math.sqrt(2);
  const SQRT2PI = Math.sqrt(2 * Math.PI);
  const LOG_SQRT2PI = Math.log(SQRT2PI);

  // ---- Log gamma (Lanczos approximation) -------------------------------
  const LANCZOS_G = 7;
  const LANCZOS_C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  function gammaln(x) {
    if (x < 0.5) {
      // Reflection formula
      return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x);
    }
    x -= 1;
    let a = LANCZOS_C[0];
    const t = x + LANCZOS_G + 0.5;
    for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_C[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function gammafn(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammafn(1 - x));
    return Math.exp(gammaln(x));
  }

  function factorialln(n) { return gammaln(n + 1); }
  function combinationln(n, k) { return factorialln(n) - factorialln(k) - factorialln(n - k); }

  // ---- Incomplete gamma P(a,x) and Q(a,x) ------------------------------
  function gammapSeries(a, x) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }

  function gammaqContinuedFraction(a, x) {
    const FPMIN = 1e-300;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  }

  function gammp(a, x) {
    if (x <= 0 || a <= 0) return 0;
    if (x < a + 1) return gammapSeries(a, x);
    return 1 - gammaqContinuedFraction(a, x);
  }
  function gammq(a, x) {
    if (x <= 0 || a <= 0) return 1;
    if (x < a + 1) return 1 - gammapSeries(a, x);
    return gammaqContinuedFraction(a, x);
  }

  // ---- Error function via incomplete gamma -----------------------------
  function erf(x) { return x < 0 ? -gammp(0.5, x * x) : gammp(0.5, x * x); }
  function erfc(x) { return x < 0 ? 1 + gammp(0.5, x * x) : gammq(0.5, x * x); }

  // ---- Incomplete beta I_x(a,b) ----------------------------------------
  function betacf(a, b, x) {
    const FPMIN = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 1000; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }

  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(
      gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x)
    );
    if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
    return 1 - (bt * betacf(b, a, 1 - x)) / b;
  }

  // ---- Normal distribution ---------------------------------------------
  function normalPDF(x, mean = 0, sd = 1) {
    const z = (x - mean) / sd;
    return Math.exp(-0.5 * z * z) / (sd * SQRT2PI);
  }
  function normalCDF(x, mean = 0, sd = 1) {
    return 0.5 * erfc(-((x - mean) / sd) / SQRT2);
  }

  // Acklam's algorithm for the inverse normal CDF
  function normalInv(p, mean = 0, sd = 1) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416];
    const plow = 0.02425;
    const phigh = 1 - plow;
    let q, r, x;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= phigh) {
      q = p - 0.5;
      r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // One Halley refinement step for full double precision
    const e = normalCDF(x) - p;
    const u = e * SQRT2PI * Math.exp((x * x) / 2);
    x = x - u / (1 + (x * u) / 2);
    return mean + sd * x;
  }

  // ---- Student's t ------------------------------------------------------
  // CDF
  function studentTcdf(t, df) {
    const x = df / (df + t * t);
    const ib = 0.5 * betai(df / 2, 0.5, x);
    return t > 0 ? 1 - ib : ib;
  }
  // Two-tailed p-value for |T| >= |t|
  function studentTtwoTailP(t, df) {
    if (df <= 0) return NaN;
    const x = df / (df + t * t);
    return betai(df / 2, 0.5, x);
  }
  // Inverse t (two-sided critical value at given upper-tail prob)
  function studentTinv(p, df) {
    // p is the cumulative probability
    if (p === 0.5) return 0;
    let lo = -1000, hi = 1000;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (studentTcdf(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- F distribution ---------------------------------------------------
  // Upper-tail p-value P(F >= f)
  function fDistP(f, d1, d2) {
    if (f <= 0) return 1;
    return betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * f));
  }
  function fDistCDF(f, d1, d2) { return 1 - fDistP(f, d1, d2); }

  // ---- Chi-square -------------------------------------------------------
  function chiSquareP(x, k) { return gammq(k / 2, x / 2); }       // upper tail
  function chiSquareCDF(x, k) { return gammp(k / 2, x / 2); }

  // ---- Studentized range distribution (Tukey) --------------------------
  // Port of R's ptukey() / wprob(). Returns P(range < q) for cc groups,
  // rr ranges, with df degrees of freedom.
  function wprob(w, rr, cc) {
    const nleg = 12;
    const ihalf = 6;
    const C1 = -30, C2 = -50, C3 = 60;
    const bb = 8;
    const wlar = 100, wincr1 = 2, wincr2 = 3;
    const xleg = [
      0.981560634246719250690549090149, 0.904117256370474856678465866119,
      0.769902674194304687036893833213, 0.587317954286617447296702418941,
      0.367831498998180193752691536644, 0.125233408511468915472441369464,
    ];
    const aleg = [
      0.047175336386511827194615961485, 0.106939325995318430960254718194,
      0.160078328543346226334652529543, 0.203167426723065921749064455810,
      0.233492536538354808760849898925, 0.249147045813402785000562436043,
    ];
    let qsqz = w * 0.5;
    if (qsqz >= bb) return 1.0;

    // First integral term
    let pr_w = 2 * normalCDF(qsqz) - 1;
    if (pr_w >= Math.exp(C1 / cc)) pr_w = Math.pow(pr_w, cc);
    else pr_w = 0.0;

    let wincr;
    if (w > wlar) wincr = wincr1; else wincr = wincr2;

    let blb = qsqz;
    const binc = (bb - qsqz) / wincr;
    let cc1 = cc - 1;
    let einsum = 0.0;
    for (let wi = 1; wi <= wincr; wi++) {
      let elsum = 0.0;
      const a = 0.5 * (2 * blb + binc);
      const b = 0.5 * binc;
      for (let jj = 1; jj <= nleg; jj++) {
        let xx, j;
        if (jj <= ihalf) { j = jj - 1; xx = a - b * xleg[j]; }
        else { j = 2 * ihalf - jj; xx = a + b * xleg[j]; }
        const ac = xx * xx;
        let qexpo = ac * 0.5;
        if (qexpo > C3) break;
        const pplus = 2 * normalCDF(xx);
        const pminus = 2 * normalCDF(xx - w);
        let rinsum = pplus * 0.5 - pminus * 0.5;
        if (rinsum >= Math.exp(C1 / cc1)) {
          rinsum = aleg[j] * Math.exp(-(0.5 * ac)) * Math.pow(rinsum, cc1);
          elsum += rinsum;
        }
      }
      elsum *= 2.0 * b * cc / SQRT2PI;
      einsum += elsum;
      blb += binc;
    }
    pr_w += einsum;
    if (pr_w <= Math.exp(C1 / rr)) return 0;
    pr_w = Math.pow(pr_w, rr);
    return pr_w > 1 ? 1 : pr_w;
  }

  function ptukey(q, rr, cc, df) {
    if (q <= 0) return 0;
    const nlegq = 16, ihalfq = 8;
    const eps1 = -30.0, eps2 = 1e-14;
    const dhaf = 100.0, dquar = 800.0, deigh = 5000.0, dlarg = 25000.0;
    const ulen1 = 1.0, ulen2 = 0.5, ulen3 = 0.25, ulen4 = 0.125;
    const xlegq = [
      0.989400934991649932596154173450, 0.944575023073232576077988415535,
      0.865631202387831743880467897712, 0.755404408355003033895101194847,
      0.617876244402643748446671764049, 0.458016777657227386342419442984,
      0.281603550779258913230460501460, 0.950125098376374401853193354250e-1,
    ];
    const alegq = [
      0.271524594117540948517805724560e-1, 0.622535239386478928628438369944e-1,
      0.951585116824927848099251076022e-1, 0.124628971255533872052476282192,
      0.149595988816576732081501730547, 0.169156519395002538189312079030,
      0.182603415044923588866763667969, 0.189450610455068496285396723208,
    ];
    if (df > dlarg) return wprob(q, rr, cc);

    const f2 = df * 0.5;
    const f2lf = f2 * Math.log(df) - df * Math.log(2.0) - gammaln(f2);
    const ff4 = df * 0.25;
    let ulen;
    if (df <= dhaf) ulen = ulen1;
    else if (df <= dquar) ulen = ulen2;
    else if (df <= deigh) ulen = ulen3;
    else ulen = ulen4;

    const f2lfMod = f2lf + Math.log(ulen);
    let ans = 0.0;
    let otsum = 0.0;
    for (let i = 1; i <= 50; i++) {
      otsum = 0.0;
      const twa1 = (2 * i - 1) * ulen;
      for (let jj = 1; jj <= nlegq; jj++) {
        let j, t1;
        if (jj <= ihalfq) {
          j = jj - 1;
          t1 = f2lfMod + (f2 - 1.0) * Math.log(twa1 + xlegq[j] * ulen) -
            (xlegq[j] * ulen + twa1) * ff4;
        } else {
          j = 2 * ihalfq - jj;
          t1 = f2lfMod + (f2 - 1.0) * Math.log(twa1 - xlegq[j] * ulen) +
            (xlegq[j] * ulen - twa1) * ff4;
        }
        if (t1 >= eps1) {
          let qsqz;
          if (jj <= ihalfq) qsqz = q * Math.sqrt((xlegq[j] * ulen + twa1) * 0.5);
          else qsqz = q * Math.sqrt((-(xlegq[j] * ulen) + twa1) * 0.5);
          const wprb = wprob(qsqz, rr, cc);
          const rotsum = wprb * alegq[j] * Math.exp(t1);
          otsum += rotsum;
        }
      }
      if (i * ulen >= 1.0 && otsum <= eps2) break;
      ans += otsum;
    }
    if (ans > 1) ans = 1;
    return ans;
  }

  // p-value for Tukey: P(Q >= q)
  function tukeyP(q, k, df) {
    if (q <= 0) return 1;
    return 1 - ptukey(q, 1, k, df);
  }
  // Critical value of studentized range
  function tukeyInv(p, k, df) {
    let lo = 0, hi = 100;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (ptukey(mid, 1, k, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  return {
    gammaln, gammafn, factorialln, combinationln,
    gammp, gammq, erf, erfc, betai,
    normalPDF, normalCDF, normalInv,
    studentTcdf, studentTtwoTailP, studentTinv,
    fDistP, fDistCDF, chiSquareP, chiSquareCDF,
    ptukey, tukeyP, tukeyInv,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StatCore;
