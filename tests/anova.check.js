// ANOVA family: omnibus variants, multiple-comparison methods, repeated measures.
// Two frozen reference files:
//   anova-reference-r.json  values from released R packages (anova-reference.R); each
//                           entry names the function that produced it.
//   anova-reference.json    SciPy 1.17.1 and a self-written second formulation
//                           (anova-oracle.py). Kept as a second opinion, not ground truth.
// Analytic anchors need no reference at all.
const T = require('../js/stats-tests.js');
const C = require('../js/stats-core.js');
const ref = require('./anova-reference.json');
const R = require('./anova-reference-r.json');

let pass = 0, fail = 0;
function near(name, got, exp, tol = 1e-6) {
  const ok = Number.isFinite(got) && Math.abs(got - exp) <= tol * (1 + Math.abs(exp));
  if (!ok) console.log('FAIL', name, `got=${got} exp=${exp}`);
  ok ? pass++ : fail++;
}
// Relative agreement for p-values, so a tiny tail cannot pass as zero.
function nearP(name, got, exp, rel = 1e-4) {
  const ok = Number.isFinite(got) && got >= 0 && got <= 1 && Math.abs(got - exp) <= rel * Math.max(exp, 1e-12) + 1e-12;
  if (!ok) console.log('FAIL', name, `got=${got} exp=${exp}`);
  ok ? pass++ : fail++;
}
function ok(name, cond) { if (!cond) console.log('FAIL', name); cond ? pass++ : fail++; }
// Monte Carlo references (multcomp, mvtnorm) carry about three digits, fewer in tiny tails.
function nearMC(name, got, exp) {
  const good = Number.isFinite(got) && Math.abs(got - exp) <= 2e-3 * exp + 2e-6;
  if (!good) console.log('FAIL', name, `got=${got} exp=${exp}`);
  good ? pass++ : fail++;
}
const each = (name, got, expected, check = near, ...rest) => {
  const exp = [].concat(expected); // the R export writes a one-value list as a bare number
  ok(name + ' count', got.length === exp.length);
  exp.forEach((e, i) => check(name + ' ' + i, got[i], e, ...rest));
};

const G = [
  [22, 24, 21, 25, 23, 26],
  [30, 28, 31, 27, 29],
  [26, 25, 27, 24, 28, 30, 31],
  [35, 31, 38, 29],
].map((values, i) => ({ name: 'G' + (i + 1), values }));
const GB = [[22, 24, 21, 25, 23], [30, 28, 31, 27, 29], [26, 25, 27, 24, 28]].map((values, i) => ({ name: 'B' + (i + 1), values }));
const RM = [[10, 12, 15, 14], [8, 9, 13, 15], [11, 11, 14, 13], [9, 13, 12, 17], [12, 14, 18, 16], [7, 10, 11, 15]];
const rmCols = [0, 1, 2, 3].map((j) => RM.map((r) => r[j]));
const TW = [[[4, 5, 6], [7, 9], [10, 12, 11]], [[5, 7], [8, 8.5, 10], [15, 14, 17, 16]]];
const pairsOf = (k) => { const out = []; for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out.push([i, j]); return out; };

// ---- omnibus tests ----
const av = T.oneWayANOVA(G);
near('anova F', av.F, ref.anova.F); nearP('anova p', av.p, ref.anova.p);
near('welch F', av.welch.F, ref.welch.F); nearP('welch p', av.welch.p, ref.welch.p);
near('brown-forsythe F*', av.brownForsytheF.F, ref.bf.F);
near('brown-forsythe df2', av.brownForsytheF.df2, ref.bf.df2);
nearP('brown-forsythe p', av.brownForsytheF.p, ref.bf.p);
// With two groups Brown–Forsythe F* is exactly Welch's t squared on Welch's df.
const two = T.oneWayANOVA([G[0], G[3]]), wt = T.unpairedT(G[0].values, G[3].values, true);
near('brown-forsythe k=2 equals welch t²', two.brownForsytheF.F, wt.t * wt.t, 1e-10);
near('brown-forsythe k=2 df equals welch df', two.brownForsytheF.df2, wt.df, 1e-10);
near('brown-forsythe k=2 reference F', two.brownForsytheF.F, ref.bf_two_groups.F);
nearP('brown-forsythe k=2 p equals welch p', two.brownForsytheF.p, wt.p, 1e-9);

