import * as fs from 'node:fs/promises';
import path from 'node:path';
import { load, dump, JSON_SCHEMA } from 'js-yaml';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

/** @param {string} file */
async function exists(file) {
  try { await fs.access(file); return true; }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false; throw error; }
}
/** @type {Record<string, string[]>} */
const modelFields = {
  '@deepseek-ai/dsh-llm-pi-ai': ['providers'],
  '@deepseek-ai/dsh-agent-default-model': ['provider', 'model'],
  '@deepseek-ai/dsh-tool-subagent/model-selection-settings': ['enabled', 'allowedModels'],
};

/**
 * @param {string} source @param {string} target
 * @param {import('./contracts.js').MigrationReport} report
 * @param {Set<string>} [onlyIds] @param {AbortSignal} [signal]
 */
async function copyHistory(source, target, report, onlyIds, signal) {
  signal?.throwIfAborted();
  const root = path.join(source, 'sessions');
  if (!await exists(root)) {
    if (onlyIds) for (const id of onlyIds) report.skipped.push({ id, code: 'SOURCE_SESSION_MISSING' });
    return;
  }
  const require = createRequire(import.meta.url);
  const base = createRequire(require.resolve('@deepseek-ai/dsh-base'));
  const { Context } = await import('@deepseek-ai/cordis');
  const persistence = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href);
  const { SessionPersistenceCorruptionError, SessionFormatUnsupportedError, SessionPersistenceNotFoundError } =
    /** @type {import('./contracts.js').PersistenceErrors} */ (await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-session-persistence')).href));
  const attachments = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-attachment-local')).href);
  const context = new Context();
  try {
    await context.plugin(persistence, { root, compression: 'zstd' }).await();
    await context.plugin(attachments.default, { dshHome: source }).await();
    const storage = context.sessionPersistence;
    const found = new Set();
    for (const snapshot of await storage.list()) {
      signal?.throwIfAborted();
      const id = snapshot.header.id;
      if (onlyIds && !onlyIds.has(id)) continue;
      found.add(id);
      const item = { id, code: '' };
      let handle;
      try {
        handle = await storage.open(id, 'read');
        const { events } = await handle.read();
        // Only durable pending-input counts and turn boundaries are needed here.
        const queued = { 'next-turn': 0, 'next-step': 0 };
        let openTurn = false;
        for (const event of events) {
          if (event.type === 'turn/start') openTurn = true;
          if (event.type === 'turn/end') openTurn = false;
          if (event.type === 'agent/inbox/spliced') {
            const data = /** @type {{target: 'next-turn' | 'next-step', inserted: unknown[], removedCount?: number}} */ (event.data);
            queued[data.target] += data.inserted.length - (data.removedCount ?? 0);
          }
        }
        if (openTurn || queued['next-turn'] || queued['next-step']) { item.code = 'PENDING_OR_INTERRUPTED'; continue; }
        const originalDir = path.dirname(storage.locate(snapshot.header).path);
        const relative = path.relative(root, originalDir);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid session path');
        const destination = path.join(target, 'sessions', relative);
        if (await exists(destination)) { item.code = 'DESTINATION_EXISTS'; continue; }
        /** @type {[string, Buffer][]} */
        const files = [];
        for (const file of await fs.readdir(originalDir, { withFileTypes: true })) {
          if (!file.isFile() || !/^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(file.name)) continue;
          files.push([file.name, await fs.readFile(path.join(originalDir, file.name))]);
        }
        if ((await storage.stat(id)).revision !== snapshot.revision) { item.code = 'SOURCE_CHANGED'; continue; }
        await copyReferencedAttachments(events, source, target, report, context.attachments, signal);
        await fs.mkdir(target, { recursive: true });
        const temporary = await fs.mkdtemp(path.join(target, '.session-import-'));
        let committed = false;
        try {
          for (const [name, content] of files) await fs.writeFile(path.join(temporary, name), content);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          signal?.throwIfAborted();
          await fs.rename(temporary, destination); committed = true;
        } finally {
          if (!committed && path.dirname(temporary) === path.resolve(target)) await fs.rm(temporary, { recursive: true });
        }
        report.historyFiles += files.length; report.historySessions++;
      } catch (error) {
        const failure = /** @type {NodeJS.ErrnoException} */ (error);
        if (!(error instanceof SessionPersistenceCorruptionError || error instanceof SessionFormatUnsupportedError || error instanceof SessionPersistenceNotFoundError || failure.code === 'ENOENT' || failure.code === 'DSH_IMPORT_ATTACHMENT_INVALID')) throw error;
        item.code = failure.code === 'DSH_IMPORT_ATTACHMENT_INVALID' || failure.code === 'ENOENT' ? 'ATTACHMENT_OR_LOG_UNAVAILABLE' : 'INVALID_SESSION_LOG';
      } finally {
        await handle?.close();
        if (item.code) report.skipped.push(item);
      }
    }
    if (onlyIds) for (const id of onlyIds) if (!found.has(id)) report.skipped.push({ id, code: 'SOURCE_SESSION_MISSING' });
  } finally { await context.fiber.dispose(); }
}

