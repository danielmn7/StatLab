'use strict';

// Standalone, dependency-free regression tests: node tests/variance.check.js
// Contract: median-centered Levene (Brown–Forsythe) tests equal variances,
// NOT equal means. NIST definition:
// https://www.itl.nist.gov/div898/handbook/eda/section3/eda35a.htm
const assert = require('assert');
const C = require('../js/stats-core.js');
const T = require('../js/stats-tests.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
    pass++;
  } catch (error) {
    console.error('FAIL', name, '\n ', error.message);
    fail++;
  }
}
function near(got, expected, label, relative = 2e-12, absolute = 2e-14) {
  assert.ok(Number.isFinite(got), `${label}: not finite (${got})`);
  assert.ok(Math.abs(got - expected) <= absolute + relative * Math.abs(expected),
    `${label}: got=${got}, expected=${expected}`);
}
function vector(got, expected, label) {
  assert.strictEqual(got.length, expected.length, `${label} length`);
  expected.forEach((value, i) => near(got[i], value, `${label}[${i}]`));
}
function valid(groups) {
  const result = T.brownForsythe(groups);
  assert.ok(!result.error, result.error);
  assert.ok(/Brown.*Forsythe/i.test(result.test), result.test);
  for (const key of ['k', 'ns', 'medians', 'variances', 'sds', 'W', 'df1', 'df2', 'p']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, key), `missing ${key}`);
  }
  assert.strictEqual(result.k, groups.length);
  assert.strictEqual(result.df1, result.k - 1);
  assert.strictEqual(result.df2, result.ns.reduce((s, n) => s + n, 0) - result.k);
  assert.ok(Number.isFinite(result.W) && result.W >= 0, `invalid W=${result.W}`);
  assert.ok(Number.isFinite(result.p) && result.p >= 0 && result.p <= 1, `invalid p=${result.p}`);
  return result;
}
function invalid(groups, pattern) {
  let result;
  assert.doesNotThrow(() => { result = T.brownForsythe(groups); });
  assert.ok(result && typeof result.error === 'string' && result.error.length, 'explicit error required');
  assert.ok(!Number.isFinite(result.p), `error must not report a valid p-value: ${result.p}`);
  assert.ok(!Number.isFinite(result.W), `error must not report a valid W: ${result.W}`);
  if (pattern) assert.match(result.error, pattern);
  return result;
}
function sameInference(got, expected, label) {
  near(got.W, expected.W, `${label} W`);
  near(got.p, expected.p, `${label} p`);
  assert.strictEqual(got.df1, expected.df1);
  assert.strictEqual(got.df2, expected.df2);
}

