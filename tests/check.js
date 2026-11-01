const T = require('../js/stats-tests.js');
const C = require('../js/stats-core.js');
const N = require('../js/stats-normality.js');
const { isDeepStrictEqual } = require('util');
const oracle = JSON.parse(require('child_process').execSync('python tests/oracle.py').toString());

const A = [5.1, 4.9, 6.2, 5.7, 5.5, 6.0, 5.8];
const B = [6.1, 6.3, 5.9, 6.8, 6.5, 7.0, 6.2];
const P1 = [120, 132, 125, 140, 128, 135, 122, 130];
const P2 = [115, 128, 120, 138, 122, 130, 119, 127];
const G1 = [22, 24, 21, 25, 23], G2 = [30, 28, 31, 27, 29], G3 = [26, 25, 27, 24, 28];
const X = [1, 2, 3, 4, 5, 6, 7, 8];
const Y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1];

let pass = 0, fail = 0;
function chk(name, got, exp, tol = 1e-6) {
  const ok = Math.abs(got - exp) <= tol * (1 + Math.abs(exp));
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name.padEnd(30), `got=${(+got).toPrecision(8)} exp=${(+exp).toPrecision(8)}`);
  ok ? pass++ : fail++;
}
function chkSame(name, got, exp) {
  const ok = isDeepStrictEqual(got, exp);
  if (!ok) console.error(name, { got, exp });
  chk(name, ok ? 1 : 0, 1, 0);
}
// Relative error matters for tiny tails: an absolute tolerance would let a
// catastrophic-cancellation result of zero pass against a nonzero probability.
function chkP(name, got, exp, tol = 1e-10) {
  const scale = exp === 0 ? 1 : Math.abs(exp);
  chk(name, got / scale, exp / scale, tol);
  chkSame(name + ' bounded', Number.isFinite(got) && got >= 0 && got <= 1, true);
}

const pt = T.unpairedT(A, B, false);
chk('pooled t stat', pt.t, oracle.pooled_t[0]);
chk('pooled t df', pt.df, oracle.pooled_t[1]);
const wt = T.unpairedT(A, B, true);
chk('welch t stat', wt.t, oracle.welch_t[0]);
chk('welch t df', wt.df, oracle.welch_t[1]);
const pr = T.pairedT(P1, P2);
chk('paired t stat', pr.t, oracle.paired_t[0]);
const av = T.oneWayANOVA([{ name: 'G1', values: G1 }, { name: 'G2', values: G2 }, { name: 'G3', values: G3 }]);
chk('anova F', av.F, oracle.anova[0]);
chk('anova SSB', av.ssB, oracle.anova[3]);
chk('anova SSW', av.ssW, oracle.anova[4]);
const mw = T.mannWhitney(A, B);
chk('mann-whitney U', mw.U, oracle.mann_whitney[0]);
const wsr = T.wilcoxonSignedRank(P1, P2);
chk('wilcoxon W', wsr.W, oracle.wilcoxon[0]);
const kw = T.kruskalWallis([{ name: 'G1', values: G1 }, { name: 'G2', values: G2 }, { name: 'G3', values: G3 }]);
chk('kruskal H (tie-corr)', kw.H, oracle.kruskal[0]);
const pe = T.pearson(X, Y);
chk('pearson r', pe.r, oracle.pearson);
const sp = T.spearman(X, Y);
chk('spearman rho', sp.rho, oracle.spearman);
const rg = T.linearRegression(X, Y);
chk('regression slope', rg.slope, oracle.regression[0]);
chk('regression intercept', rg.intercept, oracle.regression[1]);
chk('regression r2', rg.r2, oracle.regression[2]);
chk('describe mean', T.describe(A).mean, oracle.meanA);
chk('describe sd', T.describe(A).sd, oracle.sdA);

// --- Canonical published p-values (independent anchors) ---
// Mann-Whitney exact small sample: a=[1,2,3,4], b=[5,6,7,8] -> U=0, exact two-sided p=2*1/70=0.02857
const mw2 = T.mannWhitney([1, 2, 3, 4], [5, 6, 7, 8]);
chk('MW exact p (U=0,n=4,4)', mw2.p, 2 / 70, 1e-9);
// Hollander-Wolfe style: verify counts sum to C(8,4)=70
const counts = T.mannWhitneyCounts(4, 4);
chk('MW counts total', counts.reduce((s, v) => s + v, 0), 70, 1e-9);

// --- Two-way ANOVA: balanced 2x2 n=2, hand-verified ---
const tw = T.twoWayANOVA([[[1, 2], [3, 4]], [[5, 6], [9, 10]]], ['R1', 'R2'], ['C1', 'C2']);
chk('2way SS rows', tw.effects[0].ss, 50, 1e-9);
chk('2way SS cols', tw.effects[1].ss, 18, 1e-9);
chk('2way SS interaction', tw.effects[2].ss, 2, 1e-9);
chk('2way F rows', tw.effects[0].F, 100, 1e-9);
chk('2way F interaction', tw.effects[2].F, 4, 1e-9);
// Type III order-invariance under transpose (unbalanced)
const cu = [[[10, 12, 11], [20, 22]], [[14, 15, 13, 16], [24, 26, 25]]];
const ct = [[cu[0][0], cu[1][0]], [cu[0][1], cu[1][1]]];
const mu = T.twoWayANOVA(cu, ['P', 'Q'], ['W', 'K']);
const mt = T.twoWayANOVA(ct, ['W', 'K'], ['P', 'Q']);
chk('2way Type III order-invariant', mu.effects[0].F, mt.effects[1].F, 1e-9);