/**
 * @param {import('./contracts.js').PersistedEvent[]} events @param {string} source @param {string} target
 * @param {import('./contracts.js').MigrationReport} report @param {import('./contracts.js').AttachmentStore} store
 * @param {AbortSignal} [signal]
 */
async function copyReferencedAttachments(events, source, target, report, store, signal) {
  /** @type {import('./contracts.js').AttachmentReference[]} */
  const refs = [];
  /** @param {unknown} value */
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if ('attachmentId' in value && typeof value.attachmentId === 'string') refs.push(/** @type {import('./contracts.js').AttachmentReference} */ (value));
    else for (const child of Object.values(value)) collect(child);
  }
  collect(events);
  const root = path.join(source, 'attachments/v1');
  for (const ref of refs) {
    signal?.throwIfAborted();
    const original = ref.mediaType ? store.imageHostPath(ref) : store.fileHostPath(ref);
    const relative = path.relative(root, original);
    const destination = path.join(target, 'attachments/v1', relative);
    if (await exists(destination)) {
      const existing = await fs.readFile(destination);
      if (ref.attachmentId === 'sha256:' + createHash('sha256').update(existing).digest('hex')) continue;
    }
    const content = await fs.readFile(original);
    if (ref.attachmentId !== 'sha256:' + createHash('sha256').update(content).digest('hex')) {
      throw Object.assign(new Error('Invalid source attachment'), { code: 'DSH_IMPORT_ATTACHMENT_INVALID' });
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + '.import-' + randomUUID();
    let committed = false;
    try {
      await fs.writeFile(temporary, content, { flag: 'wx' });
      signal?.throwIfAborted();
      await fs.rename(temporary, destination); committed = true;
    } finally {
      if (!committed) await fs.rm(temporary, { force: true });
    }
    report.attachmentFiles++;
  }
}

/** One atomic first-use snapshot. No desktop file is opened for writing.
 * @param {string} source @param {string} home @param {AbortSignal} [signal]
 */
