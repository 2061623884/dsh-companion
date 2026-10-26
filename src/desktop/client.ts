import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';

export const desktopDownloadUrl = 'https://www.deepseek.com/harness/';
export interface DesktopAddress { pid: number; port: number }
export interface DesktopDiscovery { executable: string | null; candidates: DesktopAddress[] }
export type DesktopErrorCode = 'DSH_DESKTOP_NOT_INSTALLED' | 'DSH_DESKTOP_NOT_RUNNING' | 'DSH_DESKTOP_NOT_READY' | 'DSH_DESKTOP_MULTIPLE';
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
ConvertTo-Json -Compress -InputObject @{ executable = $(if ($executable) { [string]$executable } else { $null }); candidates = @($listeners | ForEach-Object { @{ pid = $_.OwningProcess; port = $_.LocalPort } }) }
`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 15000, encoding: 'utf8' });
  const value = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  if (!value || (value.executable !== null && (typeof value.executable !== 'string' || !path.isAbsolute(value.executable))) ||
    !Array.isArray(value.candidates) || value.candidates.some((row: DesktopAddress) => !Number.isInteger(row.pid) || row.pid <= 0 || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535)) {
    throw new Error('桌面端发现结果无效');
  }
  return value;
}

/** Own only desktop discovery and explicit opening; never own its runtime or data. */
export class DesktopClient {
  constructor(private readonly discover = discoverDesktop) {}
  async addresses(): Promise<DesktopAddress[]> {
    const desktop = await this.discover();
    if (!desktop.candidates.length) {
      if (!desktop.executable) throw new DesktopError('DSH_DESKTOP_NOT_INSTALLED', '请先安装 DeepSeek Harness 桌面端。');
      throw new DesktopError('DSH_DESKTOP_NOT_RUNNING', 'DeepSeek Harness 桌面端尚未运行，请打开桌面端后连接。');
    }
    return desktop.candidates;
  }
  async open(): Promise<void> {
    const desktop = await this.discover();
    if (!desktop.executable) throw new DesktopError('DSH_DESKTOP_NOT_INSTALLED', '请先安装 DeepSeek Harness 桌面端。');
    const child = spawn(desktop.executable, [], { detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }
}