// --- Two-way ANOVA post-hoc directions ---
// Balanced 2x2, n=2: F_col=36, F_row=100 (msE=0.5). For a factor with exactly 2
// levels, the marginal-means comparison must satisfy t^2 == F (independent paths).
const twm = T.twoWayANOVA([[[1, 2], [3, 4]], [[5, 6], [9, 10]]], ['R1', 'R2'], ['C1', 'C2']);
const cmean = T.twoWayPosthoc(twm, 'sidak', 'colMeans');
chk('2way colMeans count (2 cols)', cmean.comparisons.length, 1, 1e-12);
chk('2way colMeans t^2 == F_col', cmean.comparisons[0].t ** 2, twm.effects[1].F, 1e-9);
const rmean = T.twoWayPosthoc(twm, 'sidak', 'rowMeans');
chk('2way rowMeans t^2 == F_row', rmean.comparisons[0].t ** 2, twm.effects[0].F, 1e-9);
const cellcmp = T.twoWayPosthoc(twm, 'tukey', 'cells');
chk('2way cells count == C(4,2)', cellcmp.comparisons.length, 6, 1e-12);
// Simple-effect within-row raw t matches direct pooled-error t (C1 vs C2 in R1)
const cwr = T.twoWayPosthoc(twm, 'bonferroni', 'colsWithinRow');
chk('2way simple-effect count', cwr.comparisons.length, 2, 1e-12);
chk('2way within-row raw t (R1)', cwr.comparisons[0].t, (1.5 - 3.5) / Math.sqrt(0.5 * (1 / 2 + 1 / 2)), 1e-9);
// 2x3 balanced: colMeans compares 3 marginal means -> C(3,2)=3 comparisons
const tw3 = T.twoWayANOVA([[[1, 2], [3, 4], [5, 6]], [[2, 3], [4, 5], [7, 8]]], ['R1', 'R2'], ['C1', 'C2', 'C3']);
chk('2way colMeans count (3 cols)', T.twoWayPosthoc(tw3, 'sidak', 'colMeans').comparisons.length, 3, 1e-12);
// Single Bonferroni comparison (rowMeans, 2 rows) == raw two-tailed p
chk('2way rowMeans single == raw', T.twoWayPosthoc(tw3, 'bonferroni', 'rowMeans').comparisons[0].p,
  T.twoWayPosthoc(tw3, 'bonferroni', 'rowMeans').comparisons[0].pRaw, 1e-12);

// --- Scheirer-Ray-Hare: MS_total of ranks == N(N+1)/12 when tie-free ---
const srh = T.scheirerRayHare([[[1, 2, 3], [10, 11, 12]], [[4, 5, 6], [20, 21, 22]]], ['R1', 'R2'], ['C1', 'C2']);
chk('SRH msTotal identity (tie-free)', srh.msTotal, srh.N * (srh.N + 1) / 12, 1e-9);
chk('SRH H >= 0', Math.min(...srh.effects.map((e) => e.H)) >= 0 ? 1 : 0, 1, 1e-9);

// --- custom comparisons: single pair Šídák == raw two-tailed t p ---
const avc = T.oneWayANOVA([{ name: 'A', values: [22, 24, 21, 25, 23] }, { name: 'B', values: [30, 28, 31, 27, 29] }, { name: 'C', values: [26, 25, 27, 24, 28] }]);
const cust = T.posthoc(avc, 'custom', { pairs: [[0, 2]], correction: 'sidak' });
chk('custom single-pair == raw', cust.comparisons[0].p, cust.comparisons[0].pRaw, 1e-12);
chk('custom returns only selected', cust.comparisons.length, 1, 1e-12);

