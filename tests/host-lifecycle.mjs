// Execute the actual host with controlled timers and synthetic boot/filesystem
// boundaries. No real process, desktop files, network or model is involved.
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';

const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  writes = []; destroyed = false;
  write(value) { this.writes.push(JSON.parse(value)); }
  setTimeout() {}
  end() { this.destroy(); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}
async function host({ pending = false, stalledBoot = false, stalledShutdown = false } = {}) {
  let handler, release, shutdowns = 0, now = 0, bootCalls = 0;
  const timers = [], exits = [], writes = [];
  const task = pending || stalledBoot ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const server = new EventEmitter(); server.listen = (name, callback) => callback();
  const clock = { now: () => now };
  const context = vm.createContext({ Buffer, console, AbortController, performance: clock,
    process: { argv: ['node', 'host', 'fixture-home', 'fixture-source'], env: {}, pid: 1, execPath: 'node', exit: code => exits.push(code) },
    setTimeout(callback, ms) { const item = { callback, due: now + ms, active: true }; timers.push(item); return item; },
    clearTimeout(item) { if (item) item.active = false; } });
  const values = {
    'node:net': { default: { createServer(callback) { handler = callback; return server; } } },
    'node:path': { default: path }, 'node:crypto': { createHash },
    'node:fs/promises': { readFile: async () => '{"version":"fixture"}', mkdir: async () => {}, writeFile: async (file, text) => writes.push(JSON.parse(text)) },
    './import.mjs': { importDesktopData: async () => { if (pending) await task; } },
    '@deepseek-ai/dsh/profile-boot': { runProfile: async () => {
      bootCalls++; if (stalledBoot) await task;
      return { ctx: { inject(names, callback) { callback(); }, webServer: { port: 12345 }, loader: { entries: () => [] } },
        shutdown: { shutdown() { shutdowns++; return stalledShutdown ? new Promise(() => {}) : Promise.resolve(); } } };
    } },
    '@deepseek-ai/dsh-app-boot': { loadProfileDirectory() { return {}; }, loadLayeredEnv() { return {}; } },
  };
  function dependency(name) {
    return new vm.SyntheticModule(Object.keys(values[name]), function () {
      for (const [key, value] of Object.entries(values[name])) this.setExport(key, value);
    }, { context });
  }
  const source = new vm.SourceTextModule(await readFile('src/runtime/host.mjs', 'utf8'), { context,
    initializeImportMeta(meta) { meta.dirname = path.resolve('runtime'); },
    async importModuleDynamically(name) { const module = dependency(name); await module.link(() => {}); await module.evaluate(); return module; } });
  await source.link(dependency); await source.evaluate();
  return {
    connect(value = { type: 'attach', version: 'fixture' }) {
      const socket = new Socket(); handler(socket); socket.emit('data', Buffer.from(JSON.stringify(value) + '\n')); return socket;
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter(item => item.active && item.due <= until).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due; next.active = false;
        // Real timers don't await asynchronous callbacks either.
        Promise.resolve(next.callback()).catch(error => { throw error; });
        await tick();
      }
      now = until; await tick();
    },
    exits, writes, release: () => release?.(), shutdowns: () => shutdowns, bootCalls: () => bootCalls,
  };
}

for (const value of [null, [], {}, { type: 'attach', version: null }, { type: 'other', version: 'fixture' }]) {
  const runtime = await host(); const bad = runtime.connect(value);
  assert.equal(bad.destroyed, true);
  const good = runtime.connect(); await tick();
  assert.ok(good.writes.some(value => value.type === 'ready'));
}
for (const options of [{ pending: true }, { stalledBoot: true }, { stalledShutdown: true }]) {
  const runtime = await host(options), socket = runtime.connect(); await tick(); socket.destroy();
  await runtime.advance(20000);
  assert.ok(runtime.exits.length > 0, 'last-client shutdown must be bounded even before boot completes');
  if (options.pending) { runtime.release(); await tick(); assert.equal(runtime.bootCalls(), 0, 'cancelled migration cannot proceed to core boot'); }
}
const stuck = await host({ pending: true }), waiting = stuck.connect();
await stuck.advance(120000);
assert.ok(stuck.exits.length > 0, 'startup deadline must include migration');
assert.ok(waiting.writes.some(value => value.type === 'error' && value.code === 'DSH_START_TIMEOUT'));
const live = await host(), first = live.connect(), second = live.connect(); await tick(); first.destroy();
await live.advance(20000); assert.equal(live.exits.length, 0);
second.destroy(); await live.advance(4000); const reloaded = live.connect(); await live.advance(2000);
assert.equal(live.exits.length, 0); reloaded.destroy(); await live.advance(6000);
assert.equal(live.shutdowns(), 1); assert.deepEqual(live.exits, [0]);
console.log('host protocol, startup deadline, cancellation, shutdown deadline and shared leases passed');
