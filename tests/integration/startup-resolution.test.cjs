const { test } = require('node:test'), assert = require('node:assert/strict');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), path = require('node:path');
test('prepared installation resolution preserves package choices and live profile updates without rescanning', { timeout: 30000 }, async () => {
  const runtime = path.resolve('runtime');
  const { stdout } = await promisify(execFile)(path.join(runtime, 'bin/node.exe'),
    ['--expose-internals', 'tests/startup-resolution-contract.mjs', runtime], { windowsHide: true });
  assert.equal(JSON.parse(stdout).contracts, true);
});
