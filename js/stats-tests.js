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
    // Sample skewness G1 and excess kurtosis G2: the moment ratios g1, g2 adjusted for sample
    // size, as reported by SAS, SPSS and Excel (and G1 by Prism) (Joanes & Gill 1998)
    const g1 = m2 > 0 ? m3 / Math.pow(m2, 1.5) : NaN, g2 = m2 > 0 ? m4 / (m2 * m2) - 3 : NaN;
    const skew = n > 2 ? g1 * Math.sqrt(n * (n - 1)) / (n - 2) : NaN;
    const kurt = n > 3 ? (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * g2 + 6) : NaN;
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
  // Alternatives change only p-values; all confidence intervals remain two-sided 95%.
  function oneSampleT(raw, mu0 = 0, alternative = 'two-sided') {
    C.validateAlternative(alternative);
    const a = clean(raw); const n = a.length;
    const m = mean(a), s = sd(a), se = s / Math.sqrt(n);
    const t = (m - mu0) / se; const df = n - 1;
    const p = C.studentTP(t, df, alternative);
    const tcrit = C.studentTinv(0.975, df);
    return {
      test: 'One-sample t test', alternative, n, mean: m, sd: s, sem: se, mu0,
      t, df, p, ci95lo: m - tcrit * se, ci95hi: m + tcrit * se,
      cohenD: (m - mu0) / s,
    };
  }

  function unpairedT(raw1, raw2, welch = false, alternative = 'two-sided') {
    C.validateAlternative(alternative);
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
    const p = C.studentTP(t, df, alternative);
    const tcrit = C.studentTinv(0.975, df);
    const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
    return {
      test: welch ? "Welch's unpaired t test" : 'Unpaired t test (Student)',
      n1, n2, mean1: m1, mean2: m2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2),
      diff, se, t, df, p, ci95lo: diff - tcrit * se, ci95hi: diff + tcrit * se,
      cohenD: diff / sp, welch, alternative,
    };
  }

  function pairedT(raw1, raw2, alternative = 'two-sided') {
    C.validateAlternative(alternative);
    const n = Math.min(raw1.length, raw2.length);
    const d = [];
    for (let i = 0; i < n; i++) {
      const x = Number(raw1[i]), y = Number(raw2[i]);
      if (raw1[i] !== '' && raw2[i] !== '' && raw1[i] != null && raw2[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) d.push(x - y);
    }
    const nn = d.length;
    const md = mean(d), s = sd(d), se = s / Math.sqrt(nn);
    const t = md / se, df = nn - 1;
    const p = C.studentTP(t, df, alternative);
    const tcrit = C.studentTinv(0.975, df);
    // Pearson r between pairs
    return {
      test: 'Paired t test', alternative, n: nn, meanDiff: md, sdDiff: s, semDiff: se,
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

  // ---------- Brown–Forsythe equal-variance test (median-centered Levene) ----------
  function brownForsythe(groups) {
    const result = {
      test: 'Brown–Forsythe test (equal variances)',
      k: Array.isArray(groups) ? groups.length : 0,
      ns: [], medians: [], variances: [], sds: [],
      W: NaN, df1: NaN, df2: NaN, p: NaN,
    };
    const fail = (error) => Object.assign(result, { error });
    if (!Array.isArray(groups) || groups.length < 2) {
      return fail('Brown–Forsythe needs at least two groups.');
    }

    // Keep this stricter policy local: blanks/NaN/nonnumeric cells are missing,
    // numeric strings are accepted, but infinities must not be silently omitted.
    // Copy into new arrays so neither cleaning nor median sorting alters inputs.
    const data = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const raw = Array.isArray(group) ? group : group && group.values;
      if (!Array.isArray(raw)) return fail('Each group must be an array or an object with a values array.');
      const values = [];
      for (const value of raw) {
        if (typeof value !== 'number' && typeof value !== 'string') continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        const x = Number(value);
        if (Number.isNaN(x)) continue;
        if (!Number.isFinite(x)) return fail('Every numeric observation must be finite; Infinity is not supported.');
        values.push(x);
      }
      data.push(values);
    }
    const k = result.k, ns = result.ns = data.map((g) => g.length);
    const N = sum(ns);
    result.df1 = k - 1;
    result.df2 = N - k;
    if (ns.some((n) => n < 2)) return fail('Each group needs at least two finite numeric observations after omitting missing values.');

    const deviations = [];
    let maxDeviation = 0;
    for (const values of data) {
      const sorted = values.slice().sort((a, b) => a - b);
      const n = values.length, mid = Math.floor(n / 2);
      const lo = sorted[mid - 1], hi = sorted[mid];
      // Avoid overflow when two finite middle observations have opposite signs.
      const median = n % 2 ? hi : (lo < 0 && hi > 0 ? lo / 2 + hi / 2 : lo + (hi - lo) / 2);
      result.medians.push(median);
      const centered = values.map((x) => x - median);
      if (centered.some((x) => !Number.isFinite(x))) return fail('Values exceed the numerical range for this test.');
      let scale = 0;
      for (const x of centered) scale = Math.max(scale, Math.abs(x));
      // Center and rescale before computing the sample SD (ddof=1). This also
      // avoids summing large offsets and squaring raw large/small observations.
      const s = scale === 0 ? 0 : sd(centered.map((x) => x / scale)) * scale;
      result.sds.push(s);
      result.variances.push(s * s);
      if (!Number.isFinite(s * s)) return fail('Sample variances exceed the numerical range for this test.');

      // Equal-sized blocks of two endpoints (including every n=2 group) have
      // identically equal absolute deviations in exact arithmetic. Force that
      // equality instead of letting rounded decimal midpoints create a false
      // nonzero denominator and a spurious significant result.
      let z;
      if (n % 2 === 0 && sorted[0] === lo && sorted[n - 1] === hi) {
        const range = hi - lo;
        const halfRange = Number.isFinite(range) ? range / 2 : hi / 2 - lo / 2;
        z = new Array(n).fill(halfRange);
      } else {
        z = centered.map(Math.abs);
      }
      for (const x of z) maxDeviation = Math.max(maxDeviation, x);
      deviations.push(z);
    }
    if (maxDeviation === 0) return fail('No within-group variation in absolute deviations; the Brown–Forsythe statistic is undefined.');

    // NIST median-centered Levene statistic. A common scale cancels in the SS
    // ratio and protects W against squared-deviation overflow/underflow.
    // https://www.itl.nist.gov/div898/handbook/eda/section3/eda35a.htm
    const z = deviations.map((g) => g.map((x) => x / maxDeviation));
    // The arithmetic mean of a constant array must stay exactly constant:
    // repeated addition/division can otherwise manufacture tiny residuals.
    const means = z.map((g) => g.every((x) => x === g[0]) ? g[0] : mean(g));
    const grand = sum(means.map((m, i) => ns[i] * m)) / N;
    let ssB = 0, ssW = 0;
    for (let i = 0; i < k; i++) {
      ssB += ns[i] * (means[i] - grand) ** 2;
      for (const x of z[i]) ssW += (x - means[i]) ** 2;
    }
    if (!(ssW > 0)) return fail('No within-group variation in absolute deviations; the Brown–Forsythe statistic is undefined.');
    const W = (N - k) / (k - 1) * (ssB / ssW);
    const p = C.fDistP(W, result.df1, result.df2); // upper tail; valid W=0 gives p=1
    if (!Number.isFinite(W) || !Number.isFinite(p) || p < 0 || p > 1) {
      return fail('The Brown–Forsythe calculation exceeds the numerical range for this test.');
    }
    result.W = W;
    result.p = p;
    return result;
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
      const lambdas = treat.map((i) => Math.sqrt(ns[i] / (ns[i] + ns[controlIdx])));
      for (const i of treat) {
        const diff = means[i] - means[controlIdx];
        const se = Math.sqrt(msW * (1 / ns[i] + 1 / ns[controlIdx]));
        const t = diff / se;
        const p = dunnettP(Math.abs(t), lambdas, dfW);
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

  // Two-sided Dunnett p-value P(max_i |T_i| >= d) for comparisons with a common control.
  // Corr(T_i, T_j) = λ_i·λ_j with λ_i = sqrt(n_i / (n_i + n_0)) (Dunnett 1955), so the T_i
  // are independent given the control's standard normal Z0: X_i = λ_i·Z0 + s_i·Z_i with
  // s_i = sqrt(1 − λ_i²). Pass the λ array; a count m means equal group sizes (λ² = 1/2).
  function dunnettP(d, lambdas, df) {
    if (d <= 0) return 1;
    const groups = [];
    for (const l of Array.isArray(lambdas) ? lambdas : new Array(lambdas).fill(Math.SQRT1_2)) {
      const g = groups.find((x) => x.l === l);
      if (g) g.m++; else groups.push({ l, s: Math.sqrt(1 - l * l), m: 1 });
    }
    const inner = (c) => dunnettInner(c, groups);
    if (df > 2000) return 1 - inner(d);
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
      integral += fu * inner(d * u) * h;
      if (n > 5 && fu < 1e-14 && u > 1) break;
    }
    return Math.max(0, Math.min(1, 1 - integral));
  }

  // P(max_i |X_i| <= c), integrating the even integrand over Z0 in [0, zhi] with 8-point
  // Gauss-Legendre panels. Each factor steps from 1 to 0 around z = c/λ over a width ~s/λ,
  // which is narrow when a treatment group is much larger than the control, so panel edges
  // bracket every step; beyond zhi some factor is below Φ(−8.5) ≈ 1e-17.
  const DUNNETT_STEP_OFFSETS = [-8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8];
  const GL8 = {
    x: [0.18343464249564978, 0.525532409916329, 0.7966664774136267, 0.9602898564975362],
    w: [0.36268378337836166, 0.3137066458778869, 0.22238103445337443, 0.10122853629037706],
  };
  function dunnettInner(c, groups) {
    let zhi = 8.5;
    for (const g of groups) zhi = Math.min(zhi, (c + 8.5 * g.s) / g.l);
    const edges = [0, zhi];
    for (let z = 1; z < zhi; z++) edges.push(z);
    for (const g of groups) {
      for (const t of DUNNETT_STEP_OFFSETS) { const z = (c + t * g.s) / g.l; if (z > 0 && z < zhi) edges.push(z); }
    }
    edges.sort((a, b) => a - b);
    const f = (z) => {
      let v = C.normalPDF(z);
      for (const g of groups) v *= Math.pow(Math.max(C.normalCDF((c - g.l * z) / g.s) - C.normalCDF((-c - g.l * z) / g.s), 0), g.m);
      return v;
    };
    let total = 0;
    for (let k = 1; k < edges.length; k++) {
      const mid = (edges[k] + edges[k - 1]) / 2, half = (edges[k] - edges[k - 1]) / 2;
      if (!(half > 0)) continue;
      for (let q = 0; q < GL8.x.length; q++) total += half * GL8.w[q] * (f(mid - half * GL8.x[q]) + f(mid + half * GL8.x[q]));
    }
    return 2 * total;
  }

  // ---------- Mann-Whitney U ----------
  function rankNormalResult(delta, variance, alternative) {
    // A zero-variance rank distribution (all tied/zero differences) has no
    // evidence against the null in either direction.
    if (variance <= 0) return { z: 0, p: 1 };
    const corrected = alternative === 'two-sided' ? Math.max(0, Math.abs(delta) - 0.5)
      : delta + (alternative === 'less' ? 0.5 : -0.5);
    const z = corrected / Math.sqrt(variance);
    const p = alternative === 'two-sided' ? 2 * C.normalCDF(-z)
      : C.normalCDF(alternative === 'less' ? z : -z);
    return { z, p: Math.max(0, Math.min(1, p)) };
  }

  function mannWhitneyCounts(n, m) {
    // The distribution is symmetric in the sample sizes and about U=n*m/2.
    // Iterate the smaller size to reduce cancellation in the generating
    // polynomial, then mirror the reliable lower half. Direct upper-half
    // coefficients otherwise accumulate roundoff (even becoming negative),
    // which is especially destructive for small one-sided upper tails.
    if (n > m) [n, m] = [m, n];
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
    for (let u = 0; u < maxU / 2; u++) poly[maxU - u] = poly[u];
    return poly;
  }

  function mannWhitney(raw1, raw2, alternative = 'two-sided') {
    C.validateAlternative(alternative);
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
    if (n1 === 0 || n2 === 0) {
      p = NaN;
      method = 'insufficient data';
    } else if (!hasTies && smallEnough) {
      const counts = mannWhitneyCounts(n1, n2);
      let total = 0; for (let k = 0; k < counts.length; k++) total += counts[k];
      // Discrete tails include the observed U1 in BOTH directions. In
      // particular, the opposite tail is not 1 - half the two-sided p-value.
      let cum = 0;
      if (alternative === 'greater') {
        for (let k = U1; k < counts.length; k++) cum += counts[k];
      } else {
        const limit = alternative === 'less' ? U1 : U;
        for (let k = 0; k <= limit; k++) cum += counts[k];
      }
      p = Math.min(1, (alternative === 'two-sided' ? 2 : 1) * cum / total);
      method = 'exact';
    } else {
      ({ z, p } = rankNormalResult(U1 - meanU, varU, alternative));
      method = hasTies ? 'normal approximation (tie-corrected)' : 'normal approximation';
    }
    return {
      test: 'Mann-Whitney U test', n1, n2, U1, U2, U, R1, R2: sum(ranks.slice(n1)),
      meanRank1: R1 / n1, meanRank2: sum(ranks.slice(n1)) / n2, z, p, method, hasTies, alternative,
    };
  }
  function maxUSafe(n1, n2) { return n1 * n2 <= 40000; }

  // ---------- Wilcoxon signed-rank (paired) ----------
  function wilcoxonSignedRank(raw1, raw2, alternative = 'two-sided') {
    C.validateAlternative(alternative);
    const n = Math.min(raw1.length, raw2.length);
    const diffs = [];
    let validPairs = 0;
    for (let i = 0; i < n; i++) {
      const x = Number(raw1[i]), y = Number(raw2[i]);
      if (raw1[i] !== '' && raw2[i] !== '' && raw1[i] != null && raw2[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) {
        validPairs++;
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
    const { z, p } = validPairs > 0 ? rankNormalResult(Wpos - meanW, varW, alternative) : { z: NaN, p: NaN };
    return { test: 'Wilcoxon matched-pairs signed rank test', alternative, n: nr, Wpos, Wneg, W, z, p, method: 'normal approximation' };
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
  function pearson(rawX, rawY, alternative = 'two-sided') {
    C.validateAlternative(alternative);
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
    const p = C.studentTP(t, df, alternative);
    const z = Math.atanh(r), se = 1 / Math.sqrt(nn - 3);
    const zc = C.normalInv(0.975);
    return { test: 'Pearson correlation', alternative, n: nn, r, r2: r * r, df, t, p, ci95lo: Math.tanh(z - zc * se), ci95hi: Math.tanh(z + zc * se) };
  }

  // Exact null distribution of Spearman's S = Σ(rank_x − rank_y)² for n untied pairs. With x
  // ranks as positions, the n! equally likely y rankings π give T = Σ i·π(i) = Σi² − S/2.
  // Counts of permutations by T come from a DP over the set of ranks already placed; they are
  // exact integers in doubles (15! < 2^53). Cached per n (n = 15 takes ~0.1 s and ~50 MB).
  const SPEARMAN_EXACT_MAX_N = 15;
  const spearmanCache = new Map();
  function spearmanUpperCounts(n) {
    if (spearmanCache.has(n)) return spearmanCache.get(n);
    const size = 1 << n, counts = new Array(size), low = new Int32Array(size), ranks = new Int32Array(n);
    counts[0] = Float64Array.of(1);
    let layer = [0];
    for (let k = 1; k <= n; k++) { // position k takes an unused rank v, adding k·v to T
      const next = [];
      for (const mask of layer) {
        const from = counts[mask], base = low[mask];
        counts[mask] = undefined;
        for (let v = 1; v <= n; v++) {
          const to = mask | (1 << (v - 1));
          if (to === mask) continue;
          if (!counts[to]) { // T range of these k ranks on positions 1..k (rearrangement inequality)
            let c = 0;
            for (let w = 1; w <= n; w++) if (to & (1 << (w - 1))) ranks[c++] = w;
            let lo = 0, hi = 0;
            for (let i = 0; i < k; i++) { hi += (i + 1) * ranks[i]; lo += (i + 1) * ranks[k - 1 - i]; }
            counts[to] = new Float64Array(hi - lo + 1); low[to] = lo; next.push(to);
          }
          const dest = counts[to], off = base + k * v - low[to];
          for (let i = 0; i < from.length; i++) dest[off + i] += from[i];
        }
      }
      layer = next;
    }
    const dist = counts[size - 1], upper = new Float64Array(dist.length + 1); // upper[i] = #(T >= lo + i)
    for (let i = dist.length - 1; i >= 0; i--) upper[i] = upper[i + 1] + dist[i];
    const out = { lo: low[size - 1], upper };
    spearmanCache.set(n, out);
    return out;
  }
  // P(S <= s) or P(S >= s). Reversing the y ranks maps T to n(n+1)²/2 − T, so both tails
  // come from upper counts of T without subtracting from 1.
  function spearmanExactTail(n, S, lowerTail) {
    const { lo, upper } = spearmanUpperCounts(n);
    const t = n * (n + 1) * (2 * n + 1) / 6 - S / 2;
    const i = Math.ceil(lowerTail ? t : n * (n + 1) * (n + 1) / 2 - t) - lo;
    return upper[Math.min(Math.max(i, 0), upper.length - 1)] / upper[0];
  }
  // Best & Roberts (1975), Algorithm AS 89: Edgeworth series for the same tails, with a ±1
  // continuity offset for S's even-integer lattice (R's cor.test uses it for 10 <= n <= 1290).
  const AS89 = [0.2274, 0.2531, 0.1745, 0.0758, 0.1033, 0.3932, 0.0879, 0.0151, 0.0072, 0.0831, 0.0131, 4.6e-4];
  function spearmanEdgeworthTail(n, S, lowerTail) {
    if (lowerTail ? S >= (n * n * n - n) / 3 : S <= 0) return 1;
    const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12] = AS89;
    const b = 1 / n;
    const x = (6 * (S + (lowerTail ? 1 : -1)) / (n * (n * n - 1)) - 1) * Math.sqrt(n - 1);
    const y = x * x;
    const u = x * b * (c1 + b * (c2 + c3 * b) + y * (-c4 + b * (c5 + c6 * b)
      - y * b * (c7 + c8 * b - y * (c9 - c10 * b + y * b * (c11 - c12 * y)))));
    const corr = u * Math.exp(-y / 2);
    return Math.max(0, Math.min(1, lowerTail ? C.normalCDF(x) - corr : C.normalCDF(-x) + corr));
  }

  // P-values: exact permutation distribution (n <= 15), then the AS 89 series (n <= 1290),
  // else, or with ties, the Student t approximation. R's cor.test follows the same scheme
  // but leaves exact enumeration above n = 9.
  function spearman(rawX, rawY, alternative = 'two-sided') {
    C.validateAlternative(alternative);
    const xs = [], ys = [];
    const n = Math.min(rawX.length, rawY.length);
    for (let i = 0; i < n; i++) {
      const x = Number(rawX[i]), y = Number(rawY[i]);
      if (rawX[i] !== '' && rawY[i] !== '' && rawX[i] != null && rawY[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    const rx = rankData(xs), ry = rankData(ys), nn = xs.length;
    const pr = pearson(rx.ranks, ry.ranks, alternative);
    let p = pr.p, method;
    if (nn < 3) method = 'insufficient data';
    else if (rx.tieCounts.length || ry.tieCounts.length) method = 't approximation (ties present)';
    else if (nn > 1290) method = 't approximation';
    else {
      let S = 0;
      for (let i = 0; i < nn; i++) S += (rx.ranks[i] - ry.ranks[i]) ** 2;
      const exact = nn <= SPEARMAN_EXACT_MAX_N;
      const tail = (lowerTail) => (exact ? spearmanExactTail : spearmanEdgeworthTail)(nn, S, lowerTail);
      // rho > 0 means small S: P(rho >= r) = P(S <= s)
      p = alternative === 'greater' ? tail(true) : alternative === 'less' ? tail(false)
        : Math.min(1, 2 * tail(S <= (nn * nn * nn - nn) / 6));
      method = exact ? 'exact' : 'Edgeworth series approximation (AS 89)';
    }
    return { test: 'Spearman correlation', alternative, n: nn, rho: pr.r, df: pr.df, t: pr.t, p, method };
  }

  // ---------- simple linear regression ----------
  function linearRegression(rawX, rawY, alternative = 'two-sided') {
    C.validateAlternative(alternative);
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
    const pSlope = C.studentTP(tSlope, df, alternative);
    const tcrit = C.studentTinv(0.975, df);
    return {
      test: 'Simple linear regression', alternative, n: nn, slope, intercept, r2, df,
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
    const emptyCells = [];
    for (let i = 0; i < a; i++) {
      cellMeans[i] = []; cellN[i] = []; cellSD[i] = [];
      for (let j = 0; j < b; j++) {
        const v = cells[i][j] || [];
        cellN[i][j] = v.length; N += v.length;
        if (v.length === 0) { allPresent = false; emptyCells.push([i, j]); }
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
      replicated, interaction: replicated, emptyCells, cellMeans, cellN, cellSD,
    };
  }

  function twoWayPosthoc(model, method = 'sidak', direction = 'colsWithinRow') {
    const { cellMeans, cellN, colNames, rowNames, residual, a, b } = model;
    const msE = residual.ms, dfE = residual.df;
    const comps = [];
    // cellA/cellB are the [row, col] indices of the two cells being compared, when the
    // comparison is between individual cells (simple effects / cell-vs-cell). They let the
    // grouped-bar figure locate the exact bars to bracket. Marginal-mean comparisons
    // (main effects) leave them undefined — no single bar represents a marginal mean.
    const add = (within, an, bn, diff, se, groups, cellA, cellB) => {
      if (!(se > 0) || !isFinite(diff)) return;
      comps.push({ within, a: an, b: bn, diff, se, t: diff / se, groups, cellA, cellB });
    };
    // Estimated marginal mean over a set of cells (equal weight per present cell)
    // and the variance of that mean from the pooled error MS. Cells are independent,
    // so Var(marginal_j − marginal_k) = Var(marginal_j) + Var(marginal_k).
    const marginal = (idxs) => {
      let sum = 0, varr = 0, cnt = 0;
      for (const [i, j] of idxs) { if (!cellN[i][j]) continue; sum += cellMeans[i][j]; varr += msE / cellN[i][j]; cnt++; }
      return cnt ? { mean: sum / cnt, varr: varr / (cnt * cnt) } : null;
    };
    if (direction === 'colsWithinRow') {
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = j + 1; k < b; k++) {
        if (!cellN[i][j] || !cellN[i][k]) continue;
        const diff = cellMeans[i][j] - cellMeans[i][k];
        const se = Math.sqrt(msE * (1 / cellN[i][j] + 1 / cellN[i][k]));
        add(rowNames[i], colNames[j], colNames[k], diff, se, b, [i, j], [i, k]);
      }
    } else if (direction === 'rowsWithinCol') {
      for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) for (let k = i + 1; k < a; k++) {
        if (!cellN[i][j] || !cellN[k][j]) continue;
        const diff = cellMeans[i][j] - cellMeans[k][j];
        const se = Math.sqrt(msE * (1 / cellN[i][j] + 1 / cellN[k][j]));
        add(colNames[j], rowNames[i], rowNames[k], diff, se, a, [i, j], [k, j]);
      }
    } else if (direction === 'colMeans') {
      const M = [];
      for (let j = 0; j < b; j++) M[j] = marginal(Array.from({ length: a }, (_, i) => [i, j]));
      for (let j = 0; j < b; j++) for (let k = j + 1; k < b; k++) {
        if (!M[j] || !M[k]) continue;
        add('—', colNames[j], colNames[k], M[j].mean - M[k].mean, Math.sqrt(M[j].varr + M[k].varr), b);
      }
    } else if (direction === 'rowMeans') {
      const M = [];
      for (let i = 0; i < a; i++) M[i] = marginal(Array.from({ length: b }, (_, j) => [i, j]));
      for (let i = 0; i < a; i++) for (let k = i + 1; k < a; k++) {
        if (!M[i] || !M[k]) continue;
        add('—', rowNames[i], rowNames[k], M[i].mean - M[k].mean, Math.sqrt(M[i].varr + M[k].varr), a);
      }
    } else { // 'cells' — every cell mean vs every other cell mean
      const flat = [];
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) if (cellN[i][j]) flat.push([i, j]);
      const g = flat.length;
      for (let x = 0; x < flat.length; x++) for (let y = x + 1; y < flat.length; y++) {
        const [i1, j1] = flat[x], [i2, j2] = flat[y];
        const diff = cellMeans[i1][j1] - cellMeans[i2][j2];
        const se = Math.sqrt(msE * (1 / cellN[i1][j1] + 1 / cellN[i2][j2]));
        add('—', rowNames[i1] + ' · ' + colNames[j1], rowNames[i2] + ' · ' + colNames[j2], diff, se, g, [i1, j1], [i2, j2]);
      }
    }
    const m = comps.length;
    // Every method controls the familywise error over all comparisons listed. For Tukey within
    // rows (or columns) that family spans several independent sets of means sharing one error
    // MS, so use the largest studentized range across them (Copenhaver & Holland 1988).
    const ranges = direction === 'colsWithinRow' ? new Set(comps.map((c) => c.cellA[0])).size
      : direction === 'rowsWithinCol' ? new Set(comps.map((c) => c.cellA[1])).size : 1;
    comps.forEach((c) => { c.pRaw = C.studentTtwoTailP(c.t, dfE); });
    if (method === 'tukey') comps.forEach((c) => { c.q = Math.abs(c.diff) / (c.se / Math.SQRT2); c.p = C.tukeyP(c.q, c.groups, dfE, ranges); c.sig = c.p < 0.05; });
    else {
      let adj;
      if (method === 'bonferroni') adj = comps.map((c) => Math.min(1, c.pRaw * m));
      else if (method === 'holm-sidak') adj = holmSidak(comps.map((c) => c.pRaw));
      else adj = comps.map((c) => 1 - Math.pow(1 - c.pRaw, m));
      comps.forEach((c, idx) => { c.p = adj[idx]; c.sig = c.p < 0.05; });
    }
    return { method, direction, comparisons: comps, dfError: dfE, ranges };
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
      factorRow: rk.factorRow, factorCol: rk.factorCol, cellMeans: rk.cellMeans, cellN: rk.cellN, cellSD: rk.cellSD, interaction: rk.interaction, emptyCells: rk.emptyCells,
    };
  }

  return {
    clean, mean, sd, sem, variance, quantile, describe, rankData, centralMoments,
    oneSampleT, unpairedT, pairedT,
    oneWayANOVA, brownForsythe, posthoc, holmSidak, dunnettP,
    mannWhitney, mannWhitneyCounts, wilcoxonSignedRank,
    kruskalWallis, dunnPosthoc,
    pearson, spearman, spearmanUpperCounts, linearRegression,
    twoWayANOVA, twoWayPosthoc, scheirerRayHare,
  };
})(typeof StatCore !== 'undefined' ? StatCore : require('./stats-core.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = StatTests;
