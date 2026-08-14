# verify-ha-admission-control.ps1
# Checks whether all powered-on VMs in the cluster are showing as HA-protected.
# Returns FAULT_PRESENT if any VM is unprotected, FAULT_RESOLVED if all are protected.
#
# Prerequisites: PowerCLI installed, vCenter reachable.

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
    $vms = $cluster | Get-VM | Where-Object { $_.PowerState -eq "PoweredOn" }

    $unprotected = $vms | Where-Object {
        $_.ExtensionData.Summary.Runtime.DasVmProtection.DasProtected -eq $false
    }

    if ($unprotected) {
        foreach ($vm in $unprotected) {
            Write-Output "VM not HA-protected: $($vm.Name)"
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
