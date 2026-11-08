param(
    [string]$Locale = 'locales/en.json',
    [string]$Voice = 'Microsoft David Desktop',
    [string]$Out = 'test/fixtures/tts-en-david.json',
    [string]$Work = $env:TEMP
)
# Measures how long a Windows voice takes to say each line of a locale file that has no parameters:
# the line is synthesised at the default rate (SAPI rate 0, which speechSynthesis rate 1 maps to) into
# a 16 kHz mono WAV file, and its length is the number of samples over the sample rate. The result is
# the speech model of test/lesson-schedule.test.ts (measuredSpeech). Windows only; run from the
# repository root: powershell -File test/fixtures/measure-tts.ps1
Add-Type -AssemblyName System.Speech
$json = Get-Content -Raw -Encoding UTF8 $Locale | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = 0
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$wav = Join-Path $Work 'measure-tts-line.wav'
$seconds = [ordered]@{}
$keys = $json.PSObject.Properties | Where-Object { [string]$_.Value -notmatch '\{' } | Sort-Object Name
foreach ($p in $keys) {
    $synth.SetOutputToWaveFile($wav, $format)
    $synth.Speak([string]$p.Value)
    $synth.SetOutputToNull()
    $bytes = (Get-Item $wav).Length - 44
    $seconds[$p.Name] = [math]::Round($bytes / (16000 * 2), 3)
}
Remove-Item $wav -ErrorAction SilentlyContinue
$doc = [ordered]@{ about = 'Spoken length in seconds of each line without parameters, measured with test/fixtures/measure-tts.ps1.'; voice = $Voice; seconds = $seconds }
$doc | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 $Out
Write-Output ('measured ' + $seconds.Count + ' lines with ' + $Voice)
