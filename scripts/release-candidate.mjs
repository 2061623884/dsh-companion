import { readFile, writeFile, mkdir, readdir, lstat, mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseMetadata } from './release-metadata.mjs';
import { releaseSource } from './release-source.mjs';
import { hasPersonalHomePath } from './check-source.mjs';
import { scanReleaseContents } from './check-release.mjs';

/** @param {Buffer | string} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} text */
function parse(text) {
  try { return JSON.parse(text); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; throw new Error('CANDIDATE_JSON_INVALID'); }
}
/** @param {string} file */
const json = async file => parse(await readFile(file, 'utf8'));
/** @param {unknown} value */
const positiveId = value => Number.isSafeInteger(value) && Number(value) > 0;
/** @param {object} value @param {string[]} fields */
function exactKeys(value, fields) {
  if (!value || Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) throw new Error('CANDIDATE_SCHEMA');
}
/** @param {string} root */
async function context(root) {
  const metadata = await releaseMetadata(root), manifest = await json(path.join(root, 'package.json'));
  const repository = manifest.repository.url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  const minimum = manifest.engines.vscode.match(/^\^(\d+\.\d+\.\d+)$/)?.[1];
  if (!repository || !minimum) throw new Error('CANDIDATE_PROJECT_METADATA');
  const { vscodeVersion } = await json(path.join(root, 'scripts/ci-tools.json'));
  return { ...metadata, repository, vscodeVersions: [...new Set([minimum, vscodeVersion])] };
}
/** @param {string} changelog @param {string} version */
export function releaseChanges(changelog, version) {
  const rows = changelog.split(/\r?\n/), start = rows.findIndex(row => row === '## ' + version);
  if (start < 0 || rows.filter(row => row === '## ' + version).length !== 1) throw new Error('CANDIDATE_CHANGELOG_VERSION');
  const end = rows.findIndex((row, i) => i > start && row.startsWith('## '));
  const content = rows.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  if (!content) throw new Error('CANDIDATE_CHANGELOG_EMPTY');
  return content;
}

/** Generate only local files from an unchanged package and its actual acceptance reports.
 * @param {string} root @param {NodeJS.ProcessEnv} [environment]
 */
