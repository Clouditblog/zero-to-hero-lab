# verify-storage-all-paths-down.ps1
# Checks whether a named datastore has active storage paths on all hosts.
# Returns FAULT_PRESENT if the datastore is inaccessible on any host, FAULT_RESOLVED if accessible everywhere.
#
# Prerequisites: PowerCLI installed, vCenter reachable.

param(
    [string]$VCenterServer = "vcenter.lab.local",
    [string]$VCenterUser   = "administrator@vsphere.local",
    [string]$VCenterPass   = "VMware1!",
    [string]$DatastoreName = "shared-ds-01",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null
}

try {
    Connect-VIServer -Server $VCenterServer -User $VCenterUser -Password $VCenterPass -ErrorAction Stop | Out-Null

    $ds = Get-Datastore -Name $DatastoreName -ErrorAction Stop

    # Check datastore state on each host it is mounted on
    $inaccessible = @()
    foreach ($mount in $ds.ExtensionData.Host) {
        $hostRef   = $mount.Key
        $mountInfo = $mount.MountInfo
        if ($mountInfo.Accessible -eq $false) {
            $vmhost = Get-VMHost | Where-Object { $_.ExtensionData.Self -eq $hostRef }
            $inaccessible += $vmhost.Name
        }
    }

    if ($inaccessible.Count -gt 0) {
        Write-Output "Datastore inaccessible on: $($inaccessible -join ', ')"
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
