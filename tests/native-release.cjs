// The only development extension is an empty harness. Companion is installed from VSIX.
const vscode = require('vscode'), assert = require('node:assert/strict'), fs = require('node:fs/promises');
const path = require('node:path'), net = require('node:net'), { createHash } = require('node:crypto'), { pathToFileURL } = require('node:url');
const http = require('node:http');
const { prepareWorkBuddyProfile } = require('./workbuddy-profile-fixture.cjs');
exports.run = async () => {
  const root = process.env.DSH_RELEASE_ROOT, desktop = process.env.DSH_HOME, id = process.env.DSH_RELEASE_EXTENSION_ID;
  const extension = vscode.extensions.getExtension(id);
  assert.ok(extension, 'VSIX extension must be installed');
  assert.equal(path.dirname(extension.extensionPath).toLowerCase(), process.env.DSH_RELEASE_EXTENSIONS.toLowerCase());
  const desktopFixture = await prepareWorkBuddyProfile(desktop);
  const previous = process.env.NODE_OPTIONS, networkFile = path.join(desktop, 'network.json');
  process.env.NODE_OPTIONS = '--import=' + pathToFileURL(path.join(root, 'tests/workbuddy-network-fixture.mjs'));
  process.env.DSH_WORKBUDDY_TEST_NETWORK = networkFile;
  await fs.writeFile(networkFile, '[]');
  const pending = new Map(); let serial = 0, ws, lease, pid, session;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const result = { vscodeVersion: vscode.version, installedPackage: true };
  const probe = { prompts: 0, hasSelection: false }, originalRequest = http.request;
  const interceptor = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8');
    assert.ok(body.includes('RELEASE_SEND_SENTINEL'), 'only a synthetic prompt may be intercepted');
    probe.prompts++; probe.hasSelection = body.includes('UNSAVED_RELEASE_CONTEXT');
    await delay(800); response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ type: 'server-response', rpcId: JSON.parse(body).rpcId,
      result: { ok: false, error: { code: 'test/intercepted', message: 'Synthetic failure' } } }));
  });
  await new Promise(resolve => interceptor.listen(0, '127.0.0.1', resolve));
  // Redirect only the installed proxy's prompt forwarding; this also covers worker RPC.
  http.request = function(options, callback) {
    if (options.method === 'POST' && options.path?.split('?')[0] === '/api/session/prompt') {
      return originalRequest.call(http, { ...options, hostname: '127.0.0.1', port: interceptor.address().port }, callback);
    }
    return originalRequest.apply(http, arguments);
  };
  async function send(method, params = {}, sessionId) {
    const requestId = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Release debugger request timed out: ' + method)); }, 10000);
      pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    });
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    assert.equal(response.exceptionDetails, undefined, 'Release UI probe must evaluate successfully'); return response.result.value;
  }
  async function until(check, stage, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(100); }
    throw new Error('Release installed acceptance timed out: ' + stage);
  }
  try {
    const folder = vscode.workspace.workspaceFolders[1], document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'main.py'));
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '# UNSAVED_RELEASE_CONTEXT\n'));
    editor.selection = new vscode.Selection(0, 2, 0, 25);
    await extension.activate(); await vscode.commands.executeCommand('dshCompanion.open');
    const debug = await (await fetch('http://127.0.0.1:' + process.env.DSH_RELEASE_DEBUG_PORT + '/json/version')).json();
    ws = new WebSocket(debug.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = event => {
      const message = JSON.parse(event.data), request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error('Release debugger protocol failure: ' + message.error.code)); else request.resolve(message.result);
    };
    const target = await until(async () => (await send('Target.getTargets')).targetInfos.find(value =>
      value.type === 'iframe' && /^http:\/\/127\.0\.0\.1:\d+\/.*[?&]dsh-companion=1(?:[&#]|$)/.test(value.url)), 'actual-sidebar-frame', 90000);
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, session);
    await until(async () => evaluate(`!!document.querySelector('#dsh-companion-toolbar')`), 'toolbar');
    // Confirm the normal first-use acknowledgement can be saved in the installed runtime.
    await evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(b=>/^(继续|Continue)$/.test(b.textContent.trim()));if(button)button.click();return true; })()`);
    await until(async () => evaluate(`!!document.querySelector('[data-composer-chip="vscode-editor"]') && document.querySelector('#dsh-companion-toolbar button[aria-label="新建会话"]')?.disabled === false`), 'automatic-workspace-and-reference');
    // Observe a runtime already owned by the installed extension. Never start a substitute.
    const actualHome = path.join(path.dirname(process.env.DSH_RELEASE_RESULT), 'profile/User/globalStorage', id, 'dsh');
    const identity = createHash('sha256').update(path.resolve(actualHome).toLowerCase()).digest('hex').slice(0, 32);
    lease = net.connect('\\\\.\\pipe\\dsh-companion-' + identity);
    pid = await new Promise((resolve, reject) => {
      let buffer = ''; lease.once('error', reject); lease.on('connect', () => lease.write(JSON.stringify({ type: 'attach', version: extension.packageJSON.version }) + '\n'));
      lease.on('data', data => { buffer += data; for (const line of buffer.split('\n').slice(0, -1)) { const message = JSON.parse(line); if (message.type === 'ready') resolve(message.pid); else if (message.type === 'error') reject(new Error('Release runtime attach failed')); } buffer = buffer.slice(buffer.lastIndexOf('\n') + 1); });
    });
    // Submit through the real installed composer; the loopback fixture rejects before backend admission.
    await evaluate(`(() => {
      const input=document.querySelector('[data-composer-input][contenteditable="true"]');input.focus();
      const range=document.createRange();range.selectNodeContents(input);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.execCommand('insertText',false,'RELEASE_SEND_SENTINEL');return true;
    })()`);
    await until(async () => evaluate(`(() => {const button=document.querySelector('button[aria-label="发送消息"],button[aria-label="Send message"]');return !!button&&!button.disabled;})()`), 'send-enabled');
    await evaluate(`document.querySelector('button[aria-label="发送消息"],button[aria-label="Send message"]').click(); true`);
    await until(async () => evaluate(`!document.querySelector('[data-composer-input]')?.innerText.includes('RELEASE_SEND_SENTINEL')`), 'immediate-send-feedback', 800);
    await until(async () => probe.prompts === 1 && evaluate(`!!document.querySelector('[data-composer-input]')?.innerText.includes('RELEASE_SEND_SENTINEL')`), 'failed-draft-restored');
    assert.equal(probe.hasSelection, true); assert.equal(probe.prompts, 1);
    result.interceptedPrompts = probe.prompts; result.unsavedReference = true; result.draftRestored = true;
    const requests = JSON.parse(await fs.readFile(networkFile, 'utf8'));
    const readRequests = new Set(['GET /console/enterprises/personal/models', 'POST /v2/billing/meter/get-user-resource']);
    result.generationCalls = requests.filter(request => !readRequests.has(request.method + ' ' + request.path)).length;
    assert.equal(result.generationCalls, 0, 'only model catalog and billing reads may reach the runtime network fixture');
    assert.equal(requests.filter(request => /refresh/.test(request.path) || request.refreshHeader).length, 0);
  } finally {
    http.request = originalRequest; interceptor.closeAllConnections(); await new Promise(resolve => interceptor.close(resolve));
    ws?.close(); lease?.destroy();
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Release debugger closed')); }
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    delete process.env.DSH_WORKBUDDY_TEST_NETWORK;
    result.desktopUnchanged = await desktopFixture.unchanged();
    // Runtime exit is checked by the outer runner after VS Code terminates.
    result.runtimePid = pid;
    await fs.writeFile(process.env.DSH_RELEASE_RESULT, JSON.stringify(result));
  }
  assert.equal(result.desktopUnchanged, true);
};
