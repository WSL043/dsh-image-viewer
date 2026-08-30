[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $PackagePath,
    [string] $DshVersion = '0.1.1-rc.2',
    [string] $Profile = 'web',
    [string] $DshRunner = 'pnpm',
    [int] $StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$runner = Get-Command $DshRunner -CommandType Application -ErrorAction Stop | Select-Object -First 1
$runnerPrefix = @('--config.minimum-release-age=0', 'dlx', "@deepseek-ai/dsh@$DshVersion")
$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-image-viewer-official-' + [Guid]::NewGuid().ToString('N'))
$previousDshHome = $env:DSH_HOME
$env:DSH_HOME = Join-Path $acceptanceRoot 'dsh-home'
New-Item -ItemType Directory -Path $acceptanceRoot | Out-Null

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
    $process = Start-Process -FilePath $runner.Source -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
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
    } finally {
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null }
    }
}

try {
    Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $package, '--loglevel', 'error')
    Assert-InstalledOnce
    Start-And-ProbeWeb
    Invoke-Dsh @('plugin', '--profile', $Profile, 'remove', 'dsh-image-viewer', '--loglevel', 'error')
    Assert-Removed
    Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $package, '--loglevel', 'error')
    Assert-InstalledOnce
    Write-Host 'Official DSH image-viewer acceptance passed.'
} finally {
    $env:DSH_HOME = $previousDshHome
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $resolvedAcceptance = [IO.Path]::GetFullPath($acceptanceRoot)
    if ($resolvedAcceptance.StartsWith($resolvedTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedAcceptance) -like 'dsh-image-viewer-official-*') {
        Remove-Item -LiteralPath $resolvedAcceptance -Recurse -Force -ErrorAction SilentlyContinue
    }
}
