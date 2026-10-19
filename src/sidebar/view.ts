import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RuntimeConnection } from '../runtime/connection';
import { EditorContext } from '../context/editor-context';
import { EditorReference, HostMessage, isClientMessage } from '../protocol';
import { loadingHtml } from './loading';

export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private generation = 0;
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
      if (value.type === 'ready') {
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

  private async load(reconnect: boolean): Promise<void> {
    const view = this.view;
    if (!view) return;
    const generation = ++this.generation;
    this.ready = false;
    view.webview.html = loadingHtml(path.join(this.extensionPath, 'media', 'whale.svg'));
    try {
      if (vscode.env.remoteName) throw new Error('首版需要本机 VS Code 窗口，请从 Windows 本地工作区使用 DSH Companion');
      const base = reconnect ? await this.connection.reconnect() : await this.connection.start();
      if (generation !== this.generation) return;
      view.webview.html = frameHtml(base);
    } catch (error) {
      if (generation !== this.generation) return;
      this.log.appendLine((error as Error).stack || (error as Error).message);
      const message = (error as Error).message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      view.webview.html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><style>body{padding:24px;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font:var(--vscode-font-size) var(--vscode-font-family);line-height:1.8}</style><p>${message}</p><p>点击侧栏标题的重新连接按钮重试。插件使用自带的独立后台，不依赖桌面 DSH。</p></html>`;
    }
  }

  dispose(): void { this.generation++; this.subscription.dispose(); this.view = undefined; }
}

export function frameHtml(base: string): string {
  const nonce = randomBytes(18).toString('base64');
  // VS Code replaces window.parent; host messages are authenticated by the webview's origin.
  return `<!doctype html><html><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';frame-src ${base};script-src 'nonce-${nonce}';style-src 'unsafe-inline'"><style>html,body{padding:0;margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><body><iframe name="dsh-companion-host" title="DSH Companion" src="${base}/?dsh-companion=1"></iframe><script nonce="${nonce}">
const vscode=acquireVsCodeApi(),frame=document.querySelector('iframe'),HOST='dsh-companion-host';
function post(message){frame.contentWindow.postMessage({source:HOST,...message},${JSON.stringify(base)});}
function theme(){const style=getComputedStyle(document.body),read=(name,fallback)=>style.getPropertyValue('--vscode-'+name).trim()||style.getPropertyValue('--vscode-'+fallback).trim();const tokens={
background:read('sideBar-background','editor-background'),foreground:read('sideBar-foreground','foreground'),muted:read('descriptionForeground','foreground'),widgetBackground:read('menu-background','editorWidget-background'),bubbleBackground:read('input-background','editor-background'),inputBackground:read('input-background','editor-background'),inputForeground:read('input-foreground','foreground'),border:read('panel-border','contrastBorder'),focus:read('focusBorder','textLink-foreground'),buttonBackground:read('button-background','textLink-foreground'),buttonForeground:read('button-foreground','foreground'),buttonHover:read('button-hoverBackground','button-background'),hover:read('toolbar-hoverBackground','list-hoverBackground'),link:read('textLink-foreground','foreground'),error:read('errorForeground','foreground'),warning:read('editorWarning-foreground','foreground'),scrollbar:read('scrollbarSlider-background','scrollbarSlider-background'),scrollbarHover:read('scrollbarSlider-hoverBackground','scrollbarSlider-background'),codeBackground:read('textCodeBlock-background','editor-background'),fontFamily:read('font-family','font-family'),fontSize:read('font-size','font-size'),codeFontFamily:read('editor-font-family','font-family'),codeFontSize:read('editor-font-size','font-size')};post({type:'sidebar-theme',tokens,dark:!document.body.classList.contains('vscode-light')&&!document.body.classList.contains('vscode-high-contrast-light'),contrast:document.body.classList.contains('vscode-high-contrast')||document.body.classList.contains('vscode-high-contrast-light')});}
window.addEventListener('message',event=>{const data=event.data;if(!data)return;if(event.source===frame.contentWindow&&event.origin===${JSON.stringify(base)}&&data.source==='dsh-companion-sidebar'){if(data.type==='hello'){theme();vscode.postMessage({type:'ready'});}else if(data.type==='read-reference')vscode.postMessage({type:'read-reference',requestId:data.requestId,uri:data.uri});else if(data.type==='trace')vscode.postMessage({type:'trace',stage:data.stage,durationMs:data.durationMs,bytes:data.bytes});return;}if(event.origin!==window.origin)return;if(data.type==='context')post({type:'editor-context',context:data.context});if(data.type==='manual-reference')post({type:'editor-reference',reference:data.reference});if(data.type==='reference-result')post(data);});
const observer=new MutationObserver(theme);observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','style']});frame.addEventListener('load',()=>{theme();vscode.postMessage({type:'ready'});});
</script></body></html>`;
}
