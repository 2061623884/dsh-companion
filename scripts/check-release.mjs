import { readFile, mkdir, mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPromise } from 'yauzl';
import { releaseMetadata } from './release-metadata.mjs';
import { hasPersonalHomePath } from './check-source.mjs';

/** Archive paths are external input, including when packaging locally.
 * @param {string} name
 */
export function releaseEntryViolation(name) {
  if (name.includes('\\') || name.includes(':') || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.')) return 'RELEASE_UNSAFE_PATH';
  if (/(^|\/)(\.env(?:\.[^/]*)?|\.credentials\.ya?ml|\.workbuddy[^/]*-auth\.json|runtime-error\.json|migration\.json|\.git|\.coveralls\.yml)(\/|$)/i.test(name) ||
    /\.(pem|key|p12|pfx|log|sqlite3?|db|jsonl(?:\.zstd)?|zip|7z|tgz|tar|gz|vsix)$/i.test(name)) return 'RELEASE_PRIVATE_ENTRY';
  if (/^(\[Content_Types\]\.xml|extension\.vsixmanifest)$/.test(name) ||
    /^extension\/(package\.json|readme\.md|changelog\.md|license(?:\.txt)?|third_party_notices\.md|media\/whale\.svg)$/i.test(name) ||
    /^extension\/dist\/(extension\.js|sidebar\.js|bootstrap\.js|sidebar\.css)$/.test(name) ||
    /^extension\/runtime\/(package(?:-lock)?\.json|licenses\.json|node-version\.json|(?:startup-)?bundle-manifest\.json|(?:host|import|workbuddy-auth)\.mjs|bin\/(node\.exe|NODE-LICENSE))$/.test(name) ||
    /^extension\/runtime\/node_modules\/.+/.test(name)) return null;
  return 'RELEASE_UNEXPECTED_ENTRY';
}

/** Inspect and extract exactly the package which will be installed; no repair.
 * @param {string} root @param {string} archive @param {string} directory
 */
export async function checkReleaseArchive(root, archive, directory) {
  const metadata = await releaseMetadata(root), seen = new Set(), contents = new Map();
  const required = ['package.json', 'dist/extension.js', 'dist/sidebar.js', 'dist/bootstrap.js', 'dist/sidebar.css', 'media/whale.svg',
    'runtime/bin/node.exe', 'runtime/bin/NODE-LICENSE', 'runtime/licenses.json', 'runtime/node-version.json', 'runtime/package.json',
    'runtime/host.mjs', 'runtime/import.mjs', 'runtime/workbuddy-auth.mjs', 'runtime/bundle-manifest.json', 'runtime/startup-bundle-manifest.json'];
  const zip = await openPromise(archive, { lazyEntries: true, strictFileNames: true });
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      // VSCE emits files, not directory records or symlinks.
      if (seen.has(name.toLowerCase()) || (entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000) throw new Error('RELEASE_DUPLICATE_OR_SYMLINK');
      seen.add(name.toLowerCase());
      const violation = releaseEntryViolation(name);
      if (violation) throw new Error(violation);
      const stream = await zip.openReadStreamPromise(entry), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) throw new Error('RELEASE_ARCHIVE_CORRUPT');
      const text = bytes.toString('utf8');
      // Public dependencies contain upstream documentation examples and compiler paths.
      // Their bytes must still contain neither this builder's home nor workspace.
      const normalized = text.replace(/\\+/g, '/').toLowerCase();
      const builderPath = [os.homedir(), root].some(value => normalized.includes(value.replaceAll('\\', '/').toLowerCase()));
      if (builderPath || !name.startsWith('extension/runtime/node_modules/') && hasPersonalHomePath(text)) throw new Error('RELEASE_PERSONAL_HOME_PATH');
      if (name === 'extension.vsixmanifest' || required.some(file => name === 'extension/' + file)) contents.set(name, bytes);
      const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
  } finally { zip.close(); }
  for (const file of required) {
    const bytes = contents.get('extension/' + file);
    if (!bytes) throw new Error('RELEASE_REQUIRED_FILE_MISSING');
    if (file !== 'package.json' && !bytes.equals(await readFile(path.join(root, file)))) throw new Error('RELEASE_BUILT_FILE_MISMATCH');
  }
  if (!seen.has('extension/license') && !seen.has('extension/license.txt') || !seen.has('extension/third_party_notices.md') || !seen.has('[content_types].xml')) throw new Error('RELEASE_LICENSE_OR_METADATA_MISSING');
  const xml = contents.get('extension.vsixmanifest')?.toString('utf8') || '', identity = xml.match(/<Identity\b([^>]*)\/?\s*>/)?.[1] || '';
  const attributes = new Map([...identity.matchAll(/(?:^|\s)(\w+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
  const manifest = JSON.parse(contents.get('extension/package.json').toString('utf8'));
  if (manifest.version !== metadata.version || manifest.publisher + '.' + manifest.name !== metadata.id || attributes.get('Id') !== manifest.name ||
    attributes.get('Publisher') !== manifest.publisher || attributes.get('Version') !== metadata.version || attributes.get('TargetPlatform') !== metadata.target) throw new Error('RELEASE_VSIX_MANIFEST_MISMATCH');
  return { ...metadata, files: seen.size, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
}

/** Feed all extracted bytes to stdin: Gitleaks' default directory policy skips node_modules.
 * @param {string} root @param {string} directory
 */
export async function scanReleaseContents(root, directory) {
  const tool = path.join(root, '.test-work/ci-tools/gitleaks/gitleaks.exe');
  const config = path.join(directory, 'scanner.toml');
  const report = path.join(root, '.test-work/release/gitleaks-' + path.basename(directory) + '.json');
  await rm(report, { force: true });
  const approved = JSON.parse(await readFile(path.join(root, 'scripts/release-public-findings.json'), 'utf8'));
  await writeFile(config, '[extend]\nuseDefault = true\n');
  const child = spawn(tool, ['stdin', '--config', config, '--redact=100', '--no-banner', '--ignore-gitleaks-allow', '--max-target-megabytes=0',
    '--report-format=json', '--report-path=' + report, '--timeout=300'],
    { windowsHide: true, stdio: 'pipe', timeout: 330000 });
  /** @type {Buffer[]} */
  const logs = [];
  child.stdout.on('data', chunk => logs.push(chunk)); child.stderr.on('data', chunk => logs.push(chunk));
  const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
  /** @type {{file: string, sha256: string, start: number, end: number}[]} */
  const files = [];
  let line = 1;
  /** @param {string} folder @returns {AsyncGenerator<Buffer>} */
  async function* content(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) yield* content(file);
      else if (file !== config) {
        const bytes = await readFile(file); let count = 1;
        for (let offset = bytes.indexOf(10); offset !== -1; offset = bytes.indexOf(10, offset + 1)) count++;
        files.push({ file: path.relative(directory, file).split(path.sep).join('/'), sha256: createHash('sha256').update(bytes).digest('hex'), start: line, end: line + count });
        line += count; yield bytes; yield Buffer.from('\n');
      }
    }
  }
  const [transfer, exit] = await Promise.allSettled([pipeline(Readable.from(content(directory)), child.stdin), completed]);
  if (exit.status === 'rejected' || ![0, 1].includes(/** @type {number} */ (exit.value)) || transfer.status === 'rejected') {
    await writeFile(path.join(root, '.test-work/release/secret-scan.log'), Buffer.concat(logs));
    throw new Error('RELEASE_SECRET_SCAN_FAILED');
  }
  const findings = JSON.parse(await readFile(report, 'utf8'));
  for (const finding of findings) {
    const file = files.find(file => finding.StartLine >= file.start && finding.StartLine < file.end);
    if (!file || !approved.some((/** @type {{file: string, sha256: string, rules: string[]}} */ entry) =>
      entry.file === file.file && entry.sha256 === file.sha256 && entry.rules.includes(finding.RuleID))) throw new Error('RELEASE_SECRET_SCAN_FAILED');
  }
  return { scannedFiles: files.length, reviewedPublicFindings: findings.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd(), metadata = await releaseMetadata(root), output = path.join(root, '.test-work/release');
  const directory = await mkdtemp(path.join(output, 'scan-'));
  const result = await checkReleaseArchive(root, path.join(output, metadata.filename), directory);
  const scan = await scanReleaseContents(root, directory);
  await writeFile(path.join(output, 'SHA256SUMS'), result.sha256 + '  ' + metadata.filename + '\n');
  await writeFile(path.join(output, 'archive-check.json'), JSON.stringify({ ...result, ...scan }, null, 2) + '\n');
  console.log('Release archive passed: version=' + result.version + ', files=' + result.files + ', target=' + result.target);
}
