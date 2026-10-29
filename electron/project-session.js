// Desktop-only recovery metadata. Portable project JSON never contains a path.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function validState(state) {
  return state && typeof state === 'object' && Array.isArray(state.tables) &&
    Array.isArray(state.results) && Array.isArray(state.graphs);
}

function readRecovery(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.version !== 1 || !validState(record.state)) return null;
    return {
      state: record.state,
      checkpointId: typeof record.checkpointId === 'string' ? record.checkpointId : null,
      // Invalid path metadata must not make otherwise recoverable data unusable.
      filePath: typeof record.filePath === 'string' && path.isAbsolute(record.filePath) ? record.filePath : null,
    };
  } catch (e) { return null; }
}

function writeRecovery(file, json, filePath, checkpointId = randomUUID()) {
  const state = JSON.parse(json);
  if (!validState(state)) throw new Error('Invalid recovery snapshot');
  const record = { version: 1, state, filePath: filePath || null, checkpointId };
  // Write the data and its association as one atomic record. A failed checkpoint
  // leaves the preceding complete record available rather than truncated JSON.
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch (e) { /* best-effort cleanup */ }
  }
}

module.exports = { readRecovery, writeRecovery };
