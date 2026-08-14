# verify-dns-ptr-missing.ps1
# Checks whether PTR records exist for ESXi hosts by performing reverse DNS lookups.
# Returns FAULT_PRESENT if any host IP has no PTR record, FAULT_RESOLVED if all resolve.

param(
    [string]$vCenterServer = "vcenter.lab.local",
    [string]$vCenterUser   = "administrator@vsphere.local",
    [string]$vCenterPass   = "VMware1!"
)

Import-Module VMware.PowerCLI -ErrorAction Stop
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null

Connect-VIServer -Server $vCenterServer -User $vCenterUser -Password $vCenterPass -ErrorAction Stop | Out-Null

$hosts = Get-VMHost
$faultFound = $false

foreach ($h in $hosts) {
    $ip = $h.Name  # Name is the connection IP or FQDN
    try {
        $result = [System.Net.Dns]::GetHostEntry($ip)
        Write-Output "OK: $ip resolves to $($result.HostName)"
    } catch {
        Write-Output "FAIL: No PTR for $ip"
        $faultFound = $true
    }
}

if ($faultFound) {
    Write-Output "FAULT_PRESENT"
} else {
    Write-Output "FAULT_RESOLVED"
}

Disconnect-VIServer -Confirm:$false | Out-Null
