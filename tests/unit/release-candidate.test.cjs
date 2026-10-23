const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const versions = ['1.106.0', '1.124.2'], filename = 'fixture-0.0.1-win32-x64.vsix';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-materials-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (file, data) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data)); };
  await write('.gitignore', '.test-work/\n');
  const manifest = { name: 'fixture', publisher: 'synthetic', version: '0.0.1', repository: { url: 'https://github.com/synthetic/project.git' }, engines: { vscode: '^1.106.0' } };
  await write('package.json', manifest); await write('runtime/package.json', { version: '0.0.1' });
  const lock = { version: '0.0.1', packages: { '': { version: '0.0.1' } } };
  await write('package-lock.json', lock); await write('runtime/package-lock.json', lock);
  await write('scripts/ci-tools.json', { vscodeVersion: '1.124.2' });
  await write('CHANGELOG.md', '# Changelog\n\n## 0.0.1\n\n### 修复\n\n- Synthetic user-facing change.\n\n## 0.0.0\n\nOld entry.\n');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic baseline']);
  const { releaseSource } = await import('../../scripts/release-source.mjs'), source = await releaseSource(root);
  const bytes = 'synthetic already-verified package bytes', sha256 = hash(bytes), output = '.test-work/release/';
  await write(output + filename, bytes); await write(output + 'build-source.json', { ...source, sha256 });
  const archive = { version: '0.0.1', id: 'synthetic.fixture', filename, target: 'win32-x64', files: 2, scannedFiles: 2, reviewedPublicFindings: 0, sha256 };
  const installed = { version: '0.0.1', sha256, results: versions.map(vscodeVersion => ({ vscodeVersion, installedPackage: true,
    workspaceBound: true, unsavedReference: true, draftRestored: true, desktopUnchanged: true, ownedRuntimeExited: true,
    sharedLogin: true, sharedSignOut: true, loadingDismissed: true, interceptedPrompts: 1, generationCalls: 0,
    privateFixtureOnly: 'not copied to public metadata' })) };
  await write(output + 'archive-check.json', archive); await write(output + 'installed-check.json', installed);
  return { root, write, git, source, bytes, sha256, expected: { commit: source.commit, sha256 }, archive, installed, output };
}
async function rechecksum(directory) {
  const text = await Promise.all([filename, 'release.json', 'release-notes.md'].map(async name => hash(await fs.readFile(path.join(directory, name))) + '  ' + name));
  await fs.writeFile(path.join(directory, 'SHA256SUMS'), text.join('\n') + '\n');
}

test('candidate generation reuses bytes, produces bounded user-facing metadata and never publishes', async t => {
  const f = await fixture(t), { prepareCandidate, inspectCandidate, previewCandidate } = await import('../../scripts/release-candidate.mjs');
  const directory = await prepareCandidate(f.root, {}), release = await inspectCandidate(f.root, directory, f.expected);
  assert.deepEqual((await fs.readdir(directory)).sort(), [filename, 'release.json', 'release-notes.md', 'SHA256SUMS'].sort());
  assert.equal((await fs.readFile(path.join(directory, filename), 'utf8')), f.bytes);
  assert.equal(release.source.dirty, false); assert.equal(release.verification.scope, 'local');
  assert.doesNotMatch(JSON.stringify(release), /privateFixtureOnly|not copied/);
  const notes = await fs.readFile(path.join(directory, 'release-notes.md'), 'utf8');
  assert.match(notes, /Synthetic user-facing change/); assert.doesNotMatch(notes, /Old entry/);
  assert.match(notes, /Get-FileHash/); assert.match(notes, /本地预演/);
  assert.equal(await prepareCandidate(f.root, {}), directory);
  let requests = 0;
  const plan = await previewCandidate(f.root, directory, f.expected, { request: async () => { requests++; throw new Error('unexpected network'); } });
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.publicationEnabled, false); assert.equal(plan.remoteStatus, 'not-checked'); assert.equal(requests, 0);
  await assert.rejects(previewCandidate(f.root, directory, f.expected, { online: true }), /HOSTED_EVIDENCE_REQUIRED/);
  assert.equal(f.git(['for-each-ref', '--format=%(refname)', 'refs/tags']), '');
});

