// Unit tests for the .prism interpreter (js/prism-import.js).
// Builds an in-memory { path -> text } file map shaped like a real Prism archive
// and checks the mapping to StatLab tables. No ZIP/binary needed — the unzip path
// (DecompressionStream) is exercised in the browser preview instead.
const P = require('../js/prism-import.js');

let pass = 0, fail = 0;
function ok(name, cond) { console.log((cond ? 'PASS' : 'FAIL').padEnd(5), name); cond ? pass++ : fail++; }
function eq(name, got, exp) { ok(name + `  (got=${JSON.stringify(got)} exp=${JSON.stringify(exp)})`, JSON.stringify(got) === JSON.stringify(exp)); }

const files = {};
const put = (p, o) => { files[p] = typeof o === 'string' ? o : JSON.stringify(o); };

// ----- document.json -----
put('document.json', {
  sheets: { data: ['G', 'X', 'V', 'C'], analyses: ['AN'], info: ['IN'] },
  sheetAttributesMap: {
    G: { title: 'Grouped demo' }, X: { title: 'XY demo' }, V: { title: 'Survival demo' }, C: { title: 'Column demo' },
  },
});

// ----- Grouped: 2 groups × 2 replicates, ranges are RELATIVE ("0~1" for both) -----
put('data/sheets/G/sheet.json', { title: 'Grouped demo', table: { uid: 'TG', format: 'grouped', dataFormat: 'y_replicates', replicatesCount: 2, rowTitlesDataSet: 'RT', dataSets: ['S1', 'S2'] } });
put('data/sets/RT.json', { format: 'text', attributes: ['DS_ATTR_RT'] });
put('data/sets/S1.json', { title: 'CTRL', attributes: ['DS_ATTR_Y'], 'replicate ranges': [{ range: '0~1' }] });
put('data/sets/S2.json', { title: 'TREAT', attributes: ['DS_ATTR_Y'], 'replicate ranges': [{ range: '0~1' }] });
put('data/tables/TG/data.csv', 'r1,10,11,20,21\nr2,12,13,22,23\n');

// ----- XY: replicate averaging; range with a singleton token ("0","1") -----
put('data/sheets/X/sheet.json', { title: 'XY demo', table: { uid: 'TX', format: 'xy', dataFormat: 'y_replicates', replicatesCount: 2, xDataSet: 'XX', dataSets: ['Y1', 'Y2'] } });
put('data/sets/XX.json', { title: 'Dose', attributes: ['DS_ATTR_X'] });
put('data/sets/Y1.json', { title: 'A', attributes: ['DS_ATTR_Y'], 'replicate ranges': [{ range: '0' }, { range: '1' }] });
put('data/sets/Y2.json', { title: 'B', attributes: ['DS_ATTR_Y'], 'replicate ranges': [{ range: '0' }, { range: '1' }] });
put('data/tables/TX/data.csv', '1,5,7,50,70\n2,6,,60,80\n'); // row1 A has an empty replicate

// ----- Survival: leading empty row-title col + X(time) col, then group status cols -----
put('data/sheets/V/sheet.json', { title: 'Survival demo', table: { uid: 'TV', format: 'survival', dataFormat: 'y_single', rowTitlesDataSet: 'RV', xDataSet: 'XV', dataSets: ['G1', 'G2'] } });
put('data/sets/RV.json', { format: 'text', attributes: ['DS_ATTR_RT'] });
put('data/sets/XV.json', { title: 'Days', attributes: ['DS_ATTR_X'] });
put('data/sets/G1.json', { title: 'Drug', attributes: ['DS_ATTR_Y'] });
put('data/sets/G2.json', { title: 'Placebo', attributes: ['DS_ATTR_Y'] });
put('data/tables/TV/data.csv', ',5,1,\n,8,,0\n,9,0,\n');

// ----- Column: two groups, no leading columns, unequal lengths -----
put('data/sheets/C/sheet.json', { title: 'Column demo', table: { uid: 'TC', format: 'column', dataFormat: 'y_single', dataSets: ['C1', 'C2'] } });
put('data/sets/C1.json', { title: 'Low', attributes: ['DS_ATTR_Y'] });
put('data/sets/C2.json', { title: 'High', attributes: ['DS_ATTR_Y'] });
put('data/tables/TC/data.csv', '3,30\n4,40\n5,\n');

