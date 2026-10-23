export interface FileReference {
  kind: 'file'; uri: string; name: string; version: number;
}
export interface SelectionReference {
  kind: 'selection'; uri: string; name: string; version: number;
  filePath: string; language: string; unsaved: boolean;
  startLine: number; endLine: number; range: string; content: string;
}
export type EditorReference = FileReference | SelectionReference;
export interface EditorSnapshot {
  workspacePath: string | null;
  workspaceName: string;
  reference: EditorReference | null;
}
export interface ResolvedFile {
  uri: string; filePath: string; language: string; unsaved: boolean; content: string;
}
export type ReferenceValue = EditorReference & { auto: boolean; ownerSessionId: string; contextKey: string };
export type UiErrorCode = 'DSH_UI_STYLE_FAILED' | 'DSH_UI_ADAPTER_FAILED' | 'DSH_UI_READY_TIMEOUT';
export type ClientMessage =
  | { type: 'ready' }
  | { type: 'retry' }
  | { type: 'ui-error'; code: UiErrorCode }
  | { type: 'read-reference'; requestId: string; uri: string }
  | { type: 'trace'; stage: string; durationMs: number; bytes?: number };
export type HostMessage =
  | { type: 'context'; context: EditorSnapshot }
  | { type: 'manual-reference'; reference: EditorReference }
  | { type: 'reference-result'; requestId: string; value?: ResolvedFile; error?: string };

export function referenceKey(reference: EditorReference): string {
  return reference.kind === 'selection'
    ? `${reference.uri}#${reference.range}`
    : reference.uri;
}

/** Validate the external webview seam; internal modules use the discriminated union. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready' || message.type === 'retry') return true;
  if (message.type === 'ui-error') return ['DSH_UI_STYLE_FAILED', 'DSH_UI_ADAPTER_FAILED', 'DSH_UI_READY_TIMEOUT'].includes(message.code as string);
  if (message.type === 'read-reference') return typeof message.requestId === 'string' && typeof message.uri === 'string';
  return message.type === 'trace' && ['reference-read', 'reference-roundtrip', 'reference-serialize', 'send-feedback', 'send-feedback-timeout', 'workspace-bind'].includes(message.stage as string) &&
    typeof message.durationMs === 'number' && Number.isFinite(message.durationMs) && message.durationMs >= 0 &&
    (message.bytes === undefined || (typeof message.bytes === 'number' && Number.isFinite(message.bytes) && message.bytes >= 0));
}
