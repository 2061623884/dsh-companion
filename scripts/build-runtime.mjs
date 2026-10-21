import { copyFile } from 'node:fs/promises';
import { prepareWorkBuddy } from './prepare-workbuddy.mjs';
// Explicitly invoked only for runtime integration and packaging.
for (const name of ['host.mjs', 'import.mjs']) await copyFile('src/runtime/' + name, 'runtime/' + name);
await prepareWorkBuddy('runtime');
