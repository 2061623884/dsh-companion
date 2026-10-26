import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { desktopFixture, desktopRpc } from './desktop-fixture.mjs';
const require = createRequire(import.meta.url);
const { DesktopConnection } = require('../dist/test/desktop/connection');

test('the real Desktop Host owns the shared settings and sessions and survives editor disconnect', { timeout: 60000 }, async () => {
  let fixture = await desktopFixture(process.cwd());
  const connection = new DesktopConnection({ desktopHome: fixture.home, assetsDirectory: 'dist' });
  try {
    const base = await connection.start();
    assert.match(await (await fetch(base + '/?dsh-companion=1')).text(), /__dsh_companion\/bootstrap.js/);
    const created = await desktopRpc(fixture.home, base, 'session/create', { request: { cwd: fixture.directory } });
    const sessions = await desktopRpc(fixture.home, fixture.address, 'session/list', { _request: {} });
    assert.ok(JSON.stringify(sessions).includes(created.sessionId));
    await desktopRpc(fixture.home, base, 'settings/mutate', { ns: 'ui-settings-general', ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: 'synthetic-shared-setting' }], expectedRevision: 0 });
    const settings = await desktopRpc(fixture.home, fixture.address, 'settings/describe', {});
    assert.ok(JSON.stringify(settings).includes('synthetic-shared-setting'));
    assert.equal((await desktopRpc(fixture.home, base, 'account/getState', {})).status, 'credential-stored');
    await fixture.stop();
    assert.equal((await fetch(base + '/')).status, 502);
    fixture = await desktopFixture(process.cwd(), fixture.directory);
    assert.equal((await fetch(base + '/?dsh-companion=1')).status, 200);
    assert.ok(JSON.stringify(await desktopRpc(fixture.home, base, 'session/list', { _request: {} })).includes(created.sessionId));
    await connection.dispose();
    process.kill(fixture.pid, 0);
    assert.ok(JSON.stringify(await desktopRpc(fixture.home, fixture.address, 'session/list', { _request: {} })).includes(created.sessionId));
  } finally { await connection.dispose(); await fixture.stop(); }
});
