import { readFile, writeFile, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

// Only the read-only installation graph is prepared. Profile packages, linked
// plugins and bundle selection still use DSH's live resolution on every call.
const insertion = `\t// Companion's shipped installation is immutable; profiles remain dynamic.
\tconst companionRoot = realModuleDirectory(fileURLToPath(new URL('../../../../', import.meta.url)));
\tif (canonicalAnchor === join(companionRoot, 'package.json')) {
\t\tconst { entries } = JSON.parse(readFileSync(new URL('./companion-installation-scope.json', import.meta.url), 'utf8'));
\t\treturn {
\t\t\tpackageNames: new Set(entries.map(row => row.name)),
\t\t\tpackageDirs: new Map(entries.map(row => [row.name, join(companionRoot, row.packageDir)])),
\t\t\tdeclarers: new Map(entries.map(row => [row.name, join(companionRoot, row.declarer)])),
\t\t\tversions: new Map(entries.map(row => [row.name, row.version]))
\t\t};
\t}
`;
const marker = '\tconst appManifest = readPackageManifest(canonicalAnchor);';
const stampPattern = /\n\/\/ Companion installation index SHA256: ([a-f0-9]{64})\n$/;
/** @param {string} digest */
const stamp = digest => '\n// Companion installation index SHA256: ' + digest + '\n';
/** @param {string | Buffer} value */
const hash = value => createHash('sha256').update(value).digest('hex');

/** Prepare the pinned dependency graph, or check existing build input without repairing it.
 * @param {string} runtime @param {boolean} checkOnly
 */
export async function prepareStartupResolution(runtime, checkOnly = false) {
  const root = await realpath(runtime);
  const directory = path.join(root, 'node_modules/@deepseek-ai/dsh-app-boot/lib');
  const entry = path.join(directory, 'index.js');
  const manifest = JSON.parse(await readFile(path.join(directory, '../package.json'), 'utf8'));
  if (manifest.version !== '0.2.1-rc.2') throw new Error('Startup resolution requires pinned DSH 0.2.1-rc.2');
  const current = (await readFile(entry, 'utf8')).replaceAll('\r\n', '\n');
  const source = current.replace(stampPattern, '').replace(insertion, '');
  const start = source.indexOf('function collectInstallationScopePackages(');
  const end = source.indexOf('\n}', start) + 2;
  if (hash(source.slice(start, end)) !== '3114e1793b534c6915f7f520bb357e110e7833b21bed07b3e16af58e21f11ac7') throw new Error('Pinned installation resolver changed');
  const output = path.join(directory, 'companion-installation-scope.json');
  if (checkOnly) {
    const digest = current.match(stampPattern)?.[1];
    if (!digest || current !== source.replace(marker, insertion + marker) + stamp(digest)) throw new Error('Startup resolution is not prepared');
    const bytes = await readFile(output);
    // Bind the mapping as well as its input manifests to the prepared adapter.
    // Checking this artifact stays read-only and never imports or boots DSH.
    if (hash(bytes) !== digest) throw new Error('Stale startup resolution index; run build:runtime');
    const prepared = JSON.parse(bytes.toString('utf8'));
    if (prepared.version !== manifest.version || !prepared.entries.length || prepared.entries.length !== prepared.manifests.length) throw new Error('Startup resolution index is incomplete');
    for (const item of prepared.manifests) {
      if (hash(await readFile(path.join(root, item.path))) !== item.sha256) throw new Error('Stale startup resolution index; run build:runtime');
    }
    return;
  }
  // Use the pinned collector itself at build time, preserving resolution order
  // and nested dependency choices. The temporary module is always removed.
  const temporary = path.join(directory, '.companion-scan-' + randomUUID() + '.mjs');
  await writeFile(temporary, source + '\nexport { collectInstallationScopePackages };\n');
  let table;
  try {
    const api = await import(pathToFileURL(temporary).href);
    table = api.collectInstallationScopePackages(path.join(root, 'package.json'), new Set());
  } finally { await unlink(temporary); }
  /** @param {string} filename */
  const relative = filename => {
    const value = path.relative(root, filename).replaceAll('\\', '/');
    if (value === '..' || value.startsWith('../') || path.isAbsolute(value)) throw new Error('Installation dependency is outside the bundled runtime');
    return value;
  };
  const entries = [...table.packageNames].map((/** @type {string} */ name) => ({ name,
    packageDir: relative(table.packageDirs.get(name)), declarer: relative(table.declarers.get(name)), version: table.versions.get(name) }));
  const manifests = await Promise.all(entries.map(async row => {
    const filename = path.join(root, row.packageDir, 'package.json');
    return { path: relative(filename), sha256: hash(await readFile(filename)) };
  }));
  const index = JSON.stringify({ version: manifest.version, entries, manifests }) + '\n';
  await writeFile(output, index);
  await writeFile(entry, source.replace(marker, insertion + marker) + stamp(hash(index)));
}
