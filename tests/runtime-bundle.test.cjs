const { test } = require('node:test'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const path = require('node:path'), assert = require('node:assert/strict');
test('prepared TypeBox keeps public contracts and shared state without hundreds of file reads', { timeout: 30000 }, async () => {
  const runtime = path.resolve('runtime');
  const { stdout } = await promisify(execFile)(path.join(runtime, 'bin/node.exe'), ['tests/typebox-contract.mjs', runtime], { windowsHide: true });
  const result = JSON.parse(stdout);
  assert.equal(result.exportsAndBehavior, true); assert.equal(result.publicEntries, 9);
});
