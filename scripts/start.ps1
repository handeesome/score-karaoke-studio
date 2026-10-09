$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
$runtime = Join-Path $root '.launcher'
$backendUrl = 'http://127.0.0.1:8000'
$frontendUrl = 'http://127.0.0.1:5173/'

function Test-Backend {
    try {
        $doc = Invoke-RestMethod -Uri "$backendUrl/openapi.json" -TimeoutSec 2
        return $doc.info.title -eq '谱间本地项目服务'
    } catch { return $false }
}

function Test-Frontend {
    try {
        $page = Invoke-WebRequest -Uri $frontendUrl -TimeoutSec 2 -UseBasicParsing
        return $page.Content -like '*谱间 · 歌谱同步工作台*'
    } catch { return $false }
}

function Test-Port([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $port)
        return $true
    } catch { return $false }
    finally { $client.Dispose() }
}

function Wait-Ready([scriptblock]$check, [string]$label, [string]$logFile) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (& $check) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "$label 启动超时。请查看 $logFile"
}

function Get-PythonCommand {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $version = & $py.Source -3.11 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
        if ($LASTEXITCODE -eq 0 -and $version -eq '3.11') {
            return @{ File = $py.Source; Args = @('-3.11') }
        }
    }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) {
        $version = & $python.Source -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
        if ($LASTEXITCODE -eq 0 -and $version -eq '3.11') {
            return @{ File = $python.Source; Args = @() }
        }
    }
    throw '需要先安装 Python 3.11，并勾选安装程序中的“Add python.exe to PATH”。'
}

$job = $null
try {
    if ((Test-Port 8000) -or (Test-Port 5173)) {
        throw '端口 8000 或 5173 已被占用。请先关闭旧的谱间服务或占用端口的程序。'
    }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $node -or -not $npm) { throw '需要先安装 Node.js 20（含 npm），然后重新双击启动文件。' }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $venvPython = Join-Path $root '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        $python = Get-PythonCommand
        Write-Host '首次运行：正在创建 Python 环境…'
        & $python.File @($python.Args) -m venv (Join-Path $root '.venv')
        if ($LASTEXITCODE -ne 0) { throw '创建 Python 环境失败。' }
    }

    $requirements = Join-Path $root 'backend\requirements.txt'
    $vocals = Join-Path $root 'backend\requirements-vocals.txt'
    $basicHash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
    $vocalHash = (Get-FileHash -LiteralPath $vocals -Algorithm SHA256).Hash
    $basicStamp = Join-Path $runtime 'python-requirements.sha256'
    $vocalStamp = Join-Path $runtime 'vocal-requirements.sha256'
    if (-not (Test-Path -LiteralPath $basicStamp) -or (Get-Content -LiteralPath $basicStamp -Raw).Trim() -ne $basicHash) {
        Write-Host '正在安装后端依赖（首次运行可能需要几分钟）…'
        & $venvPython -m pip install -r $requirements
        if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败。请检查网络和 Python 版本。' }
        Set-Content -LiteralPath $basicStamp -Value $basicHash
    }
    $vocalState = if (Test-Path -LiteralPath $vocalStamp) { (Get-Content -LiteralPath $vocalStamp -Raw).Trim() } else { '' }
    if ($vocalState -ne $vocalHash -and $vocalState -ne "failed:$vocalHash") {
        Write-Host '正在安装人声波形组件（首次运行下载量较大）…'
        & $venvPython -m pip install -r $vocals
        if ($LASTEXITCODE -eq 0) {
            Set-Content -LiteralPath $vocalStamp -Value $vocalHash
        } else {
            Set-Content -LiteralPath $vocalStamp -Value "failed:$vocalHash"
            Write-Warning '人声波形组件安装失败；基础功能仍可使用。稍后可按 README 手动重装。'
        }
    } elseif ($vocalState -eq "failed:$vocalHash") {
        Write-Warning '人声波形组件尚未安装；基础功能仍可使用。'
    }

    $lockHash = (Get-FileHash -LiteralPath (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash
    $nodeStamp = Join-Path $runtime 'node-lock.sha256'
    $viteScript = Join-Path $root 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $viteScript) -or -not (Test-Path -LiteralPath $nodeStamp) -or (Get-Content -LiteralPath $nodeStamp -Raw).Trim() -ne $lockHash) {
        Write-Host '正在安装前端依赖…'
        & $npm.Source ci
        if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。请检查网络和 Node.js 版本。' }
        Set-Content -LiteralPath $nodeStamp -Value $lockHash
    }

    $tesseract = Get-Command tesseract.exe -ErrorAction SilentlyContinue
    $tesseractPath = if ($tesseract) { $tesseract.Source } elseif (Test-Path 'C:\Program Files\Tesseract-OCR\tesseract.exe') { 'C:\Program Files\Tesseract-OCR\tesseract.exe' } else { $null }
    if (-not $tesseractPath) {
        Write-Warning '未找到 Tesseract OCR；自动框选和自动对齐需要另行安装 Tesseract 及 chi_sim 中文语言包。'
    } elseif ((& $tesseractPath --list-langs 2>$null) -notcontains 'chi_sim') {
        Write-Warning 'Tesseract 缺少 chi_sim 中文语言包；自动框选和自动对齐需要安装该语言包。'
    }

    Add-Type -Path (Join-Path $PSScriptRoot 'ProcessJob.cs')
    $job = [ProcessJob]::new()

    Write-Host '正在启动本地后端…'
    $backendLog = Join-Path $runtime 'backend-error.log'
    $backend = Start-Process -FilePath $venvPython -ArgumentList @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'backend-output.log') -RedirectStandardError $backendLog -PassThru
    $job.Add($backend)
    Wait-Ready ${function:Test-Backend} '后端' $backendLog

    Write-Host '正在启动网页界面…'
    $frontendLog = Join-Path $runtime 'frontend-error.log'
    $frontend = Start-Process -FilePath $node.Source -ArgumentList @("`"$viteScript`"", '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'frontend-output.log') -RedirectStandardError $frontendLog -PassThru
    $job.Add($frontend)
    Wait-Ready ${function:Test-Frontend} '网页界面' $frontendLog

    Write-Host '谱间已就绪，正在打开浏览器。'
    Start-Process $frontendUrl
    Write-Host '请保持此窗口打开；关闭窗口时，前后端服务会一起关闭。'
    while (-not $backend.HasExited -and -not $frontend.HasExited) {
        Start-Sleep -Seconds 1
    }
    throw '一项服务已退出。请查看 .launcher 目录中的日志。'
} catch {
    foreach ($started in @($frontend, $backend)) {
        if ($started) { Stop-Process -Id $started.Id -ErrorAction SilentlyContinue }
    }
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($job) { $job.Dispose() }
}
