$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'release\win-unpacked'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\Cierres'
$marker = Join-Path $destination '.cierres-install.json'
if (-not (Test-Path -LiteralPath (Join-Path $source 'Cierres.exe'))) {
    throw 'Primero ejecuta npm run package.'
}
if ((Test-Path -LiteralPath $destination) -and -not (Test-Path -LiteralPath $marker)) {
    throw "La carpeta $destination ya existe y no pertenece a esta instalacion. No se modifico."
}
$running = Get-CimInstance Win32_Process -Filter "Name='Cierres.exe'" |
    Where-Object { $_.ExecutablePath -eq (Join-Path $destination 'Cierres.exe') }
if ($running) {
    throw 'Cierra Cierres antes de actualizar la aplicacion. Los datos se conservaran.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}
$bin = Join-Path $destination 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
$launcher = @'
@echo off
start "" "%~dp0..\Cierres.exe" %*
'@
$legacyLauncher = Join-Path $bin 'cierres.cmd'
if ((Test-Path -LiteralPath $legacyLauncher) -and
    (Get-Content -LiteralPath $legacyLauncher -Raw).Trim() -ne $launcher.Trim()) {
    throw 'El comando anterior fue modificado. No se eliminara automaticamente.'
}
$launcher | Set-Content -LiteralPath (Join-Path $bin 'closures.cmd') -Encoding ASCII
if (Test-Path -LiteralPath $legacyLauncher) {
    Remove-Item -LiteralPath $legacyLauncher -Force
}
@{ name = 'Cierres'; version = '1.0.0'; installedAt = (Get-Date).ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ })
if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') })) {
    $newPath = ($entries + $bin) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
}
$startMenu = [Environment]::GetFolderPath('Programs')
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut((Join-Path $startMenu 'Cierres.lnk'))
$shortcut.TargetPath = Join-Path $destination 'Cierres.exe'
$shortcut.WorkingDirectory = $destination
$shortcut.Description = 'Casos activos y cierres semanales, guardados localmente'
$shortcut.Save()
Write-Output "Aplicacion instalada: $destination"
Write-Output 'Abre una terminal nueva y ejecuta: closures'
Write-Output "Tracking persistente: $(Join-Path $env:APPDATA 'Cierres\tracking.sqlite')"