// --- One-tailed alternatives: independent analytic and numerical anchors ---
const alternatives = ['two-sided', 'greater', 'less'];
// df=1 is Cauchy, with F(t)=1/2+atan(t)/pi, independent of the beta helper.
for (const t of [-8, -1, -0.25, 0, 0.25, 1, 8]) {
  const cdf = 0.5 + Math.atan(t) / Math.PI;
  chkP(`t(1) ${t} less`, C.studentTP(t, 1, 'less'), cdf);
  chkP(`t(1) ${t} greater`, C.studentTP(t, 1, 'greater'), 1 - cdf);
  chkP(`t(1) ${t} two-sided`, C.studentTP(t, 1), 2 * Math.min(cdf, 1 - cdf));
  chkSame(`t(1) ${t} default`, C.studentTP(t, 1), C.studentTtwoTailP(t, 1));
}
const tinyCauchyTail = Math.atan(1e-20) / Math.PI;
chkP('large +t small upper tail', C.studentTP(1e20, 1, 'greater'), tinyCauchyTail);
chkP('large -t small lower tail', C.studentTP(-1e20, 1, 'less'), tinyCauchyTail);
chkP('large +t opposite tail', C.studentTP(1e20, 1, 'less'), 1 - tinyCauchyTail);
chkP('large -t opposite tail', C.studentTP(-1e20, 1, 'greater'), 1 - tinyCauchyTail);
for (const sign of [-1, 1]) {
  for (const alternative of alternatives) {
    const expected = alternative === 'two-sided' || alternative === (sign > 0 ? 'greater' : 'less') ? 0 : 1;
    chkP(`infinite t ${sign} ${alternative}`, C.studentTP(sign * Infinity, 3, alternative), expected);
  }
}
for (const alternative of alternatives) {
  chkSame(`NaN t ${alternative}`, Number.isNaN(C.studentTP(NaN, 3, alternative)), true);
  chkSame(`invalid df ${alternative}`, Number.isNaN(C.studentTP(Infinity, 0, alternative)), true);
}
// Values computed independently using Python's standard-library math.erfc.
for (const [z, expected] of [[0, 0.5], [0.5, 0.691462461274013], [1, 0.8413447460685429],
  [2, 0.9772498680518208], [-8, 6.22096057427182e-16]]) {
  chkP(`normalCDF(${z})`, C.normalCDF(z), expected);
}

// Every t-based public test is exercised with both signs and both directions.
// The pooled t example has df=2, whose upper tail is (1-t/sqrt(t*t+2))/2.
// The correlations/regression have r=1/2, t=1/sqrt(3), df=1, hence upper tail=1/3.
const analyticCases = [
  { name: 'one-sample', run: (alt, sign) => T.oneSampleT([10, 10 + 2 * sign], 10, alt), t: 1, df: 1, upper: 0.25 },
  { name: 'pooled', run: (alt, sign) => T.unpairedT([0, 2 * sign], [0, 0], false, alt), t: 1, df: 2, upper: (1 - 1 / Math.sqrt(3)) / 2 },
  { name: 'Welch', run: (alt, sign) => T.unpairedT([0, 2 * sign], [0, 0], true, alt), t: 1, df: 1, upper: 0.25 },
  { name: 'paired', run: (alt, sign) => T.pairedT([5, 5 + 2 * sign], [5, 5], alt), t: 1, df: 1, upper: 0.25 },
  { name: 'Pearson', run: (alt, sign) => T.pearson([-1, 0, 1], [-sign, sign, 0], alt), t: 1 / Math.sqrt(3), df: 1, upper: 1 / 3 },
  { name: 'regression', run: (alt, sign) => T.linearRegression([-1, 0, 1], [-sign, sign, 0], alt), t: 1 / Math.sqrt(3), df: 1, upper: 1 / 3, pKey: 'pSlope', tKey: 'tSlope' },
];
for (const example of analyticCases) {
  for (const sign of [-1, 1]) {
    const baseline = example.run(undefined, sign);
    chk(`${example.name} signed t ${sign}`, baseline[example.tKey || 't'], sign * example.t, 1e-12);
    chk(`${example.name} df ${sign}`, baseline.df, example.df, 1e-12);
    for (const alternative of alternatives) {
      const expected = alternative === 'two-sided' ? 2 * example.upper
        : alternative === (sign > 0 ? 'greater' : 'less') ? example.upper : 1 - example.upper;
      const result = example.run(alternative, sign);
      chkP(`${example.name} ${sign} ${alternative}`, result[example.pKey || 'p'], expected);
      chkSame(`${example.name} metadata ${sign} ${alternative}`, result.alternative, alternative);
    }
  }
}

// Freeze legacy noncentral p-values, and prove alternatives leave every other
// field (statistics, effect sizes, two-sided 95% CIs and regression internals)
// unchanged. Rank-test z values are intentionally tail-specific.
const compatibilityCases = [
  { name: 'one-sample', run: (alt) => T.oneSampleT(A, 5, alt), p: 0.01477631258792865 },
  { name: 'pooled', run: (alt) => T.unpairedT(A, B, false, alt), p: 0.004681604753164139 },
  { name: 'Welch', run: (alt) => T.unpairedT(A, B, true, alt), p: 0.0048922803745057595 },
  { name: 'paired', run: (alt) => T.pairedT(P1, P2, alt), p: 0.000057153950148406574 },
  { name: 'MW', run: (alt) => T.mannWhitney(A, B, alt), p: 0.008734437585388832, rank: true },
  { name: 'Wilcoxon', run: (alt) => T.wilcoxonSignedRank(P1, P2, alt), p: 0.013676686898827173, rank: true },
  { name: 'Pearson', run: (alt) => T.pearson(X, Y, alt), p: 4.888933612558003e-10 },
  // Exact: perfect agreement is 1 of the 8! equally likely rankings, so two-sided p = 2/8!.
  { name: 'Spearman', run: (alt) => T.spearman(X, Y, alt), p: 2 / 40320 },
  { name: 'regression', run: (alt) => T.linearRegression(X, Y, alt), p: 4.888933612555067e-10, pKey: 'pSlope' },
];
function invariantFields(result, example) {
  const fields = { ...result };
  delete fields.alternative;
  delete fields[example.pKey || 'p'];
  if (example.rank) delete fields.z;
  return fields;
}
for (const example of compatibilityCases) {
  const baseline = example.run();
  chkSame(`${example.name} default metadata`, baseline.alternative, 'two-sided');
  chkSame(`${example.name} explicit default`, baseline, example.run('two-sided'));
  chkP(`${example.name} legacy p`, baseline[example.pKey || 'p'], example.p);
  for (const alternative of ['greater', 'less']) {
    const result = example.run(alternative);
    chkSame(`${example.name} unchanged ${alternative}`, invariantFields(result, example), invariantFields(baseline, example));
    chkSame(`${example.name} metadata ${alternative}`, result.alternative, alternative);
  }
}
chkSame('one-sample omitted mu0', T.oneSampleT([0, 2]), T.oneSampleT([0, 2], 0, 'two-sided'));
chkSame('unpaired omitted Welch flag', T.unpairedT(A, B), T.unpairedT(A, B, false, 'two-sided'));

