import path from 'node:path';

// Synthetic receiver clock only; never changes the OS clock or parent process.
if (path.basename(process.argv[1] || '') === 'host.mjs') {
  const now = Date.now;
  Date.now = () => now() - 500;
}
