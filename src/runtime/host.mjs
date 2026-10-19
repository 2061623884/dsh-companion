import net from 'node:net';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importDesktopData } from './import.mjs';

const home = path.resolve(process.argv[2]);
const source = path.resolve(process.argv[3]);
const directory = import.meta.dirname;
const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
const identity = createHash('sha256').update(home.toLowerCase()).digest('hex').slice(0, 32);
const clients = new Set();
let application, ready, timer, stopping = false, stage = 'import';
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
    if (message.type !== 'attach' || message.version !== manifest.version || stopping) {
      send(socket, { type: 'error', stage: 'control', code: 'DSH_RUNTIME_VERSION_OR_STATE' }); socket.end(); return;
    }
    attached = true; socket.setTimeout(0); clients.add(socket); clearTimeout(timer);
    send(socket, ready || { type: 'starting', stage });
  });
  socket.on('close', () => { clients.delete(socket); if (clients.size === 0) idle(); });
});
function idle() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    stopping = true;
    server.close();
    try { await (await application)?.shutdown.shutdown(0); }
    catch { process.exitCode = 1; }
  }, 5000);
}
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(`\\\\.\\pipe\\dsh-companion-${identity}`, resolve);
  });
} catch (error) {
  if (error.code === 'EADDRINUSE') process.exit(0);
  throw error;
}
idle();
process.env.DSH_HOME = home;
process.env.PATH = path.join(directory, 'bin') + path.delimiter + (process.env.PATH || '');
// Read-only bundled packages; package-manager writes are confined to the user's profile.
application = (async () => {
  await importDesktopData(source, home);
  stage = 'boot';
  const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
  const { loadProfileDirectory, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
  const installAnchor = path.join(directory, 'package.json');
  const profile = loadProfileDirectory('dsh', path.join(home, 'profiles/companion'), installAnchor);
  return runProfile({ environment: loadLayeredEnv('dsh'), profile: 'companion', resolvedProfile: { profile, installAnchor }, patchFiles: [],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
    packageManager: { command: process.execPath, args: [path.join(directory, 'node_modules/pnpm/bin/pnpm.cjs')], env: { PATH: process.env.PATH } } });
})();
try {
  const { ctx } = await application;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Object.assign(new Error('Web services not ready'), { code: 'DSH_WEB_READY_TIMEOUT' })), 60000);
    ctx.inject(['webServer', 'connection'], () => { clearTimeout(timeout); resolve(); });
  });
  ready = { type: 'ready', version: manifest.version, pid: process.pid, port: ctx.webServer.port };
  for (const socket of clients) send(socket, ready);
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'DSH_RUNTIME_BOOT_FAILED';
  const frames = [error, ...(error.errors || []), ...(error.cause ? [error.cause] : [])].flatMap(failure =>
    (failure.stack || '').split('\n').filter(line => /^\s+at /.test(line))).slice(0, 24);
  for (const socket of clients) { send(socket, { type: 'error', code, stage, errorName: error.name, frames }); socket.end(); }
  clearTimeout(timer); server.close(); process.exitCode = 1;
}