// Mann-Whitney exact: independent enumeration of rank allocations, not the
// engine's generating-polynomial algorithm. Exhaust every allocation for 2x2
// and unequal 2x3 groups, including central values and both extreme boundaries.
function combinations(values, k, start = 0, prefix = []) {
  if (k === 0) return [prefix];
  const result = [];
  for (let i = start; i <= values.length - k; i++) {
    result.push(...combinations(values, k - 1, i + 1, prefix.concat(values[i])));
  }
  return result;
}
chkSame('MW 2x2 hand distribution', Array.from(T.mannWhitneyCounts(2, 2)), [1, 1, 2, 1, 1]);
for (const [n1, n2] of [[2, 2], [2, 3]]) {
  const values = Array.from({ length: n1 + n2 }, (_, i) => i + 1);
  const allocations = combinations(values, n1);
  const us = allocations.map((a) => a.reduce((s, v) => s + v, 0) - n1 * (n1 + 1) / 2);
  const enumeratedCounts = Array.from({ length: n1 * n2 + 1 }, (_, u) => us.filter((v) => v === u).length);
  chkSame(`MW ${n1}x${n2} counts enumerated`, Array.from(T.mannWhitneyCounts(n1, n2)), enumeratedCounts);
  for (const [i, a] of allocations.entries()) {
    const b = values.filter((v) => !a.includes(v));
    const u = us[i];
    const lower = us.filter((v) => v <= u).length / us.length;
    const upper = us.filter((v) => v >= u).length / us.length;
    const mass = us.filter((v) => v === u).length / us.length;
    for (const [alternative, expected] of [['less', lower], ['greater', upper], ['two-sided', Math.min(1, 2 * Math.min(lower, upper))]]) {
      const result = T.mannWhitney(a, b, alternative);
      chkP(`MW exact ${n1}x${n2} #${i} ${alternative}`, result.p, expected);
      chkSame(`MW exact ${n1}x${n2} #${i} U1/method`, [result.U1, result.method], [u, 'exact']);
      const opposite = alternative === 'two-sided' ? alternative : alternative === 'less' ? 'greater' : 'less';
      chkP(`MW swapped ${n1}x${n2} #${i} ${alternative}`, T.mannWhitney(b, a, opposite).p, expected);
    }
    chk(`MW inclusive mass ${n1}x${n2} #${i}`, T.mannWhitney(a, b, 'less').p + T.mannWhitney(a, b, 'greater').p, 1 + mass, 1e-12);
    chkSame(`MW exact default ${n1}x${n2} #${i}`, T.mannWhitney(a, b), T.mannWhitney(a, b, 'two-sided'));
  }
}
chkP('MW separated 4x4 less', T.mannWhitney([1, 2, 3, 4], [5, 6, 7, 8], 'less').p, 1 / 70);
chkP('MW separated 4x4 greater', T.mannWhitney([1, 2, 3, 4], [5, 6, 7, 8], 'greater').p, 1);

// Larger exact distributions expose generating-polynomial roundoff: upper
// coefficients must retain symmetry/nonnegativity, even above 2^53 counts.
// These extreme-tail anchors are 1 / binomial(n1+n2,n1), computed with Python
// math.comb, not the production count recurrence.
for (const [n, expected] of [[50, 9.911653021418339e-30], [100, 1.1043803465997514e-59], [200, 9.713217247611181e-120]]) {
  const a = Array.from({ length: n }, (_, i) => i + 1), b = a.map((v) => v + n);
  const distribution = Array.from(T.mannWhitneyCounts(n, n));
  chkSame(`MW ${n}x${n} count symmetry`, distribution, distribution.slice().reverse());
  chkSame(`MW ${n}x${n} counts nonnegative`, distribution.every((v) => Number.isFinite(v) && v >= 0), true);
  chkP(`MW ${n}x${n} extreme lower`, T.mannWhitney(a, b, 'less').p, expected);
  chkP(`MW ${n}x${n} extreme upper`, T.mannWhitney(b, a, 'greater').p, expected);
  chkP(`MW ${n}x${n} extreme two-sided`, T.mannWhitney(a, b).p, 2 * expected);
  chkP(`MW ${n}x${n} opposite`, T.mannWhitney(a, b, 'greater').p, 1);
}
// Iteration order must not change a large unbalanced exact distribution.
chkSame('MW large unequal count order', Array.from(T.mannWhitneyCounts(100, 399)), Array.from(T.mannWhitneyCounts(399, 100)));

