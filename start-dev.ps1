Set-Location "F:\Nexus\corps\web"
$job = Start-Job -ScriptBlock {
    Set-Location "F:\Nexus\corps\web"
    pnpm dev --hostname 0.0.0.0 2>&1
}
Start-Sleep -Seconds 25
Receive-Job $job -Keep