// Repeated-measures two-way ANOVA and the mixed-effects model (one-way and two-way).
// Reference values come from released R packages (rm-mixed-reference.R, frozen in
// rm-mixed-reference.json): car for the ANOVA and the Geisser-Greenhouse epsilon,
// lme4 + lmerTest + pbkrtest for the model and its Kenward-Roger tests, emmeans for the
// comparisons of means, stats::t.test for comparisons without the sphericity assumption.
// Both scripts read the same data from rm-mixed-fixtures.json.
const M = require('../js/stats-mixed.js');
const T = require('../js/stats-tests.js');
const C = require('../js/stats-core.js');
const fx = require('./rm-mixed-fixtures.json');
const R = require('./rm-mixed-reference.json');

let pass = 0, fail = 0;
function near(name, got, exp, tol = 1e-6) {
  const good = Number.isFinite(got) && Number.isFinite(exp) && Math.abs(got - exp) <= tol * (1 + Math.abs(exp));
  if (!good) console.log('FAIL', name, `got=${got} exp=${exp}`);
  good ? pass++ : fail++;
}
function nearP(name, got, exp, rel = 1e-4) {
  const good = Number.isFinite(got) && got >= 0 && got <= 1 && Math.abs(got - exp) <= rel * Math.max(exp, 1e-12) + 1e-12;
  if (!good) console.log('FAIL', name, `got=${got} exp=${exp}`);
  good ? pass++ : fail++;
}
function ok(name, cond) { if (!cond) console.log('FAIL', name); cond ? pass++ : fail++; }
const names = (n, p) => Array.from({ length: n }, (_, i) => p + (i + 1));
const KEYS = ['row', 'col', 'int'];
// The model's optimum is found iteratively by both programs; 1e-6 is what they share.
const FIT = 1e-6;

function run(name, opts) {
  const f = fx[name], g = f.grid;
  return M.twoWayRepeated(g, names(g.length, 'R'), names(g[0].length, 'C'), Object.assign({ matching: f.matching }, opts));
}
// emmeans labels: "C1 - C2 | R1" for simple effects, "C1 - C2" for marginal means.
function comparePairs(tag, ph, expected, withinKey) {
  ok(tag + ' count', ph.comparisons.length === expected.length);
  expected.forEach((e) => {
    const [pair, block] = e.label.split(' | '), [a, b] = pair.split(' - ');
    const c = ph.comparisons.find((x) => x.a === a && x.b === b && (!withinKey || x.within === block));
    ok(tag + ' has ' + e.label, !!c);
    if (!c) return;
    near(tag + ' diff ' + e.label, c.diff, e.diff, FIT);
    near(tag + ' se ' + e.label, c.se, e.se, FIT);
    near(tag + ' df ' + e.label, c.df, e.df, 1e-5);
    nearP(tag + ' p ' + e.label, c.pRaw, e.p, 1e-4);
  });
}

