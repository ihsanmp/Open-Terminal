# OpenTerminal desktop launcher: pulls the latest code from GitHub, rebuilds
# when it changed, starts the API and web servers in the background, opens the
# UI in its own app window, and stops the servers again once that window is
# closed. Run through OpenTerminal.vbs so no console window shows.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$Root        = Split-Path -Parent $PSScriptRoot
$WebPort     = 3000
$ApiPort     = 4000
$AppUrl      = "http://127.0.0.1:$WebPort"
$LogDir      = Join-Path $Root 'data\logs'
$BuiltMarker = Join-Path $Root 'data\.built-commit'
# A dedicated browser profile keeps the app window in its own process (so we
# can tell when it closes) and keeps the saved workspace separate.
$ProfileDir  = Join-Path $env:LOCALAPPDATA 'OpenTerminal\app-profile'
$IconPath    = Join-Path $PSScriptRoot 'icon.ico'

$env:GIT_TERMINAL_PROMPT = '0'
$env:API_URL = "http://127.0.0.1:$ApiPort"

# ---------------------------------------------------------------- helpers ---

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    return ($pending.AsyncWaitHandle.WaitOne(500) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Find-Browser {
  @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Get-AppBrowserProcesses {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*$ProfileDir*" -and $_.CommandLine -notlike '*--type=*' }
}

function New-Splash {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'OpenTerminal'
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'CenterScreen'
  $form.Size = New-Object System.Drawing.Size 400, 120
  $form.BackColor = [System.Drawing.Color]::FromArgb(12, 12, 12)
  $form.TopMost = $true
  if (Test-Path $IconPath) { $form.Icon = New-Object System.Drawing.Icon $IconPath }

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'OpenTerminal'
  $title.Font = New-Object System.Drawing.Font 'Consolas', 18, ([System.Drawing.FontStyle]::Bold)
  $title.ForeColor = [System.Drawing.Color]::FromArgb(255, 153, 0)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point 24, 24
  $form.Controls.Add($title)

  $script:StatusLabel = New-Object System.Windows.Forms.Label
  $StatusLabel.Font = New-Object System.Drawing.Font 'Consolas', 10
  $StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 150)
  $StatusLabel.AutoSize = $true
  $StatusLabel.Location = New-Object System.Drawing.Point 26, 70
  $form.Controls.Add($StatusLabel)

  return $form
}

function Set-Status([string]$text) {
  $StatusLabel.Text = $text
  [System.Windows.Forms.Application]::DoEvents()
}

function Stop-WithError([string]$message) {
  if ($Splash) { $Splash.Close() }
  [System.Windows.Forms.MessageBox]::Show($message, 'OpenTerminal', 'OK', 'Error') | Out-Null
  exit 1
}

# Runs a command hidden while keeping the splash responsive; output goes to
# data\logs\<name>.log. Returns $true when it exits with code 0.
function Invoke-Hidden([string]$name, [string]$commandLine, [int]$timeoutSec) {
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$commandLine`"" `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "$name.log") `
    -RedirectStandardError (Join-Path $LogDir "$name.err.log")
  $null = $p.Handle # needed for ExitCode to be populated in Windows PowerShell
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while (-not $p.HasExited) {
    [System.Windows.Forms.Application]::DoEvents()
    if ((Get-Date) -gt $deadline) {
      & taskkill.exe /PID $p.Id /T /F | Out-Null
      return $false
    }
    Start-Sleep -Milliseconds 200
  }
  return ($p.ExitCode -eq 0)
}

function Get-GitOutput([string[]]$arguments) {
  $out = & git -C $Root @arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out | Out-String).Trim()
}

# Fast-forwards to origin/main when GitHub has new commits. Never fatal: with
# no network, no git, or local edits in the way, the current version is used.
function Update-FromGitHub {
  if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Test-Path (Join-Path $Root '.git'))) { return }
  Set-Status 'Checking GitHub for updates...'
  if (-not (Invoke-Hidden 'git-fetch' 'git fetch origin main' 45)) { return }

  $before = Get-GitOutput @('rev-parse', 'HEAD')
  $remote = Get-GitOutput @('rev-parse', 'origin/main')
  if (-not $remote -or $before -eq $remote) { return }
  & git -C $Root merge-base --is-ancestor HEAD origin/main 2>$null
  if ($LASTEXITCODE -ne 0) { return } # local commits not on GitHub yet

  Set-Status 'Downloading update...'
  if (-not (Invoke-Hidden 'git-merge' 'git merge --ff-only origin/main' 60)) { return }

  $changed = Get-GitOutput @('diff', '--name-only', $before, 'HEAD')
  if ($changed -match '(^|/)package(-lock)?\.json') {
    Set-Status 'Installing dependencies...'
    if (-not (Invoke-Hidden 'npm-install' 'npm install' 900)) {
      Stop-WithError "Updating dependencies failed. See:`n$LogDir\npm-install.err.log"
    }
  }
}

# Rebuilds when there is no build yet or it was made from a different commit.
function Update-Build {
  $head = Get-GitOutput @('rev-parse', 'HEAD')
  $built = if (Test-Path $BuiltMarker) { (Get-Content $BuiltMarker -Raw).Trim() } else { $null }
  $hasBuild = (Test-Path (Join-Path $Root 'server\dist\index.js')) -and (Test-Path (Join-Path $Root 'web\.next\BUILD_ID'))
  if ($hasBuild -and ($null -eq $head -or $head -eq $built)) { return }

  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Set-Status 'Installing dependencies...'
    if (-not (Invoke-Hidden 'npm-install' 'npm install' 900)) {
      Stop-WithError "Installing dependencies failed. See:`n$LogDir\npm-install.err.log"
    }
  }
  Set-Status 'Building the new version (a minute or two)...'
  if (-not (Invoke-Hidden 'build' 'npm run build' 900)) {
    Stop-WithError "Build failed. See:`n$LogDir\build.log"
  }
  if ($head) { Set-Content -Path $BuiltMarker -Value $head -Encoding ASCII }
}

