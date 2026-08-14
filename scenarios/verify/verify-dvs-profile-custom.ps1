# verify-dvs-profile-custom.ps1
# Checks the teaming policy on the vSAN distributed port group.
# Returns FAULT_PRESENT if policy is Custom or not recommended, FAULT_RESOLVED otherwise.

param(
    [string]$vCenterServer   = "vcenter.lab.local",
    [string]$vCenterUser     = "administrator@vsphere.local",
    [string]$vCenterPass     = "VMware1!",
    [string]$vSANPortGroup   = "vSAN"
)

Import-Module VMware.PowerCLI -ErrorAction Stop
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null

Connect-VIServer -Server $vCenterServer -User $vCenterUser -Password $vCenterPass -ErrorAction Stop | Out-Null

$pg = Get-VDPortgroup | Where-Object { $_.Name -like "*$vSANPortGroup*" } | Select-Object -First 1
if (-not $pg) { Write-Output "ERROR: Could not find vSAN port group matching '$vSANPortGroup'"; exit 2 }

$spec = $pg.ExtensionData.Config.DefaultPortConfig.UplinkTeamingPolicy
$policy = $spec.Policy.Value

if ($policy -eq "custom" -or $policy -eq $null) {
    Write-Output "FAULT_PRESENT: vSAN port group teaming policy is '$policy'"
} else {
    Write-Output "Teaming policy: $policy"
    Write-Output "FAULT_RESOLVED"
}

Disconnect-VIServer -Confirm:$false | Out-Null
