[CmdletBinding()]
param([string]$DshHome)

$ErrorActionPreference = 'Stop'
$packageSpec = 'dsh-image-viewer@0.1.0-beta.3'
$dshRelease = '0.1.1-rc.2'
$pnpmVersion = '11.19.0'
$pnpmUrl = 'https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz'
$pnpmSha512 = '7881F3ED590D472C4A955E2B88B2121791116066DCC88CBCA3849EC9B60F1BBAA6D2CCB221FA91DA4E1C65BEF2BCBE379365AEA7AC539C7BF86DEDC3A1B22DCE'
$chinese = [Globalization.CultureInfo]::CurrentUICulture.Name -like 'zh-*'

function Say([string]$ChineseText, [string]$EnglishText) {
    Write-Host $(if ($chinese) { $ChineseText } else { $EnglishText })
}

function New-DshInvocation([string]$Command, [string[]]$Prefix, [string]$Label, [bool]$NeedsPnpm = $false, [string]$DshHomePath = $null, [string]$Node = $null, [bool]$UseDlx = $false) {
    [pscustomobject]@{ Command = $Command; Prefix = $Prefix; Label = $Label; NeedsPnpm = $NeedsPnpm; DshHomePath = $DshHomePath; Node = $Node; UseDlx = $UseDlx }
}

function Resolve-OfficialHome {
    $candidate = if ($DshHome) { $DshHome } elseif ($env:DSH_HOME) { $env:DSH_HOME } elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' } else { throw 'USERPROFILE is unavailable. Pass -DshHome with the official DSH data directory.' }
    [IO.Path]::GetFullPath($candidate)
}

function Resolve-Node([string]$Preferred = $null) {
    if ($Preferred -and (Test-Path -LiteralPath $Preferred -PathType Leaf)) { return (Resolve-Path -LiteralPath $Preferred).Path }
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($node) { return (Resolve-Path -LiteralPath $node.Source).Path }
    throw 'Node.js was not found. Start official DSH, install Node.js, or use DSH-Portable.'
}

function Get-FileDigest([string]$Path) {
    $hasher = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $hasher.Dispose() }
}

function Test-Pnpm([string]$Command) {
    try { return [bool]((([string](& $Command '--version' 2>$null | Select-Object -First 1)).Trim()) -match '^\d+\.\d+\.\d+$') }
    catch { return $false }
}

function Get-Pnpm {
    $existing = Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and (Test-Pnpm $existing.Source)) { return [pscustomobject]@{ Command = $existing.Source; Directory = (Split-Path -Parent $existing.Source) } }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable, so the verified pnpm helper cannot be cached.' }
    $directory = Join-Path $env:LOCALAPPDATA "dsh-plugin-tools\pnpm-$pnpmVersion"
    $entry = Join-Path $directory 'package\bin\pnpm.cjs'
    $shim = Join-Path $directory 'pnpm.cmd'
    if ((Test-Path -LiteralPath $entry -PathType Leaf) -and (Test-Path -LiteralPath $shim -PathType Leaf)) { return [pscustomobject]@{ Command = $shim; Directory = $directory } }
    $parent = Split-Path -Parent $directory
    $stage = Join-Path $parent ('.pnpm-' + [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $stage 'pnpm.tgz'
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    try {
        Say "正在准备经过校验的插件管理器（pnpm $pnpmVersion）…" "Preparing the verified plugin manager (pnpm $pnpmVersion)..."
        Invoke-WebRequest -UseBasicParsing -Uri $pnpmUrl -OutFile $archive
        $actual = Get-FileDigest $archive
        if ($actual -ne $pnpmSha512) { throw "pnpm checksum mismatch. Expected $pnpmSha512, received $actual." }
        $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
        if (-not $tar) { throw 'Windows tar.exe is required to unpack the verified pnpm helper.' }
        & $tar.Source '-xzf' $archive '-C' $stage
        if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE." }
        Remove-Item -LiteralPath $archive -Force
        if (-not (Test-Path -LiteralPath (Join-Path $stage 'package\bin\pnpm.cjs') -PathType Leaf)) { throw 'The verified pnpm archive did not contain package\bin\pnpm.cjs.' }
        $shimText = "@echo off`r`n`"%DSH_PLUGIN_NODE%`" `"%~dp0package\bin\pnpm.cjs`" %*`r`n"
        [IO.File]::WriteAllText((Join-Path $stage 'pnpm.cmd'), $shimText, [Text.Encoding]::ASCII)
        if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
        Move-Item -LiteralPath $stage -Destination $directory
    }
    finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue } }
    [pscustomobject]@{ Command = (Join-Path $directory 'pnpm.cmd'); Directory = $directory }
}

function Invoke-PluginAddWithReleaseAgeRecovery($Invocation, [string]$PackageSpec) {
    $arguments = @($Invocation.Prefix) + @('plugin', '--profile', 'web', 'add', $PackageSpec)
    $lines = [Collections.Generic.List[string]]::new()
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Invocation.Command @arguments 2>&1 | ForEach-Object {
            $line = [string]$_
            $lines.Add($line)
            Write-Host $line
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $releaseAgeBlocked = ($lines -join "`n") -match 'ERR_PNPM_(?:MINIMUM_RELEASE_AGE_VIOLATION|NO_MATURE_MATCHING_VERSION)'
    if ($exitCode -ne 0 -and $releaseAgeBlocked) {
        Say '现有锁文件包含仍在发布时间等待期内的版本；正在对此命令进行一次性确认重试…' 'The existing lockfile contains a version still inside the release-age hold; retrying this command once with a scoped confirmation...'
        $retryArguments = @($Invocation.Prefix) + @('plugin', '--profile', 'web', 'add', '--config.minimumReleaseAge=0', $PackageSpec)
        $previousErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $Invocation.Command @retryArguments 2>&1 | ForEach-Object { Write-Host ([string]$_) }
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorAction
        }
    }
    return $exitCode
}

