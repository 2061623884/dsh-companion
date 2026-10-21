const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { createHash } = require('node:crypto');
const { RuntimeClient } = require('../../dist/test/runtime/client');

test('invalid control JSON rejects the lease with a protocol error rather than throwing or retrying', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-invalid-control-'));
  let index = 0;
  for (const value of [null, [], {}, { type: 'unknown' }, { type: 'error', code: 1 }, { type: 'error', stage: 'boot', code: 'FIXTURE', frames: [1] }]) {
    const home = path.join(root, String(index++));
    const identity = createHash('sha256').update(path.resolve(home).toLowerCase()).digest('hex').slice(0, 32);
    let attempts = 0; const sockets = new Set();
    const server = net.createServer(socket => {
      attempts++; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.once('data', () => socket.write(JSON.stringify(value) + '\n'));
    });
    await new Promise(resolve => server.listen(`\\\\.\\pipe\\dsh-companion-${identity}`, resolve));
    const client = new RuntimeClient(path.resolve('runtime'), home, path.join(root, 'no-desktop'));
    try { await assert.rejects(client.acquire(), { code: 'DSH_CONTROL_PROTOCOL' }); assert.equal(attempts, 1); }
    finally { client.dispose(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  }
});

test('ordinary text containing a non-object reference marker remains ordinary text', async () => {
  const { matchEditorReference: match } = require('../../dist/test/sidebar/client/reference-display');
  for (const value of ['null', '[]', '1', '{}', '{"filePath":"a.py","content":2}']) {
    assert.equal(match('[VS Code 文件引用]\n' + value + '\n[/VS Code 文件引用]', 0), undefined);
  }
  assert.ok(match('[VS Code 文件引用]\n{"filePath":"a.py","content":"fixture"}\n[/VS Code 文件引用]', 0));
});
