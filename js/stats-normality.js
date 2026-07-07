/*
 * stats-normality.js — Normality and outlier tests for StatLab
 * Shapiro-Wilk (Royston 1992/1995), D'Agostino-Pearson omnibus,
 * Anderson-Darling, and Grubbs' (incl. iterative ESD).
 * Depends on StatCore.
 */
const StatNorm = (function (C) {
  'use strict';

  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
  function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); }
  const polyH = (c, x) => c.reduce((acc, k) => acc * x + k, 0); // Horner, c high->low power

  // ---------- Shapiro-Wilk ----------
  function shapiroWilk(raw) {
    const x = raw.slice().sort((a, b) => a - b);
    const n = x.length;
    if (n < 3) return { error: 'n must be >= 3' };
    if (n > 5000) return { error: 'n must be <= 5000' };

    const m = new Array(n);
    for (let i = 0; i < n; i++) m[i] = C.normalInv((i + 1 - 0.375) / (n + 0.25));
    const M = m.reduce((s, v) => s + v * v, 0);
    const rsn = 1 / Math.sqrt(n);
    const a = new Array(n).fill(0);

    if (n === 3) {
      a[0] = -Math.SQRT1_2; a[2] = Math.SQRT1_2;
    } else {
      const c1 = [-2.706056, 4.434685, -2.071190, -0.147981, 0.221157, 0];
      const c2 = [-3.582633, 5.682633, -1.752461, -0.293762, 0.042981, 0];
      const an = polyH(c1, rsn) + m[n - 1] / Math.sqrt(M);
      let fac, an1 = 0;
      let i1;
      if (n > 5) {
        an1 = polyH(c2, rsn) + m[n - 2] / Math.sqrt(M);
        fac = (M - 2 * m[n - 1] * m[n - 1] - 2 * m[n - 2] * m[n - 2]) /
          (1 - 2 * an * an - 2 * an1 * an1);
        i1 = 2;
        a[n - 2] = an1; a[1] = -an1;
      } else {
        fac = (M - 2 * m[n - 1] * m[n - 1]) / (1 - 2 * an * an);
        i1 = 1;
      }
      a[n - 1] = an; a[0] = -an;
      const sf = Math.sqrt(fac);
      for (let i = i1; i <= n - 1 - i1; i++) a[i] = m[i] / sf;
    }

    const xbar = mean(x);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += a[i] * x[i]; den += (x[i] - xbar) ** 2; }
    const W = (num * num) / den;

    // p-value (Royston)
    let p;
    if (n === 3) {
      const pi6 = 6 / Math.PI, stqr = Math.asin(Math.sqrt(0.75));
      p = pi6 * (Math.asin(Math.sqrt(W)) - stqr);
      p = Math.max(0, Math.min(1, p));
    } else {
      let w1, mu, sigma;
      if (n <= 11) {
        const g = -2.273 + 0.459 * n;
        mu = 0.5440 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n * n * n;
        sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n * n * n);
        w1 = -Math.log(g - Math.log(1 - W));
      } else {
        const lnn = Math.log(n);
        mu = -1.5861 - 0.31082 * lnn - 0.083751 * lnn * lnn + 0.0038915 * lnn * lnn * lnn;
        sigma = Math.exp(-0.4803 - 0.082676 * lnn + 0.0030302 * lnn * lnn);
        w1 = Math.log(1 - W);
      }
      const z = (w1 - mu) / sigma;
      p = 1 - C.normalCDF(z);
    }
    return { test: 'Shapiro-Wilk', n, W, p, weights: a };
  }

  // ---------- D'Agostino-Pearson omnibus K^2 ----------
  function dagostinoPearson(raw) {
    const a = raw.slice();
    const n = a.length;
    if (n < 8) return { test: "D'Agostino-Pearson", n, error: 'n must be >= 8 (>= 20 recommended)' };
    const m = mean(a);
    let m2 = 0, m3 = 0, m4 = 0;
    for (const v of a) { const d = v - m, d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
    m2 /= n; m3 /= n; m4 /= n;
    const sqrtb1 = m3 / Math.pow(m2, 1.5);
    const b2 = m4 / (m2 * m2);

    // Skewness transform (D'Agostino 1970)
    const Y = sqrtb1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
    const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) /
      ((n - 2) * (n + 5) * (n + 7) * (n + 9));
    const W2 = -1 + Math.sqrt(2 * (beta2 - 1));
    const delta = 1 / Math.sqrt(0.5 * Math.log(W2));
    const alpha = Math.sqrt(2 / (W2 - 1));
    const Z1 = delta * Math.asinh(Y / alpha);

    // Kurtosis transform (Anscombe-Glynn 1983)
    const Eb2 = 3 * (n - 1) / (n + 1);
    const varb2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) * (n + 1) * (n + 3) * (n + 5));
    const xk = (b2 - Eb2) / Math.sqrt(varb2);
    const sqrtBeta1 = (6 * (n * n - 5 * n + 2) / ((n + 7) * (n + 9))) *
      Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
    const A = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
    const term = (1 - 2 / A) / (1 + xk * Math.sqrt(2 / (A - 4)));
    const Z2 = ((1 - 2 / (9 * A)) - Math.cbrt(term)) / Math.sqrt(2 / (9 * A));

    const K2 = Z1 * Z1 + Z2 * Z2;
    const p = C.chiSquareP(K2, 2);
    return { test: "D'Agostino-Pearson", n, skewness: sqrtb1, kurtosis: b2 - 3, K2, Z1, Z2, p };
  }

  // ---------- Anderson-Darling ----------
  function andersonDarling(raw) {
    const x = raw.slice().sort((a, b) => a - b);
    const n = x.length;
    if (n < 8) return { test: 'Anderson-Darling', n, error: 'n must be >= 8' };
    const m = mean(x), s = sd(x);
    let A2 = 0;
    for (let i = 0; i < n; i++) {
      const zi = C.normalCDF((x[i] - m) / s);
      const zni = C.normalCDF((x[n - 1 - i] - m) / s);
      A2 += (2 * (i + 1) - 1) * (Math.log(zi) + Math.log(1 - zni));
    }
    A2 = -n - A2 / n;
    const Astar = A2 * (1 + 0.75 / n + 2.25 / (n * n));
    let p;
    if (Astar >= 0.6) p = Math.exp(1.2937 - 5.709 * Astar + 0.0186 * Astar * Astar);
    else if (Astar >= 0.34) p = Math.exp(0.9177 - 4.279 * Astar - 1.38 * Astar * Astar);
    else if (Astar >= 0.2) p = 1 - Math.exp(-8.318 + 42.796 * Astar - 59.938 * Astar * Astar);
    else p = 1 - Math.exp(-13.436 + 101.14 * Astar - 223.73 * Astar * Astar);
    p = Math.max(0, Math.min(1, p));
    return { test: 'Anderson-Darling', n, A2, Astar, p };
  }

  // ---------- Grubbs' test ----------
  function grubbsOnce(a) {
    const n = a.length;
    const m = mean(a), s = sd(a);
    let maxDev = -1, idx = -1;
    for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - m); if (d > maxDev) { maxDev = d; idx = i; } }
    const G = maxDev / s;
    const R = (G * G * n) / ((n - 1) * (n - 1));
    const t2 = (R * (n - 2)) / (1 - R);
    const t = Math.sqrt(Math.max(t2, 0));
    let p = n * C.studentTtwoTailP(t, n - 2);
    p = Math.min(1, p);
    // critical value at alpha=0.05 (two-sided)
    const tcrit = C.studentTinv(1 - 0.05 / (2 * n), n - 2);
    const Gcrit = ((n - 1) / Math.sqrt(n)) * Math.sqrt(tcrit * tcrit / (n - 2 + tcrit * tcrit));
    return { G, p, idx, value: a[idx], mean: m, sd: s, Gcrit, n };
  }

  function grubbs(raw) {
    const a = raw.slice();
    if (a.length < 3) return { test: "Grubbs' test", error: 'n must be >= 3' };
    const r = grubbsOnce(a);
    return { test: "Grubbs' test (two-sided, alpha=0.05)", ...r, isOutlier: r.p < 0.05 };
  }

  // Iterative Grubbs / ESD: repeatedly remove the most extreme value while significant
  function grubbsIterative(raw, alpha = 0.05) {
    let a = raw.slice();
    const removed = [];
    while (a.length >= 3) {
      const r = grubbsOnce(a);
      if (r.p < alpha) {
        removed.push({ value: r.value, G: r.G, p: r.p, Gcrit: r.Gcrit, nAtTest: a.length });
        a.splice(r.idx, 1);
      } else break;
    }
    return { test: "Grubbs' iterative (ESD)", alpha, outliers: removed, cleanedN: a.length, cleaned: a };
  }

  return { shapiroWilk, dagostinoPearson, andersonDarling, grubbs, grubbsIterative };
})(typeof StatCore !== 'undefined' ? StatCore : require('./stats-core.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = StatNorm;
