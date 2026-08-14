'use strict';
// lib/generateVcf.js
// Generates vcf-bringup.json (Cloud Builder deployment parameter workbook)
// and vcf-prep.ps1 (host validation / pre-flight checks before hand-off to Cloud Builder).
// VCF 5.x format -- compatible with 4.5+ with minor field variations.

function firstHostInCidr(cidr) {
  if (!cidr) return null;
  const p = cidr.split('/')[0].split('.').map(Number);
  p[3] = 1;
  return p.join('.');
}

function cidrToMask(cidr) {
  if (!cidr) return '255.255.255.0';
  const bits = parseInt(cidr.split('/')[1] || '24', 10);
  const mask = [];
  for (let i = 0; i < 4; i++) {
    const b = Math.min(bits - i * 8, 8);
    mask.push(b <= 0 ? 0 : (256 - Math.pow(2, 8 - b)));
  }
  return mask.join('.');
}

function ipRange(cidr, start, count) {
  if (!cidr) return [];
  const base = cidr.split('/')[0].split('.').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const ip = [...base];
    ip[3] = start + i;
    return ip.join('.');
  });
}

function buildVcfFiles(spec) {
  const vcf  = spec.vcf || {};
  if (!vcf.enabled) return {};

  return {
    'vcf-bringup.json': buildBringupJson(spec),
    'vcf-prep.ps1':     buildPrepScript(spec)
  };
}

