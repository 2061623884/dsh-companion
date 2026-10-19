import { execFile } from 'node:child_process';

export interface DesktopCandidate { pid: number; port: number }
/** Start the installed shell hidden when necessary; Electron owns backend singleton/lifetime. */
export function ensureWindowsDesktop(): Promise<DesktopCandidate[]> {
  if (process.platform !== 'win32') return Promise.reject(new Error('首版仅支持本机 Windows 桌面 DSH'));
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = [System.Threading.Mutex]::new($false, "Local\DSHCompanion.Start.$owner")
$acquired = $false
try {
  try { $acquired = $mutex.WaitOne(15000) }
  catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { throw 'DSH_START_LOCK_TIMEOUT' }
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'")
  $shells = @($processes | Where-Object { $_.CommandLine -notmatch '--type=|--expose-internals|[\\/]dsh-desktop-host[\\/]lib[\\/]' })
  $hosts = @($processes | Where-Object { $_.CommandLine -match '[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js' })
  if ($shells.Count -eq 0 -and $hosts.Count -eq 0) {
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
      $registrations = @(foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (Test-Path $key) { Get-ItemProperty "$key\*" }
      })
      $locations = @($registrations | Where-Object { $_.DisplayName -eq 'DeepSeek Harness' -and $_.InstallLocation } | Select-Object -ExpandProperty InstallLocation -Unique)
      if ($locations.Count -ne 1) { throw 'DSH_INSTALL_NOT_FOUND' }
      $exe = Join-Path $locations[0] 'DeepSeek Harness.exe'
      if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'DSH_INSTALL_NOT_FOUND' }
    }
    $started = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
  }
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
$deadline = [DateTime]::UtcNow.AddSeconds(40)
do {
  $hosts = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object { $_.CommandLine -match '[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js' })
  if ($hosts.Count -gt 0) {
    $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $hosts.ProcessId -and $_.LocalAddress -eq '127.0.0.1' })
    if ($listeners.Count -gt 0) {
      ConvertTo-Json -Compress -InputObject @($listeners | ForEach-Object { @{ pid = $_.OwningProcess; port = $_.LocalPort } })
      exit
    }
  }
  Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)
throw 'DSH_START_TIMEOUT'`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 60000, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          const code = ['DSH_START_LOCK_TIMEOUT', 'DSH_INSTALL_NOT_FOUND', 'DSH_START_TIMEOUT'].find(code => stderr.includes(code));
          const reason = code === 'DSH_INSTALL_NOT_FOUND' ? '未找到现有 DSH 安装' : code === 'DSH_START_TIMEOUT' ? 'DSH 后台启动超时' : '无法自动准备 DSH 后台';
          reject(new Error(`${reason} (${code || error.code})`)); return;
        }
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
