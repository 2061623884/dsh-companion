// Real DSH UI in a VS Code webview; synthetic home only, no model requests.
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');

async function probe() {
  const checks = [], query = selector => document.querySelector(selector);
  const check = (value, name) => { if(!value) throw new Error(name); checks.push(name); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 650));
  const wait = async test => {
    for(let i = 0; i < 160; i++) { if(test()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('UI did not become ready');
  };
  try {
    await wait(() => query('[data-composer-input][contenteditable="true"]') && query('[data-composer-chip="vscode-editor"]') && !query('#dsh-companion-toolbar button[aria-label="新建会话"]').disabled);
    await settle();
    const toolbar = query('#dsh-companion-toolbar'), buttons = [...toolbar.querySelectorAll('button')];
    const labels = ['历史会话', '新建会话', '插件', '自动化任务', '设置'];
    check(JSON.stringify(buttons.map(button => button.getAttribute('aria-label'))) === JSON.stringify(labels), 'exactly five ordered entrances');
    const center = query('[data-dsh-companion-center]'), input = query('[data-composer-input]');
    check(toolbar.dataset.expanded === 'false', 'initially collapsed');
    check(buttons.every(button => getComputedStyle(button.querySelector('span')).display === 'none'), 'collapsed icons only');
    check(buttons.every(button => button.getBoundingClientRect().top === buttons[0].getBoundingClientRect().top), 'horizontal entrances');
    check(Math.abs(buttons[4].getBoundingClientRect().right - innerWidth) < 16, 'aligned top right');
    input.focus(); const range = document.createRange(); range.selectNodeContents(input); range.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.execCommand('insertText', false, 'NAVIGATION_DRAFT'); await settle();
    const reference = query('[data-composer-chip="vscode-editor"]').textContent;
    const motion = async action => {
      const samples = [], start = performance.now(); action();
      await new Promise(resolve => {
        const sample = () => {
          const sidebar = query('[data-dsh-companion-navigation]');
          samples.push({ x: sidebar.getBoundingClientRect().left, buttonY: buttons[4].getBoundingClientRect().top });
          if(performance.now() - start < 500) requestAnimationFrame(sample); else resolve();
        }; requestAnimationFrame(sample);
      });
      return samples;
    };
    const opening = await motion(() => buttons[0].click()); await settle();
    check(toolbar.dataset.expanded === 'true', 'history opens sidebar');
    check(buttons.every((button, i) => button === toolbar.children[i]), 'same five DOM entrances');
    check(buttons.every(button => getComputedStyle(button.querySelector('span')).display !== 'none'), 'all five labels visible');
    check(buttons.every((button, i) => i === 0 || button.getBoundingClientRect().top > buttons[i - 1].getBoundingClientRect().top), 'vertical entrances');
    const nav = query('[data-dsh-companion-navigation]'), rect = nav.getBoundingClientRect();
    check(Math.abs(rect.right - innerWidth) < 1 && rect.width === Math.min(280, innerWidth), 'sidebar on right');
    check(!!query('[data-slot="sidebar.workspaces"]')?.firstElementChild.getBoundingClientRect().height, 'session list visible below entrances');
    check([...query('[data-slot="sidebar"]').firstElementChild.children].filter(child => getComputedStyle(child).display !== 'none').length === 1, 'native duplicate entrances hidden');
    check(center.inert === (innerWidth < 760), 'drawer blocks narrow chat only');
    check(innerWidth < 760 || center.getBoundingClientRect().right <= rect.left + 1, 'wide chat beside sidebar');
    const leave = (target, relatedTarget) => target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget }));
    const enter = target => target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    leave(toolbar, nav); await settle();
    check(toolbar.dataset.expanded === 'true', 'moving from toolbar into sessions stays open');
    leave(nav, center); await new Promise(resolve => setTimeout(resolve, 60)); enter(nav); await settle();
    check(toolbar.dataset.expanded === 'true', 'brief leave and reentry cancels auto close');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reducedMotion) {
      leave(nav, center); await wait(() => toolbar.dataset.expanded === 'false');
      const exiting = nav.getBoundingClientRect();
      const hit = document.elementFromPoint((exiting.left + innerWidth) / 2, Math.min(innerHeight - 20, 240));
      check(!!hit?.closest('[data-dsh-companion-navigation]'), 'exiting sidebar remains a pointer target');
      enter(hit); await settle();
      check(toolbar.dataset.expanded === 'true', 'reentry during exit animation restores sidebar');
    }
    const closing = await motion(() => leave(nav, center)); await settle();
    check(toolbar.dataset.expanded === 'false', 'mouse leaving sidebar automatically closes it');
    if(!reducedMotion) {
      for(const [name, samples] of [['opening', opening], ['closing', closing]]) {
        check(new Set(samples.map(sample => Math.round(sample.x))).size > 2, name + ' sidebar slides through intermediate positions');
        check(new Set(samples.map(sample => Math.round(sample.buttonY))).size > 2, name + ' entrances animate together');
      }
    }
    buttons[0].click(); await settle(); buttons[0].click(); await settle();
    check(toolbar.dataset.expanded === 'false' && !center.inert, 'history closes sidebar');
    check(query('[data-composer-input]').innerText.includes('NAVIGATION_DRAFT') && query('[data-composer-chip="vscode-editor"]').textContent === reference, 'draft and reference preserved');
    for(const index of [2, 3, 4]) {
      buttons[0].click(); await settle(); buttons[index].click(); await settle();
      check(index === 4 ? !!query('[data-dsh-companion-settings]') : !center.querySelector('[data-composer-input]'), labels[index] + ' opens');
      check(toolbar.dataset.expanded === String(innerWidth >= 760), labels[index] + ' respects drawer mode');
      buttons[index].click(); await settle();
      check(!query('[data-dsh-companion-settings]') && !!center.querySelector('[data-composer-input]'), labels[index] + ' second click returns to chat');
      check(query('[data-composer-input]').innerText.includes('NAVIGATION_DRAFT'), labels[index] + ' preserves the current draft');
      buttons[index].click(); await settle();
      // The history entrance returns to chat and closes settings before toggling.
      buttons[0].click(); await settle();
      check(!query('[data-dsh-companion-settings]') && !!center.querySelector('[data-composer-input]'), labels[index] + ' returns to chat');
      if(toolbar.dataset.expanded === 'true') { buttons[0].click(); await settle(); }
    }
    buttons[2].click(); await settle(); buttons[3].click(); await settle(); buttons[4].click(); await settle(); buttons[4].click(); await settle();
    check(!query('[data-dsh-companion-settings]') && !!center.querySelector('[data-composer-input]'), 'switching panels then toggling settings returns to chat');
    buttons[0].click(); await settle(); buttons[1].click(); await settle();
    check(!!center.querySelector('[data-composer-input]') && !center.querySelector('[data-composer-input]').innerText.includes('NAVIGATION_DRAFT'), 'new session opens blank composer');
    check(toolbar.dataset.expanded === String(innerWidth >= 760), 'new session respects drawer mode');
    parent.postMessage({ type: 'navigation-result', width: innerWidth, checks }, '*');
  } catch(error) { parent.postMessage({ type: 'navigation-result', width: innerWidth, checks, error: error.message,
    markup: query('[data-slot="sidebar"]')?.outerHTML.slice(0, 2500) }, '*'); }
}