export async function prepareCandidate(root, environment = process.env) {
  const project = await context(root), output = path.join(root, '.test-work/release');
  const [build, archive, installed, source, bytes] = await Promise.all([
    json(path.join(output, 'build-source.json')), json(path.join(output, 'archive-check.json')),
    json(path.join(output, 'installed-check.json')), releaseSource(root), readFile(path.join(output, project.filename))]);
  const sha256 = digest(bytes);
  if (build.commit !== source.commit || build.dirty !== source.dirty || build.treeSha256 !== source.treeSha256 ||
    build.sha256 !== sha256) throw new Error('CANDIDATE_BUILD_SOURCE_MISMATCH');
  if (archive.sha256 !== sha256 || installed.sha256 !== sha256 || installed.version !== project.version ||
    ['version', 'id', 'filename', 'target'].some(key => archive[key] !== project[/** @type {keyof typeof project} */ (key)]) ||
    !positiveId(archive.files) || archive.scannedFiles !== archive.files || !Number.isSafeInteger(archive.reviewedPublicFindings) || archive.reviewedPublicFindings < 0) {
    throw new Error('CANDIDATE_ARCHIVE_EVIDENCE');
  }
  const results = installed.results;
  if (!Array.isArray(results) || results.length !== project.vscodeVersions.length || project.vscodeVersions.some(version =>
    results.filter(row => row.vscodeVersion === version && row.installedPackage === true && row.workspaceBound === true &&
      row.unsavedReference === true && row.draftRestored === true && row.desktopUnchanged === true && row.ownedRuntimeExited === true &&
      row.interceptedPrompts === 1 && row.generationCalls === 0).length !== 1)) throw new Error('CANDIDATE_INSTALLED_EVIDENCE');
  let hosted = null;
  if (environment.GITHUB_ACTIONS === 'true') {
    const ci = await json(path.join(output, 'ci-check.json'));
    const runId = Number(environment.GITHUB_RUN_ID), attempt = Number(environment.GITHUB_RUN_ATTEMPT);
    if (source.dirty || environment.GITHUB_REF !== 'refs/heads/main' || environment.GITHUB_SHA !== source.commit ||
      environment.GITHUB_REPOSITORY !== project.repository || ci.commit !== source.commit || ci.repository !== project.repository ||
      !positiveId(ci.runId) || !positiveId(runId) || !positiveId(attempt)) throw new Error('CANDIDATE_HOSTED_CONTEXT');
    hosted = { ciRunId: ci.runId, runId, attempt };
  }
  const release = { schemaVersion: 1, version: project.version, id: project.id, target: project.target,
    package: { filename: project.filename, size: bytes.length, sha256 },
    source: { repository: project.repository, ...source },
    verification: { scope: hosted ? 'github' : 'local', hosted, vscodeVersions: project.vscodeVersions,
      archiveFiles: archive.files, scannedFiles: archive.scannedFiles, reviewedPublicFindings: archive.reviewedPublicFindings } };
  const changes = releaseChanges(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), project.version);
  const notes = `# DSH Companion ${project.version}\n\n${changes}\n\n## 安装与校验\n\n` +
    `在 VS Code 扩展视图选择“从 VSIX 安装…”，加载 \`${project.filename}\`。\n\n` +
    `支持 Windows x64，已安装验收的 VS Code 版本：${project.vscodeVersions.join('、')}。\n\n` +
    `下载后，在 PowerShell 中执行：\n\n\`\`\`powershell\nGet-FileHash -Algorithm SHA256 -LiteralPath './${project.filename}'\n\`\`\`\n\n` +
    `将结果与 SHA256SUMS 中对应条目比较。\n\n源码提交：${source.commit}\n\n` +
    (hosted ? `验证运行：https://github.com/${project.repository}/actions/runs/${hosted.runId}\n` : '本地预演资料；尚未完成此候选包的 GitHub 来源验证，不构成正式发布。\n');
  const manifest = JSON.stringify(release, null, 2) + '\n';
  if (hasPersonalHomePath(notes + manifest)) throw new Error('CANDIDATE_PERSONAL_PATH');
  const files = new Map([[project.filename, bytes], ['release.json', Buffer.from(manifest)], ['release-notes.md', Buffer.from(notes)]]);
  files.set('SHA256SUMS', Buffer.from([...files].map(([file, content]) => digest(content) + '  ' + file).join('\n') + '\n'));
  const directory = path.join(output, 'candidate-' + sha256.slice(0, 12) + '-' + source.treeSha256.slice(0, 12));
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('CANDIDATE_DIRECTORY_TYPE');
  for (const [file, content] of files) {
    const target = path.join(directory, file);
    try { await writeFile(target, content, { flag: 'wx' }); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      if (!(await lstat(target)).isFile() || (await lstat(target)).isSymbolicLink() || !(await readFile(target)).equals(content)) throw new Error('CANDIDATE_EXISTING_CONFLICT');
    }
  }
  await inspectCandidate(root, directory, { commit: source.commit, sha256 });
  return directory;
}

/** Treat a candidate as external data. Expected commit/hash must come from outside it.
 * @param {string} root @param {string} directory @param {{commit: string, sha256: string}} expected
 */
