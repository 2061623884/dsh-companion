const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

test('failed migration record replacement preserves the last valid record and existing data', async t => {
  const { importDesktopData } = await import('../../tests/fixtures/legacy-runtime/import.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-migration-record-')), home = path.join(root, 'home');
  await fs.mkdir(home); const marker = path.join(home, 'migration.json');
  const original = JSON.stringify({ version: 1, historySessions: 0, skipped: [{ id: 'fixture-session', code: 'PENDING_OR_INTERRUPTED' }] });
  await fs.writeFile(marker, original); await fs.writeFile(path.join(home, 'keep.txt'), 'owned-data');
  const rename = fs.rename;
  t.after(() => { fs.rename = rename; syncBuiltinESMExports(); });
  fs.rename = async (from, to) => {
    if (to === marker) throw Object.assign(new Error('Synthetic replacement failure'), { code: 'EPERM' });
    return rename(from, to);
  };
  syncBuiltinESMExports();
  await assert.rejects(importDesktopData(path.join(root, 'no-source'), home), { code: 'EPERM' });
  assert.equal(await fs.readFile(marker, 'utf8'), original);
  assert.equal(await fs.readFile(path.join(home, 'keep.txt'), 'utf8'), 'owned-data');
  assert.deepEqual((await fs.readdir(home)).sort(), ['keep.txt', 'migration.json']);
  fs.rename = rename; syncBuiltinESMExports();
  await importDesktopData(path.join(root, 'no-source'), home);
  assert.equal(JSON.parse(await fs.readFile(marker)).skipped[0].code, 'SOURCE_SESSION_MISSING');
});

test('corrupt migration records fail explicitly without initializing over the existing home', async () => {
  const { importDesktopData } = await import('../../tests/fixtures/legacy-runtime/import.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-migration-corrupt-')), home = path.join(root, 'home');
  await fs.mkdir(home); await fs.writeFile(path.join(home, 'migration.json'), '{partial');
  await fs.writeFile(path.join(home, 'keep.txt'), 'owned-data');
  await assert.rejects(importDesktopData(path.join(root, 'none'), home), { code: 'DSH_IMPORT_MARKER_INVALID' });
  assert.equal(await fs.readFile(path.join(home, 'migration.json'), 'utf8'), '{partial');
  assert.equal(await fs.readFile(path.join(home, 'keep.txt'), 'utf8'), 'owned-data');
});

test('cancelled migration cannot initialize a home or advance to commit', async () => {
  const { importDesktopData } = await import('../../tests/fixtures/legacy-runtime/import.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-migration-cancel-')), home = path.join(root, 'home');
  const controller = new AbortController(), reason = new Error('fixture cancellation'); controller.abort(reason);
  await assert.rejects(importDesktopData(path.join(root, 'none'), home, controller.signal), error => error === reason);
  await assert.rejects(fs.access(home), { code: 'ENOENT' });
});

test('cancellation during a retry preserves the old marker and removes its staged replacement', async t => {
  const { importDesktopData } = await import('../../tests/fixtures/legacy-runtime/import.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-migration-mid-cancel-')), home = path.join(root, 'home');
  await fs.mkdir(home); const marker = path.join(home, 'migration.json');
  const original = JSON.stringify({ version: 1, skipped: [{ id: 'fixture', code: 'PENDING_OR_INTERRUPTED' }] });
  await fs.writeFile(marker, original);
  const controller = new AbortController(), reason = new Error('fixture cancelled during write'), write = fs.writeFile;
  t.after(() => { fs.writeFile = write; syncBuiltinESMExports(); });
  fs.writeFile = async (file, ...args) => {
    const result = await write(file, ...args);
    if (file.startsWith(marker + '.import-')) controller.abort(reason);
    return result;
  };
  syncBuiltinESMExports();
  await assert.rejects(importDesktopData(path.join(root, 'none'), home, controller.signal), error => error === reason);
  assert.equal(await fs.readFile(marker, 'utf8'), original);
  assert.deepEqual(await fs.readdir(home), ['migration.json']);
});
