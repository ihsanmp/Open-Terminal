# OpenTerminal desktop launcher: pulls the latest code from GitHub, rebuilds
# what changed, starts the API and web servers in the background, opens the
# UI in its own app window, and stops the servers again once that window is
# closed. Run through OpenTerminal.vbs so no console window shows.
#
# Startup is kept short: a build only runs when the sources changed, and only
# for the part that did (scripts/build.mjs); the window opens at once on a
# loading page while the servers start; and the efficiency-mode setup waits
# until the window is up.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$Root        = Split-Path -Parent $PSScriptRoot
$WebPort     = 3000
$ApiPort     = 4000
$AppUrl      = "http://127.0.0.1:$WebPort"
$LogDir      = Join-Path $Root 'data\logs'
$LoadingPage = Join-Path $PSScriptRoot 'loading.html'
# A dedicated browser profile keeps the app window in its own process (so we
# can tell when it closes) and keeps the saved workspace separate.
$ProfileDir  = Join-Path $env:LOCALAPPDATA 'OpenTerminal\app-profile'
$IconPath    = Join-Path $PSScriptRoot 'icon.ico'

$env:GIT_TERMINAL_PROMPT = '0'
$env:API_URL = "http://127.0.0.1:$ApiPort"

# ---------------------------------------------------------------- helpers ---

# Whether something listens on the port. Asks Windows for its listening sockets
# (about a millisecond) rather than connecting: a connection to a closed local
# port takes Windows half a second or more to refuse.
function Test-Port([int]$port) {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return [bool]($listeners | Where-Object { $_.Port -eq $port } | Select-Object -First 1)
}

# Seconds since launch per step, in data\logs\launcher.log, to see where startup time goes.
$LaunchClock = [System.Diagnostics.Stopwatch]::StartNew()
function Write-Timing([string]$step) {
  try { Add-Content -Path (Join-Path $LogDir 'launcher.log') -Value ('{0,6:N2}s  {1}' -f $LaunchClock.Elapsed.TotalSeconds, $step) } catch {}
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
    Start-Sleep -Milliseconds 50
  }
  return ($p.ExitCode -eq 0)
}

function Get-GitOutput([string[]]$arguments) {
  $out = & git -C $Root @arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out | Out-String).Trim()
}

# GitHub updates: `git fetch` runs in the background while the app starts (it
# takes about a second), and what it finds is fast-forwarded once the app is
# up. The running servers keep the version they started with; the next launch
# installs packages if they changed and builds the update. Never fatal: with no
# network, no git, or local edits in the way, the current version is used.
function Start-UpdateCheck {
  if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Test-Path (Join-Path $Root '.git'))) { return $null }
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /s /c "git fetch origin main"' `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir 'git-fetch.log') `
    -RedirectStandardError (Join-Path $LogDir 'git-fetch.err.log')
  $null = $p.Handle
  return $p
}

function Complete-Update($fetch) {
  if (-not $fetch) { return }
  if (-not $fetch.WaitForExit(20000)) {
    & taskkill.exe /PID $fetch.Id /T /F | Out-Null
    return
  }
  if ($fetch.ExitCode -ne 0) { return }
  $before = Get-GitOutput @('rev-parse', 'HEAD')
  $remote = Get-GitOutput @('rev-parse', 'origin/main')
  if (-not $remote -or $before -eq $remote) { return }
  & git -C $Root merge-base --is-ancestor HEAD origin/main 2>$null
  if ($LASTEXITCODE -ne 0) { return } # local commits not on GitHub yet
  if (Invoke-Hidden 'git-merge' 'git merge --ff-only origin/main' 60) { Write-Timing 'update downloaded; it is built at the next start' }
}

# Installs packages when package-lock.json differs from the one last installed.
function Update-Packages {
  $lock = Join-Path $Root 'package-lock.json'
  $marker = Join-Path $Root 'data\.installed-lock'
  $hash = if (Test-Path $lock) { (Get-FileHash $lock -Algorithm SHA256).Hash } else { '' }
  $installed = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { $null }
  $hasModules = Test-Path (Join-Path $Root 'node_modules')
  # The first time on an existing install, what's there counts as installed.
  if ($hasModules -and $null -eq $installed) { Set-Content -Path $marker -Value $hash -Encoding ASCII; return }
  if ($hasModules -and $installed -eq $hash) { return }
  Set-Status 'Installing dependencies...'
  if (-not (Invoke-Hidden 'npm-install' 'npm install' 900)) {
    Stop-WithError "Installing dependencies failed. See:`n$LogDir\npm-install.err.log"
  }
  Set-Content -Path $marker -Value $hash -Encoding ASCII
}

