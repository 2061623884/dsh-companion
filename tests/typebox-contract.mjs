import fs from 'node:fs';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const runtime = path.resolve(process.argv[2]), require = createRequire(path.join(runtime, 'package.json'));
const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/typebox-exports.json', import.meta.url)));
const reads = new Set(), read = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  const filename = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? file : '';
  if (filename.replaceAll('\\', '/').includes('/node_modules/typebox/')) reads.add(filename);
  return read(file, ...args);
};
syncBuiltinESMExports();
const modules = {};
for (const [entry, expected] of Object.entries(contract.entries)) {
  const api = await import(pathToFileURL(require.resolve('typebox' + (entry === '.' ? '' : entry.slice(1)))));
  const signature = Object.keys(api).sort().map(name => [name, typeof api[name], typeof api[name] === 'function' ? api[name].name : '']);
  assert.equal(createHash('sha256').update(JSON.stringify(signature)).digest('hex'), expected, entry + ' public export contract');
  modules[entry] = api;
}
const Type = modules['.'].default, Compile = modules['./compile'].Compile, Value = modules['./value'], Format = modules['./format'];
assert.equal(Type, modules['.'].Type);
assert.equal(Type.String, modules['./type'].String);
assert.equal(modules['./system'].default, modules['./system'].System);
const schema = Type.Object({ id: Type.String(), count: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false });
const compiled = Compile(schema);
for (const [input, valid] of [[{ id: 'x' }, true], [{ id: 'x', count: 2 }, true], [{ id: 3 }, false], [{ id: 'x', count: -1 }, false], [{ id: 'x', extra: 0 }, false]]) {
  assert.equal(compiled.Check(input), valid); assert.equal(Value.Check(schema, input), valid);
}
Format.Set('companion-fixture', value => value === 'accepted');
const formatted = Type.String({ format: 'companion-fixture' });
assert.equal(Value.Check(formatted, 'accepted'), true); assert.equal(Value.Check(formatted, 'other'), false);
assert.equal(Compile(formatted).Check('other'), false);
assert.ok(reads.size <= 40, `Public TypeBox imports read ${reads.size} files; prepared runtime budget is 40`);
console.log(JSON.stringify({ publicEntries: Object.keys(modules).length, readFiles: reads.size, exportsAndBehavior: true }));