function Start-NodeServer([string]$name, [string]$workDir, [string[]]$arguments) {
  $p = Start-Process -FilePath $Node -ArgumentList $arguments -WorkingDirectory $workDir `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "$name.log") `
    -RedirectStandardError (Join-Path $LogDir "$name.err.log")
  $null = $p.Handle
  return $p
}

# Windows 11 "Efficiency mode" (EcoQoS) plus below-normal priority. On hybrid Intel
# CPUs (e.g. Core Ultra P/E/LP-E cores) the scheduler then keeps these background
# servers on efficiency cores, leaving performance cores to the UI and other apps.
Add-Type -Namespace OpenTerminal -Name Power -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct PROCESS_POWER_THROTTLING_STATE { public uint Version; public uint ControlMask; public uint StateMask; }
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetProcessInformation(IntPtr hProcess, int infoClass, ref PROCESS_POWER_THROTTLING_STATE info, uint size);
'@

function Set-EfficiencyMode([int]$processId) {
  try {
    $p = Get-Process -Id $processId -ErrorAction Stop
    $p.PriorityClass = 'BelowNormal'
    $state = New-Object OpenTerminal.Power+PROCESS_POWER_THROTTLING_STATE
    $state.Version = 1        # PROCESS_POWER_THROTTLING_CURRENT_VERSION
    $state.ControlMask = 1    # PROCESS_POWER_THROTTLING_EXECUTION_SPEED
    $state.StateMask = 1      # on = EcoQoS
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf($state)
    [void][OpenTerminal.Power]::SetProcessInformation($p.Handle, 4, [ref]$state, $size) # 4 = ProcessPowerThrottling
  } catch {
    # Older Windows or an exited process: running at normal priority is fine.
  }
}

# Applies efficiency mode to the given processes and any node children they spawned.
function Set-ServersEfficient([int[]]$ids) {
  $all = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
  $targets = @($ids) + @($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
  foreach ($id in ($targets | Select-Object -Unique)) { Set-EfficiencyMode $id }
}

# ------------------------------------------------------------------- main ---

New-Item -ItemType Directory -Force -Path $LogDir, $ProfileDir | Out-Null
$Splash = $null

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Stop-WithError 'Node.js was not found. Install Node.js 20+ from https://nodejs.org and try again.' }
$Browser = Find-Browser
if (-not $Browser) { Stop-WithError 'Microsoft Edge or Google Chrome is required to show the app window.' }

# Servers this launcher started itself; ones that were already running (for
# example `npm run dev` in a terminal) are reused and left alone on exit.
$started = @()
try {
  $alreadyRunning = (Test-Port $ApiPort) -and (Test-Port $WebPort)
  if (-not $alreadyRunning) {
    $Splash = New-Splash
    $Splash.Show()

    Update-FromGitHub
    Update-Build

    $NextBin = @((Join-Path $Root 'node_modules\next\dist\bin\next'), (Join-Path $Root 'web\node_modules\next\dist\bin\next')) |
      Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $NextBin) { Stop-WithError 'Next.js is missing. Run desktop\install.cmd again.' }

    Set-Status 'Starting servers...'
    if (-not (Test-Port $ApiPort)) {
      $started += Start-NodeServer 'api' (Join-Path $Root 'server') @('dist\index.js')
    }
    if (-not (Test-Port $WebPort)) {
      $started += Start-NodeServer 'web' (Join-Path $Root 'web') @("`"$NextBin`"", 'start', '-H', '127.0.0.1', '-p', "$WebPort")
    }

    $deadline = (Get-Date).AddSeconds(90)
    while (-not ((Test-Port $ApiPort) -and (Test-Port $WebPort))) {
      [System.Windows.Forms.Application]::DoEvents()
      if (($started | Where-Object { $_.HasExited }) -or (Get-Date) -gt $deadline) {
        Stop-WithError "OpenTerminal failed to start. See the logs in:`n$LogDir"
      }
      Start-Sleep -Milliseconds 250
    }
    $Splash.Close()
    if ($started.Count -gt 0) { Set-ServersEfficient @($started | ForEach-Object { $_.Id }) }
  }

  Start-Process -FilePath $Browser -ArgumentList @(
    "--app=$AppUrl",
    "--user-data-dir=`"$ProfileDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    # Edge signs a fresh profile into the Windows account and syncs its
    # extensions, which then pop up their own welcome windows.
    '--disable-sync',
    '--disable-extensions',
    '--window-size=1600,950'
  ) | Out-Null

  # Wait for the app window to appear, then until every window is closed.
  $appeared = (Get-Date).AddSeconds(20)
  while (-not (Get-AppBrowserProcesses) -and (Get-Date) -lt $appeared) { Start-Sleep -Milliseconds 500 }
  do {
    $procs = @(Get-AppBrowserProcesses)
    foreach ($p in $procs) { Wait-Process -Id $p.ProcessId -ErrorAction SilentlyContinue }
  } while ($procs.Count -gt 0)
} finally {
  foreach ($p in $started) {
    if (-not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
  }
}
