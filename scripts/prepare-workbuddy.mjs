import { readFile, writeFile, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One checked seam in the pinned upstream provider. No global prototype patch,
// desktop package edit or application-wide credential interception.
export async function prepareWorkBuddy(runtime) {
  const directory = await realpath(path.join(runtime, 'node_modules/dsh-workbuddy-connect'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.version !== '0.6.10') throw new Error('WorkBuddy auth adapter requires pinned 0.6.10');
  const target = path.join(runtime, 'workbuddy-auth.mjs');
  await copyFile(fileURLToPath(new URL('../src/runtime/workbuddy-auth.mjs', import.meta.url)), target);
  const entry = path.join(directory, manifest.main);
  const original = '\tconst store = new WorkBuddyCredentialStore({\n\t\tvariant,\n\t\trefresh: (credential) => client.refreshToken(credential)\n\t});';
  const replacement = '\tconst store = withDesktopWorkBuddyAuth(new WorkBuddyCredentialStore({\n\t\tvariant,\n\t\trefresh: (credential) => client.refreshToken(credential)\n\t}), variant, parseWorkBuddyAuth, realmOf);';
  const relative = path.relative(path.dirname(entry), target).replaceAll('\\', '/');
  const imported = `import { withDesktopWorkBuddyAuth } from ${JSON.stringify(relative.startsWith('.') ? relative : './' + relative)};\n`;
  const source = (await readFile(entry, 'utf8')).replaceAll('\r\n', '\n');
  if (source.includes(replacement) && source.startsWith(imported)) return;
  if (source.split(original).length !== 2) throw new Error('Pinned WorkBuddy store construction changed');
  await writeFile(entry, imported + source.replace(original, replacement));
}