for (const name of Object.keys(fx)) {
  const f = fx[name], ref = R[name];
  if (f.rows) continue;
  const complete = ref.subjects === ref.subjectsComplete;

  // ---- repeated-measures ANOVA on the subjects with complete data ----
  const rm = run(name, { method: 'rm' }), rmS = run(name, { method: 'rm', sphericity: true });
  ok(name + ' rm runs', !rm.error && rm.mode === 'rm');
  ok(name + ' rm subject counts', rm.subjectsTotal === ref.subjects && rm.subjectsUsed === ref.subjectsComplete && rm.subjectsIncomplete === ref.subjects - ref.subjectsComplete);
  KEYS.forEach((key) => {
    const e = rm.effects.find((x) => x.key === key), s = rmS.effects.find((x) => x.key === key), x = ref.rm[key];
    near(`${name} rm ${key} SS`, e.ss, x.ss); near(`${name} rm ${key} error SS`, e.ssError, x.ssError);
    ok(`${name} rm ${key} df`, e.df === x.df && e.dfError === x.dfError);
    near(`${name} rm ${key} F`, e.F, x.F);
    nearP(`${name} rm ${key} p sphericity assumed`, s.p, x.pAssumed);
    if (x.epsilon != null) {
      near(`${name} rm ${key} epsilon`, e.epsilon, x.epsilon);
      nearP(`${name} rm ${key} p Geisser-Greenhouse`, e.p, x.pGG);
      ok(`${name} rm ${key} corrected df`, Math.abs(e.df1 - x.epsilon * x.df) < 1e-6 && Math.abs(e.df2 - x.epsilon * x.dfError) < 1e-6);
    } else {
      // A between-subjects effect has no epsilon. car also gives none for a repeated
      // effect with fewer subjects than contrasts; there the engine's value is only
      // checked to lie in its possible range (no reference).
      ok(`${name} rm ${key} epsilon absent or in range`, e.epsilon == null || (e.epsilon >= 1 / e.contrasts - 1e-12 && e.epsilon <= 1));
      if (e.epsilon == null) nearP(`${name} rm ${key} p unaffected by the sphericity choice`, e.p, x.pAssumed);
    }
  });

  // ---- mixed-effects model on every value ----
  const mm = run(name, { method: 'mixed' });
  ok(name + ' mixed runs', !mm.error && mm.mode === 'mixed' && mm.subjectsUsed === ref.subjects);
  KEYS.forEach((key) => {
    const e = mm.effects.find((x) => x.key === key), x = ref.mixed.effects[key];
    near(`${name} mixed ${key} F`, e.F, x.F, 1e-5); near(`${name} mixed ${key} df2`, e.df2, x.df2, 1e-5);
    ok(`${name} mixed ${key} df1`, e.df1 === x.df1); nearP(`${name} mixed ${key} p`, e.p, x.p, 1e-4);
  });
  near(name + ' mixed residual variance', mm.residual.variance, ref.mixed.variance.residual, FIT);
  near(name + ' mixed subject variance', mm.random[0].variance, ref.mixed.variance.subject, 1e-5);
  if (f.matching === 'both') {
    near(name + ' mixed row × subject variance', mm.random[1].variance, ref.mixed.variance.subjectRow, 1e-5);
    near(name + ' mixed column × subject variance', mm.random[2].variance, ref.mixed.variance.subjectCol, 1e-5);
  }
  near(name + ' mixed matching chi-square', mm.matchingTest.chi2, Math.max(0, ref.mixed.matchingChi2), 1e-5);
  ok(name + ' mixed matching df', mm.matchingTest.df === (f.matching === 'both' ? 3 : 1));
  for (const dir of ['colsWithinRow', 'rowsWithinCol', 'colMeans', 'rowMeans']) {
    comparePairs(`${name} mixed ${dir}`, M.twoWayRepeatedPosthoc(mm, 'lsd', dir, {}), ref.mixed[dir], dir === 'colsWithinRow' || dir === 'rowsWithinCol');
  }

  // ---- "auto" picks by whether a value is missing ----
  const auto = run(name, {});
  ok(name + ' auto mode', auto.mode === (complete ? 'rm' : 'mixed'));

  // ---- with sphericity assumed the ANOVA takes its comparisons from the fitted model ----
  const phS = M.twoWayRepeatedPosthoc(rmS, 'lsd', 'colsWithinRow', {});
  ok(name + ' rm sphericity comparisons come from the model', phS.basis === 'model');
  comparePairs(`${name} rm sphericity colsWithinRow`, phS, ref.mixedComplete.colsWithinRow, true);
  comparePairs(`${name} rm sphericity rowMeans`, M.twoWayRepeatedPosthoc(rmS, 'lsd', 'rowMeans', {}), ref.mixedComplete.rowMeans, false);
  // With complete data the model reproduces the ANOVA table (when no variance is held at zero).
  const mc = M.twoWayRepeated(rm.cells.map((row, i) => row.map((_, j) => fx[name].grid[i][j])), rm.rowNames, rm.colNames, { matching: f.matching, method: 'mixed' });
  if (complete && !mc.boundary) KEYS.forEach((key) => {
    const e = mc.effects.find((x) => x.key === key), s = rmS.effects.find((x) => x.key === key);
    near(`${name} complete data: model F equals ANOVA F (${key})`, e.F, s.F, 1e-6);
    near(`${name} complete data: model df equals ANOVA df (${key})`, e.df2, s.dfError, 1e-5);
  });

  // ---- without the sphericity assumption: only the two means' own data ----
  const d = ref.data, w = f.matching === 'rows' ? 'rowsWithinCol' : 'colsWithinRow', b = f.matching === 'rows' ? 'colsWithinRow' : 'rowsWithinCol';
  const tcheck = (tag, c, x) => {
    ok(tag + ' found', !!c); if (!c) return;
    near(tag + ' diff', c.diff, x.diff); near(tag + ' t', c.t, x.t); near(tag + ' df', c.df, x.df); nearP(tag + ' p', c.pRaw, x.p);
  };
  if (f.matching === 'both') {
    const ph = M.twoWayRepeatedPosthoc(rm, 'lsd', 'colsWithinRow', {});
    ok(name + ' rm comparisons use the data', ph.basis === 'data');
    tcheck(name + ' paired cell comparison', ph.comparisons.find((c) => c.within === 'R1' && c.a === 'C1' && c.b === 'C2'), d.paired);
    tcheck(name + ' paired marginal comparison', M.twoWayRepeatedPosthoc(rm, 'lsd', 'rowMeans', {}).comparisons.find((c) => c.a === 'R1' && c.b === 'R2'), d.pairedMarginal);
  } else {
    const W = f.matching === 'rows' ? 'R' : 'C', G = f.matching === 'rows' ? 'C' : 'R';
    tcheck(name + ' paired within one group', M.twoWayRepeatedPosthoc(rm, 'lsd', w, {}).comparisons.find((c) => c.within === G + '1' && c.a === W + '1' && c.b === W + '2'), d.paired);
    tcheck(name + ' Welch between groups', M.twoWayRepeatedPosthoc(rm, 'lsd', b, {}).comparisons.find((c) => c.within === W + '1' && c.a === G + '1' && c.b === G + '2'), d.welchCell);
    tcheck(name + ' Welch on subject means', M.twoWayRepeatedPosthoc(rm, 'lsd', f.matching === 'rows' ? 'colMeans' : 'rowMeans', {}).comparisons.find((c) => c.a === G + '1' && c.b === G + '2'), d.welchMarginal);
  }
}

