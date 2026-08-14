# verify-vmotion-failing.ps1
# Checks whether vMotion vmkernel adapters are present and enabled on all hosts,
# and attempts a test vMotion between two hosts to confirm connectivity.
# Returns FAULT_PRESENT if the test migration fails, FAULT_RESOLVED if it succeeds.
#
# Prerequisites: PowerCLI installed, vCenter reachable, at least 2 hosts in the cluster.

param(
    [string]$VCenterServer = "vcenter.lab.local",
    [string]$VCenterUser   = "administrator@vsphere.local",
    [string]$VCenterPass   = "VMware1!",
    [string]$ClusterName   = "mgmt-cluster",
    [string]$TestVMName    = "test-vm-01",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null
}

try {
    Connect-VIServer -Server $VCenterServer -User $VCenterUser -Password $VCenterPass -ErrorAction Stop | Out-Null

    $hosts = Get-Cluster -Name $ClusterName -ErrorAction Stop | Get-VMHost
    if ($hosts.Count -lt 2) {
        Write-Output "ERROR: Need at least 2 hosts to test vMotion"
        exit 2
    }

    # Check vMotion vmkernel exists on all hosts
    $missing = @()
    foreach ($h in $hosts) {
        $vmk = Get-VMHostNetworkAdapter -VMHost $h -VMKernel | Where-Object { $_.VMotionEnabled }
        if (-not $vmk) { $missing += $h.Name }
    }

    if ($missing.Count -gt 0) {
        Write-Output "vMotion vmkernel missing or disabled on: $($missing -join ', ')"
        Write-Output "FAULT_PRESENT"
    } else {
        # Attempt a test vMotion
        $vm = Get-VM -Name $TestVMName -ErrorAction SilentlyContinue
        if (-not $vm) {
            Write-Output "FAULT_RESOLVED"
            return
        }
        $srcHost = $vm.VMHost
        $dstHost = $hosts | Where-Object { $_.Name -ne $srcHost.Name } | Select-Object -First 1
        $task = Move-VM -VM $vm -Destination $dstHost -ErrorAction Stop
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "FAULT_PRESENT"
} finally {
    Disconnect-VIServer -Confirm:$false -ErrorAction SilentlyContinue
}
