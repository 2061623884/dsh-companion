// Opt-in native VS Code acceptance. Only synthetic data and intercepted prompts.
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { createHash } = require('node:crypto'), assert = require('node:assert/strict');
exports.run = async () => {
  const root = path.resolve(__dirname, '..'), work = path.join(root, '.test-work/native-reliability');
  const { RuntimeClient } = require('../dist/test/runtime/client'), { RuntimeConnection } = require('../dist/test/runtime/connection');
  const { EditorContext } = require('../dist/test/context/editor-context'), { frameHtml } = require('../dist/test/sidebar/view');
  const directory = await fs.mkdtemp(work + '-'), home = path.join(directory, 'home'), source = path.join(directory, 'desktop');
  const authDir = path.join(source, 'profiles/desktop/.dsh-workbuddy-connect'); await fs.mkdir(authDir, { recursive: true });
  const auth = path.join(authDir, '.workbuddy-auth.json');
  await fs.writeFile(auth, JSON.stringify({ region: 'cn', auth: { accessToken: 'fixture-native-access', refreshToken: 'fixture-never-refresh',
    expiresAt: Date.now() + 3600000, domain: 'copilot.tencent.com' } }));
  await fs.writeFile(path.join(source, 'profiles/desktop/cordis.patch.yml'), JSON.stringify([
    { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'workbuddy', model: 'fixture-workbuddy' } },
  ]));
  const hash = async () => createHash('sha256').update(await fs.readFile(auth)).digest('hex'), before = await hash();
  const requestsFile = path.join(directory, 'network.json'), previous = process.env.NODE_OPTIONS, previousNetwork = process.env.DSH_WORKBUDDY_TEST_NETWORK;
  process.env.NODE_OPTIONS = '--import=' + pathToFileURL(path.join(root, 'tests/workbuddy-network-fixture.mjs'));
  process.env.DSH_WORKBUDDY_TEST_NETWORK = requestsFile;
  const runtime = path.join(root, 'runtime'), client = new RuntimeClient(runtime, home, source);
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, assetsDirectory: directory, acquire: () => client.acquire() });
  const editor = new EditorContext(), result = { vscodeVersion: vscode.version, cases: [] };
  let panel, address;
  const http = require('node:http'), net = require('node:net'), sockets = new Set();
  let server, promptCount = 0, promptBytes = [];
  try {
    const start = performance.now(), base = await connection.start(); address = await client.acquire();
    result.backendReadyMs = Math.round(performance.now() - start);
    for (const name of ['bootstrap.js', 'sidebar.js', 'sidebar.css']) await fs.copyFile(path.join(root, 'dist', name), path.join(directory, name));
    await fetch(base + '/api/settings/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-welcome', method: 'settings/mutate', payload: { args: { ns: 'ui-settings-general',
        ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-09-28.1' }], expectedRevision: 0 } } }) });
    server = http.createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
      if (req.method === 'POST' && body.includes('PERF_SEND_SENTINEL')) {
        promptCount++; promptBytes.push(body.length);
        setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ type: 'server-response', rpcId: JSON.parse(body).rpcId,
          result: { ok: false, error: { code: 'test/intercepted', message: 'Synthetic failure; no model called' } } })); }, 800); return;
      }
      const headers = { ...req.headers, host: new URL(base).host }; if (headers.origin) headers.origin = base;
      const peer = http.request(base + req.url, { method: req.method, headers }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
      peer.on('error', error => res.destroy(error)); peer.end(body);
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', (req, socket, head) => {
      const target = new URL(base), peer = net.connect(target.port, target.hostname, () => {
        peer.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + Object.entries({ ...req.headers, host: target.host, origin: base }).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n');
        if (head.length) peer.write(head); socket.pipe(peer); peer.pipe(socket);
      });
      peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy()); socket.on('close', () => peer.destroy());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const bytes of [256, 1048576]) {
      const locale = bytes === 256 ? 'zh' : 'en';
      const language = await fetch(base + '/api/settings/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-locale', method: 'settings/mutate', payload: { args: { ns: 'locale',
          ops: [{ op: 'set', path: ['preference'], value: locale }], expectedRevision: bytes === 256 ? 0 : 1 } } }) });
      assert.equal(language.status, 200); assert.equal((await language.json()).result.ok, true);
      const file = path.join(directory, 'fixture-' + bytes + '.py'); await fs.writeFile(file, 'x'.repeat(bytes));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      await new Promise(resolve => setTimeout(resolve, 150));
      const probe = `
(() => {
  const phase=value=>parent.postMessage({source:'dsh-companion-sidebar',type:'trace',stage:'native-probe-phase',durationMs:value,bytes:document.visibilityState==='visible'?1:0},'*');
  phase(0);
  let began=false;const timer=setInterval(()=>{
    const input=document.querySelector('[data-composer-input][contenteditable="true"]'), chip=document.querySelector('[data-composer-chip="vscode-editor"]');
    if(began||!input||!chip)return;began=true;clearInterval(timer);phase(1);
    input.focus();const range=document.createRange();range.selectNodeContents(input);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    document.execCommand('insertText',false,'PERF_SEND_SENTINEL');
    requestAnimationFrame(()=>{
      phase(2);
      const send=document.querySelector('button[aria-label="${locale === 'zh' ? '发送消息' : 'Send message'}"]');const started=performance.now(),samples=[];
      const sample=()=>{samples.push({ms:performance.now()-started,empty:!input.innerText.includes('PERF_SEND_SENTINEL')});
        if(performance.now()-started<1600)requestAnimationFrame(sample);else parent.postMessage({source:'dsh-companion-sidebar',type:'trace',stage:'native-send-result',durationMs:samples.find(value=>value.empty)?.ms??-1,bytes:samples.at(-1).empty?0:1},'*');};
      send.click();phase(3);requestAnimationFrame(sample);
    });
  },50);
})();`;
      await fs.writeFile(path.join(directory, 'bootstrap.js'), await fs.readFile(path.join(root, 'dist/bootstrap.js'), 'utf8') + probe);
      panel = vscode.window.createWebviewPanel('dshReliabilityTest', 'DSH reliability acceptance', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
      const traces = [], caseStart = performance.now();
      let probePhase = -1, probeVisible = false;
      const samples = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Native send acceptance timed out: phase=${probePhase}, visible=${probeVisible}, prompts=${promptCount}`)), 25000);
        panel.webview.onDidReceiveMessage(async message => {
          if (message.type === 'ready') await panel.webview.postMessage({ type: 'context', context: editor.snapshot() });
          if (message.type === 'read-reference') {
            const started = performance.now(), value = await editor.read(message.uri);
            traces.push({ stage: 'reference-read', durationMs: performance.now() - started, bytes: Buffer.byteLength(value.content) });
            await panel.webview.postMessage({ type: 'reference-result', requestId: message.requestId, value });
          }
          if (message.type === 'trace') {
            if (message.stage === 'native-probe-phase' && Number.isInteger(message.durationMs) && message.durationMs >= 0 && message.durationMs <= 3) {
              probePhase = message.durationMs; probeVisible = message.bytes === 1;
            }
            if (message.stage === 'native-send-result') { clearTimeout(timeout); resolve(message); }
            else traces.push({ stage: message.stage, durationMs: message.durationMs });
          }
        });
        panel.webview.html = frameHtml('http://127.0.0.1:' + server.address().port);
      });
      assert.ok(samples.durationMs >= 0, 'send must visibly clear the draft while the request is still pending');
      assert.ok(samples.durationMs < 800, 'local feedback must not wait for the intercepted server response');
      assert.equal(samples.bytes, 1, 'failed draft must be restored');
      result.cases.push({ bytes, locale, webviewAndProbeMs: Math.round(performance.now() - caseStart), firstFeedbackMs: Math.round(samples.durationMs), draftRestored: true, traces });
      panel.dispose(); panel = undefined;
    }
    assert.equal(promptCount, 2); assert.ok(promptBytes[1] > 1048576);
    result.interceptedPrompts = promptCount; result.generationCalls = 0;
  } finally {
    panel?.dispose(); editor.dispose(); for (const socket of sockets) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    await connection.dispose(); client.dispose();
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    if (previousNetwork === undefined) delete process.env.DSH_WORKBUDDY_TEST_NETWORK; else process.env.DSH_WORKBUDDY_TEST_NETWORK = previousNetwork;
    result.syntheticDesktopCredentialUnchanged = before === await hash();
    if (address) for (let i = 0; i < 130; i++) {
      try { process.kill(address.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { result.ownedRuntimeExited = true; break; } throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await fs.writeFile(path.join(root, '.test-work/native-reliability-result.json'), JSON.stringify(result, null, 2));
  }
  assert.equal(result.syntheticDesktopCredentialUnchanged, true); assert.equal(result.ownedRuntimeExited, true);
};
