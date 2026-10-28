$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $root ('build/update-installer-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null

# Exercise the real file transaction; capture the application launch instead of running a fixture EXE.
function Start-Process {
    param($FilePath, $WorkingDirectory, $WindowStyle, [switch]$PassThru)
    if ($WindowStyle -ne 'Normal' -or -not $PassThru) { throw 'The updated application must restart visibly.' }
    if ($FilePath -ne (Join-Path $WorkingDirectory 'Pujian.exe')) { throw 'Wrong restart target.' }
    [IO.File]::WriteAllText((Join-Path $WorkingDirectory 'restarted.txt'), $FilePath)
    [pscustomobject]@{ Id = 12345 }
}
function Add-Type { param($AssemblyName) }
$fixtureInstaller = Join-Path $testRoot 'installer-fixture.ps1'
$source = [IO.File]::ReadAllText((Join-Path $root 'desktop/update-install.ps1'))
$source = [regex]::Replace($source, '(?m)^\s*\[Windows.Forms.MessageBox\]::Show.*$', "    Write-Output 'Expected update failure'")
[IO.File]::WriteAllText($fixtureInstaller, $source, [Text.UTF8Encoding]::new($true))

foreach ($scenario in @('success', 'rollback')) {
    $data = Join-Path $testRoot $scenario
    $bundle = Join-Path $data 'bundle'
    $stage = Join-Path $data ('update-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($bundle) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $stage 'files/_internal/dist')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $bundle 'Pujian.exe'), 'original')
    [IO.File]::WriteAllText((Join-Path $bundle 'models-sentinel'), 'model')
    [IO.File]::WriteAllText((Join-Path $stage 'files/Pujian.exe'), 'updated')
    if ($scenario -eq 'success') { [IO.File]::WriteAllText((Join-Path $stage 'files/_internal/dist/index.html'), 'new UI') }
    $plan = Join-Path $stage 'plan.json'
    @{pid=2147483647;bundle=$bundle;stage=$stage;data=$data;files=@('Pujian.exe','_internal/dist/index.html')} |
        ConvertTo-Json | Set-Content -LiteralPath $plan -Encoding UTF8
    . $fixtureInstaller -Plan $plan
    $content = [IO.File]::ReadAllText((Join-Path $bundle 'Pujian.exe'))
    if ($scenario -eq 'success') {
        if ($content -ne 'updated' -or -not (Test-Path -LiteralPath (Join-Path $bundle 'restarted.txt'))) { throw 'Install/restart failed.' }
        if (Test-Path -LiteralPath $stage) { throw 'Successful update did not clean stage.' }
        if ([IO.File]::ReadAllText((Join-Path $bundle '_internal/dist/index.html')) -ne 'new UI') { throw 'UI not installed.' }
        if ([IO.File]::ReadAllText((Join-Path $data 'update.log')) -notmatch 'Application restarted; pid=12345') { throw 'Restart not logged.' }
    } else {
        if ($content -ne 'original') { throw 'Rollback did not restore original EXE.' }
        if (Test-Path -LiteralPath (Join-Path $bundle '_internal/dist/index.html')) { throw 'Rollback kept a new file.' }
        if (Test-Path -LiteralPath (Join-Path $bundle 'restarted.txt')) { throw 'Failed install restarted application.' }
    }
    if ([IO.File]::ReadAllText((Join-Path $bundle 'models-sentinel')) -ne 'model') { throw 'Model changed.' }
    Write-Output "$scenario passed"
}