test('candidate checks reject tampering, wrong sources, private entries, missing files and conflicting reuse', async t => {
  const f = await fixture(t), { prepareCandidate, inspectCandidate } = await import('../../scripts/release-candidate.mjs');
  const directory = await prepareCandidate(f.root, {}), file = name => path.join(directory, name);
  await assert.rejects(inspectCandidate(f.root, directory, { ...f.expected, commit: 'b'.repeat(40) }), /IDENTITY_MISMATCH/);
  await assert.rejects(inspectCandidate(f.root, directory, { ...f.expected, sha256: 'c'.repeat(64) }), /IDENTITY_MISMATCH/);
  await fs.writeFile(file(filename), f.bytes + 'changed');
  await assert.rejects(inspectCandidate(f.root, directory, f.expected), /IDENTITY_MISMATCH/);
  await fs.writeFile(file(filename), f.bytes);
  const original = await fs.readFile(file('release.json'), 'utf8'), value = JSON.parse(original);
  for (const mutation of [r => r.source.repository = 'other/repo', r => r.version = '0.0.2', r => r.package.size++,
    r => r.source.treeSha256 = 'd'.repeat(64), r => r.extra = 'private metadata', r => r.verification.scannedFiles--]) {
    const changed = structuredClone(value); mutation(changed); await fs.writeFile(file('release.json'), JSON.stringify(changed)); await rechecksum(directory);
    await assert.rejects(inspectCandidate(f.root, directory, f.expected), /CANDIDATE_(IDENTITY_MISMATCH|SOURCE_MISMATCH|SCHEMA|VERIFICATION)/);
  }
  await fs.writeFile(file('release.json'), original); await rechecksum(directory);
  await fs.writeFile(file('.credentials.yaml'), 'synthetic-private');
  await assert.rejects(inspectCandidate(f.root, directory, f.expected), /INVENTORY/); await fs.unlink(file('.credentials.yaml'));
  const notes = await fs.readFile(file('release-notes.md'));
  await fs.unlink(file('release-notes.md')); await assert.rejects(inspectCandidate(f.root, directory, f.expected), /INVENTORY/);
  await fs.writeFile(file('release-notes.md'), 'changed');
  await assert.rejects(inspectCandidate(f.root, directory, f.expected), /CHECKSUM_MISMATCH/);
  await assert.rejects(prepareCandidate(f.root, {}), /EXISTING_CONFLICT/);
  await fs.writeFile(file('release-notes.md'), notes); await rechecksum(directory);
  await fs.writeFile(file('release-notes.md'), ['C:', 'Users', 'synthetic-person'].join('\\')); await rechecksum(directory);
  await assert.rejects(inspectCandidate(f.root, directory, f.expected), /PERSONAL_PATH/);
  await fs.writeFile(file('release.json'), '{ invalid synthetic JSON');
  await assert.rejects(inspectCandidate(f.root, directory, f.expected), /^Error: CANDIDATE_JSON_INVALID$/);
  const alias = path.join(f.root, '.test-work/candidate-alias');
  await fs.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectCandidate(f.root, alias, f.expected), /DIRECTORY_TYPE/);
});

test('candidate preparation rejects stale package reports, changed sources and incomplete installed acceptance', async t => {
  const f = await fixture(t), { prepareCandidate } = await import('../../scripts/release-candidate.mjs');
  await f.write(f.output + 'archive-check.json', { ...f.archive, sha256: 'e'.repeat(64) });
  await assert.rejects(prepareCandidate(f.root, {}), /ARCHIVE_EVIDENCE/);
  await f.write(f.output + 'archive-check.json', f.archive);
  await f.write(f.output + 'installed-check.json', { ...f.installed, results: [f.installed.results[0], f.installed.results[0]] });
  await assert.rejects(prepareCandidate(f.root, {}), /INSTALLED_EVIDENCE/);
  await f.write(f.output + 'installed-check.json', f.installed);
  await f.write('new-source.txt', 'synthetic source edit');
  await assert.rejects(prepareCandidate(f.root, {}), /BUILD_SOURCE_MISMATCH/);
  await fs.unlink(path.join(f.root, 'new-source.txt'));
  await f.write(f.output + filename, f.bytes + 'changed');
  await assert.rejects(prepareCandidate(f.root, {}), /BUILD_SOURCE_MISMATCH/);
});

test('candidate preparation rejects every missing or false installed acceptance field', async t => {
  const f = await fixture(t), { prepareCandidate } = await import('../../scripts/release-candidate.mjs');
  const { installedAcceptanceFields } = await import('../../scripts/installed-acceptance.mjs');
  for (const field of installedAcceptanceFields) {
    for (const value of [undefined, false]) {
      const installed = structuredClone(f.installed);
      if (value === undefined) delete installed.results[0][field]; else installed.results[0][field] = value;
      await f.write(f.output + 'installed-check.json', installed);
      await assert.rejects(prepareCandidate(f.root, {}), /INSTALLED_EVIDENCE/, `${field}=${value}`);
    }
  }
});

