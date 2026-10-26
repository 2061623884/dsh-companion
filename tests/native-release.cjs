// The only development extension is an empty harness. Companion is installed from VSIX.
const vscode = require('vscode'), assert = require('node:assert/strict'), fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
exports.run = async () => {
  const root = process.env.DSH_RELEASE_ROOT, desktop = process.env.DSH_HOME, id = process.env.DSH_RELEASE_EXTENSION_ID;
  const extension = vscode.extensions.getExtension(id);
  assert.ok(extension, 'VSIX extension must be installed');
  assert.equal(path.dirname(extension.extensionPath).toLowerCase(), process.env.DSH_RELEASE_EXTENSIONS.toLowerCase());
  const sharedStore = path.join(desktop, '.credentials.yaml');
  const networkFile = process.env.DSH_DESKTOP_NETWORK;
  const pending = new Map(); let serial = 0, ws, session;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const result = { vscodeVersion: vscode.version, installedPackage: true, phase: 0 };
  const probe = { prompts: 0, hasSelection: false }, originalRequest = http.request;
  const interceptor = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8');
    assert.ok(body.includes('RELEASE_SEND_SENTINEL'), 'only a synthetic prompt may be intercepted');
    probe.prompts++; probe.hasSelection = body.includes('UNSAVED_RELEASE_CONTEXT');
    result.promptSessionId = JSON.parse(body).payload.args.request.sessionId;
    assert.equal(typeof result.promptSessionId, 'string');
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
    result.phase = 1;
    await extension.activate(); await vscode.commands.executeCommand('dshCompanion.open');
    const debug = await (await fetch('http://127.0.0.1:' + process.env.DSH_RELEASE_DEBUG_PORT + '/json/version')).json();
    ws = new WebSocket(debug.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = event => {
      const message = JSON.parse(event.data), request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error('Release debugger protocol failure: ' + message.error.code)); else request.resolve(message.result);
    };
    result.phase = 2;
    const target = await until(async () => {
      const targets = (await send('Target.getTargets')).targetInfos;
      result.iframeTargets = targets.filter(value => value.type === 'iframe').length;
      return targets.find(value => value.type === 'iframe' && /^http:\/\/127\.0\.0\.1:\d+\/.*[?&]dsh-companion=1(?:[&#]|$)/.test(value.url));
    }, 'actual-sidebar-frame', 90000);
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, session);
    result.phase = 3;
    await until(async () => evaluate(`!!document.querySelector('#dsh-companion-toolbar')`), 'toolbar');
    // The first-use dialog must be reachable through the real loading overlay.
    const wrapperTarget = await until(async () => (await send('Target.getTargets')).targetInfos.find(value =>
      value.type === 'iframe' && value.url.startsWith('vscode-webview://') && value.url.includes('extensionId=' + id)), 'wrapper');
    const wrapperSession = (await send('Target.attachToTarget', { targetId: wrapperTarget.targetId, flatten: true })).sessionId;
    await until(async () => {
      result.loadingPage = await evaluate(`({ layout:!!document.querySelector('[data-dsh-companion-frame]'),
        dialog:!!document.querySelector('[role="dialog"]'), composer:!!document.querySelector('[data-composer-input]'),
        stylesheet:[...document.querySelectorAll('link')].some(link=>link.href.includes('/__dsh_companion/sidebar.css')&&!!link.sheet),
        theme:!!document.body.style.getPropertyValue('--dsh-companion-background'),
        workspacePending:document.querySelector('#dsh-companion-context')?.textContent==='正在连接工作区…' })`);
      const response = await send('Runtime.evaluate', { expression: `(() => {
        const content=document.getElementById('active-frame').contentDocument;
        const loader=content.getElementById('dsh-companion-loading'), frame=content.querySelector('iframe');
        return { loaderPresent:!!loader, hidden:!!loader&&getComputedStyle(loader).visibility==='hidden', chatInteractive:!!frame&&!frame.inert };
      })()`, returnByValue: true }, wrapperSession);
      assert.equal(response.exceptionDetails, undefined, 'Loading probe must inspect the actual webview document');
      result.loadingOverlay = response.result.value;
      return result.loadingOverlay?.hidden && result.loadingOverlay?.chatInteractive;
    }, 'loading-overlay-dismissed');
    result.loadingDismissed = true;
    // Confirm the normal first-use acknowledgement can be saved in the installed runtime.
    await until(async () => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(b=>/^(继续|Continue)$/.test(b.textContent.trim()));return !!button&&!button.disabled; })()`), 'welcome-ready');
    await evaluate(`[...document.querySelectorAll('button')].find(b=>/^(继续|Continue)$/.test(b.textContent.trim())).click(); true`);
    await until(async () => evaluate(`!!document.getElementById('root') && !document.getElementById('root').inert && ![...document.querySelectorAll('button')].some(b=>/^(继续|Continue)$/.test(b.textContent.trim()))`), 'welcome-dismissed');
    result.phase = 4;
    await until(async () => evaluate(`!!document.querySelector('[data-composer-chip="vscode-editor"]') && document.querySelector('#dsh-companion-toolbar button[aria-label="新建会话"]')?.disabled === false`), 'automatic-workspace-and-reference');
    // The installed extension connects to the existing Desktop Host and creates no independent home.
    const actualHome = path.join(path.dirname(process.env.DSH_RELEASE_RESULT), 'profile/User/globalStorage', id, 'dsh');
    await assert.rejects(fs.access(path.join(extension.extensionPath, 'runtime')), { code: 'ENOENT' });
    await assert.rejects(fs.access(actualHome), { code: 'ENOENT' });
    result.desktopRuntimeShared = true;
    // Submit through the real installed composer; the loopback fixture rejects before backend admission.
    result.phase = 6;
    await evaluate(`(() => {
      const input=document.querySelector('[data-composer-input][contenteditable="true"]');input.focus();
      const range=document.createRange();range.selectNodeContents(input);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.execCommand('insertText',false,'RELEASE_SEND_SENTINEL');return true;
    })()`);
    await until(async () => evaluate(`!!document.querySelector('[data-composer-input]')?.innerText.includes('RELEASE_SEND_SENTINEL')`), 'input-committed');
    result.phase = 7;
    await until(async () => evaluate(`(() => {const button=document.querySelector('button[aria-label="发送消息"],button[aria-label="Send message"]');return !!button&&!button.disabled;})()`), 'send-enabled');
    result.phase = 8;
    await evaluate(`document.querySelector('button[aria-label="发送消息"],button[aria-label="Send message"]').click(); true`);
    await until(async () => evaluate(`!document.querySelector('[data-composer-input]')?.innerText.includes('RELEASE_SEND_SENTINEL')`), 'immediate-send-feedback', 800);
    result.phase = 9;
    await until(async () => probe.prompts === 1 && evaluate(`!!document.querySelector('[data-composer-input]')?.innerText.includes('RELEASE_SEND_SENTINEL')`), 'failed-draft-restored');
    result.phase = 10;
    assert.equal(probe.hasSelection, true); assert.equal(probe.prompts, 1);
    result.interceptedPrompts = probe.prompts; result.unsavedReference = true; result.draftRestored = true;
    // Use the installed sidebar's same-origin RPC and actual shared store.
    const account = method => evaluate(`(async () => {
      const method = ${JSON.stringify(method)};
      const args = method === 'signOut' ? {client:{version:${JSON.stringify(extension.packageJSON.version)},locale:'en',timezoneOffsetSeconds:0}} : {};
      const response = await fetch('/api/account/' + method, { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({type:'client-request',rpcId:'native-shared-' + method,method:'account/' + method,payload:{args}}) });
      const result = (await response.json()).result;
      if (!result.ok) throw new Error('Shared account RPC failed');
      return result.value.status;
    })()`);
    assert.equal(await account('getState'), 'credential-stored');
    await assert.rejects(fs.access(path.join(actualHome, '.credentials.yaml')), { code: 'ENOENT' });
    result.sharedLogin = true;
    const { desktopRpc } = await import('./desktop-fixture.mjs');
    const sessions = await desktopRpc(desktop, process.env.DSH_DESKTOP_ADDRESS, 'session/list', { _request: {} });
    assert.ok(JSON.stringify(sessions).includes(result.promptSessionId)); result.sharedSessions = true;
    const settings = await desktopRpc(desktop, process.env.DSH_DESKTOP_ADDRESS, 'settings/describe', {});
    assert.ok(JSON.stringify(settings).includes('2026-09-28.1')); result.sharedConfiguration = true;
    for (const label of ['插件', '自动化任务', '设置']) {
      await evaluate(`document.querySelector('#dsh-companion-toolbar button[aria-label="${label}"]').click();true`);
      await delay(350);
      if (label === '设置') {
        const originalStyle = (await send('Runtime.evaluate', { expression: `document.getElementById('active-frame').contentDocument.querySelector('iframe').style.cssText`, returnByValue: true }, wrapperSession)).result.value;
        result.settingsLayouts = [];
        for (const width of [300, 420, 960]) {
          await send('Runtime.evaluate', { expression: `(() => {const frame=document.getElementById('active-frame').contentDocument.querySelector('iframe'); frame.style.width='${width}px';frame.style.height='640px';frame.style.flex='none';})()` }, wrapperSession);
          await delay(100);
          const geometry = await evaluate(`(() => {
            const panel = document.querySelector('[data-dsh-companion-settings]');
            const rect = element => { const r=element.getBoundingClientRect(); return {top:r.top,left:r.left,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
            return { viewport:{width:innerWidth,height:innerHeight}, panel:rect(panel), children:[...panel.children].map(rect) };
          })()`);
          result.settingsLayouts.push(geometry);
          assert.equal(geometry.viewport.width, width);
          assert.ok(geometry.children[0].height <= 64, 'Settings title must not consume the content area: ' + JSON.stringify(geometry));
          assert.ok(geometry.children[2].height <= 64, 'Settings close row must stay compact');
          assert.ok(geometry.children[3].height >= geometry.panel.height * 0.6, 'Settings content must use the remaining panel height');
          assert.ok(geometry.children.every(child => child.left >= geometry.panel.left - 1 && child.right <= geometry.panel.right + 1), 'Settings sections must fit inside the sidebar');
        }
        await send('Runtime.evaluate', { expression: `document.getElementById('active-frame').contentDocument.querySelector('iframe').style.cssText=${JSON.stringify(originalStyle)}` }, wrapperSession);
      }
      await evaluate(`document.querySelector('#dsh-companion-toolbar button[aria-label="${label}"]').click();true`);
      await delay(350); assert.ok(await evaluate(`!!document.querySelector('[data-composer-input]')`));
    }
    result.navigationPreserved = true;
    await evaluate(`(() => {const input=document.querySelector('[data-composer-input]');input.focus();const r=document.createRange();r.selectNodeContents(input);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand('insertText',false,'请解释当前代码选区');return true;})()`);
    const mainTarget = (await send('Target.getTargets')).targetInfos.find(value => value.type === 'page' && value.url.includes('workbench'));
    const screenshotSession = (await send('Target.attachToTarget', { targetId: mainTarget.targetId, flatten: true })).sessionId;
    await delay(250);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, screenshotSession);
    await fs.writeFile(path.join(root, '.test-work/release/desktop-preview-' + vscode.version + '.png'), Buffer.from(screenshot.data, 'base64'));
    assert.equal(await account('signOut'), 'signed-out');
    const shared = require('../node_modules/js-yaml').load(await fs.readFile(sharedStore, 'utf8'));
    assert.equal(shared.records['deepseek-account-platform/default'], undefined);
    assert.ok(shared.records['client-connection/browser-session']);
    result.sharedSignOut = true;
    await until(async () => JSON.parse(await fs.readFile(networkFile, 'utf8')).some(request => request.path === '/auth-api/v0/users/logout'), 'synthetic-sign-out');
    const requests = JSON.parse(await fs.readFile(networkFile, 'utf8'));
    const allowedRequests = new Set(['GET /models', 'GET /console/enterprises/personal/models', 'POST /v2/billing/meter/get-user-resource',
      'GET /auth-api/v0/users/current', 'GET /api/v0/users/get_user_summary', 'GET /api/v0/users/get_unnotified_bonuses', 'POST /auth-api/v0/users/logout']);
    result.generationCalls = requests.filter(request => !allowedRequests.has(request.method + ' ' + request.path)).length;
    assert.equal(result.generationCalls, 0, 'only catalog/account reads and synthetic sign-out may reach the network fixture');
    assert.equal(requests.filter(request => /refresh/.test(request.path) || request.refreshHeader).length, 0);
  } finally {
    result.interceptedPrompts = probe.prompts;
    http.request = originalRequest; interceptor.closeAllConnections(); await new Promise(resolve => interceptor.close(resolve));
    ws?.close();
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Release debugger closed')); }
    await fs.writeFile(process.env.DSH_RELEASE_RESULT, JSON.stringify(result));
  }
};
