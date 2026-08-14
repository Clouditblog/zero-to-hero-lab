# verify-vcf-ntp-drift.ps1
# Checks whether ntpd is running and synchronised on SDDC Manager.
# Returns FAULT_PRESENT if NTP is not synced or the service is not running, FAULT_RESOLVED if healthy.
#
# Prerequisites: SSH access to SDDC Manager.

param(
    [string]$SDDCManagerIP   = "192.168.10.30",
    [string]$SDDCManagerUser = "vcf",
    [string]$SDDCManagerPass = "VMware1!",
    [string]$SshBin          = "ssh"
)

try {
    # Check ntpd service status and sync state in one command
    $cmd    = "systemctl is-active ntpd && ntpq -p 2>/dev/null | grep -E '^\*' | wc -l || echo 0"
    $result = & $SshBin -o StrictHostKeyChecking=no -o ConnectTimeout=10 `
                         "${SDDCManagerUser}@${SDDCManagerIP}" $cmd 2>&1

    if ($result -match "Connection refused|timed out|Permission denied") {
        Write-Output "ERROR: Cannot SSH to SDDC Manager — $result"
        exit 2
    }

    $lines      = $result -split "`n" | Where-Object { $_.Trim() -ne "" }
    $svcActive  = $lines[0].Trim() -eq "active"
    $syncedPeer = [int]($lines[1].Trim())

    if (-not $svcActive -or $syncedPeer -eq 0) {
        if (-not $svcActive)  { Write-Output "ntpd service is not active on SDDC Manager" }
        if ($syncedPeer -eq 0){ Write-Output "ntpd has no synchronised peer on SDDC Manager" }
        Write-Output "FAULT_PRESENT"
    } else {
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
