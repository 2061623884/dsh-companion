// Real pinned resolver; synthetic profiles only, no runtime or account startup.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const runtime = fs.realpathSync(process.argv[2]);
const entry = path.join(runtime, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js');
const read = fs.readFileSync;
let reads = 0;
fs.readFileSync = (file, ...args) => {
  const name = file instanceof URL ? fileURLToPath(file) : String(file);
  if (name.startsWith(path.join(runtime, 'node_modules')) && name.endsWith('package.json')) reads++;
  return read(file, ...args);
};
syncBuiltinESMExports();
const api = await import(pathToFileURL(entry).href);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolution-'));
const options = { installAnchor: path.join(runtime, 'package.json'), home };
reads = 0;
const start = performance.now();
const first = await api.createRuntimeResolution(options);
const indexedMs = performance.now() - start, indexedReads = reads;
assert.ok(indexedReads < 10, `Immutable installation rescanned ${indexedReads} manifests`);

// Compare every selected name, version, package directory and declarer with
// the untouched upstream algorithm, not with a duplicated expected table.
const source = read(entry, 'utf8');
const begin = source.indexOf("\t// Companion's shipped installation is immutable;");
const end = source.indexOf('\tconst appManifest = readPackageManifest(canonicalAnchor);', begin);
assert.ok(begin > 0 && end > begin);
const originalFile = path.join(path.dirname(entry), '.contract-original-' + randomUUID() + '.mjs');
fs.writeFileSync(originalFile, source.slice(0, begin) + source.slice(end));
let original;
try { original = await import(pathToFileURL(originalFile).href); }
finally { fs.unlinkSync(originalFile); }
reads = 0;
const originalStart = performance.now();
const expected = await original.createRuntimeResolution(options);
const originalMs = performance.now() - originalStart, originalReads = reads;
assert.deepEqual(first.entries, expected.entries);
assert.ok(originalReads > 500);

// User-managed dependencies must still be reread after installing, updating or
// removing a profile plugin, even though shipped dependencies are indexed.
const dir = path.join(home, 'profiles/companion');
api.initProfile(dir, []);
const profileManifest = path.join(dir, 'package.json');
const profile = JSON.parse(read(profileManifest, 'utf8'));
profile.dependencies = { 'fixture-startup-plugin': '1.0.0' };
profile.dsh.profile.bundles = ['fixture-startup-plugin'];
fs.writeFileSync(profileManifest, JSON.stringify(profile));
const pluginDir = path.join(dir, 'node_modules/fixture-startup-plugin');
fs.mkdirSync(pluginDir, { recursive: true });
const pluginManifest = path.join(pluginDir, 'package.json');
fs.writeFileSync(pluginManifest, JSON.stringify({ name: 'fixture-startup-plugin', version: '1.0.0',
  dsh: { bundle: { patch: './cordis.patch.yml' } }, dependencies: { 'fixture-startup-dependency': '1.0.0' } }));
fs.writeFileSync(path.join(pluginDir, 'cordis.patch.yml'), '[]\n');
const dependency = path.join(pluginDir, 'node_modules/fixture-startup-dependency');
fs.mkdirSync(dependency, { recursive: true });
const dependencyManifest = path.join(dependency, 'package.json');
fs.writeFileSync(dependencyManifest, JSON.stringify({ name: 'fixture-startup-dependency', version: '1.0.0' }));
const selected = await api.createRuntimeResolution({ ...options, profile: api.loadProfileDirectory('dsh', dir, options.installAnchor) });
assert.ok(selected.localPackageNames.includes('fixture-startup-plugin'));
assert.equal(selected.entries.find(row => row.name === 'fixture-startup-dependency').version, '1.0.0');
fs.writeFileSync(dependencyManifest, JSON.stringify({ name: 'fixture-startup-dependency', version: '2.0.0' }));
const updated = await selected.computeLatestResolution();
assert.equal(updated.entries.find(row => row.name === 'fixture-startup-dependency').version, '2.0.0');
profile.dependencies = {};
profile.dsh.profile.bundles = [];
fs.writeFileSync(profileManifest, JSON.stringify(profile));
const removed = await updated.computeLatestResolution();
assert.equal(removed.localPackageNames.includes('fixture-startup-plugin'), false);
assert.equal(removed.entries.some(row => row.name === 'fixture-startup-dependency'), false);
assert.deepEqual(removed.entries, first.entries);

// Other installation anchors retain the original collector's behavior.
const alternate = await api.createRuntimeResolution({ installAnchor: profileManifest, home });
assert.deepEqual(alternate.entries, (await original.createRuntimeResolution({ installAnchor: profileManifest, home })).entries);
console.log(JSON.stringify({ contracts: true, packages: first.entries.length, indexedReads, originalReads,
  indexedMs: Math.round(indexedMs), originalMs: Math.round(originalMs) }));
