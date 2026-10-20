import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';

export interface RuntimeAddress { pid: number; port: number }
interface RuntimeFailure { stage: string; code: string; errorName?: string; frames?: string[]; pid?: number; version?: string }
function failureOf(message: RuntimeFailure): Error {
  const description = message.code === 'DSH_RUNTIME_VERSION_IN_USE'
    ? '其他 VS Code 窗口仍在使用旧版 DSH 后台，请重新加载这些窗口后重试'
    : `DSH ${message.stage}失败`;
  const failure = new Error(`${description} (${message.code}, ${message.errorName || 'RuntimeError'})`);
  failure.stack = failure.message + '\n' + (message.frames || []).join('\n');
  return failure;
}
export class RuntimeClient {
  private socket: net.Socket | undefined;
  private ready: RuntimeAddress | undefined;
  private pending: Promise<RuntimeAddress> | undefined;
  private closed = false;
  constructor(private readonly directory: string, private readonly home: string,
    private readonly sourceHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {}

  acquire(): Promise<RuntimeAddress> {
    if (this.closed) return Promise.reject(new Error('DSH 运行连接已释放'));
    if (this.ready) return Promise.resolve(this.ready);
    return this.pending ??= this.connect().finally(() => { this.pending = undefined; });
  }

  private async connect(): Promise<RuntimeAddress> {
    // VS Code URI paths can use a lowercase drive letter. DSH's package routing
    // and Node must use one physical path to share module-scoped boot state.
    const directory = await realpath(this.directory);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const identity = createHash('sha256').update(path.resolve(this.home).toLowerCase()).digest('hex').slice(0, 32);
    const pipe = `\\\\.\\pipe\\dsh-companion-${identity}`;
    let launched = false;
    let childFailure: Promise<Error> | undefined;
    const deadline = Date.now() + 120000;
    while (!this.closed) {
      if (childFailure) throw await childFailure;
      try {
        return await new Promise<RuntimeAddress>((resolve, reject) => {
          const socket = net.connect(pipe);
          this.socket = socket;
          let buffer = '', settled = false;
          socket.setTimeout(Math.max(1, deadline - Date.now()), () => socket.destroy(Object.assign(new Error('DSH 运行时启动超时'), { code: 'DSH_RUNTIME_TIMEOUT' })));
          socket.on('connect', () => socket.write(JSON.stringify({ type: 'attach', version: manifest.version }) + '\n'));
          socket.on('error', reject);
          socket.on('close', () => {
            if (this.socket === socket) { this.ready = undefined; this.socket = undefined; }
            if (!settled) reject(Object.assign(new Error('DSH 控制连接已关闭'), { code: 'DSH_CONTROL_CLOSED' }));
          });
          socket.on('data', chunk => {
            buffer += chunk.toString();
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
              let message;
              try { message = JSON.parse(line); }
              catch { socket.destroy(Object.assign(new Error('DSH 控制协议无效'), { code: 'DSH_CONTROL_PROTOCOL' })); return; }
              if (message.type === 'error') {
                settled = true; socket.destroy();
                reject(failureOf(message)); return;
              }
              if (message.type === 'stopping') {
                settled = true; socket.destroy();
                reject(Object.assign(new Error('DSH 后台正在保存退出'), { code: 'DSH_RUNTIME_STOPPING' })); return;
              }
              if (message.type === 'ready') {
                if (message.version !== manifest.version || !Number.isInteger(message.pid) || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
                  socket.destroy(Object.assign(new Error('DSH 就绪记录无效'), { code: 'DSH_CONTROL_PROTOCOL' })); return;
                }
                socket.setTimeout(0); settled = true;
                this.ready = { pid: message.pid, port: message.port }; resolve(this.ready);
              }
            }
          });
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ECONNREFUSED' && code !== 'DSH_RUNTIME_STOPPING' && code !== 'DSH_CONTROL_CLOSED') throw error;
        if (Date.now() >= deadline) throw new Error('DSH 控制入口启动超时 (DSH_RUNTIME_TIMEOUT)');
        if ((code === 'ENOENT' || code === 'ECONNREFUSED') && !launched && !this.closed) {
          const child = spawn(path.join(directory, 'bin', 'node.exe'), ['--expose-internals', path.join(directory, 'host.mjs'), this.home, this.sourceHome],
            { windowsHide: true, detached: true, stdio: 'ignore', cwd: directory });
          await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
          child.once('exit', code => {
            if (code === 0) return;
            childFailure = (async () => {
              let record: RuntimeFailure;
              try { record = JSON.parse(await readFile(path.join(path.dirname(this.home), 'runtime-error.json'), 'utf8')); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return new Error(`DSH 运行进程退出 (${code ?? 'SIGNAL'})`); }
              return record.pid === child.pid && record.version === manifest.version ? failureOf(record) : new Error(`DSH 运行进程退出 (${code ?? 'SIGNAL'})`);
            })();
          });
          child.unref(); launched = true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error('DSH 运行连接已释放');
  }

  dispose(): void { this.closed = true; this.ready = undefined; this.socket?.destroy(); }
}
