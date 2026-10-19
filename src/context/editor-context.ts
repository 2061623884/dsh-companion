import * as vscode from 'vscode';
import * as path from 'node:path';
import { EditorSnapshot, ResolvedFile } from '../protocol';

/** The vscode argument is the production adapter; Extension Host tests use the same interface. */
export class EditorContext implements vscode.Disposable {
  private lastEditor: vscode.TextEditor | undefined;
  private readonly changes: vscode.EventEmitter<EditorSnapshot>;
  private readonly subscriptions: vscode.Disposable[];
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly onChange: vscode.Event<EditorSnapshot>;

  constructor(private readonly api: typeof vscode = vscode) {
    this.lastEditor = api.window.activeTextEditor;
    this.changes = new api.EventEmitter<EditorSnapshot>();
    this.onChange = this.changes.event;
    const publish = () => { clearTimeout(this.timer); this.changes.fire(this.snapshot()); };
    this.subscriptions = [
      api.window.onDidChangeActiveTextEditor(editor => { if (editor) this.lastEditor = editor; publish(); }),
      api.window.onDidChangeTextEditorSelection(() => { clearTimeout(this.timer); this.timer = setTimeout(publish, 40); }),
      api.workspace.onDidChangeTextDocument(event => { if (event.document === this.editor()?.document) publish(); }),
      api.workspace.onDidChangeWorkspaceFolders(publish),
      api.workspace.onDidCloseTextDocument(publish),
    ];
  }

  private editor(): vscode.TextEditor | undefined {
    const editor = this.api.window.activeTextEditor || this.lastEditor;
    return editor && !editor.document.isClosed ? editor : undefined;
  }

  snapshot(): EditorSnapshot {
    const editor = this.editor(), document = editor?.document;
    const folder = (document && this.api.workspace.getWorkspaceFolder(document.uri)) || this.api.workspace.workspaceFolders?.[0];
    let reference: EditorSnapshot['reference'] = null;
    if (document && editor) {
      const base = { uri: document.uri.toString(), name: path.basename(document.uri.fsPath), version: document.version };
      const selection = editor.selection;
      reference = selection.isEmpty ? { ...base, kind: 'file' } : {
        ...base, kind: 'selection', filePath: document.uri.fsPath, language: document.languageId,
        unsaved: document.isDirty, startLine: selection.start.line + 1,
        endLine: selection.end.line + (selection.end.character === 0 && selection.end.line > selection.start.line ? 0 : 1),
        range: `${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`,
        content: document.getText(selection),
      };
    }
    return { workspacePath: folder?.uri.fsPath || null, workspaceName: folder?.name || '未打开工作区', reference };
  }

  async read(uriText: string): Promise<ResolvedFile> {
    const uri = this.api.Uri.parse(uriText);
    const open = this.api.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
    if (!open && (uri.scheme !== 'file' || !this.api.workspace.getWorkspaceFolder(uri))) {
      throw new Error('只能引用当前打开的文件或工作区内的文件');
    }
    const document = open || await this.api.workspace.openTextDocument(uri);
    return { uri: uri.toString(), filePath: document.uri.fsPath, language: document.languageId,
      unsaved: document.isDirty, content: document.getText() };
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.changes.dispose();
  }
}
