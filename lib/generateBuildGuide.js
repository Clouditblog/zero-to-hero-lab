// lib/generateBuildGuide.js
//
// Produces build-guide.md: a sequential, numbered runbook for building the lab
// from scratch. Each step is tagged [AUTOMATED] or [MANUAL]. Steps are emitted
// only if the relevant component is part of the design.

const DEVICE_TYPE_LABELS = {
  nvme: 'NVMe', sata_ssd: 'SATA SSD', sas_ssd: 'SAS SSD', spinning_disk: 'Spinning disk'
};

const NESTED_DISK_PURPOSE_LABELS = {
  vsan_storage_pool: 'vSAN storage pool (ESA)',
  vsan_capacity:     'vSAN capacity tier (OSA)',
  vsan_cache:        'vSAN cache / performance tier (OSA)',
  local_datastore:   'Local datastore (host 1 only)',
  data:              'Additional data disk'
};

function buildBuildGuide(spec) {
  const ph = spec.physicalHost;
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const ra = spec.remoteAccess;
  const vyos = spec.vyos || {};
  const dc = spec.domainController || {};
  const vis = spec.vis || {};
  const localDs = spec.localDatastore || {};
  const wl = spec.workloadVms || {};
  const esxiVer = spec.esxiVersion || {};
  const nsx = spec.nsx || {};

  const mgmtCidr = nets.management?.cidr || '192.168.10.0/24';
  const mgmtGw = mgmtCidr.replace(/\.\d+\/\d+$/, '.1');
  const dcIp = dc.ipAddress || '<dc-ip>';
  const dcDomain = dc.domainName || 'lab.example.com';
  const vcSize = ra.vcenterDeploymentSize || 'small';
  const hasJumpboxVm = ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard');
  const jumpVmName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
  const jumpKeyName = jumpVmName;

  const out = [];
  let step = 0;
  const s = (title, tag) => `## Step ${++step}: ${title} [${tag}]`;

  out.push('# Lab Build Guide');
  out.push('');
  out.push(`Generated ${new Date(spec.generatedAt).toUTCString()} by zero-to-hero-lab.`);
  out.push('');
  out.push(
    'This is the build runbook -- follow the steps in order. Each step is tagged **[AUTOMATED]** ' +
    '(run the named script, it handles everything) or **[MANUAL]** (interactive work, here\'s what to do). ' +
    'For architecture context and IP addressing, see `design-doc.md`.'
  );
  out.push('');

  // =========================================================================
  // Learning objectives (learning mode only)
  // =========================================================================
  if (spec.learningMode) {
    out.push('## Learning objectives');
    out.push('');
    out.push('This lab build develops the following skills:');
    out.push('');

    const skills = ['ESXi installation and configuration', 'vCenter deployment and initial setup'];
    if (nc.vsanEnabled) skills.push('vSAN cluster formation and health monitoring');
    if (vyos.enabled)   skills.push('Virtual router and lab network foundation with VyOS');
    if (dc.enabled)     skills.push('Domain controller, DNS, and NTP services for the lab');
    if (vis.enabled)    skills.push('VIS Appliance deployment for DNS/NTP/DHCP/depot in a VCF lab');
    if (nsx.enabled) {
      skills.push('NSX deployment and T0/T1 gateway configuration');
      if (nsx.bgpEnabled) skills.push('BGP peering configuration between NSX T0 and VyOS');
    }
    if (spec.vcf && spec.vcf.enabled) skills.push('VCF bring-up and Cloud Builder deployment');
    skills.forEach((sk) => out.push(`- ${sk}`));
    out.push('');

    if (spec.useCase === 'certification') {
      out.push('### Certification mapping');
      out.push('');
      out.push('This lab covers the following exam objective areas:');
      out.push('');
      const objectives = ['VCP-VVF Admin -- ESXi and vCenter deployment and configuration'];
      if (nc.vsanEnabled) objectives.push('VCP-VVF Admin / VCAP Storage -- vSAN cluster configuration and management');
      if (nsx.enabled)    objectives.push('VCP-VCF Admin -- NSX deployment, segments, and gateway routing');
      if (nsx.bgpEnabled) objectives.push('VCAP Networking -- dynamic routing and BGP peering');
      if (spec.vcf && spec.vcf.enabled) objectives.push('VCP-VCF Admin -- management domain bring-up and SDDC Manager operations');
      objectives.forEach((o) => out.push(`- ${o}`));
      out.push('');
    }
  }

  // =========================================================================
  // Prerequisites
  // =========================================================================
  out.push('## Prerequisites');
  out.push('');
  out.push('Complete these before running anything.');
  out.push('');
  out.push('### Software to download');
  out.push('');
  out.push('| Software | Where to get it |');
  out.push('|---|---|');
  if (vyos.enabled) {
    out.push('| VyOS rolling release ISO | https://vyos.io/get-vyos/ (select "Rolling release") |');
  }
  if (dc.enabled) {
    out.push('| Windows Server 2022 ISO | MSDN / Visual Studio Subscriptions, or evaluation at Microsoft Evaluation Center |');
  }
  if (esxiVer.label) {
    out.push(`| ${esxiVer.label} ISO | Broadcom Customer Portal (formerly VMware Customer Connect) |`);
  }
  out.push('| VMware vCenter VCSA OVA | Broadcom Customer Portal -- same download page as ESXi |');
  if (hasJumpboxVm) {
    out.push('| Ubuntu Server 22.04 LTS ISO | https://ubuntu.com/download/server |');
  }
  out.push('');
  out.push('Place all ISOs in a datastore accessible from the physical ESXi host before starting.');
  out.push('');

  const storageDev = ph.storageDevices || [];
  if (storageDev.length > 0) {
    out.push('### Physical storage inventory');
    out.push('');
    out.push('| # | Type | Capacity |');
    out.push('|---|---|---|');
    storageDev.forEach((d, i) => {
      const capLabel = d.capacityGB >= 1000 ? `${(d.capacityGB / 1000).toFixed(1)} TB` : `${d.capacityGB} GB`;
      out.push(`| ${i + 1} | ${DEVICE_TYPE_LABELS[d.type] || d.type} | ${capLabel} |`);
    });
    out.push('');
    out.push('Ensure each disk is formatted and visible as a datastore in the physical ESXi host UI before running any scripts.');
    out.push('');
  }

  const additionalDisks = nc.additionalDisks || [];
  if (additionalDisks.length > 0) {
    out.push('### Nested host disk layout');
    out.push('');
    out.push('Virtual disks added to each nested ESXi host VM by `deploy-lab.ps1`:');
    out.push('');
    out.push('| Disk | Size | Purpose | Hosts |');
    out.push('|---|---|---|---|');
    out.push(`| Boot | ${nc.bootDiskGB}GB | ESXi system | All |`);
    additionalDisks.forEach((d) => {
      const hosts = d.purpose === 'local_datastore' ? 'Host 1 only' : 'All hosts';
      out.push(`| Additional | ${d.sizeGB}GB | ${NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose} | ${hosts} |`);
    });
    out.push('');
    const vsanAdditional = additionalDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache' || d.purpose === 'vsan_storage_pool');
    const vsanIsEsa = (nc.vsanArchitecture || 'esa') === 'esa';
    if (vsanAdditional.length > 0) {
      out.push(vsanIsEsa
        ? '**Do not format vSAN storage pool disks during ESXi installation.** `vsan-cluster.ps1` claims them as the ESA storage pool during cluster formation.'
        : '**Do not format vSAN cache or capacity disks during ESXi installation.** `vsan-cluster.ps1` claims them during cluster formation.');
      out.push('');
    }
    if (localDs.enabled) {
      out.push('The local datastore disk on host 1 **must be formatted** as VMFS immediately after installing ESXi on that host. Name it exactly `local-ds`.');
      out.push('');
    }
  }

  out.push('### Tools required on your workstation');
  out.push('');
  if (spec.esxiDeployMethod === 'ova') {
    out.push('**Both PowerCLI and govc are required.** `deploy-lab.ps1` uses `govc` for the nested');
    out.push('ESXi OVA import with no PowerCLI fallback (`Import-VApp`/`Get-OvfConfiguration` has');
    out.push('known reliability problems against a standalone ESXi host), but PowerCLI is still');
    out.push('needed for vSwitch/port group setup and post-import reconfiguration:');
  } else {
    out.push('Install **at least one** of the following (both is fine -- `vcenter-deploy.ps1` prefers `govc` when available):');
  }
  out.push('');
  out.push('**VMware PowerCLI** (Windows PowerShell):');
  out.push('```powershell');
  out.push('Install-Module VMware.PowerCLI -Scope CurrentUser -AllowClobber');
  out.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false');
  out.push('```');
  out.push('');
  out.push('**govc** (cross-platform CLI, faster for OVA deployment):');
  out.push('Download from: https://github.com/vmware/govmomi/releases -- place `govc` (or `govc.exe`) somewhere in your PATH.');
  out.push('');

  out.push('### Physical vSwitch configuration');
  out.push('');
  out.push(
    'The lab uses two virtual switches on the physical host: **vSwitch0** (your existing switch, ' +
    'with the physical NIC uplink) carries VyOS\'s WAN/upstream connection, and **vSwitch1** ' +
    '(no physical uplink, created automatically by `deploy-lab.ps1`) carries all internal lab ' +
    'traffic through a single **Nested-Trunk** port group set to VLAN **4095** (trunk -- passes ' +
    'every VLAN tag through). VyOS is the only thing that routes between the VLANs on that trunk; ' +
    'everything else (nested ESXi, the DC, the jumpbox, workload VMs) plugs into Nested-Trunk directly.'
  );
  out.push('');
  out.push(
    '`deploy-lab.ps1` also sets the three security settings nested ESXi needs on the Nested-Trunk ' +
    'port group automatically:'
  );
  out.push('');
  out.push('| Setting | Required value |');
  out.push('|---|---|');
  out.push('| Promiscuous mode | Accept |');
  out.push('| Forged transmits | Accept |');
  out.push('| MAC address changes | Accept |');
  out.push('');
  out.push(
    'No manual port-group setup should be required. If you create any additional port groups by ' +
    'hand, apply the same three settings: **Networking → Virtual switches → vSwitch1 → Edit → Security**.'
  );
  out.push('');


  // =========================================================================
  // VyOS
  // =========================================================================
  if (vyos.enabled) {
    out.push(s('Deploy VyOS VM', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\vyos-deploy.ps1 -VIServer <host-ip-or-fqdn> -Datastore <datastore-name> -WanPortGroupName <port-group>');
    out.push('```');
    out.push('');
    out.push('Reads the VyOS ISO path from `lab-config.json` (see PREREQUISITES.md), uploads it');
    out.push('to the datastore if needed, creates the `lab-vyos` VM shell, and attaches the ISO.');
    out.push('The VM is left powered off.');
    out.push('');

    out.push(s('Install VyOS', 'MANUAL'));
    out.push('');
    out.push('1. Power on `lab-vyos` in the physical ESXi UI and open the console.');
    out.push('2. At the VyOS live prompt, run:');
    out.push('   ```');
    out.push('   install image');
    out.push('   ```');
    out.push('3. Follow the prompts: accept defaults for disk and partition, set a password, confirm.');
    out.push('4. Reboot when prompted (remove the ISO or let it time out to boot from disk).');
    out.push('5. Log in with the password you set.');
    out.push('');

    out.push(s('Configure VyOS networking', 'MANUAL'));
    out.push('');
    out.push('Enter configuration mode (`configure`) and paste these commands. Adapt interface names and CIDRs to your environment:');
    out.push('');
    out.push('```');
    out.push('configure');
    out.push('');
    out.push('# WAN -- gets an IP from your home router via DHCP');
    out.push('set interfaces ethernet eth0 address dhcp');
    out.push('set interfaces ethernet eth0 description WAN');
    out.push('');
    out.push('# Management LAN');
    const mgmtGwCidr = mgmtCidr.replace(/\d+\/\d+$/, `1/${mgmtCidr.split('/')[1]}`);
    const mgmtVlanMode = nets.management?.mode;
    const mgmtVlanId = nets.management?.vlanId;
    const taggedMgmt = mgmtVlanMode === 'tagged' && mgmtVlanId;
    if (taggedMgmt) {
      out.push(`# Tagged management: VyOS uses a VLAN sub-interface (vif) on eth1 (Nested-Trunk)`);
      out.push(`# VLAN ID ${mgmtVlanId} must also be set on each nested ESXi host's management vmkernel port`);
      out.push(`set interfaces ethernet eth1 vif ${mgmtVlanId} address '${mgmtGwCidr}'`);
      out.push(`set interfaces ethernet eth1 vif ${mgmtVlanId} description Management`);
    } else {
      out.push(`set interfaces ethernet eth1 address '${mgmtGwCidr}'`);
      out.push('set interfaces ethernet eth1 description Management');
    }
    out.push('');
    out.push('# NAT: masquerade management traffic out the WAN interface');
    out.push('set nat source rule 100 outbound-interface eth0');
    out.push(`set nat source rule 100 source address '${mgmtCidr}'`);
    out.push("set nat source rule 100 translation address masquerade");
    out.push('');
    out.push('# DHCP on management network');
    const dhcpStart = mgmtCidr.replace(/\.\d+\/\d+$/, '.100');
    const dhcpStop = mgmtCidr.replace(/\.\d+\/\d+$/, '.200');
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' subnet-id '1'`);
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' range 0 start '${dhcpStart}'`);
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' range 0 stop '${dhcpStop}'`);
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option default-router '${mgmtGwCidr.split('/')[0]}'`);
    if (dc.enabled && dc.ipAddress) {
      out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option name-server '${dc.ipAddress}'`);
    } else {
      out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option name-server '8.8.8.8'`);
    }
    out.push('');
    if (vyos.networkMode === 'bgp') {
      out.push('# BGP peering (configure after basic NAT is confirmed working)');
      out.push('set protocols bgp system-as <your-ASN>');
      out.push('set protocols bgp neighbor <peer-ip> remote-as <peer-ASN>');
      out.push('set protocols bgp neighbor <peer-ip> address-family ipv4-unicast');
      out.push('');
    }
    const ntpSource = spec.ntp?.source || 'pool.ntp.org';
    out.push('');
    out.push('# NTP -- all lab components must reference the same time source');
    out.push(`set system ntp server '${ntpSource}'`);
    out.push('');
    out.push('commit');
    out.push('save');
    out.push('```');
    out.push('');
    out.push('**Verify:** from a machine on the management network, confirm you can ping the VyOS LAN interface and reach the internet through NAT.');
    out.push('');
  }

  // =========================================================================
  // Domain controller
  // =========================================================================
  if (dc.enabled) {
    const dcProfile    = dc.profile || 'dc-only';
    const dcVcpu   = dcProfile === 'dc-only' ? 2 : 4;
    const dcRamGB  = dcProfile === 'dc-only' ? 4 : 8;
    const dcDiskGB = dcProfile === 'dc-only' ? 60 : 100;
    const dcProfileLabel = dcProfile === 'dc-only' ? 'DC only' : dcProfile === 'dc-jumpbox' ? 'DC + Jumpbox' : 'DC + Jumpbox + File Server';
    const dcStorageDiskGB = dc.storageDiskGB || 200;

    const dcOnPhysicalNet = dc.networkPlacement === 'physical';

    out.push(s('Deploy domain controller VM', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\dc-deploy.ps1 -VIServer <host-ip-or-fqdn> -Datastore <datastore-name>');
    out.push('```');
    out.push('');
    out.push(`Reads the Windows Server ISO path from \`lab-config.json\`, uploads it to the datastore`);
    out.push(`if needed, creates the \`lab-dc-01\` VM shell (${dcVcpu} vCPU / ${dcRamGB}GB RAM / ${dcDiskGB}GB OS disk${dcProfile === 'dc-jumpbox-fileserver' ? ` + ${dcStorageDiskGB}GB storage disk` : ''}), and attaches the ISO. Profile: **${dcProfileLabel}**.`);
    if (dcOnPhysicalNet) {
      out.push('This DC is placed on your **physical/home network** (the WAN port group), not the lab network.');
    }
    out.push('');

    out.push(s('Install Windows Server', 'MANUAL'));
    out.push('');
    out.push('1. Power on `lab-dc` and open the console.');
    out.push('2. Install Windows Server 2022 -- choose **Desktop Experience** if you want a GUI.');
    out.push('3. After first boot, set a static IP:');
    out.push('   - IP address: `' + dcIp + '`');
    if (dcOnPhysicalNet) {
      out.push('   - Subnet mask: matching your physical/home network');
      out.push('   - Default gateway: your home router\'s IP (not VyOS -- this VM is not on the lab network)');
    } else {
      out.push('   - Subnet mask: matching your management CIDR');
      out.push('   - Default gateway: `' + mgmtGw + '` (VyOS LAN interface)');
    }
    out.push('   - DNS: `8.8.8.8` for now (you\'ll point it at itself after promotion)');
    out.push('');

    out.push(s('Promote to domain controller', 'MANUAL'));
    out.push('');
    out.push('Open PowerShell as Administrator on the DC:');
    out.push('');
    out.push('```powershell');
    out.push('Install-WindowsFeature AD-Domain-Services -IncludeManagementTools');
    out.push(`Install-ADDSForest -DomainName "${dcDomain}" -SafeModeAdministratorPassword (Read-Host -AsSecureString)`);
    out.push('```');
    out.push('');
    out.push('The server reboots automatically after promotion. Log back in after ~5 minutes.');
    out.push('');
    out.push('After reboot, set the DNS server on the DC\'s NIC to `127.0.0.1` (pointing at itself), ' +
      'and configure Windows Time to sync from an upstream NTP source:');
    out.push('');
    out.push('```powershell');
    out.push('Set-DnsClientServerAddress -InterfaceAlias "Ethernet*" -ServerAddresses 127.0.0.1');
    out.push('');
    out.push('# Configure DC as authoritative NTP server for the lab');
    out.push('# The DC syncs from pool.ntp.org; everything else in the lab syncs from the DC');
    out.push('w32tm /config /manualpeerlist:"pool.ntp.org" /syncfromflags:manual /reliable:YES /update');
    out.push('Restart-Service w32tm');
    out.push('w32tm /resync /force');
    out.push('```');
    out.push('');

    out.push(s('Verify DNS resolution', 'MANUAL'));
    out.push('');
    out.push('From another machine on the management network, confirm DNS works in both directions:');
    out.push('');
    out.push('```powershell');
    out.push(`Resolve-DnsName "dc.${dcDomain}" -Server ${dcIp}         # forward: name → IP`);
    out.push(`Resolve-DnsName ${dcIp} -Server ${dcIp}                   # reverse: IP → name`);
    out.push('```');
    out.push('');
    out.push(
      '**Both must work before you continue.** vCenter generates its TLS certificate from the FQDN you give ' +
      'it at install time. If forward DNS is broken, the certificate will be wrong and the environment will ' +
      'produce certificate errors that are painful to fix retroactively.'
    );
    out.push('');
    // Reverse DNS zone
    out.push(s('Create DNS reverse lookup zone and PTR records', 'MANUAL'));
    out.push('');
    out.push(
      'Forward DNS resolves a name to an IP. Reverse DNS resolves an IP back to a name. ' +
      '**Both directions must work.** Strict bring-up tooling (VCF, SDDC Manager) validates ' +
      'reverse DNS for every appliance and produces misleading "host unresponsive" errors when a PTR record is missing.'
    );
    out.push('');
    out.push('On the DC, open PowerShell as Administrator:');
    out.push('');
    out.push('```powershell');
    // Compute reverse zone name from mgmtCidr
    const revOctets = mgmtCidr.split('/')[0].split('.').slice(0, 3).reverse().join('.');
    const reverseZone = `${revOctets}.in-addr.arpa`;
    out.push(`# Create reverse lookup zone for ${mgmtCidr}`);
    out.push(`Add-DnsServerPrimaryZone -NetworkId "${mgmtCidr}" -ReplicationScope "Domain"`);
    out.push('');
    if (dc.ipAddress) {
      const dcLastOctet = dc.ipAddress.split('.')[3];
      out.push(`# PTR record for the DC itself`);
      out.push(`Add-DnsServerResourceRecordPtr -ZoneName "${reverseZone}" -Name "${dcLastOctet}" -PtrDomainName "lab-dc-01.${dcDomain}."`);
      out.push('');
    }
    if (vyos.enabled) {
      const vyosIp = mgmtCidr.replace(/\.\d+\/\d+$/, '.1');
      const vyosLastOctet = vyosIp.split('.')[3];
      out.push(`# PTR record for VyOS management interface`);
      out.push(`Add-DnsServerResourceRecordPtr -ZoneName "${reverseZone}" -Name "${vyosLastOctet}" -PtrDomainName "lab-vyos.${dcDomain}."`);
      out.push('');
    }
    out.push('# Add PTR records for each component as IPs are assigned during build:');
    out.push('# Add-DnsServerResourceRecordPtr -ZoneName "' + reverseZone + '" -Name "<last-octet>" -PtrDomainName "<fqdn>."');
    out.push('# Components needing PTR records: vcenter, nested-esxi-01 through 0N, jumpbox/wireguard');
    out.push('```');
    out.push('');
    out.push('Add PTR records for vCenter and each nested host as you assign their IPs during the build. ' +
      'Do not wait until the end -- vCenter\'s certificate is generated from the FQDN it resolves to at install time.');
    out.push('');

    out.push('Also update the VyOS DHCP config to hand out the DC\'s IP as the DNS server:');
    out.push('');
    out.push('```');
    out.push('configure');
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option name-server '${dcIp}'`);
    out.push('commit; save');
    out.push('```');
    out.push('');

    if (dc.hasJumpbox) {
      out.push(s('Configure RDP access (Jumpbox)', 'MANUAL'));
      out.push('');
      out.push('On `lab-dc-01`, open PowerShell as Administrator:');
      out.push('');
      out.push('```powershell');
      out.push('# Enable Remote Desktop');
      out.push('Set-ItemProperty -Path "HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server" -Name fDenyTSConnections -Value 0');
      out.push('');
      out.push('# Open Windows Firewall for RDP');
      out.push('Enable-NetFirewallRule -DisplayGroup "Remote Desktop"');
      out.push('```');
      out.push('');
      out.push('A pre-configured `lab-dc.rdp` file is included in your output zip. Double-click it from your desktop to connect -- it is pre-filled with the DC IP (`' + dcIp + '`) and the Administrator username.');
      out.push('');
      out.push('> **Tip:** Once connected, install any tools you need for the lab from the DC (PowerShell, browser, VMware tools) before moving on. The DC is the easiest place to run PowerCLI commands against the nested environment.');
      out.push('');
    }

    if (dc.hasFileServer) {
      out.push(s('Configure LabISOs file share (File Server)', 'MANUAL'));
      out.push('');
      out.push(`The DC has a second disk (${dcStorageDiskGB}GB) for ISO and software storage. On \`lab-dc-01\`, open PowerShell as Administrator:`);
      out.push('');
      out.push('```powershell');
      out.push('# Initialise the storage disk');
      out.push('$disk = Get-Disk | Where-Object PartitionStyle -eq "RAW" | Select-Object -First 1');
      out.push('$disk | Initialize-Disk -PartitionStyle GPT -PassThru |');
      out.push(`    New-Partition -AssignDriveLetter -UseMaximumSize |`);
      out.push('    Format-Volume -FileSystem NTFS -NewFileSystemLabel "LabISOs" -Confirm:$false');
      out.push('');
      out.push('# Create share folder and share it');
      out.push('$driveLetter = (Get-Partition -DiskNumber $disk.Number | Where-Object DriveLetter).DriveLetter');
      out.push('$sharePath = "$($driveLetter):\\LabISOs"');
      out.push('New-Item -ItemType Directory -Path $sharePath | Out-Null');
      out.push('New-SmbShare -Name "LabISOs" -Path $sharePath -FullAccess "Everyone"');
      out.push('```');
      out.push('');
      out.push('The share is accessible from any machine on the management network at `\\\\' + dcIp + '\\LabISOs`. Drop Windows Server, ESXi, and vCenter ISOs here so they are available to all VMs without copying them to each host.');
      out.push('');
      out.push('**Recommended files to stage on the share:**');
      out.push('- Windows Server 2022 ISO (for additional VMs)');
      out.push('- VMware Tools ISO');
      out.push('- Any PowerCLI or SDK installers your lab work requires');
      out.push('');
    }
  }

  // =========================================================================
  // VIS Appliance (William Lam's VCF Infrastructure Services Appliance)
  // =========================================================================
  if (vis.enabled) {
    out.push(s('Deploy the VIS Appliance', 'AUTOMATED'));
    out.push('');
    out.push(
      'VIS replaces the need for a separate domain controller for DNS, NTP, and DHCP in VCF ' +
      'deployments -- a single pre-built Ubuntu appliance covers all three, plus a software depot and ' +
      'container registry, with no Windows license required.'
    );
    out.push('');
    out.push('```powershell');
    out.push('.\\vis-deploy.ps1 -EsxiHostName <host-ip-or-fqdn>');
    out.push('```');
    out.push('');
    out.push(
      `Reads the VIS appliance OVA path from \`lab-config.json\` and deploys it via OVF Tool (\`ovftool\`) ` +
      `to nested-esxi-01. IP: \`${vis.ipAddress || '<VIS IP -- set in the wizard or pass -VisIp>'}\`.`
    );
    out.push('');
    out.push(s('Enable VIS services', 'MANUAL'));
    out.push('');
    out.push(
      'DNS, NTP, DHCP, depot, and registry services are all disabled by default on first boot. ' +
      `Browse to \`https://${vis.ipAddress || '<VIS IP>'}\` and enable the services this lab needs from the VIS web UI.`
    );
    out.push('');
    out.push(
      "Attribution: William Lam (williamlam.com) -- VCF Infrastructure Services Appliance " +
      "(https://lamw.github.io/vcf-infrastructure-service-appliance/)."
    );
    out.push('');
  }

  // =========================================================================
  // Nested ESXi
  // =========================================================================
  const isOva = spec.esxiDeployMethod === 'ova';

  if (isOva) {
    out.push(s('Deploy nested ESXi hosts via William Lam OVA', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    const exampleIps = Array.from({ length: nc.hostCount }, (_, i) => `192.168.10.${11 + i}`).join(',');
    out.push('.\\deploy-lab.ps1 \\');
    out.push('    -VIServer <physical-esxi-ip> \\');
    out.push('    -VMHostName <physical-esxi-hostname> \\');
    out.push('    -Datastore <datastore-name> \\');
    out.push(`    -NestedHostIPsCSV "${exampleIps}" \\`);
    out.push('    -MgmtSubnetMask 255.255.255.0 \\');
    out.push(`    -MgmtGateway ${mgmtGw} \\`);
    out.push(`    -MgmtDnsServer ${dcIp} \\`);
    out.push('    -NestedRootPassword (Read-Host -AsSecureString "Nested root password")');
    out.push('```');
    out.push('');
    out.push('Requires `govc` on your PATH (see Prerequisites) -- there is no PowerCLI fallback for');
    out.push('this import, since `Import-VApp`/`Get-OvfConfiguration` is unreliable against a');
    out.push('standalone ESXi host at this stage of the build.');
    out.push('');
    out.push('Reads the nested ESXi appliance OVA path from `lab-config.json` (`localPaths.nestedEsxiOva`),');
    out.push(`imports it via govc, and creates ${nc.hostCount} nested ESXi host${nc.hostCount === 1 ? '' : 's'} with ESXi pre-installed:`);
    const hostNames = Array.from({ length: Math.min(nc.hostCount, 4) }, (_, i) => `\`nested-esxi-0${i + 1}\``);
    if (nc.hostCount > 4) hostNames.push(`… (${nc.hostCount} total)`);
    out.push(hostNames.join(', '));
    out.push('');
    out.push(`Each VM: ${nc.vcpuPerHost} vCPU / ${nc.vramPerHostGB}GB RAM. OVF properties set hostname, IP, DNS, NTP, and root password on first boot -- no interactive install.`);
    if (additionalDisks.length > 0) {
      const vsanExtra = additionalDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache' || d.purpose === 'vsan_storage_pool');
      const localDsExtra = additionalDisks.find((d) => d.purpose === 'local_datastore');
      const vsanDiskLabel = (nc.vsanArchitecture || 'esa') === 'esa' ? 'storage pool' : 'capacity/cache';
      if (vsanExtra.length > 0) {
        out.push(`Additional vSAN ${vsanDiskLabel} disks per host: ${vsanExtra.map((d) => d.sizeGB + 'GB').join(', ')} (added before first boot -- do not format, vSAN claims them).`);
      }
      if (localDsExtra) {
        out.push(`Extra disk on \`nested-esxi-01\` only: ${localDsExtra.sizeGB}GB (format as VMFS after first boot -- name it \`local-ds\`).`);
      }
    }
    out.push('');
    out.push('> **OVA source:** Download for your ESXi version at https://williamlam.com/nested-virtualization/nested-esxi-virtual-appliance');
    out.push('> ESXi 8.x is free with a Broadcom Community account. ESXi 9.x requires a VCF/VVF subscription.');
    out.push('');
    out.push('**Wait for first-boot to complete** (~2--3 minutes per host) before continuing. Verify reachability:');
    out.push('```');
    out.push(`ping <nested-esxi-01-ip>   # confirm ESXi is up`);
    out.push('```');
    out.push('');
  } else {
    out.push(s('Deploy nested ESXi VMs and port groups', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\deploy-lab.ps1 `');
    out.push('    -VIServer <physical-esxi-ip> -VMHostName <hostname> -Datastore <ds> `');
    out.push('    -WizardIp <ip-of-this-machine>   # optional -- prints kickstart URL per host');
    out.push('```');
    out.push('');
    out.push('Reads the ESXi install ISO path from `lab-config.json` (`localPaths.esxiIso`), uploads');
    out.push(`it to the datastore if needed, creates ${nc.hostCount} nested VM shell${nc.hostCount === 1 ? '' : 's'} with port groups, then powers each VM on immediately.`);
    out.push(`Kickstart files are written to this output folder (\`ks-esxi-01.cfg\`${nc.hostCount > 1 ? ` … \`ks-esxi-${String(nc.hostCount).padStart(2, '0')}.cfg\`` : ''}).`);
    out.push('When `-WizardIp` is set, the script prints the exact `ks=` URL for each host as it powers on.');
    out.push('');
    out.push(`Each VM: ${nc.vcpuPerHost} vCPU / ${nc.vramPerHostGB}GB RAM / ${nc.bootDiskGB}GB boot disk.`);
    if (additionalDisks.length > 0) {
      const vsanExtra = additionalDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache' || d.purpose === 'vsan_storage_pool');
      const localDsExtra = additionalDisks.find((d) => d.purpose === 'local_datastore');
      const otherExtra = additionalDisks.filter((d) => !['vsan_capacity','vsan_cache','vsan_storage_pool','local_datastore'].includes(d.purpose));
      if (vsanExtra.length > 0) {
        out.push(`Plus per host: ${vsanExtra.map((d) => d.sizeGB + 'GB ' + (NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose) + ' VMDK').join(', ')} (leave unformatted -- vSAN claims them).`);
      }
      if (localDsExtra) {
        out.push(`Plus on \`nested-esxi-01\` only: ${localDsExtra.sizeGB}GB local-ds VMDK (format as VMFS after ESXi install).`);
      }
      if (otherExtra.length > 0) {
        out.push(`Plus per host: ${otherExtra.map((d) => d.sizeGB + 'GB ' + (NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose)).join(', ')}.`);
      }
    }
    out.push('');

    const vsanExtra = (nc.additionalDisks || []).filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache' || d.purpose === 'vsan_storage_pool');
    const taggedMgmtBg = nets.management?.mode === 'tagged' && nets.management?.vlanId;
    const ntpSource = spec.ntp?.source || (dc.enabled ? dcIp : 'pool.ntp.org');

    out.push(s(`Install ${esxiVer.label || 'ESXi'} on each nested host`, 'MANUAL'));
    out.push('');
    out.push('VMs are already powered on by the previous step. Two install paths:');
    out.push('');

    // ── Option A: Kickstart ──
    const ksIpExample = mgmtCidr.replace(/\.\d+\/\d+$/, '.101');
    out.push('### Option A -- Kickstart (recommended, unattended)');
    out.push('');
    out.push(`Per-host Kickstart files are in this output folder: \`ks-esxi-01.cfg\`${nc.hostCount > 1 ? ` … \`ks-esxi-${String(nc.hostCount).padStart(2, '0')}.cfg\`` : ''}.`);
    out.push('The wizard HTTP server also serves them on demand -- no file copying needed.');
    out.push('');
    if (!nc.rootPassword) {
      out.push('> **Root password:** no password was set in the wizard. The ks.cfg files contain a `<REPLACE_ME>`');
      out.push('> placeholder -- either edit the files before use, or the ESXi installer will prompt you.');
      out.push('');
    } else {
      out.push('Root password from the wizard is embedded in each ks.cfg file.');
      out.push('');
    }
    out.push(`For each of the ${nc.hostCount} nested host VM${nc.hostCount === 1 ? '' : 's'}, in order:`);
    out.push('');
    out.push('1. Open the VM console in the ESXi or vCenter UI -- the ESXi installer boot screen appears within ~30 seconds.');
    out.push('2. Press **Shift+O** (the letter O, not zero) at the boot menu to open the kernel options prompt.');
    out.push('3. Add the kickstart URL at the end of the prompt line:');
    out.push('   ```');
    out.push('   ks=http://<wizard-machine-ip>:3000/api/ks/<session-id>/<host-number>');
    out.push('   ```');
    out.push('   If you passed `-WizardIp` to `deploy-lab.ps1`, the exact URL for each host was printed when the VM powered on.');
    out.push('   The session ID is the 8-character hex folder name of this output directory.');
    out.push('4. Press **Enter**. The installer runs unattended -- no further input needed (~3 minutes per host).');
    out.push('5. The host reboots automatically and comes up pre-configured:');
    out.push(`   - Management IP: \`${ksIpExample}\`, \`${ksIpExample.replace(/\d+$/, '102')}\`, … (sequential from management CIDR)`);
    out.push(`   - Hostname: \`esxi-N.${dcDomain}\``);
    out.push('   - SSH: enabled');
    out.push(`   - NTP: \`${ntpSource}\``);
    out.push('6. Verify: `ping <nested-host-ip>` from your workstation.');
    out.push('');
    out.push('> **Self-hosting the ks.cfg:** if the wizard is not running at install time, copy `ks-esxi-N.cfg` to any web server and use its URL instead.');
    out.push('');

    // ── Option B: Manual ──
    out.push('### Option B -- Manual install');
    out.push('');
    out.push(`Use this if kickstart is not available. Repeat for all ${nc.hostCount} nested host VM${nc.hostCount === 1 ? '' : 's'}:`);
    out.push('');
    out.push('1. Open the VM console -- the installer boot screen is already showing (VMs are powered on).');
    out.push('2. Run through the ESXi installer. When asked for a disk, select the boot disk (the smallest one).');
    if (vsanExtra.length > 0) {
      out.push(`   **Do not touch the vSAN disks** (${vsanExtra.map((d) => d.sizeGB + 'GB').join(', ')}) -- leave them unpartitioned for vSAN.`);
    }
    out.push('3. Set a root password you\'ll remember.');
    out.push('4. After reboot, press F2 at the DCUI to configure networking:');
    out.push('   - Management network: select the `Nested-Trunk` port group (the only lab network -- it\'s a VLAN trunk)');
    if (taggedMgmtBg) {
      out.push(`   - **VLAN**: enter \`${nets.management.vlanId}\` under VLAN (optional) so this host's management traffic is tagged to match VyOS's vif ${nets.management.vlanId}`);
    } else {
      out.push('   - **VLAN**: leave blank (management traffic is untagged/native on the trunk)');
    }
    if (dc.enabled) {
      out.push(`   - DNS: \`${dcIp}\``);
      out.push(`   - Hostname: \`esxi-N.${dcDomain}\` (replace N with host number)`);
    }
    out.push(`   - NTP: Configure Management Network → NTP Configuration → \`${ntpSource}\``);
    out.push('5. Confirm the host is reachable: `ping <nested-host-ip>` from your workstation.');
    out.push('');
  }

  if (localDs.enabled) {
    out.push(s('Create local datastore on host 1', 'MANUAL'));
    out.push('');
    out.push(
      'This step must happen **before** deploying vCenter. The local datastore gives vCenter ' +
      'somewhere to live that doesn\'t depend on the vSAN cluster it\'s about to manage.'
    );
    out.push('');
    out.push('1. Open the ESXi host client for `nested-esxi-01` directly at `https://<nested-esxi-01-ip>` (not the physical host UI -- log in to the nested host itself).');
    out.push('2. Go to **Storage → Datastores → New datastore**.');
    const localDsDisk = (nc.additionalDisks || []).find((d) => d.purpose === 'local_datastore');
    const localDsSizeLabel = localDsDisk ? `${localDsDisk.sizeGB}GB` : '200GB';
    out.push(`3. Select the ${localDsSizeLabel} local datastore disk on host 1 (not the boot disk or any vSAN disks).`);
    out.push('4. Name it exactly `local-ds`. Format as VMFS.');
    out.push('5. Confirm it appears as `local-ds` in the datastore list before continuing.');
    out.push('');
  }

  // =========================================================================
  // vCenter
  // =========================================================================
  out.push(s('Deploy vCenter (VCSA)', 'AUTOMATED'));
  out.push('');
  out.push('```powershell');
  out.push('.\\vcenter-deploy.ps1 `');
  out.push('    -EsxiHostName <nested-esxi-01-ip> `');
  out.push(`    -Datastore ${localDs.enabled ? 'local-ds' : 'datastore1'} \``);
  out.push('    -VcenterFqdn <vcenter-fqdn> `');
  out.push('    -VcenterIp <vcenter-ip> `');
  out.push('    -VcenterGateway <gateway-ip> `');
  out.push('    -VcenterPassword (Read-Host -AsSecureString "VCSA root password") `');
  out.push(`    -DeploymentSize "${vcSize}"`);
  out.push('```');
  out.push('');
  out.push(
    `Reads the VCSA OVA path from \`lab-config.json\` (\`localPaths.vCenterOva\`), connects directly to ` +
    `\`nested-esxi-01\` (standalone, before vCenter exists), and deploys the VCSA ` +
    `onto the \`${localDs.enabled ? 'local-ds' : 'datastore1'}\` datastore on that host. ` +
    'This happens before vSAN is configured -- vCenter needs somewhere to live that does not depend on the cluster it is about to manage. ' +
    'The script detects `govc` and uses it if present; otherwise it falls back to PowerCLI `Import-VApp`.'
  );
  out.push('');

  out.push(s('Wait for vCenter first-boot', 'MANUAL'));
  out.push('');
  out.push(
    'The VCSA runs an internal setup process after first power-on. This takes **~20 minutes** and ' +
    'cannot be skipped. Monitor progress at:'
  );
  out.push('');
  out.push('```');
  out.push('https://<vcsa-ip>:5480');
  out.push('```');
  out.push('');
  out.push('Wait until the **Getting Started** page loads at `https://<vcsa-ip>` before proceeding.');
  out.push('Log in with username `administrator@vsphere.local` and the password set during deployment.');
  out.push('');

  // =========================================================================
  // vSAN
  // =========================================================================
  if (nc.vsanEnabled) {
    const vsanArch = nc.vsanArchitecture || 'esa';
    out.push(s('Form vSAN cluster', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push(`.\\vsan-cluster.ps1 -VCenterServer <vcsa-ip>  # cluster: ${nc.clusterName || 'mgmt-cluster'}, datacenter: ${nc.datacenterName || 'Lab-DC'}`);
    out.push('```');
    out.push('');
    out.push(`Connects to vCenter, creates datacenter **${nc.datacenterName || 'Lab-DC'}** and cluster **${nc.clusterName || 'mgmt-cluster'}**, adds all nested hosts, then claims vSAN disks in manual mode (which leaves \`local-ds\` on host 1 untouched).`);
    out.push('');
    if (vsanArch === 'esa') {
      out.push(
        '> **vSAN ESA (Express Storage Architecture):** Single storage tier -- no separate cache/capacity split. ' +
        'Claim all eligible disks as capacity disks. In vCenter: **Configure → vSAN → Disk Management → Claim unused disks**. ' +
        'ESA requires all-flash (NVMe or high-performance SSD) -- spinning disks will not be eligible.'
      );
    } else {
      out.push(
        '> **vSAN OSA (Original Storage Architecture):** Two-tier design -- cache (SSD/NVMe) and capacity (any disk). ' +
        'Claim disks in **Cache + Capacity** groups via vCenter. ' +
        'OSA is the legacy architecture; ESA is the current default for new deployments.'
      );
    }
    out.push('');
    out.push('**After disk claiming completes:**');
    out.push('1. In vCenter, go to **Cluster → Monitor → vSAN → Health**.');
    out.push('2. Wait for all checks to turn green before deploying anything onto vSAN storage.');
    out.push('3. If the "Performance service" health check shows yellow, enable it: **Configure → vSAN → Services → Performance service → Enable**.');
    out.push('');
  }

  // =========================================================================
  // Memory tiering (optional)
  // =========================================================================
  if (nc.memoryTiering && nc.memoryTiering.enabled) {
    const mt = nc.memoryTiering;
    out.push(s('Add NVMe tier VMDKs to nested hosts (Phase 1)', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push(`.\\configure-memory-tiering.ps1 -PhysicalESXiHost <host-ip-or-fqdn> -Datastore <datastore-name>`);
    out.push('```');
    out.push('');
    out.push(
      `Adds a ${mt.nvmeSizeGB}GB virtual NVMe disk to each of the ${nc.hostCount} nested host VMs ` +
      `(total ${nc.hostCount * mt.nvmeSizeGB}GB from the physical host datastore). ` +
      'This runs against the **physical** ESXi host, not vCenter.'
    );
    out.push('');

    out.push(s('Configure ESXi memory tiering on each nested host (Phase 2)', 'MANUAL'));
    out.push('');
    out.push('Repeat for each nested host:');
    out.push('');
    out.push('1. In vCenter, put the host into **maintenance mode**.');
    out.push('2. SSH into the nested host and run:');
    out.push('   ```bash');
    out.push('   # Enable early memory reservation');
    out.push('   esxcli system settings advanced set -o /Mem/MemEarlyReserve -i 1');
    out.push('');
    out.push(`   # Find the NVMe device path (look for the ~${mt.nvmeSizeGB}GB device)`);
    out.push('   esxcli storage core device list | grep -B2 -A8 NVMe');
    out.push('');
    out.push('   # Add device as memory tier');
    out.push('   esxcli system memtiering add --device /vmfs/devices/disks/<naa.xxxxx>');
    out.push('');
    out.push(`   # Enable tiering with ${mt.tierNvmePct}% of host memory backed by NVMe`);
    out.push(`   esxcli system memtiering set --enable 1 --tier-nvme-pct ${mt.tierNvmePct}`);
    out.push('   ```');
    out.push('3. Exit maintenance mode. The host will reboot to activate the NVMe tier.');
    out.push('');
    out.push(
      '> **Note:** After running `esxcli system memtiering set`, the status will show ' +
      '`Configured: TRUE` but `Runtime: FALSE`. This is expected and correct -- ' +
      'the **Runtime** value only becomes `TRUE` after the maintenance-mode reboot.'
    );
    out.push('');
  }

  // =========================================================================
  // Bundle depot
  // =========================================================================
  const depot = spec.bundleDepot || {};
  if (depot.enabled) {
    if (depot.mode !== 'iis') {
      out.push(s('Deploy bundle depot VM', 'AUTOMATED'));
      out.push('');
      out.push('```powershell');
      out.push('.\\depot-deploy.ps1');
      out.push('```');
      out.push('');
      out.push('Creates `lab-depot` (2 vCPU / 4GB / 100GB) on the local datastore of the first nested ESXi host.');
      out.push('');
      out.push(s('Configure nginx HTTPS file server on depot VM', 'MANUAL'));
      out.push('');
      out.push('Copy `depot-configure.sh` to the depot VM and run it as root:');
      out.push('');
      out.push('```bash');
      out.push(`scp depot-configure.sh ubuntu@${depot.ipAddress || '<depot-ip>'}:~`);
      out.push(`ssh ubuntu@${depot.ipAddress || '<depot-ip>'}`);
      out.push('sudo bash depot-configure.sh');
      out.push('```');
      out.push('');
      out.push('The script installs nginx, generates a self-signed TLS certificate with a SAN entry for the depot IP,');
      out.push('creates the depot folder structure, and enables HTTPS with directory listing.');
      out.push('');
    } else {
      out.push(s('Configure IIS bundle depot on domain controller', 'MANUAL'));
      out.push('');
      out.push('Run `depot-iis.ps1` on the domain controller as Administrator:');
      out.push('');
      out.push('```powershell');
      out.push('.\\depot-iis.ps1');
      out.push('```');
      out.push('');
      out.push('Installs IIS, creates a self-signed cert, configures an HTTPS binding, and enables directory listing.');
      out.push('');
    }

    out.push(s('Populate depot with VCF bundles', 'MANUAL'));
    out.push('');
    out.push(`Copy Broadcom bundle files into the appropriate sub-folders under the depot root:`);
    out.push('');
    out.push(`| Folder | Contents |`);
    out.push(`|---|---|`);
    out.push(`| \`esxi/\` | ESXi offline bundle (.zip) |`);
    out.push(`| \`vcenter/\` | vCenter Server ISO |`);
    out.push(`| \`nsx/\` | NSX-T bundle (.zip) |`);
    out.push(`| \`sddc-manager/\` | SDDC Manager async patch bundles |`);
    out.push(`| \`vrealize/\` | vRealize/Aria bundles (if applicable) |`);
    out.push(`| \`tools/\` | VMware Tools, VIBs, other utilities |`);
    out.push('');
    out.push(`Verify accessibility: \`curl -k https://${depot.ipAddress || '<depot-ip>'}/depot/\``);
    out.push('');
    out.push(s('Trust depot certificate in SDDC Manager', 'MANUAL'));
    out.push('');
    out.push('1. Export the self-signed cert from the depot VM:');
    out.push('   ```bash');
    if (depot.mode !== 'iis') {
      out.push(`   scp ubuntu@${depot.ipAddress || '<depot-ip>'}:/etc/nginx/ssl/depot.crt ./depot.crt`);
    } else {
      out.push(`   # Export from DC: Get-ChildItem Cert:\\LocalMachine\\My | Where-Object { $_.Subject -like '*depot*' } | Export-Certificate -FilePath depot.cer -Type CERT`);
    }
    out.push('   ```');
    out.push('2. In SDDC Manager: **Administration → Certificate Management → Trusted Certificates → Add**');
    out.push('3. Paste the cert PEM and save.');
    out.push('');
    out.push(s('Register local depot in SDDC Manager', 'MANUAL'));
    out.push('');
    out.push('1. In SDDC Manager: **Administration → Bundle Management → Local Depot Settings**');
    out.push(`2. Enter depot URL: \`https://${depot.ipAddress || '<depot-ip>'}/depot/\``);
    out.push('3. Save and verify SDDC Manager can reach the depot.');
    out.push('');
    out.push('> **Note:** The depot is infrastructure-only. VCF bring-up itself is out of scope for v1 of this wizard.');
    out.push('');
  }

  // =========================================================================
  // Jumpbox / WireGuard VM
  // =========================================================================
  if (hasJumpboxVm) {
    const role = ra.method === 'ssh_jump' ? 'SSH jump host' : 'WireGuard VPN server';
    out.push(s(`Deploy ${role} VM`, 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push(`.\\jumpbox-deploy.ps1 -VCenterServer <vcsa-ip>`);
    out.push('```');
    out.push('');
    out.push(`Creates \`${jumpVmName}\` (1 vCPU / 1GB / 20GB) and generates an ed25519 SSH keypair:`);
    out.push('');
    out.push(`- Private key: \`%USERPROFILE%\\.ssh\\${jumpKeyName}\``);
    out.push(`- Public key:  \`%USERPROFILE%\\.ssh\\${jumpKeyName}.pub\``);
    out.push('');
    out.push('The public key is also stored in the VM\'s Notes field in vCenter.');
    out.push('');

    out.push(s(`Install Ubuntu Server 22.04 LTS on ${jumpVmName}`, 'MANUAL'));
    out.push('');
    out.push(`1. In vCenter, edit \`${jumpVmName}\` → Add device → CD/DVD Drive → attach the Ubuntu Server ISO.`);
    out.push('2. Power on and open the console.');
    out.push('3. Install Ubuntu Server -- accept defaults. When asked about SSH, select **Install OpenSSH server**.');
    out.push('4. Assign a static IP in the management network during or after install.');
    out.push('5. After reboot, log in via the vCenter console.');
    out.push('');
    out.push('Add the SSH public key to the VM:');
    out.push('');
    out.push('```bash');
    out.push('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    out.push(`cat <<\'EOF\' >> ~/.ssh/authorized_keys`);
    out.push(`<paste contents of %USERPROFILE%\\.ssh\\${jumpKeyName}.pub here>`);
    out.push('EOF');
    out.push('chmod 600 ~/.ssh/authorized_keys');
    out.push('```');
    out.push('');
    out.push('Test the keypair from your workstation:');
    out.push('```bash');
    out.push(`ssh -i %USERPROFILE%\\.ssh\\${jumpKeyName} ubuntu@<${jumpVmName}-ip>`);
    out.push('```');
    out.push('');
  }

  if (ra.method === 'ssh_jump') {
    out.push(s('Verify jump host access to lab VMs', 'MANUAL'));
    out.push('');
    out.push('Use ProxyJump (`-J`) to reach nested ESXi hosts or vCenter through the jumpbox:');
    out.push('');
    out.push('```bash');
    out.push(`# Connect to a nested ESXi host via the jumpbox`);
    out.push(`ssh -i %USERPROFILE%\\.ssh\\${jumpKeyName} -J ubuntu@<jumpbox-ip> root@<nested-esxi-ip>`);
    out.push('');
    out.push('# Or add to ~/.ssh/config for convenience:');
    out.push('# Host lab-jump');
    out.push('#   HostName <jumpbox-ip>');
    out.push('#   User ubuntu');
    out.push(`#   IdentityFile %USERPROFILE%\\.ssh\\${jumpKeyName}`);
    out.push('#');
    out.push('# Host 192.168.10.*');
    out.push('#   ProxyJump lab-jump');
    out.push('#   User root');
    out.push('```');
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push(s('Run WireGuard server setup script', 'MANUAL'));
    out.push('');
    out.push(`Copy \`wireguard-server.sh\` to the VM and run it as root:`);
    out.push('');
    out.push('```bash');
    out.push(`# From your workstation (requires SSH key to be set up from the previous step)`);
    out.push(`scp -i %USERPROFILE%\\.ssh\\${jumpKeyName} wireguard-server.sh ubuntu@<wireguard-vm-ip>:~/`);
    out.push(`ssh -i %USERPROFILE%\\.ssh\\${jumpKeyName} ubuntu@<wireguard-vm-ip> "sudo bash ~/wireguard-server.sh"`);
    out.push('```');
    out.push('');
    out.push(
      'The script installs WireGuard, generates the server keypair, writes `/etc/wireguard/wg0.conf`, ' +
      'enables IP forwarding, and starts `wg-quick@wg0`. When it finishes, it prints the **server public key**. ' +
      'Copy that -- you need it to configure each client.'
    );
    out.push('');

    out.push(s('Add WireGuard client peers', 'MANUAL'));
    out.push('');
    out.push('Repeat once per device that needs VPN access:');
    out.push('');
    out.push('**On the client device:**');
    out.push('```bash');
    out.push('# Generate a client keypair');
    out.push('wg genkey | tee client.key | wg pubkey > client.pub');
    out.push('cat client.pub   # share this with the server');
    out.push('```');
    out.push('');
    out.push('**On the WireGuard server VM** (edit `/etc/wireguard/wg0.conf`):');
    out.push('```ini');
    out.push('[Peer]');
    out.push('# Description: <device name>');
    out.push('PublicKey = <client.pub contents>');
    out.push('AllowedIPs = 10.200.0.X/32   # next available client IP');
    out.push('```');
    out.push('');
    out.push('Reload WireGuard without dropping other connections:');
    out.push('```bash');
    out.push('sudo wg syncconf wg0 <(sudo wg-quick strip wg0)');
    out.push('```');
    out.push('');
    out.push('**Client `wg0.conf`:**');
    out.push('```ini');
    out.push('[Interface]');
    out.push('PrivateKey = <client.key contents>');
    out.push('Address = 10.200.0.X/24');
    out.push('DNS = ' + (dc.enabled && dc.ipAddress ? dc.ipAddress : '8.8.8.8'));
    out.push('');
    out.push('[Peer]');
    out.push('PublicKey = <server-public-key>');
    out.push('Endpoint = <wireguard-vm-external-ip>:51820');
    out.push(`AllowedIPs = ${mgmtCidr}, 10.200.0.0/24`);
    out.push('PersistentKeepalive = 25');
    out.push('```');
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push(s('Configure VyOS site-to-site WireGuard tunnel', 'MANUAL'));
    out.push('');
    out.push('Open `vyos-site-to-site.conf` -- it contains ready-to-paste VyOS CLI commands. Before pasting:');
    out.push('');
    out.push('1. Generate a WireGuard keypair on this VyOS router:');
    out.push('   ```');
    out.push('   run generate pki wireguard key-pair');
    out.push('   ```');
    out.push('   Copy the **Private Key** output. Paste it into the `private-key` placeholder in the config.');
    out.push('   Share the **Public Key** with the operator at the remote site.');
    out.push('');
    out.push('2. Get the remote site\'s WireGuard public key and public IP.');
    out.push('   Fill in `<remote-public-key>` and `<remote-endpoint-ip>` in the config.');
    out.push('');
    out.push('3. Update `192.168.100.0/24` with the actual subnet range at the remote site.');
    out.push('');
    out.push('4. Paste the edited config into the VyOS CLI (it enters configure mode, commits, and saves).');
    out.push('');
    out.push('**Verify both sides are connected:**');
    out.push('```');
    out.push('run show interfaces wireguard wg0');
    out.push('run ping 10.201.0.2      # remote tunnel endpoint');
    out.push('```');
    out.push('');
  }

  // =========================================================================
  // Workload VMs
  // =========================================================================
  if (wl.enabled && wl.count > 0) {
    out.push(s('Deploy test workload VMs', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\deploy-workloads.ps1 -VCenterServer <vcsa-ip>');
    out.push('```');
    out.push('');
    out.push(
      `Creates ${wl.count} blank VM shell${wl.count === 1 ? '' : 's'} (${wl.vcpu} vCPU / ${wl.vramGB}GB each) on the vSAN cluster. ` +
      'No OS is installed. These are useful for practising vMotion, DRS placement, HA failover, and storage policy assignment.'
    );
    out.push('');
    out.push('To use a workload VM: power it on in vCenter and attach an OS ISO via **Edit Settings → CD/DVD Drive**.');
    out.push('');
  }

  // =========================================================================
  // NSX-T
  // =========================================================================
  if (nsx.enabled) {
    const nsxIp = nsx.ipAddress || '<NSX-MANAGER-IP>';
    out.push(s('Deploy NSX-T Manager', 'AUTOMATED'));
    out.push('');
    out.push('> **Prerequisite:** Download the NSX-T Manager OVA from Broadcom portal → VMware NSX → My Downloads.');
    out.push('');
    out.push('```powershell');
    out.push(`.\\nsx-deploy.ps1 -NsxOvaPath "C:\\path\\to\\nsx-unified-appliance.ova" \\`);
    out.push(`    -NsxAdminPassword (Read-Host -AsSecureString "NSX admin password") \\`);
    out.push(`    -VIPassword (Read-Host -AsSecureString "vCenter password")`);
    out.push('```');
    out.push('');
    out.push(`Deploys NSX Manager (${nsx.size}) onto the cluster using Import-VApp. Size: ${nsx.size === 'medium' ? '6 vCPU / 24GB RAM' : '3 vCPU / 12GB RAM'} / 300GB disk.`);
    out.push('');
    out.push('The script waits for NSX Manager to become responsive before exiting (~5-8 minutes for first boot).');
    out.push('');

    out.push(s('Register NSX with vCenter and create gateway topology', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push(`.\\nsx-configure.ps1 \\`);
    out.push(`    -NsxPassword (Read-Host -AsSecureString "NSX admin password") \\`);
    out.push(`    -VCenterPassword (Read-Host -AsSecureString "vCenter password")`);
    out.push('```');
    out.push('');
    out.push(`Registers vCenter as the compute manager, creates the overlay transport zone, and builds the ${nsx.topology === 'T0T1' ? 'T0 and T1 gateways' : nsx.topology === 'T0T1DFW' ? 'T0 gateway, T1 gateway, and default DFW policy' : 'full T0/T1/DFW topology'}.`);
    out.push('');

    if (nsx.bgpEnabled) {
      out.push(s('Configure BGP peering between NSX T0 and VyOS', 'AUTOMATED'));
      out.push('');
      out.push('```powershell');
      out.push(`.\\nsx-bgp.ps1 -NsxPassword (Read-Host -AsSecureString "NSX admin password")`);
      out.push('```');
      out.push('');
      out.push(`Configures BGP on the T0 gateway (AS ${nsx.bgpLocalAs}) with a VyOS peer at AS ${nsx.bgpPeerAs}.`);
      out.push('');
      out.push('**VyOS side:** BGP must also be configured on VyOS to complete the session. Example (adapt ASNs and peer IPs):');
      out.push('```');
      out.push('configure');
      out.push(`set protocols bgp system-as ${nsx.bgpPeerAs}`);
      out.push(`set protocols bgp neighbor ${nsxIp} remote-as ${nsx.bgpLocalAs}`);
      out.push(`set protocols bgp neighbor ${nsxIp} address-family ipv4-unicast`);
      out.push('commit; save');
      out.push('```');
      out.push('');
    }

    out.push(s('Verify NSX connectivity', 'MANUAL'));
    out.push('');
    out.push(`1. Browse to **https://${nsxIp}** and log in with admin / <password>.`);
    out.push('2. Go to **System → Fabric → Compute Managers** -- vCenter status should show **Registered**.`');
    out.push('3. Go to **Networking → Tier-0 Gateways** -- the T0 should show as configured.');
    if (nsx.bgpEnabled) {
      out.push('4. Go to **Networking → Tier-0 Gateways → t0-gateway → BGP Neighbors** -- session state should show **Established** after VyOS BGP is also configured.');
    }
    out.push('');
  }

  // =========================================================================
  // Extend mode note
  // =========================================================================
  if (spec.extendMode) {
    out.push('---');
    out.push('');
    out.push('> **Extension run:** This spec was generated in "Extend existing lab" mode.');
    out.push('> Run only the scripts listed here that correspond to components you are adding.');
    out.push('> Scripts for components that already existed in your original spec can be skipped.');
    out.push('');
  }

  // =========================================================================
  // Done
  // =========================================================================
  out.push('## Build complete');
  out.push('');
  out.push('If you made it here without errors, the lab is up. A few things to confirm before handing it over:');
  out.push('');
  out.push('- [ ] All nested ESXi hosts show as Connected in vCenter');
  if (nc.vsanEnabled) {
    out.push('- [ ] vSAN health checks all green (no red or yellow items)');
    out.push('- [ ] vSAN datastore visible and showing capacity');
  }
  if (dc.enabled) {
    out.push('- [ ] DC is resolving FQDNs correctly (run `Resolve-DnsName <vcsa-fqdn>` from a lab machine)');
  }
  if (ra.method === 'ssh_jump') {
    out.push('- [ ] SSH jump host reachable and key-based auth working');
  }
  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push('- [ ] WireGuard tunnel up (`wg show` on server shows a peer with a recent handshake)');
  }
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push('- [ ] Site-to-site tunnel up and remote subnet pingable through it');
  }
  out.push('- [ ] vCenter UI accessible from your workstation');
  if (nsx.enabled) {
    out.push('- [ ] NSX Manager UI accessible');
    out.push('- [ ] vCenter registered as compute manager in NSX');
    if (nsx.bgpEnabled) {
      out.push('- [ ] BGP session established between NSX T0 and VyOS');
    }
  }
  out.push('');

  return out.join('\n');
}

module.exports = { buildBuildGuide };
