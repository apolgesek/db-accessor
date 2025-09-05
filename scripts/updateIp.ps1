# Plik wejściowy
$path = "../cdk/lib/app-stack.ts"

$ip = Invoke-RestMethod -Uri "https://api.ipify.org"

$newCidr = "$ip/32"
$content = Get-Content -Path $path -Raw

# UWAGA: regex szuka IP/CIDR w formacie "xxx.xxx.xxx.xxx/yy"
$updated = $content -replace '\d{1,3}(\.\d{1,3}){3}/\d{1,2}', $newCidr

Set-Content -Path $path -Value $updated -Encoding UTF8

Write-Output "IP address updated in app stack: $newCidr"
