import type { EditorReference, EditorSnapshot, ResolvedFile, UiErrorCode } from '../../protocol';
export type { UiErrorCode } from '../../protocol';
export interface SidebarTheme { tokens: Record<string, string>; dark: boolean; contrast: boolean }
type Incoming = { source: 'dsh-companion-host' } & (
  { type: 'editor-context'; context: EditorSnapshot } | { type: 'editor-reference'; reference: EditorReference } |
  { type: 'reference-result'; requestId: string; value?: ResolvedFile; error?: string } |
  { type: 'sidebar-theme' } & SidebarTheme);
interface Listeners { context(value: EditorSnapshot): void; reference(value: EditorReference): void; theme(value: SidebarTheme): void }

/** Owns the authenticated parent transport and outstanding editor reads. */
export function createEditorBridge(listeners: Listeners) {
  const pending = new Map<string, (value?: ResolvedFile, error?: Error) => void>();
  let sequence = 0;
  function post(type: string, detail: object = {}) { parent.postMessage({ source: 'dsh-companion-sidebar', type, ...detail }, '*'); }
  function trace(stage: string, durationMs: number) { post('trace', { stage, durationMs }); }
  function readReference(uri: string, signal: AbortSignal): Promise<ResolvedFile> {
    return new Promise((resolve, reject) => {
      const requestId = String(++sequence), started = performance.now();
      const finish = (value?: ResolvedFile, error?: Error) => {
        trace('reference-roundtrip', performance.now() - started);
        clearTimeout(timeout); signal.removeEventListener('abort', aborted); pending.delete(requestId);
        if(error) reject(error); else resolve(value!);
      };
      const aborted = () => finish(undefined, new Error('文件引用已取消'));
      const timeout = setTimeout(() => finish(undefined, new Error('读取 VS Code 文件超时，请重试')), 10000);
      pending.set(requestId, finish); signal.addEventListener('abort', aborted, { once: true });
      if(signal.aborted) aborted(); else post('read-reference', { requestId, uri });
    });
  }
  function onMessage(event: MessageEvent) {
    if(event.source !== parent || event.data?.source !== 'dsh-companion-host') return;
    const data = event.data as Incoming;
    if(data.type === 'editor-context') listeners.context(data.context);
    else if(data.type === 'editor-reference') listeners.reference(data.reference);
    else if(data.type === 'reference-result') pending.get(data.requestId)?.(data.value, data.error ? new Error(data.error) : undefined);
    else if(data.type === 'sidebar-theme') listeners.theme(data);
  }
  window.addEventListener('message', onMessage);
  return {
    readReference, trace, ready: () => post('hello'), rendered: () => post('ui-ready'),
    failed: (code: UiErrorCode) => post('ui-error', { code }),
    dispose() {
      window.removeEventListener('message', onMessage);
      for(const finish of pending.values()) finish(undefined, new Error('DSH 页面已关闭'));
    },
  };
}
export type EditorBridge = ReturnType<typeof createEditorBridge>;
