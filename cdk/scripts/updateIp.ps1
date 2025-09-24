param(
  [string]$Path = "lib/app-stack.ts"
)

# 1) Pobierz publiczne IPv4 i zbuduj CIDR
$ip = Invoke-RestMethod -Uri "https://api.ipify.org"
if (-not $ip) { throw "Nie udało się pobrać publicznego IP." }
$newCidr = "$ip/24"

# 2) Wczytaj plik
if (-not (Test-Path $Path)) { throw "Plik nie istnieje: $Path" }
$content = Get-Content -Raw -Path $Path

# 3) Znajdź blok NotIpAddress -> "aws:SourceIp": [ ... ]
$regex = [regex]'(?s)(NotIpAddress:\s*\{\s*"aws:SourceIp":\s*\[)(.*?)(\])'
$m = $regex.Match($content)
if (-not $m.Success) {
  throw 'Nie znaleziono fragmentu: NotIpAddress: { "aws:SourceIp": [ ... ] }'
}

$prefix = $m.Groups[1].Value
$inside = $m.Groups[2].Value
$suffix = $m.Groups[3].Value

# 4) Wyciągnij istniejące CIDRy (z cudzysłowów), oczyść, zuniifikuj
$cidrRegex = [regex]'"([^"]+)"'
$cidrs = @()
foreach ($mm in $cidrRegex.Matches($inside)) {
  $cidrs += $mm.Groups[1].Value.Trim()
}

# 5) Dodaj nowy CIDR, jeśli go nie ma
if ($cidrs -notcontains $newCidr) {
  $cidrs += $newCidr
}

# 6) Zachowaj wcięcia — policz indent linii, gdzie zaczyna się `NotIpAddress`
$before = $content.Substring(0, $m.Index)
$lastLine = ($before -split "`r?`n")[-1]
$baseIndent = ($lastLine -match '^\s*') | Out-Null; $baseIndent = $matches[0]
# wewnętrzne wcięcie (dla elementów tablicy)
$innerIndent = "$baseIndent  "  # +2 spacje — możesz zmienić na +4, jeśli wolisz

# 7) Zbuduj ładną tablicę, każdy wpis w nowej linii
#    Przykład:
#    "aws:SourceIp": [
#      "1.2.3.4/32",
#      "5.6.7.0/24"
#    ]
#    Bez dodatkowego przecinka po ostatnim elemencie.
$nl = "`r`n"
if ($cidrs.Count -eq 0) {
  $pretty = "$prefix$suffix"   # pusta tablica
} else {
  $lines = @()
  foreach ($c in $cidrs) { $lines += "$innerIndent`"$c`"" }
  $prettyArray = $nl + ($lines -join ("," + $nl)) + $nl + $baseIndent
  $pretty = "$prefix$prettyArray$suffix"
}

# 8) Podmień w treści
$updated = $regex.Replace($content, [System.Text.RegularExpressions.MatchEvaluator]{ param($_) $pretty }, 1)

# 9) Zapisz
Set-Content -Path $Path -Value $updated -Encoding UTF8

Write-Host "Zaktualizowano $Path. Aktualny wpis: $newCidr"
