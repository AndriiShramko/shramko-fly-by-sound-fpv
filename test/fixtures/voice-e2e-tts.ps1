param(
    [Parameter(Mandatory = $true)][string]$Items
)
# Says each item of a JSON list [{"voice": "...", "text": "...", "wav": "..."}] (UTF-8) with the local Windows
# voice into a 16 kHz mono 16-bit WAV file, at the default rate (SAPI rate 0), as test/fixtures/measure-tts.ps1.
# Used by test/fixtures/make-voice-e2e.py for the end-to-end check of tools/listen/transcribe.py. Windows only.
Add-Type -AssemblyName System.Speech
$list = Get-Content -Raw -Encoding UTF8 $Items | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$n = 0
foreach ($it in $list) {
    $synth.SelectVoice([string]$it.voice)
    $synth.SetOutputToWaveFile([string]$it.wav, $format)
    $synth.Speak([string]$it.text)
    $synth.SetOutputToNull()
    $n++
}
Write-Output ('said ' + $n + ' items')