const bt = T.bartlett(G);
near('bartlett T', bt.T, ref.bartlett.T); nearP('bartlett p', bt.p, ref.bartlett.p);
ok('bartlett rejects a constant group', !!T.bartlett([[1, 1, 1], [1, 2, 3]]).error);
ok('bartlett rejects a single-value group', !!T.bartlett([[1], [1, 2, 3]]).error);

const tr = T.linearTrend(av);
near('trend slope', tr.slope, ref.trend.slope); near('trend R²', tr.r2, ref.trend.r2);
near('trend F', tr.F, ref.trend.F); nearP('trend p', tr.p, ref.trend.p);
near('nonlinearity F', tr.nonlinear.F, ref.trend.Fnl); nearP('nonlinearity p', tr.nonlinear.p, ref.trend.pnl);
near('trend + nonlinearity SS = between SS', tr.ssTrend + tr.nonlinear.ss, av.ssB, 1e-10);

// ---- multiplicity adjustments ----
const bh = T.adjustP(ref.ps, 'fdr-bh'), by = T.adjustP(ref.ps, 'fdr-by'), bky = T.adjustP(ref.ps, 'fdr-bky');
ref.ps.forEach((_, i) => {
  near('BH q ' + i, bh[i], ref.ps_bh[i], 1e-10);
  near('BY q ' + i, by[i], ref.ps_by[i], 1e-10);
  near('BKY q ' + i, bky[i], ref.ps_bky[i], 2e-5); // reference scans Q in steps of 5e-6
});
const shuffled = [0.5, 0.001, 0.041, 0.008];
near('adjustments keep input order', T.adjustP(shuffled, 'fdr-bh')[1], 0.004, 1e-12);
ok('lsd leaves p-values unadjusted', T.adjustP(shuffled, 'lsd').every((p, i) => p === shuffled[i]));
near('bonferroni', T.adjustP(shuffled, 'bonferroni')[2], 0.164, 1e-12);
near('sidak', T.adjustP(shuffled, 'sidak')[3], 1 - Math.pow(0.992, 4), 1e-12);
ok('unknown correction is an error', (() => { try { T.adjustP([0.1], 'nope'); return false; } catch (e) { return true; } })());
near('unknown correction honours a fallback', T.adjustP(shuffled, 'nope', 'bonferroni')[2], 0.164, 1e-12);
ok('one BKY p-value above 0.5 is never a discovery', T.adjustP([0.9], 'fdr-bky')[0] === 1);

// ---- post-hoc after one-way ANOVA ----
const pairs = pairsOf(4);
const cmp = (method, opts) => T.posthoc(av, method, opts).comparisons;
const tukey = cmp('tukey'), gh = cmp('games-howell');
pairs.forEach((_, i) => {
  nearP('tukey p ' + i, tukey[i].p, ref.tukey[i].p, 1e-5);
  near('tukey CI lo ' + i, tukey[i].ci95lo, ref.tukey[i].lo, 1e-5); near('tukey CI hi ' + i, tukey[i].ci95hi, ref.tukey[i].hi, 1e-5);
  nearP('games-howell p ' + i, gh[i].p, ref.games_howell[i].p, 1e-4);
  near('games-howell CI lo ' + i, gh[i].ci95lo, ref.games_howell[i].lo, 1e-4); near('games-howell CI hi ' + i, gh[i].ci95hi, ref.games_howell[i].hi, 1e-4);
});
const lsd = cmp('lsd'), fbh = cmp('fdr-bh'), fby = cmp('fdr-by'), snk = cmp('snk'), t2 = cmp('tamhane-t2'), t3 = cmp('dunnett-t3');
pairs.forEach((_, i) => {
  nearP('lsd p ' + i, lsd[i].p, ref.lsd[i], 1e-8);
  nearP('fdr-bh q ' + i, fbh[i].p, ref.fdr_bh[i], 1e-8);
  nearP('fdr-by q ' + i, fby[i].p, ref.fdr_by[i], 1e-8);
  near('snk span ' + i, snk[i].r, ref.snk[i].r, 0); nearP('snk p ' + i, snk[i].p, ref.snk[i].p, 1e-5);
  nearP('tamhane T2 p ' + i, t2[i].p, ref.tamhane_t2[i].p, 1e-8);
  near('tamhane T2 CI half-width ' + i, (t2[i].ci95hi - t2[i].ci95lo) / 2, ref.tamhane_t2[i].half, 1e-6);
  nearP('dunnett T3 p ' + i, t3[i].p, ref.dunnett_t3[i].p, 1e-5);
  near('dunnett T3 CI half-width ' + i, (t3[i].ci95hi - t3[i].ci95lo) / 2, ref.dunnett_t3[i].half, 1e-5);
});
near('lsd CI is the plain t interval', lsd[0].ci95hi - lsd[0].diff, C.studentTinv(0.975, av.dfW) * lsd[0].se, 1e-10);
ok('holm-sidak and FDR report no simultaneous CI', cmp('holm-sidak')[0].ci95lo === undefined && fbh[0].ci95lo === undefined);
nearP('SMM tail (3, 10)', T.smmP(2.5, 3, 10), ref.smm['sf_2.5_3_10'], 1e-6);
nearP('SMM tail (6, 4.5)', T.smmP(3, 6, 4.5), ref.smm['sf_3_6_4.5'], 1e-6);
nearP('SMM tail at df 1.3', T.smmP(4, 3, 1.3), ref.smm['sf_4_3_1.3'], 2e-4); // hardest case: 4 digits
// One comparison: the studentized maximum modulus is the two-sided t distribution.
nearP('SMM with one comparison is two-tailed t', T.smmP(2.2, 1, 7), C.studentTtwoTailP(2.2, 7), 1e-7);

