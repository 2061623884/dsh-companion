declare function acquireVsCodeApi(): { postMessage(message: import('../../protocol').ClientMessage): void };
const connectionApi = acquireVsCodeApi();
document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.dataset.action === 'open-desktop') connectionApi.postMessage({ type: 'open-desktop' });
    else if (button.dataset.action === 'install-desktop') connectionApi.postMessage({ type: 'install-desktop' });
    else connectionApi.postMessage({ type: 'retry' });
  });
});