export async function importDesktopData(source, home, signal) {
  signal?.throwIfAborted();
  const marker = path.join(home, 'migration.json');
  if (await exists(marker)) {
    /** @type {import('./contracts.js').MigrationReport} */
    let report;
    const text = await fs.readFile(marker, 'utf8');
    try { report = JSON.parse(text); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw Object.assign(new Error('迁移记录损坏；现有数据已保留。请从备份恢复 migration.json，不要删除已有数据目录。'), { code: 'DSH_IMPORT_MARKER_INVALID' });
    }
    if (!report || report.version !== 1 || !Array.isArray(report.skipped) ||
      !report.skipped.every(item => item && typeof item.id === 'string' && typeof item.code === 'string')) {
      throw Object.assign(new Error('迁移记录格式无效；现有数据已保留。请从备份恢复 migration.json。'), { code: 'DSH_IMPORT_MARKER_INVALID' });
    }
    const retry = new Set(report.skipped.filter(item => item.id && item.code !== 'DESTINATION_EXISTS').map(item => item.id));
    if (retry.size) {
      report.skipped = report.skipped.filter(item => !retry.has(item.id));
      await copyHistory(source, home, report, retry, signal);
      const temporary = marker + '.import-' + randomUUID();
      let committed = false;
      try {
        await fs.writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx' });
        signal?.throwIfAborted();
        await fs.rename(temporary, marker); committed = true;
      } finally {
        if (!committed) await fs.rm(temporary, { force: true });
      }
    }
    return report;
  }
  if (await exists(home)) throw Object.assign(new Error('Import destination already exists'), { code: 'DSH_IMPORT_DESTINATION_NOT_EMPTY' });
  const staging = home + '.importing';
  for (const directory of [home, staging]) {
    const relative = path.relative(source, directory);
    const reverse = path.relative(directory, source);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) ||
      (!reverse.startsWith('..' + path.sep) && reverse !== '..' && !path.isAbsolute(reverse))) {
      throw Object.assign(new Error('Source and destination overlap'), { code: 'DSH_IMPORT_OVERLAP' });
    }
  }
  if (await exists(staging)) {
    if ((await fs.lstat(staging)).isSymbolicLink()) throw Object.assign(new Error('Import staging is a link'), { code: 'DSH_IMPORT_STAGING_LINK' });
    // Only the exact sibling staging directory created by this importer is removed.
    await fs.rm(staging, { recursive: true });
  }
  const profile = path.join(staging, 'profiles/companion');
  await fs.mkdir(profile, { recursive: true });
  const report = { version: 1, sourceFound: await exists(source), historyFiles: 0, historySessions: 0, attachmentFiles: 0, skipped: [] };
  const patches = [];
  for (const file of [path.join(source, 'profiles/desktop/cordis.patch.yml'), path.join(source, 'cordis.patch.yml')]) {
    signal?.throwIfAborted();
    if (!await exists(file)) continue;
    const rows = load(await fs.readFile(file, 'utf8'), { schema: JSON_SCHEMA });
    if (!Array.isArray(rows)) throw Object.assign(new Error('Invalid source patch'), { code: 'DSH_IMPORT_PATCH_SCHEMA' });
    for (const row of rows) if (row && modelFields[row.name] && row.id && row.config) {
      patches.push({ id: row.id, name: row.name, config: Object.fromEntries(modelFields[row.name].filter(key => key in row.config).map(key => [key, row.config[key]])) });
    }
  }
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'dsh-companion-profile', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-workbuddy-connect'] } } }, null, 2));
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'), dump(patches));
  const credentials = path.join(source, '.credentials.yaml');
  if (await exists(credentials)) {
    const document = /** @type {{version?: number, records?: Record<string, {kind?: string}>, refs?: Record<string, string>}} */
      (load(await fs.readFile(credentials, 'utf8'), { schema: JSON_SCHEMA }));
    if (!document || typeof document !== 'object' || document.version !== 1) throw Object.assign(new Error('Invalid source credentials'), { code: 'DSH_IMPORT_CREDENTIAL_SCHEMA' });
    const records = Object.fromEntries(Object.entries(document.records || {}).filter(([, record]) => record?.kind === 'api-key'));
    await fs.writeFile(path.join(staging, '.credentials.yaml'), dump({ version: 1, refs: document.refs || {}, records }), { mode: 0o600 });
  }
  const wb = path.join(source, 'profiles/desktop/.dsh-workbuddy-connect/settings.json');
  const settings = await exists(wb) ? JSON.parse(await fs.readFile(wb, 'utf8')) : {};
  const preferences = Object.fromEntries(['disabledModelsCN', 'disabledModelsAI', 'useMaximumContextWindow'].filter(key => key in settings).map(key => [key, settings[key]]));
  await fs.mkdir(path.join(profile, '.dsh-workbuddy-connect'));
  await fs.writeFile(path.join(profile, '.dsh-workbuddy-connect/settings.json'), JSON.stringify({ ...preferences, autoCheckInCN: false, autoCheckInAI: false }));
  await copyHistory(source, staging, report, undefined, signal);
  await fs.writeFile(path.join(staging, 'migration.json'), JSON.stringify(report, null, 2));
  signal?.throwIfAborted();
  await fs.rename(staging, home);
  return report;
}