exports.run = async () => {
  const root = path.resolve(__dirname, '..'), directory = await fs.mkdtemp(path.join(root, '.test-work/navigation-'));
  const { RuntimeClient } = require('../dist/test/runtime/client'), { RuntimeConnection } = require('../dist/test/runtime/connection');
  const { frameHtml } = require('../dist/test/sidebar/view'), { EditorContext } = require('../dist/test/context/editor-context');
  const source = path.join(directory, 'desktop'); await fs.mkdir(path.join(source, 'profiles/desktop'), { recursive: true });
  await fs.writeFile(path.join(source, 'profiles/desktop/cordis.patch.yml'), '[]\n');
  const runtime = path.join(root, 'runtime'), home = path.join(directory, 'home'), client = new RuntimeClient(runtime, home, source);
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source, assetsDirectory: directory, acquire: () => client.acquire() });
  const editor = new EditorContext(), cases = [];
  let panel;
  try {
    const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'main.py');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    const base = await connection.start();
    for(const name of ['sidebar.js', 'sidebar.css']) await fs.copyFile(path.join(root, 'dist', name), path.join(directory, name));
    await fs.writeFile(path.join(directory, 'bootstrap.js'), await fs.readFile(path.join(root, 'dist/bootstrap.js'), 'utf8') + '\n(' + probe.toString() + ')();');
    const welcome = await fetch(base + '/api/settings/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-welcome', method: 'settings/mutate', payload: { args: { ns: 'ui-settings-general',
        ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-09-28.1' }], expectedRevision: 0 } } }) });
    assert.equal((await welcome.json()).result.ok, true);
    for(const width of [960, 420]) {
      panel = vscode.window.createWebviewPanel('dshNavigationTest', 'DSH navigation acceptance', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Native navigation timed out')), 45000);
        panel.webview.onDidReceiveMessage(async message => {
          if(message.type === 'ready') await panel.webview.postMessage({ type: 'context', context: editor.snapshot() });
          if(message.type === 'navigation-result') { clearTimeout(timeout); resolve(message); }
        });
        let html = frameHtml(base, path.join(root, 'media/whale.svg')).replace('width:100%;height:100%;border:0', 'width:' + width + 'px;height:100%;border:0');
        html = html.replace('acquireVsCodeApi()', '(window.__navigationApi=acquireVsCodeApi())');
        panel.webview.html = html.replace('</script>', `window.addEventListener('message',event=>{
          if(event.source===document.querySelector('iframe').contentWindow && event.data?.type==='navigation-result')window.__navigationApi.postMessage(event.data);
        });</script>`);
      });
      cases.push(result); assert.equal(result.error, undefined, JSON.stringify(result)); assert.equal(result.width, width);
      panel.dispose(); panel = undefined;
    }
  } finally {
    panel?.dispose(); editor.dispose(); await connection.dispose(); client.dispose();
    await fs.writeFile(path.join(root, '.test-work/native-navigation-result.json'), JSON.stringify({ vscodeVersion: vscode.version, cases }, null, 2));
  }
};
