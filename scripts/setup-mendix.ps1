<#
.SYNOPSIS
Mendix dump-it otomatik kurulum ve export
.DESCRIPTION
Belirtilen Mendix proje klasörünü bulur, dump-it repo'sunu hazırlar, mxlocal verify/selftest yapar, .gitignore günceller ve mxcontext ile -context klasörünü üretir. OpenCode kullanıma hazır hale gelir.
.PARAMETER ProjectFolder
Mendix proje klasörü veya .mpr dosyası
.PARAMETER DumpItPath
dump-it repo yolu. Varsayılan C:\Users\dies-\Mendix\dump-it
.PARAMETER NoInstall
Sadece kontrol yap, araç kurma
#>

param(
    [Parameter(Mandatory=$true)][string]$ProjectFolder,
    [string]$DumpItPath = "C:\Users\dies-\Mendix\dump-it",
    [switch]$NoInstall
)

$ErrorActionPreference = "Stop"
Write-Host "=== Mendix dump-it otomatik kurulum ===" -ForegroundColor Cyan

# Yardımcılar
function Test-Command($name){ return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# 1. Proje bul
$projResolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ProjectFolder)
if (-not (Test-Path $projResolved)) { throw "Proje bulunamadı: $ProjectFolder" }

if (Test-Path -Path $projResolved -PathType Leaf -Filter *.mpr) {
    $mpr = $projResolved
    $projectDir = Split-Path $mpr
} elseif (Test-Path -Path $projResolved -PathType Container) {
    $mprs = Get-ChildItem -Path $projResolved -Filter *.mpr -File
    if ($mprs.Count -eq 0) { throw "Proje klasöründe .mpr bulunamadı" }
    if ($mprs.Count -gt 1) { throw "Birden fazla .mpr var, doğrudan .mpr dosyası ver" }
    $mpr = $mprs[0].FullName
    $projectDir = $projResolved
} else {
    throw "Geçersiz proje yolu"
}
Write-Host "Proje: $mpr" -ForegroundColor Green

# 2. Dump-it repo
if (-not (Test-Path $DumpItPath)) {
    Write-Host "dump-it bulunamadı, klonlanıyor..." -ForegroundColor Yellow
    git clone -b feature/local-sdk https://github.com/tariksubasi/dump-it.git $DumpItPath
}
Set-Location $DumpItPath
git fetch origin feature/local-sdk
git checkout feature/local-sdk

$mxcontext = Join-Path $DumpItPath "mxcontext.py"
$mxlocal = Join-Path $DumpItPath "mxlocal\mxlocal.js"
if (-not (Test-Path $mxlocal)) { throw "mxlocal eksik. Repo tam değil." }

# 3. Önkoşullar
$pythonCmd = if (Test-Command python) { "python" } elseif (Test-Command py) { "py" } else { throw "Python bulunamadı" }
$nodeVer = & node --version 2>$null
if (-not $nodeVer) { throw "Node bulunamadı" }
$nodeMajorMinor = $nodeVer.TrimStart('v')
if ([version]$nodeMajorMinor -lt [version]"22.13") { Write-Warning "Node $nodeVer < 22.13, mxlocal sorunlu olabilir" }

if (-not $NoInstall) {
    if (-not (Test-Command git)) { throw "git bulunamadı" }
}

# 4. .gitignore
$gitignore = Join-Path $projectDir ".gitignore"
if (Test-Path $gitignore) {
    $content = Get-Content $gitignore -Raw
    if ($content -notmatch "\.mxlocal-backup/") {
        Add-Content -Path $gitignore -Value "`n.mxlocal-backup/"
        Write-Host ".mxlocal-backup/ .gitignore'a eklendi" -ForegroundColor Green
    }
} else {
    New-Item -ItemType File -Path $gitignore -Force | Out-Null
    Add-Content -Path $gitignore -Value ".mxlocal-backup/"
}

# 5. Testler
$isMprV2 = Test-Path (Join-Path $projectDir "mprcontents")
if ($isMprV2) {
    Write-Host "verify..." -ForegroundColor Cyan
    & node $mxlocal verify --project $mpr
    Write-Host "selftest..." -ForegroundColor Cyan
    & node $mxlocal selftest --project $mpr --keep
} else {
    Write-Warning "MPR v1 tespit edildi, mxlocal değişiklik yapamaz"
}

# 6. Export
Write-Host "Export başlıyor..." -ForegroundColor Cyan
& $pythonCmd $mxcontext $mpr
$contextDir = "$projectDir-context"
if (-not (Test-Path $contextDir)) {
    $contextDir = Get-ChildItem -Path $projectDir -Directory | Where-Object { $_.Name -like "*-context" } | Select-Object -First 1 -ExpandProperty FullName
}
Write-Host "Context klasörü: $contextDir" -ForegroundColor Green

# 7. OpenCode hazır
$opencodeJson = Join-Path $contextDir "opencode.json"
if (Test-Path $opencodeJson) {
    Write-Host "OpenCode dosyaları hazır" -ForegroundColor Green
} else {
    Write-Warning "opencode.json bulunamadı"
}

# 8. Loglama altyapısı kopyala
$moduleName = "Ulug" # TODO: proje bazlı otomatik tespit
$targetJava = Join-Path $projectDir "javasource\$moduleName"
if (-not (Test-Path $targetJava)) { New-Item -ItemType Directory -Path $targetJava -Force | Out-Null }
Copy-Item "$DumpItPath\tools\autolog\LogSink.java" "$targetJava\" -Force
Copy-Item "$DumpItPath\tools\autolog\TraceContext.java" "$targetJava\" -Force
Copy-Item "$DumpItPath\tools\autolog\Journal.java" "$targetJava\" -Force
Write-Host "Log altyapısı kopyalandı: LogSink, TraceContext, Journal" -ForegroundColor Green

Write-Host "`nREADY" -ForegroundColor Cyan
Write-Host "cd `"$contextDir`" && opencode"
Write-Host "Komutlar: /degistir, /kontrol, /geri-al, /senkron"
