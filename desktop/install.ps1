# One-time setup for the Windows desktop app: installs dependencies, builds
# the production bundles, and creates Desktop + Start Menu shortcuts.
# Re-run after pulling new code so the app picks up the changes.
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20+ is required. Install it from https://nodejs.org and run this again.'
}

Write-Host '==> Generating icon'
& (Join-Path $PSScriptRoot 'make-icon.ps1')

if (-not $SkipBuild) {
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Write-Host '==> Installing dependencies'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  }
  Write-Host '==> Building (about 20 seconds)'
  & node (Join-Path $Root 'scripts/build.mjs') --fast
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}

Write-Host '==> Creating shortcuts'
# The app's taskbar identity (see Taskbar.cs and OpenTerminal.ps1): the
# shortcuts share it with the app windows, and its right-click menu has
# "New window". OpenTerminal.ps1 sets the same at every start.
$AppId = 'IhsanMP.OpenTerminal'
$taskbar = $false
try { Add-Type -TypeDefinition (Get-Content -Raw (Join-Path $PSScriptRoot 'Taskbar.cs')) -Language CSharp; $taskbar = $true } catch {}
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $shortcut = $shell.CreateShortcut((Join-Path $folder 'OpenTerminal.lnk'))
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = "`"$(Join-Path $PSScriptRoot 'OpenTerminal.vbs')`""
  $shortcut.WorkingDirectory = $Root
  $shortcut.IconLocation = "$(Join-Path $PSScriptRoot 'icon.ico'),0"
  $shortcut.Description = 'OpenTerminal market terminal'
  $shortcut.Save()
  if ($taskbar) { [void][OpenTerminal.Taskbar]::SetShortcutAppId($shortcut.FullName, $AppId) }
  Write-Host "    $($shortcut.FullName)"
}
if ($taskbar) {
  [OpenTerminal.Taskbar]::SetJumpList($AppId, 'New window', (Join-Path $env:WINDIR 'System32\wscript.exe'), "`"$(Join-Path $PSScriptRoot 'OpenTerminal.vbs')`" -NewWindow", $Root, (Join-Path $PSScriptRoot 'icon.ico'))
}

Write-Host ''
Write-Host 'Done. Open "OpenTerminal" from your Desktop or Start Menu.'
