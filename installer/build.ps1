# Renuxcord, a Vencord-based Discord client mod
# Copyright (c) 2026 Larpbase
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Builds RenuxcordInstaller.exe with the C# compiler that ships with Windows (.NET Framework 4.x).
#   powershell -ExecutionPolicy Bypass -File installer/build.ps1 [-Repo owner/repo] [-Out dist/RenuxcordInstaller.exe]

param(
    [string]$Repo,
    [string]$Out = "dist/RenuxcordInstaller.exe"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

if (-not $Repo) {
    $remote = (git -C $root remote get-url origin 2>$null)
    if ($remote -match "github\.com[:/](.+?)(\.git)?$") { $Repo = $Matches[1] }
}
if (-not $Repo) { throw "Pass -Repo owner/repo (no GitHub origin remote found)" }

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "The .NET Framework 4 C# compiler wasn't found" }

$work = Join-Path ([IO.Path]::GetTempPath()) ("renuxcord-installer-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null

try {
    # Icon: the logo (orange rounded square with a dark R), written as a PNG-backed .ico
    Add-Type -AssemblyName System.Drawing
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"
    $g.TextRenderingHint = "AntiAliasGridFit"
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 90, 44))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 128
    $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $font = New-Object System.Drawing.Font "Segoe UI Black", 120, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = "Center"; $fmt.LineAlignment = "Center"
    $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(12, 12, 13))
    $g.DrawString("R", $font, $ink, (New-Object System.Drawing.RectangleF 0, 6, $size, $size), $fmt)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray()
    $ico = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter $ico
    $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
    $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
    $w.Write($png)
    $iconPath = Join-Path $work "renuxcord.ico"
    [IO.File]::WriteAllBytes($iconPath, $ico.ToArray())

    $source = (Get-Content (Join-Path $here "RenuxcordInstaller.cs") -Raw).Replace("RENUXCORD_REPO_PLACEHOLDER", $Repo)
    $sourcePath = Join-Path $work "RenuxcordInstaller.cs"
    [IO.File]::WriteAllText($sourcePath, $source)

    $outPath = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null

    & $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$outPath" "/win32icon:$iconPath" `
        /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
        $sourcePath
    if ($LASTEXITCODE -ne 0) { throw "csc failed" }

    Write-Host "Built $outPath for $Repo"
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
