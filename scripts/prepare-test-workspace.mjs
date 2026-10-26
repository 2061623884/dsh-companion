import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Synthetic editor data outside the repository's Node package scope. */
export async function prepareTestWorkspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-fixtures-'));
  for (const folder of ['a', 'b']) {
    await mkdir(path.join(directory, folder));
    await writeFile(path.join(directory, folder, 'main.py'), 'print("synthetic-' + folder + '")\n');
  }
  const desktop = path.join(directory, 'desktop/profiles/desktop'); await mkdir(desktop, { recursive: true });
  await writeFile(path.join(desktop, 'cordis.patch.yml'), '[]\n');
  const workspace = path.join(directory, 'fixtures.code-workspace');
  await writeFile(workspace, JSON.stringify({ folders: [{ path: 'a' }, { path: 'b' }], settings: { 'git.enabled': false } }, null, 2));
  return { directory, workspace, desktop: path.join(directory, 'desktop') };
}