function Get-OfficialDshInvocation([string]$Node, [string]$Bin) {
    if (-not (Test-Path -LiteralPath $Node -PathType Leaf) -or -not (Test-Path -LiteralPath $Bin -PathType Leaf)) { return $null }
    $packageJson = Join-Path (Split-Path (Split-Path $Bin -Parent) -Parent) 'package.json'
    if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) { return $null }
    try {
        $metadata = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
    }
    catch { return $null }
    if ($metadata.name -ne '@deepseek-ai/dsh') { return $null }
    $resolvedNode = (Resolve-Path -LiteralPath $Node).Path
    $officialHome = Resolve-OfficialHome
    return New-DshInvocation -Command $resolvedNode -Prefix @() -Label "official DSH $($metadata.version), profile home $officialHome" -NeedsPnpm $true -DshHomePath $officialHome -Node $resolvedNode -UseDlx $true
}

function Get-DshFromProductRoot([string]$Root) {
    if (-not $Root) { return $null }
    $official = Get-OfficialDshInvocation (Join-Path $Root 'runtime\node\node.exe') (Join-Path $Root 'app\node_modules\@deepseek-ai\dsh\lib\bin.js')
    if (-not $official) { return $null }
    $launcher = Join-Path $Root 'dsh.exe'
    if (Test-Path -LiteralPath $launcher -PathType Leaf) {
        return New-DshInvocation -Command (Resolve-Path -LiteralPath $launcher).Path -Prefix @() -Label "DSH-Portable ($($official.Label))"
    }
    return $official
}

function Find-DshFromCurrentDirectory {
    $directory = [IO.DirectoryInfo]::new((Get-Location).Path)
    while ($null -ne $directory) {
        $candidate = Get-DshFromProductRoot $directory.FullName
        if ($candidate) { return $candidate }
        $directory = $directory.Parent
    }
    return $null
}

function Find-RunningOfficialDsh {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
        $line = [string]$process.CommandLine
        if ($line -notmatch '(?i)(?:^|[\s\"])([^\"]*node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js)(?:\"|\s|$)') { continue }
        $candidate = Get-OfficialDshInvocation ([string]$process.ExecutablePath) $Matches[1].Trim('"')
        if ($candidate) { return $candidate }
    }
    return $null
}

function Find-CommonDsh {
    if (-not $env:USERPROFILE) { return $null }
    $found = @()
    foreach ($containerName in @('Downloads', 'Desktop', 'Documents')) {
        $container = Join-Path $env:USERPROFILE $containerName
        foreach ($root in @((Join-Path $container 'DSH-Portable'), $container)) {
            $candidate = Get-DshFromProductRoot $root
            if ($candidate) { $found += $candidate }
        }
        if (-not (Test-Path -LiteralPath $container -PathType Container)) { continue }
        foreach ($child in Get-ChildItem -LiteralPath $container -Directory -ErrorAction SilentlyContinue) {
            foreach ($root in @($child.FullName, (Join-Path $child.FullName 'DSH-Portable'))) {
                $candidate = Get-DshFromProductRoot $root
                if ($candidate) { $found += $candidate }
            }
        }
    }
    $unique = @($found | Group-Object -Property Command | ForEach-Object { $_.Group[0] })
    if ($unique.Count -eq 1) { return $unique[0] }
    if ($unique.Count -gt 1) {
        throw 'Multiple DSH installations were found. Start the one you want to update, then rerun this command.'
    }
    return $null
}

$dshCommand = Get-Command dsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$invocation = if ($dshCommand) {
    New-DshInvocation -Command $dshCommand.Source -Prefix @() -Label "official DSH on PATH, profile home $(Resolve-OfficialHome)" -NeedsPnpm $true -DshHomePath (Resolve-OfficialHome) -Node (Resolve-Node)
} else {
    Find-DshFromCurrentDirectory
}
if (-not $invocation) { $invocation = Find-RunningOfficialDsh }
if (-not $invocation) { $invocation = Find-CommonDsh }
if (-not $invocation) {
    throw 'DSH was not found. Install or start DeepSeek Harness, or run this helper from the DSH product folder. The helper will not temporarily install the full DSH dependency tree.'
}

Say "目标：$($invocation.Label)" "Target: $($invocation.Label)"
Say '正在通过 DSH 官方插件命令安装…' 'Installing through the official DSH plugin command...'
$oldPath = $env:PATH
$oldHome = $env:DSH_HOME
$oldPluginNode = $env:DSH_PLUGIN_NODE
try {
    if ($invocation.NeedsPnpm) {
        $pnpm = Get-Pnpm
        $env:DSH_PLUGIN_NODE = $invocation.Node
        $env:PATH = $pnpm.Directory + [IO.Path]::PathSeparator + (Split-Path -Parent $invocation.Node) + [IO.Path]::PathSeparator + $oldPath
        $env:DSH_HOME = $invocation.DshHomePath
        if ($invocation.UseDlx) {
            $invocation.Command = $pnpm.Command
            $invocation.Prefix = @('dlx', "@deepseek-ai/dsh@$dshRelease")
        }
    }
    $exitCode = Invoke-PluginAddWithReleaseAgeRecovery $invocation $packageSpec
    if ($exitCode -ne 0) { throw "DSH plugin command failed with exit code $exitCode." }
}
finally {
    $env:PATH = $oldPath
    $env:DSH_HOME = $oldHome
    $env:DSH_PLUGIN_NODE = $oldPluginNode
}
Say '安装完成。请保存工作并正常重启 DSH。' 'Installed. Save your work and restart DSH normally.'
