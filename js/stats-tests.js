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

    // Brown–Forsythe ANOVA (F*, a test of means; not the equal-variance test below).
    // Brown & Forsythe (1974), Technometrics 16:129–132: the denominator weights each
    // group variance by (1 − n_i/N) and takes a Satterthwaite denominator df.
    const bfTerms = vars.map((v, i) => (1 - ns[i] / N) * v);
    const bfDen = sum(bfTerms);
    const Fbf = ssB / bfDen;
    const df2bf = 1 / sum(bfTerms.map((c, i) => (c / bfDen) ** 2 / (ns[i] - 1)));
    const pbf = C.fDistP(Fbf, k - 1, df2bf);

    return {
      test: 'One-way ANOVA', k, names, ns, means, sds: vars.map(Math.sqrt), grand,
      ssB, ssW, ssT, dfB, dfW, msB, msW, F, p, eta2, omega2,
      welch: { F: Fw, df1: k - 1, df2: df2w, p: pw },
      brownForsytheF: { F: Fbf, df1: k - 1, df2: df2bf, p: pbf },
      _data: data, _msW: msW, _dfW: dfW,
    };
  }

  // ---------- Bartlett's test for equal variances ----------
  // Snedecor & Cochran form: chi-square on k − 1 df. Sensitive to non-normality.
  function bartlett(groups) {
    const data = groups.map((g) => clean(Array.isArray(g) ? g : g.values));
    const k = data.length, ns = data.map((g) => g.length);
    const result = { test: "Bartlett's test (equal variances)", k, ns, T: NaN, df: k - 1, p: NaN };
    if (k < 2) return Object.assign(result, { error: "Bartlett's test needs at least two groups." });
    if (ns.some((n) => n < 2)) return Object.assign(result, { error: 'Each group needs at least two values.' });
    const vars = data.map((g) => variance(g));
    if (vars.some((v) => !(v > 0) || !Number.isFinite(v))) return Object.assign(result, { error: 'Every group needs some within-group variation.' });
    const N = sum(ns);
    const sp2 = sum(vars.map((v, i) => (ns[i] - 1) * v)) / (N - k);
    const numer = (N - k) * Math.log(sp2) - sum(vars.map((v, i) => (ns[i] - 1) * Math.log(v)));
    const denom = 1 + (sum(ns.map((n) => 1 / (n - 1))) - 1 / (N - k)) / (3 * (k - 1));
    result.T = Math.max(0, numer / denom);
    result.p = C.chiSquareP(result.T, k - 1);
    return result;
  }

  // ---------- test for linear trend across group order ----------
  // Regression of every value on its group's left-to-right position (1, 2, … k),
  // tested against the ANOVA within-group mean square (Altman, Practical Statistics
  // for Medical Research, 1991). SS(trend) + SS(departure from linearity) = SS(between).
  function linearTrend(anova) {
    const { k, ns, means, grand, ssB, ssT, _msW: msW, _dfW: dfW } = anova;
    const N = sum(ns);
    const xbar = sum(ns.map((n, i) => n * (i + 1))) / N;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < k; i++) { const dx = i + 1 - xbar; sxx += ns[i] * dx * dx; sxy += ns[i] * dx * (means[i] - grand); }
    const slope = sxy / sxx;
    const ssTrend = sxy * sxy / sxx;
    const F = ssTrend / msW;
    const ssNonlinear = Math.max(0, ssB - ssTrend), dfNonlinear = k - 2;
    const Fnl = dfNonlinear > 0 ? (ssNonlinear / dfNonlinear) / msW : NaN;
    return {
      test: 'Test for linear trend', slope, r2: ssTrend / ssT,
      ssTrend, F, df1: 1, df2: dfW, p: C.fDistP(F, 1, dfW),
      nonlinear: { ss: ssNonlinear, df: dfNonlinear, F: Fnl, p: dfNonlinear > 0 ? C.fDistP(Fnl, dfNonlinear, dfW) : NaN },
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

  // Adjust a family of p-values. 'none'/'lsd' leave them unadjusted (Fisher's LSD,
  // uncorrected Dunn). The FDR methods return q-values: the smallest false-discovery
  // rate Q at which that comparison would be called a discovery.
  //   fdr-bh  Benjamini & Hochberg (1995)
  //   fdr-by  Benjamini & Yekutieli (2001), valid under any dependence
  //   fdr-bky Benjamini, Krieger & Yekutieli (2006) two-stage adaptive step-up
  const ADJUSTMENTS = ['none', 'lsd', 'bonferroni', 'sidak', 'holm-sidak', 'fdr-bh', 'fdr-bky', 'fdr-by'];
  function stepUpRejections(sorted, level, m0) {
    let r = 0;
    for (let i = 0; i < sorted.length; i++) if (sorted[i] <= (i + 1) * level / m0) r = i + 1;
    return r;
  }
  function bkyRejections(sorted, Q) {
    const m = sorted.length, q1 = Q / (1 + Q);
    const r1 = stepUpRejections(sorted, q1, m);
    return (r1 === 0 || r1 === m) ? r1 : stepUpRejections(sorted, q1, m - r1);
  }
  function adjustP(ps, method, fallback) {
    if (!ADJUSTMENTS.includes(method)) {
      if (fallback === undefined) throw new Error('Unknown multiple-comparison correction: ' + method);
      method = fallback;
    }
    const m = ps.length;
    if (method === 'none' || method === 'lsd') return ps.slice();
    if (method === 'bonferroni') return ps.map((p) => Math.min(1, p * m));
    if (method === 'sidak') return ps.map((p) => 1 - Math.pow(1 - p, m));
    if (method === 'holm-sidak') return holmSidak(ps);
    const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    const sorted = order.map((o) => o[0]);
    const q = new Array(m);
    if (method === 'fdr-bky') {
      for (let r = 0; r < m; r++) {
        if (bkyRejections(sorted, 1) < r + 1) { q[r] = 1; continue; }
        let lo = 0, hi = 1;
        for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (bkyRejections(sorted, mid) >= r + 1) hi = mid; else lo = mid; }
        q[r] = hi;
      }
    } else {
      let c = 1;
      if (method === 'fdr-by') { c = 0; for (let i = 1; i <= m; i++) c += 1 / i; }
      let prev = 1;
      for (let r = m - 1; r >= 0; r--) { prev = Math.min(prev, sorted[r] * m * c / (r + 1)); q[r] = prev; }
    }
    const adj = new Array(m);
    order.forEach(([, idx], r) => { adj[idx] = q[r]; });
    return adj;
  }

  // E[fn(u)] for u = sqrt(chi²_df / df), the ratio of an estimated SD to the true SD.
  // Midpoint rule over the whole mass of the density, normalized by the same rule.
  // Few degrees of freedom spread the mass widely, so they get a finer grid.
  function chiScaleMean(df, fn) {
    if (!(df > 0)) return NaN;
    if (df > 5000) return fn(1);
    const steps = Math.max(240, Math.ceil(4000 / df));
    const hi = Math.sqrt((df + 12 * Math.sqrt(2 * df) + 40) / df);
    const h = hi / steps;
    let total = 0, weight = 0;
    for (let n = 0; n < steps; n++) {
      const u = (n + 0.5) * h;
      const f = Math.exp((df - 1) * Math.log(u) - df * (u * u - 1) / 2);
      if (!(f > 0)) continue;
      weight += f; total += f * fn(u);
    }
    return total / weight;
  }

  // Studentized maximum modulus: P(max |t_i| >= x) for m independent numerators that
  // share one variance estimate with df degrees of freedom (Dunnett's T3 reference
  // distribution; Dunnett 1980, JASA 75:796–800).
  function smmP(x, m, df) {
    if (!(x > 0)) return 1;
    const cdf = chiScaleMean(df, (u) => Math.pow(Math.max(0, 2 * C.normalCDF(x * u) - 1), m));
    return Math.max(0, Math.min(1, 1 - cdf));
  }

  // Solve tail(x) = alpha for a decreasing tail probability (bracketed false position,
  // Illinois variant: a handful of evaluations instead of dozens of bisections).
  function criticalValue(tail, alpha = 0.05) {
    let lo = 0, flo = 1 - alpha, hi = 4, fhi = tail(hi) - alpha;
    while (fhi > 0 && hi < 1e6) { lo = hi; flo = fhi; hi *= 2; fhi = tail(hi) - alpha; }
    for (let it = 0; it < 60 && hi - lo > 1e-10 * hi; it++) {
      const x = (lo * fhi - hi * flo) / (fhi - flo), fx = tail(x) - alpha;
      if (fx === 0) return x;
      if (fx > 0) { lo = x; flo = fx; fhi /= 2; } else { hi = x; fhi = fx; flo /= 2; }
    }
    return (lo * fhi - hi * flo) / (fhi - flo);
  }

  const WELCH_METHODS = ['games-howell', 'tamhane-t2', 'dunnett-t3'];

  // Turn a family of comparisons {i, j, diff, se, df} into adjusted p-values, 95%
  // simultaneous intervals where the method defines them, and a significance flag.
  // ctx.k = number of means in the family (studentized range); ctx.means orders the
  // Newman–Keuls ranges; ctx.lambdas carries the Dunnett correlation structure.
  // ctx.ownDf says each comparison may have its own df (the quick solver is then used
  // for Tukey critical values); ctx.intervals === false skips the intervals.
  function finishComparisons(items, method, ctx) {
    const m = items.length, alpha = 0.05;
    const cache = new Map();
    const cached = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
    const wantIntervals = ctx.intervals !== false;
    const interval = (c, crit) => { if (!wantIntervals) return; crit = crit(); c.ci95lo = c.diff - crit * c.se; c.ci95hi = c.diff + crit * c.se; };
    items.forEach((c) => { c.t = c.diff / c.se; c.pRaw = C.studentTtwoTailP(c.t, c.df); });
    if (method === 'tukey' || method === 'games-howell') {
      // Tukey shares one df, so the historical bisection runs once; Games–Howell has a
      // df per pair and uses the quicker solver.
      const qcrit = (df) => method === 'tukey' && !ctx.ownDf ? C.tukeyInv(1 - alpha, ctx.k, df) : criticalValue((q) => C.tukeyP(q, ctx.k, df), alpha);
      items.forEach((c) => {
        c.q = Math.SQRT2 * Math.abs(c.t);
        c.p = C.tukeyP(c.q, ctx.k, c.df);
        interval(c, () => cached(c.df, () => qcrit(c.df)) / Math.SQRT2);
      });
    } else if (method === 'snk') {
      // Newman–Keuls: each pair is referred to the studentized range for the number
      // of ordered means it spans, and is tested only if no wider range containing
      // it was already non-significant.
      const order = ctx.means.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      const pos = []; order.forEach(([, idx], r) => { pos[idx] = r; });
      items.forEach((c) => { c.r = Math.abs(pos[c.i] - pos[c.j]) + 1; c.q = Math.SQRT2 * Math.abs(c.t); c.p = C.tukeyP(c.q, c.r, c.df); });
      const retained = [];
      items.slice().sort((x, y) => y.r - x.r).forEach((c) => {
        const lo = Math.min(pos[c.i], pos[c.j]), hi = Math.max(pos[c.i], pos[c.j]);
        c.sig = c.p < alpha && !retained.some(([a, b]) => a <= lo && hi <= b);
        if (!c.sig) retained.push([lo, hi]);
      });
      return items;
    } else if (method === 'dunnett') {
      items.forEach((c) => {
        c.p = dunnettP(Math.abs(c.t), m, c.df, ctx.lambdas);
        interval(c, () => cached(c.df, () => criticalValue((d) => dunnettP(d, m, c.df, ctx.lambdas), alpha)));
      });
    } else if (method === 'tamhane-t2') {
      items.forEach((c) => {
        c.p = 1 - Math.pow(1 - c.pRaw, m);
        interval(c, () => C.studentTinv(1 - (1 - Math.pow(1 - alpha, 1 / m)) / 2, c.df));
      });
    } else if (method === 'dunnett-t3') {
      items.forEach((c) => {
        c.p = smmP(Math.abs(c.t), m, c.df);
        interval(c, () => cached(c.df, () => criticalValue((x) => smmP(x, m, c.df), alpha)));
      });
    } else {
      const adj = adjustP(items.map((c) => c.pRaw), method);
      items.forEach((c, idx) => {
        c.p = adj[idx];
        const tail = method === 'bonferroni' ? alpha / m : method === 'sidak' ? 1 - Math.pow(1 - alpha, 1 / m) : (method === 'lsd' || method === 'none') ? alpha : null;
        if (tail != null) interval(c, () => C.studentTinv(1 - tail / 2, c.df));
      });
    }
    items.forEach((c) => { c.sig = c.p < alpha; });
    return items;
  }

  // Which pairs form the family: the selected pairs, every group against a control,
  // or every pair. Control comparisons are oriented group − control.
  function comparisonFamily(k, method, opts) {
    if (method === 'custom') return (opts.pairs && opts.pairs.length) ? opts.pairs : pairwiseList(k);
    if (method === 'dunnett' || opts.family === 'control') {
      const control = opts.control != null ? +opts.control : 0;
      const pairs = []; for (let i = 0; i < k; i++) if (i !== control) pairs.push([i, control]);
      return pairs;
    }
    return pairwiseList(k);
  }
  const labelComparisons = (items, names) => items.map((c) => {
    const out = Object.assign({ a: names[c.i], b: names[c.j] }, c);
    delete out.i; delete out.j;
    return out;
  });

  // Multiple comparisons after one-way ANOVA.
  //   method  tukey | snk | bonferroni | sidak | holm-sidak | lsd | fdr-bh | fdr-bky | fdr-by
  //           (pooled within-group variance), games-howell | tamhane-t2 | dunnett-t3
  //           (each pair's own variances, Welch df), dunnett (vs control), or custom
  //           (opts.pairs adjusted by opts.correction).
  //   opts.family = 'control' compares every group with opts.control using `method`.
  // An unrecognized method keeps the historical default (Holm-Šídák; Šídák for custom).
  function posthoc(anova, method = 'tukey', opts = {}) {
    const data = anova._data, names = anova.names, msW = anova._msW, dfW = anova._dfW;
    const k = data.length;
    const means = data.map(mean);
    const ns = data.map((g) => g.length);
    const vars = data.map((g, i) => variance(g, means[i]));
    const known = (name) => ADJUSTMENTS.includes(name) || WELCH_METHODS.includes(name);
    let calc = method;
    if (method === 'custom') { calc = opts.correction || 'sidak'; if (!known(calc) || calc === 'games-howell') calc = 'sidak'; }
    else if (!known(method) && !['tukey', 'snk', 'dunnett'].includes(method)) calc = 'holm-sidak';
    const control = method === 'dunnett' || (method !== 'custom' && opts.family === 'control');
    if (control && ['tukey', 'snk', 'games-howell'].includes(calc)) calc = 'holm-sidak';
    const welch = WELCH_METHODS.includes(calc);
    const items = comparisonFamily(k, method, opts).map(([i, j]) => {
      const diff = means[i] - means[j];
      if (!welch) return { i, j, diff, se: Math.sqrt(msW * (1 / ns[i] + 1 / ns[j])), df: dfW };
      const a = vars[i] / ns[i], b = vars[j] / ns[j];
      return { i, j, diff, se: Math.sqrt(a + b), df: (a + b) ** 2 / (a * a / (ns[i] - 1) + b * b / (ns[j] - 1)) };
    });
    const ctx = { k, means };
    if (calc === 'dunnett' && ns.some((n) => n !== ns[0])) {
      // Unequal group sizes: corr(T_i, T_j) = λ_i λ_j with λ_i = sqrt(n_i / (n_i + n_control)).
      ctx.lambdas = items.map((c) => Math.sqrt(ns[c.i] / (ns[c.i] + ns[c.j])));
    }
    finishComparisons(items, calc, ctx);
    return { method: method === 'custom' ? 'custom (' + (opts.correction || 'sidak') + ')' : method, comparisons: labelComparisons(items, names) };
  }

  // Two-sided Dunnett p-value. Without `lambdas` the comparisons are equicorrelated
  // (rho = 0.5), which is exact for balanced designs. With `lambdas` (one per
  // comparison) corr(T_i, T_j) = λ_i λ_j, the exact structure for unequal group sizes.
  function dunnettP(d, mTreat, df, lambdas) {
    if (lambdas) {
      if (!(d > 0)) return 1;
      const cs = lambdas.map((l) => Math.sqrt(1 - l * l));
      const cdf = chiScaleMean(df, (u) => {
        let s = 0;
        for (let g = 0; g < ghNodes20.x.length; g++) {
          const z = ghNodes20.x[g] * Math.SQRT2;
          let prod = 1;
          for (let i = 0; i < lambdas.length; i++) {
            prod *= Math.max(0, C.normalCDF((d * u + lambdas[i] * z) / cs[i]) - C.normalCDF((-d * u + lambdas[i] * z) / cs[i]));
          }
          s += ghNodes20.w[g] * prod;
        }
        return s / Math.sqrt(Math.PI);
      });
      return Math.max(0, Math.min(1, 1 - cdf));
    }
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

  // ---------- exact permutation distributions for rank tests ----------
  // Ranks as whole numbers: doubled when any tie produced a half rank.
  function integerScores(ranks) {
    const scale = ranks.some((r) => r % 1 !== 0) ? 2 : 1;
    return ranks.map((r) => Math.round(r * scale));
  }
  // Tail probabilities of an integer-valued statistic whose null mean is num / den.
  // `two` counts every outcome at least as far from that mean as the observed one.
  const tailsFrom = (dist, lo, obs, num, den) => {
    let total = 0, lower = 0, upper = 0, two = 0;
    const far = Math.abs(obs * den - num);
    for (let s = 0; s < dist.length; s++) {
      const v = dist[s]; if (!v) continue;
      const x = s + lo; total += v;
      if (x <= obs) lower += v;
      if (x >= obs) upper += v;
      if (Math.abs(x * den - num) >= far) two += v;
    }
    return { lower: Math.min(1, lower / total), upper: Math.min(1, upper / total), two: Math.min(1, two / total) };
  };
  const exactP = (tails, alternative) => alternative === 'greater' ? tails.upper : alternative === 'less' ? tails.lower : tails.two;

  // Signed-rank null distribution: each rank carries a + sign with probability 1/2.
  // Valid with tied ranks. Tails are for the sum of positive ranks.
  function signedRankExactTails(scores, obs) {
    const dist = new Float64Array(scores.reduce((s, v) => s + v, 0) + 1);
    dist[0] = 1;
    let top = 0;
    for (const r of scores) {
      for (let s = top; s >= 0; s--) { const half = dist[s] / 2; dist[s] = half; dist[s + r] += half; }
      top += r;
    }
    return tailsFrom(dist, 0, obs, top, 2);
  }

  // Rank-sum null distribution with ties: every choice of m of the N scores is equally
  // likely. Tails are for the sum of the chosen scores. null when too large to enumerate.
  const RANK_SUM_BUDGET = 7e8;
  function rankSumExactTails(scores, m, obs) {
    const sorted = scores.slice().sort((x, y) => x - y), N = sorted.length;
    let hi = 0; for (let i = N - m; i < N; i++) hi += sorted[i];
    if (N * m * (hi + 1) > RANK_SUM_BUDGET) return null;
    const width = hi + 1, ways = new Float64Array((m + 1) * width);
    ways[0] = 1;
    let prefix = 0;
    for (let t = 0; t < N; t++) {
      const r = sorted[t];
      for (let k = Math.min(t, m - 1); k >= 0; k--) {
        const from = k * width, to = (k + 1) * width + r, smax = Math.min(prefix, hi - r);
        for (let s = 0; s <= smax; s++) { const v = ways[from + s]; if (v) ways[to + s] += v; }
      }
      prefix += r;
    }
    return tailsFrom(ways.subarray(m * width), 0, obs, m * prefix, N);
  }

  // Spearman null distribution: all n! pairings of the two rank vectors, by dynamic
  // programming over how many of each distinct b value have been used (tied values are
  // interchangeable). Tails are for sum(a[i] * b[pairing(i)]), which increases with rho.
  // null when there are too many pairs or too many states to enumerate.
  const SPEARMAN_EXACT_MAX_N = 17, SPEARMAN_BUDGET = 3e9;
  function spearmanExactTails(aRaw, bRaw) {
    const n = aRaw.length;
    if (n > SPEARMAN_EXACT_MAX_N) return null;
    // The sum is symmetric in a and b; track the vector with fewer distinct values.
    if (new Set(aRaw).size < new Set(bRaw).size) [aRaw, bRaw] = [bRaw, aRaw];
    let obs = 0; for (let i = 0; i < n; i++) obs += aRaw[i] * bRaw[i];
    const a = aRaw.slice().sort((x, y) => x - y);
    const vals = [...new Set(bRaw)].sort((x, y) => x - y), G = vals.length;
    const cnt = vals.map((v) => bRaw.filter((x) => x === v).length);
    const stride = []; let states = 1;
    for (let g = 0; g < G; g++) { stride.push(states); states *= cnt[g] + 1; }
    const used = (key, g) => Math.floor(key / stride[g]) % (cnt[g] + 1);
    // Smallest and largest attainable sums when the first k values of a take the b's in key.
    const bounds = (key, k) => {
      const c = []; for (let g = 0; g < G; g++) for (let u = used(key, g); u > 0; u--) c.push(vals[g]);
      let lo = 0, hi = 0; for (let i = 0; i < k; i++) { lo += a[i] * c[k - 1 - i]; hi += a[i] * c[i]; }
      return [lo, hi];
    };
    const [loAll, hiAll] = bounds(states - 1, n);
    if (states * G * (hiAll - loAll + 1) / 8 > SPEARMAN_BUDGET) return null;
    let layer = new Map([[0, { lo: 0, arr: Float64Array.of(1) }]]);
    for (let i = 0; i < n; i++) {
      const next = new Map();
      for (const [key, src] of layer) {
        for (let g = 0; g < G; g++) {
          const left = cnt[g] - used(key, g);
          if (!left) continue;
          const nk = key + stride[g];
          let dst = next.get(nk);
          if (!dst) { const [lo, hi] = bounds(nk, i + 1); dst = { lo, arr: new Float64Array(hi - lo + 1) }; next.set(nk, dst); }
          const shift = a[i] * vals[g] + src.lo - dst.lo, sa = src.arr, da = dst.arr;
          for (let s = 0; s < sa.length; s++) da[s + shift] += left * sa[s];
        }
      }
      layer = next;
    }
    const full = layer.get(states - 1);
    return tailsFrom(full.arr, full.lo, obs, a.reduce((s, v) => s + v, 0) * bRaw.reduce((s, v) => s + v, 0), n);
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
      // Tied data: exact permutation distribution of the rank sum, while the smaller
      // group has at most 100 values and the enumeration stays affordable.
      if (hasTies && varU > 0 && Math.min(n1, n2) <= 100) {
        const scores = integerScores(ranks), first = n1 <= n2;
        const chosen = first ? scores.slice(0, n1) : scores.slice(n1);
        const tails = rankSumExactTails(scores, chosen.length, sum(chosen));
        if (tails) {
          // A large rank sum in the second group means small values in the first.
          p = exactP(first ? tails : { lower: tails.upper, upper: tails.lower, two: tails.two }, alternative);
          method = 'exact (ties)';
        }
      }
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
    let { z, p } = validPairs > 0 ? rankNormalResult(Wpos - meanW, varW, alternative) : { z: NaN, p: NaN };
    let method = 'normal approximation';
    // Up to 200 pairs: exact p-value, ties included.
    if (nr > 0 && validPairs <= 200) {
      const scores = integerScores(ranks);
      let obs = 0; diffs.forEach((d, i) => { if (d > 0) obs += scores[i]; });
      p = exactP(signedRankExactTails(scores, obs), alternative);
      method = 'exact';
    }
    return { test: 'Wilcoxon matched-pairs signed rank test', alternative, n: nr, Wpos, Wneg, W, z, p, method };
  }

  // Kruskal-Wallis null distribution: every assignment of the N ranks to groups of the
  // given sizes is equally likely. Dynamic programming over the ranks, tracking how many
  // ranks each group has received and their sum for every group but the largest (whose
  // sum is whatever is left). Valid with tied ranks. Returns P(H >= observed), or null
  // when a group has more than KW_EXACT_MAX_GROUP values or the table is too large.
  const KW_EXACT_MAX_GROUP = 35, KW_CELL_BUDGET = 2e7, KW_WORK_BUDGET = 2e9;
  function kruskalExactP(scores, ns, rankSums) {
    const N = scores.length, k = ns.length;
    if (k < 2 || ns.some((n) => n < 1 || n > KW_EXACT_MAX_GROUP)) return null;
    const order = ns.map((_, i) => i).sort((x, y) => ns[x] - ns[y]);
    const tracked = order.slice(0, k - 1), rest = order[k - 1], d = k - 1;
    const size = tracked.map((g) => ns[g]);
    const sorted = scores.slice().sort((x, y) => x - y);
    const total = sorted.reduce((s, v) => s + v, 0);
    // Smallest and largest possible sum of c ranks.
    const low = [0], high = [0];
    for (let c = 1; c <= size[d - 1]; c++) { low.push(low[c - 1] + sorted[c - 1]); high.push(high[c - 1] + sorted[N - c]); }
    const width = low.map((v, c) => high[c] - v + 1);
    // One block of cells per combination of counts; within a block, one axis per tracked group.
    const radix = []; let nBlocks = 1;
    for (let j = 0; j < d; j++) { radix.push(nBlocks); nBlocks *= size[j] + 1; }
    const blocks = []; let cells = 0;
    for (let id = 0; id < nBlocks; id++) {
      const c = radix.map((r, j) => Math.floor(id / r) % (size[j] + 1));
      const stride = new Array(d); let span = 1;
      for (let j = d - 1; j >= 0; j--) { stride[j] = span; span *= width[c[j]]; }
      blocks.push({ c, stride, offset: cells, span, count: c.reduce((s, v) => s + v, 0) });
      cells += span;
      if (cells > KW_CELL_BUDGET) return null;
    }
    if (cells * N * d > KW_WORK_BUDGET) return null;
    const ways = new Float64Array(cells);
    ways[0] = 1;
    const byCount = blocks.map((_, id) => id).sort((x, y) => blocks[y].count - blocks[x].count);
    // Add every cell of src, moved by `shift` along axis j, into dst.
    const addShifted = (src, dst, j, shift) => {
      const lo = new Array(d), hi = new Array(d);
      for (let m = 0; m < d; m++) {
        lo[m] = m === j ? Math.max(0, -shift) : 0;
        hi[m] = m === j ? Math.min(width[src.c[m]], width[dst.c[m]] - shift) : width[src.c[m]];
        if (lo[m] >= hi[m]) return;
      }
      const walk = (m, s, t) => {
        if (m === d - 1) {
          const tt = t + (m === j ? shift : 0);
          for (let i = lo[m]; i < hi[m]; i++) { const v = ways[s + i]; if (v) ways[tt + i] += v; }
          return;
        }
        for (let i = lo[m]; i < hi[m]; i++) walk(m + 1, s + i * src.stride[m], t + (i + (m === j ? shift : 0)) * dst.stride[m]);
      };
      walk(0, src.offset, dst.offset);
    };
    for (let t = 0; t < N; t++) {
      const r = sorted[t];
      // Highest counts first, so each source block still holds its value from before this rank.
      for (const id of byCount) {
        const dst = blocks[id];
        if (dst.count > t + 1) continue;
        for (let j = 0; j < d; j++) {
          if (!dst.c[j]) continue;
          addShifted(blocks[id - radix[j]], dst, j, r + low[dst.c[j] - 1] - low[dst.c[j]]);
        }
      }
    }
    // H is an increasing function of sum(R_j^2 / n_j).
    const stat = (sums) => { let v = 0, used = 0; sums.forEach((s, j) => { v += s * s / size[j]; used += s; }); return v + (total - used) * (total - used) / ns[rest]; };
    const observed = stat(tracked.map((g) => rankSums[g])) * (1 - 1e-12);
    const full = blocks[nBlocks - 1], sums = new Array(d);
    let all = 0, extreme = 0;
    for (let i = 0; i < full.span; i++) {
      const v = ways[full.offset + i]; if (!v) continue;
      let rem = i; for (let j = 0; j < d; j++) { sums[j] = Math.floor(rem / full.stride[j]) + low[size[j]]; rem %= full.stride[j]; }
      all += v; if (stat(sums) >= observed) extreme += v;
    }
    return Math.min(1, extreme / all);
  }

  // Friedman null distribution: the ranks within each row are shuffled independently.
  // Dynamic programming over rows on the sorted column rank sums (columns are
  // interchangeable). Valid with ties. Exact while (columns!)^rows is at most 1e9;
  // returns P(Q >= observed) or null.
  function friedmanExactP(rankRows, rankSums) {
    const n = rankRows.length, k = rankRows[0].length;
    if (n * C.factorialln(k) > Math.log(1e9) + 1e-9) return null;
    let states = new Map([[new Array(k).fill(0).join(','), { sums: new Array(k).fill(0), w: 1 }]]);
    for (const row of rankRows) {
      const perm = row.slice().sort((x, y) => x - y), perms = [];
      for (;;) { // every distinct ordering of the row's ranks
        perms.push(perm.slice());
        let i = k - 2; while (i >= 0 && perm[i] >= perm[i + 1]) i--;
        if (i < 0) break;
        let j = k - 1; while (perm[j] <= perm[i]) j--;
        [perm[i], perm[j]] = [perm[j], perm[i]];
        for (let a = i + 1, b = k - 1; a < b; a++, b--) [perm[a], perm[b]] = [perm[b], perm[a]];
      }
      const next = new Map();
      for (const { sums, w } of states.values()) {
        for (const q of perms) {
          const s = sums.map((v, j) => v + q[j]).sort((x, y) => x - y), key = s.join(',');
          const hit = next.get(key);
          if (hit) hit.w += w; else next.set(key, { sums: s, w });
        }
      }
      states = next;
    }
    // Q is an increasing function of the sum of squared column rank sums.
    const sq = (sums) => sums.reduce((s, v) => s + v * v, 0), observed = sq(rankSums);
    let all = 0, extreme = 0;
    for (const { sums, w } of states.values()) { all += w; if (sq(sums) >= observed) extreme += w; }
    return Math.min(1, extreme / all);
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
    let p = C.chiSquareP(Hc, df), method = 'chi-square approximation';
    // Small samples: exact p-value, ties included.
    if (Ccorr > 0 && k >= 2 && ns.every((n) => n >= 1)) {
      const scale = ranks.some((r) => r % 1 !== 0) ? 2 : 1;
      const exact = kruskalExactP(ranks.map((r) => Math.round(r * scale)), ns, rankSums.map((r) => Math.round(r * scale)));
      if (exact != null) { p = exact; method = 'exact'; }
    }
    return {
      test: 'Kruskal-Wallis test', k, names, ns, rankSums, meanRanks,
      H: Hc, Hraw: H, df, p, pChiSquare: C.chiSquareP(Hc, df), method, tieCorrection: Ccorr,
      _ranks: ranks, _ns: ns, _names: names, _N: N, _tieTerm: tieTerm,
    };
  }

  function dunnPosthoc(kw, method = 'holm-sidak', opts = {}) {
    const { _ns: ns, _names: names, _N: N, meanRanks, _tieTerm: tieTerm } = kw;
    const k = ns.length;
    // Family: selected pairs, every group vs opts.control, or every pair. The ranks
    // and tie correction always come from all groups.
    const pairs = (opts.pairs && opts.pairs.length) ? opts.pairs
      : comparisonFamily(k, null, opts);
    const sigmaBase = (N * (N + 1) / 12) - tieTerm / (12 * (N - 1));
    const raw = pairs.map(([i, j]) => {
      const se = Math.sqrt(sigmaBase * (1 / ns[i] + 1 / ns[j]));
      const z = Math.abs(meanRanks[i] - meanRanks[j]) / se;
      const p = 2 * (1 - C.normalCDF(z));
      return { i, j, z, p };
    });
    // Unrecognized methods keep the historical Holm-Šídák default.
    const adj = adjustP(raw.map((r) => r.p), method, 'holm-sidak');
    return {
      method, comparisons: raw.map((r, idx) => ({
        a: names[r.i], b: names[r.j], z: r.z, pRaw: r.p, p: adj[idx], sig: adj[idx] < 0.05,
      })),
    };
  }

  // ---------- repeated measures (matched rows) ----------
  // Keep only rows with a value in every column, without shifting row alignment.
  function completeRows(rawCols) {
    const len = Math.max(0, ...rawCols.map((c) => c.length));
    const rows = []; let partial = 0;
    for (let r = 0; r < len; r++) {
      const vals = rawCols.map((c) => c[r]);
      const present = vals.map((v) => v !== '' && v != null && !(typeof v === 'string' && v.trim() === '') && Number.isFinite(Number(v)));
      if (present.every(Boolean)) rows.push(vals.map(Number));
      else if (present.some(Boolean)) partial++;
    }
    return { rows, partial };
  }

  // One-way repeated-measures ANOVA. Each row is one subject, each column one
  // condition. opts.sphericity = true assumes sphericity; otherwise the treatment
  // p-value uses the Geisser–Greenhouse epsilon (Box 1954; Greenhouse & Geisser 1959).
  function rmANOVA(rawCols, names, opts = {}) {
    const k = rawCols.length;
    const { rows, partial } = completeRows(rawCols);
    const n = rows.length;
    names = names || rawCols.map((_, i) => 'Group ' + (i + 1));
    if (k < 2) return { error: 'Repeated-measures ANOVA needs at least two columns.' };
    if (n < 2) return { error: 'Repeated-measures ANOVA needs at least two rows with a value in every column.' };
    const means = [], sds = [];
    for (let j = 0; j < k; j++) { const col = rows.map((r) => r[j]); means.push(mean(col)); sds.push(sd(col)); }
    const subj = rows.map(mean);
    const grand = mean(means);
    let ssTreat = 0, ssSubj = 0, ssRes = 0, ssTot = 0;
    for (let j = 0; j < k; j++) ssTreat += n * (means[j] - grand) ** 2;
    for (let i = 0; i < n; i++) {
      ssSubj += k * (subj[i] - grand) ** 2;
      for (let j = 0; j < k; j++) { ssRes += (rows[i][j] - means[j] - subj[i] + grand) ** 2; ssTot += (rows[i][j] - grand) ** 2; }
    }
    const dfTreat = k - 1, dfSubj = n - 1, dfRes = dfTreat * dfSubj;
    const msTreat = ssTreat / dfTreat, msSubj = ssSubj / dfSubj, msRes = ssRes / dfRes;
    // A residual at rounding-noise level relative to the total is zero in exact arithmetic.
    if (!(ssRes > 1e-13 * ssTot) || !Number.isFinite(msRes)) return { error: 'No residual variation: every subject changes by exactly the same amount, so F is undefined.' };
    const F = msTreat / msRes;
    // Geisser–Greenhouse epsilon from the k × k sample covariance matrix.
    const S = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) {
      let s = 0; for (let i = 0; i < n; i++) s += (rows[i][a] - means[a]) * (rows[i][b] - means[b]);
      S[a][b] = S[b][a] = s / (n - 1);
    }
    let diag = 0, all = 0, sq = 0, rowSq = 0;
    for (let a = 0; a < k; a++) {
      diag += S[a][a]; let rs = 0;
      for (let b = 0; b < k; b++) { rs += S[a][b]; sq += S[a][b] * S[a][b]; }
      all += rs; rowSq += (rs / k) ** 2;
    }
    const dbar = diag / k, sbar = all / (k * k);
    let epsilon = (k * k * (dbar - sbar) ** 2) / ((k - 1) * (sq - 2 * k * rowSq + k * k * sbar * sbar));
    if (!Number.isFinite(epsilon)) epsilon = 1;
    epsilon = Math.min(1, Math.max(1 / (k - 1), epsilon));
    const sphericity = opts.sphericity === true;
    const pAssumed = C.fDistP(F, dfTreat, dfRes);
    const pGG = C.fDistP(F, epsilon * dfTreat, epsilon * dfRes);
    const Fm = msSubj / msRes;
    return {
      test: 'Repeated-measures one-way ANOVA', k, n, names, means, sds, grand, partialRows: partial,
      ssTreat, ssSubj, ssRes, ssTot, dfTreat, dfSubj, dfRes, msTreat, msSubj, msRes,
      F, p: sphericity ? pAssumed : pGG, pAssumed, pGG, epsilon, sphericity,
      df1: sphericity ? dfTreat : epsilon * dfTreat, df2: sphericity ? dfRes : epsilon * dfRes,
      matching: { F: Fm, df1: dfSubj, df2: dfRes, p: C.fDistP(Fm, dfSubj, dfRes) },
      _rows: rows, _data: rows[0].map((_, j) => rows.map((r) => r[j])),
    };
  }

  // Multiple comparisons after repeated-measures ANOVA. With sphericity assumed every
  // comparison uses the pooled residual MS; otherwise each uses the SD of that pair's
  // own differences with n − 1 df. Families and methods as in posthoc(), minus the
  // unequal-variance methods (which are for independent groups).
  function rmPosthoc(rm, method = 'tukey', opts = {}) {
    const { _rows: rows, k, n, means, names } = rm;
    const control = method === 'dunnett' || (method !== 'custom' && opts.family === 'control');
    let calc;
    if (method === 'custom') calc = ADJUSTMENTS.includes(opts.correction) ? opts.correction : 'sidak';
    else if (control) calc = method === 'dunnett' || ADJUSTMENTS.includes(method) ? method : 'holm-sidak';
    else calc = ADJUSTMENTS.includes(method) || method === 'tukey' || method === 'snk' ? method : 'holm-sidak';
    const items = comparisonFamily(k, method, opts).map(([i, j]) => {
      const diff = means[i] - means[j];
      if (rm.sphericity) return { i, j, diff, se: Math.sqrt(2 * rm.msRes / n), df: rm.dfRes };
      return { i, j, diff, se: sd(rows.map((r) => r[i] - r[j])) / Math.sqrt(n), df: n - 1 };
    });
    finishComparisons(items, calc, { k, means });
    return { method: method === 'custom' ? 'custom (' + (opts.correction || 'sidak') + ')' : method, comparisons: labelComparisons(items, names) };
  }

  // Friedman test: ranks within each matched row (average ranks for ties), tie-corrected
  // chi-square approximation on k − 1 df.
  function friedman(rawCols, names) {
    const k = rawCols.length;
    const { rows, partial } = completeRows(rawCols);
    const n = rows.length;
    names = names || rawCols.map((_, i) => 'Group ' + (i + 1));
    if (k < 3) return { error: 'The Friedman test needs at least three columns.' };
    if (n < 2) return { error: 'The Friedman test needs at least two rows with a value in every column.' };
    const rankSums = new Array(k).fill(0), rankRows = [];
    let tieTerm = 0;
    for (const row of rows) {
      const { ranks, tieCounts } = rankData(row);
      rankRows.push(ranks);
      ranks.forEach((r, j) => { rankSums[j] += r; });
      tieTerm += sum(tieCounts.map((t) => t * t * t - t));
    }
    const Qraw = 12 / (n * k * (k + 1)) * sum(rankSums.map((r) => r * r)) - 3 * n * (k + 1);
    const tieCorrection = 1 - tieTerm / (n * k * (k * k - 1));
    if (!(tieCorrection > 0)) return { error: 'Every row is completely tied, so the Friedman statistic is undefined.' };
    const Q = Qraw / tieCorrection;
    // Small tables: exact p-value, ties included (doubled ranks are whole numbers).
    const exact = friedmanExactP(rankRows.map((r) => r.map((v) => Math.round(2 * v))), rankSums.map((v) => Math.round(2 * v)));
    const pChiSquare = C.chiSquareP(Q, k - 1);
    return {
      test: 'Friedman test', k, n, names, rankSums, meanRanks: rankSums.map((r) => r / n), partialRows: partial,
      Q, Qraw, df: k - 1, p: exact != null ? exact : pChiSquare, pChiSquare, tieCorrection, method: exact != null ? 'exact' : 'chi-square approximation',
      _data: rows[0].map((_, j) => rows.map((r) => r[j])),
    };
  }

  // Dunn's comparisons after Friedman: z = |R_i − R_j| / sqrt(n k (k + 1) / 6) on rank sums.
  function friedmanDunn(fr, method = 'holm-sidak', opts = {}) {
    const { k, n, names, rankSums } = fr;
    const pairs = (opts.pairs && opts.pairs.length) ? opts.pairs : comparisonFamily(k, null, opts);
    const se = Math.sqrt(n * k * (k + 1) / 6);
    const raw = pairs.map(([i, j]) => { const z = Math.abs(rankSums[i] - rankSums[j]) / se; return { i, j, z, p: 2 * (1 - C.normalCDF(z)) }; });
    const adj = adjustP(raw.map((r) => r.p), method, 'holm-sidak');
    return {
      method, comparisons: raw.map((r, idx) => ({
        a: names[r.i], b: names[r.j], z: r.z, rankSumDiff: rankSums[r.i] - rankSums[r.j], pRaw: r.p, p: adj[idx], sig: adj[idx] < 0.05,
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

  function spearman(rawX, rawY, alternative = 'two-sided') {
    C.validateAlternative(alternative);
    const xs = [], ys = [];
    const n = Math.min(rawX.length, rawY.length);
    for (let i = 0; i < n; i++) {
      const x = Number(rawX[i]), y = Number(rawY[i]);
      if (rawX[i] !== '' && rawY[i] !== '' && rawX[i] != null && rawY[i] != null && !Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    const rx = rankData(xs).ranks, ry = rankData(ys).ranks;
    const pr = pearson(rx, ry, alternative);
    let p = pr.p, method = 't approximation';
    // 17 or fewer pairs: exact p-value over all pairings of the ranks, ties included.
    if (xs.length >= 3 && Number.isFinite(pr.r)) {
      const tails = spearmanExactTails(integerScores(rx), integerScores(ry));
      if (tails) { p = exactP(tails, alternative); method = 'exact'; }
    }
    return { test: 'Spearman correlation', alternative, n: xs.length, rho: pr.r, df: pr.df, t: pr.t, p, method };
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
  // residual SS of the model with the chosen terms; null if design is rank-deficient.
  // With `detail`, returns { rss, beta, XtX } instead of the number.
  function rssModel(obs, a, b, incA, incB, incAB, detail) {
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
    return detail ? { rss, beta, XtX } : rss;
  }
  // Estimated marginal means of a main-effects-only model: the model's prediction for
  // each level of one factor, averaged with equal weight over the levels of the other
  // (Searle, Speed & Milliken 1980, The American Statistician 34:216–221). With
  // sum-to-zero coding that is intercept + the level's own effect. `cov` is the
  // covariance of those means divided by the residual mean square.
  function additiveMarginalMeans(obs, a, b) {
    const fit = rssModel(obs, a, b, true, true, false, true);
    if (!fit) return null;
    const p = fit.beta.length;
    const inverse = []; // columns of (X'X)^-1
    for (let i = 0; i < p; i++) {
      const col = linSolve(fit.XtX, fit.beta.map((_, r) => (r === i ? 1 : 0)));
      if (!col) return null;
      inverse.push(col);
    }
    const side = (levels, offset) => {
      const L = [];
      for (let lv = 0; lv < levels; lv++) {
        const row = new Array(p).fill(0); row[0] = 1;
        sumZero(lv, levels).forEach((v, k) => { row[offset + k] = v; });
        L.push(row);
      }
      const quad = (x, y) => { let s = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) s += x[i] * inverse[j][i] * y[j]; return s; };
      return { means: L.map((row) => row.reduce((s, v, i) => s + v * fit.beta[i], 0)), cov: L.map((x) => L.map((y) => quad(x, y))) };
    };
    return { row: side(a, 1), col: side(b, a) };
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
    // opts.interaction === false fits main effects only even when replicates would
    // allow the interaction to be estimated.
    const fitInteraction = replicated && opts.interaction !== false;
    const effects = [];
    let rssFull, dfError, marginal = null;

    const mkEffect = (name, ss, df) => {
      const ms = ss / df; const F = ms / (rssFull / dfError);
      return { name, ss, df, ms, F, p: C.fDistP(F, df, dfError), partialEta2: ss / (ss + rssFull) };
    };

    if (fitInteraction) {
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
      marginal = additiveMarginalMeans(obs, a, b);
    }
    return {
      test: 'Two-way ANOVA', a, b, rowNames, colNames, factorRow, factorCol,
      N, grand, ssTotal, effects, residual: { ss: rssFull, df: dfError, ms: rssFull / dfError },
      replicated, interaction: fitInteraction, cellMeans, cellN, cellSD, marginal,
    };
  }

  // One-factor description of a correlation matrix: lambdas with r_ij = λ_i λ_j, which
  // is the structure the Dunnett integral needs. Exact for comparisons of independent
  // means with a shared control; for other designs this is the factor-analytic
  // approximation of Hsu (1992), J. Comput. Graph. Stat. 1:151–168, and `exact` is false.
  function oneFactorLambdas(R) {
    const m = R.length;
    if (m === 1) return { lambdas: [Math.SQRT1_2], exact: true };
    let sumR = 0; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) sumR += R[i][j];
    const lam = new Array(m).fill(Math.sqrt(Math.max(0, sumR / (m * (m - 1)))));
    if (m > 2) {
      for (let it = 0; it < 500; it++) {
        let moved = 0;
        for (let i = 0; i < m; i++) {
          let num = 0, den = 0;
          for (let j = 0; j < m; j++) if (j !== i) { num += R[i][j] * lam[j]; den += lam[j] * lam[j]; }
          const next = den > 0 ? Math.min(0.999999, Math.max(0, num / den)) : 0;
          moved = Math.max(moved, Math.abs(next - lam[i])); lam[i] = next;
        }
        if (moved < 1e-13) break;
      }
    }
    let worst = 0;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) worst = Math.max(worst, Math.abs(R[i][j] - lam[i] * lam[j]));
    return { lambdas: lam, exact: worst < 1e-8 };
  }

  // opts.control (with method 'dunnett', or opts.family === 'control') restricts each
  // family to comparisons against one level: a column-group index for colsWithinRow /
  // colMeans, a row index for rowsWithinCol / rowMeans, or a row-major cell index
  // (row * columns + column) for 'cells'.
  // opts.families applies to the two within directions: 'each' makes every row (or
  // column group) its own family, 'all' pools them into one. Left out, the p-value
  // corrections pool (what older versions did). Tukey and Dunnett are defined for one
  // set of means, so they always take one family per row or column group.
  // A model without an interaction term has no simple effects: only the two main-effect
  // directions exist, computed from the model's estimated marginal means. The other
  // directions are answered with the matching main effect.
  function twoWayPosthoc(model, method = 'sidak', direction = 'colsWithinRow', opts = {}) {
    const { cellMeans, cellN, colNames, rowNames, residual, a, b } = model;
    const msE = residual.ms, dfE = residual.df;
    const comps = [];
    const vsControl = method === 'dunnett' || opts.family === 'control';
    let control = opts.control != null ? +opts.control : 0;
    const requested = direction;
    if (!model.interaction) {
      if (direction === 'cells') control %= b;
      direction = direction === 'rowsWithinCol' || direction === 'rowMeans' ? 'rowMeans' : 'colMeans';
    }
    const within = direction === 'colsWithinRow' || direction === 'rowsWithinCol';
    const perBlock = within && (method === 'tukey' || method === 'dunnett' || opts.families === 'each');
    // Pairs among `count` levels: every pair, or each level against the control.
    const levelPairs = (count) => {
      const pairs = [];
      if (!vsControl) { for (let x = 0; x < count; x++) for (let y = x + 1; y < count; y++) pairs.push([x, y]); }
      else for (let x = 0; x < count; x++) if (x !== control) pairs.push([x, control]);
      return pairs;
    };
    // cellA/cellB are the [row, col] indices of the two cells being compared, when the
    // comparison is between individual cells (simple effects / cell-vs-cell). They let the
    // grouped-bar figure locate the exact bars to bracket. Marginal-mean comparisons
    // (main effects) leave them undefined — no single bar represents a marginal mean.
    // va/vb are the variance factors of the two means and vab their covariance factor
    // (se² = msE·(va + vb − 2·vab)); means of different cells are independent.
    const add = (block, an, bn, diff, va, vb, groups, cellA, cellB, vab = 0) => {
      const se = Math.sqrt(msE * (va + vb - 2 * vab));
      if (!(se > 0) || !isFinite(diff)) return null;
      const c = { within: block, a: an, b: bn, diff, se, t: diff / se, groups, cellA, cellB, va, vb, vab };
      comps.push(c);
      return c;
    };
    // Estimated marginal mean over a set of cells (equal weight per present cell)
    // and the variance of that mean from the pooled error MS. Cells are independent,
    // so Var(marginal_j − marginal_k) = Var(marginal_j) + Var(marginal_k).
    const marginal = (idxs) => {
      let sum = 0, varr = 0, cnt = 0;
      for (const [i, j] of idxs) { if (!cellN[i][j]) continue; sum += cellMeans[i][j]; varr += 1 / cellN[i][j]; cnt++; }
      return cnt ? { mean: sum / cnt, varr: varr / (cnt * cnt) } : null;
    };
    // Covariance factor between two comparisons of one Dunnett family; null means
    // independent means sharing a control.
    let familyCov = null;
    if (!model.interaction) {
      const side = model.marginal && (direction === 'colMeans' ? model.marginal.col : model.marginal.row);
      const names = direction === 'colMeans' ? colNames : rowNames;
      if (side) {
        const V = side.cov;
        for (const [j, k] of levelPairs(names.length)) {
          const c = add('—', names[j], names[k], side.means[j] - side.means[k], V[j][j], V[k][k], names.length, undefined, undefined, V[j][k]);
          if (c) { c.lj = j; c.lk = k; }
        }
        familyCov = (x, y) => V[x.lj][y.lj] - V[x.lj][y.lk] - V[x.lk][y.lj] + V[x.lk][y.lk];
      }
    } else if (direction === 'colsWithinRow') {
      for (let i = 0; i < a; i++) for (const [j, k] of levelPairs(b)) {
        if (!cellN[i][j] || !cellN[i][k]) continue;
        const diff = cellMeans[i][j] - cellMeans[i][k];
        add(rowNames[i], colNames[j], colNames[k], diff, 1 / cellN[i][j], 1 / cellN[i][k], b, [i, j], [i, k]);
      }
    } else if (direction === 'rowsWithinCol') {
      for (let j = 0; j < b; j++) for (const [i, k] of levelPairs(a)) {
        if (!cellN[i][j] || !cellN[k][j]) continue;
        const diff = cellMeans[i][j] - cellMeans[k][j];
        add(colNames[j], rowNames[i], rowNames[k], diff, 1 / cellN[i][j], 1 / cellN[k][j], a, [i, j], [k, j]);
      }
    } else if (direction === 'colMeans') {
      const M = [];
      for (let j = 0; j < b; j++) M[j] = marginal(Array.from({ length: a }, (_, i) => [i, j]));
      for (const [j, k] of levelPairs(b)) {
        if (!M[j] || !M[k]) continue;
        add('—', colNames[j], colNames[k], M[j].mean - M[k].mean, M[j].varr, M[k].varr, b);
      }
    } else if (direction === 'rowMeans') {
      const M = [];
      for (let i = 0; i < a; i++) M[i] = marginal(Array.from({ length: b }, (_, j) => [i, j]));
      for (const [i, k] of levelPairs(a)) {
        if (!M[i] || !M[k]) continue;
        add('—', rowNames[i], rowNames[k], M[i].mean - M[k].mean, M[i].varr, M[k].varr, a);
      }
    } else { // 'cells' — every cell mean vs every other cell mean
      const flat = [];
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) if (cellN[i][j]) flat.push([i, j]);
      const g = flat.length;
      const cellPairs = [];
      if (!vsControl) { for (let x = 0; x < flat.length; x++) for (let y = x + 1; y < flat.length; y++) cellPairs.push([x, y]); }
      else {
        const y = flat.findIndex(([i, j]) => i * b + j === control);
        if (y >= 0) for (let x = 0; x < flat.length; x++) if (x !== y) cellPairs.push([x, y]);
      }
      for (const [x, y] of cellPairs) {
        const [i1, j1] = flat[x], [i2, j2] = flat[y];
        const diff = cellMeans[i1][j1] - cellMeans[i2][j2];
        add('—', rowNames[i1] + ' · ' + colNames[j1], rowNames[i2] + ' · ' + colNames[j2], diff, 1 / cellN[i1][j1], 1 / cellN[i2][j2], g, [i1, j1], [i2, j2]);
      }
    }
    // Families: one per row or column group, or everything together.
    const blocks = new Map();
    comps.forEach((c) => { const key = perBlock ? c.within : ''; if (!blocks.has(key)) blocks.set(key, []); blocks.get(key).push(c); });
    let approximate = false;
    comps.forEach((c) => { c.pRaw = C.studentTtwoTailP(c.t, dfE); });
    if (method === 'tukey') comps.forEach((c) => { c.q = Math.abs(c.diff) / (c.se / Math.SQRT2); c.p = C.tukeyP(c.q, c.groups, dfE); c.sig = c.p < 0.05; });
    else if (method === 'dunnett') {
      // corr(T_i, T_j) = λ_i λ_j. For independent means sharing a control,
      // λ = sqrt(vb / (va + vb)) exactly.
      blocks.forEach((block) => {
        let lambdas;
        if (familyCov) {
          const sds = block.map((c) => Math.sqrt(c.va + c.vb - 2 * c.vab));
          const fit = oneFactorLambdas(block.map((x, i) => block.map((y, j) => (i === j ? 1 : familyCov(x, y) / (sds[i] * sds[j])))));
          lambdas = fit.lambdas; if (!fit.exact) approximate = true;
        } else lambdas = block.map((c) => Math.sqrt(c.vb / (c.va + c.vb)));
        block.forEach((c) => { c.p = dunnettP(Math.abs(c.t), block.length, dfE, lambdas); c.sig = c.p < 0.05; });
      });
    } else {
      // Unrecognized methods keep the historical Šídák default.
      blocks.forEach((block) => {
        const adj = adjustP(block.map((c) => c.pRaw), method, 'sidak');
        block.forEach((c, idx) => { c.p = adj[idx]; c.sig = c.p < 0.05; });
      });
    }
    comps.forEach((c) => { delete c.va; delete c.vb; delete c.vab; delete c.lj; delete c.lk; });
    return {
      method, direction, requestedDirection: requested, control, comparisons: comps, dfError: dfE,
      families: within ? (perBlock ? 'each' : 'all') : null, familyCount: blocks.size, approximate,
    };
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
    oneWayANOVA, brownForsythe, bartlett, linearTrend, posthoc, holmSidak, adjustP, dunnettP, smmP, signedRankExactTails, rankSumExactTails, spearmanExactTails, kruskalExactP, friedmanExactP,
    rmANOVA, rmPosthoc, friedman, friedmanDunn,
    mannWhitney, mannWhitneyCounts, wilcoxonSignedRank,
    kruskalWallis, dunnPosthoc,
    pearson, spearman, linearRegression,
    twoWayANOVA, twoWayPosthoc, scheirerRayHare,
    // Shared with stats-mixed.js, which builds its comparison families the same way.
    _internal: { finishComparisons, comparisonFamily, labelComparisons, oneFactorLambdas, ADJUSTMENTS },
  };
})(typeof StatCore !== 'undefined' ? StatCore : require('./stats-core.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = StatTests;
