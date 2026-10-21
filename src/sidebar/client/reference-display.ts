export function matchEditorReference(text: string, from: number) {
  const pattern = /\[VS Code 文件引用\]\n([\s\S]*?)\n\[\/VS Code 文件引用\]/g;
  pattern.lastIndex = from;
  const match = pattern.exec(text); if(!match) return;
  let value;
  try { value = JSON.parse(match[1]); }
  catch(error) { if(error instanceof SyntaxError) return; throw error; }
  if(!value || typeof value !== 'object' || typeof value.filePath !== 'string' || typeof value.content !== 'string') return;
  const label = value.filePath.split(/[\\/]/).pop() + (value.startLine ? ':' + value.startLine + '–' + value.endLine : '');
  return {
    id: 'text', start: match.index, end: match.index + match[0].length,
    data: { text: match[0], display: '[文件：' + label + (value.unsaved ? ' · 未保存' : '') + ']' }
  };
}
