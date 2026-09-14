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
  Write-Host '==> Building (this can take a few minutes)'
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}

Write-Host '==> Creating shortcuts'
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $shortcut = $shell.CreateShortcut((Join-Path $folder 'OpenTerminal.lnk'))
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = "`"$(Join-Path $PSScriptRoot 'OpenTerminal.vbs')`""
  $shortcut.WorkingDirectory = $Root
  $shortcut.IconLocation = "$(Join-Path $PSScriptRoot 'icon.ico'),0"
  $shortcut.Description = 'OpenTerminal market terminal'
  $shortcut.Save()
  Write-Host "    $($shortcut.FullName)"
}

Write-Host ''
Write-Host 'Done. Open "OpenTerminal" from your Desktop or Start Menu.'