// Normal rank tails: independent math.erfc constants, with directional
// continuity corrections (delta+.5 for less, delta-.5 for greater).
const tiedRankCases = [
  { name: 'MW ties', a: [1, 2], b: [2, 3], run: T.mannWhitney, delta: -1.5, variance: 1.5,
    lower: 0.20710808912126252, upper: 0.9487647825701253, method: 'normal approximation (tie-corrected)' },
  // Differences [-1,2,-2,-3,0]: drop the zero, use average tied ranks.
  { name: 'Wilcoxon ties/zero', a: [9, 12, 8, 7, 10], b: [10, 10, 10, 10, 10], run: T.wilcoxonSignedRank, delta: -2.5, variance: 7.375,
    lower: 0.2307254939166804, upper: 0.8653529316401316, method: 'normal approximation' },
];
for (const example of tiedRankCases) {
  for (const swap of [false, true]) {
    const a = swap ? example.b : example.a, b = swap ? example.a : example.b;
    const delta = swap ? -example.delta : example.delta;
    for (const alternative of alternatives) {
      const expected = alternative === 'two-sided' ? 2 * example.lower
        : alternative === (swap ? 'greater' : 'less') ? example.lower : example.upper;
      const result = example.run(a, b, alternative);
      const expectedZ = alternative === 'two-sided' ? (Math.abs(delta) - 0.5) / Math.sqrt(example.variance)
        : (delta + (alternative === 'less' ? 0.5 : -0.5)) / Math.sqrt(example.variance);
      chkP(`${example.name} swap=${swap} ${alternative}`, result.p, expected);
      chk(`${example.name} signed z ${swap} ${alternative}`, result.z, expectedZ, 1e-12);
      chkSame(`${example.name} method ${swap} ${alternative}`, result.method, example.method);
    }
  }
}
chkSame('Wilcoxon zero excluded/ranks', [T.wilcoxonSignedRank(tiedRankCases[1].a, tiedRankCases[1].b).n,
  T.wilcoxonSignedRank(tiedRankCases[1].a, tiedRankCases[1].b).Wpos], [4, 2.5]);

const centralRankCases = [
  { name: 'MW tied central', run: (alt) => T.mannWhitney([1, 2], [1, 2], alt), tail: 0.6674972289489854 },
  { name: 'Wilcoxon tied central', run: (alt) => T.wilcoxonSignedRank([1, 1, -2], [0, 0, 0], alt), tail: 0.6072526264408229 },
];
for (const example of centralRankCases) {
  for (const alternative of alternatives) {
    chkP(`${example.name} ${alternative}`, example.run(alternative).p, alternative === 'two-sided' ? 1 : example.tail);
  }
  chkSame(`${example.name} two-sided z`, example.run().z, 0);
}
for (const [name, run, upper] of [
  ['MW near central', (alt) => T.mannWhitney([1, 3], [2, 3], alt), 0.7928919108787374],
  ['Wilcoxon near central', (alt) => T.wilcoxonSignedRank([1, -2], [0, 0], alt), 0.8144533152386512],
]) {
  chkP(`${name} less`, run('less').p, 0.5);
  chkP(`${name} greater`, run('greater').p, upper);
  chkP(`${name} two-sided`, run().p, 1);
}

// Exceed the exact-method cutoff without ties; tails remain nonzero even when
// 1-normalCDF(z) would round to zero. Also test a large, central allocation.
const bigLow = Array.from({ length: 201 }, (_, i) => i + 1);
const bigHigh = bigLow.map((v) => v + 201);
for (const swap of [false, true]) {
  const a = swap ? bigHigh : bigLow, b = swap ? bigLow : bigHigh;
  const toward = swap ? 'greater' : 'less', away = swap ? 'less' : 'greater';
  chkP(`MW large toward ${swap}`, T.mannWhitney(a, b, toward).p, 1.1381000709865612e-67);
  chkP(`MW large away ${swap}`, T.mannWhitney(a, b, away).p, 1);
  chkP(`MW large two-sided ${swap}`, T.mannWhitney(a, b).p, 2 * 1.1381000709865612e-67);
  chkSame(`MW large method ${swap}`, T.mannWhitney(a, b).method, 'normal approximation');
}
const evenRanks = Array.from({ length: 201 }, (_, i) => 2 * (i + 1));
const oddRanks = Array.from({ length: 202 }, (_, i) => 2 * i + 1);
for (const alternative of alternatives) {
  chkP(`MW large central ${alternative}`, T.mannWhitney(evenRanks, oddRanks, alternative).p,
    alternative === 'two-sided' ? 1 : 0.5001706107075066);
}
const positiveDiffs = Array.from({ length: 100 }, (_, i) => i + 1), zeroReference = positiveDiffs.map(() => 0);
chkP('Wilcoxon large upper', T.wilcoxonSignedRank(positiveDiffs, zeroReference, 'greater').p, 1.9779558044497787e-18);
chkP('Wilcoxon large lower', T.wilcoxonSignedRank(zeroReference, positiveDiffs, 'less').p, 1.9779558044497787e-18);
chkP('Wilcoxon large opposite', T.wilcoxonSignedRank(positiveDiffs, zeroReference, 'less').p, 1);
chkP('Wilcoxon large two-sided', T.wilcoxonSignedRank(positiveDiffs, zeroReference).p, 2 * 1.9779558044497787e-18);

