# verify-vm-snapshot-consolidation.ps1
# Checks whether a target VM has unconsolidated snapshots.
# Returns FAULT_PRESENT if consolidation is needed, FAULT_RESOLVED if the VM has no snapshot issues.
#
# Prerequisites: PowerCLI installed, vCenter reachable.

param(
    [string]$VCenterServer = "vcenter.lab.local",
    [string]$VCenterUser   = "administrator@vsphere.local",
    [string]$VCenterPass   = "VMware1!",
    [string]$VMName        = "app-server-01",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null
}

try {
    Connect-VIServer -Server $VCenterServer -User $VCenterUser -Password $VCenterPass -ErrorAction Stop | Out-Null

    $vm = Get-VM -Name $VMName -ErrorAction Stop

    # ConsolidationNeeded is set when delta disks exist outside the snapshot chain
    if ($vm.ExtensionData.Runtime.ConsolidationNeeded) {
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
