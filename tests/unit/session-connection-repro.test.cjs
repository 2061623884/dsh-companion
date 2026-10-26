const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { randomBytes, createHmac, createHash } = require('node:crypto');
const { DesktopConnection } = require('../../dist/test/desktop/connection');

const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, start = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-session-recovery-'));
  const credentialsPath = path.join(directory, 'credentials.yaml');
  const secret = randomBytes(32), peers = new Set(), unavailable = [];
  let discoveries = 0, prompts = 0, candidates;
  const startIntents = [];
  let heldResponse, holdClosed;
  const closedHold = new Promise(resolve => { holdClosed = resolve; });
  let pauseProbe = false, probeReady, probeRequests = 0, notifyUnavailable;
  const lost = new Promise(resolve => { notifyUnavailable = resolve; });
  const writeGrant = () => fs.writeFile(credentialsPath, JSON.stringify({ records: {
    'client-connection/browser-session': { kind: 'grant', payload: { version: 1, secret: secret.toString('base64url') } }
  } }));
  await writeGrant();
  function authenticated(request) {
    const [, body, signature] = (request.headers.cookie || '').split('.');
    return !!body && signature === createHmac('sha256', secret).update(body).digest('base64url') &&
      JSON.parse(Buffer.from(body, 'base64url')).authority === request.headers.host;
  }
  const server = http.createServer((request, response) => {
    if (!authenticated(request)) { response.writeHead(401); response.end(); return; }
    if (request.url === '/') {
      probeRequests++;
      if (pauseProbe) { pauseProbe = false; probeReady(response); return; }
    }
    if (request.url === '/prompt') { prompts++; request.socket.destroy(); return; }
    if (request.url === '/hold') {
      heldResponse = response; response.on('close', holdClosed);
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('data: pending\n\n'); return;
    }
    response.end(request.url === '/' ? '<html>__ModuleLoader__</html>' : 'healthy');
  });
  server.on('upgrade', (request, socket) => {
    if (!authenticated(request)) { socket.destroy(); return; }
    peers.add(socket);
    socket.on('close', () => peers.delete(socket));
    socket.on('end', () => socket.destroy());
    const key = request.headers['sec-websocket-key'];
    const accept = key ? `Sec-WebSocket-Accept: ${createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')}\r\n` : '';
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' + accept + '\r\n');
    // This close-only test peer answers the real client's Close with code 1000,
    // then FIN, before the client's TCP close can reach the proxy.
    if (key) socket.once('data', () => socket.end(Buffer.from([0x88, 0x02, 0x03, 0xe8])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const hostPort = server.address().port;
  const connection = new DesktopConnection({ credentialsPath, assetsDirectory: path.resolve('dist'),
    acquire: async startIfStopped => {
      discoveries++; startIntents.push(startIfStopped);
      return typeof candidates === 'function' ? candidates(startIfStopped) : candidates || { pid: 42, port: hostPort };
    },
    onUnavailable: error => { unavailable.push(error); notifyUnavailable(error); } });
  t.after(async () => {
    await connection.dispose();
    for (const peer of peers) peer.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = start ? await connection.start() : undefined;
  async function websocket() {
    const address = new URL(base), socket = net.connect(Number(address.port), address.hostname);
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    socket.write(`GET /events HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: ${address.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    const [bytes] = await once(socket, 'data');
    assert.match(bytes.toString(), /101 Switching Protocols/);
    return { socket, peer: [...peers].at(-1) };
  }
  return { base, connection, unavailable, websocket, server, closedHold, credentialsPath, writeGrant, startIntents, lost,
    get probeRequests() { return probeRequests; },
    pauseNextProbe() { pauseProbe = true; return new Promise(resolve => { probeReady = resolve; }); },
    async stopHost() {
      const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      for (const peer of peers) peer.destroy();
      await stopped;
    },
    setCandidates(value) { candidates = value; },
    dropResponse() { heldResponse.destroy(); },
    get discoveries() { return discoveries; }, get prompts() { return prompts; } };
}

test('a Host exit reports unavailability after its established event stream closes without another browser request', { timeout: 3000 }, async t => {
  const f = await fixture(t), { socket } = await f.websocket();
  const closed = once(socket, 'close');
  await f.stopHost();
  await closed;
  await f.lost;
  assert.equal(f.unavailable.length, 1, 'the sidebar needs an outage notification to start its existing recovery loop');
  assert.equal(f.discoveries, 1, 'the disconnect callback must not replay discovery or application traffic itself');
});

test('a lost prompt response is reported once and the submitted prompt is never replayed', { timeout: 3000 }, async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/prompt', { method: 'POST', body: 'synthetic prompt' });
  assert.equal(response.status, 502);
  await response.text();
  assert.equal(f.prompts, 1);
  assert.equal(f.unavailable.length, 1, 'an actual HTTP transport failure must reach sidebar recovery');
  assert.equal(f.discoveries, 1);
});

test('a downstream TCP close keeps the healthy desktop target available', { timeout: 3000 }, async t => {
  const f = await fixture(t), { socket, peer } = await f.websocket();
  const peerClosed = once(peer, 'close');
  socket.destroy();
  await peerClosed;
  await settle();
  assert.equal(await (await fetch(f.base + '/api/session/list')).text(), 'healthy');
  assert.equal(f.discoveries, 1, 'closing one view must not turn its healthy shared Host into an outage');
  assert.equal(f.unavailable.length, 0);
});

test('WebSocket.close(1000) keeps a healthy Host available when its Close frame and FIN arrive first', { timeout: 3000 }, async t => {
  const f = await fixture(t), socket = new WebSocket(f.base.replace('http:', 'ws:') + '/events');
  t.after(() => socket.close());
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.close(1000);
  const [event] = await closed;
  assert.equal(event.code, 1000);
  assert.equal(await (await fetch(f.base + '/api/session/list')).text(), 'healthy');
  assert.equal(f.unavailable.length, 0, 'one normal WebSocket shutdown does not establish Host failure');
  assert.equal(f.discoveries, 1);
});

test('aborting a browser request leaves its healthy shared Host available', { timeout: 3000 }, async t => {
  const f = await fixture(t), controller = new AbortController();
  const response = await fetch(f.base + '/hold', { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await assert.rejects(reader.read());
  await f.closedHold;
  assert.equal(await (await fetch(f.base + '/api/session/list')).text(), 'healthy');
  assert.equal(f.discoveries, 1);
  assert.equal(f.unavailable.length, 0);
});

test('an interrupted streaming response invalidates its target and reports the outage', { timeout: 3000 }, async t => {
  const f = await fixture(t), response = await fetch(f.base + '/hold');
  const reader = response.body.getReader();
  await reader.read();
  f.dropResponse();
  await assert.rejects(reader.read());
  assert.equal(f.unavailable.length, 1);
  assert.equal(await (await fetch(f.base + '/api/session/list')).text(), 'healthy');
  assert.equal(f.discoveries, 2);
});

test('stream-close verification is coalesced and a late failed check cannot invalidate a replacement target', { timeout: 3000 }, async t => {
  const f = await fixture(t), first = await f.websocket(), second = await f.websocket();
  const held = f.pauseNextProbe(), closed = Promise.all([once(first.socket, 'close'), once(second.socket, 'close')]);
  first.peer.destroy(); second.peer.destroy();
  const probe = await held;
  await closed; await settle();
  assert.equal(f.probeRequests, 2, 'startup plus one coalesced liveness check');
  assert.equal(f.unavailable.length, 0);
  await f.connection.reconnect({ startDesktop: false });
  const completed = once(probe, 'close');
  probe.writeHead(401); probe.end(); await completed;
  assert.equal(await (await fetch(f.base + '/api/session/list')).text(), 'healthy');
  assert.equal(f.discoveries, 2);
  assert.equal(f.unavailable.length, 0);
});

test('disposing Companion closes its streams without reporting or stopping the Desktop Host', { timeout: 3000 }, async t => {
  const f = await fixture(t), { socket } = await f.websocket(), checking = await f.websocket();
  const held = f.pauseNextProbe(), checkClosed = once(checking.socket, 'close');
  checking.peer.destroy();
  const probe = await held;
  await checkClosed;
  const probeClosed = once(probe, 'close');
  const closed = once(socket, 'close'), host = `http://127.0.0.1:${f.server.address().port}`;
  await f.connection.dispose();
  await closed; await probeClosed;
  assert.equal(f.unavailable.length, 0);
  assert.equal((await fetch(host)).status, 401, 'the synthetic Host still accepts connections');
});

test('discovery ignores a stale candidate, reports no ready Host, and rejects two authenticated Hosts', { timeout: 3000 }, async t => {
  const f = await fixture(t), stale = http.createServer();
  await new Promise(resolve => stale.listen(0, '127.0.0.1', resolve));
  const staleAddress = { pid: 41, port: stale.address().port };
  await new Promise(resolve => stale.close(resolve));
  const readyAddress = { pid: 42, port: f.server.address().port };
  f.setCandidates([staleAddress, readyAddress]);
  assert.equal(await f.connection.reconnect(), f.base);
  f.setCandidates([staleAddress]);
  await assert.rejects(f.connection.reconnect(), { code: 'DSH_DESKTOP_NOT_READY' });
  const other = http.createServer(f.server.listeners('request')[0]);
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(async () => { other.closeAllConnections(); await new Promise(resolve => other.close(resolve)); });
  f.setCandidates([staleAddress, readyAddress, { pid: 43, port: other.address().port }]);
  await assert.rejects(f.connection.reconnect(), { code: 'DSH_DESKTOP_MULTIPLE' });
  const malformed = net.createServer(socket => socket.once('data', () => socket.end('not-an-http-response\r\n\r\n')));
  await new Promise(resolve => malformed.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => malformed.close(resolve)));
  f.setCandidates([{ pid: 44, port: malformed.address().port }, readyAddress]);
  await assert.rejects(f.connection.reconnect(), error => {
    assert.match(error.code, /^HPE_/);
    return true;
  });
});

test('a timed-out candidate does not hide a later authenticated Host', { timeout: 6000 }, async t => {
  const f = await fixture(t), silent = http.createServer(() => {});
  await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve));
  t.after(async () => { silent.closeAllConnections(); await new Promise(resolve => silent.close(resolve)); });
  f.setCandidates([{ pid: 41, port: silent.address().port }, { pid: 42, port: f.server.address().port }]);
  assert.equal(await f.connection.reconnect(), f.base);
});

test('a credential file not created yet is retryable, but malformed credentials stay an explicit error', { timeout: 3000 }, async t => {
  const f = await fixture(t, false);
  await fs.unlink(f.credentialsPath);
  await assert.rejects(f.connection.start(), error => {
    assert.equal(error.code, 'DSH_DESKTOP_NOT_READY');
    assert.equal(error.message.includes(f.credentialsPath), false);
    return true;
  });
  await f.writeGrant();
  const base = await f.connection.start();
  assert.equal(await (await fetch(base + '/api/session/list')).text(), 'healthy');
  await fs.writeFile(f.credentialsPath, 'records: [');
  await assert.rejects(f.connection.reconnect(), error => {
    assert.match(error.message, /CREDENTIAL_PARSE/);
    assert.notEqual(error.code, 'DSH_DESKTOP_NOT_READY');
    return true;
  });
});

test('only startup and explicit reconnect may start a stopped Desktop', { timeout: 3000 }, async t => {
  const f = await fixture(t);
  assert.deepEqual(f.startIntents, [true]);
  assert.equal((await fetch(f.base + '/prompt', { method: 'POST', body: 'synthetic' })).status, 502);
  assert.equal(await (await fetch(f.base + '/api/session/list')).text(), 'healthy');
  await f.connection.reconnect({ startDesktop: false });
  await f.connection.reconnect();
  assert.deepEqual(f.startIntents, [true, false, false, true]);
});

test('an explicit reconnect can start Desktop after an in-flight read-only discovery reports it stopped', { timeout: 3000 }, async t => {
  const f = await fixture(t);
  let rejectDiscovery;
  f.setCandidates(startIfStopped => startIfStopped
    ? { pid: 42, port: f.server.address().port }
    : new Promise((resolve, reject) => { rejectDiscovery = reject; }));
  const automatic = f.connection.reconnect({ startDesktop: false });
  const rejected = assert.rejects(automatic, { code: 'DSH_DESKTOP_NOT_RUNNING' });
  const explicit = f.connection.reconnect();
  rejectDiscovery(Object.assign(new Error('Synthetic stopped Desktop'), { code: 'DSH_DESKTOP_NOT_RUNNING' }));
  await rejected;
  assert.equal(await explicit, f.base);
  assert.deepEqual(f.startIntents, [true, false, true]);
});
