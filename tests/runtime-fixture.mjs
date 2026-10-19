import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [runtime, source] = process.argv.slice(2);
const require = createRequire(path.join(runtime, 'package.json'));
const base = createRequire(require.resolve('@deepseek-ai/dsh-base'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
const persistence = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-session-persistence-jsonl')));
const ctx = new Context();
await fs.mkdir(path.join(source, 'profiles/desktop/.dsh-workbuddy-connect'), { recursive: true });
await fs.writeFile(path.join(source, '.credentials.yaml'), JSON.stringify({ version: 1, refs: { FIXTURE_API_KEY: 'fixture-only' }, records: {
  'client-connection/browser-session': { kind: 'grant', payload: { version: 1, secret: 'do-not-import' } },
} }));
await fs.writeFile(path.join(source, 'profiles/desktop/cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'fixture', model: 'fixture', agents: [{ resumeSessionId: 'pending' }] } },
  { id: 'schedule', name: '@deepseek-ai/dsh-schedule', config: { unsafe: true } },
]));
await fs.writeFile(path.join(source, 'profiles/desktop/.dsh-workbuddy-connect/settings.json'), JSON.stringify({ disabledModelsCN: ['fixture'], autoCheckInCN: true, autoCheckInAI: true }));
await fs.writeFile(path.join(source, 'profiles/desktop/.dsh-workbuddy-connect/.workbuddy-auth.json'), 'not-an-importable-token');
await fs.mkdir(path.join(source, 'attachments/v1'), { recursive: true });
await fs.writeFile(path.join(source, 'attachments/v1/fixture'), 'attachment');
try {
  await ctx.plugin(persistence, { root: path.join(source, 'sessions'), compression: 'zstd' }).await();
  for (const id of ['completed', 'pending']) {
    const handle = await ctx.sessionPersistence.create({ id, version: 4, createdAt: Date.now(), cwd: source, isSeeded: false, delegationDepth: 0 });
    if (id === 'pending') await handle.append([{ seq: 0, time: Date.now(), type: 'turn/start', data: { turn: 1 } }]);
    await handle.flush(); await handle.close();
  }
} finally { await ctx.fiber.dispose(); }
console.log('Fixture ready');
