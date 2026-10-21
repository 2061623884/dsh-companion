const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
test('CI tool preparation rejects a corrupt cached download before extraction or execution', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ci-tool-fixture-'));
  const scripts = path.join(root, 'scripts'), tools = path.join(root, '.test-work/ci-tools');
  await fs.mkdir(scripts); await fs.mkdir(tools, { recursive: true });
  for (const name of ['prepare-ci-tools.ps1', 'ci-tools.json']) await fs.copyFile('scripts/' + name, path.join(scripts, name));
  const metadata = JSON.parse(await fs.readFile('scripts/ci-tools.json', 'utf8'));
  await fs.writeFile(path.join(tools, 'gitleaks-' + metadata.gitleaks.version + '.zip'), 'synthetic corrupt archive');
  await assert.rejects(promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(scripts, 'prepare-ci-tools.ps1')], { windowsHide: true }),
    error => error.code !== 0 && /CI tool checksum mismatch/.test(error.stderr));
  await assert.rejects(fs.access(path.join(tools, 'gitleaks/gitleaks.exe')), { code: 'ENOENT' });
});
