// Symbol shortcuts (\alpha → α …). Run: node tests/symbols.check.js
const assert = require('assert');
const Sym = require('../js/symbols.js');

let pass = 0;
function ok(name, condition) { assert.ok(condition, name); console.log('PASS', name); pass++; }

ok('Greek names map to Greek letters', Sym.lookup('alpha') === 'α' && Sym.lookup('mu') === 'μ' && Sym.lookup('omega') === 'ω');
ok('capital names map to capital letters', Sym.lookup('Delta') === 'Δ' && Sym.lookup('delta') === 'δ' && Sym.lookup('Sigma') === 'Σ');
ok('micro sign is distinct from Greek mu', Sym.lookup('micro') === 'µ' && Sym.lookup('micro') !== Sym.lookup('mu'));
ok('math and unit shortcuts', Sym.lookup('pm') === '±' && Sym.lookup('le') === '≤' && Sym.lookup('leq') === '≤' && Sym.lookup('deg') === '°' && Sym.lookup('AA') === 'Å');
ok('superscript runs', Sym.lookup('^2') === '²' && Sym.lookup('^-1') === '⁻¹' && Sym.lookup('^(n+1)') === '⁽ⁿ⁺¹⁾');
ok('subscript runs', Sym.lookup('_0') === '₀' && Sym.lookup('_50') === '₅₀' && Sym.lookup('_max') === 'ₘₐₓ');
ok('unknown names are left alone', Sym.lookup('alphabet') === null && Sym.lookup('^q') === null && Sym.lookup('^') === null && Sym.lookup('') === null);

let hit = Sym.shortcutBefore('IFN-\\gamma', 10);
ok('shortcut at the caret is found with its range', hit && hit.symbol === 'γ' && hit.start === 4 && hit.end === 10);
hit = Sym.shortcutBefore('cm\\^-2 later', 6);
ok('shortcut before the caret, not at the end of text', hit && hit.symbol === '⁻²' && hit.start === 2);
ok('the longest name wins (\\int is not \\in + t)', Sym.shortcutBefore('\\int', 4).symbol === '∫');
ok('text without a backslash is untouched', Sym.shortcutBefore('alpha', 5) === null);
ok('unknown shortcut is untouched', Sym.shortcutBefore('C:\\Users', 8) === null);

const all = Sym.GROUPS.flatMap((g) => g.items);
ok('every palette entry has a symbol and a name', all.every((it) => it[0] && it[1]));
ok('every listed shortcut resolves to its own symbol', all.every((it) => !it[2] || Sym.lookup(it[2]) === it[0]));
ok('palette groups cover Greek, math, scripts and units', ['greek', 'math', 'script', 'units'].every((id) => Sym.GROUPS.some((g) => g.id === id && g.items.length >= 20)));

console.log(`\n${pass} symbol checks passed`);
