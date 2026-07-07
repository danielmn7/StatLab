const T = require('../js/stats-tests.js');
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

// --- Scheirer-Ray-Hare: MS_total of ranks == N(N+1)/12 when tie-free ---
const srh = T.scheirerRayHare([[[1, 2, 3], [10, 11, 12]], [[4, 5, 6], [20, 21, 22]]], ['R1', 'R2'], ['C1', 'C2']);
chk('SRH msTotal identity (tie-free)', srh.msTotal, srh.N * (srh.N + 1) / 12, 1e-9);
chk('SRH H >= 0', Math.min(...srh.effects.map((e) => e.H)) >= 0 ? 1 : 0, 1, 1e-9);

// --- custom comparisons: single pair Šídák == raw two-tailed t p ---
const avc = T.oneWayANOVA([{ name: 'A', values: [22, 24, 21, 25, 23] }, { name: 'B', values: [30, 28, 31, 27, 29] }, { name: 'C', values: [26, 25, 27, 24, 28] }]);
const cust = T.posthoc(avc, 'custom', { pairs: [[0, 2]], correction: 'sidak' });
chk('custom single-pair == raw', cust.comparisons[0].p, cust.comparisons[0].pRaw, 1e-12);
chk('custom returns only selected', cust.comparisons.length, 1, 1e-12);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