// Newman–Keuls step-down: nothing inside a non-significant range is declared significant.
// Two tiny outer groups make the full range non-significant while two large inner
// groups differ clearly on their own; the step-down rule must still retain the pair.
const big = (m) => Array.from({ length: 30 }, (_, i) => m + (i % 2 ? 0.5 : -0.5));
const guarded = T.posthoc({ _data: [[10, 10.2], big(9.9), big(9), [8.7, 8.9]], names: ['a', 'b', 'c', 'd'], _msW: 1, _dfW: 60 }, 'snk').comparisons;
const outer = guarded.find((c) => c.a === 'a' && c.b === 'd'), inner = guarded.find((c) => c.a === 'b' && c.b === 'c');
ok('snk: the full range spans 4 means and is ns', outer.r === 4 && outer.p > 0.05 && !outer.sig);
ok('snk: a pair inside an ns range is not declared significant', inner.r === 2 && inner.p < 0.05 && !inner.sig);
ok('snk declares nothing when the full range is ns', guarded.every((c) => !c.sig));

// Each vs control.
const dn = cmp('dunnett', { control: 0 });
[0, 1, 2].forEach((i) => {
  nearP('dunnett unequal-n p ' + i, dn[i].p, ref.dunnett_unbalanced.p[i], 2e-4);
  ok('dunnett agrees with SciPy QMC ' + i, Math.abs(dn[i].p - ref.dunnett_scipy_qmc[i]) < 2e-3);
});
near('dunnett unequal-n critical value', (dn[0].ci95hi - dn[0].diff) / dn[0].se, ref.dunnett_unbalanced.crit, 2e-4);
ok('dunnett compares each group with the control', dn.length === 3 && dn.every((c) => c.b === 'G1') && dn[0].diff > 0);
const dnb = T.posthoc(T.oneWayANOVA(GB), 'dunnett', { control: 0 }).comparisons;
[0, 1].forEach((i) => nearP('dunnett balanced p ' + i, dnb[i].p, ref.dunnett_balanced[i], 2e-3));
// The general correlation structure reduces to the balanced formula when λ² = 0.5.
nearP('dunnett λ=√½ matches the balanced formula', T.dunnettP(2.3, 3, 12, [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2]), T.dunnettP(2.3, 3, 12), 2e-3);
const ctl = cmp('bonferroni', { family: 'control', control: 2 });
ok('control family with Bonferroni has k − 1 comparisons vs the chosen control', ctl.length === 3 && ctl.every((c) => c.b === 'G3'));
near('control-family Bonferroni multiplies by k − 1', ctl[0].p, Math.min(1, ctl[0].pRaw * 3), 1e-12);
ok('control family never uses a range method', T.posthoc(av, 'tukey', { family: 'control', control: 0 }).comparisons.every((c) => c.q === undefined));

// Selected pairs and legacy behaviour.
const custom = T.posthoc(av, 'custom', { pairs: [[0, 1], [2, 3]], correction: 'fdr-bh' });
ok('custom pairs are adjusted over the selected set only', custom.comparisons.length === 2 && custom.method === 'custom (fdr-bh)');
near('custom T3 uses m = selected pairs', T.posthoc(av, 'custom', { pairs: [[0, 1], [2, 3]], correction: 'dunnett-t3' }).comparisons[0].p,
  T.smmP(Math.abs(t3[0].t), 2, t3[0].df), 1e-10);
