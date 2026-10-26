import type { EditorReference, EditorSnapshot } from '../../protocol';
import type { DshContext } from './dsh-contract';
import type { SidebarTheme, UiErrorCode } from './bridge';
import { createSidebarNavigation } from './navigation-adapter';
const icons = {
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5V12l3.5 2"/>',
  new: '<path d="M20.5 11.7a8.2 8.2 0 0 1-8.3 8.1 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.4a8.2 8.2 0 1 1 15.6-3.9Z"/><path d="M12 8v7M8.5 11.5h7"/>',
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
export function createSidebarLayout(ctx: DshContext, syncInput: (reference: EditorReference | null, blocked: boolean) => void,
  trace: (stage: string, durationMs: number) => void, rendered: () => void, failed: (code: UiErrorCode) => void) {
  const body = document.body;
  body.dataset.dshCompanion = 'sidebar';
  const css = document.createElement('link');
  let stylesReady = false, themeReady = false, renderedOnce = false;
  css.addEventListener('load', () => { stylesReady = true; scheduleSync(); }, { once: true });
  css.addEventListener('error', () => failed('DSH_UI_STYLE_FAILED'), { once: true });
  css.rel = 'stylesheet'; css.href = '/__dsh_companion/sidebar.css';
  document.head.append(css);
  const header = document.createElement('nav');
  header.id = 'dsh-companion-toolbar'; header.setAttribute('aria-label', 'DSH 侧栏工具栏');
  let editorContext: EditorSnapshot | null = null, boundPath: string | null | undefined = null, workspaceId: string | null = null;
  let bindingPending = false, bindingSequence = 0, bindingError = '';
  let finishInitialSelection: (() => void) | undefined;
  const contextBar = document.createElement('div'); contextBar.id = 'dsh-companion-context';
  const workspaceLabel = button('工作区', () => bindWorkspace(true));
  contextBar.append(workspaceLabel);
  const history = button('历史会话', () => {
    ctx.slots.entries('sidebar.settings')[0].store.create().actions.close();
    ctx.layout.selectPanel(null);
    ctx.layout.closeRightbar();
    navigation.toggle();
  }, 'history', true);
  const newSession = button('新建会话', () => {
    if(bindingError) { bindWorkspace(true); return; }
    ctx.slots.entries('sidebar.settings')[0].store.create().actions.close();
    ctx.layout.selectPanel(null);
    ctx.layout.closeRightbar(); ctx.uiWorkspace.startSession(workspaceId); navigation.closeDrawer();
  }, 'new', true);
  header.append(history, newSession);
  for(const [label, panel] of [['插件', 'plugins'], ['自动化任务', 'schedules']] as const) {
    header.append(button(label, () => {
      const settings = ctx.slots.entries('sidebar.settings')[0].store.create();
      const selected = !settings.getSnapshot().open && ctx.layout.panelInfo.getSnapshot().activePanelId === panel;
      settings.actions.close();
      ctx.layout.closeRightbar(); ctx.layout.selectPanel(selected ? null : panel); navigation.closeDrawer();
    }, panel, true));
  }
  header.append(button('设置', () => {
    const settings = ctx.slots.entries('sidebar.settings')[0].store.create();
    ctx.layout.closeRightbar();
    ctx.layout.selectPanel(null);
    navigation.closeDrawer();
    if(settings.getSnapshot().open) settings.actions.close();
    else settings.actions.open();
  }, 'settings', true));
  body.append(header);
  Array.from(header.children).forEach((entry, index) => entry.setAttribute('style', '--dsh-companion-index:' + index));
  const navigation = createSidebarNavigation(ctx.layout, header, scheduleSync);

  function button(label: string, action: () => void, icon?: keyof typeof icons, iconOnly = false) {
    const element = document.createElement('button');
    element.type = 'button'; element.setAttribute('aria-label', label);
    if(icon) element.innerHTML = '<svg class="dsh-companion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[icon] + '</svg>';
    if(iconOnly) {
      element.className = 'dsh-companion-icon-button'; element.title = label;
      const text = document.createElement('span'); text.className = 'dsh-companion-label'; text.textContent = label;
      element.append(text);
    }
    else element.append(document.createTextNode(label));
    element.addEventListener('click', action);
    return element;
  }
  async function bindWorkspace(force = false) {
    const path = editorContext?.workspacePath;
    if(!force && path === boundPath) return;
    finishInitialSelection?.();
    boundPath = path; workspaceId = null; bindingError = ''; const sequence = ++bindingSequence;
    if(!path) { bindingPending = false; sync(); return; }
    const started = performance.now();
    bindingPending = true; ctx.layout.selectPanel(null); sync();
    try {
      const workspace = await ctx.workspaces.create({ path });
      if(sequence !== bindingSequence) return;
      workspaceId = workspace.workspaceId;
      if(!force && !Object.values(ctx.sessions.list.getSnapshot().byId).some(session => session.retainedBy.mainView > 0)) {
        // Let native restoration finish before opening a competing blank. Bound
        // this short coalescing window: an empty/deleted selection may not restore.
        await new Promise<void>(resolve => {
          const off = ctx.sessions.list.subscribe(() => {
            if(Object.values(ctx.sessions.list.getSnapshot().byId).some(session => session.retainedBy.mainView > 0)) finish();
          });
          const finish = () => { clearTimeout(timeout); off(); finishInitialSelection = undefined; resolve(); };
          const timeout = setTimeout(finish, 200);
          finishInitialSelection = finish;
        });
      }
      if(sequence !== bindingSequence) return;
      const current = Object.values(ctx.sessions.list.getSnapshot().byId).find(session => session.retainedBy.mainView > 0);
      if(force || current?.cwd !== workspace.path) await ctx.uiWorkspace.openWorkspace(workspaceId);
    } catch(error) {
      if(sequence === bindingSequence) bindingError = (error as Error).message;
    } finally {
      if(sequence === bindingSequence) {
        trace('workspace-bind', performance.now() - started);
        bindingPending = false; sync();
      }
    }
  }
  function syncEditorContext() {
    newSession.disabled = bindingPending || (!workspaceId && !bindingError);
    newSession.title = bindingError ? '重新连接当前工作区' : '新建会话';
    const seat = document.querySelector('[data-composer-seat]');
    if(seat && contextBar.parentElement !== seat) seat.prepend(contextBar);
    workspaceLabel.hidden = !bindingPending && !bindingError;
    const label = bindingError ? '工作区连接失败 · 点顶部新建重试' : bindingPending ? '正在连接工作区…' : '';
    if(workspaceLabel.textContent !== label) workspaceLabel.textContent = label;
    workspaceLabel.title = bindingError;
    syncInput(editorContext?.reference || null, bindingPending);
  }
  function frame() { return document.querySelector<HTMLElement>('[data-slot="sidebar"]')?.parentElement!.parentElement; }
  let observedFrame: HTMLElement | null = null;
  function sync() {
    const root = frame();
    if(!root) return;
    if(observedFrame !== root) {
      observer.disconnect();
      observer.observe(body, { childList: true });
      observer.observe(root, { childList: !renderedOnce, subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-right-open'] });
      observedFrame = root;
    }
    if(!root.hasAttribute('data-dsh-companion-frame')) {
      root.setAttribute('data-dsh-companion-frame', '');
      const navigation = document.querySelector<HTMLElement>('[data-slot="sidebar"]')!.parentElement!;
      navigation.setAttribute('data-dsh-companion-navigation', '');
      navigation.nextElementSibling!.setAttribute('data-dsh-companion-center', '');
    }
    const settings = document.querySelector('[data-slot="settings.header"]')?.closest('[role="dialog"]');
    if(settings && !settings.hasAttribute('data-dsh-companion-settings')) {
      settings.setAttribute('data-dsh-companion-settings', '');
      settings.parentElement!.setAttribute('data-dsh-companion-settings-overlay', '');
    }
    const drawerOpen = navigation.sync(root);
    const rightOpen = !!document.querySelector('[data-sidebar-right-open]');
    root.querySelector<HTMLElement>('[data-dsh-companion-center]')!.inert = drawerOpen || rightOpen || bindingPending || !!bindingError;
    syncEditorContext();
    if(!renderedOnce && stylesReady && themeReady && editorContext && !bindingPending &&
      (bindingError || document.querySelector('[data-composer-input], [role="dialog"]'))) {
      renderedOnce = true;
      // Stop observing initial rendering once the usable page is under the loading overlay.
      observer.disconnect(); observedFrame = null; scheduleSync();
      rendered();
    }
  }
  let scheduled = false, animation = 0, disposed = false;
  function scheduleSync() {
    if(disposed || scheduled) return;
    scheduled = true;
    animation = requestAnimationFrame(() => {
      scheduled = false;
      try { sync(); } catch { failed('DSH_UI_ADAPTER_FAILED'); }
    });
  }
  const observer = new MutationObserver(scheduleSync);
  observer.observe(body, { childList: true, subtree: true });
  const offPanel = ctx.layout.panelInfo.subscribe(scheduleSync);
  const offSessions = ctx.sessions.list.subscribe(scheduleSync);
  function applyTheme(theme: SidebarTheme) {
    const { tokens, dark, contrast } = theme;
    for(const [name, key] of Object.entries(tokenMap)) {
      if(typeof tokens[key] === 'string' && tokens[key]) body.style.setProperty(name, tokens[key], 'important');
    }
    for(const key of ['foreground', 'background', 'inputForeground', 'inputBackground', 'border', 'focus', 'buttonForeground', 'buttonBackground', 'hover', 'fontFamily', 'fontSize', 'codeFontFamily', 'codeFontSize', 'link']) {
      if(typeof tokens[key] === 'string' && tokens[key]) body.style.setProperty('--dsh-companion-' + key, tokens[key]);
    }
    body.style.setProperty('--dsh-font-family-text', tokens.fontFamily);
    body.style.setProperty('--dsh-font-family-code', tokens.codeFontFamily);
    body.style.setProperty('--dsh-content-font-size', tokens.fontSize);
    body.style.setProperty('--dsh-code-font-size', tokens.codeFontSize);
    body.toggleAttribute('data-ds-dark-theme', dark === true);
    body.toggleAttribute('data-dsh-companion-contrast', contrast === true);
    body.style.colorScheme = dark ? 'dark' : 'light';
    themeReady = true; scheduleSync();
  }
  ctx.layout.closeRightbar(); scheduleSync();
  return {
    setContext(context: EditorSnapshot) { editorContext = context; void bindWorkspace(); sync(); },
    applyTheme, scheduleSync,
    dispose() {
      disposed = true; ++bindingSequence; observer.disconnect(); cancelAnimationFrame(animation); offPanel(); offSessions();
      finishInitialSelection?.();
      navigation.dispose();
      contextBar.remove(); header.remove(); css.remove(); delete body.dataset.dshCompanion;
    }
  };
}
