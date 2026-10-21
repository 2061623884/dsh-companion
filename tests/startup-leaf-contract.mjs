// Real dependency contracts; no account, desktop data or model calls.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const runtime = path.resolve(process.argv[2]), require = createRequire(path.join(runtime, 'package.json'));
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/startup-leaf-exports.json', import.meta.url)));
const zodUrl = pathToFileURL(path.join(runtime, 'node_modules/zod/')).href;
// Import order is part of the library contract: core/mini must not initialize
// the classic entry's default locale before that entry is actually imported.
execFileSync(process.execPath, ['--input-type=module', '--eval', `
  import assert from 'node:assert/strict';
  const core = await import(${JSON.stringify(zodUrl)} + 'v4/core/index.js');
  assert.equal(core.config().localeError, undefined);
  const custom = () => 'fixture-custom'; core.config({localeError: custom});
  await import(${JSON.stringify(zodUrl)} + 'v4/mini/index.js');
  assert.equal(core.config().localeError, custom);
  const classic = await import(${JSON.stringify(zodUrl)} + 'index.js');
  assert.notEqual(core.config().localeError, custom);
  assert.equal(classic.globalRegistry, core.globalRegistry);
`], { windowsHide: true, stdio: 'pipe' });
const reads = { zod: new Set(), execa: new Set(), yaml: new Set(), semver: new Set() }, read = fs.readFileSync;
fs.readFileSync = (filename, ...args) => {
  const file = filename instanceof URL ? fileURLToPath(filename) : String(filename);
  for (const name of Object.keys(reads)) if (file.replaceAll('\\', '/').includes('/node_modules/' + name + '/')) reads[name].add(file);
  return read(filename, ...args);
};
syncBuiltinESMExports();
const modules = {}, firstReadFiles = {};
for (const name of ['zod', 'execa']) {
  const directory = path.join(runtime, 'node_modules', name);
  assert.equal(JSON.parse(read(path.join(directory, 'package.json'))).version, expected[name].version);
  modules[name] = await import(pathToFileURL(path.join(directory, 'index.js')).href);
  firstReadFiles[name] = reads[name].size;
  for (const [entry, hash] of Object.entries(expected[name].entries)) {
    const api = await import(pathToFileURL(path.join(directory, entry)).href);
    const signature = Object.keys(api).sort().map(key => [key, typeof api[key], typeof api[key] === 'function' ? api[key].name : '']);
    assert.equal(createHash('sha256').update(JSON.stringify(signature)).digest('hex'), hash, name + '/' + entry);
  }
}
const { zod: z, execa: execute } = modules;
const zod = file => import(pathToFileURL(path.join(runtime, 'node_modules/zod', file)).href);
const [v4, core, mini, en, v3] = await Promise.all(['v4/index.js', 'v4/core/index.js', 'v4/mini/index.js', 'v4/locales/en.js', 'v3/index.js'].map(zod));
assert.equal(z.default, z.z); assert.equal(z.z, v4.z);
assert.equal(z.globalRegistry, core.globalRegistry); assert.equal(z.locales.en, en.default);
const schema = z.object({ title: z.string(), count: z.coerce.number().int().min(0).default(1) });
assert.deepEqual(schema.parse({ title: 'fixture', count: '2' }), { title: 'fixture', count: 2 });
assert.equal(schema.safeParse({ title: 2 }).success, false);
assert.equal(z.toJSONSchema(schema).properties.title.type, 'string');
z.globalRegistry.add(schema, { title: 'shared-registry-fixture' });
assert.equal(core.globalRegistry.get(schema).title, 'shared-registry-fixture');
assert.equal(mini.safeParse(mini.object({ title: mini.string() }), { title: 'fixture' }).success, true);
assert.equal(v3.string().parse('legacy'), 'legacy');
assert.equal(require('zod').z.string().parse('cjs'), 'cjs');

