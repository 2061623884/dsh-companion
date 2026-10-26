const {test}=require('node:test'), assert=require('node:assert/strict');
const {DesktopClient}=require('../../dist/test/desktop/client');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

test('Windows discovery reads the actual Desktop version without opening a console', async t => {
  const calls = [];
  const expected = { executable: 'C:\\Apps\\DeepSeek Harness.exe', version: '0.2.1-rc.3.20261026.1', candidates: [] };
  t.mock.method(require('node:util'), 'promisify', fn => {
    assert.equal(fn, require('node:child_process').execFile);
    return async (...args) => { calls.push(args); return { stdout: JSON.stringify(expected) }; };
  });
  t.mock.property(process, 'platform', 'win32');
  assert.deepEqual(await require('../../dist/test/desktop/client').discoverDesktop(), expected);
  assert.equal(calls[0][2].windowsHide, true);
  assert.ok(calls[0][1].includes('-NoProfile')); assert.ok(calls[0][1].includes('-NonInteractive'));
  assert.match(calls[0][1].at(-1), /GetVersionInfo\(\$executable\)\.FileVersion/);
});

test('desktop discovery distinguishes missing installation from an installed stopped application',async()=>{
  await assert.rejects(new DesktopClient(async()=>({executable:null,candidates:[]})).addresses(),{code:'DSH_DESKTOP_NOT_INSTALLED'});
  await assert.rejects(new DesktopClient(async()=>({executable:'D:\\Apps\\DeepSeek Harness.exe',candidates:[]})).addresses(),{code:'DSH_DESKTOP_NOT_RUNNING'});
  assert.deepEqual(await new DesktopClient(async()=>({executable:'D:\\Apps\\DeepSeek Harness.exe',candidates:[{pid:12,port:3456}]})).addresses(),[{pid:12,port:3456}]);
});

async function installation(t, capability) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-capability-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  if (capability !== undefined) {
    await fs.mkdir(path.join(directory, 'resources'));
    await fs.writeFile(path.join(directory, 'resources', 'dsh-companion-capabilities.json'), capability);
  }
  return path.join(directory, 'DeepSeek Harness.exe');
}

test('a supported desktop starts once in background and all waiting views connect to its Host', async t => {
  const executable = await installation(t, JSON.stringify({ schema: 1, backgroundStart: true }));
  const launches = [], host = { pid: 12, port: 3456 };
  const client = new DesktopClient(async () => ({ executable, candidates: launches.length ? [host] : [] }),
    async (file, background) => { launches.push({ file, background }); });
  const addresses = await Promise.all([client.addresses(), client.addresses(), client.addresses()]);
  assert.deepEqual(launches, [{ file: executable, background: true }]);
  assert.deepEqual(addresses, [[host], [host], [host]]);
  await client.open();
  assert.deepEqual(launches[1], { file: executable, background: false }, 'explicit opening must reveal the existing desktop owner');
});

test('an already running Host is connected without launching or requiring a background capability', async t => {
  const executable = await installation(t), launches = [], host = { pid: 12, port: 3456 };
  const client = new DesktopClient(async () => ({ executable, candidates: [host] }),
    async () => { launches.push(true); });
  assert.deepEqual(await client.addresses(), [host]);
  assert.equal(launches.length, 0);
});

test('automatic rediscovery does not undo an intentional desktop exit', async t => {
  const executable = await installation(t, JSON.stringify({ schema: 1, backgroundStart: true })), launches = [];
  const client = new DesktopClient(async () => ({ executable, candidates: [] }), async () => { launches.push(true); });
  await assert.rejects(client.addresses(false), { code: 'DSH_DESKTOP_NOT_RUNNING' });
  assert.equal(launches.length, 0, 'only initial or explicit connection actions may start Desktop');
});

test('old or unknown desktop capabilities keep the explicit-open path without starting another Host', async t => {
  for (const capability of [undefined, { schema: 1, backgroundStart: false }, { schema: 2, backgroundStart: true }]) {
    const executable = await installation(t, capability === undefined ? undefined : JSON.stringify(capability));
    const launches = [];
    const client = new DesktopClient(async () => ({ executable, candidates: [] }), async () => { launches.push(true); });
    await assert.rejects(client.addresses(), { code: 'DSH_DESKTOP_NOT_RUNNING' });
    assert.equal(launches.length, 0);
  }
});

test('invalid capability data fails visibly without executing any launch command', async t => {
  const executable = await installation(t, '{"schema":1,"backgroundStart":"yes","command":"untrusted"}');
  const launches = [];
  const client = new DesktopClient(async () => ({ executable, candidates: [] }), async () => { launches.push(true); });
  await assert.rejects(client.addresses(), { code: 'DSH_DESKTOP_CAPABILITIES_INVALID' });
  assert.equal(launches.length, 0);
});

test('the launcher invokes the desktop shell with fixed arguments and does not inherit Electron Node mode', async t => {
  const executable = await installation(t, JSON.stringify({ schema: 1, backgroundStart: true, command: 'ignored', args: ['ignored'] }));
  const { EventEmitter } = require('node:events'), calls = [], host = { pid: 12, port: 3456 };
  const previousMode = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  t.after(() => { if (previousMode === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = previousMode; });
  t.mock.method(require('node:child_process'), 'spawn', (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  const client = new DesktopClient(async () => ({ executable, candidates: calls.length ? [host] : [] }));
  assert.deepEqual(await client.addresses(), [host]);
  await client.open();
  assert.deepEqual(calls.map(({ file, args }) => ({ file, args })), [
    { file: executable, args: ['--background'] }, { file: executable, args: [] }
  ]);
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[1].options.windowsHide, false);
});

test('startup timeout does not repeatedly launch the shell and a later retry can connect', async t => {
  const executable = await installation(t, JSON.stringify({ schema: 1, backgroundStart: true }));
  let launched = 0, running = false, clockReads = 0;
  t.mock.method(Date, 'now', () => clockReads++ ? 45000 : 0);
  const host = { pid: 12, port: 3456 };
  const client = new DesktopClient(async () => ({ executable, candidates: running ? [host] : [] }), async () => { launched++; });
  await assert.rejects(client.addresses(), { code: 'DSH_DESKTOP_NOT_RUNNING' });
  assert.equal(launched, 1);
  running = true;
  assert.deepEqual(await client.addresses(), [host]);
  assert.equal(launched, 1);
});
