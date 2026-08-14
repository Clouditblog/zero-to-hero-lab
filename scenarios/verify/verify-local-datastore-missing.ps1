# verify-local-datastore-missing.ps1
# Checks whether ESXi hosts have a local datastore and a properly configured scratch partition.
# Returns FAULT_PRESENT if scratch is on /tmp, FAULT_RESOLVED if on a persistent datastore.

param(
    [string]$vCenterServer = "vcenter.lab.local",
    [string]$vCenterUser   = "administrator@vsphere.local",
    [string]$vCenterPass   = "VMware1!"
)

Import-Module VMware.PowerCLI -ErrorAction Stop
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null

Connect-VIServer -Server $vCenterServer -User $vCenterUser -Password $vCenterPass -ErrorAction Stop | Out-Null

$faultFound = $false
foreach ($h in Get-VMHost) {
    $scratch = (Get-AdvancedSetting -Entity $h -Name "ScratchConfig.ConfiguredScratchLocation").Value
    if ($scratch -like "/tmp/*" -or $scratch -eq $null) {
        Write-Output "FAULT on $($h.Name): scratch = '$scratch' (not persistent)"
        $faultFound = $true
    } else {
        Write-Output "OK: $($h.Name) scratch = $scratch"
    }
}

if ($faultFound) { Write-Output "FAULT_PRESENT" } else { Write-Output "FAULT_RESOLVED" }
Disconnect-VIServer -Confirm:$false | Out-Null
