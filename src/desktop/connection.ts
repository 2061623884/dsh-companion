import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { Duplex } from 'node:stream';
import { load, JSON_SCHEMA, YAMLException } from 'js-yaml';
import { DesktopClient, DesktopError, DesktopAddress, desktopHome } from './client';

interface Options {
  credentialsPath?: string;
  desktopHome?: string;
  acquire?: (startIfStopped: boolean) => Promise<DesktopAddress | DesktopAddress[]>;
  onUnavailable?: (error: DesktopError) => void;
  assetsDirectory: string;
}
interface Target { url: URL; secret: Buffer; pid: number }
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/** A stable loopback endpoint; a healthy request never performs runtime discovery. */
export class DesktopConnection {
  private target: Target | null = null;
  private finding: Promise<Target> | null = null;
  private findingStartsDesktop = false;
  private starting: Promise<string> | null = null;
  private server: http.Server | null = null;
  private baseUrl = '';
  private closed = false;
  private readonly sockets = new Set<Duplex>();
  private readonly checking = new Map<Target, AbortController>();
  private readonly acquire: (startIfStopped: boolean) => Promise<DesktopAddress[]>;
  private readonly desktop = new DesktopClient();
  private readonly credentialsPath: string;
  constructor(private readonly options: Options) {
    this.acquire = options.acquire ? async startIfStopped => {
      const value = await options.acquire!(startIfStopped);
      return Array.isArray(value) ? value : [value];
    } : startIfStopped => this.desktop.addresses(startIfStopped);
    this.credentialsPath = options.credentialsPath || path.join(options.desktopHome || desktopHome(), '.credentials.yaml');
  }

  openDesktop(): Promise<void> { return this.desktop.open(); }

  start(): Promise<string> {
    if (this.closed) return Promise.reject(new Error('DSH 连接已释放'));
    if (this.starting) return this.starting;
    this.starting = this.listen().catch(error => { this.starting = null; throw error; });
    return this.starting;
  }

  async reconnect(options: { startDesktop?: boolean } = {}): Promise<string> {
    this.target = null;
    await this.ensureTarget(options.startDesktop ?? true);
    return this.start();
  }

