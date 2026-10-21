const { test } = require('node:test'), assert = require('node:assert/strict');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), path = require('node:path');
test('prepared startup dependencies preserve public contracts, shared state and subprocess behavior with fewer reads', { timeout: 30000 }, async () => {
  const runtime = path.resolve('runtime');
  const { stdout } = await promisify(execFile)(path.join(runtime, 'bin/node.exe'), ['tests/startup-leaf-contract.mjs', runtime], { windowsHide: true });
  assert.equal(JSON.parse(stdout).exportsAndBehavior, true);
});
