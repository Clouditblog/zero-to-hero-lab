# verify-ssl-cert-localhost.ps1
# Checks whether the vCenter TLS certificate has a valid FQDN (not localhost.localdomain).
# Returns FAULT_PRESENT if cert CN/SAN shows localhost.localdomain, FAULT_RESOLVED otherwise.

param(
    [string]$VCenterFQDN = "vcenter.lab.local",
    [int]   $Port        = 443
)

try {
    $tcp  = New-Object System.Net.Sockets.TcpClient($VCenterFQDN, $Port)
    $ssl  = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { $true })
    $ssl.AuthenticateAsClient($VCenterFQDN)
    $cert = $ssl.RemoteCertificate
    $ssl.Close(); $tcp.Close()

    $subject = $cert.Subject
    $san     = $cert.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::DnsName, $false)

    if ($subject -match "localhost.localdomain" -or $san -match "localhost.localdomain") {
        Write-Output "FAULT_PRESENT: Certificate shows '$subject'"
    } else {
        Write-Output "Certificate OK: $subject"
        Write-Output "FAULT_RESOLVED"
    }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
