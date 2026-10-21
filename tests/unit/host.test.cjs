const { test } = require('node:test'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('host owns a bounded lifecycle including incomplete startup', async () => {
  await promisify(execFile)(process.execPath, ['--experimental-vm-modules', 'tests/host-lifecycle.mjs'], { windowsHide: true });
});
