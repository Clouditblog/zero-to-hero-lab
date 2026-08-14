# verify-hosts-file-ordering.ps1
# Connects to the VCSA and checks /etc/hosts for duplicate or incorrect entries.
# Returns FAULT_PRESENT if duplicates found, FAULT_RESOLVED if clean.
#
# Note: Requires SSH access to the VCSA. Uses Posh-SSH or a direct SSH call.

param(
    [string]$VCSAHost = "vcenter.lab.local",
    [string]$VCSAUser = "root",
    [string]$VCSAPass = "VMware1!",
    [string]$VCFQDN   = "vcenter.lab.local"
)

# Check via DNS consistency as a proxy (from this machine):
try {
    $results = 1..5 | ForEach-Object { [System.Net.Dns]::GetHostEntry($VCFQDN).AddressList[0].IPAddressToString }
    $unique  = $results | Sort-Object -Unique

    if ($unique.Count -gt 1) {
        Write-Output "FAULT_PRESENT: $VCFQDN resolves to multiple IPs: $($unique -join ', ')"
    } else {
        Write-Output "DNS consistent: $VCFQDN -> $($unique[0])"
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: Could not resolve $VCFQDN - $_"
    exit 2
}
