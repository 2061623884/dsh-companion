const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), net = require('node:net'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');
const { DesktopConnection } = require('../dist/test/desktop/connection');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-companion-test-'));
  const credentialsPath = path.join(directory, 'credentials.yaml');
  let secret = randomBytes(32), discoveries = 0, prompts = 0, unauthorized = false;
  const writeSecret = () => fs.writeFile(credentialsPath, JSON.stringify({ records: { 'client-connection/browser-session': { kind: 'grant', payload: { version: 1, secret: secret.toString('base64url') } } } }));
  await writeSecret();
  function authenticated(req) {
    const cookie = req.headers.cookie || '', [, encoded, signature] = cookie.split('.');
    if (!encoded || !signature || signature !== createHmac('sha256', secret).update(encoded).digest('base64url')) return false;
    return JSON.parse(Buffer.from(encoded, 'base64url')).authority === req.headers.host;
  }
  const server = http.createServer((req, res) => {
    if (!authenticated(req) || unauthorized) { res.writeHead(401); res.end('unauthorized'); return; }
    if (req.url === '/prompt') { prompts++; req.socket.destroy(); return; }
    if (req.url === '/stream') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.end('data: last\n\n'), 30); return; }
    res.setHeader('set-cookie', 'must-not-leak=1');
    res.end(req.url.startsWith('/') && !req.url.startsWith('/api') ? '<html>__ModuleLoader__<script>(globalThis.__DSH_BOOT_READY__ = true)</script></html>' : 'api-ok');
  });
  server.on('upgrade', (req, socket) => {
    if (!authenticated(req)) { socket.destroy(); return; }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.on('data', bytes => socket.write(bytes));
    socket.on('end', () => socket.destroy());
  });
  let port = await listen(server);
  const connection = new DesktopConnection({ credentialsPath, assetsDirectory: path.resolve('dist'), discover: async () => { discoveries++; return [{ pid: 42, port }]; } });
  t.after(async () => { await connection.dispose(); server.closeAllConnections(); await close(server); await fs.rm(directory, { recursive: true, force: true }); });
  return { connection, server, get discoveries() { return discoveries; }, get prompts() { return prompts; }, set unauthorized(value) { unauthorized = value; },
    async rotateSecret() { secret = randomBytes(32); await writeSecret(); },
    async changePort() { server.closeAllConnections(); await close(server); port = await listen(server); } };
}
test('startup single-flight, authenticated streams and healthy idle requests never rediscover', async t => {
  const f = await fixture(t), urls = await Promise.all([f.connection.start(), f.connection.start(), f.connection.start()]);
  assert.equal(new Set(urls).size, 1); assert.equal(f.discoveries, 1);
  const root = await fetch(urls[0] + '/?dsh-companion=1');
  assert.match(await root.text(), /__dsh_companion\/bootstrap.js/); assert.equal(root.headers.get('set-cookie'), null);
  assert.match(await (await fetch(urls[0] + '/__dsh_companion/sidebar.js')).text(), /dsh-companion-sidebar/);
  assert.doesNotMatch(await (await fetch(urls[0] + '/')).text(), /bootstrap.js/);
  const stream = await fetch(urls[0] + '/stream'), reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  while (!(await reader.read()).done) {}
  // Advance the wall clock past the old five-second discovery TTL without waiting.
  const now = Date.now; Date.now = () => now() + 6000;
  try { assert.equal(await (await fetch(urls[0] + '/api/test')).text(), 'api-ok'); }
  finally { Date.now = now; }
  assert.equal(f.discoveries, 1);
});
test('failed POST is never replayed; next request rediscovers after desktop changes port', async t => {
  const f = await fixture(t), base = await f.connection.start();
  assert.equal((await fetch(base + '/prompt', { method: 'POST', body: 'test' })).status, 502);
  assert.equal(f.prompts, 1); assert.equal(f.discoveries, 1);
  await f.changePort(); assert.equal(await (await fetch(base + '/api/test')).text(), 'api-ok'); assert.equal(f.discoveries, 2);
  assert.equal(await f.connection.reconnect(), base); assert.equal(f.discoveries, 3);
});
test('401 is returned without replay; next request refreshes rotated credentials', async t => {
  const f = await fixture(t), base = await f.connection.start(); await f.rotateSecret();
  assert.equal((await fetch(base + '/api/test')).status, 401); assert.equal(f.discoveries, 1);
  assert.equal(await (await fetch(base + '/api/test')).text(), 'api-ok'); assert.equal(f.discoveries, 2);
  const denied = await fetch(base + '/api/test', { headers: { Origin: 'https://untrusted.example' } }); assert.equal(denied.status, 502);
});
test('authenticated websocket upgrade preserves bidirectional stream', async t => {
  const f = await fixture(t), base = new URL(await f.connection.start());
  await new Promise((resolve, reject) => {
    const socket = net.connect(Number(base.port), base.hostname); let upgraded = false, body = '';
    socket.on('error', reject); socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('upgrade timed out')); });
    socket.on('connect', () => socket.write(`GET /events HTTP/1.1\r\nHost: ${base.host}\r\nOrigin: ${base.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
    socket.on('data', bytes => { body += bytes; if (!upgraded && body.includes('\r\n\r\n')) { assert.match(body, /101 Switching Protocols/); upgraded = true; body = ''; socket.write('ping'); } else if (body === 'ping') { socket.destroy(); resolve(); } });
  });
});
