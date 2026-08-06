$ErrorActionPreference = "Stop"

$DesktopDir = Split-Path -Parent $PSScriptRoot
$LibMpvDir = Join-Path $DesktopDir "libmpv"
$DllPath = Join-Path $LibMpvDir "libmpv-2.dll"
$DefPath = Join-Path $LibMpvDir "mpv.def"
$ImportLibraryPath = Join-Path $LibMpvDir "mpv.lib"

# Harbor publishes this known-good libmpv build for its Windows client.
# Override both values together when intentionally updating the runtime.
$DefaultUrl = "https://github.com/harborstremio/harbor/releases/download/mpvdll/libmpv-2.dll"
$DefaultSha256 = "E9C87D19055BC5A82771B2B48E9FBAE047BD5180603F5A1AAAE10C90CA690467"
$DownloadUrl = if ($env:CONDUIT_LIBMPV_URL) { $env:CONDUIT_LIBMPV_URL } else { $DefaultUrl }
$ExpectedSha256 = if ($env:CONDUIT_LIBMPV_SHA256) { $env:CONDUIT_LIBMPV_SHA256 } else { $DefaultSha256 }

function Get-Sha256([string]$Path) {
    $Stream = [System.IO.File]::OpenRead($Path)
    try {
        $Hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace("-", "")
        } finally {
            $Hasher.Dispose()
        }
    } finally {
        $Stream.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $LibMpvDir | Out-Null
if (-not (Test-Path $DllPath) -or
    (Get-Sha256 $DllPath) -ne $ExpectedSha256) {
    Write-Host "[libmpv] Downloading $DownloadUrl"
    Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -OutFile $DllPath
}

$ActualSha256 = Get-Sha256 $DllPath
if ($ActualSha256 -ne $ExpectedSha256) {
    Remove-Item $DllPath
    throw "libmpv checksum mismatch (expected $ExpectedSha256, got $ActualSha256)"
}

$DumpbinCommand = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
$LibCommand = Get-Command lib.exe -ErrorAction SilentlyContinue
$DumpbinPath = if ($DumpbinCommand) { $DumpbinCommand.Source } else { $null }
$LibExePath = if ($LibCommand) { $LibCommand.Source } else { $null }
if (-not $DumpbinPath -or -not $LibExePath) {
    $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $VsWhere) {
        $VsRoot = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        $ToolBin = Get-ChildItem (Join-Path $VsRoot "VC\Tools\MSVC\*\bin\Hostx64\x64") -Directory |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($ToolBin) {
            $DumpbinPath = Join-Path $ToolBin.FullName "dumpbin.exe"
            $LibExePath = Join-Path $ToolBin.FullName "lib.exe"
        }
    }
}
if (-not $DumpbinPath -or -not $LibExePath -or
    -not (Test-Path $DumpbinPath) -or -not (Test-Path $LibExePath)) {
    throw "Visual Studio C++ build tools (dumpbin.exe and lib.exe) were not found."
}

# The pinned runtime only contains the DLL. Generate the matching MSVC import
# library from its exported symbols so Rust cannot accidentally link a
# different mpv ABI installed elsewhere on the machine.
$Exports = & $DumpbinPath /nologo /exports $DllPath |
    Select-String '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)$' |
    ForEach-Object { $_.Matches[0].Groups[1].Value } |
    Where-Object { $_ -like "mpv_*" } |
    Sort-Object -Unique
if (-not $Exports) {
    throw "No libmpv exports were found in $DllPath"
}

@("LIBRARY libmpv-2.dll", "EXPORTS") + $Exports |
    Set-Content -Encoding ASCII $DefPath
& $LibExePath /nologo /def:$DefPath /out:$ImportLibraryPath /machine:x64
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ImportLibraryPath)) {
    throw "Failed to generate $ImportLibraryPath"
}

Write-Host "[libmpv] Ready: $DllPath"

$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $DesktopDir)
foreach ($Profile in @("debug", "release")) {
    $OutputDir = Join-Path $WorkspaceRoot "target\$Profile"
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    Copy-Item -Force $DllPath (Join-Path $OutputDir "libmpv-2.dll")
}