// t=0/r=0/slope=0: one-sided p=.5, two-sided p=1 for all t-based APIs.
const zeroCases = [
  ['one-sample', (alt) => T.oneSampleT([-1, 1], 0, alt)],
  ['pooled', (alt) => T.unpairedT([-1, 1], [-1, 1], false, alt)],
  ['Welch', (alt) => T.unpairedT([-1, 1], [-1, 1], true, alt)],
  ['paired', (alt) => T.pairedT([-1, 1], [0, 0], alt)],
  ['Pearson', (alt) => T.pearson([-1, 0, 1], [1, -2, 1], alt)],
  ['regression', (alt) => T.linearRegression([-1, 0, 1], [1, -2, 1], alt), 'pSlope'],
];
for (const [name, run, pKey = 'p'] of zeroCases) {
  for (const alternative of alternatives) chkP(`${name} zero ${alternative}`, run(alternative)[pKey], alternative === 'two-sided' ? 1 : 0.5);
}

// All ties/zero differences must never be falsely significant. Empty or
// insufficient usable data instead yields an undefined (NaN) p-value.
for (const alternative of alternatives) {
  chkP(`MW all tied ${alternative}`, T.mannWhitney([7, 7], [7, 7, 7], alternative).p, 1);
  chkP(`Wilcoxon all zero ${alternative}`, T.wilcoxonSignedRank([4, 5, 6], [4, 5, 6], alternative).p, 1);
}
const insufficientCases = [
  ['one-sample', (alt) => T.oneSampleT([null, '', 'bad', 1], 0, alt)],
  ['one-sample empty', (alt) => T.oneSampleT([], 0, alt)],
  ['pooled', (alt) => T.unpairedT([1], [0, 2], false, alt)],
  ['Welch', (alt) => T.unpairedT([1], [0, 2], true, alt)],
  ['paired', (alt) => T.pairedT([null, 1, ''], [0, 0, 0], alt)],
  ['MW', (alt) => T.mannWhitney([null, '', 'bad'], [1, 2], alt)],
  ['MW both empty', (alt) => T.mannWhitney([], [], alt)],
  ['Wilcoxon', (alt) => T.wilcoxonSignedRank([null, 'bad', ''], [0, 0, 0], alt)],
  ['Wilcoxon both empty', (alt) => T.wilcoxonSignedRank([], [], alt)],
  ['Pearson', (alt) => T.pearson([1, 2], [2, 4], alt)],
  ['Spearman', (alt) => T.spearman([1, 2], [2, 4], alt)],
  ['regression', (alt) => T.linearRegression([1, 2], [2, 4], alt), 'pSlope'],
];
for (const [name, run, pKey = 'p'] of insufficientCases) {
  for (const alternative of alternatives) chkSame(`${name} insufficient ${alternative}`, Number.isNaN(run(alternative)[pKey]), true);
}

// Perfect signed relationships and infinite t give exact p-value boundaries.
const boundaryCases = [
  ['one-sample', (alt, sign) => T.oneSampleT([sign, sign], 0, alt)],
  ['pooled', (alt, sign) => T.unpairedT([sign, sign], [0, 0], false, alt)],
  ['paired', (alt, sign) => T.pairedT([sign, sign], [0, 0], alt)],
  ['Pearson', (alt, sign) => T.pearson([-1, 0, 1], [-sign, 0, sign], alt)],
  ['regression', (alt, sign) => T.linearRegression([-1, 0, 1], [-sign, 0, sign], alt), 'pSlope'],
];
for (const [name, run, pKey = 'p'] of boundaryCases) {
  for (const sign of [-1, 1]) {
    for (const alternative of alternatives) {
      const expected = alternative === 'two-sided' || alternative === (sign > 0 ? 'greater' : 'less') ? 0 : 1;
      chkSame(`${name} boundary ${sign} ${alternative}`, run(alternative, sign)[pKey], expected);
    }
  }
}

// Only exact documented tokens are accepted; never silently normalize or
// fall back to a two-sided hypothesis for an invalid alternative.
const invalidAlternatives = ['one-sided', 'Greater', 'less ', '', null, 0, {}];
for (const { name, run } of compatibilityCases.concat([{ name: 'Student-t helper', run: (alt) => C.studentTP(1, 3, alt) }])) {
  const rejected = invalidAlternatives.every((alternative) => {
    try { run(alternative); return false; } catch (error) { return error instanceof RangeError; }
  });
  chkSame(`${name} rejects invalid alternatives`, rejected, true);
}

