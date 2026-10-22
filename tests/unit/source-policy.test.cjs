const { test } = require('node:test'), assert = require('node:assert/strict');
test('source privacy rejects private/generated data and literal home paths while retaining public source metadata', async () => {
  const { sourceViolation } = await import('../../scripts/check-source.mjs');
  for (const filename of ['.env', 'config/.env.local', '.credentials.yaml', 'config/.workbuddy-ai-auth.json', 'profiles/desktop/config.yml',
    'runtime/node_modules/library/index.js', 'runtime/bin/node.exe', 'runtime/host.mjs', 'runtime/startup-bundle-manifest.json',
    '.test-work/results.json', 'outputs/package.vsix', 'session.jsonl.zstd', 'local.sqlite', 'extension.zip']) {
    assert.notEqual(sourceViolation(filename, ''), null, filename);
  }
  for (const filename of ['src/runtime/host.mjs', 'scripts/ci-tools.json', '.github/workflows/ci.yml', 'runtime/package-lock.json',
    'runtime/licenses.json', 'runtime/node-version.json', 'tests/fixtures/startup-leaf-exports.json', 'media/whale.svg', '.env.example']) {
    assert.equal(sourceViolation(filename, 'public synthetic fixture'), null, filename);
  }
  assert.equal(sourceViolation('src/config.ts', ['C:', 'Users', 'synthetic-person', 'file.txt'].join('\\')), 'PERSONAL_HOME_PATH');
  assert.equal(sourceViolation('docs/notes.md', ['', 'home', 'synthetic-person', 'data'].join('/')), 'PERSONAL_HOME_PATH');
  for (const separator of ['\\', '/']) assert.equal(sourceViolation('README.md', ['C:', 'Users', 'synthetic-person'].join(separator)), 'PERSONAL_HOME_PATH');
  assert.equal(sourceViolation('fixture.json', JSON.stringify(['C:', 'Users', 'synthetic-person'].join('\\'))), 'PERSONAL_HOME_PATH');
  for (const directory of ['home', 'Users']) assert.equal(sourceViolation('README.md', ['', directory, 'synthetic-person'].join('/')), 'PERSONAL_HOME_PATH');
  assert.equal(sourceViolation('README.md', 'https://github.com/example/project and process.env.DSH_HOME'), null);
  assert.equal(sourceViolation('tests/network.cjs', '/auth-api/v0/users/logout'), null);
  for (const prefix of ['', '"', 'file://']) {
    assert.equal(sourceViolation('fixture.txt', prefix + ['', 'users', 'synthetic-person'].join('/')), 'PERSONAL_HOME_PATH');
  }
});
