# verify-vcf-ssh-config.ps1
# Checks whether /etc/ssh/ssh_config on SDDC Manager contains the malformed line
# that breaks outbound SSH from the appliance.
# Returns FAULT_PRESENT if the malformed line is present, FAULT_RESOLVED if it is absent.
#
# Prerequisites: SSH access to SDDC Manager, plink or native SSH in PATH.

param(
    [string]$SDDCManagerIP   = "192.168.10.30",
    [string]$SDDCManagerUser = "vcf",
    [string]$SDDCManagerPass = "VMware1!",
    [string]$SshBin          = "ssh"
)

try {
    # Check for the malformed line in the SSH client config
    $cmd    = "grep -c '@PasswordAuthentication yes@' /etc/ssh/ssh_config || true"
    $result = & $SshBin -o StrictHostKeyChecking=no -o ConnectTimeout=10 `
                         "${SDDCManagerUser}@${SDDCManagerIP}" $cmd 2>&1

    if ($LASTEXITCODE -ne 0 -and $result -match "Permission denied|Connection refused|timed out") {
        Write-Output "ERROR: Cannot SSH to SDDC Manager — $result"
        exit 2
    }

    $count = [int]($result.Trim())
    if ($count -gt 0) {
        Write-Output "Malformed line present in /etc/ssh/ssh_config ($count occurrence(s))"
        Write-Output "FAULT_PRESENT"
    } else {
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
