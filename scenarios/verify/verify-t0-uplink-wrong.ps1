# verify-t0-uplink-wrong.ps1
# Checks whether the T0 BGP session is Established after the uplink IP fix.
# Returns FAULT_PRESENT if the BGP peer is not Established, FAULT_RESOLVED if it is.
#
# Prerequisites: NSX Manager accessible, credentials configured below.

param(
    [string]$NSXManager  = "192.168.10.20",
    [string]$NSXUser     = "admin",
    [string]$NSXPassword = "VMware1!VMware1!",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    $PSDefaultParameterValues['Invoke-RestMethod:SkipCertificateCheck'] = $true
}

$auth    = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${NSXUser}:${NSXPassword}"))
$headers = @{ Authorization = "Basic $auth"; "Content-Type" = "application/json" }

try {
    $t0s  = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/logical-routers?router_type=TIER0" -Headers $headers
    if (-not $t0s.results -or $t0s.results.Count -eq 0) {
        Write-Output "ERROR: No Tier-0 gateways found"
        exit 2
    }
    $t0Id = $t0s.results[0].id

    $bgp  = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/logical-routers/$t0Id/routing/bgp/neighbors/status" -Headers $headers

    $notEstablished = $bgp.results | Where-Object { $_.connection_state -ne "ESTABLISHED" }
    if ($notEstablished) {
        foreach ($peer in $notEstablished) {
            Write-Output "BGP peer $($peer.neighbor_address) state: $($peer.connection_state)"
        }
        Write-Output "FAULT_PRESENT"
    } else {
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
