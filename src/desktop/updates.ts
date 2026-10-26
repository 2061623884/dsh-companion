import { get } from 'node:https';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load, JSON_SCHEMA } from 'js-yaml';
import { gt, valid } from 'semver';
import { discoverDesktop, DesktopDiscovery } from './client';

export const updateCheckInterval = 6 * 60 * 60 * 1000;
export type DesktopUpdate = { state: 'not-installed' } | {
  state: 'available' | 'current'; installed: string; latest: string; channel: 'nightly' | 'latest';
};
interface Options {
  discover?: () => Promise<Pick<DesktopDiscovery, 'executable' | 'version'>>;
  request?: (url: string, signal: AbortSignal) => Promise<string>;
  now?: () => number;
}

/** Use VS Code's HTTPS transport/proxy; only anonymous official feed metadata is requested. */
function requestFeed(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = get(url, { signal }, response => {
      response.on('error', reject);
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`官方更新源暂不可用 (HTTP ${response.statusCode})`)); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) { request.destroy(new Error('官方更新信息超过大小限制')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', reject);
  });
}

/** Read-only update checks: no runtime installation, credentials or session access. */
export class DesktopUpdates {
  private pending: Promise<DesktopUpdate> | undefined;
  private controller: AbortController | undefined;
  private cached: DesktopUpdate | undefined;
  private checkedAt = -Infinity;
  private disposed = false;
  constructor(private readonly options: Options = {}) {}

  check(manual = false): Promise<DesktopUpdate> {
    if (this.disposed) return Promise.reject(new Error('更新检查已关闭'));
    if (this.pending) return this.pending;
    if (!manual && this.cached && (this.options.now ?? Date.now)() - this.checkedAt < updateCheckInterval) return Promise.resolve(this.cached);
    const controller = new AbortController();
    this.controller = controller;
    const deadline = setTimeout(() => controller.abort(), 10000);
    this.pending = this.inspect(controller.signal).then(result => {
      this.cached = result; this.checkedAt = (this.options.now ?? Date.now)(); return result;
    }).finally(() => { clearTimeout(deadline); this.pending = undefined; this.controller = undefined; });
    return this.pending;
  }

  private async inspect(signal: AbortSignal): Promise<DesktopUpdate> {
    const installation = await (this.options.discover ?? discoverDesktop)();
    if (!installation.executable) return { state: 'not-installed' };
    if (!installation.version || !valid(installation.version)) throw new Error('无法识别已安装的桌面端版本，请在桌面端检查更新');
    let channel: 'nightly' | 'latest' = 'nightly';
    let configuration: string | undefined;
    try { configuration = await readFile(join(dirname(installation.executable), 'resources', 'app-update.yml'), { encoding: 'utf8', signal }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (configuration !== undefined) {
      const value = load(configuration, { schema: JSON_SCHEMA }) as { channel?: unknown } | undefined;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('桌面端更新配置无效，请在桌面端检查更新');
      if (value.channel !== undefined) {
        if (value.channel !== 'nightly' && value.channel !== 'latest') throw new Error('桌面端更新渠道无法识别，请在桌面端检查更新');
        channel = value.channel;
      }
    }
    const body = await (this.options.request ?? requestFeed)(`https://download.deepseek.com/dsh-desk/feeds/win-x64/${channel}.yml`, signal);
    const value = load(body, { schema: JSON_SCHEMA }) as { version?: unknown } | undefined;
    if (typeof value?.version !== 'string' || !valid(value.version)) throw new Error('官方更新信息缺少有效版本号');
    return { state: gt(value.version, installation.version) ? 'available' : 'current', installed: installation.version, latest: value.version, channel };
  }

  dispose(): void { this.disposed = true; this.controller?.abort(); }
}