near('legacy unknown method falls back to Holm-Šídák', cmp('whatever')[0].p, cmp('holm-sidak')[0].p, 0);
near('legacy unknown custom correction falls back to Šídák', T.posthoc(av, 'custom', { pairs: [[0, 1]], correction: 'x' }).comparisons[0].p,
  T.posthoc(av, 'custom', { pairs: [[0, 1]], correction: 'sidak' }).comparisons[0].p, 0);

// ---- Kruskal-Wallis / Dunn families ----
const kw = T.kruskalWallis(G);
const dc = T.dunnPosthoc(kw, 'none', { family: 'control', control: 0 }).comparisons;
[0, 1, 2].forEach((i) => nearP('dunn vs control raw p ' + i, dc[i].p, ref.dunn_control[i], 1e-6));
ok('uncorrected Dunn equals the raw p-values', dc.every((c) => c.p === c.pRaw));
const dc2 = T.dunnPosthoc(kw, 'bonferroni', { family: 'control', control: 2 }).comparisons;
ok('dunn control family is k − 1 comparisons against the chosen control', dc.length === 3 && dc2.length === 3 && dc2.every((c) => c.b === 'G3'));
near('dunn control family adjusts over k − 1', dc2[0].p, Math.min(1, dc2[0].pRaw * 3), 1e-12);
near('dunn default is still every pair, Holm-Šídák', T.dunnPosthoc(kw).comparisons.length, 6, 0);
near('dunn FDR', T.dunnPosthoc(kw, 'fdr-bh').comparisons[0].p, T.adjustP(T.dunnPosthoc(kw, 'none').comparisons.map((c) => c.pRaw), 'fdr-bh')[0], 0);

// ---- repeated-measures one-way ANOVA ----
const rm = T.rmANOVA(rmCols, ['A', 'B', 'C', 'D']);
near('rm F', rm.F, ref.rm.F); near('rm SS treatment', rm.ssTreat, ref.rm.ssTreat); near('rm SS subjects', rm.ssSubj, ref.rm.ssSubj);
near('rm SS residual', rm.ssRes, ref.rm.ssRes); near('rm Geisser-Greenhouse epsilon', rm.epsilon, ref.rm.epsilon, 1e-8);
nearP('rm p, sphericity assumed', rm.pAssumed, ref.rm.pAssumed, 1e-7); nearP('rm p, Geisser-Greenhouse', rm.pGG, ref.rm.pGG, 1e-7);
ok('rm defaults to the Geisser-Greenhouse p-value', rm.p === rm.pGG && !rm.sphericity);
ok('rm with sphericity reports the uncorrected p-value', T.rmANOVA(rmCols, null, { sphericity: true }).p === rm.pAssumed);
near('rm matching F', rm.matching.F, ref.rm.matchF); nearP('rm matching p', rm.matching.p, ref.rm.matchP, 1e-7);
// The same F from the existing two-way engine with one value per subject × condition cell.
const asTwoWay = T.twoWayANOVA(RM.map((r) => r.map((v) => [v])), RM.map((_, i) => 'S' + i), ['A', 'B', 'C', 'D']);
near('rm F equals unreplicated two-way column F', rm.F, asTwoWay.effects[1].F, 1e-9);
// Two conditions: F is the paired t squared and epsilon is 1.
const rm2 = T.rmANOVA([rmCols[0], rmCols[2]]), pt = T.pairedT(rmCols[0], rmCols[2]);
near('rm k=2 F equals paired t²', rm2.F, pt.t * pt.t, 1e-10); nearP('rm k=2 p equals paired t p', rm2.p, pt.p, 1e-9);
near('rm k=2 reference', rm2.F, ref.rm_two_columns.F); near('rm k=2 epsilon is 1', rm2.epsilon, 1, 1e-12);
// Rows with a blank are dropped whole, never shifted.
const gappy = T.rmANOVA([[10, 8, '', 11, 9, 12, 7], [12, 9, 99, 11, 13, 14, 10], [15, 13, 99, 14, 12, 18, 11], [14, 15, 99, 13, 17, 16, 15]]);
near('rm drops incomplete rows without shifting', gappy.F, rm.F, 1e-12);
ok('rm counts the incomplete rows', gappy.partialRows === 1 && gappy.n === 6);
ok('rm needs two complete rows', !!T.rmANOVA([[1, ''], [2, 3], [4, 5]]).error);
ok('rm reports zero residual variation', !!T.rmANOVA([[1, 2, 3], [2, 3, 4], [4, 5, 6]]).error);