// ---- one-way mixed-effects model ----
for (const name of ['oneWayComplete', 'oneWayMissing']) {
  const rows = fx[name].rows, ref = R[name];
  const cols = rows[0].map((_, j) => rows.map((r) => r[j]));
  const mm = M.oneWayMixed(cols, names(cols.length, 'K'));
  ok(name + ' runs', !mm.error);
  near(name + ' F', mm.F, ref.F, 1e-5); near(name + ' df2', mm.df2, ref.df2, 1e-5); ok(name + ' df1', mm.df1 === ref.df1); nearP(name + ' p', mm.p, ref.p);
  near(name + ' residual variance', mm.residual.variance, ref.variance.residual, FIT);
  near(name + ' subject variance', mm.random[0].variance, ref.variance.subject, 1e-5);
  near(name + ' matching chi-square', mm.matchingTest.chi2, ref.matchingChi2, 1e-5);
  mm.means.forEach((v, j) => near(`${name} model mean ${j + 1}`, v, ref.means[j], FIT));
  comparePairs(name + ' pairs', M.oneWayMixedPosthoc(mm, 'lsd', {}), ref.pairs, false);
  ok(name + ' counts rows with a missing value', mm.partialRows === rows.filter((r) => r.some((v) => v == null)).length);
}
{
  // Complete data: the model reproduces repeated-measures ANOVA with sphericity assumed.
  const rows = fx.oneWayComplete.rows, cols = rows[0].map((_, j) => rows.map((r) => r[j]));
  const mm = M.oneWayMixed(cols), rm = T.rmANOVA(cols, null, { sphericity: true });
  near('one-way complete: model F equals ANOVA F', mm.F, rm.F, 1e-8);
  near('one-way complete: model df equals ANOVA df', mm.df2, rm.dfRes, 1e-6);
  const a = M.oneWayMixedPosthoc(mm, 'tukey', {}).comparisons, b = T.rmPosthoc(rm, 'tukey', {}).comparisons;
  a.forEach((c, i) => { near('one-way complete: Tukey p equals the pooled ANOVA comparison ' + i, c.p, b[i].p, 1e-6); near('one-way complete: interval ' + i, c.ci95lo, b[i].ci95lo, 1e-6); });
  // Families: each vs a control other than the first column, and selected pairs.
  const ctl = M.oneWayMixedPosthoc(mm, 'dunnett', { control: 2 });
  ok('one-way Dunnett compares three columns with the third', ctl.comparisons.length === 3 && ctl.comparisons.every((c) => c.b === 'Group 3'));
  const ctlRm = T.rmPosthoc(rm, 'dunnett', { control: 2 }).comparisons;
  ctl.comparisons.forEach((c, i) => near('one-way complete: Dunnett p equals the pooled ANOVA comparison ' + i, c.p, ctlRm[i].p, 1e-5));
  const custom = M.oneWayMixedPosthoc(mm, 'custom', { pairs: [[0, 3], [1, 2]], correction: 'bonferroni' });
  ok('one-way selected pairs', custom.comparisons.length === 2 && custom.comparisons[0].a === 'Group 1' && custom.comparisons[0].b === 'Group 4');
  near('one-way selected pairs are Bonferroni-adjusted', custom.comparisons[0].p, Math.min(1, 2 * custom.comparisons[0].pRaw), 1e-12);
}

