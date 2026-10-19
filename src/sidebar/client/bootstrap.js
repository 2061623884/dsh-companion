// This script is served by the extension proxy, never by the Desktop Host.
(() => {
  if (window.parent === window || window.name !== 'dsh-companion-host') return;
  const boot = globalThis.__DSH_BOOT__;
  const id = 'dsh-companion-sidebar';
  const url = '/__dsh_companion/sidebar.js';
  boot.entries.push({
    id, url, rev: 'sidebar-1',
    inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-workspace'],
  });
  boot.batches.push({ phase: 'application', url, rev: 'sidebar-1', entries: [id] });
})();