const rmPairs = pairsOf(4);
const ind = T.rmPosthoc(rm, 'tukey').comparisons, indLsd = T.rmPosthoc(rm, 'lsd').comparisons;
const pooledModel = T.rmANOVA(rmCols, ['A', 'B', 'C', 'D'], { sphericity: true });
const pooled = T.rmPosthoc(pooledModel, 'tukey').comparisons;
rmPairs.forEach((_, i) => {
  near('rm individual t ' + i, ind[i].t, ref.rm_individual[i].t); nearP('rm individual raw p ' + i, indLsd[i].p, ref.rm_individual[i].pRaw, 1e-7);
  nearP('rm individual tukey p ' + i, ind[i].p, ref.rm_individual[i].tukey, 1e-5);
  near('rm pooled t ' + i, pooled[i].t, ref.rm_pooled[i].t); nearP('rm pooled tukey p ' + i, pooled[i].p, ref.rm_pooled[i].tukey, 1e-5);
});
ok('rm individual comparisons use n − 1 df; pooled use residual df', ind[0].df === 5 && pooled[0].df === 15);
const rmDn = T.rmPosthoc(pooledModel, 'dunnett', { control: 0 }).comparisons;
[0, 1, 2].forEach((i) => nearP('rm pooled dunnett p ' + i, rmDn[i].p, ref.rm_dunnett_pooled[i], 2e-3));
ok('rm has no unequal-variance methods', T.rmPosthoc(rm, 'games-howell').comparisons[0].p === T.rmPosthoc(rm, 'holm-sidak').comparisons[0].p);
ok('rm selected pairs', T.rmPosthoc(rm, 'custom', { pairs: [[0, 3]], correction: 'bonferroni' }).comparisons.length === 1);

// ---- Friedman ----
const fr = T.friedman(rmCols, ['A', 'B', 'C', 'D']);
near('friedman Q (tie-corrected)', fr.Q, ref.friedman.Q); nearP('friedman chi-square p', fr.pChiSquare, ref.friedman.p, 1e-7); ok('friedman small table is exact', fr.method === 'exact' && fr.p !== fr.pChiSquare);
fr.rankSums.forEach((r, i) => near('friedman rank sum ' + i, r, ref.friedman.rankSums[i], 1e-12));
const fd = T.friedmanDunn(fr, 'none').comparisons;
rmPairs.forEach((_, i) => nearP('friedman dunn raw p ' + i, fd[i].p, ref.friedman.dunn[i], 1e-6));
near('friedman dunn bonferroni', T.friedmanDunn(fr, 'bonferroni').comparisons[0].p, Math.min(1, fd[0].p * 6), 1e-12);
ok('friedman dunn vs control', T.friedmanDunn(fr, 'holm-sidak', { family: 'control', control: 3 }).comparisons.every((c) => c.b === 'D'));
ok('friedman needs three columns', !!T.friedman([rmCols[0], rmCols[1]]).error);
ok('friedman rejects fully tied rows', !!T.friedman([[1, 2], [1, 2], [1, 2]]).error);

