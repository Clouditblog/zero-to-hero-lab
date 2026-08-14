# verify-host-disconnected.ps1
# Checks whether all ESXi hosts in the inventory are in a Connected state.
# Returns FAULT_PRESENT if any host is disconnected or not responding, FAULT_RESOLVED if all are connected.
#
# Prerequisites: PowerCLI installed, vCenter reachable.

param(
    [string]$VCenterServer = "vcenter.lab.local",
    [string]$VCenterUser   = "administrator@vsphere.local",
    [string]$VCenterPass   = "VMware1!",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null
}

try {
    Connect-VIServer -Server $VCenterServer -User $VCenterUser -Password $VCenterPass -ErrorAction Stop | Out-Null

    $disconnected = Get-VMHost | Where-Object { $_.ConnectionState -ne "Connected" }

    if ($disconnected) {
        foreach ($h in $disconnected) {
            Write-Output "Host $($h.Name) is $($h.ConnectionState)"
        }
        Write-Output "FAULT_PRESENT"
    } else {
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
} finally {
    Disconnect-VIServer -Confirm:$false -ErrorAction SilentlyContinue
}
