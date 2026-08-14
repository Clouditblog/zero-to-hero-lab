# verify-bgp-as-mismatch.ps1
# Checks whether the BGP session between T0 and VyOS is Established.
# Returns FAULT_PRESENT if the BGP peer is not Established, FAULT_RESOLVED if it is.
#
# Prerequisites: NSX-T Manager accessible, credentials configured below.

param(
    [string]$NSXManager   = "192.168.10.20",
    [string]$NSXUser      = "admin",
    [string]$NSXPassword  = "VMware1!VMware1!",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    # PowerShell 6+ — ignore cert errors for self-signed NSX Manager cert
    $PSDefaultParameterValues['Invoke-RestMethod:SkipCertificateCheck'] = $true
}

$base64Auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${NSXUser}:${NSXPassword}"))
$headers    = @{ Authorization = "Basic $base64Auth"; "Content-Type" = "application/json" }

try {
    # List Tier-0 gateways
    $t0s = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/logical-routers?router_type=TIER0" -Headers $headers
    if (-not $t0s.results -or $t0s.results.Count -eq 0) {
        Write-Output "ERROR: No Tier-0 gateways found"
        exit 2
    }
    $t0Id = $t0s.results[0].id

    # Get BGP neighbor summaries
    $bgpStatus = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/logical-routers/$t0Id/routing/bgp/neighbors/status" -Headers $headers

    $allEstablished = $true
    foreach ($neighbor in $bgpStatus.results) {
        if ($neighbor.connection_state -ne "ESTABLISHED") {
            $allEstablished = $false
            Write-Output "Peer $($neighbor.neighbor_address) state: $($neighbor.connection_state)"
        }
    }

    if ($allEstablished) {
        Write-Output "FAULT_RESOLVED"
    } else {
        Write-Output "FAULT_PRESENT"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