// ----- Analysis linked to the XY sheet, with a floating note -----
put('analyses/AN/sheet.json', { title: 't test of XY demo', inputSheets: [{ uid: 'X', title: 'XY demo' }], alertText: '' });
put('analyses/AN/floating_notes/n.json', { text: { string: 'Unpaired t test\rP = 0.0123\rLearn more' } });

// ----- Info sheet -----
put('info/IN/sheet.json', { title: 'Info', notesText: 'My project', constants: [{ name: 'Experimenter', value: 'DM' }, { name: 'Empty', value: '' }] });

const { tableSpecs, warnings } = P.interpret(files);
const byName = (n) => tableSpecs.find((t) => t.name === n);

eq('table count', tableSpecs.length, 4);
eq('no warnings', warnings, []);

const g = byName('Grouped demo');
eq('grouped groupNames', g.groupNames, ['CTRL', 'TREAT']);
eq('grouped nsub', g.nsub, 2);
eq('grouped rowTitles', g.rowTitles, ['r1', 'r2']);
eq('grouped row0 (relative ranges resolved sequentially)', g.rows[0], ['10', '11', '20', '21']);
eq('grouped row1', g.rows[1], ['12', '13', '22', '23']);

const x = byName('XY demo');
eq('xy columns', x.columns.map((c) => c.name), ['Dose', 'A', 'B']);
eq('xy roles', x.columns.map((c) => c.role), ['x', 'y', 'y']);
eq('xy row0 (means of replicates)', x.rows[0], ['1', '6', '60']); // A=(5+7)/2, B=(50+70)/2
eq('xy row1 (empty replicate ignored)', x.rows[1], ['2', '6', '70']); // A=6 (only one value), B=(60+80)/2

const v = byName('Survival demo');
eq('survival columns', v.columns.map((c) => c.name), ['Time', 'Status', 'Group']);
eq('survival long rows', v.rows, [['5', '1', 'Drug'], ['9', '0', 'Drug'], ['8', '0', 'Placebo']]);

const c = byName('Column demo');
eq('column names', c.columns.map((cc) => cc.name), ['Low', 'High']);
eq('column rows (unequal lengths padded)', c.rows, [['3', '30'], ['4', '40'], ['5', '']]);

ok('xy notes mention the Prism analysis title', /t test of XY demo/.test(x.notes));
ok('xy notes include floating-note result text', /P = 0\.0123/.test(x.notes));
ok('xy notes drop "Learn more" help link', !/Learn more/.test(x.notes));
ok('xy notes marked as imported from Prism', /Imported from GraphPad Prism/.test(x.notes));
ok('xy notes leave a space for the user', /Your notes/.test(x.notes));
ok('first table carries project info', /My project/.test(g.notes) && /Experimenter: DM/.test(g.notes));

// ----- Rich-text (object) titles: real Prism files store titles as objects,
// not plain strings (issue #27). Headings must resolve to their plain text,
// never "[object Object]". -----
const rt = {};
const putR = (p, o) => { rt[p] = typeof o === 'string' ? o : JSON.stringify(o); };
putR('document.json', { sheets: { data: ['RG'] } });
putR('data/sheets/RG/sheet.json', { title: { rtf: '{\\rtf1 Grouped}', string: 'Grouped (rich)' }, table: { uid: 'TRG', format: 'grouped', dataFormat: 'y_replicates', replicatesCount: 2, rowTitlesDataSet: 'RRT', dataSets: ['RS1', 'RS2'] } });
putR('data/sets/RRT.json', { format: 'text', attributes: ['DS_ATTR_RT'] });
putR('data/sets/RS1.json', { title: { rtf: '{\\rtf1 Control}', string: 'Control' }, attributes: ['DS_ATTR_Y'], 'replicate ranges': [{ range: '0~1' }] });
putR('data/sets/RS2.json', { title: { string: 'Treated' }, attributes: ['DS_ATTR_Y'], 'replicate ranges': [{ range: '0~1' }] });
putR('data/tables/TRG/data.csv', 'r1,10,11,20,21\n');
const rres = P.interpret(rt);
const rg = rres.tableSpecs.find((t) => /Grouped/.test(t.name));
eq('object title -> group names use plain text', rg.groupNames, ['Control', 'Treated']);
eq('object title -> sheet name uses plain text', rg.name, 'Grouped (rich)');
ok('no "[object Object]" heading leaks through', !rg.groupNames.some((n) => /\[object Object\]/.test(n)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