// Fixed anchors independently evaluated with Python/SciPy 1.17.1:
// scipy.stats.levene(*groups, center='median'), numpy.var(g, ddof=1).
// Runtime testing does not need Python, NumPy, SciPy, or network access.
const fixtures = [
  {
    name: 'SciPy published three-group example',
    // Published data, p, and ddof=1 variances:
    // https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.levene.html
    groups: [
      [8.88, 9.12, 9.04, 8.98, 9.00, 9.08, 9.01, 8.85, 9.06, 8.99],
      [8.88, 8.95, 9.29, 9.44, 9.15, 9.58, 8.36, 9.18, 8.67, 9.05],
      [8.95, 9.12, 8.95, 8.85, 9.03, 8.84, 9.07, 8.98, 8.86, 8.98],
    ],
    ns: [10, 10, 10], medians: [9.005, 9.1, 8.965],
    variances: [0.007054444444444413, 0.13073888888888888, 0.008890000000000002],
    W: 7.584952754501659, p: 0.002431505967249681,
  },
  {
    name: 'balanced odd medians, exact rational anchor',
    // Z means = 2/3, 4/3, 2; SSB = 8/3; SSW = 28/3.
    // W = (6/2)(8/28) = 6/7. For F(2,6), SF(W) = (1+W/3)^(-3).
    groups: [[-1, 0, 1], [-2, 0, 2], [-3, 0, 3]],
    ns: [3, 3, 3], medians: [0, 0, 0], variances: [1, 4, 9],
    W: 6 / 7, p: 343 / 729,
  },
  {
    name: 'balanced even medians, sample not population variance',
    groups: [[-2, -1, 1, 2], [-4, -2, 2, 4], [9, 10, 12, 13]],
    ns: [4, 4, 4], medians: [0, 0, 11], variances: [10 / 3, 40 / 3, 10 / 3],
    W: 4.5, p: 0.04419417382415922,
  },
  {
    name: 'unbalanced groups weight the grand absolute deviation by n',
    groups: [[1, 2, 4], [0, 2, 5, 9], [-3, 0, 1, 7, 12, 18]],
    ns: [3, 4, 6], medians: [2, 3.5, 4],
    variances: [7 / 3, 46 / 3, 64.56666666666666],
    W: 3.326454033771107, p: 0.07808175700827916,
  },
  {
    name: 'outlier fixture distinguishes median from mean centering',
    groups: [[0, 1, 2, 3, 100], [0, 2, 4, 6, 8, 10]],
    ns: [5, 6], medians: [2, 5], variances: [1941.7, 14],
    W: 0.9849151537642233, p: 0.3469190726740529,
  },
  {
    name: 'one constant group is valid when pooled absolute deviations vary',
    groups: [[5, 5, 5], [-2, 0, 2]],
    ns: [3, 3], medians: [5, 0], variances: [0, 4],
    W: 4, p: 0.11611652351681556,
  },
  {
    name: 'one two-point group with a nondegenerate larger group',
    groups: [[1, 3], [-4, -1, 0, 1, 4]],
    ns: [2, 5], medians: [2, 0], variances: [2, 8.5],
    W: 0.5102040816326531, p: 0.5070005064194051,
  },
  {
    name: 'two-group analytic W=4/5 anchor',
    groups: [[-1, 0, 1], [-2, 0, 2]],
    ns: [3, 3], medians: [0, 0], variances: [1, 4],
    W: 4 / 5, p: 0.42164825517619414,
  },
];

check('brownForsythe is exported', () => assert.strictEqual(typeof T.brownForsythe, 'function'));
for (const fixture of fixtures) {
  check(fixture.name, () => {
    const result = valid(fixture.groups);
    assert.deepStrictEqual(result.ns, fixture.ns);
    vector(result.medians, fixture.medians, 'medians');
    vector(result.variances, fixture.variances, 'sample variances');
    vector(result.sds, fixture.variances.map(Math.sqrt), 'sample sds');
    near(result.W, fixture.W, 'W');
    near(result.p, fixture.p, 'upper-tail p');
  });
}

