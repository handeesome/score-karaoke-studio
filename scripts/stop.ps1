$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root '.launcher'

try {
    foreach ($name in @('frontend', 'backend')) {
        $recordPath = Join-Path $runtime "$name-process.json"
        if (-not (Test-Path -LiteralPath $recordPath)) { continue }
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        $process = Get-Process -Id ([int]$record.Id) -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq [long]$record.Started) {
            Stop-Process -Id $process.Id -ErrorAction Stop
        }
        Remove-Item -LiteralPath $recordPath
    }
    Write-Host '谱间已关闭。'
    exit 0
} catch {
    Write-Host "关闭失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
