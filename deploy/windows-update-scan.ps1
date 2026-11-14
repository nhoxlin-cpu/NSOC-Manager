# Update only Work Area from its prepared private staging directory. The existing
# limited operator has read/execute permission on this exact scheduled task.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ($root -ne 'C:\apps\work-area') {throw 'Wrong Work Area deployment directory.'}
. (Join-Path $PSScriptRoot 'windows-task-helpers.ps1')
$private=Join-Path $root 'private'
$stage=Join-Path $private 'scan-update-stage'
$manifest=Get-Content -LiteralPath (Join-Path $stage 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$allowed=@('server.mjs')
if ($manifest.build -ne 'recovery-download-20261114-35' -or $manifest.files.Count -ne $allowed.Count) {throw 'Unexpected CKD update manifest.'}
foreach ($directory in @($root,$private,$stage)) {
    if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Reparse deployment directory refused.'}
}
foreach ($file in $manifest.files) {
    if ($allowed -notcontains $file.path -or $file.path.Contains('..') -or $file.path.Contains('\')) {throw 'Unexpected update path.'}
    $source=Join-Path $stage $file.path
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) {throw 'Staged scan update checksum mismatch.'}
}
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$task=$scheduler.GetFolder('\').GetTask('WorkAreaIQC')
$config=Get-Content -LiteralPath (Join-Path $private 'windows.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-WorkAreaTaskIdentity -Task $task -Root $root -Operator $config.runAs
$backup=Join-Path $private ('scan-release-backup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
[IO.Directory]::CreateDirectory($backup) | Out-Null
$existing=@()
foreach ($file in $manifest.files) {
    $current=Join-Path $root $file.path
    if (Test-Path -LiteralPath $current) {
        $copy=Join-Path $backup $file.path
        [IO.Directory]::CreateDirectory((Split-Path -Parent $copy)) | Out-Null
        Copy-Item -LiteralPath $current -Destination $copy
        $existing+=$file.path
    }
}
$env:DB_PATH=Join-Path $private 'work-area.sqlite'
$env:NODE_NO_WARNINGS='1'
& (Join-Path $root '.runtime\node.exe') (Join-Path $root 'scripts\backup.mjs')
if ($LASTEXITCODE -ne 0) {throw 'Database backup failed; no app task changed.'}
$stopped=$false
try {
    Write-Host 'Restarting only WorkAreaIQC to apply the workspace and scanner update...'
    $task.Stop(0)
    $stopped=$true
    $deadline=[DateTime]::UtcNow.AddSeconds(12)
    do {
        $listeners=[Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        if (-not ($listeners | Where-Object {$_.Port -eq 3000})) {break}
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($listeners | Where-Object {$_.Port -eq 3000}) {throw 'App port did not close; no unrelated process stopped.'}
    foreach ($file in $manifest.files) {
        $destination=Join-Path $root $file.path
        [IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
        if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $file.sha256) {continue}
        Copy-Item -LiteralPath (Join-Path $stage $file.path) -Destination $destination -Force
    }
    $task.Run($null) | Out-Null
    $ready=$false
    $deadline=[DateTime]::UtcNow.AddSeconds(25)
    do {
        try {$health=Invoke-RestMethod -Uri http://127.0.0.1:3000/api/health -TimeoutSec 2; if ($health.app -eq 'work-area' -and $health.build -eq $manifest.build) {$ready=$true;break}} catch {}
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $ready) {throw 'Updated Work Area did not become healthy.'}
    $report=@{status='online';build=$manifest.build;updatedAt=[DateTime]::UtcNow.ToString('o');backup=$backup;url='https://work-area.odermenu.duckdns.org/#scan'}
    [IO.File]::WriteAllText((Join-Path $private 'scan-update-status.json'),($report | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Write-Host 'Workspace and scanner update is online. Caddy and other websites were not restarted.'
} catch {
    $failure=$_
    if ($stopped) {
        try {
            $task.Stop(0)
            Start-Sleep -Seconds 1
            foreach ($path in $existing) {Copy-Item -LiteralPath (Join-Path $backup $path) -Destination (Join-Path $root $path) -Force}
            $task.Run($null) | Out-Null
            Write-Warning 'Previous Work Area files restored; inspect the reported update error.'
        } catch {Write-Warning 'Rollback needs inspection. The previous files are preserved in the private release backup.'}
    }
    throw $failure
}