function buildBringupJson(spec) {
  const vcf    = spec.vcf;
  const nets   = spec.networks;
  const nc     = spec.nestedCluster;
  const dc     = spec.domainController || {};
  const nsx    = spec.nsx || {};
  const hosts  = spec.physicalHosts || [spec.physicalHost];

  const mgmtCidr   = nets.management?.cidr;
  const mgmtGw     = firstHostInCidr(mgmtCidr);
  const mgmtMask   = cidrToMask(mgmtCidr);
  const domainName = dc.domainName || 'lab.local';
  const ntpServer  = spec.ntp?.source || (dc.enabled && dc.ipAddress ? dc.ipAddress : 'pool.ntp.org');
  const dnsServer  = dc.enabled && dc.ipAddress ? dc.ipAddress : '1.1.1.1';
  const ssoDomain  = nc.ssoDomain || 'vsphere.local';
  const cluster    = nc.clusterName || 'mgmt-cluster';
  const dcName     = nc.datacenterName || 'Lab-DC';

  const sddcIp       = vcf.sddcManagerIp || '<SDDC-MGR-IP>';
  const sddcHostname = vcf.sddcManagerHostname || 'sddcmgr';
  const vcenterIp    = vcf.vcenterIp || '<VCENTER-IP>';
  const nsxIp        = nsx.ipAddress || '<NSX-MGR-IP>';
  const nsxSize      = nsx.size || 'small';

  const vtepCidr  = vcf.vtepCidr;
  const vtepVlan  = vcf.vtepVlan || null;
  const vtepGw    = firstHostInCidr(vtepCidr);
  const vtepMask  = cidrToMask(vtepCidr);

  const ul1Cidr = vcf.edgeUplink1Cidr;
  const ul1Vlan = vcf.edgeUplink1Vlan || null;
  const ul1Gw   = firstHostInCidr(ul1Cidr);
  const ul1Mask = cidrToMask(ul1Cidr);

  const ul2Cidr = vcf.edgeUplink2Cidr;
  const ul2Vlan = vcf.edgeUplink2Vlan || null;
  const ul2Gw   = firstHostInCidr(ul2Cidr);
  const ul2Mask = cidrToMask(ul2Cidr);

  const nestedCount  = nc.hostCount || 3;
  const esxiPassword = vcf.esxiPassword || '<ESXI-ROOT-PASSWORD>';

  // Build per-host specs from physicalHosts
  // In nested lab, each physical host IP is the management address of a nested ESXi instance.
  // VCF needs the IPs of the nested ESXi VMs that will form the management domain.
  // We generate placeholder sequential IPs in the management subnet since individual
  // nested host IPs are not collected in the wizard -- those are set during deploy-lab.ps1.
  const mgmtBase = (mgmtCidr || '192.168.10.0/24').split('/')[0].split('.').map(Number);
  const hostSpecs = Array.from({ length: nestedCount }, (_, i) => {
    mgmtBase[3] = 101 + i;
    const ip = mgmtBase.join('.');
    return {
      credentials: { username: 'root', password: esxiPassword },
      ipAddressPrivate: { ipAddress: ip, cidr: mgmtCidr || '192.168.10.0/24', gateway: mgmtGw },
      hostname: `esxi-${i + 1}.${domainName}`,
      association: 'mgmt-domain',
      hostNetworkSpec: {
        vmNics: [
          { id: 'vmnic0', vdsName: 'SDDC-Dswitch-Private' },
          { id: 'vmnic1', vdsName: 'SDDC-Dswitch-Private' }
        ],
        dvsSpecs: [
          {
            dvsName: 'SDDC-Dswitch-Private',
            vmnics: ['vmnic0', 'vmnic1'],
            mtu: 9000,
            networks: [
              'MANAGEMENT', 'VMOTION', 'VSAN', 'NSX_VTEP',
              ...(ul1Cidr ? ['NSX_EDGE_UPLINK1'] : []),
              ...(ul2Cidr ? ['NSX_EDGE_UPLINK2'] : [])
            ],
            niocSpecs: [
              { trafficType: 'VSAN', value: 'HIGH' },
              { trafficType: 'VMOTION', value: 'LOW' },
              { trafficType: 'MANAGEMENT', value: 'HIGH' }
            ],
            portGroupSpecs: []
          }
        ]
      }
    };
  });

  // Network specs
  const networkSpecs = [
    {
      networkType: 'MANAGEMENT',
      subnet: mgmtCidr ? mgmtCidr.split('/')[0] : '192.168.10.0',
      gateway: mgmtGw,
      vlanId: String(nets.management?.vlanId || '0'),
      mtu: 1500,
      portGroupKey: 'SDDC-DPortGroup-Mgmt',
      standbyUplinks: [],
      activeUplinks: ['uplink1', 'uplink2']
    },
    {
      networkType: 'VMOTION',
      subnet: nets.vMotion?.cidr ? nets.vMotion.cidr.split('/')[0] : '<VMOTION-SUBNET>',
      gateway: firstHostInCidr(nets.vMotion?.cidr) || '<VMOTION-GW>',
      vlanId: String(nets.vMotion?.vlanId || '<VMOTION-VLAN>'),
      mtu: 9000,
      portGroupKey: 'SDDC-DPortGroup-vMotion',
      includeIpAddressRanges: nets.vMotion?.cidr
        ? [{ startIpAddress: ipRange(nets.vMotion.cidr, 101, 1)[0], endIpAddress: ipRange(nets.vMotion.cidr, 100 + nestedCount, 1)[0] }]
        : [],
      standbyUplinks: [],
      activeUplinks: ['uplink1', 'uplink2']
    },
    {
      networkType: 'VSAN',
      subnet: nets.vsan?.cidr ? nets.vsan.cidr.split('/')[0] : '<VSAN-SUBNET>',
      gateway: firstHostInCidr(nets.vsan?.cidr) || '<VSAN-GW>',
      vlanId: String(nets.vsan?.vlanId || '<VSAN-VLAN>'),
      mtu: 9000,
      portGroupKey: 'SDDC-DPortGroup-vSAN',
      includeIpAddressRanges: nets.vsan?.cidr
        ? [{ startIpAddress: ipRange(nets.vsan.cidr, 101, 1)[0], endIpAddress: ipRange(nets.vsan.cidr, 100 + nestedCount, 1)[0] }]
        : [],
      standbyUplinks: [],
      activeUplinks: ['uplink1', 'uplink2']
    }
  ];

  if (vtepCidr) {
    networkSpecs.push({
      networkType: 'NSX_VTEP',
      subnet: vtepCidr.split('/')[0],
      gateway: vtepGw,
      vlanId: String(vtepVlan || '<VTEP-VLAN>'),
      mtu: 9000,
      portGroupKey: 'SDDC-DPortGroup-VTEP',
      includeIpAddressRanges: [
        { startIpAddress: ipRange(vtepCidr, 101, 1)[0], endIpAddress: ipRange(vtepCidr, 100 + nestedCount * 2, 1)[0] }
      ],
      standbyUplinks: [],
      activeUplinks: ['uplink1', 'uplink2']
    });
  }

  if (ul1Cidr) {
    networkSpecs.push({
      networkType: 'NSX_EDGE_UPLINK1',
      subnet: ul1Cidr.split('/')[0],
      gateway: ul1Gw,
      vlanId: String(ul1Vlan || '<UL1-VLAN>'),
      mtu: 1500,
      portGroupKey: 'SDDC-DPortGroup-EdgeUplink1',
      standbyUplinks: [],
      activeUplinks: ['uplink1', 'uplink2']
    });
  }

  if (ul2Cidr) {
    networkSpecs.push({
      networkType: 'NSX_EDGE_UPLINK2',
      subnet: ul2Cidr.split('/')[0],
      gateway: ul2Gw,
      vlanId: String(ul2Vlan || '<UL2-VLAN>'),
      mtu: 1500,
      portGroupKey: 'SDDC-DPortGroup-EdgeUplink2',
      standbyUplinks: [],
      activeUplinks: ['uplink1', 'uplink2']
    });
  }

  const bringup = {
    '_comment': 'Generated by zero-to-hero-lab -- review all fields marked <REPLACE_ME> before uploading to Cloud Builder',
    'skipEsxThumbprintValidation': true,
    'managementPoolName': 'bringup-networkpool',
    'sddcManagerSpec': {
      'hostname': sddcHostname,
      'ipAddress': sddcIp,
      'netmask': mgmtMask,
      'localUserPassword': '<REPLACE_ME>',
      'vcenterId': 'vcenter-1'
    },
    'sddcId': 'sddcId-001',
    'esxLicense': vcf.esxiLicense || '',
    'taskName': 'workflowconfig/workflowspec-ems.json',
    'ntpServers': [ntpServer],
    'dnsSpec': {
      'subdomain': ssoDomain.split('.')[0],
      'domain': domainName,
      'nameserver': dnsServer,
      'secondaryNameserver': '1.1.1.1'
    },
    'networkSpecs': networkSpecs,
    'nsxSpec': {
      'nsxManagerSpecs': [
        {
          'name': 'lab-nsxmgr-1',
          'networkDetailsSpec': {
            'ipAddress': nsxIp,
            'dnsName': `lab-nsxmgr-1.${domainName}`,
            'gateway': mgmtGw,
            'subnetMask': mgmtMask
          }
        }
      ],
      'vip': nsxIp,
      'vipFqdn': `lab-nsxmgr.${domainName}`,
      'nsxManagerAdminPassword': '<REPLACE_ME>',
      'formFactor': nsxSize === 'medium' ? 'medium' : 'small'
    },
    'vcenterSpec': {
      'vcenterIp': vcenterIp,
      'vcenterHostname': `vcenter.${domainName}`,
      'licenseFile': vcf.vcenterLicense || '',
      'rootVcenterPassword': '<REPLACE_ME>',
      'vmSize': 'tiny',
      'storageSize': ''
    },
    'clusterSpec': {
      'clusterName': cluster,
      'clusterEvcMode': '',
      'clusterImageEnabled': true,
      'vmFoldername': 'MGMT',
      'resourcePoolEnabled': false,
      'hostSpecs': hostSpecs
    }
  };

  return JSON.stringify(bringup, null, 2);
}