export async function inspectCandidate(root, directory, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected.commit) || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('CANDIDATE_EXPECTED_IDENTITY');
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('CANDIDATE_DIRECTORY_TYPE');
  const project = await context(root), names = [project.filename, 'release.json', 'release-notes.md', 'SHA256SUMS'];
  if ((await readdir(directory)).sort().join('\0') !== [...names].sort().join('\0')) throw new Error('CANDIDATE_INVENTORY');
  const files = new Map();
  for (const name of names) {
    const file = path.join(directory, name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('CANDIDATE_FILE_TYPE');
    files.set(name, await readFile(file));
  }
  const release = parse(files.get('release.json').toString('utf8'));
  exactKeys(release, ['schemaVersion', 'version', 'id', 'target', 'package', 'source', 'verification']);
  exactKeys(release.package, ['filename', 'size', 'sha256']); exactKeys(release.source, ['repository', 'commit', 'dirty', 'treeSha256']);
  exactKeys(release.verification, ['scope', 'hosted', 'vscodeVersions', 'archiveFiles', 'scannedFiles', 'reviewedPublicFindings']);
  if (release.schemaVersion !== 1 || release.version !== project.version || release.id !== project.id || release.target !== project.target ||
    release.package.filename !== project.filename || release.package.sha256 !== expected.sha256 ||
    release.package.sha256 !== digest(files.get(project.filename)) || release.package.size !== files.get(project.filename).length ||
    release.source.repository !== project.repository || release.source.commit !== expected.commit || typeof release.source.dirty !== 'boolean' ||
    !/^[a-f0-9]{64}$/.test(release.source.treeSha256)) throw new Error('CANDIDATE_IDENTITY_MISMATCH');
  const source = await releaseSource(root);
  if (source.commit !== expected.commit || source.treeSha256 !== release.source.treeSha256 || source.dirty !== release.source.dirty) throw new Error('CANDIDATE_SOURCE_MISMATCH');
  const verification = release.verification;
  if (JSON.stringify(verification.vscodeVersions) !== JSON.stringify(project.vscodeVersions) || !positiveId(verification.archiveFiles) ||
    verification.scannedFiles !== verification.archiveFiles || !Number.isSafeInteger(verification.reviewedPublicFindings) || verification.reviewedPublicFindings < 0) throw new Error('CANDIDATE_VERIFICATION');
  if (verification.scope === 'github') {
    exactKeys(verification.hosted, ['ciRunId', 'runId', 'attempt']);
    if (release.source.dirty || !Object.values(verification.hosted).every(positiveId)) throw new Error('CANDIDATE_HOSTED_CONTEXT');
  } else if (verification.scope !== 'local' || verification.hosted !== null) throw new Error('CANDIDATE_VERIFICATION');
  const checksums = [project.filename, 'release.json', 'release-notes.md'].map(name => digest(files.get(name)) + '  ' + name).join('\n') + '\n';
  if (files.get('SHA256SUMS').toString('utf8') !== checksums) throw new Error('CANDIDATE_CHECKSUM_MISMATCH');
  if (hasPersonalHomePath(files.get('release.json').toString('utf8') + files.get('release-notes.md').toString('utf8'))) throw new Error('CANDIDATE_PERSONAL_PATH');
  return release;
}

/** Read-only promotion rehearsal. There is intentionally no publishing implementation.
 * @param {string} root @param {string} directory @param {{commit: string, sha256: string}} expected
 * @param {{online?: boolean, token?: string, request?: typeof fetch}} [options]
 */
