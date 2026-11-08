# Speech clips for the virtual listener's rig, made with the Windows desktop voices (SAPI 5 through
# System.Speech): the local voices Chrome's speechSynthesis offers on Windows. One 48 kHz 16-bit mono WAV
# per line, named by the line's id. Windows PowerShell 5.1; this file is ASCII only.
#   powershell -NoProfile -ExecutionPolicy Bypass -File sapi-clips.ps1 -Lines lines.json -Out <dir>
#     [-Voice "Microsoft David Desktop"] [-Volume 100] [-Rate 0]
# lines.json: [{ "id": "fly.go", "text": "Go." }, ...] (UTF-8)
param(
    [Parameter(Mandatory = $true)][string]$Lines,
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Voice = 'Microsoft David Desktop',
    [int]$Volume = 100,
    [int]$Rate = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 -Path $Lines | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($it in $items) {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoice($Voice)
    $s.Volume = $Volume
    $s.Rate = $Rate
    $path = Join-Path $Out ($it.id + '.wav')
    $s.SetOutputToWaveFile($path, $fmt)
    $s.Speak([string]$it.text)
    $s.Dispose()
    Write-Output $path
}
