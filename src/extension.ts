import * as vscode from 'vscode';
import * as path from 'node:path';
import { DesktopConnection } from './desktop/connection';
import { EditorContext } from './context/editor-context';
import { SidebarView } from './sidebar/view';
import { desktopDownloadUrl } from './desktop/client';
import { DesktopUpdates, updateCheckInterval } from './desktop/updates';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('DSH Companion');
  let view: SidebarView;
  const connection = new DesktopConnection({ assetsDirectory: path.join(context.extensionPath, 'dist'),
    onUnavailable: error => { void view.desktopUnavailable(error); } });
  const editor = new EditorContext();
  view = new SidebarView(context.extensionPath, connection, editor, log);
  const updates = new DesktopUpdates();
  let disposed = false;
  let notifiedVersion = context.globalState.get<string>('desktopUpdateNotified');
  const checkUpdates = async (manual = false): Promise<void> => {
    try {
      const result = await updates.check(manual);
      if (disposed) return;
      if (result.state === 'not-installed') {
        if (manual && await vscode.window.showInformationMessage('请先安装 DeepSeek Harness 桌面端。', '下载桌面端') === '下载桌面端') {
          await vscode.env.openExternal(vscode.Uri.parse(desktopDownloadUrl));
        }
        return;
      }
      if (result.state === 'current') {
        if (manual) await vscode.window.showInformationMessage(`桌面端版本 ${result.installed}，官方更新版本 ${result.latest}，目前无需更新。`);
        return;
      }
      if (!manual && notifiedVersion === result.latest) return;
      notifiedVersion = result.latest;
      await context.globalState.update('desktopUpdateNotified', result.latest);
      const action = await vscode.window.showInformationMessage(
        `DeepSeek Harness 可更新：${result.installed} → ${result.latest}。更新桌面端后，在此重新连接即可同步运行时。`, '前往更新');
      if (action === '前往更新' && !disposed) await vscode.env.openExternal(vscode.Uri.parse(desktopDownloadUrl));
    } catch (error) {
      if (disposed) return;
      log.appendLine(`桌面端更新检查失败 (${(error as NodeJS.ErrnoException).code || (error as Error).name})`);
      if (manual) await vscode.window.showWarningMessage('暂时无法检查桌面端更新，请稍后重试或在桌面端检查更新。');
    }
  };
  const updateTimer = setInterval(() => { void checkUpdates(); }, updateCheckInterval);
  void checkUpdates();
  context.subscriptions.push(log, editor, view,
    vscode.window.registerWebviewViewProvider('dshCompanion.chat', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('dshCompanion.open', () => view.show()),
    vscode.commands.registerCommand('dshCompanion.refresh', () => view.refresh()),
    vscode.commands.registerCommand('dshCompanion.reference', () => view.referenceCurrent()),
    vscode.commands.registerCommand('dshCompanion.checkUpdates', () => checkUpdates(true)),
    { dispose: () => { disposed = true; clearInterval(updateTimer); updates.dispose(); } },
    { dispose: () => { void connection.dispose().catch(error => log.appendLine(`代理释放失败: ${error.code || error.name}`)); } });
}
