import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} content */
export function hasPersonalHomePath(content) {
  return /[a-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|\/(?:home|Users)\/+[^/\s"'<>]+/i.test(content);
}

/** Source/distribution privacy policy; return only a safe diagnostic code.
 * @param {string} filename @param {string} content
 */
export function sourceViolation(filename, content) {
  const name = filename.replaceAll('\\', '/');
  if (/(^|\/)(node_modules|dist|\.test-work|\.vscode-test|outputs|work|profiles|sessions|attachments|storages|\.dsh)(\/|$)/.test(name) ||
    /^runtime\/(bin\/|(?:host|import|workbuddy-auth)\.mjs$|(?:startup-)?bundle-manifest\.json$)/.test(name)) return 'GENERATED_OR_PRIVATE_DATA';
  if (/(^|\/)(\.env(?:\..*)?|\.credentials\.ya?ml|\.workbuddy[^/]*-auth\.json|runtime-error\.json|migration\.json)$/.test(name) && !name.endsWith('/.env.example') && name !== '.env.example') return 'CREDENTIAL_OR_LOCAL_CONFIG';
  if (/\.(vsix|zip|7z|tgz|exe|dll|node|log|sqlite3?|db|jsonl(?:\.zstd)?)$/i.test(name)) return 'BINARY_OR_RAW_DATA';
  if (hasPersonalHomePath(content)) return 'PERSONAL_HOME_PATH';
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { stdout } = await promisify(execFile)('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate']);
  const violations = new Map();
  let count = 0;
  for (const filename of stdout.split('\0').filter(Boolean)) {
    let bytes;
    try { bytes = await readFile(filename); }
    catch (error) {
      // A tracked deletion is absent from the working source candidate.
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') continue;
      throw error;
    }
    count++;
    const code = sourceViolation(filename, bytes.toString('utf8'));
    if (code) violations.set(code, (violations.get(code) || 0) + 1);
  }
  if (violations.size) throw new Error('Source privacy check failed: ' + [...violations].map(([code, count]) => code + '=' + count).join(', '));
  console.log('Source privacy inventory passed: ' + count + ' files; no generated/private entries or literal home paths');
}
