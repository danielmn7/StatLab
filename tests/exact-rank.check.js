// Exact p-values of the rank tests against released packages (see the "about" field of
// tests/exact-rank-reference.json for which function produced each value).
const T = require('../js/stats-tests.js');
const D = require('./exact-rank-reference.json');

let pass = 0, fail = 0;
const arr = (v) => (Array.isArray(v) ? v : [v]);
const RUN = { wsr: T.wilcoxonSignedRank, mw: T.mannWhitney, sp: T.spearman, spt: T.spearman };
const NAME = { wsr: 'Wilcoxon signed-rank', mw: 'Mann-Whitney (ties)', sp: 'Spearman', spt: 'Spearman (ties)' };
D.cases.forEach((c, index) => {
  for (const alternative of ['two-sided', 'greater', 'less']) {
    const result = RUN[c.kind](arr(c.x), arr(c.y), alternative);
    for (const [library, expected] of Object.entries(c.ref[alternative] || {})) {
      if (typeof expected !== 'number') continue;
      const ok = result.method.startsWith('exact') && Math.abs(result.p - expected) <= 1e-9 * Math.max(Math.abs(expected), 1e-300);
      if (ok) pass++; else { fail++; console.log(`FAIL ${NAME[c.kind]} #${index} ${alternative} vs ${library} got=${result.p} exp=${expected} method=${result.method}`); }
    }
  }
});

// Kruskal-Wallis and Friedman (see the "about" field of tests/exact-kgroup-reference.json).
require('./exact-kgroup-reference.json').cases.forEach((c, index) => {
  const data = c.data.map(arr);
  const result = c.kind === 'kw' ? T.kruskalWallis(data.map((values) => ({ values }))) : T.friedman(data);
  for (const [library, expected] of Object.entries(c.ref)) {
    const ok = result.method === 'exact' && Math.abs(result.p - expected) <= 1e-9 * expected;
    if (ok) pass++; else { fail++; console.log(`FAIL ${c.kind === 'kw' ? 'Kruskal-Wallis' : 'Friedman'} #${index} vs ${library} got=${result.p} exp=${expected} method=${result.method}`); }
  }
});

// Above the exact limits the approximations remain in use.
const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);
const expectMethod = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL ${name} method got=${got} exp=${want}`); } };
expectMethod('Wilcoxon 200 pairs', T.wilcoxonSignedRank(seq(200), seq(200).map(() => 0)).method, 'exact');
expectMethod('Wilcoxon 201 pairs', T.wilcoxonSignedRank(seq(201), seq(201).map(() => 0)).method, 'normal approximation');
expectMethod('Spearman 17 pairs', T.spearman(seq(17), seq(17).map((v) => (v * 7) % 17)).method, 'exact');
expectMethod('Spearman 18 pairs', T.spearman(seq(18), seq(18).map((v) => (v * 7) % 19)).method, 't approximation');
expectMethod('Mann-Whitney ties, smaller group 101', T.mannWhitney(seq(101).map((v) => v % 9), seq(101).map((v) => v % 7)).method, 'normal approximation (tie-corrected)');

const cols = (k, n) => Array.from({ length: k }, (_, j) => seq(n).map((v) => ((v * (j + 2)) % 11) + j));
expectMethod('Friedman 3 x 11 (6^11 <= 1e9)', T.friedman(cols(3, 11)).method, 'exact');
expectMethod('Friedman 3 x 12 (6^12 > 1e9)', T.friedman(cols(3, 12)).method, 'chi-square approximation');
expectMethod('Friedman 4 x 6', T.friedman(cols(4, 6)).method, 'exact');
expectMethod('Friedman 4 x 7', T.friedman(cols(4, 7)).method, 'chi-square approximation');
const kwGroups = (ns) => ns.map((n, j) => ({ values: seq(n).map((v) => v + j / 7 + ((v * 13) % 5) / 3) }));
expectMethod('Kruskal-Wallis 15,15,15', T.kruskalWallis(kwGroups([15, 15, 15])).method, 'exact');
expectMethod('Kruskal-Wallis 5,5,35', T.kruskalWallis(kwGroups([5, 5, 35])).method, 'exact');
expectMethod('Kruskal-Wallis 5,5,36 (group above 35)', T.kruskalWallis(kwGroups([5, 5, 36])).method, 'chi-square approximation');
expectMethod('Kruskal-Wallis 20,20,20 (too large to enumerate)', T.kruskalWallis(kwGroups([20, 20, 20])).method, 'chi-square approximation');
{ // the approximation is still reported alongside, and is the p-value when exact is unavailable
  const big = T.kruskalWallis(kwGroups([20, 20, 20])), small = T.friedman(cols(3, 5));
  expectMethod('Kruskal-Wallis fallback p', big.p, big.pChiSquare);
  expectMethod('Friedman exact p differs from chi-square', small.p !== small.pChiSquare, true);
}

console.log(`\n${pass} exact rank-test checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
