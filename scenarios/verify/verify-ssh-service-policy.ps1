# verify-ssh-service-policy.ps1
# Checks whether the SSH service is running on all ESXi hosts.
# Returns FAULT_PRESENT if SSH is stopped on any host, FAULT_RESOLVED if running on all.

param(
    [string]$vCenterServer = "vcenter.lab.local",
    [string]$vCenterUser   = "administrator@vsphere.local",
    [string]$vCenterPass   = "VMware1!"
)

Import-Module VMware.PowerCLI -ErrorAction Stop
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null

Connect-VIServer -Server $vCenterServer -User $vCenterUser -Password $vCenterPass -ErrorAction Stop | Out-Null

$sshServices = Get-VMHost | Get-VMHostService | Where-Object { $_.Key -eq "TSM-SSH" }
$stopped     = $sshServices | Where-Object { -not $_.Running }

if ($stopped.Count -gt 0) {
    $stopped | ForEach-Object { Write-Output "SSH stopped on: $($_.VMHost.Name)" }
    Write-Output "FAULT_PRESENT"
} else {
    Write-Output "SSH running on all hosts"
    Write-Output "FAULT_RESOLVED"
}

Disconnect-VIServer -Confirm:$false | Out-Null
