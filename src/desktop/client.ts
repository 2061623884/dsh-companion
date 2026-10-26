import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';
import { readFile } from 'node:fs/promises';

export const desktopDownloadUrl = 'https://www.deepseek.com/harness/';
export interface DesktopAddress { pid: number; port: number }
export interface DesktopDiscovery { executable: string | null; version: string | null; candidates: DesktopAddress[] }
export type DesktopErrorCode = 'DSH_DESKTOP_NOT_INSTALLED' | 'DSH_DESKTOP_NOT_RUNNING' | 'DSH_DESKTOP_NOT_READY' | 'DSH_DESKTOP_MULTIPLE' | 'DSH_DESKTOP_CAPABILITIES_INVALID';
export class DesktopError extends Error {
  constructor(readonly code: DesktopErrorCode, message: string) { super(message); }
}
export function desktopHome(): string { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); }

/** Discover the installed application and listeners owned by its Desktop Host. */
export async function discoverDesktop(): Promise<DesktopDiscovery> {
  if (process.platform !== 'win32') throw new Error('桌面连接目前支持 Windows 本机工作区');
  const script = `
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'")
$hosts = @($processes | Where-Object { $_.CommandLine -match '[\\\\/]@deepseek-ai[\\\\/]dsh-desktop-host[\\\\/]lib[\\\\/]index\\.js' })
$executable = $processes | Where-Object { $_.ExecutablePath } | Select-Object -First 1 -ExpandProperty ExecutablePath
if (-not $executable) {
  $records = @(foreach ($key in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) { if (Test-Path -LiteralPath $key) { Get-ChildItem -LiteralPath $key | Get-ItemProperty | Where-Object { $_.DisplayName -match '^DeepSeek Harness' } } })
  $paths = @($records | Where-Object { $_.InstallLocation } | ForEach-Object { Join-Path $_.InstallLocation 'DeepSeek Harness.exe' })
  $paths += @($records | Where-Object { $_.DisplayIcon } | ForEach-Object { ($_.DisplayIcon -replace ',\\d+$','').Trim('"') })
  $paths += @((Join-Path $env:LOCALAPPDATA 'Programs\\DeepSeek Harness\\DeepSeek Harness.exe'), (Join-Path $env:ProgramFiles 'DeepSeek Harness\\DeepSeek Harness.exe'))
  $executable = $paths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
$listeners = if ($hosts.Count) { @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $hosts.ProcessId -and $_.LocalAddress -eq '127.0.0.1' }) } else { @() }
ConvertTo-Json -Compress -InputObject @{ executable = $(if ($executable) { [string]$executable } else { $null }); version = $(if ($executable) { [Diagnostics.FileVersionInfo]::GetVersionInfo($executable).FileVersion } else { $null }); candidates = @($listeners | ForEach-Object { @{ pid = $_.OwningProcess; port = $_.LocalPort } }) }
`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 15000, encoding: 'utf8' });
  const value = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  if (!value || (value.executable !== null && (typeof value.executable !== 'string' || !path.isAbsolute(value.executable))) ||
    (value.version !== null && typeof value.version !== 'string') || !Array.isArray(value.candidates) || value.candidates.some((row: DesktopAddress) => !Number.isInteger(row.pid) || row.pid <= 0 || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535)) {
    throw new Error('桌面端发现结果无效');
  }
  return value;
}

/** Capabilities are shipped with Desktop; their contents never supply a command or arguments. */
async function supportsBackgroundStart(executable: string): Promise<boolean> {
  let contents: string;
  try { contents = await readFile(path.join(path.dirname(executable), 'resources', 'dsh-companion-capabilities.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new DesktopError('DSH_DESKTOP_CAPABILITIES_INVALID', '无法读取桌面端后台启动能力，请检查桌面端安装后重试。');
  }
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch { throw new DesktopError('DSH_DESKTOP_CAPABILITIES_INVALID', '桌面端后台启动能力文件无效，请检查桌面端安装后重试。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('schema' in value) || !Number.isSafeInteger(value.schema)) {
    throw new DesktopError('DSH_DESKTOP_CAPABILITIES_INVALID', '桌面端后台启动能力格式无效，请检查桌面端安装后重试。');
  }
  if (value.schema !== 1) return false;
  if (!('backgroundStart' in value) || typeof value.backgroundStart !== 'boolean') {
    throw new DesktopError('DSH_DESKTOP_CAPABILITIES_INVALID', '桌面端后台启动能力格式无效，请检查桌面端安装后重试。');
  }
  return value.backgroundStart;
}

async function launchDesktop(executable: string, background: boolean): Promise<void> {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, background ? ['--background'] : [],
    { detached: true, stdio: 'ignore', windowsHide: background, env: environment });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (error: NodeJS.ErrnoException) => {
      const code = error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'LAUNCH_FAILED';
      reject(new DesktopError('DSH_DESKTOP_NOT_RUNNING', `无法启动桌面端 (${code})，请打开桌面端后重新连接。`));
    });
  });
  child.unref();
}

/** Desktop remains the only Host owner, including when its supported background mode starts it. */
export class DesktopClient {
  private finding: Promise<DesktopAddress[]> | null = null;
  constructor(private readonly discover = discoverDesktop, private readonly launch = launchDesktop) {}

  addresses(startIfStopped = true): Promise<DesktopAddress[]> {
    if (!startIfStopped) return this.findAddresses(false);
    return this.finding ??= this.findAddresses(true).finally(() => { this.finding = null; });
  }

  private async findAddresses(startIfStopped: boolean): Promise<DesktopAddress[]> {
    const desktop = await this.discover();
    if (desktop.candidates.length) return desktop.candidates;
    if (!desktop.executable) throw new DesktopError('DSH_DESKTOP_NOT_INSTALLED', '请先安装 DeepSeek Harness 桌面端。');
    if (!startIfStopped || !await supportsBackgroundStart(desktop.executable)) {
      throw new DesktopError('DSH_DESKTOP_NOT_RUNNING', 'DeepSeek Harness 桌面端尚未运行，请打开桌面端后连接。');
    }
    await this.launch(desktop.executable, true);
    const deadline = Date.now() + 45000;
    do {
      // Concurrent VS Code windows converge through Desktop's own single-instance lock.
      const current = await this.discover();
      if (current.candidates.length) return current.candidates;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new DesktopError('DSH_DESKTOP_NOT_RUNNING', '桌面后台启动超时，请打开桌面端检查登录或启动状态后重新连接。');
  }

  async open(): Promise<void> {
    const desktop = await this.discover();
    if (!desktop.executable) throw new DesktopError('DSH_DESKTOP_NOT_INSTALLED', '请先安装 DeepSeek Harness 桌面端。');
    await this.launch(desktop.executable, false);
  }
}
