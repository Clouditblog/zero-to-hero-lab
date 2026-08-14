# verify-vcf-dns-ptr.ps1
# Checks whether PTR records exist for all nested ESXi host IPs in the lab spec.
# Returns FAULT_PRESENT if any reverse lookup fails, FAULT_RESOLVED if all pass.
#
# Prerequisites: DNS server reachable from the machine running this script.

param(
    [string[]]$HostIPs    = @("192.168.10.101", "192.168.10.102", "192.168.10.103", "192.168.10.104"),
    [string]  $DNSServer  = "192.168.10.10"
)

try {
    $failed = @()
    foreach ($ip in $HostIPs) {
        try {
            $result = Resolve-DnsName -Name $ip -Server $DNSServer -Type PTR -ErrorAction Stop
            if (-not $result) { $failed += $ip }
        } catch {
            $failed += $ip
        }
    }

    if ($failed.Count -gt 0) {
        Write-Output "PTR record missing for: $($failed -join ', ')"
        Write-Output "FAULT_PRESENT"
    } else {
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
