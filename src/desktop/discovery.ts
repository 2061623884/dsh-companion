import { execFile } from 'node:child_process';

export interface DesktopCandidate { pid: number; port: number }
export function discoverWindowsDesktop(): Promise<DesktopCandidate[]> {
  if (process.platform !== 'win32') return Promise.reject(new Error('首版仅支持本机 Windows 桌面 DSH'));
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$hosts = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object { $_.CommandLine -match '[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js' })
if ($hosts.Count -eq 0) { Write-Output '[]'; exit }
$listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $hosts.ProcessId | Where-Object { $_.LocalAddress -eq '127.0.0.1' })
ConvertTo-Json -Compress -InputObject @($listeners | ForEach-Object { @{ pid = $_.OwningProcess; port = $_.LocalPort } })`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, encoding: 'utf8' }, (error, stdout) => {
        if (error) { reject(new Error(`桌面进程查询失败 (${error.code})`)); return; }
        try {
          const value: unknown = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
          if (!Array.isArray(value) || value.some(item => !Number.isInteger(item.pid) || !Number.isInteger(item.port) || item.port < 1 || item.port > 65535)) {
            throw new Error('桌面进程查询返回无效端口');
          }
          resolve(value);
        } catch (parseError) { reject(parseError); }
      });
  });
}