# Rebuilds the API and/or the web app when their sources changed since they
# were built (scripts/build.mjs keeps a hash of each); the two build at once.
function Update-Build {
  Update-Packages
  $buildScript = Join-Path $Root 'scripts\build.mjs'
  if (Invoke-Hidden 'build-check' "`"$Node`" `"$buildScript`" --check" 60) { return }
  Set-Status 'Building the new version (about 20 seconds)...'
  if (-not (Invoke-Hidden 'build' "`"$Node`" `"$buildScript`" --fast" 900)) {
    Stop-WithError "Build failed. See:`n$LogDir\build.log"
  }
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
# Compiled on first use (about a third of a second), after the window is open.
function Initialize-PowerApi {
  if ('OpenTerminal.Power' -as [type]) { return }
  Add-Type -Namespace OpenTerminal -Name Power -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct PROCESS_POWER_THROTTLING_STATE { public uint Version; public uint ControlMask; public uint StateMask; }
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetProcessInformation(IntPtr hProcess, int infoClass, ref PROCESS_POWER_THROTTLING_STATE info, uint size);
'@
}

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
  try { Initialize-PowerApi } catch { return }
  $all = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
  $targets = @($ids) + @($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
  foreach ($id in ($targets | Select-Object -Unique)) { Set-EfficiencyMode $id }
}

# ------------------------------------------------------------------- main ---

New-Item -ItemType Directory -Force -Path $LogDir, $ProfileDir | Out-Null
Set-Content -Path (Join-Path $LogDir 'launcher.log') -Value ("started {0:yyyy-MM-dd HH:mm:ss}" -f (Get-Date))
$Splash = $null

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Stop-WithError 'Node.js was not found. Install Node.js 20+ from https://nodejs.org and try again.' }
$Browser = Find-Browser
if (-not $Browser) { Stop-WithError 'Microsoft Edge or Google Chrome is required to show the app window.' }

# Servers this launcher started itself; ones that were already running (for
# example `npm run dev` in a terminal) are reused and left alone on exit.
$started = @()
$servers = @()
$fetch = $null
try {
  $alreadyRunning = (Test-Port $ApiPort) -and (Test-Port $WebPort)
  if (-not $alreadyRunning) {
    $Splash = New-Splash
    $Splash.Show()

    $fetch = Start-UpdateCheck
    Update-Build
    Write-Timing 'build up to date'

    $NextBin = @((Join-Path $Root 'node_modules\next\dist\bin\next'), (Join-Path $Root 'web\node_modules\next\dist\bin\next')) |
      Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $NextBin) { Stop-WithError 'Next.js is missing. Run desktop\install.cmd again.' }

    Set-Status 'Starting servers...'
    if (-not (Test-Port $ApiPort)) {
      $servers += @{ Name = 'api'; Dir = (Join-Path $Root 'server'); Args = @('dist\index.js') }
    }
    if (-not (Test-Port $WebPort)) {
      $servers += @{ Name = 'web'; Dir = (Join-Path $Root 'web'); Args = @("`"$NextBin`"", 'start', '-H', '127.0.0.1', '-p', "$WebPort") }
    }
    foreach ($s in $servers) { $s.Proc = Start-NodeServer $s.Name $s.Dir $s.Args }
    $started = @($servers | ForEach-Object { $_.Proc })
  }

  # The window opens now, on a page that moves to the app as soon as it
  # answers, so the browser starts up while the servers do.
  $windowUrl = $AppUrl
  if ($started.Count -gt 0 -and (Test-Path $LoadingPage)) {
    $windowUrl = ([System.Uri]$LoadingPage).AbsoluteUri + '#' + [System.Uri]::EscapeDataString($AppUrl)
  }
  Start-Process -FilePath $Browser -ArgumentList @(
    "--app=$windowUrl",
    "--user-data-dir=`"$ProfileDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    # Edge signs a fresh profile into the Windows account and syncs its
    # extensions, which then pop up their own welcome windows.
    '--disable-sync',
    '--disable-extensions',
    '--window-size=1600,950'
  ) | Out-Null
  Write-Timing 'window opened'

  if ($started.Count -gt 0) {
    $deadline = (Get-Date).AddSeconds(90)
    while (-not ((Test-Port $ApiPort) -and (Test-Port $WebPort))) {
      [System.Windows.Forms.Application]::DoEvents()
      if (($started | Where-Object { $_.HasExited }) -or (Get-Date) -gt $deadline) {
        Stop-WithError "OpenTerminal failed to start. See the logs in:`n$LogDir"
      }
      Start-Sleep -Milliseconds 100
    }
  }
  Write-Timing 'servers listening'
  if ($Splash) { $Splash.Close() }
  if ($started.Count -gt 0) { Set-ServersEfficient @($started | ForEach-Object { $_.Id }) }
  Complete-Update $fetch

  # Wait for the app window to appear, then until every window is closed. A
  # server that stops meanwhile is started again (the open windows reconnect
  # by themselves), and its log is kept as <name>.crash.err.log.
  $appeared = (Get-Date).AddSeconds(20)
  while (-not (Get-AppBrowserProcesses) -and (Get-Date) -lt $appeared) { Start-Sleep -Milliseconds 500 }
  $restarts = 0
  while ($true) {
    $browser = @(Get-AppBrowserProcesses | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_ })
    if ($browser.Count -eq 0) { break }
    while (-not $browser[0].HasExited) {
      [void]$browser[0].WaitForExit(2000)
      foreach ($s in $servers) {
        if (-not $s.Proc.HasExited -or $restarts -ge 20) { continue }
        $restarts++
        Write-Timing "$($s.Name) server stopped (exit $($s.Proc.ExitCode)); starting it again"
        $errLog = Join-Path $LogDir "$($s.Name).err.log"
        if (Test-Path $errLog) { Copy-Item $errLog (Join-Path $LogDir "$($s.Name).crash.err.log") -Force }
        $s.Proc = Start-NodeServer $s.Name $s.Dir $s.Args
        Set-ServersEfficient @($s.Proc.Id)
      }
    }
  }
} finally {
  foreach ($p in (@($servers | ForEach-Object { $_.Proc }) + $started)) {
    if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
  }
}