const script = 'process.stdin.setEncoding("utf8");let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(process.argv[1]+":"+s))';
const output = await execute.execa(process.execPath, ['--eval', script, '空 格'], { input: 'fixture' });
assert.equal(output.stdout, '空 格:fixture');
assert.equal(execute.execaSync(process.execPath, ['--eval', 'process.stdout.write("sync")']).stdout, 'sync');
const piped = await execute.execa(process.execPath, ['--eval', 'process.stdout.write("pipe")']).pipe(process.execPath, ['--eval', script, 'child']);
assert.equal(piped.stdout, 'child:pipe');
await assert.rejects(execute.execa(process.execPath, ['--eval', 'process.stderr.write("fixture-error");process.exit(7)']), error => error instanceof execute.ExecaError && error.exitCode === 7 && error.stderr === 'fixture-error');
const controller = new AbortController();
const child = execute.execa(process.execPath, ['--eval', 'setInterval(()=>{},1000)'], { cancelSignal: controller.signal });
controller.abort();
await assert.rejects(child, error => error.isCanceled === true);
for (const name of ['yaml', 'semver']) {
  const directory = path.join(runtime, 'node_modules', name);
  assert.equal(JSON.parse(read(path.join(directory, 'package.json'))).version, expected[name].version);
  modules[name] = require(name);
  firstReadFiles[name] = reads[name].size;
  for (const [entry, hash] of Object.entries(expected[name].entries)) {
    const api = require(path.join(directory, entry));
    const signature = [typeof api, typeof api === 'function' ? api.name : '', Object.keys(api).sort().map(key => [key, typeof api[key], typeof api[key] === 'function' ? api[key].name : ''])];
    assert.equal(createHash('sha256').update(JSON.stringify(signature)).digest('hex'), hash, name + '/' + entry);
  }
  for (const [entry, keys] of Object.entries(expected[name].esm)) {
    const api = await import(pathToFileURL(path.join(directory, entry)).href);
    assert.deepEqual(Object.keys(api).sort(), keys, name + '/' + entry + ' ESM names');
    assert.equal(api.default, require(path.join(directory, entry)));
  }
}
const { yaml, semver } = modules;
const document = yaml.parseDocument('# preserved comment\nbase: &base {x: 1}\ncopy: *base\n');
const value = document.toJS();
assert.equal(value.base, value.copy); assert.equal(value.copy.x, 1);
assert.match(document.toString(), /preserved comment/);
assert.equal(yaml.isPair(require('yaml/util').createPair('key', 'value', document)), true);
assert.deepEqual(yaml.parse(yaml.stringify({ title: '合成用例', items: [1, true, null] })), { title: '合成用例', items: [1, true, null] });
assert.ok(yaml.parseDocument('broken: [').errors[0] instanceof yaml.YAMLParseError);
assert.equal(semver.SemVer, require('semver/classes/semver'));
assert.equal(semver.Range, require('semver/classes/range'));
assert.equal(semver.satisfies, require('semver/functions/satisfies'));
assert.equal(semver.satisfies(new semver.SemVer('1.4.0'), new semver.Range('^1.2.0')), true);
assert.equal(semver.satisfies('2.0.0-rc.1', '^1.2.0'), false);
assert.equal(semver.maxSatisfying(['1.2.0', '2.0.0', '1.9.1'], '^1.0.0'), '1.9.1');
assert.equal(semver.intersects('^1.2.0', '>=1.5 <2'), true);
assert.equal(semver.coerce('release 3.4').version, '3.4.0');
for (const name of Object.keys(reads)) assert.ok(firstReadFiles[name] <= 5, name + ' root import read ' + firstReadFiles[name] + ' files; prepared budget is 5');
console.log(JSON.stringify({ firstReadFiles, publicEntries: Object.values(expected).reduce((sum, value) => sum + Object.keys(value.entries).length, 0), exportsAndBehavior: true }));
