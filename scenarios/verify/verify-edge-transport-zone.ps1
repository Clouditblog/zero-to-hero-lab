# verify-edge-transport-zone.ps1
# Checks whether NSX Edge transport nodes are in an UP state for the overlay transport zone.
# Returns FAULT_PRESENT if any Edge node is not UP, FAULT_RESOLVED if all Edge nodes are UP.
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
    # Get all transport nodes (Edge type)
    $tn = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/transport-nodes?node_types=EdgeNode" -Headers $headers

    if (-not $tn.results -or $tn.results.Count -eq 0) {
        Write-Output "ERROR: No Edge transport nodes found"
        exit 2
    }

    $notUp = @()
    foreach ($node in $tn.results) {
        $status = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/transport-nodes/$($node.id)/status" -Headers $headers
        if ($status.tunnel_status -ne "UP") {
            $notUp += "$($node.display_name) (tunnel: $($status.tunnel_status))"
        }
    }

    if ($notUp.Count -gt 0) {
        foreach ($n in $notUp) { Write-Output "Edge node not UP: $n" }
        Write-Output "FAULT_PRESENT"
    } else {
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
