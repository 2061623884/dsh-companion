import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Keep version and identity checks shared by packaging and archive acceptance.
 * @param {string} root
 */
export async function releaseMetadata(root) {
  const manifests = await Promise.all(['package.json', 'package-lock.json', 'runtime/package.json', 'runtime/package-lock.json']
    .map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
  const [extension, lock, runtime, runtimeLock] = manifests;
  if (![lock.version, lock.packages[''].version, runtime.version, runtimeLock.version, runtimeLock.packages[''].version]
    .every(version => version === extension.version)) throw new Error('RELEASE_VERSION_MISMATCH');
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(extension.version)) throw new Error('RELEASE_VERSION_INVALID');
  return { version: extension.version, id: extension.publisher + '.' + extension.name,
    filename: extension.name + '-' + extension.version + '-win32-x64.vsix', target: 'win32-x64' };
}
