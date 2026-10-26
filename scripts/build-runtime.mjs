import { copyFile } from 'node:fs/promises';
import { prepareWorkBuddy } from './prepare-workbuddy.mjs';
import { prepareSharedLogin } from './prepare-shared-login.mjs';
import { prepareStartupResolution } from './prepare-startup-resolution.mjs';
// Explicitly invoked only for runtime integration and packaging.
for (const name of ['host.mjs', 'import.mjs']) await copyFile('tests/fixtures/legacy-runtime/' + name, 'runtime/' + name);
await prepareWorkBuddy('runtime');
await prepareSharedLogin('runtime');
await prepareStartupResolution('runtime');
