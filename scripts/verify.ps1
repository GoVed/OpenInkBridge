param(
    [switch]$SkipAndroid
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$ArgumentList = @()
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Native command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
}

Push-Location $repositoryRoot
try {
    Invoke-NativeChecked "cargo" @("fmt", "--all", "--check")
    Invoke-NativeChecked "cargo" @("clippy", "--locked", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings")
    Invoke-NativeChecked "cargo" @("test", "--locked", "--workspace", "--all-features")

    Invoke-NativeChecked "node" @(".\scripts\verify-versions.mjs")

    Push-Location "web"
    try {
        $env:npm_config_cache = Join-Path $env:TEMP "openinkbridge-npm-cache"
        Invoke-NativeChecked "npm" @("ci")
        Invoke-NativeChecked "npm" @("test")
        Invoke-NativeChecked "node" @("..\scripts\verify-sample-sync.mjs")
        Invoke-NativeChecked "npm" @("pack", "--dry-run", "--ignore-scripts")
    }
    finally {
        Pop-Location
    }

    if (-not $SkipAndroid) {
        Push-Location "android"
        try {
            Invoke-NativeChecked ".\gradlew.bat" @("--no-daemon", "--stacktrace", "testDebugUnitTest", "lintDebug", "assembleDebug")
        }
        finally {
            Pop-Location
        }
    }
}
finally {
    Pop-Location
}