const unbalanced = fixtures[3].groups;
check('raw arrays, named descriptors, and mixed groups agree', () => {
  const raw = valid(unbalanced);
  const named = valid(unbalanced.map((values, i) => ({ name: `Sample ${i}`, values })));
  const mixed = valid([unbalanced[0], { name: 'B', values: unbalanced[1] }, unbalanced[2]]);
  assert.deepStrictEqual(named, raw);
  assert.deepStrictEqual(mixed, raw);
});
check('frozen inputs and descriptors are not mutated', () => {
  const groups = unbalanced.map((values, i) => Object.freeze({ name: `G${i}`, values: Object.freeze(values.slice().reverse()) }));
  const before = groups.map((g) => ({ name: g.name, values: g.values.slice() }));
  Object.freeze(groups);
  const result = valid(groups);
  assert.deepStrictEqual(groups, before);
  assert.deepStrictEqual(valid(groups), result);
});
check('group permutation preserves inference and reorders descriptions', () => {
  const original = valid(unbalanced);
  const permuted = valid([unbalanced[2], unbalanced[0], unbalanced[1]]);
  sameInference(permuted, original, 'group permutation');
  for (const field of ['ns', 'medians', 'variances', 'sds']) {
    vector(permuted[field], [original[field][2], original[field][0], original[field][1]], field);
  }
});
check('within-group observation order does not matter', () => {
  sameInference(valid(unbalanced.map((g) => g.slice().reverse())), valid(unbalanced), 'observation order');
});
check('separate group translations test variances, not means', () => {
  const offsets = [1000, -2000, 3e9];
  const original = valid(unbalanced);
  const shifted = valid(unbalanced.map((g, i) => g.map((x) => x + offsets[i])));
  sameInference(shifted, original, 'independent translations');
  vector(shifted.medians, original.medians.map((m, i) => m + offsets[i]), 'translated medians');
  vector(shifted.variances, original.variances, 'translation-invariant sample variances');
});
for (const scale of [7, -3.5, 1e150, 1e-150]) {
  check(`common scale ${scale} preserves W and p`, () => {
    const original = valid(unbalanced);
    const scaled = valid(unbalanced.map((g) => g.map((x) => x * scale)));
    sameInference(scaled, original, 'scale invariance');
    original.variances.forEach((v, i) => near(scaled.variances[i], v * scale * scale, 'scaled variance', 3e-12, 0));
    original.sds.forEach((s, i) => near(scaled.sds[i], s * Math.abs(scale), 'scaled sd', 3e-12, 0));
  });
}
check('valid W=0 has p=1, unlike a zero denominator', () => {
  const result = valid([[1, 2, 3], [101, 102, 103]]);
  assert.strictEqual(result.W, 0);
  assert.strictEqual(result.p, 1);
});
check('equal mean absolute deviations need not imply equal sample variances', () => {
  const result = valid([[0, 0, 0, 4], [-1, -1, 1, 1]]);
  assert.strictEqual(result.W, 0);
  assert.strictEqual(result.p, 1);
  vector(result.variances, [4, 4 / 3], 'unequal sample variances');
});
check('near-zero but positive within-deviation variation is not rejected', () => {
  const result = valid([[-1, -1, 1, 1 + 1e-9], [-2, -2, 2, 2 + 1e-9]]);
  assert.ok(result.W > 1e15);
  assert.ok(result.p < 1e-30);
});

