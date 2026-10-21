import { ReferenceController, DraftPort } from '../../references/reference-controller';
import { referenceKey, EditorReference } from '../../protocol';
import type { DshContext, SessionBinding, InputState, Occurrence } from './dsh-contract';
import type { EditorBridge } from './bridge';
import { matchEditorReference } from './reference-display';

export function createInputAdapter(ctx: DshContext, bridge: Pick<EditorBridge, 'readReference' | 'trace'>, scheduleSync: () => void) {
  const body = document.body;
  const references = new ReferenceController(bridge.readReference, scheduleSync);
  let inputBinding: SessionBinding | null = null, offInput = () => { };
  const pendingManualReferences: EditorReference[] = [];
  function mainBinding() {
    const row = Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView || 0) > 0);
    return row ? ctx.sessions.binding(row.id) : null;
  }
  const offReferenceSource = ctx.inputTriggers.registerSource({
    trigger: '@', name: 'vscode-editor',
    candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: ref => '@' + (JSON.parse(ref).name || '当前文件'),
      serialize: async (ref, signal) => {
        const started = performance.now();
        try { return await references.serialize(JSON.parse(ref), signal); }
        finally { bridge.trace('reference-serialize', performance.now() - started); }
      },
    },
  });
  const offReferenceDisplay = ctx.uiConversation.userText.register({ id: 'vscode-editor-display', order: 10, match: matchEditorReference });
  function referenceSpan(state: InputState, occurrence: Occurrence) {
    const preceding = state.occurrences.filter(item => item.offset < occurrence.offset);
    const start = occurrence.offset - preceding.reduce((sum, item) => sum + item.length - 1, 0);
    return { start, end: start + 1, draftRev: state.draftRev };
  }
  // Private adapter: all native DSH draft coordinates stay here.
  function draftFor(binding: SessionBinding): DraftPort {
    const input = ctx.conversation.input.for(binding.ctx);
    function occurrences(state: InputState) { return state.occurrences.filter(item => item.source === 'vscode-editor'); }
    function remove(occurrence: Occurrence, state: InputState) {
      return binding.ctx.bail('slash/input-consume-token', { guard: { kind: 'span', span: referenceSpan(state, occurrence) } });
    }
    return {
      id: binding.sessionId,
      snapshot() {
        const state = input.state.getSnapshot();
        return {
          editable: state.phase === 'plain' || state.phase === 'claimed',
          pending: binding.session.getSnapshot().pendingSubmissions.length > 0,
          references: occurrences(state).map(item => {
            const value = JSON.parse(item.ref);
            return { id: String(item.occurrenceId), value: { ...value, contextKey: value.contextKey ?? referenceKey(value) } };
          })
        };
      },
      replaceAutomatic(reference) {
        const state = input.state.getSnapshot();
        const existing = occurrences(state).find(item => JSON.parse(item.ref).auto);
        if(!reference) return existing ? remove(existing, state) : true;
        const end = state.draft.length - state.occurrences.reduce((sum, item) => sum + item.length - 1, 0);
        const span = existing ? referenceSpan(state, existing) : { start: end, end, draftRev: state.draftRev };
        const label = reference.kind === 'selection' ? reference.name + ':' + reference.startLine + '–' + reference.endLine : reference.name;
        return input.insertReference({
          source: 'vscode-editor', ref: JSON.stringify(reference), label,
          appearance: 'file', clipboardText: '@' + label
        }, span);
      },
      remove(id) {
        const state = input.state.getSnapshot(), occurrence = occurrences(state).find(item => String(item.occurrenceId) === id);
        return occurrence ? remove(occurrence, state) : false;
      },
    };
  }
  function insertReference(binding: SessionBinding, reference: EditorReference) {
    const input = ctx.conversation.input.for(binding.ctx);
    const applied = draftFor(binding).replaceAutomatic({
      ...reference, auto: false,
      ownerSessionId: binding.sessionId, contextKey: referenceKey(reference)
    });
    if(!applied) input.notify('error', '当前输入框正在发送，文件引用未添加，请稍后重试');
    else input.focus();
  }
  function sync(reference: EditorReference | null, bindingPending: boolean) {
    const binding = mainBinding();
    if(binding !== inputBinding) {
      offInput(); inputBinding = binding;
      if(binding) {
        const offState = ctx.conversation.input.for(binding.ctx).state.subscribe(scheduleSync);
        const offSession = binding.session.subscribe(scheduleSync);
        offInput = () => { offState(); offSession(); };
      } else offInput = () => { };
    }
    if(!binding || bindingPending) return;
    references.sync(reference, draftFor(binding));
    if(draftFor(binding).snapshot().editable) {
      for(const reference of pendingManualReferences.splice(0)) insertReference(binding, reference);
    }

  }
  function syncReferenceControls() {
    const binding = mainBinding();
    if(!binding) return;
    const input = ctx.conversation.input.for(binding.ctx), state = input.state.getSnapshot();
    const visibleReferences = state.occurrences.filter(item => item.source === 'vscode-editor');
    document.querySelectorAll('[data-composer-input] [data-composer-chip="vscode-editor"]').forEach((chip, index) => {
      const reference = visibleReferences[index];
      if(!reference) return;
      let close = chip.querySelector<HTMLButtonElement>('.dsh-companion-reference-close');
      if(!close) {
        close = document.createElement('button'); close.type = 'button';
        close.className = 'dsh-companion-reference-close';
        close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
        close.addEventListener('pointerdown', event => event.preventDefault());
        close.addEventListener('keydown', event => {
          if(event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
        close.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          const current = mainBinding(), currentInput = ctx.conversation.input.for(current!.ctx);
          const removed = references.remove(draftFor(current!), close!.dataset.occurrenceId!);
          if(!removed) currentInput.notify('error', '当前输入框正在变化，文件引用未移除，请重试');
          else currentInput.focus();
        });
        chip.append(close);
      }
      close.dataset.occurrenceId = String(reference.occurrenceId);
      close.title = '移除引用';
      close.setAttribute('aria-label', '移除引用 ' + reference.label);
      close.disabled = state.phase !== 'plain' && state.phase !== 'claimed';
    });
  }
  let disposed = false;
  let feedbackAnimation = 0;
  const measureSend = (event: MouseEvent) => {
    if(!(event.target as Element).closest('button[aria-label="发送消息"]:not(:disabled)')) return;
    const binding = mainBinding();
    if(!binding) return;
    const input = ctx.conversation.input.for(binding.ctx), before = input.state.getSnapshot(), started = performance.now();
    cancelAnimationFrame(feedbackAnimation);
    const sample = () => {
      if(disposed) return;
      const current = input.state.getSnapshot();
      if(current.phase !== before.phase || current.draft !== before.draft) {
        bridge.trace('send-feedback', performance.now() - started);
      } else if(performance.now() - started < 2000) feedbackAnimation = requestAnimationFrame(sample);
      else bridge.trace('send-feedback-timeout', performance.now() - started);
    };
    feedbackAnimation = requestAnimationFrame(sample);
  };
  body.addEventListener('click', measureSend, true);
  return {
    sync(reference: EditorReference | null, bindingPending: boolean) { sync(reference, bindingPending); syncReferenceControls(); },
    add(reference: EditorReference) { pendingManualReferences.push(reference); scheduleSync(); },
    dispose() {
      disposed = true; offInput(); offReferenceSource(); offReferenceDisplay(); references.dispose();
      for(const close of body.querySelectorAll('.dsh-companion-reference-close')) close.remove();
      body.removeEventListener('click', measureSend, true); cancelAnimationFrame(feedbackAnimation);
    }
  };
}
