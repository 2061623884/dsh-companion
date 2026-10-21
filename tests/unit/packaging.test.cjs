const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');

test('runtime preflight rejects missing, stale and mismatched artifacts without preparing them', async () => {
  const { checkRuntimeFiles } = await import('../../scripts/check-runtime.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-packaging-fixture-'));
  async function write(name, data = 'fixture') {
    const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data);
  }
  const versions = { '@deepseek-ai/dsh': '0.2.1-rc.2', '@deepseek-ai/dsh-app-boot': '0.2.1-rc.2', '@deepseek-ai/dsh-base': '0.2.1-rc.2',
    '@deepseek-ai/dsh-web-app': '0.2.1-rc.2', pnpm: '10.28.0' };
  for (const name of ['runtime/bin/node.exe', 'runtime/bin/NODE-LICENSE', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'dist/extension.js', 'dist/sidebar.js', 'dist/bootstrap.js', 'dist/sidebar.css']) await write(name);
  await write('package.json', JSON.stringify({ version: 'fixture-version' }));
  await write('runtime/package.json', JSON.stringify({ version: 'fixture-version', dependencies: versions }));
  for (const [name, version] of Object.entries(versions)) await write('runtime/node_modules/' + name + '/package.json', JSON.stringify({ version }));
  await write('runtime/node_modules/dsh-workbuddy-connect/package.json', JSON.stringify({ version: '0.6.10', main: 'lib/index.js' }));
  await write('runtime/node_modules/dsh-workbuddy-connect/lib/index.js', 'withDesktopWorkBuddyAuth(new WorkBuddyCredentialStore');
  const { adaptWorkBuddyStatusClient } = await import('../../src/sidebar/client/workbuddy-status.mjs');
  const original = 't("accessTokenExpires", { time: formatTime(status.expiresAt) })\n' +
    'accessTokenExpires: "Access token expires {time} (refresh is automatic)",\n' +
    'accessTokenExpires: "访问令牌 {time} 过期（自动续期）",';
  const prepared = adaptWorkBuddyStatusClient(original); assert.equal(adaptWorkBuddyStatusClient(prepared), prepared);
  await write('runtime/node_modules/dsh-workbuddy-connect/lib/client.js', prepared);
  for (const name of ['host.mjs', 'import.mjs', 'workbuddy-auth.mjs']) { await write('src/runtime/' + name); await write('runtime/' + name); }
  await write('runtime/licenses.json', '[{"license":"MIT"}]');
  await write('runtime/node-version.json', '{"version":"24.21.0"}');
  await write('runtime/node_modules/typebox/package.json', '{"version":"1.3.27"}');
  await write('runtime/node_modules/typebox/companion-bundle/index.mjs');
  await write('runtime/bundle-manifest.json', JSON.stringify({ package: 'typebox', version: '1.3.27', publicEntries: 9, outputFiles: ['companion-bundle/index.mjs'] }));
  const { startupLeaves } = await import('../../scripts/prepare-startup-leaves.mjs');
  const sha256 = createHash('sha256').update('fixture').digest('hex'), packages = [];
  for (const leaf of startupLeaves) {
    await write('runtime/node_modules/' + leaf.name + '/package.json', JSON.stringify({ version: leaf.version }));
    await write('runtime/node_modules/' + leaf.name + '/entry.js');
    await write('runtime/node_modules/' + leaf.name + '/bundle.js');
    packages.push({ ...leaf, outputs: [{ path: 'bundle.js', sha256 }], facades: [{ path: 'entry.js', sha256 }] });
  }
  await write('runtime/startup-bundle-manifest.json', JSON.stringify({ packages }));
  assert.equal((await checkRuntimeFiles(root)).version, 'fixture-version');
  await fs.unlink(path.join(root, 'runtime/bin/node.exe'));
  await assert.rejects(checkRuntimeFiles(root), { code: 'ENOENT' }); await write('runtime/bin/node.exe');
  await write('runtime/host.mjs', 'stale'); await assert.rejects(checkRuntimeFiles(root), /Stale runtime entry/); await write('runtime/host.mjs');
  await write('runtime/package.json', JSON.stringify({ version: 'other', dependencies: versions })); await assert.rejects(checkRuntimeFiles(root), /versions differ/);
  await write('runtime/package.json', JSON.stringify({ version: 'fixture-version', dependencies: versions }));
  await write('runtime/bundle-manifest.json', '{"package":"typebox","version":"wrong","publicEntries":9,"outputFiles":["companion-bundle/index.mjs"]}');
  await assert.rejects(checkRuntimeFiles(root), /TypeBox bundle manifest/);
  await write('runtime/bundle-manifest.json', JSON.stringify({ package: 'typebox', version: '1.3.27', publicEntries: 9, outputFiles: ['companion-bundle/index.mjs'] }));
  await write('runtime/node_modules/zod/entry.js', 'stale');
  await assert.rejects(checkRuntimeFiles(root), /Stale startup library bundle: zod/);
  await write('runtime/node_modules/zod/entry.js');
  await write('runtime/node_modules/zod/package.json', '{"version":"wrong"}');
  await assert.rejects(checkRuntimeFiles(root), /Startup library bundle differs: zod/);
  await write('runtime/node_modules/zod/package.json', JSON.stringify({ version: startupLeaves[0].version }));
  await fs.unlink(path.join(root, 'runtime/startup-bundle-manifest.json'));
  await assert.rejects(checkRuntimeFiles(root), { code: 'ENOENT' });
});
