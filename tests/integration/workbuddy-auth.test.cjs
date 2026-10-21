const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');

test('WorkBuddy borrows current desktop access without refresh, copying, logout or stale caching', async t => {
  const { withDesktopWorkBuddyAuth } = await import('../../runtime/workbuddy-auth.mjs');
  const { WorkBuddyCredentialStore: Store, CN_VARIANT: cn, AI_VARIANT: ai, parseWorkBuddyAuth } =
    await import(pathToFileURL(path.resolve('runtime/node_modules/dsh-workbuddy-connect/lib/index.js')));
  const { I: realmOf } = await import('../../runtime/node_modules/dsh-workbuddy-connect/lib/variants-F-c2C6Tw.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workbuddy-auth-'));
  const previous = process.env.DSH_COMPANION_DESKTOP_HOME;
  process.env.DSH_COMPANION_DESKTOP_HOME = path.join(root, 'desktop');
  t.after(() => { if (previous === undefined) delete process.env.DSH_COMPANION_DESKTOP_HOME; else process.env.DSH_COMPANION_DESKTOP_HOME = previous; });
  const desktopDir = path.join(root, 'desktop/profiles/desktop/.dsh-workbuddy-connect');
  await fs.mkdir(desktopDir, { recursive: true });
  const desktopFile = path.join(desktopDir, cn.ownFilename), localFile = path.join(root, 'companion', cn.ownFilename);
  const credential = accessToken => ({ accessToken, refreshToken: 'fixture-refresh-never-consume', expiresAtMs: Date.now() + 60000,
    domain: 'copilot.tencent.com', uid: 'fixture-user', source: 'login' });
  const document = value => JSON.stringify({ version: 1, region: 'cn', auth: { accessToken: value.accessToken,
    refreshToken: value.refreshToken, expiresAt: value.expiresAtMs, domain: value.domain }, account: { uid: value.uid } });
  let refreshes = 0;
  const local = new Store({ variant: cn, ownPath: localFile, refresh: async () => {
    refreshes++; return { accessToken: 'fixture-independent-refreshed', expiresInSec: 3600 };
  } });
  const store = withDesktopWorkBuddyAuth(local, cn, parseWorkBuddyAuth, realmOf);
  const first = document(credential('fixture-desktop-1')); await fs.writeFile(desktopFile, first);
  assert.equal((await store.status()).state, 'signed-in');
  assert.equal((await store.status()).authSource, 'desktop-read-only');
  assert.equal((await store.status()).authUsable, true);
  assert.equal((await store.resolve()).accessToken, 'fixture-desktop-1');
  assert.equal((await store.resolve()).refreshToken, '');
  assert.equal(refreshes, 0);
  await assert.rejects(fs.access(localFile), { code: 'ENOENT' });
  await assert.rejects(store.logout(), { code: 'DSH_WORKBUDDY_DESKTOP_AUTH_READ_ONLY' });
  assert.equal(await fs.readFile(desktopFile, 'utf8'), first);
  const latest = document(credential('fixture-desktop-2')); await fs.writeFile(desktopFile, latest);
  assert.equal((await store.resolve()).accessToken, 'fixture-desktop-2');
  const expired = document({ ...credential('fixture-expired'), expiresAtMs: Date.now() - 1000 });
  await fs.writeFile(desktopFile, expired);
  const expiredStatus = await store.status();
  assert.equal(expiredStatus.state, 'signed-in');
  assert.equal(expiredStatus.authUsable, false);
  assert.equal(expiredStatus.authReason, 'DSH_WORKBUDDY_DESKTOP_AUTH_EXPIRED');
  await assert.rejects(store.resolve(), { code: 'DSH_WORKBUDDY_DESKTOP_AUTH_EXPIRED' });
  assert.equal(refreshes, 0); assert.equal(await fs.readFile(desktopFile, 'utf8'), expired);
  await fs.writeFile(desktopFile, '{ invalid secret-free fixture');
  await assert.rejects(store.current(), { code: 'DSH_WORKBUDDY_DESKTOP_AUTH_INVALID' });
  await fs.writeFile(desktopFile, latest);
  const independent = credential('fixture-independent'); await store.save(independent);
  assert.equal((await store.current()).accessToken, independent.accessToken);
  assert.equal((await store.resolve()).accessToken, 'fixture-independent-refreshed');
  assert.equal(refreshes, 1); assert.equal(await fs.readFile(desktopFile, 'utf8'), latest);
  await store.logout();
  assert.equal((await store.current()).accessToken, 'fixture-desktop-2');
  await assert.rejects(fs.access(localFile), { code: 'ENOENT' });
  const globalLocal = new Store({ variant: ai, ownPath: path.join(root, 'companion', ai.ownFilename), refresh: () => assert.fail('Unexpected refresh') });
  const globalStore = withDesktopWorkBuddyAuth(globalLocal, ai, parseWorkBuddyAuth, realmOf);
  assert.equal((await globalStore.status()).state, 'signed-out');
  await fs.writeFile(path.join(desktopDir, ai.ownFilename), latest);
  await assert.rejects(globalStore.resolve(), { code: 'DSH_WORKBUDDY_DESKTOP_AUTH_INVALID' });
  delete process.env.DSH_COMPANION_DESKTOP_HOME;
  assert.equal(withDesktopWorkBuddyAuth(local, cn, parseWorkBuddyAuth, realmOf), local);
});

test('read-only authorization follows separate custom homes with spaces and Unicode', async t => {
  const { withDesktopWorkBuddyAuth } = await import('../../runtime/workbuddy-auth.mjs');
  const { WorkBuddyCredentialStore: Store, CN_VARIANT: cn, AI_VARIANT: ai, parseWorkBuddyAuth } =
    await import(pathToFileURL(path.resolve('runtime/node_modules/dsh-workbuddy-connect/lib/index.js')));
  const { I: realmOf } = await import('../../runtime/node_modules/dsh-workbuddy-connect/lib/variants-F-c2C6Tw.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-auth-homes-'));
  const previous = process.env.DSH_COMPANION_DESKTOP_HOME;
  t.after(() => { if (previous === undefined) delete process.env.DSH_COMPANION_DESKTOP_HOME; else process.env.DSH_COMPANION_DESKTOP_HOME = previous; });
  const stores = [];
  for (const [label, variant, domain] of [['用户甲 custom home', cn, 'copilot.tencent.com'], ['User B 自定义目录', ai, 'www.workbuddy.ai']]) {
    const source = path.join(root, label), directory = path.join(source, 'profiles/desktop/.dsh-workbuddy-connect');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, variant.ownFilename), JSON.stringify({ region: variant.region,
      auth: { accessToken: 'fixture-access-' + variant.id, refreshToken: 'fixture-never-refresh', domain, expiresAt: Date.now() + 3600000 },
      account: { uid: 'fixture-account-' + variant.id } }));
    process.env.DSH_COMPANION_DESKTOP_HOME = source;
    const local = new Store({ variant, ownPath: path.join(root, 'companion-' + variant.id, variant.ownFilename), refresh: () => assert.fail('Borrowed credential refreshed') });
    stores.push(withDesktopWorkBuddyAuth(local, variant, parseWorkBuddyAuth, realmOf));
  }
  // Each adapter retains its own discovered source, even after environment changes.
  const credentials = await Promise.all(stores.map(store => store.resolve()));
  assert.deepEqual(credentials.map(value => value.uid), ['fixture-account-workbuddy', 'fixture-account-workbuddy-ai']);
  assert.ok(credentials.every(value => value.refreshToken === ''));
});
