import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build, version as bundlerVersion } from 'esbuild';

// Measured startup hotspots only. Preparation follows a clean runtime npm ci.
export const startupLeaves = [
  { name: 'zod', version: '4.4.3', format: /** @type {const} */ ('esm') },
  { name: 'execa', version: '10.2.0', format: /** @type {const} */ ('esm') },
  { name: 'yaml', version: '2.9.1', format: /** @type {const} */ ('cjs') },
  { name: 'semver', version: '7.8.5', format: /** @type {const} */ ('cjs') },
];

/** Fold the pinned library graphs while retaining their original import paths.
 * @param {string} runtime
 */
export async function prepareStartupLeaves(runtime) {
  const packages = [];
  for (const leaf of startupLeaves) {
    const directory = path.resolve(runtime, 'node_modules', leaf.name);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (manifest.version !== leaf.version) throw new Error('Startup bundle requires ' + leaf.name + '@' + leaf.version);
    if ((await readFile(path.join(directory, leaf.name === 'yaml' ? 'dist/index.js' : 'index.js'), 'utf8')).includes('companion-bundle')) {
      throw new Error('Startup bundling requires clean runtime dependencies; run prepare-runtime');
    }
    /** @type {string[]} */
    let entries = leaf.name === 'yaml' ? ['dist/index.js', 'dist/util.js'] : ['index.js'];
    if (leaf.name === 'zod') {
      /** @type {Record<string, string | {import: string}>} */
      const exports = manifest.exports;
      entries = [...new Set([
        ...Object.values(exports).filter(value => typeof value === 'object' && !value.import.includes('*')).map(value => /** @type {{import: string}} */ (value).import),
        ...(await readdir(path.join(directory, 'v4/locales'))).filter(file => file.endsWith('.js')).map(file => './v4/locales/' + file),
      ])].sort();
    }
    const analysis = await build({ entryPoints: entries.map(entry => path.join(directory, entry)), bundle: true,
      splitting: leaf.format === 'esm', platform: 'node', format: leaf.format, packages: 'external',
      outdir: path.join(directory, '.analysis'), metafile: true, write: false });
    if (leaf.name === 'semver') {
      // SemVer permits deep requires: route every reachable JS file through the
      // same graph so constructors/functions retain identity across all paths.
      entries = Object.keys(analysis.metafile.inputs).filter(file => file.endsWith('.js')).map(file => path.relative(directory, path.resolve(file))).sort();
    }
    const records = await Promise.all(entries.map(async entry => {
      const filename = path.join(directory, entry);
      if (leaf.format === 'cjs') {
        const api = await import(pathToFileURL(filename).href);
        return { entry, exports: Object.keys(api).filter(key => !['default', 'module.exports'].includes(key)) };
      }
      const metadata = Object.values(analysis.metafile.outputs).find(value => value.entryPoint && path.resolve(value.entryPoint).toLowerCase() === filename.toLowerCase());
      if (!metadata) throw new Error('Missing startup bundle entry: ' + leaf.name + '/' + entry);
      return { entry, exports: metadata.exports };
    }));
    const entryLines = records.map((record, i) => leaf.format === 'esm'
      ? 'export { ' + record.exports.map((key, n) => key + ' as e' + i + '_' + n).join(', ') + ' } from ' + JSON.stringify(path.join(directory, record.entry)) + ';'
      : 'exports.e' + i + '=require(' + JSON.stringify(path.join(directory, record.entry)) + ');');
    // Classic initializes the default locale. Keep it separate from core/mini,
    // and keep v3 lazy, while sharing the core/locales across these entry groups.
    /** @param {string} entry */
    const groupFor = entry => {
      const value = entry.replace(/^\.\//, '');
      if (value === 'index.js' || value === 'v4/index.js') return 'classic';
      if (value.startsWith('v3/')) return 'v3';
      if (value.startsWith('mini/') || value.startsWith('v4-mini/') || value.startsWith('v4/mini/')) return 'mini';
      return 'core-locales';
    };
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const [i, record] of records.entries()) {
      const name = groupFor(record.entry);
      if (!groups.has(name)) groups.set(name, []);
      /** @type {string[]} */ (groups.get(name)).push(entryLines[i]);
    }
    const singleOutput = path.join(directory, 'companion-bundle/entry.' + (leaf.format === 'esm' ? 'mjs' : 'cjs'));
    const result = await build({ ...(leaf.name === 'zod' ? {
      entryPoints: Object.fromEntries([...groups.keys()].map(name => [name, 'companion-entry:' + name])),
      outdir: path.join(directory, 'companion-bundle'), outExtension: { '.js': '.mjs' }, splitting: true,
      plugins: [{ name: 'zod-public-entry-groups', setup(build) {
        build.onResolve({ filter: /^companion-entry:/ }, args => ({ path: args.path.slice('companion-entry:'.length), namespace: 'zod-groups' }));
        build.onLoad({ filter: /.*/, namespace: 'zod-groups' }, args => ({ contents: /** @type {string[]} */ (groups.get(args.path)).join('\n'), resolveDir: directory }));
      } }],
    } : { stdin: { contents: entryLines.join('\n'), resolveDir: directory }, outfile: singleOutput }), bundle: true, platform: 'node', format: leaf.format,
      packages: 'external', target: 'node24', keepNames: true, legalComments: 'inline', write: false, metafile: true });
    await mkdir(path.join(directory, 'companion-bundle'), { recursive: true });
    for (const file of result.outputFiles) await writeFile(file.path, file.contents);
    const facades = [];
    for (const [i, record] of records.entries()) {
      const filename = path.join(directory, record.entry);
      const output = leaf.name === 'zod' ? path.join(directory, 'companion-bundle', groupFor(record.entry) + '.mjs') : singleOutput;
      let relative = path.relative(path.dirname(filename), output).replaceAll('\\', '/');
      if (!relative.startsWith('.')) relative = './' + relative;
      const source = leaf.format === 'esm'
        ? 'export { ' + record.exports.map((key, n) => 'e' + i + '_' + n + ' as ' + key).join(', ') + ' } from ' + JSON.stringify(relative) + ';\n'
        : 'const value = require(' + JSON.stringify(relative) + ').e' + i + ';\n' + record.exports.map(key => 'exports[' + JSON.stringify(key) + '] = value[' + JSON.stringify(key) + '];').join('\n') + '\nmodule.exports = value;\n';
      await writeFile(filename, source);
      facades.push({ path: record.entry.replaceAll('\\', '/'), sha256: createHash('sha256').update(source).digest('hex') });
    }
    packages.push({ ...leaf, sourceFiles: Object.keys(analysis.metafile.inputs).length, facades,
      outputs: result.outputFiles.map(file => ({ path: path.relative(directory, file.path).replaceAll('\\', '/'), sha256: createHash('sha256').update(file.contents).digest('hex') })) });
    console.log('Prepared startup library ' + leaf.name + '@' + leaf.version + ': ' + facades.length + ' original entry paths');
  }
  await writeFile(path.join(runtime, 'startup-bundle-manifest.json'), JSON.stringify({ tool: 'esbuild ' + bundlerVersion, packages }, null, 2) + '\n');
}
