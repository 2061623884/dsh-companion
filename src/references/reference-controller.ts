import { EditorReference, ReferenceValue, ResolvedFile, referenceKey } from '../protocol';

export interface DraftReference { id: string; value: ReferenceValue }
export interface DraftPort {
  id: string;
  snapshot(): { editable: boolean; pending: boolean; references: DraftReference[] };
  replaceAutomatic(reference: ReferenceValue | null): boolean;
  remove(id: string): boolean;
}
interface ContextState {
  key: string | null;
  dismissed: boolean;
  present: boolean;
  submitted: boolean;
  serializing: number;
}
export const REFERENCE_START = '[VS Code 文件引用]';
export const REFERENCE_END = '[/VS Code 文件引用]';

/** Owns automatic-context identity and send lifecycle, without knowing DSH or DOM. */
export class ReferenceController {
  private readonly states = new Map<string, ContextState>();
  constructor(private readonly readFile: (uri: string, signal: AbortSignal) => Promise<ResolvedFile>,
    private readonly invalidate: () => void) {}

  sync(reference: EditorReference | null, draft: DraftPort): void {
    const snapshot = draft.snapshot();
    if (!snapshot.editable) return;
    let state = this.states.get(draft.id);
    if (state?.submitted && (state.serializing > 0 || snapshot.pending)) return;
    const current = snapshot.references.find(item => item.value.auto);
    const key = reference && referenceKey(reference);
    if (!state || state.key !== key) {
      state = { key, dismissed: false, present: false, submitted: false, serializing: 0 };
      this.states.set(draft.id, state);
    } else if (state.present && !current) {
      state.dismissed = !state.submitted;
      state.submitted = false;
      state.present = false;
    }
    if (!reference) {
      if (current) draft.replaceAutomatic(null);
      state.present = false;
      return;
    }
    if (state.dismissed) return;
    if (!current || current.value.contextKey !== key || current.value.version !== reference.version) {
      state.present = draft.replaceAutomatic({ ...reference, auto: true, ownerSessionId: draft.id, contextKey: key! });
    } else {
      state.present = true;
      state.submitted = false;
    }
  }

  remove(draft: DraftPort, id: string): boolean {
    const reference = draft.snapshot().references.find(item => item.id === id);
    if (!reference || !draft.remove(id)) return false;
    if (reference.value.auto) {
      this.states.set(draft.id, { key: reference.value.contextKey, dismissed: true, present: false, submitted: false, serializing: 0 });
    }
    return true;
  }

  async serialize(reference: ReferenceValue, signal: AbortSignal): Promise<string> {
    const state = reference.auto && this.states.get(reference.ownerSessionId);
    if (state) { state.submitted = true; state.serializing++; }
    try {
      signal.throwIfAborted();
      let value: ResolvedFile & { startLine?: number; endLine?: number };
      if (reference.kind === 'selection') {
        const { uri, filePath, language, unsaved, startLine, endLine, content } = reference;
        value = { uri, filePath, language, unsaved, startLine, endLine, content };
      } else value = await this.readFile(reference.uri, signal);
      signal.throwIfAborted();
      return `\n${REFERENCE_START}\n${JSON.stringify(value)}\n${REFERENCE_END}\n`;
    } finally {
      if (state) state.serializing--;
      this.invalidate();
    }
  }

  dispose(): void { this.states.clear(); }
}
