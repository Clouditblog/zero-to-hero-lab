# verify-ntp-source-mismatch.ps1
# Checks whether ESXi hosts have NTP configured and the NTP service is running.
# Returns FAULT_PRESENT if NTP is not running or no server configured, FAULT_RESOLVED otherwise.

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
    $ntpServers = Get-VMHostNtpServer -VMHost $h
    $ntpService = Get-VMHostService -VMHost $h | Where-Object { $_.Key -eq "ntpd" }
    if (-not $ntpServers -or -not $ntpService.Running) {
        Write-Output "ISSUE on $($h.Name): NTP servers=$($ntpServers -join ',') Running=$($ntpService.Running)"
        $faultFound = $true
    } else {
        Write-Output "OK: $($h.Name) NTP=$($ntpServers -join ',')"
    }
}

if ($faultFound) { Write-Output "FAULT_PRESENT" } else { Write-Output "FAULT_RESOLVED" }
Disconnect-VIServer -Confirm:$false | Out-Null
