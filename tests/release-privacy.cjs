// Requires only the pinned security tool, never DSH or personal authorization.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
test('the archive scanner detects vendor canaries and only accepts exact reviewed public file hashes', async t => {
  const { scanReleaseContents } = await import('../scripts/check-release.mjs');
  const source = process.cwd(), root = await fs.mkdtemp(path.join(source, '.test-work/release/scanner-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'archive'), tool = '.test-work/ci-tools/gitleaks/gitleaks.exe';
  await fs.mkdir(path.dirname(path.join(root, tool)), { recursive: true });
  await fs.copyFile(path.join(source, tool), path.join(root, tool));
  await fs.mkdir(path.join(root, '.test-work/release'), { recursive: true }); await fs.mkdir(path.join(root, 'scripts'));
  const reviewed = path.join(root, 'scripts/release-public-findings.json'); await fs.writeFile(reviewed, '[]');
  const vendor = path.join(directory, 'extension/runtime/node_modules/synthetic'); await fs.mkdir(vendor, { recursive: true });
  const file = path.join(vendor, 'example.js'); await fs.writeFile(file, 'export const publicValue = "fixture";\n');
  await scanReleaseContents(root, directory);
  const canary = 'ghp_' + createHash('sha256').update('synthetic-release-canary').digest('hex').slice(0, 36);
  await fs.writeFile(file, 'const token = ' + JSON.stringify(canary) + '; // gitleaks:allow\n');
  await assert.rejects(scanReleaseContents(root, directory), /^Error: RELEASE_SECRET_SCAN_FAILED$/);
  const record = { file: 'extension/runtime/node_modules/synthetic/example.js', sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex'), rules: ['github-pat'] };
  await fs.writeFile(reviewed, JSON.stringify([record]));
  assert.equal((await scanReleaseContents(root, directory)).reviewedPublicFindings, 1);
  await fs.appendFile(file, '\n// changed package bytes\n');
  await assert.rejects(scanReleaseContents(root, directory), /^Error: RELEASE_SECRET_SCAN_FAILED$/);
});
