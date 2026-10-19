import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { Duplex } from 'node:stream';
import { load, JSON_SCHEMA, YAMLException } from 'js-yaml';
import { RuntimeClient, RuntimeAddress } from '../runtime/client';

interface Options {
  credentialsPath?: string;
  acquire?: () => Promise<RuntimeAddress>;
  dataHome: string;
  runtimeDirectory: string;
  assetsDirectory: string;
}
interface Target { url: URL; secret: Buffer; pid: number }
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/** A stable loopback endpoint; a healthy request never performs runtime discovery. */
export class RuntimeConnection {
  private target: Target | null = null;
  private finding: Promise<Target> | null = null;
  private starting: Promise<string> | null = null;
  private server: http.Server | null = null;
  private baseUrl = '';
  private closed = false;
  private readonly sockets = new Set<Duplex>();
  private readonly acquire: () => Promise<RuntimeAddress>;
  private readonly runtime: RuntimeClient | undefined;
  private readonly credentialsPath: string;
  constructor(private readonly options: Options) {
    this.runtime = options.acquire ? undefined : new RuntimeClient(options.runtimeDirectory, options.dataHome);
    this.acquire = options.acquire || (() => this.runtime!.acquire());
    this.credentialsPath = options.credentialsPath || path.join(options.dataHome, '.credentials.yaml');
  }

  start(): Promise<string> {
    if (this.closed) return Promise.reject(new Error('DSH 连接已释放'));
    if (this.starting) return this.starting;
    this.starting = this.listen().catch(error => { this.starting = null; throw error; });
    return this.starting;
  }

  async reconnect(): Promise<string> {
    this.target = null;
    await this.ensureTarget();
    return this.start();
  }

  private async listen(): Promise<string> {
    await this.ensureTarget();
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

  private ensureTarget(): Promise<Target> {
    if (this.closed) return Promise.reject(new Error('DSH 连接已释放'));
    if (this.target) return Promise.resolve(this.target);
    if (this.finding) return this.finding;
    this.finding = this.findTarget().then(target => { this.target = target; return target; }).finally(() => { this.finding = null; });
    return this.finding;
  }

  private async findTarget(): Promise<Target> {
    const candidate = await this.acquire();
    let text: string;
    try { text = await fs.readFile(this.credentialsPath, 'utf8'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
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
    {
      const target = { url: new URL(`http://127.0.0.1:${candidate.port}`), pid: candidate.pid, secret: Buffer.from(secret, 'base64url') };
      const valid = await new Promise<boolean>((resolve, reject) => {
        const request = http.get(target.url, { headers: { cookie: this.cookie(target, target.url.host) } }, response => {
          let html = '';
          response.setEncoding('utf8'); response.on('data', chunk => { html += chunk; });
          response.on('end', () => resolve(response.statusCode === 200 && html.includes('__ModuleLoader__')));
          response.on('error', reject);
        });
        request.on('error', reject); request.setTimeout(3000, () => request.destroy(new Error('运行时端口探测超时')));
      });
      if (!valid) throw new Error('DSH 运行时认证失败 (RUNTIME_AUTH_FAILED)');
      return target;
    }
  }

  private cookie(target: Target, authority: string): string {
    const now = Date.now();
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
      const upstream = http.request({ hostname: target.url.hostname, port: target.url.port, path: request.url, method: request.method,
        headers: this.headers(request, target, authority) }, incoming => {
        if (incoming.statusCode === 401 && this.target === target) this.target = null;
        const headers = { ...incoming.headers }; delete headers['set-cookie'];
        for (const key of hopHeaders) delete headers[key];
        if (requested.pathname === '/' && requested.searchParams.has('dsh-companion') && incoming.statusCode === 200) {
          const chunks: Buffer[] = [];
          incoming.on('data', chunk => chunks.push(chunk));
          incoming.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf8');
            const marker = '<script>(globalThis.__DSH_BOOT_READY__';
            if (!html.includes(marker)) { reject(new Error('DSH 前端启动契约不兼容，当前适配版本为 0.2.1-rc.2')); return; }
            delete headers['content-length']; delete headers.etag;
            headers['cache-control'] = 'no-store';
            response.writeHead(200, headers); response.end(html.replace(marker, '<script src="/__dsh_companion/bootstrap.js"></script>' + marker)); resolve();
          });
        } else {
          response.writeHead(incoming.statusCode!, headers); incoming.pipe(response); incoming.on('end', resolve);
        }
        incoming.on('error', reject);
      });
      upstream.on('error', error => { if (this.target === target) this.target = null; reject(new Error(`运行时连接失败 (${(error as NodeJS.ErrnoException).code || 'HTTP_ERROR'})，请重新连接`)); });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
      request.pipe(upstream);
    });
  }

  private async upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const authority = this.authorize(request), target = await this.ensureTarget();
    const upstream = http.request({ hostname: target.url.hostname, port: target.url.port, path: request.url, method: request.method,
      headers: this.headers(request, target, authority, true) });
    upstream.on('upgrade', (incoming, peer, initial) => {
      const headers = Object.entries(incoming.headers).filter(([key]) => key !== 'set-cookie').flatMap(([key, value]) =>
        Array.isArray(value) ? value.map(item => `${key}: ${item}`) : [`${key}: ${value}`]);
      socket.write(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (initial.length) socket.write(initial);
      if (head.length) peer.write(head);
      peer.pipe(socket); socket.pipe(peer);
      peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy()); socket.on('close', () => peer.destroy());
    });
    upstream.on('response', incoming => { if (incoming.statusCode === 401 && this.target === target) this.target = null; incoming.resume(); socket.destroy(); });
    upstream.on('error', () => { if (this.target === target) this.target = null; socket.destroy(); });
    upstream.end();
  }

  async dispose(): Promise<void> {
    this.closed = true; this.target = null; this.runtime?.dispose();
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>((resolve, reject) => this.server!.close(error => error ? reject(error) : resolve()));
    this.server = null;
  }
}
