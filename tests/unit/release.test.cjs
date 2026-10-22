const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), { once } = require('node:events'), yazl = require('yazl'), yaml = require('js-yaml');

const sha = 'a'.repeat(40), jobs = ['Privacy and workflows', 'Quick checks', 'Windows runtime', 'Native VS Code'];
test('release gate requires the exact SHA, main CI and every completed successful job', async () => {
  const { checkReleaseCI } = await import('../../scripts/check-release-ref.mjs');
  const run = { id: 42, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' };
  let runs = [run], rows = jobs.map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const request = async (url, options) => {
    assert.equal(options.method, undefined); assert.match(url, /^https:\/\/api\.github\.com\/repos\/synthetic\/fixture\/actions\//);
    if (url.includes('/workflows/ci.yml/runs?')) { assert.ok(url.includes('head_sha=' + sha)); return Response.json({ workflow_runs: runs }); }
    return Response.json({ total_count: rows.length, jobs: rows });
  };
  assert.equal(await checkReleaseCI(sha, 'synthetic/fixture', 'fixture-token', request), 42);
  for (const replacement of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'topic' }, { event: 'pull_request' }, { status: 'in_progress' }, { conclusion: 'failure' }]) {
    runs = [{ ...run, ...replacement }]; await assert.rejects(checkReleaseCI(sha, 'synthetic/fixture', '', request), /RELEASE_CI_NOT_GREEN/);
  }
  runs = [run];
  for (const conclusion of ['skipped', 'failure', 'cancelled']) {
    rows = jobs.map(name => ({ name, status: 'completed', conclusion: name === 'Native VS Code' ? conclusion : 'success' }));
    await assert.rejects(checkReleaseCI(sha, 'synthetic/fixture', '', request), /RELEASE_CI_JOBS_INCOMPLETE/);
  }
  rows = []; await assert.rejects(checkReleaseCI(sha, 'synthetic/fixture', '', request), /RELEASE_CI_JOBS_INCOMPLETE/);
  await assert.rejects(checkReleaseCI('main; command', 'synthetic/fixture', '', request), /RELEASE_SHA_INVALID/);
  await assert.rejects(checkReleaseCI(sha, 'invalid', '', request), /RELEASE_REPOSITORY_INVALID/);
  await assert.rejects(checkReleaseCI(sha, 'synthetic/fixture', '', async () => new Response('private diagnostic', { status: 403 })), /^Error: RELEASE_CI_HTTP_403$/);
});