  private async listen(): Promise<string> {
    await this.ensureTarget(true);
    if (this.closed) throw new Error('DSH 连接已释放');
    const server = http.createServer((request, response) => {
      this.forward(request, response).catch(error => {
        if (response.headersSent) response.destroy(error);
        else { response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); response.end(error.message); }
      });
    });
    this.server = server;
    server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    server.on('upgrade', (request, socket, head) => {
      this.upgrade(request, socket, head).catch(error => {
        const code = (error as NodeJS.ErrnoException).code || error.name;
        socket.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nDSH connection unavailable (${code})`);
      });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    if (this.closed) { await new Promise<void>(resolve => server.close(() => resolve())); throw new Error('DSH 连接已释放'); }
    const address = server.address() as import('node:net').AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  private ensureTarget(startIfStopped = false): Promise<Target> {
    if (this.closed) return Promise.reject(new Error('DSH 连接已释放'));
    if (this.target) return Promise.resolve(this.target);
    if (this.finding) {
      // A user request may arrive while a read-only rediscovery is in flight.
      // Retry that one expected absence with its explicit start authorization.
      if (startIfStopped && !this.findingStartsDesktop) return this.finding.catch(error => {
        if ((error as DesktopError).code === 'DSH_DESKTOP_NOT_RUNNING') return this.ensureTarget(true);
        throw error;
      });
      return this.finding;
    }
    this.findingStartsDesktop = startIfStopped;
    this.finding = this.findTarget(startIfStopped).then(target => { this.target = target; return target; }, error => {
      if (error instanceof DesktopError) this.options.onUnavailable?.(error);
      throw error;
    }).finally(() => { this.finding = null; });
    return this.finding;
  }

  /** A failed transport belongs to one target; late closes cannot invalidate its replacement. */
  private unavailable(target: Target, code: string): void {
    if (this.closed || this.target !== target) return;
    this.target = null;
    this.options.onUnavailable?.(new DesktopError('DSH_DESKTOP_NOT_READY', `桌面连接已中断 (${code})，正在重新连接。`));
  }

  private transportCode(error: unknown): string {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code && ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED', 'ENETUNREACH', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code)
      ? code : 'TRANSPORT_ERROR';
  }

  private probe(target: Target, signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const failed = (error: Error) => {
        if (this.transportCode(error) === 'TRANSPORT_ERROR') reject(error);
        else resolve(false);
      };
      const request = http.get(target.url, { signal, headers: { cookie: this.cookie(target, target.url.host) } }, response => {
        let html = '';
        response.setEncoding('utf8'); response.on('data', chunk => { html += chunk; });
        response.on('end', () => resolve(response.statusCode === 200 && html.includes('__ModuleLoader__')));
        response.on('error', failed);
      });
      request.on('error', failed);
      const deadline = setTimeout(() => request.destroy(Object.assign(new Error('运行时端口探测超时'), { code: 'ETIMEDOUT' })), 3000);
      request.once('close', () => clearTimeout(deadline));
    });
  }

  /** A normal WebSocket close can end at the Host first; verify the owner before declaring an outage. */
  private checkAfterStreamClose(target: Target): void {
    if (this.closed || this.target !== target || this.checking.has(target)) return;
    const controller = new AbortController();
    this.checking.set(target, controller);
    void this.probe(target, controller.signal).then(valid => {
      if (!valid) this.unavailable(target, 'EVENT_STREAM_CLOSED');
    }, () => {
      if (!controller.signal.aborted) this.unavailable(target, 'HOST_PROBE_ERROR');
    }).finally(() => { this.checking.delete(target); });
  }

  private async findTarget(startIfStopped: boolean): Promise<Target> {
    const candidates = await this.acquire(startIfStopped);
    let text: string;
    try { text = await fs.readFile(this.credentialsPath, 'utf8'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new DesktopError('DSH_DESKTOP_NOT_READY', '桌面端正在准备本机连接认证，请稍后重试。');
      if (!code) throw error;
      throw new Error(`无法读取运行时认证文件 (${code})`);
    }
    let credentials: unknown;
    try { credentials = load(text, { schema: JSON_SCHEMA }); }
    catch (error) { if (error instanceof YAMLException) throw new Error('运行时认证文件格式无效 (CREDENTIAL_PARSE)'); throw error; }
    const record = (credentials as { records?: Record<string, { kind?: string; payload?: { version?: number; secret?: string } }> })?.records?.['client-connection/browser-session'];
    const secret = record?.payload?.secret;
    if (record?.kind !== 'grant' || record.payload?.version !== 1 || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new Error('运行时浏览器认证记录无效 (CREDENTIAL_SCHEMA)');
    }
    const matches: Target[] = [];
    for (const candidate of candidates) {
      const target = { url: new URL(`http://127.0.0.1:${candidate.port}`), pid: candidate.pid, secret: Buffer.from(secret, 'base64url') };
      const valid = await this.probe(target);
      if (valid) matches.push(target);
    }
    if (matches.length > 1) throw new DesktopError('DSH_DESKTOP_MULTIPLE', '发现多个桌面后台，请保留需要连接的桌面实例后重试。');
    if (!matches.length) throw new DesktopError('DSH_DESKTOP_NOT_READY', '桌面端尚未就绪或本机连接认证失败，请稍后重新连接。');
    return matches[0];
  }

  private cookie(target: Target, authority: string): string {
    // A receiver may observe an older clock tick. Keep the signed lifetime at
    // five minutes while avoiding a freshly signed cookie dated in its future.
    const now = Date.now() - 1000;
    const body = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 300000 })).toString('base64url');
    return `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}=v1.${body}.${createHmac('sha256', target.secret).update(body).digest('base64url')}`;
  }

  private authorize(request: http.IncomingMessage): string {
    const own = new URL(this.baseUrl);
    const authority = request.headers.host;
    if (authority !== own.host && authority !== `localhost:${own.port}`) throw new Error('无效的本机代理 Host');
    if (request.headers.origin && request.headers.origin !== `http://${authority}`) throw new Error('拒绝跨来源访问本机代理');
    return authority;
  }

  private headers(request: http.IncomingMessage, target: Target, authority: string, websocket = false): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...request.headers, host: authority, cookie: this.cookie(target, authority) };
    if (!websocket) for (const key of hopHeaders) delete headers[key];
    headers['accept-encoding'] = 'identity';
    return headers;
  }

  private async forward(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const authority = this.authorize(request);
    const requested = new URL(request.url!, this.baseUrl);
    const assets: Record<string, string> = { '/__dsh_companion/bootstrap.js': 'bootstrap.js', '/__dsh_companion/sidebar.js': 'sidebar.js', '/__dsh_companion/sidebar.css': 'sidebar.css' };
    const asset = assets[requested.pathname];
    if (asset) {
      const data = await fs.readFile(path.join(this.options.assetsDirectory, asset));
      response.writeHead(200, { 'content-type': asset.endsWith('.css') ? 'text/css' : 'application/javascript', 'cache-control': 'no-store' }); response.end(data); return;
    }
    const target = await this.ensureTarget();
    await new Promise<void>((resolve, reject) => {
      let cancelled = false;
      const failed = (error: Error) => {
        const code = this.transportCode(error);
        if (!cancelled) this.unavailable(target, code);
        reject(new Error(`运行时连接失败 (${code})，请重新连接`));
      };
      const upstream = http.request({ hostname: target.url.hostname, port: target.url.port, path: request.url, method: request.method,
        headers: this.headers(request, target, authority) }, incoming => {
        if (incoming.statusCode === 401 && !cancelled) this.unavailable(target, 'HTTP_401');
        const headers = { ...incoming.headers }; delete headers['set-cookie'];
        for (const key of hopHeaders) delete headers[key];
        if (requested.pathname === '/' && requested.searchParams.has('dsh-companion') && incoming.statusCode === 200) {
          const chunks: Buffer[] = [];
          incoming.on('data', chunk => chunks.push(chunk));
          incoming.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf8');
            const marker = '<script>(globalThis.__DSH_BOOT_READY__';
            if (!html.includes(marker)) { reject(new Error('桌面端界面接口与插件不兼容，请更新 DSH Companion 后重新连接。')); return; }
            delete headers['content-length']; delete headers.etag;
            headers['cache-control'] = 'no-store';
            response.writeHead(200, headers); response.end(html.replace(marker, '<script src="/__dsh_companion/bootstrap.js"></script>' + marker)); resolve();
          });
        } else {
          response.writeHead(incoming.statusCode!, headers); incoming.pipe(response); incoming.on('end', resolve);
        }
        incoming.on('error', failed);
      });
      upstream.on('error', failed);
      const cancel = () => { cancelled = true; upstream.destroy(); resolve(); };
      request.on('aborted', cancel);
      response.on('close', () => { if (!response.writableEnded) cancel(); });
      request.pipe(upstream);
    });
  }

  private async upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const authority = this.authorize(request), target = await this.ensureTarget();
    if (socket.destroyed) return;
    let cancelled = false;
    const upstream = http.request({ hostname: target.url.hostname, port: target.url.port, path: request.url, method: request.method,
      headers: this.headers(request, target, authority, true) });
    const cancel = () => { cancelled = true; upstream.destroy(); };
    socket.on('end', cancel); socket.on('close', cancel); socket.on('error', cancel);
    upstream.on('upgrade', (incoming, peer, initial) => {
      if (cancelled || socket.destroyed) { peer.destroy(); return; }
      const headers = Object.entries(incoming.headers).filter(([key]) => key !== 'set-cookie').flatMap(([key, value]) =>
        Array.isArray(value) ? value.map(item => `${key}: ${item}`) : [`${key}: ${value}`]);
      socket.write(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (initial.length) socket.write(initial);
      if (head.length) peer.write(head);
      const lost = (code?: string) => {
        if (!cancelled) {
          if (code) this.unavailable(target, code);
          else this.checkAfterStreamClose(target);
        }
        socket.destroy();
      };
      peer.on('end', () => lost());
      peer.on('error', error => lost(this.transportCode(error)));
      peer.on('close', () => lost());
      socket.on('end', () => peer.destroy());
      socket.on('error', () => peer.destroy()); socket.on('close', () => peer.destroy());
      peer.pipe(socket); socket.pipe(peer);
    });
    upstream.on('response', incoming => { if (incoming.statusCode === 401 && !cancelled) this.unavailable(target, 'HTTP_401'); incoming.resume(); socket.destroy(); });
    upstream.on('error', error => { if (!cancelled) this.unavailable(target, this.transportCode(error)); socket.destroy(); });
    upstream.end();
  }

  async dispose(): Promise<void> {
    this.closed = true; this.target = null;
    for (const controller of this.checking.values()) controller.abort();
    this.checking.clear();
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>((resolve, reject) => this.server!.close(error => error ? reject(error) : resolve()));
    this.server = null;
  }
}
