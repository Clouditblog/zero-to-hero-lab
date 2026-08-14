# verify-monitor-allow-legacy-cpu.ps1
# Checks whether nested ESXi VMs have monitor.allowLegacyCPU=true set.
# Returns FAULT_PRESENT if any nested ESXi VM is missing the parameter, FAULT_RESOLVED if all have it.

param(
    [string]$vCenterServer   = "vcenter.lab.local",
    [string]$vCenterUser     = "administrator@vsphere.local",
    [string]$vCenterPass     = "VMware1!",
    [string]$VMNamePattern   = "esxi*"
)

Import-Module VMware.PowerCLI -ErrorAction Stop
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null

Connect-VIServer -Server $vCenterServer -User $vCenterUser -Password $vCenterPass -ErrorAction Stop | Out-Null

$vms = Get-VM -Name $VMNamePattern
$faultFound = $false

foreach ($vm in $vms) {
    $setting = Get-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU"
    if (-not $setting -or $setting.Value -ne "true") {
        Write-Output "FAULT on $($vm.Name): monitor.allowLegacyCPU = $($setting.Value)"
        $faultFound = $true
    } else {
        Write-Output "OK: $($vm.Name) monitor.allowLegacyCPU=true"
    }
}

if ($faultFound) { Write-Output "FAULT_PRESENT" } else { Write-Output "FAULT_RESOLVED" }
Disconnect-VIServer -Confirm:$false | Out-Null