test('release preparation remains manual and read-only, with no artifact upload or publication path', async () => {
  const workflow = yaml.load(await fs.readFile('.github/workflows/release.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ['commit']);
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  const job = workflow.jobs.verify; assert.equal(job.if, "github.ref == 'refs/heads/main'"); assert.equal(job.permissions, undefined);
  for (const step of job.steps) {
    if (step.uses) {
      assert.match(step.uses, /^actions\/(checkout|setup-node)@[a-f0-9]{40}$/);
      if (step.uses.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    }
    if (step.run) assert.doesNotMatch(step.run, /git (push|tag)|gh release|vsce publish|upload-artifact|\$\{\{\s*inputs\./);
  }
  const commands = job.steps.map(step => step.run).filter(Boolean);
  for (const command of ['node scripts/check-release-ref.mjs', 'npm run check:source', 'npm run prepare-runtime', 'npm run package', 'npm run check:release', 'npm run test:release']) assert.ok(commands.includes(command));
});

test('release versions and final ZIP enforce metadata, required runtime, privacy and integrity', async t => {
  const { releaseMetadata } = await import('../../scripts/release-metadata.mjs');
  const { checkReleaseArchive, releaseEntryViolation } = await import('../../scripts/check-release.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-release-fixture-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = { name: 'dsh-companion', publisher: 'synthetic', version: '0.0.1' }, runtime = { version: '0.0.1' };
  const files = new Map([
    ['package.json', JSON.stringify(manifest)], ['runtime/package.json', JSON.stringify(runtime)],
    ...['dist/extension.js', 'dist/sidebar.js', 'dist/bootstrap.js', 'dist/sidebar.css', 'media/whale.svg',
      'runtime/bin/node.exe', 'runtime/bin/NODE-LICENSE', 'runtime/licenses.json', 'runtime/node-version.json', 'runtime/host.mjs',
      'runtime/import.mjs', 'runtime/workbuddy-auth.mjs', 'runtime/bundle-manifest.json', 'runtime/startup-bundle-manifest.json',
      'LICENSE', 'THIRD_PARTY_NOTICES.md'].map(name => [name, 'synthetic-public-artifact'])
  ]);
  for (const [name, content] of files) { const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
  const lock = { version: '0.0.1', packages: { '': { version: '0.0.1' } } };
  for (const name of ['package-lock.json', 'runtime/package-lock.json']) await fs.writeFile(path.join(root, name), JSON.stringify(lock));
  assert.equal((await releaseMetadata(root)).filename, 'dsh-companion-0.0.1-win32-x64.vsix');
  await fs.writeFile(path.join(root, 'runtime/package-lock.json'), JSON.stringify({ ...lock, packages: { '': { version: '0.0.2' } } }));
  await assert.rejects(releaseMetadata(root), /RELEASE_VERSION_MISMATCH/);
  await fs.writeFile(path.join(root, 'runtime/package-lock.json'), JSON.stringify(lock));
  const identity = '<Identity Id="dsh-companion" Publisher="synthetic" Version="0.0.1" TargetPlatform="win32-x64"/>';
  async function archive({ omit, extra, xml = identity } = {}) {
    const zip = new yazl.ZipFile(), chunks = [];
    zip.outputStream.on('data', chunk => chunks.push(chunk));
    for (const [name, text] of files) if (name !== omit) zip.addBuffer(Buffer.from(text), 'extension/' + name);
    zip.addBuffer(Buffer.from('<Types/>'), '[Content_Types].xml'); zip.addBuffer(Buffer.from(xml), 'extension.vsixmanifest');
    if (extra) zip.addBuffer(Buffer.from(extra[1]), extra[0]);
    const done = once(zip.outputStream, 'end'); zip.end(); await done;
    const target = path.join(root, 'fixture.vsix'); await fs.writeFile(target, Buffer.concat(chunks)); return target;
  }
  const inspect = async options => checkReleaseArchive(root, await archive(options), await fs.mkdtemp(path.join(root, 'scan-')));
  assert.equal((await inspect()).files, files.size + 2);
  await assert.rejects(inspect({ omit: 'runtime/bin/node.exe' }), /RELEASE_REQUIRED_FILE_MISSING/);
  await assert.rejects(inspect({ xml: identity.replace('0.0.1', '0.0.2') }), /RELEASE_VSIX_MANIFEST_MISMATCH/);
  for (const entry of ['extension/runtime/.credentials.yaml', 'extension/runtime/node_modules/vendor/.env', 'extension/runtime/node_modules/vendor/session.jsonl.zstd',
    'extension/runtime/node_modules/vendor/archive.zip', 'extension/runtime/node_modules/vendor/.coveralls.yml', 'extension/profiles/local.json', 'extension/dist/test/private.js']) {
    await assert.rejects(inspect({ extra: [entry, 'synthetic-private-data'] }), /RELEASE_(PRIVATE|UNEXPECTED)_ENTRY/);
  }
  await assert.rejects(inspect({ extra: ['extension/README.md', ['C:', 'Users', 'synthetic-person'].join('\\')] }), /RELEASE_PERSONAL_HOME_PATH/);
  await assert.rejects(inspect({ extra: ['extension/runtime/node_modules/vendor/file.js', os.homedir()] }), /RELEASE_PERSONAL_HOME_PATH/);
  for (const entry of ['/absolute', '../outside', 'extension/../outside', 'extension\\file', 'extension/file:stream']) assert.equal(releaseEntryViolation(entry), 'RELEASE_UNSAFE_PATH');
  const target = await archive(), corrupted = await fs.readFile(target), central = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupted.writeUInt32LE((corrupted.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16); await fs.writeFile(target, corrupted);
  await assert.rejects(checkReleaseArchive(root, target, await fs.mkdtemp(path.join(root, 'scan-'))), /RELEASE_ARCHIVE_CORRUPT/);
});
