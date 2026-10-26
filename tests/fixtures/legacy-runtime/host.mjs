import net from 'node:net';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importDesktopData } from './import.mjs';

const home = path.resolve(process.argv[2]);
const source = path.resolve(process.argv[3]);
const directory = import.meta.dirname;
const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
const identity = createHash('sha256').update(home.toLowerCase()).digest('hex').slice(0, 32);
/** @type {Set<import('node:net').Socket>} */
const clients = new Set();
const startup = new AbortController();
/** @type {Promise<import('./contracts.js').RuntimeApp> | undefined} */
let application;
/** @type {{type: 'ready', version: string, pid: number, port: number} | undefined} */
let ready;
/** @type {NodeJS.Timeout | undefined} */
let timer;
/** @type {NodeJS.Timeout | undefined} */
let startupTimer;
let stopping = false, stage = 'import';
/** @param {import('node:net').Socket} socket @param {object} value */
const send = (socket, value) => socket.write(JSON.stringify(value) + '\n');
const server = net.createServer(socket => {
  let buffer = '', attached = false;
  socket.on('error', () => socket.destroy());
  socket.setTimeout(10000, () => socket.destroy());
  socket.on('data', data => {
    buffer += data.toString();
    if (buffer.length > 4096 || attached) { socket.destroy(); return; }
    if (!buffer.includes('\n')) return;
    let message;
    try { message = JSON.parse(buffer.trim()); }
    catch { socket.destroy(); return; }
    if (!message || typeof message !== 'object' || message.type !== 'attach' || typeof message.version !== 'string') { socket.destroy(); return; }
    if (stopping) { send(socket, { type: 'stopping' }); socket.end(); return; }
    if (message.version !== manifest.version) {
      send(socket, clients.size === 0 ? { type: 'stopping' } : { type: 'error', stage: 'control', code: 'DSH_RUNTIME_VERSION_IN_USE' }); socket.end(); return;
    }
    attached = true; socket.setTimeout(0); clients.add(socket); clearTimeout(timer);
    send(socket, ready || { type: 'starting', stage });
    begin();
  });
  socket.on('close', () => { if (attached && clients.delete(socket) && clients.size === 0) idle(); });
});
function idle() {
  clearTimeout(timer);
  timer = setTimeout(() => { void stop(0); }, 5000);
}
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(`\\\\.\\pipe\\dsh-companion-${identity}`, () => resolve(undefined));
  });
} catch (error) {
  if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE') process.exit(0);
  await fail(error, 'control-bind');
}
idle();
process.env.DSH_HOME = home;
process.env.DSH_COMPANION_DESKTOP_HOME = source;
process.env.PATH = path.join(directory, 'bin') + path.delimiter + (process.env.PATH || '');
// Read-only bundled packages; package-manager writes are confined to the user's profile.
async function boot() {
  await importDesktopData(source, home, startup.signal);
  startup.signal.throwIfAborted();
  stage = 'boot';
  const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
  const { loadProfileDirectory, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
  startup.signal.throwIfAborted();
  const installAnchor = path.join(directory, 'package.json');
  const profile = loadProfileDirectory('dsh', path.join(home, 'profiles/companion'), installAnchor);
  // Share desktop DSH's credential store, as the Codex extension shares its CLI login:
  // one document, guarded by the store's cross-process writer lock and reloaded on change.
  // An overlay outranks every profile layer, so existing Companion homes adopt it too.
  // JSON is YAML; the literal path needs no `!!js`.
  const overlay = path.join(path.dirname(home), 'credentials.patch.yml');
  await writeFile(overlay, JSON.stringify([{ id: 'credentials', name: '@deepseek-ai/dsh-credentials-local',
    config: { path: path.join(source, '.credentials.yaml') } }]));
  return runProfile({ environment: loadLayeredEnv('dsh'), profile: 'companion', resolvedProfile: { profile, installAnchor }, patchFiles: [overlay],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
    packageManager: { command: process.execPath, args: [path.join(directory, 'node_modules/pnpm/bin/pnpm.cjs')], env: { PATH: process.env.PATH } } });
}
function begin() {
  if (application) return;
  startupTimer = setTimeout(() => { void fail(Object.assign(new Error('DSH startup exceeded its deadline'), { code: 'DSH_START_TIMEOUT' }), stage); }, 90000);
  application = boot();
  application.then(publishReady).catch(error => {
    if (error === startup.signal.reason) return;
    return fail(error, stage);
  }).catch(error => {
    console.error('DSH_FAILURE_RECORD', error.code || error.name); process.exit(1);
  });
}
/** @param {import('./contracts.js').RuntimeApp} app */
async function publishReady({ ctx }) {
  if (stopping) return;
  // DSH normally treats account activation failure as optional. Shared login must
  // report that failure to the editor rather than advertise a healthy runtime.
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === '@deepseek-ai/dsh-deepseek-account-platform' && !entry.disabled) await entry.fiber?.await();
  }
  stage = 'web';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Object.assign(new Error('Web services not ready'), { code: 'DSH_WEB_READY_TIMEOUT' })), 60000);
    ctx.inject(['webServer', 'connection'], () => { clearTimeout(timeout); resolve(undefined); });
  });
  if (stopping) return;
  clearTimeout(startupTimer);
  ready = { type: 'ready', version: manifest.version, pid: process.pid, port: ctx.webServer.port };
  for (const socket of clients) send(socket, ready);
}
/** @param {unknown} error @param {string} failureStage */
async function fail(error, failureStage) {
  await stop(1, error, failureStage);
}
/** @param {number} exitCode @param {unknown} [failure] @param {string} [failureStage] */
async function stop(exitCode, failure, failureStage = 'shutdown') {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer); clearTimeout(startupTimer);
  startup.abort(Object.assign(new Error('DSH startup cancelled'), { code: 'DSH_START_CANCELLED' }));
  // runProfile has no cancellation input. Keep ownership until it finishes or
  // this deadline exits our own process; never wait for an unfinished boot forever.
  setTimeout(() => { console.error('DSH_SHUTDOWN_TIMEOUT'); process.exit(1); }, 10000);
  try {
    if (failure) await recordFailure(failure, failureStage);
    const app = await application;
    await app?.shutdown.shutdown(exitCode);
    process.exit(exitCode);
  } catch (error) {
    if (error !== startup.signal.reason && error !== failure) await recordFailure(error, 'shutdown');
    process.exit(error === startup.signal.reason ? exitCode : 1);
  }
}
/** @param {unknown} value @param {string} failureStage */
async function recordFailure(value, failureStage) {
  const error = /** @type {import('./contracts.js').DiagnosticError} */ (value);
  const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'DSH_RUNTIME_FAILED';
  const frames = [error, ...(error.errors || []), ...(error.cause ? [error.cause] : [])].flatMap(failure =>
    (failure.stack || '').split('\n').filter(line => /^\s+at /.test(line))).slice(0, 24);
  const record = { type: 'error', pid: process.pid, version: manifest.version, code, stage: failureStage, errorName: error.name, frames };
  for (const socket of clients) { send(socket, record); socket.end(); }
  await mkdir(path.dirname(home), { recursive: true });
  await writeFile(path.join(path.dirname(home), 'runtime-error.json'), JSON.stringify(record, null, 2));
}
