import { ReferenceController } from '../../references/reference-controller';
import { referenceKey } from '../../protocol';

window.__ModuleLoader__.load({
  id: 'dsh-companion-sidebar',
  factory() {
    const HOST = 'dsh-companion-host';
    const SELF = 'dsh-companion-sidebar';
    const icons = {
      history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5V12l3.5 2"/>',
      new: '<path d="M20.5 11.7a8.2 8.2 0 0 1-8.3 8.1 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.4a8.2 8.2 0 1 1 15.6-3.9Z"/><path d="M12 8v7M8.5 11.5h7"/>',
      more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
      plugins: '<path d="M9 4H5a1 1 0 0 0-1 1v4h2a2 2 0 0 1 0 4H4v6a1 1 0 0 0 1 1h4v-2a2 2 0 0 1 4 0v2h6a1 1 0 0 0 1-1v-6h-2a2 2 0 0 1 0-4h2V5a1 1 0 0 0-1-1h-6V2a2 2 0 0 0-4 0Z"/>',
      schedules: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h3M8 17h6"/>',
      settings: '<path d="m9.5 3-.5 2a7 7 0 0 0-2 1.2L5 5.6 2.5 10l1.5 1.4a7 7 0 0 0 0 2.2L2.5 15 5 19.4l2-.6a7 7 0 0 0 2 1.2l.5 2h5l.5-2a7 7 0 0 0 2-1.2l2 .6 2.5-4.4-1.5-1.4a7 7 0 0 0 0-2.2l1.5-1.4L19 5.6l-2 .6A7 7 0 0 0 15 5l-.5-2Z"/><circle cx="12" cy="12.5" r="3"/>',
    };
    const tokenMap = {
      '--dsw-alias-bg-base': 'background', '--dsw-specific-sidebar-fill': 'background',
      '--dsw-alias-bg-layer-1': 'widgetBackground', '--dsw-alias-bg-module-platform': 'background',
      '--dsw-alias-bg-layer-2': 'widgetBackground', '--dsw-alias-bg-layer-3': 'widgetBackground',
      '--dsw-alias-label-primary': 'foreground', '--dsw-alias-label-secondary': 'muted',
      '--dsw-alias-label-tertiary': 'muted', '--dsw-alias-label-caption': 'muted',
      '--dsw-alias-label-primary-inverted': 'buttonForeground',
      '--dsw-alias-label-primary-foreground': 'buttonForeground',
      '--dsw-alias-button-primary-fill': 'buttonBackground', '--dsw-alias-button-primary-hover': 'buttonHover',
      '--dsw-alias-brand-primary': 'link',
      '--dsw-alias-border-l1': 'border', '--dsw-alias-border-l2': 'border',
      '--dsw-alias-border-l3': 'border', '--dsw-alias-border-l4': 'border',
      '--dsw-alias-separator-primary': 'border', '--dsw-specific-input-major': 'inputBackground',
      '--dsw-specific-menu': 'widgetBackground', '--dsw-specific-bubble': 'bubbleBackground',
      '--dsw-alias-interactive-bg-hover': 'hover', '--dsw-alias-interactive-bg-hover-solid': 'hover',
      '--dsw-alias-button-floating-fill': 'inputBackground', '--dsw-alias-button-floating-hover': 'hover',
      '--dsw-alias-button-elevated-fill': 'widgetBackground',
      '--dsw-alias-state-business-primary': 'buttonBackground', '--dsw-focus-ring-color': 'focus',
      '--dsw-alias-state-error-primary': 'error', '--dsw-alias-state-warn-primary': 'warning',
      '--dsw-alias-markdown-code-block': 'codeBackground',
      '--dsw-alias-scrollbar-bg-l2': 'scrollbar', '--dsw-alias-scrollbar-hover-l2': 'scrollbarHover',
      '--dsw-alias-turn-trigger-bg': 'widgetBackground', '--dsw-alias-turn-trigger-bg-hover': 'hover',
    };
    function mount(ctx) {
      ctx.effect(() => {
        const body = document.body;
        body.dataset.dshCompanion = 'sidebar';
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = '/__dsh_companion/sidebar.css';
        document.head.append(css);
        const header = document.createElement('nav');
        header.id = 'dsh-companion-toolbar'; header.setAttribute('aria-label', 'DSH 侧栏工具栏');
        let editorContext = null, boundPath = null, workspaceId = null, bindingPending = false, bindingSequence = 0, bindingError = '';
        const pendingReads = new Map();
        const references = new ReferenceController(readReference, scheduleSync);
        let readSequence = 0, inputBinding = null, offInput = () => {};
        const contextBar = document.createElement('div'); contextBar.id = 'dsh-companion-context';
        const workspaceLabel = button('工作区', () => bindWorkspace(true));
        contextBar.append(workspaceLabel);
        const back = button('返回聊天', () => {
          ctx.slots.entries('sidebar.settings')[0].store.create().actions.close();
          ctx.layout.selectPanel(null);
          closeNavigation();
          ctx.layout.closeRightbar();
        });
        const history = button('会话历史', () => { ctx.layout.closeRightbar(); ctx.layout.toggleSidebar(); }, 'history', true);
        const newSession = button('新建会话', () => {
          if (bindingError) { bindWorkspace(true); return; }
          ctx.layout.closeRightbar(); ctx.uiWorkspace.startSession(workspaceId); closeNavigation();
        }, 'new', true);
        header.append(back, history, newSession);
        const spacer = document.createElement('span'); spacer.className = 'dsh-companion-spacer'; header.append(spacer);
        const menu = document.createElement('div'); menu.id = 'dsh-companion-menu'; menu.hidden = true;
        menu.setAttribute('role', 'menu');
        for (const [label, panel] of [['插件', 'plugins'], ['自动化任务', 'schedules']]) {
          menu.append(button(label, () => { ctx.layout.closeRightbar(); ctx.layout.selectPanel(panel); closeNavigation(); setMenu(false); }, panel));
        }
        menu.append(button('设置与账号', () => {
          ctx.layout.closeRightbar();
          closeNavigation();
          setMenu(false);
          ctx.slots.entries('sidebar.settings')[0].store.create().actions.open();
        }, 'settings'));
        for (const item of menu.children) item.setAttribute('role', 'menuitem');
        const more = button('更多操作', () => setMenu(menu.hidden), 'more', true);
        more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        header.append(more);
        body.append(header, menu);
        function setMenu(open) {
          menu.hidden = !open; more.setAttribute('aria-expanded', String(open));
          if (open) menu.firstElementChild.focus();
        }

        function button(label, action, icon, iconOnly = false) {
          const element = document.createElement('button');
          element.type = 'button'; element.setAttribute('aria-label', label);
          if (icon) element.innerHTML = '<svg class="dsh-companion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[icon] + '</svg>';
          if (iconOnly) { element.className = 'dsh-companion-icon-button'; element.title = label; }
          else element.append(document.createTextNode(label));
          element.addEventListener('click', action);
          return element;
        }
        function post(type, detail = {}) { parent.postMessage({ source: SELF, type, ...detail }, '*'); }
        function mainBinding() {
          const row = Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView || 0) > 0);
          return row ? ctx.sessions.binding(row.id) : null;
        }
        async function bindWorkspace(force = false) {
          const path = editorContext?.workspacePath;
          if (!force && path === boundPath) return;
          boundPath = path; workspaceId = null; bindingError = ''; const sequence = ++bindingSequence;
          if (!path) { bindingPending = false; sync(); return; }
          bindingPending = true; ctx.layout.selectPanel(null); sync();
          try {
            const workspace = await ctx.workspaces.create({ path });
            if (sequence !== bindingSequence) return;
            workspaceId = workspace.workspaceId;
            await ctx.uiWorkspace.openWorkspace(workspaceId);
          } catch (error) {
            if (sequence === bindingSequence) bindingError = error.message;
          } finally {
            if (sequence === bindingSequence) { bindingPending = false; sync(); }
          }
        }
        function readReference(uri, signal) {
          return new Promise((resolve, reject) => {
            const requestId = String(++readSequence), started = performance.now();
            const finish = (value, error) => {
              post('trace', { stage: 'reference-roundtrip', durationMs: performance.now() - started });
              clearTimeout(timeout); signal.removeEventListener('abort', aborted); pendingReads.delete(requestId);
              if (error) reject(error); else resolve(value);
            };
            const aborted = () => finish(null, new Error('文件引用已取消'));
            const timeout = setTimeout(() => finish(null, new Error('读取 VS Code 文件超时，请重试')), 10000);
            pendingReads.set(requestId, finish); signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) aborted(); else post('read-reference', { requestId, uri });
          });
        }
        const offReferenceSource = ctx.inputTriggers.registerSource({
          trigger: '@', name: 'vscode-editor',
          candidates: async () => [], onPick: () => undefined,
          codec: {
            clipboardText: ref => '@' + (JSON.parse(ref).name || '当前文件'),
            serialize: async (ref, signal) => {
              const started = performance.now();
              try { return await references.serialize(JSON.parse(ref), signal); }
              finally { post('trace', { stage: 'reference-serialize', durationMs: performance.now() - started }); }
            },
          },
        });
        const offReferenceDisplay = ctx.uiConversation.userText.register({
          id: 'vscode-editor-display', order: 10,
          match(text, from) {
            const pattern = /\[VS Code 文件引用\]\n([\s\S]*?)\n\[\/VS Code 文件引用\]/g;
            pattern.lastIndex = from;
            const match = pattern.exec(text); if (!match) return;
            let value;
            try { value = JSON.parse(match[1]); }
            catch (error) { if (error instanceof SyntaxError) return; throw error; }
            if (typeof value.filePath !== 'string' || typeof value.content !== 'string') return;
            const label = value.filePath.split(/[\\/]/).pop() + (value.startLine ? ':' + value.startLine + '–' + value.endLine : '');
            return { id: 'text', start: match.index, end: match.index + match[0].length,
              data: { text: match[0], display: '[文件：' + label + (value.unsaved ? ' · 未保存' : '') + ']' } };
          },
        });
        function referenceSpan(state, occurrence) {
          const preceding = state.occurrences.filter(item => item.offset < occurrence.offset);
          const start = occurrence.offset - preceding.reduce((sum, item) => sum + item.length - 1, 0);
          return { start, end: start + 1, draftRev: state.draftRev };
        }
        // Private adapter: all native DSH draft coordinates stay here.
        function draftFor(binding) {
          const input = ctx.conversation.input.for(binding.ctx);
          function occurrences(state) { return state.occurrences.filter(item => item.source === 'vscode-editor'); }
          function remove(occurrence, state) {
            return binding.ctx.bail('slash/input-consume-token', { guard: { kind: 'span', span: referenceSpan(state, occurrence) } });
          }
          return {
            id: binding.sessionId,
            snapshot() {
              const state = input.state.getSnapshot();
              return { editable: state.phase === 'plain' || state.phase === 'claimed',
                pending: binding.session.getSnapshot().pendingSubmissions.length > 0,
                references: occurrences(state).map(item => { const value = JSON.parse(item.ref);
                  return { id: String(item.occurrenceId), value: { ...value, contextKey: value.contextKey ?? referenceKey(value) } }; }) };
            },
            replaceAutomatic(reference) {
              const state = input.state.getSnapshot();
              const existing = occurrences(state).find(item => JSON.parse(item.ref).auto);
              if (!reference) return existing ? remove(existing, state) : true;
              const end = state.draft.length - state.occurrences.reduce((sum, item) => sum + item.length - 1, 0);
              const span = existing ? referenceSpan(state, existing) : { start: end, end, draftRev: state.draftRev };
              const label = reference.kind === 'selection' ? reference.name + ':' + reference.startLine + '–' + reference.endLine : reference.name;
              return input.insertReference({ source: 'vscode-editor', ref: JSON.stringify(reference), label,
                appearance: 'file', clipboardText: '@' + label }, span);
            },
            remove(id) {
              const state = input.state.getSnapshot(), occurrence = occurrences(state).find(item => String(item.occurrenceId) === id);
              return occurrence ? remove(occurrence, state) : false;
            },
          };
        }
        function insertReference(binding, reference) {
          const input = ctx.conversation.input.for(binding.ctx);
          const applied = draftFor(binding).replaceAutomatic({ ...reference, auto: false,
            ownerSessionId: binding.sessionId, contextKey: referenceKey(reference) });
          if (!applied) input.notify('error', '当前输入框正在发送，文件引用未添加，请稍后重试');
          else input.focus();
        }
        function syncEditorContext() {
          newSession.disabled = bindingPending || (!workspaceId && !bindingError);
          newSession.title = bindingError ? '重新连接当前工作区' : '新建会话';
          const binding = mainBinding();
          const seat = document.querySelector('[data-composer-seat]');
          if (seat && contextBar.parentElement !== seat) seat.prepend(contextBar);
          workspaceLabel.hidden = !bindingPending && !bindingError;
          const label = bindingError ? '工作区连接失败 · 点顶部新建重试' : bindingPending ? '正在连接工作区…' : '';
          if (workspaceLabel.textContent !== label) workspaceLabel.textContent = label;
          workspaceLabel.title = bindingError;
          if (binding !== inputBinding) {
            offInput(); inputBinding = binding;
            if (binding) {
              const offState = ctx.conversation.input.for(binding.ctx).state.subscribe(scheduleSync);
              const offSession = binding.session.subscribe(scheduleSync);
              offInput = () => { offState(); offSession(); };
            } else offInput = () => {};
          }
          if (!binding || bindingPending) return;
          references.sync(editorContext?.reference || null, draftFor(binding));
        }
        function syncReferenceControls() {
          const binding = mainBinding();
          if (!binding) return;
          const input = ctx.conversation.input.for(binding.ctx), state = input.state.getSnapshot();
          const visibleReferences = state.occurrences.filter(item => item.source === 'vscode-editor');
          document.querySelectorAll('[data-composer-input] [data-composer-chip="vscode-editor"]').forEach((chip, index) => {
            const reference = visibleReferences[index];
            if (!reference) return;
            let close = chip.querySelector('.dsh-companion-reference-close');
            if (!close) {
              close = document.createElement('button'); close.type = 'button';
              close.className = 'dsh-companion-reference-close';
              close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
              close.addEventListener('pointerdown', event => event.preventDefault());
              close.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
              });
              close.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation();
                const current = mainBinding(), currentInput = ctx.conversation.input.for(current.ctx);
                const removed = references.remove(draftFor(current), close.dataset.occurrenceId);
                if (!removed) currentInput.notify('error', '当前输入框正在变化，文件引用未移除，请重试');
                else currentInput.focus();
              });
              chip.append(close);
            }
            close.dataset.occurrenceId = reference.occurrenceId;
            close.title = '移除引用';
            close.setAttribute('aria-label', '移除引用 ' + reference.label);
            close.disabled = state.phase !== 'plain' && state.phase !== 'claimed';
          });
        }
        function frame() { return document.querySelector('[data-slot="sidebar"]')?.parentElement.parentElement; }
        function navigationOpen() { const root = frame(); return root && !root.hasAttribute('data-sidebar-collapsed'); }
        function closeNavigation() { if (navigationOpen()) ctx.layout.toggleSidebar(); }
        let observedFrame = null;
        function sync() {
          const root = frame();
          if (!root) return;
          if (observedFrame !== root) {
            observer.disconnect();
            observer.observe(body, { childList: true });
            observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-right-open'] });
            observedFrame = root;
          }
          if (!root.hasAttribute('data-dsh-companion-frame')) {
            root.setAttribute('data-dsh-companion-frame', '');
            const navigation = document.querySelector('[data-slot="sidebar"]').parentElement;
            navigation.setAttribute('data-dsh-companion-navigation', '');
            navigation.nextElementSibling.setAttribute('data-dsh-companion-center', '');
          }
          const settings = document.querySelector('[data-slot="settings.header"]')?.closest('[role="dialog"]');
          if (settings && !settings.hasAttribute('data-dsh-companion-settings')) {
            settings.setAttribute('data-dsh-companion-settings', '');
            settings.parentElement.setAttribute('data-dsh-companion-settings-overlay', '');
          }
          const isPanel = ctx.layout.panelInfo.getSnapshot().activePanelId !== null;
          history.setAttribute('aria-expanded', String(navigationOpen()));
          const rightOpen = !!document.querySelector('[data-sidebar-right-open]');
          root.querySelector('[data-dsh-companion-center]').inert = navigationOpen() || rightOpen || bindingPending || !!bindingError;
          const showBack = navigationOpen() || isPanel || !!settings || rightOpen;
          if (back.hidden === showBack) back.hidden = !showBack;
          syncEditorContext();
          syncReferenceControls();
        }
        let scheduled = false, animation = 0, disposed = false;
        function scheduleSync() {
          if (disposed || scheduled) return;
          scheduled = true;
          animation = requestAnimationFrame(() => { scheduled = false; sync(); });
        }
        const observer = new MutationObserver(scheduleSync);
        observer.observe(body, { childList: true, subtree: true });
        const offPanel = ctx.layout.panelInfo.subscribe(sync);
        const offSessions = ctx.sessions.list.subscribe(scheduleSync);
        const offTheme = ctx.on('theme/change', () => post('hello'));
        const selectSession = event => {
          if (event.target.closest('button[aria-label="发送消息"]')) {
            const started = performance.now();
            requestAnimationFrame(() => post('trace', { stage: 'send-feedback', durationMs: performance.now() - started }));
          }
          if (event.target.closest('[data-row-key^="session:"]') && !event.target.closest('button')) {
            requestAnimationFrame(closeNavigation);
          }
        };
        body.addEventListener('click', selectSession);
        const dismissMenu = event => {
          if (!header.contains(event.target) && !menu.contains(event.target)) setMenu(false);
        };
        body.addEventListener('pointerdown', dismissMenu);
        const onEscape = event => {
          if (event.key === 'Escape' && !menu.hidden) { setMenu(false); more.focus(); }
          if (event.target === more && event.key === 'ArrowDown') { event.preventDefault(); setMenu(true); }
          else if (menu.contains(event.target)) {
            const items = [...menu.children], index = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
            } else if (event.key === 'Tab') setMenu(false);
          }
        };
        body.addEventListener('keydown', onEscape);
        const onMessage = event => {
          if (event.source !== parent || event.data?.source !== HOST) return;
          if (event.data.type === 'editor-context') {
            editorContext = event.data.context; bindWorkspace(); sync(); return;
          }
          if (event.data.type === 'editor-reference') {
            const binding = mainBinding();
            if (binding) insertReference(binding, event.data.reference);
            return;
          }
          if (event.data.type === 'reference-result') {
            const finish = pendingReads.get(event.data.requestId);
            if (finish) finish(event.data.value, event.data.error ? new Error(event.data.error) : null);
            return;
          }
          if (event.data.type !== 'sidebar-theme') return;
          const { tokens, dark, contrast } = event.data;
          for (const [name, key] of Object.entries(tokenMap)) {
            if (typeof tokens[key] === 'string' && tokens[key]) body.style.setProperty(name, tokens[key], 'important');
          }
          for (const key of ['foreground', 'background', 'inputForeground', 'inputBackground', 'border', 'focus', 'buttonForeground', 'buttonBackground', 'hover', 'fontFamily', 'fontSize', 'codeFontFamily', 'codeFontSize', 'link']) {
            if (typeof tokens[key] === 'string' && tokens[key]) body.style.setProperty('--dsh-companion-' + key, tokens[key]);
          }
          body.style.setProperty('--dsh-font-family-text', tokens.fontFamily);
          body.style.setProperty('--dsh-font-family-code', tokens.codeFontFamily);
          body.style.setProperty('--dsh-content-font-size', tokens.fontSize);
          body.style.setProperty('--dsh-code-font-size', tokens.codeFontSize);
          body.toggleAttribute('data-ds-dark-theme', dark === true);
          body.toggleAttribute('data-dsh-companion-contrast', contrast === true);
          body.style.colorScheme = dark ? 'dark' : 'light';
        };
        window.addEventListener('message', onMessage);
        ctx.layout.closeRightbar();
        sync(); post('hello');
        return () => {
          disposed = true;
          ++bindingSequence;
          observer.disconnect(); cancelAnimationFrame(animation); offPanel(); offTheme(); offSessions(); offInput(); offReferenceSource(); offReferenceDisplay(); references.dispose(); contextBar.remove(); header.remove(); menu.remove(); css.remove();
          for (const close of body.querySelectorAll('.dsh-companion-reference-close')) close.remove();
          for (const finish of pendingReads.values()) finish(null, new Error('DSH 页面已关闭'));
          window.removeEventListener('message', onMessage);
          body.removeEventListener('click', selectSession); body.removeEventListener('pointerdown', dismissMenu);
          body.removeEventListener('keydown', onEscape);
          delete body.dataset.dshCompanion;
        };
      }, 'VS Code: scoped sidebar layout and theme');
    }
    // A page-owned plugin survives the Host's HMR roster, which deliberately has no local adapter entry.
    return { inject: ['layout', 'uiWorkspace', 'slots', 'workspaces', 'sessions', 'conversation', 'inputTriggers', 'uiConversation'], apply(ctx) {
      ctx.root.plugin({ name: 'vscode-sidebar-page', inject: ['layout', 'uiWorkspace', 'slots', 'workspaces', 'sessions', 'conversation', 'inputTriggers', 'uiConversation'], apply: mount });
    } };
  },
});
