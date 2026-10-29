const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRecovery, writeRecovery } = require('../electron/project-session');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-session-store-'));
const file = path.join(temp, 'profile', 'project-recovery.json');
const source = path.join(temp, 'project.json');
const state = { tables: [{ id: 'table1', name: 'Recovered data' }], results: [], graphs: [] };
const json = JSON.stringify(state);
let pass = 0;
function ok(name, condition) { assert.ok(condition, name); console.log('PASS', name); pass++; }
try {
  ok('missing recovery record is safe', readRecovery(file) === null);
  writeRecovery(file, json, source, 'first-checkpoint');
  assert.deepStrictEqual(readRecovery(file), { state, filePath: source, checkpointId: 'first-checkpoint' });
  ok('snapshot and native destination round-trip together', true);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => writeRecovery(file, '{invalid', source), SyntaxError);
  assert.throws(() => writeRecovery(file, '{}', source), /Invalid recovery snapshot/);
  ok('invalid checkpoints leave the preceding record unchanged', fs.readFileSync(file, 'utf8') === before);

  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('Injected rename failure'); };
  try { assert.throws(() => writeRecovery(file, json, null), /Injected rename failure/); }
  finally { fs.renameSync = rename; }
  ok('failed atomic replacement preserves the old snapshot and destination', fs.readFileSync(file, 'utf8') === before);
  ok('failed replacement leaves no temporary records', fs.readdirSync(path.dirname(file)).length === 1);

  writeRecovery(file, json, null);
  ok('unsaved recovery has an explicit null association', readRecovery(file).filePath === null);
  for (const filePath of ['relative.json', 42, {}, '']) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, state, filePath }));
    assert.deepStrictEqual(readRecovery(file), { state, filePath: null, checkpointId: null });
  }
  ok('invalid native path metadata preserves data but never binds a destination', true);
  for (const record of ['not JSON', 'null', JSON.stringify({ version: 2, state }), JSON.stringify({ version: 1, state: {} })]) {
    fs.writeFileSync(file, record);
    assert.strictEqual(readRecovery(file), null);
  }
  ok('corrupt and unsupported recovery records are ignored safely', true);
  console.log(`\n${pass} project recovery store checks passed`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