// ---- two-way additions ----
const full = T.twoWayANOVA(TW, ['R1', 'R2'], ['C1', 'C2', 'C3']);
const add = T.twoWayANOVA(TW, ['R1', 'R2'], ['C1', 'C2', 'C3'], { interaction: false });
ok('two-way fits the interaction by default', full.interaction && full.effects.length === 3);
ok('main-effects-only model drops the interaction', !add.interaction && add.replicated && add.effects.length === 2);
near('additive row SS', add.effects[0].ss, ref.twoway_additive.ssRow); near('additive column SS', add.effects[1].ss, ref.twoway_additive.ssCol);
near('additive residual SS', add.residual.ss, ref.twoway_additive.ssRes); near('additive residual df', add.residual.df, ref.twoway_additive.df, 0);
nearP('additive row p', add.effects[0].p, ref.twoway_additive.pRow, 1e-7); nearP('additive column p', add.effects[1].p, ref.twoway_additive.pCol, 1e-7);
const twd = T.twoWayPosthoc(full, 'dunnett', 'colsWithinRow', { control: 0 });
ok('two-way dunnett: each column group vs control within each row', twd.comparisons.length === 4 && twd.comparisons.every((c) => c.b === 'C1'));
const row2 = twd.comparisons.filter((c) => c.within === 'R2');
[0, 1].forEach((i) => nearP('two-way dunnett row 2 p ' + i, row2[i].p, ref.twoway_dunnett_row2[i], 2e-4));
ok('two-way dunnett brackets keep their cells', isFinite(row2[0].cellA[0]) && row2[0].cellB[1] === 0);
const twCells = T.twoWayPosthoc(full, 'dunnett', 'cells', { control: 4 }).comparisons;
ok('two-way dunnett vs one control cell', twCells.length === 5 && twCells.every((c) => c.b === 'R2 · C2'));
const twLsd = T.twoWayPosthoc(full, 'lsd', 'colsWithinRow').comparisons;
ok('two-way LSD is unadjusted', twLsd.every((c) => c.p === c.pRaw));
near('two-way FDR', T.twoWayPosthoc(full, 'fdr-bky', 'cells').comparisons[3].p, T.adjustP(T.twoWayPosthoc(full, 'lsd', 'cells').comparisons.map((c) => c.pRaw), 'fdr-bky')[3], 0);
near('two-way legacy unknown method is Šídák', T.twoWayPosthoc(full, 'zzz').comparisons[0].p, T.twoWayPosthoc(full, 'sidak').comparisons[0].p, 0);
near('two-way control family with Bonferroni', T.twoWayPosthoc(full, 'bonferroni', 'rowMeans', { family: 'control', control: 1 }).comparisons.length, 1, 0);

// ---- the same calculations against released R packages (anova-reference-r.json) ----
near('R brown-forsythe F*', av.brownForsytheF.F, R.bf.F, 1e-9); near('R brown-forsythe df2', av.brownForsytheF.df2, R.bf.df2, 1e-9); nearP('R brown-forsythe p', av.brownForsytheF.p, R.bf.p, 1e-7);
near('R trend F', tr.F, R.trend.F, 1e-9); nearP('R trend p', tr.p, R.trend.p, 1e-7); near('R trend slope', tr.slope, R.trend.slope, 1e-9); near('R trend SS', tr.ssTrend, R.trend.ssTrend, 1e-9);
near('R nonlinearity F', tr.nonlinear.F, R.trend.Fnl, 1e-9); nearP('R nonlinearity p', tr.nonlinear.p, R.trend.pnl, 1e-7);
each('R newman-keuls p', snk.map((c) => c.p), R.snk.p, nearP, 1e-6);
each('R tamhane T2 p', t2.map((c) => c.p), R.tamhane_t2.p, nearP, 1e-8);
nearP('R SMM tail (3, 10)', T.smmP(2.5, 3, 10), R.smm['sf_2.5_3_10'], 1e-4); nearP('R SMM tail (6, 4)', T.smmP(3, 6, 4), R.smm.sf_3_6_4, 1e-4);
nearP('R SMM tail (6, 5)', T.smmP(3, 6, 5), R.smm.sf_3_6_5, 1e-4); nearP('R SMM tail (3, 2)', T.smmP(4, 3, 2), R.smm.sf_4_3_2, 1e-4);
// Dunnett T3: Welch t and df from R; the p-value must lie between the maximum-modulus
// tails at the whole df either side (no package evaluates the fractional df).
R.dunnett_t3.forEach((q, i) => {
  near('R dunnett T3 t ' + i, Math.abs(t3[i].t), q.t, 1e-9); near('R dunnett T3 df ' + i, t3[i].df, q.df, 1e-9);
  ok('R dunnett T3 p lies between the whole-df tails ' + i, t3[i].p >= Math.min(q.pFloor, q.pCeil) * (1 - 1e-3) && t3[i].p <= Math.max(q.pFloor, q.pCeil) * (1 + 1e-3));
});
each('R dunnett unequal-n p', dn.map((c) => c.p), R.dunnett_unbalanced.p, nearMC);
each('R dunn vs control raw p', dc.map((c) => c.p), R.dunn_control.p, nearP, 1e-8);
near('R rm F', rm.F, R.rm.F, 1e-9); near('R rm SS treatment', rm.ssTreat, R.rm.ssTreat, 1e-9); near('R rm SS residual', rm.ssRes, R.rm.ssRes, 1e-9); near('R rm SS subjects', rm.ssSubj, R.rm.ssSubj, 1e-9);
near('R rm epsilon', rm.epsilon, R.rm.epsilon, 1e-9); nearP('R rm p assumed', rm.pAssumed, R.rm.pAssumed, 1e-7); nearP('R rm p GG', rm.pGG, R.rm.pGG, 1e-7);
near('R rm matching F', rm.matching.F, R.rm.matchF, 1e-9); nearP('R rm matching p', rm.matching.p, R.rm.matchP, 1e-7);
R.rm_individual.forEach((q, i) => { near('R rm individual t ' + i, ind[i].t, q.t, 1e-9); nearP('R rm individual raw p ' + i, indLsd[i].p, q.pRaw, 1e-7); nearP('R rm individual tukey p ' + i, ind[i].p, q.tukey, 1e-6); });
each('R rm pooled t', pooled.map((c) => c.t), R.rm_pooled.t, near, 1e-9); each('R rm pooled tukey p', pooled.map((c) => c.p), R.rm_pooled.tukey, nearP, 1e-6);
each('R rm pooled dunnett p', rmDn.map((c) => c.p), R.rm_dunnett_pooled.p, nearMC);
near('R friedman Q', fr.Q, R.friedman.Q, 1e-9); nearP('R friedman chi-square p', fr.pChiSquare, R.friedman.p, 1e-7);
each('R friedman dunn raw p', fd.map((c) => c.p), R.friedman.dunn, nearP, 1e-8);
each('R two-way dunnett row 2 p', row2.map((c) => c.p), R.twoway_dunnett_row2.p, nearMC);

