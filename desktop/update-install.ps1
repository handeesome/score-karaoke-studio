param([Parameter(Mandatory=$true)][string]$Plan)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$stage = [IO.Path]::GetFullPath($config.stage)
$bundle = [IO.Path]::GetFullPath($config.bundle)
$log = Join-Path $config.data 'update.log'
$changed = @()
$success = $false
function Write-UpdateLog([string]$message) {
    Add-Content -LiteralPath $log -Encoding UTF8 -Value ("$(Get-Date -Format o) $message")
}
function Replace-UpdateFile([string]$source, [string]$target) {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            [IO.File]::Copy($source, $target + '.pujian-update', $true)
            if ([IO.File]::Exists($target)) {
                $previous = $target + '.' + [Guid]::NewGuid().ToString('N') + '.previous'
                [IO.File]::Replace($target + '.pujian-update', $target, $previous)
                [IO.File]::Delete($previous)
            }
            else { [IO.File]::Move($target + '.pujian-update', $target) }
            return
        } catch {
            if ($attempt -eq 19) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
}
try {
    Write-UpdateLog 'Waiting for application shutdown.'
    $parent = Get-Process -Id $config.pid -ErrorAction SilentlyContinue
    if ($parent) { Wait-Process -Id $config.pid -Timeout 120 }
    Start-Sleep -Milliseconds 500
    foreach ($name in $config.files) {
        $relative = $name.Replace('/', '\')
        $target = [IO.Path]::GetFullPath((Join-Path $bundle $relative))
        if (-not $target.StartsWith($bundle.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Update target outside application folder.' }
        $directory = [IO.Path]::GetDirectoryName($target)
        $cursor = $directory
        while ($cursor.Length -ge $bundle.Length) {
            if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Update target contains a linked directory.' }
            $cursor = [IO.Path]::GetDirectoryName($cursor)
            if (-not $cursor) { break }
        }
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        $backup = Join-Path (Join-Path $stage 'backup') $relative
        $existed = [IO.File]::Exists($target)
        if ($existed) {
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($backup)) | Out-Null
            [IO.File]::Copy($target, $backup, $true)
        }
        $changed += @{ target=$target; backup=$backup; existed=$existed }
        Replace-UpdateFile (Join-Path (Join-Path $stage 'files') $relative) $target
    }
    Write-UpdateLog 'Update installed successfully.'
    $success = $true
} catch {
    Write-UpdateLog ("Update failed: " + $_.Exception.Message)
    [array]::Reverse($changed)
    foreach ($file in $changed) {
        try {
            if ($file.existed) { Replace-UpdateFile $file.backup $file.target }
            elseif ([IO.File]::Exists($file.target)) { [IO.File]::Delete($file.target) }
        } catch { Write-UpdateLog ("Rollback failed: " + $_.Exception.Message) }
    }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show("更新未完成，已尝试恢复原版本。请重新打开软件。`n日志：$log", '谱间更新失败') | Out-Null
}
if ($success) {
    # The installer is hidden, but the interactive application must open visibly.
    $restarted = Start-Process -FilePath (Join-Path $bundle 'Pujian.exe') -WorkingDirectory $bundle -WindowStyle Normal -PassThru
    Write-UpdateLog ("Application restarted; pid=" + $restarted.Id)
    if ($stage.StartsWith([IO.Path]::GetFullPath($config.data).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -and
        ([IO.Path]::GetFileName($stage)).StartsWith('update-')) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
