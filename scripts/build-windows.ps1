param(
    [switch]$IncludeModels,
    [switch]$DownloadModels,
    [string]$WhisperModelPath,
    [string]$DemucsModelPath,
    [string]$TesseractPath,
    [string]$WebView2Path,
    [string]$PythonPath,
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
if ($DownloadModels -and -not $IncludeModels) { throw '-DownloadModels 需要同时指定 -IncludeModels。' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '构建电脑需要安装 Node.js（含 npm）。' }

# Isolate packaging tools from the source runtime unless a PythonPath is explicitly supplied.
if (-not $PythonPath) {
    $PythonPath = Join-Path $root '.build-venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $PythonPath)) {
        if (Get-Command py.exe -ErrorAction SilentlyContinue) {
            & py.exe -3.11 -m venv (Join-Path $root '.build-venv')
        } else {
            & python.exe -m venv (Join-Path $root '.build-venv')
        }
        if ($LASTEXITCODE -ne 0) { throw '创建构建环境失败，建议安装 Windows x64 Python 3.11。' }
    }
}
$PythonPath = (Resolve-Path -LiteralPath $PythonPath).Path
if (-not $SkipInstall) {
    & $PythonPath -m pip install -r (Join-Path $root 'desktop\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw '桌面依赖安装失败。' }
}
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }

$buildArgs = @((Join-Path $PSScriptRoot 'build_windows.py'))
if ($IncludeModels) { $buildArgs += '--include-models' }
if ($DownloadModels) { $buildArgs += '--download-models' }
foreach ($entry in @(
    @{ Flag = '--whisper'; Value = $WhisperModelPath },
    @{ Flag = '--demucs'; Value = $DemucsModelPath },
    @{ Flag = '--tesseract'; Value = $TesseractPath },
    @{ Flag = '--webview2'; Value = $WebView2Path }
)) {
    if ($entry.Value) { $buildArgs += @($entry.Flag, (Resolve-Path -LiteralPath $entry.Value).Path) }
}
& $PythonPath @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'Windows 打包失败，请查看上方错误和 build 目录里的日志。' }