// Two-way models: Type III tables, comparisons of estimated marginal means when no
// interaction is fitted, and the two definitions of a family for simple effects.
const TW5 = [
  [[4, 5, 6], [7, 9], [10, 12, 11], [6, 8, 7, 9], [5, 6.5]],
  [[5, 7], [8, 8.5, 10], [15, 14, 17, 16], [9], [7, 8, 6, 7.5, 9]],
  [[6, 6.5, 8, 7], [11], [12, 15], [10, 12, 11], [8]]];
// The range routine holds five digits down to tails near 1e-9; below that only the size.
function tukeyP(name, got, exp) {
  const good = Number.isFinite(got) && Math.abs(got - exp) <= 1e-5 * exp + 1e-11;
  if (!good) console.log('FAIL', name, `got=${got} exp=${exp}`);
  good ? pass++ : fail++;
}
for (const [key, cells] of [['twoway', TW], ['twoway5', TW5]]) {
  const rn = cells.map((_, i) => 'R' + (i + 1)), cn = cells[0].map((_, j) => 'C' + (j + 1)), q = R[key];
  const additive = T.twoWayANOVA(cells, rn, cn, { interaction: false }), fitted = T.twoWayANOVA(cells, rn, cn);
  near(key + ' additive row SS', additive.effects[0].ss, q.additive.ssRow, 1e-9); near(key + ' additive column SS', additive.effects[1].ss, q.additive.ssCol, 1e-9);
  near(key + ' additive residual SS', additive.residual.ss, q.additive.ssRes, 1e-9); near(key + ' additive residual df', additive.residual.df, q.additive.df, 0);
  nearP(key + ' additive row p', additive.effects[0].p, q.additive.pRow, 1e-7); nearP(key + ' additive column p', additive.effects[1].p, q.additive.pCol, 1e-7);
  for (const [side, dir, simple] of [['col', 'colMeans', 'colsWithinRow'], ['row', 'rowMeans', 'rowsWithinCol']]) {
    const e = q.emm[side], run = (m, o, d = dir) => T.twoWayPosthoc(additive, m, d, o), label = key + ' no-interaction ' + side + ' ';
    each(label + 'marginal mean', additive.marginal[side].means, e.means, near, 1e-9);
    each(label + 'difference', run('lsd').comparisons.map((c) => c.diff), e.diff, near, 1e-9);
    each(label + 'SE', run('lsd').comparisons.map((c) => c.se), e.se, near, 1e-9);
    each(label + 'unadjusted p', run('lsd').comparisons.map((c) => c.p), e.lsd, nearP, 1e-7);
    each(label + 'tukey p', run('tukey').comparisons.map((c) => c.p), e.tukey, tukeyP);
    each(label + 'sidak p', run('sidak').comparisons.map((c) => c.p), e.sidak, nearP, 1e-7);
    each(label + 'bonferroni p', run('bonferroni').comparisons.map((c) => c.p), e.bonferroni, nearP, 1e-7);
    // Control = the last level, so a family that ignored the control would differ.
    const last = e.means.length - 1, ctl = run('dunnett', { control: last });
    each(label + 'dunnett difference', ctl.comparisons.map((c) => c.diff), e.dunnettLastDiff, near, 1e-9);
    each(label + 'dunnett p', ctl.comparisons.map((c) => c.p), e.dunnettLast, nearMC);
    ok(label + 'dunnett says when the correlation structure is approximated', ctl.approximate === (key === 'twoway5' && side === 'col'));
    // Simple effects do not exist without an interaction: they answer with the main effect.
    const mapped = run('sidak', {}, simple);
    ok(label + 'simple effects become the main effect', mapped.direction === dir && mapped.requestedDirection === simple && mapped.families === null);
    each(label + 'mapped p', mapped.comparisons.map((c) => c.p), e.sidak, nearP, 1e-7);
    ok(label + 'comparisons carry no cells', mapped.comparisons.every((c) => c.cellA === undefined && c.within === '—'));
  }
  ok(key + ' every-cell request without an interaction is the column main effect', T.twoWayPosthoc(additive, 'sidak', 'cells').direction === 'colMeans');
  const f = q.families, simple = (m, families, dir = 'colsWithinRow') => T.twoWayPosthoc(fitted, m, dir, { families });
  each(key + ' simple effects raw p', simple('lsd', 'each').comparisons.map((c) => c.p), f.raw, nearP, 1e-7);
  each(key + ' sidak, one family per row', simple('sidak', 'each').comparisons.map((c) => c.p), f.sidakEach, nearP, 1e-7);
  each(key + ' bonferroni, one family per row', simple('bonferroni', 'each').comparisons.map((c) => c.p), f.bonferroniEach, nearP, 1e-7);
  each(key + ' tukey, one family per row', simple('tukey', 'each').comparisons.map((c) => c.p), f.tukeyEach, tukeyP);
  each(key + ' sidak, one family for all', simple('sidak', 'all').comparisons.map((c) => c.p), f.sidakAll, nearP, 1e-7);
  each(key + ' bonferroni, one family for all', simple('bonferroni', 'all').comparisons.map((c) => c.p), f.bonferroniAll, nearP, 1e-7);
  each(key + ' sidak without a family choice pools, as older versions did', simple('sidak').comparisons.map((c) => c.p), f.sidakAll, nearP, 1e-7);
  each(key + ' rows within columns, one family per column', simple('sidak', 'each', 'rowsWithinCol').comparisons.map((c) => c.p), f.rowsSidakEach, nearP, 1e-7);
  each(key + ' rows within columns, one family for all', simple('sidak', 'all', 'rowsWithinCol').comparisons.map((c) => c.p), f.rowsSidakAll, nearP, 1e-7);
  ok(key + ' family count', simple('sidak', 'each').familyCount === cells.length && simple('sidak', 'all').familyCount === 1 && simple('sidak', 'each').families === 'each' && simple('sidak', 'all').families === 'all');
  ok(key + ' tukey and dunnett always take one family per row', simple('tukey', 'all').families === 'each' && simple('dunnett', 'all').families === 'each');
  each(key + ' holm-sidak per row adjusts within the row', simple('holm-sidak', 'each').comparisons.filter((c) => c.within === 'R1').map((c) => c.p),
    T.adjustP(simple('lsd', 'each').comparisons.filter((c) => c.within === 'R1').map((c) => c.pRaw), 'holm-sidak'), near, 1e-12);
  ok(key + ' main effects have one family', T.twoWayPosthoc(fitted, 'sidak', 'colMeans', { families: 'each' }).families === null);
}
// One value per cell: no interaction can be fitted, so the default request is answered
// with the column main effect from the model's marginal means.
const single = T.twoWayANOVA(RM.map((r) => r.map((v) => [v])), RM.map((_, i) => 'S' + i), ['A', 'B', 'C', 'D']);
const singlePh = T.twoWayPosthoc(single, 'tukey', 'colsWithinRow', { families: 'each' });
ok('one value per cell compares column means', singlePh.direction === 'colMeans' && singlePh.comparisons.length === 6);
each('one value per cell equals the pooled repeated-measures comparisons', singlePh.comparisons.map((c) => c.p), R.rm_pooled.tukey, nearP, 1e-6);

console.log(`\n${pass} ANOVA checks passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