export async function previewCandidate(root, directory, expected, options = {}) {
  const release = await inspectCandidate(root, directory, expected), tag = 'v' + release.version;
  const tags = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/tags/' + tag], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (tags.split(/\r?\n/).includes('refs/tags/' + tag)) throw new Error('CANDIDATE_TAG_CONFLICT');
  let remoteStatus = 'not-checked';
  if (options.online) {
    if (release.source.dirty || release.verification.scope !== 'github') throw new Error('CANDIDATE_HOSTED_EVIDENCE_REQUIRED');
    const request = options.request || fetch, hosted = release.verification.hosted;
    /** @param {string} endpoint @param {boolean} [missingAllowed] */
    const get = async (endpoint, missingAllowed = false) => {
      const response = await request('https://api.github.com/repos/' + release.source.repository + endpoint, { method: 'GET',
        headers: { Accept: 'application/vnd.github+json', ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}),
          'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (response.status === 404 && missingAllowed) return null;
      if (!response.ok) throw new Error('CANDIDATE_GITHUB_HTTP_' + response.status);
      return response.json();
    };
    for (const [runId, workflow, jobs, attempt] of [
      [hosted.ciRunId, 'ci.yml', ['Privacy and workflows', 'Quick checks', 'Windows runtime', 'Native VS Code'], null],
      [hosted.runId, 'release.yml', ['Verify installed release candidate'], hosted.attempt]
    ]) {
      const run = await get('/actions/runs/' + runId);
      if (run.id !== runId || run.repository?.full_name !== release.source.repository || run.head_sha !== expected.commit || run.head_branch !== 'main' ||
        !['push', 'workflow_dispatch'].includes(run.event) || workflow === 'release.yml' && run.event !== 'workflow_dispatch' ||
        run.path !== '.github/workflows/' + workflow || run.status !== 'completed' || run.conclusion !== 'success' || attempt !== null && run.run_attempt !== attempt) throw new Error('CANDIDATE_SOURCE_RUN_MISMATCH');
      const rows = await get('/actions/runs/' + runId + '/jobs?filter=latest&per_page=100');
      if (rows.total_count !== rows.jobs.length || /** @type {string[]} */ (jobs).some(name => rows.jobs.filter((/** @type {{name: string,status: string,conclusion: string}} */ job) =>
        job.name === name && job.status === 'completed' && job.conclusion === 'success').length !== 1)) throw new Error('CANDIDATE_SOURCE_JOBS_INCOMPLETE');
    }
    if (await get('/git/ref/tags/' + tag, true) || await get('/releases/tags/' + tag, true)) throw new Error('CANDIDATE_REMOTE_VERSION_CONFLICT');
    remoteStatus = 'verified';
  }
  return { mode: 'dry-run', publicationEnabled: false, version: release.version, tag, commit: expected.commit,
    sha256: expected.sha256, assets: [release.package.filename, 'SHA256SUMS', 'release.json', 'release-notes.md'],
    sourceScope: release.verification.scope, dirty: release.source.dirty, remoteStatus,
    remaining: remoteStatus === 'verified' ? ['explicit-publication-authorization'] : ['hosted-source-and-version-verification', 'explicit-publication-authorization'] };
}

/** Scan only public documents here; the VSIX bytes already underwent full archive scanning.
 * @param {string} root @param {string} directory
 */
export async function scanCandidateDocuments(root, directory) {
  const staging = await mkdtemp(path.join(root, '.test-work/release/doc-scan-'));
  try {
    for (const file of ['release.json', 'release-notes.md', 'SHA256SUMS']) await writeFile(path.join(staging, file), await readFile(path.join(directory, file)));
    await scanReleaseContents(root, staging);
  } finally {
    // This fresh directory contains only the three documents and scanner config.
    for (const file of await readdir(staging)) await rm(path.join(staging, file));
    await rmdir(staging);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2), root = process.cwd();
  if (command === 'prepare' && args.length === 0) {
    const directory = await prepareCandidate(root); await scanCandidateDocuments(root, directory);
    console.log('Local candidate prepared: ' + path.relative(root, directory));
  } else if (['check', 'preview'].includes(command) && [3, 4].includes(args.length) && (args.length === 3 || command === 'preview' && args[3] === '--online')) {
    const [directory, commit, sha256] = args;
    const result = command === 'check' ? await inspectCandidate(root, directory, { commit, sha256 }) :
      await previewCandidate(root, directory, { commit, sha256 }, { online: args[3] === '--online', token: process.env.GH_TOKEN });
    await scanCandidateDocuments(root, directory);
    console.log(command === 'check' ? 'Candidate integrity and document privacy passed' : JSON.stringify(result, null, 2));
  } else throw new Error('Usage: release-candidate.mjs prepare | check <directory> <commit> <sha256> | preview <directory> <commit> <sha256> [--online]');
}
