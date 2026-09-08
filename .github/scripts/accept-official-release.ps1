[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $PackagePath,
    [string] $DshVersion = '0.1.2-rc.1',
    [string] $Profile = 'web',
    [string] $DshRunner = 'pnpm',
    [int] $StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$runner = Get-Command $DshRunner -CommandType Application -ErrorAction Stop | Select-Object -First 1
$runnerPrefix = @(
    '--config.minimum-release-age=0',
    'dlx',
    '--allow-build=fs-ext',
    '--allow-build=@deepseek-ai/dsh-subprocess-local',
    '--allow-build=@google/genai',
    '--allow-build=koffi',
    '--allow-build=node-pty',
    '--allow-build=protobufjs',
    "@deepseek-ai/dsh@$DshVersion"
)
$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-image-viewer-official-' + [Guid]::NewGuid().ToString('N'))
$previousDshHome = $env:DSH_HOME
$env:DSH_HOME = Join-Path $acceptanceRoot 'dsh-home'
$passed = $false
New-Item -ItemType Directory -Path $acceptanceRoot | Out-Null
$workspace = Join-Path $acceptanceRoot 'workspace'
New-Item -ItemType Directory -Path $workspace | Out-Null

function Invoke-Dsh {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    & $runner.Source @runnerPrefix @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Official DSH command failed with exit code $LASTEXITCODE." }
}

function Get-PluginList {
    $output = & $runner.Source @runnerPrefix plugin --profile $Profile list dsh-image-viewer --depth 0 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Official DSH plugin list failed.' }
    return $output
}

function Get-ComposedConfig {
    $output = & $runner.Source @runnerPrefix --profile $Profile --dump-config 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Official DSH config composition failed.' }
    return $output
}

function Assert-InstalledOnce {
    $list = Get-PluginList
    $config = Get-ComposedConfig
    if ([regex]::Matches($list, 'dsh-image-viewer@').Count -ne 1) { throw 'The candidate package is not installed exactly once.' }
    if ([regex]::Matches($config, 'id: wsl043-native-image-viewer').Count -ne 1) { throw 'The candidate bundle is not composed exactly once.' }
}

function Assert-Removed {
    $list = Get-PluginList
    $config = Get-ComposedConfig
    if ($list -match 'dsh-image-viewer@' -or $config -match 'id: wsl043-native-image-viewer') { throw 'The plugin remains after removal.' }
}

function Start-And-ProbeWeb {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([Net.IPEndPoint] $listener.LocalEndpoint).Port
    $listener.Stop()
    $stdout = Join-Path $acceptanceRoot 'web.stdout.log'
    $stderr = Join-Path $acceptanceRoot 'web.stderr.log'
    $arguments = @($runnerPrefix) + @('--profile', $Profile, '--no-open', '--port', [string] $port)
    $process = Start-Process -FilePath $runner.Source -ArgumentList $arguments -WorkingDirectory $workspace -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
        $response = $null
        $webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($process.HasExited) {
                $details = "$(Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue)`n$(Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)"
                throw "DSH Web exited before readiness. $details"
            }
            try {
                $startupLog = Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue
                $loggedUrl = [regex]::Match([string] $startupLog, 'dsh web:\s+(http://127\.0\.0\.1:' + $port + '/(?:\?token=[A-Za-z0-9_-]+)?)')
                $readinessUrl = if ($loggedUrl.Success) { $loggedUrl.Groups[1].Value } else { "http://127.0.0.1:$port/" }
                $response = Invoke-WebRequest -UseBasicParsing $readinessUrl -WebSession $webSession -TimeoutSec 2
                if ($response.StatusCode -eq 200) { break }
            } catch { Start-Sleep -Milliseconds 250 }
        }
        if (-not $response -or $response.StatusCode -ne 200 -or $response.Content -notmatch 'DeepSeek Harness') { throw 'DSH Web did not become ready with the candidate plugin.' }
        & node (Join-Path $PSScriptRoot '../../scripts/accept-browser.mjs') $readinessUrl $acceptanceRoot
        if ($LASTEXITCODE -ne 0) { throw 'Official image browser acceptance failed.' }
    } finally {
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null }
    }
}

try {
    Push-Location -LiteralPath $workspace
    Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $package, '--loglevel', 'error')
    Assert-InstalledOnce
    $ErrorActionPreference = 'Continue'
    try { & $runner.Source @runnerPrefix --profile headless 'Image viewer synthetic acceptance' *> (Join-Path $acceptanceRoot 'seed.log') }
    finally { $ErrorActionPreference = 'Stop' }
    $transcripts = @(Get-ChildItem -LiteralPath (Join-Path $env:DSH_HOME 'sessions') -Recurse -File | Where-Object { $_.Name -match '^session(\.v[1-9]\d*)?\.jsonl(\.zstd)?$' })
    if ($transcripts.Count -ne 1) { throw 'Official DSH did not create exactly one synthetic session; inspect seed.log.' }
    Start-And-ProbeWeb
    Invoke-Dsh @('plugin', '--profile', $Profile, 'remove', 'dsh-image-viewer', '--loglevel', 'error')
    Assert-Removed
    Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $package, '--loglevel', 'error')
    Assert-InstalledOnce
    Write-Host 'Official DSH image-viewer acceptance passed.'
    $passed = $true
} finally {
    Pop-Location
    $env:DSH_HOME = $previousDshHome
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $resolvedAcceptance = [IO.Path]::GetFullPath($acceptanceRoot)
    if ($passed -and $resolvedAcceptance.StartsWith($resolvedTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedAcceptance) -like 'dsh-image-viewer-official-*') {
        Remove-Item -LiteralPath $resolvedAcceptance -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not $passed) { Write-Host "Acceptance evidence retained: $acceptanceRoot" }
}
