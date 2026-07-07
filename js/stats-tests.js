/*
 * stats-tests.js — Parametric & rank-based hypothesis tests for StatLab
 * Depends on StatCore.
 */
const StatTests = (function (C) {
  'use strict';

  // ---------- basic descriptive helpers ----------
  function clean(arr) { return arr.filter((v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))).map(Number); }
  function sum(a) { return a.reduce((s, v) => s + v, 0); }
  function mean(a) { return sum(a) / a.length; }
  function variance(a, m) { m = m === undefined ? mean(a) : m; if (a.length < 2) return NaN; return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1); }
  function sd(a, m) { return Math.sqrt(variance(a, m)); }
  function sem(a) { return sd(a) / Math.sqrt(a.length); }

  function quantile(sorted, p) {
    const n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const frac = h - lo;
    return sorted[lo] + frac * (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]);
  }

  function centralMoments(a, m) {
    m = m === undefined ? mean(a) : m;
    let m2 = 0, m3 = 0, m4 = 0;
    for (const v of a) { const d = v - m; const d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
    const n = a.length;
    return { m2: m2 / n, m3: m3 / n, m4: m4 / n };
  }

  function describe(raw) {
    const a = clean(raw);
    const n = a.length;
    if (n === 0) return { n: 0 };
    const sorted = a.slice().sort((x, y) => x - y);
    const m = mean(a);
    const s = n > 1 ? sd(a, m) : NaN;
    const se = n > 1 ? s / Math.sqrt(n) : NaN;
    const { m2, m3, m4 } = centralMoments(a, m);
    const skew = m2 > 0 ? m3 / Math.pow(m2, 1.5) : NaN;          // g1
    const kurt = m2 > 0 ? m4 / (m2 * m2) - 3 : NaN;              // excess g2
    const tcrit = n > 1 ? C.studentTinv(0.975, n - 1) : NaN;
    return {
      n, mean: m, sd: s, sem: se, variance: n > 1 ? s * s : NaN,
      min: sorted[0], max: sorted[n - 1], range: sorted[n - 1] - sorted[0],
      median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75),
      iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
      sum: sum(a), skewness: skew, kurtosis: kurt,
      cv: m !== 0 ? Math.abs(s / m) * 100 : NaN,
      ci95lo: m - tcrit * se, ci95hi: m + tcrit * se,
      geomean: sorted[0] > 0 ? Math.exp(mean(a.map(Math.log))) : NaN,
      sorted,
    };
  }

  // ---------- ranking with average ranks for ties ----------
  function rankData(values) {
    const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    const tieCounts = [];
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
      if (j > i) tieCounts.push(j - i + 1);
      i = j + 1;
    }
    return { ranks, tieCounts };
  }

  // ---------- t tests ----------
  function oneSampleT(raw, mu0 = 0) {
    const a = clean(raw); const n = a.length;
    const m = mean(a), s = sd(a), se = s / Math.sqrt(n);
    const t = (m - mu0) / se; const df = n - 1;
    const p = C.studentTtwoTailP(t, df);
    const tcrit = C.studentTinv(0.975, df);
    return {
      test: 'One-sample t test', n, mean: m, sd: s, sem: se, mu0,
      t, df, p, ci95lo: m - tcrit * se, ci95hi: m + tcrit * se,
      cohenD: (m - mu0) / s,
    };
  }

  function unpairedT(raw1, raw2, welch = false) {
    const a = clean(raw1), b = clean(raw2);
    const n1 = a.length, n2 = b.length;
    const m1 = mean(a), m2 = mean(b);
    const v1 = variance(a, m1), v2 = variance(b, m2);
    const diff = m1 - m2;
    let se, df;
    if (welch) {
      se = Math.sqrt(v1 / n1 + v2 / n2);
      df = Math.pow(v1 / n1 + v2 / n2, 2) /
        (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
    } else {
      const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
      se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
      df = n1 + n2 - 2;
    }
    const t = diff / se;
    const p = C.studentTtwoTailP(t, df);
    const tcrit = C.studentTinv(0.975, df);
    const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
    return {
      test: welch ? "Welch's unpaired t test" : 'Unpaired t test (Student)',
      n1, n2, mean1: m1, mean2: m2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2),
      diff, se, t, df, p, ci95lo: diff - tcrit * se, ci95hi: diff + tcrit * se,
      cohenD: diff / sp, welch,
    };
  }

  function pairedT(raw1, raw2) {
    const n = Math.min(raw1.length, raw2.length);
    const d = [];
    for (let i = 0; i < n; i++) {
      const x = Number(raw1[i]), y = Number(raw2[i]);
      if (raw1[i] !== '' && raw2[i] !== '' && raw1[i] != null && raw2[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) d.push(x - y);
    }
    const nn = d.length;
    const md = mean(d), s = sd(d), se = s / Math.sqrt(nn);
    const t = md / se, df = nn - 1;
    const p = C.studentTtwoTailP(t, df);
    const tcrit = C.studentTinv(0.975, df);
    // Pearson r between pairs
    return {
      test: 'Paired t test', n: nn, meanDiff: md, sdDiff: s, semDiff: se,
      t, df, p, ci95lo: md - tcrit * se, ci95hi: md + tcrit * se, cohenDz: md / s,
    };
  }

  // ---------- one-way ANOVA ----------
  function oneWayANOVA(groups) {
    const data = groups.map((g) => clean(g.values !== undefined ? g.values : g));
    const names = groups.map((g, i) => (g.name !== undefined ? g.name : 'Group ' + (i + 1)));
    const k = data.length;
    const ns = data.map((g) => g.length);
    const means = data.map(mean);
    const vars = data.map((g, i) => variance(g, means[i]));
    const N = sum(ns);
    const grand = sum(data.map(sum)) / N;
    let ssB = 0, ssW = 0;
    for (let i = 0; i < k; i++) {
      ssB += ns[i] * (means[i] - grand) ** 2;
      for (const v of data[i]) ssW += (v - means[i]) ** 2;
    }
    const dfB = k - 1, dfW = N - k;
    const msB = ssB / dfB, msW = ssW / dfW;
    const F = msB / msW;
    const p = C.fDistP(F, dfB, dfW);
    const ssT = ssB + ssW;
    const eta2 = ssB / ssT;
    const omega2 = (ssB - dfB * msW) / (ssT + msW);

    // Welch's ANOVA (unequal variances)
    const w = data.map((g, i) => ns[i] / vars[i]);
    const sumW = sum(w);
    const xbarW = sum(data.map((g, i) => w[i] * means[i])) / sumW;
    let A = 0, lam = 0;
    for (let i = 0; i < k; i++) {
      A += w[i] * (means[i] - xbarW) ** 2;
      lam += (1 - w[i] / sumW) ** 2 / (ns[i] - 1);
    }
    A /= (k - 1);
    const B = 1 + (2 * (k - 2) / (k * k - 1)) * lam;
    const Fw = A / B;
    const df2w = (k * k - 1) / (3 * lam);
    const pw = C.fDistP(Fw, k - 1, df2w);

    return {
      test: 'One-way ANOVA', k, names, ns, means, sds: vars.map(Math.sqrt), grand,
      ssB, ssW, ssT, dfB, dfW, msB, msW, F, p, eta2, omega2,
      welch: { F: Fw, df1: k - 1, df2: df2w, p: pw },
      _data: data, _msW: msW, _dfW: dfW,
    };
  }

  // ---------- post-hoc multiple comparisons ----------
  function pairwiseList(k) {
    const pairs = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
    return pairs;
  }

  function holmSidak(rawPs) {
    // returns adjusted p-values preserving input order
    const m = rawPs.length;
    const order = rawPs.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    const adj = new Array(m);
    let prev = 0;
    for (let r = 0; r < m; r++) {
      const [p, idx] = order[r];
      let a = 1 - Math.pow(1 - p, m - r);
      a = Math.max(a, prev); a = Math.min(a, 1);
      adj[idx] = a; prev = a;
    }
    return adj;
  }

  function posthoc(anova, method = 'tukey', opts = {}) {
    const data = anova._data, names = anova.names, msW = anova._msW, dfW = anova._dfW;
    const k = data.length;
    const means = data.map(mean);
    const ns = data.map((g) => g.length);
    // custom: only the user-selected pairs, adjusted (Šídák/Bonferroni/Holm) over that set
    if (method === 'custom') {
      const selPairs = (opts.pairs && opts.pairs.length) ? opts.pairs : pairwiseList(k);
      const corr = opts.correction || 'sidak';
      const mm = selPairs.length;
      const raw = selPairs.map(([i, j]) => {
        const diff = means[i] - means[j];
        const se = Math.sqrt(msW * (1 / ns[i] + 1 / ns[j]));
        const t = diff / se;
        return { i, j, diff, t, p: C.studentTtwoTailP(t, dfW) };
      });
      let adj;
      if (corr === 'bonferroni') adj = raw.map((r) => Math.min(1, r.p * mm));
      else if (corr === 'holm-sidak') adj = holmSidak(raw.map((r) => r.p));
      else adj = raw.map((r) => 1 - Math.pow(1 - r.p, mm));
      const res = raw.map((r, idx) => ({ a: names[r.i], b: names[r.j], diff: r.diff, t: r.t, pRaw: r.p, p: adj[idx], sig: adj[idx] < 0.05 }));
      return { method: 'custom (' + corr + ')', comparisons: res };
    }
    const pairs = pairwiseList(k);
    const m = pairs.length;
    const results = [];
    if (method === 'tukey') {
      for (const [i, j] of pairs) {
        const diff = means[i] - means[j];
        const se = Math.sqrt((msW / 2) * (1 / ns[i] + 1 / ns[j]));
        const q = Math.abs(diff) / se;
        const p = C.tukeyP(q, k, dfW);
        const qcrit = C.tukeyInv(0.95, k, dfW);
        results.push({ a: names[i], b: names[j], diff, q, p, ci95lo: diff - qcrit * se, ci95hi: diff + qcrit * se, sig: p < 0.05 });
      }
    } else if (method === 'dunnett') {
      const controlIdx = opts.control != null ? opts.control : 0;
      const treat = []; for (let i = 0; i < k; i++) if (i !== controlIdx) treat.push(i);
      for (const i of treat) {
        const diff = means[i] - means[controlIdx];
        const se = Math.sqrt(msW * (1 / ns[i] + 1 / ns[controlIdx]));
        const t = diff / se;
        const p = dunnettP(Math.abs(t), treat.length, dfW);
        results.push({ a: names[i], b: names[controlIdx], diff, t, p, sig: p < 0.05 });
      }
    } else {
      // t-based (Bonferroni / Sidak / Holm-Sidak)
      const raw = [];
      for (const [i, j] of pairs) {
        const diff = means[i] - means[j];
        const se = Math.sqrt(msW * (1 / ns[i] + 1 / ns[j]));
        const t = diff / se;
        const p = C.studentTtwoTailP(t, dfW);
        raw.push({ i, j, diff, t, se, p });
      }
      let adj;
      if (method === 'bonferroni') adj = raw.map((r) => Math.min(1, r.p * m));
      else if (method === 'sidak') adj = raw.map((r) => 1 - Math.pow(1 - r.p, m));
      else adj = holmSidak(raw.map((r) => r.p)); // holm-sidak default
      raw.forEach((r, idx) => results.push({ a: names[r.i], b: names[r.j], diff: r.diff, t: r.t, pRaw: r.p, p: adj[idx], sig: adj[idx] < 0.05 }));
    }
    return { method, comparisons: results };
  }

  // Two-sided Dunnett p-value (equicorrelated rho=0.5, exact for balanced designs).
  function dunnettP(d, mTreat, df) {
    // P(max|T_i| >= d) = 1 - G(d); integrate over Z (Gauss-Hermite) and chi (Gauss-Legendre on u)
    if (d <= 0) return 1;
    // Gauss-Hermite nodes (20-pt) for the inner standard-normal integral
    const gh = ghNodes20;
    const inner = (uSqrt2d) => {
      // E_Z[(Phi(uSqrt2d+Z)-Phi(-uSqrt2d+Z))^mTreat]
      let s = 0;
      for (let g = 0; g < gh.x.length; g++) {
        const z = gh.x[g] * Math.SQRT2; // change of variable for weight e^{-x^2}
        const term = C.normalCDF(uSqrt2d + z) - C.normalCDF(-uSqrt2d + z);
        s += gh.w[g] * Math.pow(Math.max(term, 0), mTreat);
      }
      return s / Math.sqrt(Math.PI);
    };
    if (df > 2000) return 1 - inner(d * Math.SQRT2);
    // outer integral over u = sqrt(W/df), W~chi2_df, using its density via substitution
    // f_u(u) = 2 * (df/2)^{df/2} / Gamma(df/2) * u^{df-1} e^{-df u^2/2}
    const logc = Math.log(2) + (df / 2) * Math.log(df / 2) - C.gammaln(df / 2);
    let integral = 0;
    const N = 200, hi = 3.0; // u rarely exceeds ~3
    const h = hi / N;
    for (let n = 0; n <= N; n++) {
      const u = (n + 0.5) * h; if (u <= 0) continue;
      const logf = logc + (df - 1) * Math.log(u) - df * u * u / 2;
      const fu = Math.exp(logf);
      integral += fu * inner(d * u * Math.SQRT2) * h;
      if (n > 5 && fu < 1e-14 && u > 1) break;
    }
    return Math.max(0, Math.min(1, 1 - integral));
  }

  // 20-point Gauss-Hermite nodes/weights (for weight e^{-x^2})
  const ghNodes20 = {
    x: [-5.387480890011232, -4.603682449550744, -3.944764040115625, -3.347854567383216,
      -2.788806058428131, -2.254974002089276, -1.738537712116586, -1.234076215395323,
      -0.737473728545394, -0.245340708300901, 0.245340708300901, 0.737473728545394,
      1.234076215395323, 1.738537712116586, 2.254974002089276, 2.788806058428131,
      3.347854567383216, 3.944764040115625, 4.603682449550744, 5.387480890011232],
    w: [2.229393645534151e-13, 4.399340992273181e-10, 1.086069370769282e-7, 7.802556478532063e-6,
      2.283386360163528e-4, 3.243773342237853e-3, 2.481052088746362e-2, 1.090172060200233e-1,
      2.866755053628341e-1, 4.622436696006102e-1, 4.622436696006102e-1, 2.866755053628341e-1,
      1.090172060200233e-1, 2.481052088746362e-2, 3.243773342237853e-3, 2.283386360163528e-4,
      7.802556478532063e-6, 1.086069370769282e-7, 4.399340992273181e-10, 2.229393645534151e-13],
  };

  // ---------- Mann-Whitney U ----------
  function mannWhitneyCounts(n, m) {
    const maxU = n * m;
    let poly = new Float64Array(maxU + 1);
    poly[0] = 1;
    for (let i = 1; i <= n; i++) {
      const shift = m + i;
      const tmp = new Float64Array(maxU + 1);
      for (let k = 0; k <= maxU; k++) tmp[k] = poly[k] - (k - shift >= 0 ? poly[k - shift] : 0);
      for (let k = i; k <= maxU; k++) tmp[k] += tmp[k - i]; // divide by (1-q^i)
      poly = tmp;
    }
    return poly;
  }

  function mannWhitney(raw1, raw2) {
    const a = clean(raw1), b = clean(raw2);
    const n1 = a.length, n2 = b.length;
    const all = a.concat(b);
    const { ranks, tieCounts } = rankData(all);
    const R1 = sum(ranks.slice(0, n1));
    const U1 = R1 - n1 * (n1 + 1) / 2;
    const U2 = n1 * n2 - U1;
    const U = Math.min(U1, U2);
    const hasTies = tieCounts.length > 0;
    const N = n1 + n2;
    const meanU = n1 * n2 / 2;
    const tieTerm = sum(tieCounts.map((t) => t * t * t - t));
    const varU = (n1 * n2 / 12) * ((N + 1) - tieTerm / (N * (N - 1)));
    let p, method, z = NaN;
    const smallEnough = n1 * n2 <= 100000 && maxUSafe(n1, n2);
    if (!hasTies && smallEnough) {
      const counts = mannWhitneyCounts(n1, n2);
      let total = 0; for (let k = 0; k < counts.length; k++) total += counts[k];
      let cum = 0; for (let k = 0; k <= U; k++) cum += counts[k];
      p = Math.min(1, 2 * cum / total);
      method = 'exact';
    } else {
      z = (Math.abs(U - meanU) - 0.5) / Math.sqrt(varU);
      p = 2 * (1 - C.normalCDF(z));
      method = hasTies ? 'normal approximation (tie-corrected)' : 'normal approximation';
    }
    return {
      test: 'Mann-Whitney U test', n1, n2, U1, U2, U, R1, R2: sum(ranks.slice(n1)),
      meanRank1: R1 / n1, meanRank2: sum(ranks.slice(n1)) / n2, z, p, method, hasTies,
    };
  }
  function maxUSafe(n1, n2) { return n1 * n2 <= 40000; }

  // ---------- Wilcoxon signed-rank (paired) ----------
  function wilcoxonSignedRank(raw1, raw2) {
    const n = Math.min(raw1.length, raw2.length);
    const diffs = [];
    for (let i = 0; i < n; i++) {
      const x = Number(raw1[i]), y = Number(raw2[i]);
      if (raw1[i] !== '' && raw2[i] !== '' && raw1[i] != null && raw2[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) {
        const d = x - y; if (d !== 0) diffs.push(d);
      }
    }
    const nr = diffs.length;
    const { ranks, tieCounts } = rankData(diffs.map(Math.abs));
    let Wpos = 0, Wneg = 0;
    diffs.forEach((d, i) => { if (d > 0) Wpos += ranks[i]; else Wneg += ranks[i]; });
    const W = Math.min(Wpos, Wneg);
    const meanW = nr * (nr + 1) / 4;
    const tieTerm = sum(tieCounts.map((t) => t * t * t - t)) / 48;
    const varW = nr * (nr + 1) * (2 * nr + 1) / 24 - tieTerm;
    const z = (Math.abs(W - meanW) - 0.5) / Math.sqrt(varW);
    const p = 2 * (1 - C.normalCDF(z));
    return { test: 'Wilcoxon matched-pairs signed rank test', n: nr, Wpos, Wneg, W, z, p, method: 'normal approximation' };
  }

  // ---------- Kruskal-Wallis ----------
  function kruskalWallis(groups) {
    const data = groups.map((g) => clean(g.values !== undefined ? g.values : g));
    const names = groups.map((g, i) => (g.name !== undefined ? g.name : 'Group ' + (i + 1)));
    const k = data.length;
    const ns = data.map((g) => g.length);
    const all = [].concat(...data);
    const N = all.length;
    const { ranks, tieCounts } = rankData(all);
    let offset = 0; const rankSums = []; const meanRanks = [];
    for (let i = 0; i < k; i++) {
      const r = sum(ranks.slice(offset, offset + ns[i]));
      rankSums.push(r); meanRanks.push(r / ns[i]); offset += ns[i];
    }
    let H = 12 / (N * (N + 1)) * sum(rankSums.map((r, i) => (r * r) / ns[i])) - 3 * (N + 1);
    const tieTerm = sum(tieCounts.map((t) => t * t * t - t));
    const Ccorr = 1 - tieTerm / (N * N * N - N);
    const Hc = Ccorr > 0 ? H / Ccorr : H;
    const df = k - 1;
    const p = C.chiSquareP(Hc, df);
    return {
      test: 'Kruskal-Wallis test', k, names, ns, rankSums, meanRanks,
      H: Hc, Hraw: H, df, p, tieCorrection: Ccorr,
      _ranks: ranks, _ns: ns, _names: names, _N: N, _tieTerm: tieTerm,
    };
  }

  function dunnPosthoc(kw, method = 'holm-sidak', opts = {}) {
    const { _ns: ns, _names: names, _N: N, meanRanks, _tieTerm: tieTerm } = kw;
    const k = ns.length;
    const pairs = (opts.pairs && opts.pairs.length) ? opts.pairs : pairwiseList(k);
    const sigmaBase = (N * (N + 1) / 12) - tieTerm / (12 * (N - 1));
    const raw = pairs.map(([i, j]) => {
      const se = Math.sqrt(sigmaBase * (1 / ns[i] + 1 / ns[j]));
      const z = Math.abs(meanRanks[i] - meanRanks[j]) / se;
      const p = 2 * (1 - C.normalCDF(z));
      return { i, j, z, p };
    });
    const mC = pairs.length;
    let adj;
    if (method === 'bonferroni') adj = raw.map((r) => Math.min(1, r.p * mC));
    else if (method === 'sidak') adj = raw.map((r) => 1 - Math.pow(1 - r.p, mC));
    else adj = holmSidak(raw.map((r) => r.p));
    return {
      method, comparisons: raw.map((r, idx) => ({
        a: names[r.i], b: names[r.j], z: r.z, pRaw: r.p, p: adj[idx], sig: adj[idx] < 0.05,
      })),
    };
  }

  // ---------- correlation ----------
  function pearson(rawX, rawY) {
    const xs = [], ys = [];
    const n = Math.min(rawX.length, rawY.length);
    for (let i = 0; i < n; i++) {
      const x = Number(rawX[i]), y = Number(rawY[i]);
      if (rawX[i] !== '' && rawY[i] !== '' && rawX[i] != null && rawY[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    const nn = xs.length;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < nn; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const r = sxy / Math.sqrt(sxx * syy);
    const df = nn - 2;
    const t = r * Math.sqrt(df / (1 - r * r));
    const p = C.studentTtwoTailP(t, df);
    const z = Math.atanh(r), se = 1 / Math.sqrt(nn - 3);
    const zc = C.normalInv(0.975);
    return { test: 'Pearson correlation', n: nn, r, r2: r * r, df, t, p, ci95lo: Math.tanh(z - zc * se), ci95hi: Math.tanh(z + zc * se) };
  }

  function spearman(rawX, rawY) {
    const xs = [], ys = [];
    const n = Math.min(rawX.length, rawY.length);
    for (let i = 0; i < n; i++) {
      const x = Number(rawX[i]), y = Number(rawY[i]);
      if (rawX[i] !== '' && rawY[i] !== '' && rawX[i] != null && rawY[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    const rx = rankData(xs).ranks, ry = rankData(ys).ranks;
    const pr = pearson(rx, ry);
    return { test: 'Spearman correlation', n: xs.length, rho: pr.r, df: pr.df, t: pr.t, p: pr.p };
  }

  // ---------- simple linear regression ----------
  function linearRegression(rawX, rawY) {
    const xs = [], ys = [];
    const n = Math.min(rawX.length, rawY.length);
    for (let i = 0; i < n; i++) {
      const x = Number(rawX[i]), y = Number(rawY[i]);
      if (rawX[i] !== '' && rawY[i] !== '' && rawX[i] != null && rawY[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    const nn = xs.length;
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < nn; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let ssRes = 0; for (let i = 0; i < nn; i++) { const e = ys[i] - (intercept + slope * xs[i]); ssRes += e * e; }
    const df = nn - 2;
    const mse = ssRes / df;
    const seSlope = Math.sqrt(mse / sxx);
    const seInt = Math.sqrt(mse * (1 / nn + (mx * mx) / sxx));
    const r2 = 1 - ssRes / syy;
    const tSlope = slope / seSlope;
    const pSlope = C.studentTtwoTailP(tSlope, df);
    const tcrit = C.studentTinv(0.975, df);
    return {
      test: 'Simple linear regression', n: nn, slope, intercept, r2, df,
      seSlope, seInt, tSlope, pSlope, sy_x: Math.sqrt(mse),
      slopeCIlo: slope - tcrit * seSlope, slopeCIhi: slope + tcrit * seSlope,
      intCIlo: intercept - tcrit * seInt, intCIhi: intercept + tcrit * seInt,
      _xs: xs, _ys: ys, _mx: mx, _sxx: sxx, _mse: mse, _tcrit: tcrit,
    };
  }

  // ---------- two-way ANOVA (Type III SS via regression, sum-to-zero coding) ----------
  function linSolve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-11) return null; // singular / rank deficient
      [M[col], M[piv]] = [M[piv], M[col]];
      const pv = M[col][col];
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / pv;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  function sumZero(level, L) { const c = []; for (let k = 0; k < L - 1; k++) c.push(level === k ? 1 : (level === L - 1 ? -1 : 0)); return c; }
  // residual SS of the model with the chosen terms; null if design is rank-deficient
  function rssModel(obs, a, b, incA, incB, incAB) {
    const p = 1 + (incA ? a - 1 : 0) + (incB ? b - 1 : 0) + (incAB ? (a - 1) * (b - 1) : 0);
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    const rows = [];
    for (const o of obs) {
      const ac = sumZero(o.ai, a), bc = sumZero(o.bj, b);
      const row = [1];
      if (incA) for (let k = 0; k < a - 1; k++) row.push(ac[k]);
      if (incB) for (let l = 0; l < b - 1; l++) row.push(bc[l]);
      if (incAB) for (let k = 0; k < a - 1; k++) for (let l = 0; l < b - 1; l++) row.push(ac[k] * bc[l]);
      rows.push(row);
      for (let i = 0; i < p; i++) { Xty[i] += row[i] * o.y; for (let j = 0; j < p; j++) XtX[i][j] += row[i] * row[j]; }
    }
    const beta = linSolve(XtX, Xty);
    if (!beta) return null;
    let rss = 0;
    for (let r = 0; r < rows.length; r++) { let pred = 0; const xr = rows[r]; for (let i = 0; i < p; i++) pred += xr[i] * beta[i]; rss += (obs[r].y - pred) ** 2; }
    return rss;
  }

  function twoWayANOVA(cells, rowNames, colNames, opts) {
    opts = opts || {};
    const factorRow = opts.rowFactor || 'Rows';
    const factorCol = opts.colFactor || 'Columns';
    const a = cells.length, b = cells[0].length;
    if (a < 2 || b < 2) return { error: 'Two-way ANOVA needs at least 2 rows and 2 column groups.' };
    const obs = [];
    const cellMeans = [], cellN = [], cellSD = [];
    let allPresent = true, N = 0;
    for (let i = 0; i < a; i++) {
      cellMeans[i] = []; cellN[i] = []; cellSD[i] = [];
      for (let j = 0; j < b; j++) {
        const v = cells[i][j] || [];
        cellN[i][j] = v.length; N += v.length;
        if (v.length === 0) allPresent = false;
        const m = v.length ? mean(v) : NaN;
        cellMeans[i][j] = m; cellSD[i][j] = v.length > 1 ? sd(v, m) : NaN;
        v.forEach((val) => obs.push({ y: val, ai: i, bj: j }));
      }
    }
    if (N < a + b) return { error: 'Not enough data — add more values.' };
    const grand = mean(obs.map((o) => o.y));
    const ssTotal = obs.reduce((s, o) => s + (o.y - grand) ** 2, 0);
    const replicated = allPresent && N > a * b;
    const effects = [];
    let rssFull, dfError;

    const mkEffect = (name, ss, df) => {
      const ms = ss / df; const F = ms / (rssFull / dfError);
      return { name, ss, df, ms, F, p: C.fDistP(F, df, dfError), partialEta2: ss / (ss + rssFull) };
    };

    if (replicated) {
      rssFull = rssModel(obs, a, b, true, true, true);
      if (rssFull == null) return { error: 'Design is too unbalanced to estimate the interaction. Fill more cells.' };
      dfError = N - a * b;
      const ssA = rssModel(obs, a, b, false, true, true) - rssFull;
      const ssB = rssModel(obs, a, b, true, false, true) - rssFull;
      const ssAB = rssModel(obs, a, b, true, true, false) - rssFull;
      effects.push(mkEffect(factorRow, ssA, a - 1));
      effects.push(mkEffect(factorCol, ssB, b - 1));
      effects.push(mkEffect('Interaction (' + factorRow + ' × ' + factorCol + ')', ssAB, (a - 1) * (b - 1)));
    } else {
      dfError = N - (a + b - 1);
      if (dfError < 1) return { error: 'Not enough data for a two-way ANOVA (need more replicates or all cells filled).' };
      rssFull = rssModel(obs, a, b, true, true, false);
      const rB = rssModel(obs, a, b, false, true, false), rA = rssModel(obs, a, b, true, false, false);
      if (rssFull == null || rB == null || rA == null) return { error: 'Every row and every column must contain some data.' };
      effects.push(mkEffect(factorRow, rB - rssFull, a - 1));
      effects.push(mkEffect(factorCol, rA - rssFull, b - 1));
    }
    return {
      test: 'Two-way ANOVA', a, b, rowNames, colNames, factorRow, factorCol,
      N, grand, ssTotal, effects, residual: { ss: rssFull, df: dfError, ms: rssFull / dfError },
      replicated, interaction: replicated, cellMeans, cellN, cellSD,
    };
  }

  function twoWayPosthoc(model, method = 'sidak', direction = 'colsWithinRow') {
    const { cellMeans, cellN, colNames, rowNames, residual, a, b } = model;
    const msE = residual.ms, dfE = residual.df;
    const comps = [];
    if (direction === 'colsWithinRow') {
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = j + 1; k < b; k++) {
        if (!cellN[i][j] || !cellN[i][k]) continue;
        const diff = cellMeans[i][j] - cellMeans[i][k];
        const se = Math.sqrt(msE * (1 / cellN[i][j] + 1 / cellN[i][k]));
        comps.push({ within: rowNames[i], a: colNames[j], b: colNames[k], diff, se, t: diff / se, groups: b });
      }
    } else {
      for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) for (let k = i + 1; k < a; k++) {
        if (!cellN[i][j] || !cellN[k][j]) continue;
        const diff = cellMeans[i][j] - cellMeans[k][j];
        const se = Math.sqrt(msE * (1 / cellN[i][j] + 1 / cellN[k][j]));
        comps.push({ within: colNames[j], a: rowNames[i], b: rowNames[k], diff, se, t: diff / se, groups: a });
      }
    }
    const m = comps.length;
    comps.forEach((c) => { c.pRaw = C.studentTtwoTailP(c.t, dfE); });
    if (method === 'tukey') comps.forEach((c) => { c.q = Math.abs(c.diff) / (c.se / Math.SQRT2); c.p = C.tukeyP(c.q, c.groups, dfE); c.sig = c.p < 0.05; });
    else {
      let adj;
      if (method === 'bonferroni') adj = comps.map((c) => Math.min(1, c.pRaw * m));
      else if (method === 'holm-sidak') adj = holmSidak(comps.map((c) => c.pRaw));
      else adj = comps.map((c) => 1 - Math.pow(1 - c.pRaw, m));
      comps.forEach((c, idx) => { c.p = adj[idx]; c.sig = c.p < 0.05; });
    }
    return { method, direction, comparisons: comps, dfError: dfE };
  }

  // Scheirer-Ray-Hare: nonparametric two-way (rank-transform + two-way SS, tested vs chi-square).
  function scheirerRayHare(cells, rowNames, colNames, opts) {
    opts = opts || {};
    const a = cells.length, b = cells[0].length;
    const flat = [];
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) (cells[i][j] || []).forEach((v) => flat.push({ v, i, j }));
    const N = flat.length;
    if (N < a + b) return { error: 'Not enough data for the Scheirer-Ray-Hare test.' };
    const { ranks } = rankData(flat.map((f) => f.v));
    const rcells = Array.from({ length: a }, () => Array.from({ length: b }, () => []));
    flat.forEach((f, idx) => rcells[f.i][f.j].push(ranks[idx]));
    const rk = twoWayANOVA(rcells, rowNames, colNames, opts);
    if (rk.error) return rk;
    const msTotal = rk.ssTotal / (N - 1); // MS of ranks; = N(N+1)/12 with no ties
    const effects = rk.effects.map((e) => { const H = e.ss / msTotal; return { name: e.name, H, df: e.df, p: C.chiSquareP(H, e.df) }; });
    return {
      test: 'Scheirer-Ray-Hare test', a, b, rowNames, colNames, N, msTotal, effects,
      factorRow: rk.factorRow, factorCol: rk.factorCol, cellMeans: rk.cellMeans, cellN: rk.cellN, cellSD: rk.cellSD, interaction: rk.interaction,
    };
  }

  return {
    clean, mean, sd, sem, variance, quantile, describe, rankData, centralMoments,
    oneSampleT, unpairedT, pairedT,
    oneWayANOVA, posthoc, holmSidak, dunnettP,
    mannWhitney, mannWhitneyCounts, wilcoxonSignedRank,
    kruskalWallis, dunnPosthoc,
    pearson, spearman, linearRegression,
    twoWayANOVA, twoWayPosthoc, scheirerRayHare,
  };
})(typeof StatCore !== 'undefined' ? StatCore : require('./stats-core.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = StatTests;
