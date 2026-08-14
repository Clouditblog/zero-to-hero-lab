# verify-mgmt-vlan-mismatch.ps1
# Checks whether ESXi hosts are connected to vCenter.
# Returns FAULT_PRESENT if any host is Not Responding, FAULT_RESOLVED if all are Connected.
#
# Prerequisites: PowerCLI installed, vCenter accessible.

param(
    [string]$vCenterServer = "vcenter.lab.local",
    [string]$vCenterUser   = "administrator@vsphere.local",
    [string]$vCenterPass   = "VMware1!"
)

Import-Module VMware.PowerCLI -ErrorAction Stop
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null

Connect-VIServer -Server $vCenterServer -User $vCenterUser -Password $vCenterPass -ErrorAction Stop | Out-Null

$hosts = Get-VMHost
$notResponding = $hosts | Where-Object { $_.ConnectionState -ne "Connected" }

if ($notResponding.Count -gt 0) {
    $notResponding | ForEach-Object { Write-Output "Host $($_.Name) state: $($_.ConnectionState)" }
    Write-Output "FAULT_PRESENT"
} else {
    Write-Output "All $($hosts.Count) hosts Connected"
    Write-Output "FAULT_RESOLVED"
}

Disconnect-VIServer -Confirm:$false | Out-Null
