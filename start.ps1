# Game Ad Studio launcher (used by the desktop shortcut).
# Already running -> just opens the UI. Otherwise starts `npm run dev` in this window and opens the UI when it is ready.
# Closing this window stops the tool.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Game Ad Studio (close this window to stop)"
$url = "http://localhost:5173"

function Test-Port([int]$port) {
  [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

$api = Test-Port 3101
$web = Test-Port 5173
if ($api -and $web) {
  Write-Host "Game Ad Studio is already running. Opening $url"
  Start-Process $url
  Start-Sleep -Seconds 2
  exit 0
}
if ($api -or $web) {
  # half-alive leftovers would block the ports -> stop them and start clean
  Write-Host "Stopping leftover server processes..."
  foreach ($p in 3101, 5173) {
    Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Seconds 1
}

# open the browser once the web UI answers (background job, gives up after 2 minutes)
Start-Job -ArgumentList $url -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 120; $i++) {
    try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; return } catch { Start-Sleep -Seconds 1 }
  }
} | Out-Null

Write-Host "Starting Game Ad Studio... (the browser opens automatically)"
npm run dev
