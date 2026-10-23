import type { ClientMessage, HostMessage, UiErrorCode } from '../../protocol';
declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void };

const vscode = acquireVsCodeApi();
const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
const base = new URL(frame.src).origin;
const loading = document.getElementById('dsh-companion-loading')!;
const retry = document.getElementById('dsh-companion-retry') as HTMLButtonElement;
const errors: Record<UiErrorCode, string> = {
  DSH_UI_STYLE_FAILED: '界面样式加载失败，请重试。',
  DSH_UI_ADAPTER_FAILED: '聊天界面初始化失败，请重试；若持续失败，请检查插件与 DSH 的兼容性。',
  DSH_UI_READY_TIMEOUT: '聊天界面加载超时，请重试。',
};
let state: 'loading' | 'ready' | 'error' = 'loading';
function fail(code: UiErrorCode) {
  if (state !== 'loading') return;
  state = 'error'; clearTimeout(deadline);
  loading.setAttribute('data-error', '');
  loading.querySelector('.status')!.textContent = errors[code] + ' (' + code + ')';
  retry.hidden = false;
  frame.setAttribute('aria-busy', 'false');
  vscode.postMessage({ type: 'ui-error', code });
}
const deadline = setTimeout(() => fail('DSH_UI_READY_TIMEOUT'), 60000);
window.addEventListener('pagehide', () => clearTimeout(deadline));
retry.addEventListener('click', () => { retry.disabled = true; vscode.postMessage({ type: 'retry' }); });
function post(message: object) { frame.contentWindow!.postMessage({ source: 'dsh-companion-host', ...message }, base); }
function theme() {
  const style = getComputedStyle(document.body);
  const read = (name: string, fallback: string) => style.getPropertyValue('--vscode-' + name).trim() || style.getPropertyValue('--vscode-' + fallback).trim();
  const tokens = {
    background: read('sideBar-background', 'editor-background'), foreground: read('sideBar-foreground', 'foreground'),
    muted: read('descriptionForeground', 'foreground'), widgetBackground: read('menu-background', 'editorWidget-background'),
    bubbleBackground: read('input-background', 'editor-background'), inputBackground: read('input-background', 'editor-background'),
    inputForeground: read('input-foreground', 'foreground'), border: read('panel-border', 'contrastBorder'), focus: read('focusBorder', 'textLink-foreground'),
    buttonBackground: read('button-background', 'textLink-foreground'), buttonForeground: read('button-foreground', 'foreground'),
    buttonHover: read('button-hoverBackground', 'button-background'), hover: read('toolbar-hoverBackground', 'list-hoverBackground'),
    link: read('textLink-foreground', 'foreground'), error: read('errorForeground', 'foreground'), warning: read('editorWarning-foreground', 'foreground'),
    scrollbar: read('scrollbarSlider-background', 'scrollbarSlider-background'), scrollbarHover: read('scrollbarSlider-hoverBackground', 'scrollbarSlider-background'),
    codeBackground: read('textCodeBlock-background', 'editor-background'), fontFamily: read('font-family', 'font-family'), fontSize: read('font-size', 'font-size'),
    codeFontFamily: read('editor-font-family', 'font-family'), codeFontSize: read('editor-font-size', 'font-size'),
  };
  const classes = document.body.classList;
  post({
    type: 'sidebar-theme', tokens, dark: !classes.contains('vscode-light') && !classes.contains('vscode-high-contrast-light'),
    contrast: classes.contains('vscode-high-contrast') || classes.contains('vscode-high-contrast-light')
  });
}
window.addEventListener('message', event => {
  const data = event.data;
  if(!data) return;
  if(event.source === frame.contentWindow && event.origin === base && data.source === 'dsh-companion-sidebar') {
    if(data.type === 'hello') { theme(); vscode.postMessage({ type: 'ready' }); }
    else if(data.type === 'ui-ready' && state === 'loading') {
      state = 'ready'; clearTimeout(deadline);
      loading.setAttribute('data-ready', ''); loading.setAttribute('aria-hidden', 'true');
      frame.inert = false; frame.setAttribute('aria-busy', 'false');
    }
    else if(data.type === 'ui-error' && Object.hasOwn(errors, data.code)) fail(data.code);
    else if(data.type === 'read-reference') vscode.postMessage({ type: 'read-reference', requestId: data.requestId, uri: data.uri });
    else if(data.type === 'trace') vscode.postMessage({ type: 'trace', stage: data.stage, durationMs: data.durationMs, bytes: data.bytes });
    return;
  }
  // VS Code replaces window.parent; its messages carry the webview's origin.
  if(event.origin !== window.origin) return;
  const message = data as HostMessage;
  if(message.type === 'context') post({ type: 'editor-context', context: message.context });
  if(message.type === 'manual-reference') post({ type: 'editor-reference', reference: message.reference });
  if(message.type === 'reference-result') post(message);
});
const observer = new MutationObserver(theme);
observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
frame.addEventListener('load', theme);