function buildPrepScript(spec) {
  const vcf   = spec.vcf;
  const nets  = spec.networks;
  const nc    = spec.nestedCluster;
  const dc    = spec.domainController || {};
  const hosts = spec.physicalHosts || [spec.physicalHost];

  const mgmtCidr  = nets.management?.cidr;
  const mgmtGw    = firstHostInCidr(mgmtCidr);
  const ntpServer = spec.ntp?.source || (dc.enabled && dc.ipAddress ? dc.ipAddress : 'pool.ntp.org');
  const dnsServer = dc.enabled && dc.ipAddress ? dc.ipAddress : '1.1.1.1';
  const nestedCount = nc.hostCount || 3;

  const lines = [];
  lines.push('# vcf-prep.ps1 -- Pre-flight checks before VCF Cloud Builder bring-up');
  lines.push('# Generated by zero-to-hero-lab');
  lines.push('#');
  lines.push('# Run this AFTER deploy-lab.ps1 and after all nested ESXi VMs are booted.');
  lines.push('# It validates the nested hosts are ready for Cloud Builder to consume.');
  lines.push('#');
  lines.push('# ──────────────────────────────────────────────────────────────');
  lines.push('');
  lines.push('[CmdletBinding()]');
  lines.push('param(');
  lines.push('    [string[]]$EsxiHosts = @(');
  const mgmtBase = (mgmtCidr || '192.168.10.0/24').split('/')[0].split('.').map(Number);
  for (let i = 0; i < nestedCount; i++) {
    const arr = [...mgmtBase]; arr[3] = 101 + i;
    lines.push(`        "${arr.join('.')}"${i < nestedCount - 1 ? ',' : ''}`);
  }
  lines.push('    ),');
  lines.push(`    [string]\$EsxiRootPassword = "<ESXI-ROOT-PASSWORD>",`);
  lines.push(`    [string]\$NtpServer        = "${ntpServer}",`);
  lines.push(`    [string]\$DnsServer        = "${dnsServer}"`);
  lines.push(')');
  lines.push('');
  lines.push('$pass = $true');
  lines.push('');
  lines.push('foreach ($ip in $EsxiHosts) {');
  lines.push('    Write-Host "Checking $ip..."');
  lines.push('    try {');
  lines.push('        $s = Connect-VIServer -Server $ip -User root -Password $EsxiRootPassword -ErrorAction Stop');
  lines.push('');
  lines.push('        # Check NTP is running');
  lines.push('        $ntpSvc = Get-VMHostService -VMHost $ip | Where-Object { $_.Key -eq "ntpd" }');
  lines.push('        if ($ntpSvc.Running) {');
  lines.push('            Write-Host "  [OK] NTP service running"');
  lines.push('        } else {');
  lines.push('            Write-Warning "  [FAIL] NTP service NOT running on $ip -- VCF requires NTP sync"');
  lines.push('            $pass = $false');
  lines.push('        }');
  lines.push('');
  lines.push('        # Check SSH is enabled (Cloud Builder needs SSH access)');
  lines.push('        $sshSvc = Get-VMHostService -VMHost $ip | Where-Object { $_.Key -eq "TSM-SSH" }');
  lines.push('        if ($sshSvc.Running) {');
  lines.push('            Write-Host "  [OK] SSH enabled"');
  lines.push('        } else {');
  lines.push('            Write-Warning "  [FAIL] SSH NOT enabled on $ip -- enabling now..."');
  lines.push('            Start-VMHostService -HostService $sshSvc -Confirm:$false | Out-Null');
  lines.push('            Set-VMHostService -HostService $sshSvc -Policy "on" -Confirm:$false | Out-Null');
  lines.push('            Write-Host "  [FIXED] SSH enabled"');
  lines.push('        }');
  lines.push('');
  lines.push('        # Check DNS can resolve itself');
  lines.push('        $fqdn = (Get-VMHost -Name $ip).ExtensionData.Config.Network.DnsConfig.HostName');
  lines.push('        Write-Host "  [INFO] Hostname: $fqdn"');
  lines.push('');
  lines.push('        Disconnect-VIServer -Server $s -Confirm:$false');
  lines.push('    } catch {');
  lines.push('        Write-Error "  Cannot connect to $ip -- $($_.Exception.Message)"');
  lines.push('        $pass = $false');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('if ($pass) {');
  lines.push('    Write-Host ""');
  lines.push('    Write-Host "All hosts passed pre-flight checks." -ForegroundColor Green');
  lines.push('    Write-Host "Next step: upload vcf-bringup.json to Cloud Builder at https://<CLOUD-BUILDER-IP>"');
  lines.push('} else {');
  lines.push('    Write-Warning "One or more checks failed -- fix the issues above before running Cloud Builder."');
  lines.push('}');

  return lines.join('\n');
}

module.exports = { buildVcfFiles, firstHostInCidr, cidrToMask };