check('missing, whitespace-only, NaN, and nonnumeric cells are omitted', () => {
  const groups = unbalanced.map((g) => [null, '', '  ', '\t\n', undefined, NaN, 'NaN', 'bad', ...g.map(String)]);
  assert.deepStrictEqual(valid(groups), valid(unbalanced));
});
check('numeric zero and trimmed numeric strings are retained', () => {
  assert.deepStrictEqual(valid([[' -1 ', '0', ' 1'], ['-2', 0, '2']]), valid([[-1, 0, 1], [-2, 0, 2]]));
});
check('booleans, objects, arrays, BigInts, and Symbols are not numeric cells', () => {
  const junk = [true, false, {}, [], [8], 2n, Symbol('cell'), new Number(9)];
  assert.deepStrictEqual(valid(unbalanced.map((g) => [...junk, ...g])), valid(unbalanced));
});
check('sparse observation arrays treat holes as missing', () => {
  const sparse = [-1, , 0, , 1];
  assert.deepStrictEqual(valid([sparse, [-2, 0, 2]]), valid([[-1, 0, 1], [-2, 0, 2]]));
});
for (const value of [Infinity, -Infinity, 'Infinity', '-Infinity', '1e999']) {
  check(`nonfinite observation ${String(value)} is rejected, not omitted`, () => {
    invalid([[1, 2, 3, value], [1, 4, 8]], /finite|infinity/i);
  });
}
for (const [name, input] of [
  ['undefined input', undefined], ['null input', null], ['object input', {}],
  ['string input', '1,2,3'], ['empty group list', []], ['only one group', [[1, 2, 3]]],
  ['flat array instead of groups', [1, 2, 3]], ['null group', [[1, 2, 3], null]],
  ['undefined group', [[1, 2, 3], undefined]], ['descriptor without values', [[1, 2, 3], { name: 'bad' }]],
  ['descriptor with nonarray values', [[1, 2, 3], { values: '1,2,3' }]],
  ['sparse group list', [[1, 2, 3], , [2, 3, 4]]],
]) {
  check(`invalid structure: ${name}`, () => invalid(input));
}
for (const [name, groups] of [
  ['empty group is not silently removed', [[1, 2, 3], [], [2, 3, 4]]],
  ['singleton group', [[1], [2, 3, 4]]],
  ['singleton after omissions', [[1, null, undefined, '', 'bad', NaN], [2, 3, 4]]],
  ['all missing group', [[null, '', ' ', NaN, 'bad'], [2, 3, 4]]],
]) {
  check(`insufficient data: ${name}`, () => invalid(groups, /two|2|observations/i));
}
for (const [name, groups] of [
  ['identical constants', [[4, 4, 4], [4, 4, 4]]],
  ['different constants', [[4, 4, 4], [9, 9, 9, 9]]],
  ['all two-point groups, unequal spreads', [[1, 3], [2, 8], [7, 15]]],
  ['all two-point groups, equal spreads', [[1, 3], [4, 6]]],
  ['decimal two-point midpoint roundoff', [[0.1, 0.2], [0.2, 0.4]]],
  ['repeated endpoint samples', [[-1, -1, 1, 1], [-2, -2, 2, 2]]],
  ['repeated decimal endpoint samples', [[0.1, 0.1, 0.2, 0.2], [0.2, 0.2, 0.4, 0.4]]],
  ['repeated endpoints with six observations', [[-1, -1, -1, 1, 1, 1], [-10, -10, -10, 10, 10, 10]]],
  ['pairs and constants mixed', [[1, 3], [9, 9, 9]]],
]) {
  check(`zero within-group absolute-deviation variation: ${name}`, () => {
    invalid(groups, /absolute|deviation|variation/i);
  });
}
check('constant absolute deviations do not acquire residuals from summation roundoff', () => {
  for (const n of [2, 4, 6, 10, 14, 50, 100]) {
    const endpoints = (a) => Array.from({ length: n }, (_, i) => i < n / 2 ? -a : a);
    invalid([endpoints(0.1), endpoints(1)], /absolute|deviation|variation/i);
  }
});
check('finite values that overflow calculations do not produce a valid p', () => {
  invalid([[-1e308, 0, 1e308], [-1, 0, 1]], /range|finite|overflow/i);
});

// These independently exercise the actual upper-tail helper; do not use it to
// manufacture expected Brown–Forsythe p-values. F(2,2) has SF(f)=1/(1+f).
check('fDistP at W=0 is exactly 1', () => assert.strictEqual(C.fDistP(0, 2, 27), 1));
for (const f of [0.1, 1, 10, 1e16, 1e100]) {
  check(`fDistP analytic F(2,2) upper tail at ${f}`, () => {
    near(C.fDistP(f, 2, 2), 1 / (1 + f), 'F survival', 3e-12, 0);
  });
}
for (const [f, expected] of [[1e6, 1.8173004120066603e-66], [1e16, 1.8176316429534127e-201]]) {
  check(`fDistP SciPy F(2,27) extreme tail at ${f}`, () => {
    near(C.fDistP(f, 2, 27), expected, 'F extreme survival', 3e-12, 0);
  });
}
check('fDistP tails decrease monotonically to zero', () => {
  const tails = [0, 1e-8, 0.1, 1, 10, 100, 1e6, 1e16, Infinity].map((f) => C.fDistP(f, 2, 27));
  tails.forEach((p, i) => {
    assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
    if (i) assert.ok(p < tails[i - 1], `tail not decreasing at ${i}`);
  });
  assert.strictEqual(tails[tails.length - 1], 0);
});

console.log(`\n${pass} passed, ${fail} failed (Brown–Forsythe variance engine / F tails)`);
process.exitCode = fail ? 1 : 0;