// --- Spearman: exact permutation distribution (n <= 15), AS 89 Edgeworth (n <= 1290) ---
// Independent brute force: enumerate every y ranking (Heap's algorithm) and tally
// S = Σ(i − π(i))², not the engine's subset DP over T = Σi² − S/2.
function spearmanBruteForce(n) {
  const perm = Array.from({ length: n }, (_, i) => i + 1), c = new Array(n).fill(0);
  const freq = new Map(), example = new Map();
  const tally = () => {
    let S = 0;
    for (let i = 0; i < n; i++) S += (i + 1 - perm[i]) ** 2;
    freq.set(S, (freq.get(S) || 0) + 1);
    if (!example.has(S)) example.set(S, perm.slice());
  };
  tally();
  for (let i = 0; i < n;) {
    if (c[i] < i) { const j = i % 2 ? c[i] : 0; [perm[j], perm[i]] = [perm[i], perm[j]]; tally(); c[i]++; i = 0; } else { c[i] = 0; i++; }
  }
  return { freq, example };
}
for (let n = 3; n <= 9; n++) {
  const { freq, example } = spearmanBruteForce(n);
  const { lo, upper } = T.spearmanUpperCounts(n);
  const sumSq = n * (n + 1) * (2 * n + 1) / 6, dp = new Map();
  for (let i = 0; i + 1 < upper.length; i++) if (upper[i] > upper[i + 1]) dp.set(2 * (sumSq - lo - i), upper[i] - upper[i + 1]);
  chkSame(`Spearman n=${n} exact counts == brute force`, [...dp].sort((a, b) => a[0] - b[0]), [...freq].sort((a, b) => a[0] - b[0]));
  if (n > 6) continue;
  // Every observable S through the public API, all three hypotheses (includes rho = 0 and rho = ±1).
  const total = [...freq.values()].reduce((s, v) => s + v, 0), mean = (n ** 3 - n) / 6;
  for (const [S, y] of example) {
    const lower = [...freq].filter(([s]) => s <= S).reduce((t, [, k]) => t + k, 0) / total;
    const higher = [...freq].filter(([s]) => s >= S).reduce((t, [, k]) => t + k, 0) / total;
    const x = Array.from({ length: n }, (_, i) => i + 1);
    for (const [alternative, expected] of [['greater', lower], ['less', higher], ['two-sided', Math.min(1, 2 * (S > mean ? higher : lower))]]) {
      const r = T.spearman(x, y, alternative);
      chkP(`Spearman exact n=${n} S=${S} ${alternative}`, r.p, expected);
      chkSame(`Spearman exact n=${n} S=${S} method`, r.method, 'exact');
    }
  }
}
// n = 10..15 (beyond brute force): n! rankings, symmetry, the known null moments
// E(S) = (n³ − n)/6 and Var(S) = n²(n − 1)(n + 1)²/36, and the (n − 1) rankings with S = 2.
for (let n = 10; n <= 15; n++) {
  const { lo, upper } = T.spearmanUpperCounts(n);
  const dist = Array.from({ length: upper.length - 1 }, (_, i) => upper[i] - upper[i + 1]);
  let fact = 1; for (let k = 2; k <= n; k++) fact *= k;
  chkSame(`Spearman n=${n} counts total n!`, upper[0], fact);
  chkSame(`Spearman n=${n} counts symmetric`, dist, dist.slice().reverse());
  const sumSq = n * (n + 1) * (2 * n + 1) / 6;
  let m1 = 0, m2 = 0;
  dist.forEach((k, i) => { const S = 2 * (sumSq - lo - i); m1 += k * S; m2 += k * S * S; });
  m1 /= fact; m2 /= fact;
  chk(`Spearman n=${n} null mean of S`, m1, (n ** 3 - n) / 6, 1e-12);
  chk(`Spearman n=${n} null variance of S`, m2 - m1 * m1, n * n * (n - 1) * (n + 1) ** 2 / 36, 1e-9);
  chkSame(`Spearman n=${n} rankings with S = 2`, dist[dist.length - 2], n - 1);
}
// AS 89 Edgeworth series for 16 <= n <= 1290: expected values from an independent Python
// transcription of Best & Roberts (1975) with R cor.test's tail conventions.
const spearmanEdgeworthCases = [
  { y: [3, 1, 7, 2, 5, 10, 4, 12, 6, 9, 15, 8, 11, 16, 13, 14], p: { greater: 7.530862289340749e-05, less: 0.9999345798275693, 'two-sided': 0.00015061724578681497 } },
  { y: [5, 2, 9, 1, 12, 4, 7, 15, 3, 10, 18, 6, 13, 20, 8, 17, 11, 19, 14, 16], p: { greater: 0.0009410917550429199, less: 0.9990877172722221, 'two-sided': 0.0018821835100858398 } },
  { y: Array.from({ length: 50 }, (_, i) => ((7 * i) % 50) + 1), p: { greater: 0.3420427330903816, less: 0.6582017178869697, 'two-sided': 0.6840854661807632 } },
];
for (const { y, p } of spearmanEdgeworthCases) {
  const x = y.map((_, i) => i + 1);
  for (const alternative of alternatives) {
    const r = T.spearman(x, y, alternative);
    chkP(`Spearman Edgeworth n=${y.length} ${alternative}`, r.p, p[alternative], 1e-12);
    chkSame(`Spearman Edgeworth n=${y.length} method`, r.method, 'Edgeworth series approximation (AS 89)');
  }
}
// Hand-off accuracy at n = 16 (S = 300): exact 0.0133172 vs series 0.0133424.
chkP('Spearman Edgeworth n=16 near exact', T.spearman(Array.from({ length: 16 }, (_, i) => i + 1),
  [11, 2, 5, 3, 1, 7, 8, 6, 15, 9, 12, 16, 4, 13, 14, 10], 'greater').p, 0.013317224399878274, 2e-3);
