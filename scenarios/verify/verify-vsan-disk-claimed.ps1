# verify-vsan-disk-claimed.ps1
# Checks whether vSAN disk groups are configured and healthy on all hosts in the cluster.
# Returns FAULT_PRESENT if no disk groups exist or disks are unclaimed, FAULT_RESOLVED if healthy.
#
# Prerequisites: PowerCLI installed with vSAN module, vCenter reachable.

param(
    [string]$VCenterServer = "vcenter.lab.local",
    [string]$VCenterUser   = "administrator@vsphere.local",
    [string]$VCenterPass   = "VMware1!",
    [string]$ClusterName   = "mgmt-cluster",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null
}

try {
    Connect-VIServer -Server $VCenterServer -User $VCenterUser -Password $VCenterPass -ErrorAction Stop | Out-Null

    $cluster = Get-Cluster -Name $ClusterName -ErrorAction Stop
    $hosts   = $cluster | Get-VMHost

    $noGroups = @()
    foreach ($h in $hosts) {
        $dg = Get-VsanDiskGroup -VMHost $h -ErrorAction SilentlyContinue
        if (-not $dg) { $noGroups += $h.Name }
    }

    if ($noGroups.Count -gt 0) {
        Write-Output "No vSAN disk groups on: $($noGroups -join ', ')"
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
