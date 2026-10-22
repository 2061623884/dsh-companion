import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Only Companion's pinned account initializer changes; desktop packages stay untouched.
const original = '\t\tif (parsed.data.issuer === this.origin) return;\n\t\tawait this.ctx.credentials.deleteRecord(KEY);';
const protectedSource = '\t\tif (parsed.data.issuer === this.origin) return;\n\t\tthrow Object.assign(new Error("DSH account platform differs from the shared login; align platform settings before restarting"), { code: "DSH_ACCOUNT_PLATFORM_MISMATCH" });';

/** Preserve a shared grant when the account initializer resolves a different platform.
 * @param {string} runtime - Prepared public runtime directory.
 * @param {boolean} checkOnly - Verify packaging input without modifying it.
 */
export async function prepareSharedLogin(runtime, checkOnly = false) {
  const require = createRequire(path.resolve(runtime, 'node_modules/@deepseek-ai/dsh-base/package.json'));
  const entry = require.resolve('@deepseek-ai/dsh-deepseek-account-platform');
  const manifest = JSON.parse(await readFile(path.join(path.dirname(entry), '../package.json'), 'utf8'));
  if (manifest.version !== '0.2.1-rc.2') throw new Error('Shared login protection requires pinned DSH 0.2.1-rc.2');
  const source = (await readFile(entry, 'utf8')).replaceAll('\r\n', '\n');
  if (source.split(protectedSource).length === 2 && !source.includes(original)) return;
  if (checkOnly) throw new Error('Shared login protection is not prepared');
  if (source.split(original).length !== 2 || source.includes(protectedSource)) throw new Error('Pinned DSH account initialization changed');
  await writeFile(entry, source.replace(original, protectedSource));
}
