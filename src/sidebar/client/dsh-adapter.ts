import type { DshContext } from './dsh-contract';
import { createEditorBridge } from './bridge';
import { createInputAdapter } from './input-adapter';
import { createSidebarLayout } from './layout-adapter';

window.__ModuleLoader__.load({
  id: 'dsh-companion-sidebar',
  factory() {
    function mount(ctx: DshContext) {
      ctx.effect(() => {
        const bridge = createEditorBridge({
          context: value => layout!.setContext(value),
          reference: value => input!.add(value), theme: value => layout!.applyTheme(value)
        });
        let input: ReturnType<typeof createInputAdapter> | undefined;
        let layout: ReturnType<typeof createSidebarLayout> | undefined;
        let offTheme: (() => void) | undefined;
        try {
          input = createInputAdapter(ctx, bridge, () => layout!.scheduleSync());
          layout = createSidebarLayout(ctx, input.sync, bridge.trace, bridge.rendered, bridge.failed);
          offTheme = ctx.on('theme/change', bridge.ready);
          bridge.ready();
        } catch { bridge.failed('DSH_UI_ADAPTER_FAILED'); }
        return () => { offTheme?.(); bridge.dispose(); layout?.dispose(); input?.dispose(); };
      }, 'VS Code: scoped sidebar layout and theme');
    }
    // Keep the page-owned plugin outside the Host's HMR roster.
    const inject = ['layout', 'uiWorkspace', 'slots', 'workspaces', 'sessions', 'conversation', 'inputTriggers', 'uiConversation'];
    return { inject, apply(ctx: DshContext) { ctx.root.plugin({ name: 'vscode-sidebar-page', inject, apply: mount }); } };
  },
});
