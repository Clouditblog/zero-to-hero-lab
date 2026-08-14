# verify-dfw-blocking.ps1
# Checks whether east-west connectivity is restored between two named VMs on NSX segments.
# Returns FAULT_PRESENT if the target VM is unreachable from source, FAULT_RESOLVED if reachable.
#
# Prerequisites: NSX Manager and vCenter accessible. Source VM must have VMware Tools installed.

param(
    [string]$VCenterServer  = "vcenter.lab.local",
    [string]$VCenterUser    = "administrator@vsphere.local",
    [string]$VCenterPass    = "VMware1!",
    [string]$SourceVMName   = "app-server-01",
    [string]$TargetVMName   = "app-server-02",
    [string]$TargetIP       = "172.16.10.11",
    [string]$GuestUser      = "root",
    [string]$GuestPass      = "VMware1!",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null
}

try {
    Connect-VIServer -Server $VCenterServer -User $VCenterUser -Password $VCenterPass -ErrorAction Stop | Out-Null

    $cred = New-Object System.Management.Automation.PSCredential($GuestUser, (ConvertTo-SecureString $GuestPass -AsPlainText -Force))
    $vm   = Get-VM -Name $SourceVMName -ErrorAction Stop

    # Run ping from inside the source VM via Invoke-VMScript
    $result = Invoke-VMScript -VM $vm -ScriptText "ping -c 2 -W 1 $TargetIP > /dev/null 2>&1 && echo OK || echo FAIL" `
                              -GuestCredential $cred -ScriptType Bash -ErrorAction Stop

    if ($result.ScriptOutput.Trim() -eq "OK") {
        Write-Output "FAULT_RESOLVED"
    } else {
        Write-Output "FAULT_PRESENT"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
} finally {
    Disconnect-VIServer -Confirm:$false -ErrorAction SilentlyContinue
}
