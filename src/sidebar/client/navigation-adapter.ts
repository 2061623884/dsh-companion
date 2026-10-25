import type { DshContext } from './dsh-contract';

/** Owns navigation transitions and their event/timer lifetime inside the private adapter. */
export function createSidebarNavigation(layout: Pick<DshContext['layout'], 'toggleSidebar'>,
  toolbar: HTMLElement, invalidate: () => void) {
  const body = document.body;
  const drawer = matchMedia('(max-width: 759px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let root: HTMLElement | undefined;
  let initialized = false;
  let closing: 'pointer' | 'explicit' | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let selectionFrame = 0;

  const isOpen = () => !!root && !root.hasAttribute('data-sidebar-collapsed');
  function cancelClose() { clearTimeout(closeTimer); closing = undefined; }
  function close(reason: 'pointer' | 'explicit') {
    if(!isOpen()) return;
    if(closing) { if(reason === 'explicit') closing = reason; return; }
    closing = reason; invalidate();
    // Native rows remain mounted and hoverable until the exit transition ends.
    closeTimer = setTimeout(() => { if(isOpen()) layout.toggleSidebar(); }, reducedMotion.matches ? 0 : 180);
  }
  function closeDrawer() { if(drawer.matches) close('explicit'); }
  const inNavigation = (target: EventTarget | null) => target instanceof Element &&
    !!target.closest('#dsh-companion-toolbar, [data-dsh-companion-navigation]');
  const leave = (event: PointerEvent) => {
    if(event.pointerType !== 'mouse' || !inNavigation(event.target) || inNavigation(event.relatedTarget)) return;
    clearTimeout(leaveTimer); leaveTimer = setTimeout(() => close('pointer'), 180);
  };
  const enter = (event: PointerEvent) => {
    if(!inNavigation(event.target)) return;
    clearTimeout(leaveTimer);
    if(closing === 'pointer') { cancelClose(); invalidate(); }
  };
  const selectSession = (event: MouseEvent) => {
    if((event.target as Element).closest('[data-row-key^="session:"]') && !(event.target as Element).closest('button')) {
      cancelAnimationFrame(selectionFrame);
      selectionFrame = requestAnimationFrame(closeDrawer);
    }
  };
  body.addEventListener('pointerout', leave); body.addEventListener('pointerover', enter);
  body.addEventListener('click', selectSession); drawer.addEventListener('change', invalidate);

  return {
    toggle() {
      clearTimeout(leaveTimer);
      if(closing) { cancelClose(); invalidate(); }
      else if(isOpen()) close('explicit');
      else layout.toggleSidebar();
    },
    closeDrawer,
    /** Synchronize native state and return whether the narrow chat is blocked. */
    sync(frame: HTMLElement) {
      root = frame;
      if(!initialized) { initialized = true; if(isOpen()) layout.toggleSidebar(); }
      if(!isOpen()) cancelClose();
      const expanded = isOpen() && !closing;
      toolbar.setAttribute('data-expanded', String(expanded));
      body.toggleAttribute('data-dsh-companion-navigation-open', expanded);
      body.toggleAttribute('data-dsh-companion-navigation-closing', !!closing);
      toolbar.querySelector('[aria-label="历史会话"]')!.setAttribute('aria-expanded', String(expanded));
      return expanded && drawer.matches;
    },
    dispose() {
      cancelClose(); clearTimeout(leaveTimer); cancelAnimationFrame(selectionFrame);
      body.removeEventListener('pointerout', leave); body.removeEventListener('pointerover', enter);
      body.removeEventListener('click', selectSession); drawer.removeEventListener('change', invalidate);
      body.removeAttribute('data-dsh-companion-navigation-open'); body.removeAttribute('data-dsh-companion-navigation-closing');
    }
  };
}
