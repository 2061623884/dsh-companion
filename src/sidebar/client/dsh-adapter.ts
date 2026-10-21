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
          context: value => layout.setContext(value),
          reference: value => input.add(value), theme: value => layout.applyTheme(value)
        });
        const input = createInputAdapter(ctx, bridge, () => layout.scheduleSync());
        const layout = createSidebarLayout(ctx, input.sync, bridge.trace);
        const offTheme = ctx.on('theme/change', bridge.ready);
        bridge.ready();
        return () => { offTheme(); bridge.dispose(); layout.dispose(); input.dispose(); };
      }, 'VS Code: scoped sidebar layout and theme');
    }
    // Keep the page-owned plugin outside the Host's HMR roster.
    const inject = ['layout', 'uiWorkspace', 'slots', 'workspaces', 'sessions', 'conversation', 'inputTriggers', 'uiConversation'];
    return { inject, apply(ctx: DshContext) { ctx.root.plugin({ name: 'vscode-sidebar-page', inject, apply: mount }); } };
  },
});