test('online rehearsal validates trusted completed runs and version availability using GET only', async t => {
  const f = await fixture(t), { prepareCandidate, previewCandidate } = await import('../../scripts/release-candidate.mjs');
  await f.write(f.output + 'ci-check.json', { repository: 'synthetic/project', commit: f.source.commit, runId: 42 });
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: f.source.commit,
    RELEASE_CI_RECEIPT: path.join(f.root, f.output, 'ci-check.json'),
    GITHUB_REPOSITORY: 'synthetic/project', GITHUB_RUN_ID: '7', GITHUB_RUN_ATTEMPT: '2' };
  for (const ci of [{ repository: 'other/repo', commit: f.source.commit, runId: 42 },
    { repository: 'synthetic/project', commit: 'e'.repeat(40), runId: 42 }]) {
    await f.write(f.output + 'ci-check.json', ci);
    await assert.rejects(prepareCandidate(f.root, env), /HOSTED_CONTEXT/);
  }
  await f.write(f.output + 'ci-check.json', { repository: 'synthetic/project', commit: f.source.commit, runId: 42 });
  await assert.rejects(prepareCandidate(f.root, { ...env, GITHUB_SHA: 'f'.repeat(40) }), /HOSTED_CONTEXT/);
  const directory = await prepareCandidate(f.root, env);
  let patch = {}, conflict = '', skipped = false, partial = false, status = 200;
  const request = async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.ok(url.startsWith('https://api.github.com/repos/synthetic/project/'));
    if (status !== 200) return new Response('private diagnostic must not be printed', { status });
    if (/\/git\/ref\/tags\/|\/releases\/tags\//.test(url)) return (conflict === 'tag' && url.includes('/git/ref/') || conflict === 'release' && url.includes('/releases/')) ? Response.json({ id: 1 }) : new Response('', { status: 404 });
    const ci = url.includes('/runs/42');
    if (url.includes('/jobs?')) {
      const names = ci ? ['Privacy and workflows', 'Quick checks', 'Windows runtime', 'Native VS Code'] : ['Verify installed release candidate'];
      return Response.json({ total_count: names.length + Number(partial), jobs: names.map(name => ({ name, status: 'completed', conclusion: skipped ? 'skipped' : 'success' })) });
    }
    return Response.json({ id: ci ? 42 : 7, repository: { full_name: 'synthetic/project' }, head_sha: f.source.commit, head_branch: 'main',
      event: ci ? 'push' : 'workflow_dispatch', path: '.github/workflows/' + (ci ? 'ci.yml' : 'release.yml'),
      status: 'completed', conclusion: 'success', run_attempt: 2, ...patch });
  };
  const preview = () => previewCandidate(f.root, directory, f.expected, { online: true, request, token: 'synthetic-token' });
  const plan = await preview(); assert.equal(plan.remoteStatus, 'verified'); assert.equal(plan.publicationEnabled, false);
  for (patch of [{ head_sha: 'a'.repeat(40) }, { head_branch: 'topic' }, { event: 'pull_request' },
    { repository: { full_name: 'other/repo' } }, { path: '.github/workflows/other.yml' }, { conclusion: 'failure' }, { status: 'in_progress' }, { run_attempt: 3 }]) {
    await assert.rejects(preview(), /SOURCE_RUN_MISMATCH/);
  }
  patch = {}; skipped = true; await assert.rejects(preview(), /SOURCE_JOBS_INCOMPLETE/); skipped = false;
  partial = true; await assert.rejects(preview(), /SOURCE_JOBS_INCOMPLETE/); partial = false;
  for (conflict of ['tag', 'release']) await assert.rejects(preview(), /REMOTE_VERSION_CONFLICT/);
  conflict = '';
  status = 403; await assert.rejects(preview(), /^Error: CANDIDATE_GITHUB_HTTP_403$/);
});

test('versioned notes require one nonempty exact version section', async () => {
  const { releaseChanges } = await import('../../scripts/release-candidate.mjs');
  assert.throws(() => releaseChanges('## 0.0.2\nOther', '0.0.1'), /CHANGELOG_VERSION/);
  assert.throws(() => releaseChanges('## 0.0.1\nOne\n## 0.0.1\nTwo', '0.0.1'), /CHANGELOG_VERSION/);
  assert.throws(() => releaseChanges('## 0.0.1\n\n## 0.0.0\nOld', '0.0.1'), /CHANGELOG_EMPTY/);
});