// ---- families and methods on the two-way comparisons ----
{
  const mm = run('splitUnequalMissing', { method: 'mixed' });
  const each = M.twoWayRepeatedPosthoc(mm, 'sidak', 'colsWithinRow', { families: 'each' });
  const all = M.twoWayRepeatedPosthoc(mm, 'sidak', 'colsWithinRow', { families: 'all' });
  ok('families: one per row', each.families === 'each' && each.familyCount === 4 && all.families === 'all' && all.familyCount === 1);
  each.comparisons.forEach((c, i) => {
    near('one family per row: Šídák over 3 ' + i, c.p, 1 - (1 - c.pRaw) ** 3, 1e-12);
    near('one family for all: Šídák over 12 ' + i, all.comparisons[i].p, 1 - (1 - c.pRaw) ** 12, 1e-12);
  });
  const tk = M.twoWayRepeatedPosthoc(mm, 'tukey', 'colsWithinRow', {});
  tk.comparisons.forEach((c, i) => near('Tukey uses each comparison’s own df ' + i, c.p, C.tukeyP(Math.SQRT2 * Math.abs(c.t), 3, c.df), 1e-12));
  const dn = M.twoWayRepeatedPosthoc(mm, 'dunnett', 'colsWithinRow', { control: 1 });
  ok('Dunnett vs the second column group', dn.comparisons.length === 8 && dn.comparisons.every((c) => c.b === 'C2') && dn.control === 1);
  ok('Dunnett p is between the unadjusted and Bonferroni p', dn.comparisons.every((c) => c.p >= c.pRaw - 1e-12 && c.p <= 2 * c.pRaw + 1e-12));
  const cells = M.twoWayRepeatedPosthoc(mm, 'holm-sidak', 'cells', {});
  ok('every cell vs every cell', cells.comparisons.length === 66 && cells.comparisons.every((c) => c.cellA && c.cellB));
  const unknown = M.twoWayRepeatedPosthoc(mm, 'no-such-method', 'colMeans', {});
  unknown.comparisons.forEach((c, i) => near('unknown method falls back to Šídák ' + i, c.p, 1 - (1 - c.pRaw) ** 3, 1e-12));
}

// ---- the subject rule ----
{
  const g = fx.splitMissing.grid, rn = ['Baseline', 'Week 2', 'Week 4'], cn = ['Vehicle', 'Drug'];
  const rows = M.subjectLayout(g, 'rows', rn, cn), cols = M.subjectLayout(g, 'cols', rn, cn), both = M.subjectLayout(g, 'both', rn, cn);
  ok('rows repeated: one subject per column group and subcolumn', rows.subjects.length === 8 && rows.need === 3);
  ok('columns repeated: one subject per row and subcolumn', cols.subjects.length === 12 && cols.need === 2);
  ok('both repeated: one subject per subcolumn', both.subjects.length === 4 && both.need === 6);
  ok('rows repeated: same subject down a subcolumn, different across groups', rows.indexOf(0, 0, 1) === rows.indexOf(2, 0, 1) && rows.indexOf(0, 0, 1) !== rows.indexOf(0, 1, 1));
  ok('columns repeated: same subject across groups in one row, different across rows', cols.indexOf(1, 0, 2) === cols.indexOf(1, 1, 2) && cols.indexOf(1, 0, 2) !== cols.indexOf(2, 0, 2));
  ok('both repeated: subcolumn number is the subject', both.indexOf(0, 0, 3) === both.indexOf(2, 1, 3));
  ok('incomplete subjects are named', rows.incomplete.map((u) => u.label).join() === 'Vehicle · 2,Drug · 3' && rows.values === 22 && rows.completeValues === 18);
  ok('an empty subcolumn is not a subject', M.subjectLayout(fx.splitUnequal.grid, 'rows').subjects.length === 12);
}

// ---- a variance held at zero, and designs that cannot be analyzed ----
{
  const mm = run('boundary', { method: 'mixed' });
  ok('subject variance held at zero is reported', mm.boundary === true && mm.random[0].variance === 0);
  near('boundary: matching chi-square is zero', mm.matchingTest.chi2, 0, 1e-9);
  const g = fx.splitBalanced.grid;
  ok('one subject is not enough', !!M.twoWayRepeated(g.map((r) => r.map((c) => c.map((v, s) => (s === 0 ? v : null)))), ['a', 'b', 'c'], ['x', 'y'], { matching: 'both' }).error);
  ok('an empty cell is refused', !!M.twoWayRepeated(g.map((r, i) => r.map((c, j) => (i === 0 && j === 0 ? c.map(() => null) : c))), ['a', 'b', 'c'], ['x', 'y'], { matching: 'rows', method: 'mixed' }).error);
  ok('the repeated factor must be named', !!M.twoWayRepeated(g, ['a', 'b', 'c'], ['x', 'y'], {}).error);
  ok('two repeated levels: epsilon is 1', M.sphericityPreview(g, 'cols').every((e) => e.epsilon === 1 && e.d === 1));
  const eps = M.sphericityPreview(g, 'rows');
  ok('sphericity preview reports the repeated effects', eps.length === 2 && eps[0].key === 'row' && eps[0].d === 2);
  near('sphericity preview epsilon', eps[0].epsilon, R.splitBalanced.rm.row.epsilon);
}

console.log(`\n${pass} repeated-measures and mixed-model checks passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
