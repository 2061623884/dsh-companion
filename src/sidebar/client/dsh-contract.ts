// Only the pinned DSH features used by this private adapter. These types are
// not exported to the editor, connection or reference controller.
export type Dispose = () => void;
export interface Store<T> { getSnapshot(): T; subscribe(listener: () => void): Dispose }
export interface Occurrence { source: string; ref: string; label: string; occurrenceId: number; offset: number; length: number }
export interface InputState { phase: string; draft: string; draftRev: number; occurrences: Occurrence[] }
interface Span { start: number; end: number; draftRev: number }
export interface SessionBinding {
  sessionId: string;
  ctx: { bail(event: 'slash/input-consume-token', value: { guard: { kind: 'span'; span: Span } }): boolean };
  session: Store<{ pendingSubmissions: unknown[] }>;
}
interface Input {
  state: Store<InputState>;
  insertReference(value: { source: string; ref: string; label: string; appearance: 'file'; clipboardText: string }, span: Span): boolean;
  notify(level: 'error', message: string): void;
  focus(): void;
}
export interface DshContext {
  effect(effect: () => Dispose, label: string): void;
  root: { plugin(plugin: { name: string; inject: string[]; apply(ctx: DshContext): void }): void };
  on(event: 'theme/change', listener: () => void): Dispose;
  layout: {
    closeRightbar(): void; toggleSidebar(): void; selectPanel(id: string | null): void;
    panelInfo: Store<{ activePanelId: string | null }>;
  };
  uiWorkspace: { startSession(id: string | null): void; openWorkspace(id: string): Promise<void> };
  workspaces: { create(options: { path: string }): Promise<{ workspaceId: string; path: string }> };
  slots: { entries(name: 'sidebar.settings'): { store: { create(): { getSnapshot(): { open: boolean }; actions: { open(): void; close(): void } } } }[] };
  sessions: {
    list: Store<{ byId: Record<string, { id: string; cwd: string; retainedBy: Record<string, number> }> }>;
    binding(id: string): SessionBinding;
  };
  conversation: { input: { for(context: SessionBinding['ctx']): Input } };
  inputTriggers: {
    registerSource(source: {
      trigger: string; name: string; candidates(): Promise<never[]>; onPick(): undefined;
      codec: { clipboardText(ref: string): string; serialize(ref: string, signal: AbortSignal): Promise<string> };
    }): Dispose
  };
  uiConversation: {
    userText: {
      register(renderer: {
        id: string; order: number;
        match(text: string, from: number): { id: string; start: number; end: number; data: { text: string; display: string } } | undefined;
      }): Dispose
    }
  };
}
declare global {
  interface Window {
    __ModuleLoader__: { load(module: { id: string; factory(): { inject: string[]; apply(ctx: DshContext): void } }): void };
  }
}