// Ties keep the t approximation on midranks (SciPy spearmanr reference), as R does.
const spTies = T.spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 1, 4, 4, 6, 5, 8, 7, 10, 9]);
chkP('Spearman ties t approximation', spTies.p, 2.9285883237761156e-05, 1e-9);
chkSame('Spearman ties method', spTies.method, 't approximation (ties present)');
const bigX = Array.from({ length: 1291 }, (_, i) => i + 1), bigY = bigX.map((v) => (v * 7) % 1291 + 1);
chkSame('Spearman n > 1290 t approximation', [T.spearman(bigX, bigY).method, T.spearman(bigX, bigY).p], ['t approximation', T.pearson(bigX, bigY).p]);

// --- Dunnett: correlations from the group sizes, Corr = λ_i·λ_j, λ_i = √(n_i/(n_i + n_0)) ---
// Expected values: SciPy adaptive quadrature of the same one-dimensional integral (Dunnett 1955).
const lam = (ni, n0) => Math.sqrt(ni / (ni + n0));
for (const [name, d, lams, df, expected] of [
  ['control 20 vs 3 x 4, t=0.871', 0.8708382973717875, [lam(4, 20), lam(4, 20), lam(4, 20)], 28, 0.7618444819830196],
  ['control 20 vs 3 x 4, t=2.5', 2.5, [lam(4, 20), lam(4, 20), lam(4, 20)], 28, 0.05316526088612483],
  ['control 3 vs 2 x 60, t=2.2', 2.2, [lam(60, 3), lam(60, 3)], 120, 0.03874946182262129],
  ['control 6 vs 4/8/5, t=2.3', 2.3, [lam(4, 6), lam(8, 6), lam(5, 6)], 19, 0.08345971541309016],
]) chkP(`Dunnett ${name}`, T.dunnettP(d, lams, df), expected, 1e-9);
for (const l of [0.2, Math.SQRT1_2, 0.97]) chkP(`Dunnett one comparison == t test (λ=${l.toFixed(3)})`, T.dunnettP(2.5, [l], 15), C.studentTtwoTailP(2.5, 15), 1e-10);
chkSame('Dunnett count form == equal-λ array', T.dunnettP(2.5, 3, 20), T.dunnettP(2.5, [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2], 20));
const dunnettUnequal = T.posthoc(T.oneWayANOVA([[4.2, 5.1, 3.9, 4.8, 5.5, 4.4], [6.1, 5.8, 7.2, 6.6], [5.0, 5.3, 4.7, 5.9, 6.0, 5.2, 4.9, 5.6], [7.5, 6.9, 8.1, 7.7, 7.0]]
  .map((values, i) => ({ name: 'G' + i, values }))), 'dunnett', { control: 0 }).comparisons;
chkP('Dunnett posthoc with unequal n', dunnettUnequal[1].p, 0.0781418621497969, 1e-8);

// --- Anderson-Darling: upper tail via Φ(−z) and the A* >= 10 cap of R's nortest::ad.test ---
// Expected values: statsmodels normal_ad, and SciPy log_ndtr for the extreme-outlier statistic.
const adOrdinary = N.andersonDarling([2.1, 3.4, 1.9, 5.6, 4.4, 3.8, 2.7, 4.9, 3.1, 6.2, 2.5, 3.9]);
chk('AD ordinary A2', adOrdinary.A2, 0.19202590488213822, 1e-12);
chkP('AD ordinary p', adOrdinary.p, 0.8682710931413162, 1e-12);
chkP('AD skewed p', N.andersonDarling([0.3, 0.5, 0.6, 0.8, 0.9, 1.1, 1.2, 1.4, 1.6, 1.9, 2.2, 2.6, 3.1, 3.7, 4.4, 5.3, 6.4, 7.8, 9.6, 12.0]).p, 0.0021721286505866832, 1e-12);
const adBinary = N.andersonDarling(Array.from({ length: 2000 }, (_, i) => i % 2));
chk('AD 0/1 data A2', adBinary.A2, 359.1174372976775, 1e-12);
chkSame('AD 0/1 data p capped, not 1', adBinary.p, 3.7e-24);
const adOutlier = N.andersonDarling(Array.from({ length: 99 }, (_, i) => i / 10).concat([1e6]));
chk('AD extreme outlier A2 finite', adOutlier.A2, 38.23492803190365, 1e-12);
chkSame('AD extreme outlier p', adOutlier.p, 3.7e-24);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
