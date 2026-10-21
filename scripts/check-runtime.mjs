import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { adaptWorkBuddyStatusClient } from '../src/sidebar/client/workbuddy-status.mjs';
import { startupLeaves } from './prepare-startup-leaves.mjs';

/** Check prepared artifacts without installing, repairing or starting DSH.
 * @param {string} root
 */
export async function checkRuntimeFiles(root) {
  /** @param {string} name */
  const json = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
  for (const name of ['runtime/bin/node.exe', 'runtime/bin/NODE-LICENSE', 'runtime/licenses.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'dist/extension.js', 'dist/sidebar.js', 'dist/bootstrap.js', 'dist/sidebar.css']) await access(path.join(root, name));
  const extension = await json('package.json'), runtime = await json('runtime/package.json');
  if (extension.version !== runtime.version) throw new Error('Runtime and extension versions differ; run build:runtime after updating both manifests');
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'pnpm']) {
    const installed = await json('runtime/node_modules/' + name + '/package.json');
    if (installed.version !== runtime.dependencies[name]) throw new Error('Pinned runtime dependency differs: ' + name);
  }
  const provider = await json('runtime/node_modules/dsh-workbuddy-connect/package.json');
  if (provider.version !== '0.6.10') throw new Error('WorkBuddy compatibility adapter requires 0.6.10');
  const providerRoot = path.join(root, 'runtime/node_modules/dsh-workbuddy-connect');
  const providerEntry = path.join(providerRoot, provider.main);
  if (!(await readFile(providerEntry, 'utf8')).includes('withDesktopWorkBuddyAuth(new WorkBuddyCredentialStore')) throw new Error('WorkBuddy runtime adapter is not prepared');
  const client = await readFile(path.join(path.dirname(providerEntry), 'client.js'), 'utf8');
  if (adaptWorkBuddyStatusClient(client) !== client) throw new Error('WorkBuddy status UI is not prepared');
  for (const name of ['host.mjs', 'import.mjs', 'workbuddy-auth.mjs']) {
    const built = await readFile(path.join(root, 'runtime', name)), source = await readFile(path.join(root, 'src/runtime', name));
    if (!built.equals(source)) throw new Error('Stale runtime entry: ' + name + '; run build:runtime');
  }
  const licenses = await json('runtime/licenses.json');
  if (!Array.isArray(licenses) || !licenses.length) throw new Error('Runtime license inventory is missing or empty');
  const bundle = await json('runtime/bundle-manifest.json'), typebox = await json('runtime/node_modules/typebox/package.json');
  if (bundle.package !== 'typebox' || bundle.version !== typebox.version || bundle.publicEntries !== 9 || !Array.isArray(bundle.outputFiles) || !bundle.outputFiles.length) {
    throw new Error('TypeBox bundle manifest does not match the pinned runtime');
  }
  for (const output of bundle.outputFiles) await access(path.join(root, 'runtime/node_modules/typebox', output));
  const startup = await json('runtime/startup-bundle-manifest.json');
  if (!Array.isArray(startup.packages) || startup.packages.length !== startupLeaves.length) throw new Error('Startup library bundle manifest is incomplete');
  for (const leaf of startupLeaves) {
    const item = startup.packages.find((/** @type {{name: string}} */ value) => value.name === leaf.name);
    const installed = await json('runtime/node_modules/' + leaf.name + '/package.json');
    if (!item || item.version !== leaf.version || installed.version !== leaf.version || item.format !== leaf.format || !Array.isArray(item.facades) || !item.facades.length || !Array.isArray(item.outputs) || !item.outputs.length) {
      throw new Error('Startup library bundle differs: ' + leaf.name);
    }
    for (const artifact of [...item.outputs, ...item.facades]) {
      const bytes = await readFile(path.join(root, 'runtime/node_modules', leaf.name, artifact.path));
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Stale startup library bundle: ' + leaf.name);
    }
  }
  return { version: extension.version, nodeVersion: (await json('runtime/node-version.json')).version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd(), result = await checkRuntimeFiles(root), execute = promisify(execFile);
  const node = path.join(root, 'runtime/bin/node.exe');
  const version = await execute(node, ['--version'], { windowsHide: true });
  if (version.stdout.trim() !== 'v' + result.nodeVersion) throw new Error('Bundled Node version differs from its verified preparation metadata');
  await execute(node, ['tests/typebox-contract.mjs', path.join(root, 'runtime')], { windowsHide: true });
  await execute(node, ['tests/startup-leaf-contract.mjs', path.join(root, 'runtime')], { windowsHide: true });
  console.log('Runtime files, versions, licenses and startup dependency contracts verified');
}
