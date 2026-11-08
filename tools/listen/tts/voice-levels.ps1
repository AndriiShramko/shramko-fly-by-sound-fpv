# How loud the local Windows voices speak at a given utterance volume, the way Chrome's speechSynthesis drives
# them on Windows: SAPI 5 (ISpVoice) with a voice token of the desktop category or of the OneCore category (Chrome
# lists both; "Microsoft Mark" exists only in OneCore), SetVolume(volume x 100). The voice speaks to a WAV file,
# so nothing plays aloud. One 48 kHz 16-bit mono WAV per voice, volume and line: <name>__<volume>__<id>.wav.
# Windows PowerShell 5.1; this file is ASCII only. The levels are measured by measure-voices.py.
#   powershell -NoProfile -ExecutionPolicy Bypass -File voice-levels.ps1 -Lines lines.json -Out <dir> [-Volumes 100,87,74]
# lines.json: [{ "id": "fly.go", "text": "Go." }, ...] (UTF-8)
param(
    [Parameter(Mandatory = $true)][string]$Lines,
    [Parameter(Mandatory = $true)][string]$Out,
    [int[]]$Volumes = @(100, 87, 77, 74, 50)
)
$ErrorActionPreference = 'Stop'
$items = Get-Content -Raw -Encoding UTF8 -Path $Lines | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$categories = @(
    @{ kind = 'desktop'; id = 'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices' },
    @{ kind = 'onecore'; id = 'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices' }
)
foreach ($c in $categories) {
    $cat = New-Object -ComObject SAPI.SpObjectTokenCategory
    try { $cat.SetId($c.id, $false) } catch { continue }
    $tokens = $cat.EnumerateTokens()
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $token = $tokens.Item($i)
        $desc = $token.GetDescription()
        $lang = ''
        try { $lang = $token.GetAttribute('Language') } catch { $lang = '' }
        $safe = ($c.kind + '_' + ($desc -replace '[^A-Za-z0-9]+', '-')).Trim('-')
        foreach ($vol in $Volumes) {
            foreach ($it in $items) {
                $voice = New-Object -ComObject SAPI.SpVoice
                $voice.Voice = $token
                $voice.Volume = $vol
                $fmt = New-Object -ComObject SAPI.SpAudioFormat
                $fmt.Type = 39
                $stream = New-Object -ComObject SAPI.SpFileStream
                $stream.Format = $fmt
                $path = Join-Path $Out ($safe + '__' + $vol + '__' + $it.id + '.wav')
                $stream.Open($path, 3, $false)
                $voice.AudioOutputStream = $stream
                [void]$voice.Speak([string]$it.text, 0)
                $stream.Close()
                Write-Output ($c.kind + "`t" + $desc + "`t" + $lang + "`t" + $vol + "`t" + $path)
            }
        }
    }
}
