# Removes the Desktop and Start Menu shortcuts created by install.ps1.
# Pass -RemoveAppData to also delete the app window's browser profile
# (saved workspace layout and watchlist). Portfolio data in data\ is kept.
param([switch]$RemoveAppData)

foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = Join-Path $folder 'OpenTerminal.lnk'
  if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed $lnk" }
}

if ($RemoveAppData) {
  $appData = Join-Path $env:LOCALAPPDATA 'OpenTerminal'
  if (Test-Path $appData) { Remove-Item $appData -Recurse -Force; Write-Host "Removed $appData" }
}
