import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Source identity contains hashes and Git state, never machine paths or file contents.
 * @param {string} root
 */
export async function releaseSource(root) {
  /** @param {string[]} args */
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const commit = git(['rev-parse', 'HEAD']).trim();
  const dirty = git(['status', '--porcelain', '-z']).length > 0;
  const hash = createHash('sha256');
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate']).split('\0').filter(Boolean).sort();
  for (const file of files) {
    hash.update(file + '\0');
    try {
      const bytes = await readFile(path.join(root, file));
      hash.update(String(bytes.length) + '\0'); hash.update(bytes);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
      hash.update('deleted\0');
    }
  }
  return { commit, dirty, treeSha256: hash.digest('hex') };
}
