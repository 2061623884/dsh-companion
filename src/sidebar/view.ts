import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RuntimeConnection } from '../runtime/connection';
import { EditorContext } from '../context/editor-context';
import { EditorReference, HostMessage, isClientMessage } from '../protocol';
import { loadingHtml, loadingMarkup } from './loading';
import { DesktopError, desktopDownloadUrl } from '../desktop/client';

declare const __DSH_CONNECTION_ACTIONS__: string;

export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private generation = 0;
  private loadStarted = 0;
  private readonly pendingReferences: EditorReference[] = [];
  private readonly subscription: vscode.Disposable;
  constructor(private readonly extensionPath: string, private readonly connection: RuntimeConnection,
    private readonly editor: EditorContext, private readonly log: vscode.OutputChannel) {
    this.subscription = editor.onChange(context => { if (this.ready) this.post({ type: 'context', context }); });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = view.webview.onDidReceiveMessage((value: unknown) => {
      if (!isClientMessage(value)) return;
      if (value.type === 'retry') { void this.load(true); return; }
      if (value.type === 'install-desktop') { void vscode.env.openExternal(vscode.Uri.parse(desktopDownloadUrl)); return; }
      if (value.type === 'open-desktop') {
        void this.connection.openDesktop().then(() => this.load(true, true), error => this.showConnectionError(error));
        return;
      }
      if (value.type === 'ui-error') { this.ready = false; this.log.appendLine(value.code); return; }
      if (value.type === 'ready') {
        if (!this.ready) this.trace('sidebar-ready', performance.now() - this.loadStarted);
        this.ready = true; this.post({ type: 'context', context: this.editor.snapshot() });
        for (const reference of this.pendingReferences.splice(0)) this.post({ type: 'manual-reference', reference });
        return;
      }
      if (value.type === 'trace') { this.trace(value.stage, value.durationMs, value.bytes); return; }
      const start = performance.now();
      const generation = this.generation;
      this.editor.read(value.uri).then(result => {
        if (this.view !== view || generation !== this.generation) return;
        this.trace('reference-read', performance.now() - start, Buffer.byteLength(result.content));
        this.post({ type: 'reference-result', requestId: value.requestId, value: result });
      }, error => { if (this.view === view && generation === this.generation) this.post({ type: 'reference-result', requestId: value.requestId, error: error.message }); });
    });
    view.onDidDispose(() => { messages.dispose(); if (this.view === view) { this.view = undefined; this.ready = false; this.generation++; } });
    void this.load(false);
  }

  private post(message: HostMessage): void { void this.view?.webview.postMessage(message); }
  private trace(stage: string, duration: number, bytes?: number): void {
    if (vscode.workspace.getConfiguration('dshCompanion').get('diagnostics', false)) {
      this.log.appendLine(JSON.stringify({ stage, durationMs: Math.round(duration), ...(bytes === undefined ? {} : { bytes }) }));
    }
  }

  async show(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.dshCompanion');
    await vscode.commands.executeCommand('dshCompanion.chat.focus');
  }
  async referenceCurrent(): Promise<void> {
    const reference = this.editor.snapshot().reference;
    if (!reference) return;
    this.pendingReferences.push(reference);
    await this.show();
    if (this.ready) for (const pending of this.pendingReferences.splice(0)) this.post({ type: 'manual-reference', reference: pending });
  }
  refresh(): Promise<void> { return this.load(true); }

  async desktopUnavailable(error: DesktopError): Promise<void> {
    if (!this.ready || !this.view) return;
    this.ready = false;
    const generation = ++this.generation;
    this.showConnectionError(error);
    const deadline = Date.now() + 45000;
    while (generation === this.generation && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (generation !== this.generation) return;
      try {
        await this.connection.reconnect();
        if (generation === this.generation) await this.load(false);
        return;
      } catch (next) {
        if (!['DSH_DESKTOP_NOT_RUNNING', 'DSH_DESKTOP_NOT_READY'].includes((next as DesktopError).code)) {
          this.showConnectionError(next as Error); return;
        }
      }
    }
  }

  private async load(reconnect: boolean, waitForDesktop = false): Promise<void> {
    const view = this.view;
    if (!view) return;
    const generation = ++this.generation;
    this.loadStarted = performance.now();
    this.ready = false;
    view.webview.html = loadingHtml(path.join(this.extensionPath, 'media', 'whale.svg'));
    try {
      if (vscode.env.remoteName) throw new Error('首版需要本机 VS Code 窗口，请从 Windows 本地工作区使用 DSH Companion');
      let base: string;
      const deadline = Date.now() + 45000;
      while (true) {
        try { base = reconnect ? await this.connection.reconnect() : await this.connection.start(); break; }
        catch (error) {
          if (!waitForDesktop || !['DSH_DESKTOP_NOT_RUNNING', 'DSH_DESKTOP_NOT_READY'].includes((error as DesktopError).code) || Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (generation !== this.generation) return;
        }
      }
      if (generation !== this.generation) return;
      this.trace('backend-ready', performance.now() - this.loadStarted);
      view.webview.html = frameHtml(base, path.join(this.extensionPath, 'media', 'whale.svg'));
    } catch (error) {
      if (generation !== this.generation) return;
      this.showConnectionError(error as Error);
    }
  }

  private showConnectionError(error: Error): void {
    if (!this.view) return;
    this.log.appendLine(error.message);
    const message = error.message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const action = (error as DesktopError).code === 'DSH_DESKTOP_NOT_INSTALLED' ? 'install-desktop' :
      (error as DesktopError).code === 'DSH_DESKTOP_NOT_RUNNING' ? 'open-desktop' : 'retry';
    const label = action === 'install-desktop' ? '下载桌面端' : action === 'open-desktop' ? '打开桌面端' : '重新连接';
    const nonce = randomBytes(18).toString('base64');
    this.view.webview.html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'nonce-${nonce}';style-src 'unsafe-inline'"><style>body{padding:24px;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font:var(--vscode-font-size) var(--vscode-font-family);line-height:1.8}button{padding:7px 12px;margin-right:8px;border:0;border-radius:3px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit}p{margin-bottom:18px}</style><h3>连接 DeepSeek Harness 桌面端</h3><p>${message}</p><button data-action="${action}">${label}</button>${action === 'retry' ? '' : '<button data-action="retry">重新连接</button>'}<p>登录、配置和会话由桌面端统一管理。</p><script nonce="${nonce}">${__DSH_CONNECTION_ACTIONS__}</script></html>`;
  }

  dispose(): void { this.generation++; this.subscription.dispose(); this.view = undefined; }
}

declare const __DSH_FRAME_BRIDGE__: string;

export function frameHtml(base: string, whalePath: string): string {
  const nonce = randomBytes(18).toString('base64');
  // VS Code replaces window.parent; host messages are authenticated by the webview's origin.
  return `<!doctype html><html><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';frame-src ${base};script-src 'nonce-${nonce}';style-src 'unsafe-inline'"><style>html,body{padding:0;margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><body>${loadingMarkup(whalePath)}<iframe inert aria-busy="true" name="dsh-companion-host" title="DSH Companion" src="${base}/?dsh-companion=1"></iframe><script nonce="${nonce}">
${__DSH_FRAME_BRIDGE__}
</script></body></html>`;
}
