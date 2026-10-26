import * as vscode from 'vscode';
import * as path from 'node:path';
import { RuntimeConnection } from './runtime/connection';
import { EditorContext } from './context/editor-context';
import { SidebarView } from './sidebar/view';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('DSH Companion');
  let view: SidebarView;
  const connection = new RuntimeConnection({ assetsDirectory: path.join(context.extensionPath, 'dist'),
    onUnavailable: error => { void view.desktopUnavailable(error); } });
  const editor = new EditorContext();
  view = new SidebarView(context.extensionPath, connection, editor, log);
  context.subscriptions.push(log, editor, view,
    vscode.window.registerWebviewViewProvider('dshCompanion.chat', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('dshCompanion.open', () => view.show()),
    vscode.commands.registerCommand('dshCompanion.refresh', () => view.refresh()),
    vscode.commands.registerCommand('dshCompanion.reference', () => view.referenceCurrent()),
    { dispose: () => { void connection.dispose().catch(error => log.appendLine(`代理释放失败: ${error.code || error.name}`)); } });
}
