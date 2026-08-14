// lib/generatePowerShell.js
//
// Returns { 'filename.ps1': scriptContent, ... } for each deployment stage.
// The stages must be run in the order they appear here -- each one depends on
// the prior stage being complete. lab-design.md explains why.
//
// PowerShell uses $ constantly, so scripts are built as string arrays (no JS
// template-literal interpolation inside PowerShell variable names) to avoid
// escaping bugs. Only real spec values get injected.

const ESXI_GUEST_ID = {
  '9.1':   'vmkernel9Guest',
  '9.0u2': 'vmkernel9Guest',
  '9.0u1': 'vmkernel9Guest',
  '9.0':   'vmkernel9Guest',
  '8.0u3': 'vmkernel8Guest',
  '8.0u2': 'vmkernel8Guest',
  '8.0u1': 'vmkernel8Guest'
};

// --- lab-config.json path resolution ----------------------------------------
// Every deploy script that needs an ISO/OVA reads it from lab-config.json
// instead of taking it as a script parameter -- a Mandatory parameter left
// unset makes PowerShell stop and prompt for it interactively, which doesn't
// work for anyone running the script unattended. See PREREQUISITES.md for
// which files belong under localPaths vs datastorePaths and why.

// Loads lab-config.json into $LabConfig. Must run once, early, in every
// generated script that resolves a path from the config.
function emitLabConfigLoader(lines) {
  lines.push('# --- Load lab-config.json (place it next to this script -- see PREREQUISITES.md) ---');
  lines.push('$LabConfigPath = Join-Path $PSScriptRoot "lab-config.json"');
  lines.push('if (-not (Test-Path -Path $LabConfigPath -PathType Leaf)) {');
  lines.push('    throw "lab-config.json not found at $LabConfigPath. Copy lab-config.json.example (in this same folder) to lab-config.json, fill in your file paths, and re-run."');
  lines.push('}');
  lines.push('$LabConfig = Get-Content -Raw -Path $LabConfigPath | ConvertFrom-Json');
  lines.push('');
}

// Resolves an OVA appliance read directly off the local machine. Import-VApp
// and govc upload the file themselves as part of deployment, so no separate
// upload step runs here -- just existence validation.
function emitLocalFileResolution(lines, { varName, configKey, label, indent = '' }) {
  lines.push(`${indent}\$${varName} = $LabConfig.localPaths.${configKey}`);
  lines.push(`${indent}if (-not \$${varName}) {`);
  lines.push(`${indent}    throw "${label} not configured -- set localPaths.${configKey} in lab-config.json."`);
  lines.push(`${indent}}`);
  lines.push(`${indent}if (-not (Test-Path -Path \$${varName} -PathType Leaf)) {`);
  lines.push(`${indent}    throw "${label} not found at '\$${varName}' (lab-config.json localPaths.${configKey}). Check the path and try again."`);
  lines.push(`${indent}}`);
}

// Resolves a file that ends up mounted as CD-ROM media (Set-CDDrive only
// accepts a datastore-resident path, never a local one). If
// datastorePaths.<key> is set, it's used directly -- the file is assumed
// already staged there. Otherwise the local file is uploaded to
// "[<datastore>] ISOs/<filename>" (skipped if already present) and that
// datastore path is used instead. Requires $ds (a Get-Datastore result)
// already in scope.
function emitDatastoreIsoResolution(lines, { varName, configKey, label, indent = '' }) {
  lines.push(`${indent}\$${varName}Local  = $LabConfig.localPaths.${configKey}`);
  lines.push(`${indent}\$${varName}Staged = $LabConfig.datastorePaths.${configKey}`);
  lines.push(`${indent}if (\$${varName}Staged) {`);
  lines.push(`${indent}    # Already staged on the datastore -- use directly, no local file or upload needed.`);
  lines.push(`${indent}    \$${varName} = \$${varName}Staged`);
  lines.push(`${indent}} elseif (\$${varName}Local) {`);
  lines.push(`${indent}    if (-not (Test-Path -Path \$${varName}Local -PathType Leaf)) {`);
  lines.push(`${indent}        throw "${label} not found at '\$${varName}Local' (lab-config.json localPaths.${configKey}). Check the path and try again."`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    $isoFileName = Split-Path -Path \$${varName}Local -Leaf`);
  lines.push(`${indent}    New-PSDrive -Name LabDS -Location $ds -PSProvider VimDatastore -Root "\\" | Out-Null`);
  lines.push(`${indent}    if (-not (Test-Path "LabDS:\\ISOs")) { New-Item -ItemType Directory -Path "LabDS:\\ISOs" | Out-Null }`);
  lines.push(`${indent}    $dsIsoPath = "LabDS:\\ISOs\\$isoFileName"`);
  lines.push(`${indent}    if (-not (Test-Path $dsIsoPath)) {`);
  lines.push(`${indent}        Write-Host "Uploading $isoFileName to datastore $($ds.Name) (this can take a while for large ISOs)..."`);
  lines.push(`${indent}        Copy-DatastoreItem -Item \$${varName}Local -Destination "LabDS:\\ISOs\\" | Out-Null`);
  lines.push(`${indent}    } else {`);
  lines.push(`${indent}        Write-Host "$isoFileName already present on datastore -- skipping upload."`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    Remove-PSDrive -Name LabDS -Confirm:$false`);
  lines.push(`${indent}    \$${varName} = "[$($ds.Name)] ISOs/$isoFileName"`);
  lines.push(`${indent}} else {`);
  lines.push(`${indent}    throw "${label} not configured -- set localPaths.${configKey} or datastorePaths.${configKey} in lab-config.json."`);
  lines.push(`${indent}}`);
}

function buildPowerShellScripts(spec, sessionId) {
  const scripts = {};

  // Insertion order = deployment order
  if (spec.vyos && spec.vyos.enabled) {
    scripts['vyos-deploy.ps1'] = buildVyosDeploy(spec);
    scripts['vyos-config.txt'] = buildVyosConfig(spec);
  }
  if (spec.domainController && spec.domainController.enabled) {
    scripts['dc-deploy.ps1'] = buildDcDeploy(spec);
  }
  scripts['deploy-lab.ps1'] = buildDeployLab(spec, sessionId);
  scripts['vcenter-deploy.ps1'] = buildVcenterDeploy(spec);
  if (spec.nestedCluster.vsanEnabled) {
    scripts['vsan-cluster.ps1'] = buildVsanCluster(spec);
  }
  if (spec.workloadVms && spec.workloadVms.enabled && spec.workloadVms.count > 0) {
    scripts['deploy-workloads.ps1'] = buildWorkloadsDeploy(spec);
  }
  if (spec.nestedCluster.memoryTiering && spec.nestedCluster.memoryTiering.enabled) {
    scripts['configure-memory-tiering.ps1'] = buildMemoryTiering(spec);
  }

  const ra = spec.remoteAccess || {};
  if (ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard')) {
    scripts['jumpbox-deploy.ps1'] = buildJumpboxDeploy(spec);
  }
  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    scripts['wireguard-server.sh'] = buildWireGuardSetup(spec);
  }
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    scripts['vyos-site-to-site.conf'] = buildVyosSiteToSite(spec);
  }

  return scripts;
}

// --- Stage 1: VyOS router/firewall VM shell ---

function buildVyosDeploy(spec) {
  const lines = [];
  const vyos = spec.vyos;

  const physHosts = spec.physicalHosts || [spec.physicalHost];
  const vyosHostIdx = Math.min((spec.componentPlacement?.vyos ?? 0), physHosts.length - 1);
  const vyosPhysHost = physHosts[vyosHostIdx];
  const vyosDefaultIp = vyosPhysHost?.ipAddress ? ` = "${vyosPhysHost.ipAddress}"` : '';

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push('    Stage 1: Deploy the VyOS virtual router/firewall VM shell.');
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('    Run this first. VyOS is the network foundation -- nothing else in the lab');
  lines.push('    has a routable path until the router is up and configured.');
  lines.push('    This script creates the VM shell and attaches the ISO. Boot the VM and');
  lines.push('    run through the VyOS installer and network config manually.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    Network mode: ${vyos.networkMode === 'bgp' ? 'Basic NAT/DHCP/DNS + BGP peering' : 'Basic NAT, DHCP, DNS forwarding'}`);
  lines.push('    VyOS sizing: 2 vCPU, 1GB RAM, 4GB disk');
  lines.push('    Exactly two NICs: eth0 = WAN ($WanPortGroupName, upstream access),');
  lines.push('    eth1 = Nested-Trunk (VLAN 4095 trunk on vSwitch1 -- carries every lab VLAN).');
  lines.push('    VyOS creates a VLAN sub-interface (vif) on eth1 per lab network -- see vyos-config.txt.');
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push(`    [string]$VIServer${vyosDefaultIp},`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push(`    [string]$VMHostName${vyosDefaultIp},`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$Datastore,');
  lines.push('');
  lines.push('    # Port group that gives the router its upstream/WAN access');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$WanPortGroupName,');
  lines.push('');
  lines.push('    [string]$VmName = "vyos-router"');
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  emitLabConfigLoader(lines);
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('$cred = Get-Credential -Message "Credentials for $VIServer"');
  lines.push('Connect-VIServer -Server $VIServer -Credential $cred | Out-Null');
  lines.push('');
  lines.push('$vmHost = Get-VMHost -Name $VMHostName');
  lines.push('$ds = Get-Datastore -Name $Datastore');
  lines.push('');
  emitDatastoreIsoResolution(lines, { varName: 'VyosIsoPath', configKey: 'vyosIso', label: 'VyOS ISO' });
  lines.push('');
  lines.push('# Note: no -Location/VM folder here -- this connects directly to a standalone');
  lines.push('# ESXi host (vCenter does not exist yet), and standalone hosts have no VM folders.');
  lines.push('');
  lines.push('if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) {');
  lines.push('    Write-Host "$VmName already exists, skipping."');
  lines.push('    exit 0');
  lines.push('}');
  lines.push('');
  lines.push('$vm = New-VM -Name $VmName `');
  lines.push('    -VMHost $vmHost `');
  lines.push('    -Datastore $ds `');
  lines.push('    -DiskGB 4 `');
  lines.push('    -MemoryGB 1 `');
  lines.push('    -NumCpu 2 `');
  lines.push('    -GuestId "debian11_64Guest" `');
  lines.push('    -CD');
  lines.push('');
  lines.push('# eth0 -- WAN, connected to the upstream port group');
  lines.push('New-NetworkAdapter -VM $vm -NetworkName $WanPortGroupName -Type Vmxnet3 -StartConnected | Out-Null');
  lines.push('');
  lines.push('# eth1 -- internal LAN trunk (VLAN 4095 on vSwitch1). Carries every lab VLAN;');
  lines.push('# VyOS routes between them with per-VLAN sub-interfaces (see vyos-config.txt).');
  lines.push('New-NetworkAdapter -VM $vm -NetworkName "Nested-Trunk" -Type Vmxnet3 -StartConnected | Out-Null');
  lines.push('');
  if (spec.nestedCluster.legacyCpuCompatibility) {
    lines.push('New-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU" -Value "TRUE" -Confirm:$false | Out-Null');
    lines.push('');
  }
  lines.push('Get-CDDrive -VM $vm | Set-CDDrive -IsoPath $VyosIsoPath -StartConnected $true -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('Write-Host "VyOS VM shell ready: $VmName"');
  lines.push('Write-Host "Power it on and install VyOS, then paste vyos-config.txt (in this output folder)"');
  lines.push('Write-Host "into the CLI to configure networking, NAT, DHCP, and DNS in one shot."');
  if (vyos.networkMode === 'bgp') {
    lines.push('Write-Host "vyos-config.txt also includes the BGP peering commands for this lab -- see build-guide.md if the NSX T0 uplink IP is not yet known."');
  }
  lines.push('');
  lines.push('Disconnect-VIServer -Server $VIServer -Confirm:$false');
  lines.push('');

  return lines.join('\n');
}

// --- Ready-to-paste VyOS CLI configuration for this lab ---

function buildVyosConfig(spec) {
  const nets = spec.networks;
  const vyos = spec.vyos;
  const dc = spec.domainController || {};
  const nsx = spec.nsx || {};

  const mgmtCidr = nets.management?.cidr || '192.168.10.0/24';
  const mgmtPrefix = mgmtCidr.split('/')[1] || '24';
  const mgmtGwCidr = mgmtCidr.replace(/\d+\/\d+$/, `1/${mgmtPrefix}`);
  const mgmtVlanId = nets.management?.vlanId;
  const taggedMgmt = nets.management?.mode === 'tagged' && mgmtVlanId;

  const lines = [];
  lines.push('# vyos-config.txt -- ready-to-paste VyOS CLI configuration for this lab');
  lines.push(`# Generated by zero-to-hero-lab on ${spec.generatedAt}`);
  lines.push('#');
  lines.push('# Run this after vyos-deploy.ps1 and after the VyOS installer has finished.');
  lines.push('# Paste the whole block into the VyOS CLI (it enters configuration mode, commits, and saves).');
  lines.push('#');
  lines.push('# Interface map -- matches the NICs vyos-deploy.ps1 attached to the VM:');
  lines.push('#   eth0 = WAN (upstream/internet access)');
  lines.push('#   eth1 = Nested-Trunk (VLAN 4095 trunk on vSwitch1 -- carries every lab VLAN)');
  lines.push('#');
  lines.push(`#   Management (${mgmtCidr}${mgmtVlanId ? `, VLAN ${mgmtVlanId}` : ', untagged'}) is the only VLAN VyOS routes --`);
  lines.push('#   configured below as a vif on eth1 (or directly on eth1 if untagged).');
  const passthroughNets = [];
  if (nets.vMotion) passthroughNets.push(['vMotion', nets.vMotion]);
  if (nets.vmTraffic) passthroughNets.push(['VM Traffic', nets.vmTraffic]);
  if (spec.nestedCluster?.vsanEnabled && nets.vsan) passthroughNets.push(['vSAN', nets.vsan]);
  if (passthroughNets.length > 0) {
    lines.push('#');
    lines.push('#   These VLANs also ride the eth1 trunk but VyOS does not route them -- nested ESXi');
    lines.push('#   hosts see each other\'s tagged frames directly at L2 (no VyOS IP/vif needed):');
    passthroughNets.forEach(([label, net]) => {
      lines.push(`#     ${label} (${net.cidr}${net.vlanId ? `, VLAN ${net.vlanId}` : ', untagged'})`);
    });
  }
  lines.push('');
  lines.push('configure');
  lines.push('');
  lines.push('# WAN -- gets an IP from your upstream router via DHCP');
  lines.push('set interfaces ethernet eth0 address dhcp');
  lines.push('set interfaces ethernet eth0 description WAN');
  lines.push('');
  lines.push('# Management LAN');
  if (taggedMgmt) {
    lines.push(`# Tagged management: VyOS uses a VLAN sub-interface (vif) on eth1 (Nested-Trunk)`);
    lines.push(`# VLAN ID ${mgmtVlanId} must also be set on each nested ESXi host's management vmkernel port`);
    lines.push(`set interfaces ethernet eth1 vif ${mgmtVlanId} address '${mgmtGwCidr}'`);
    lines.push(`set interfaces ethernet eth1 vif ${mgmtVlanId} description Management`);
  } else {
    lines.push(`set interfaces ethernet eth1 address '${mgmtGwCidr}'`);
    lines.push('set interfaces ethernet eth1 description Management');
  }
  lines.push('');
  lines.push('# NAT: masquerade management traffic out the WAN interface');
  lines.push('set nat source rule 100 outbound-interface eth0');
  lines.push(`set nat source rule 100 source address '${mgmtCidr}'`);
  lines.push("set nat source rule 100 translation address masquerade");
  lines.push('');
  lines.push('# DHCP on management network');
  const dhcpStart = mgmtCidr.replace(/\.\d+\/\d+$/, '.100');
  const dhcpStop = mgmtCidr.replace(/\.\d+\/\d+$/, '.200');
  lines.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' subnet-id '1'`);
  lines.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' range 0 start '${dhcpStart}'`);
  lines.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' range 0 stop '${dhcpStop}'`);
  lines.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option default-router '${mgmtGwCidr.split('/')[0]}'`);
  if (dc.enabled && dc.ipAddress) {
    lines.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option name-server '${dc.ipAddress}'`);
  } else {
    lines.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' option name-server '8.8.8.8'`);
  }
  lines.push('');
  const ntpSource = spec.ntp?.source || 'pool.ntp.org';
  lines.push('# NTP -- all lab components must reference the same time source');
  lines.push(`set system ntp server '${ntpSource}'`);
  lines.push('');
  if (vyos.networkMode === 'bgp') {
    const vyosAs = nsx.bgpPeerAs || 65002;
    const nsxAs = nsx.bgpLocalAs || 65001;
    lines.push('# BGP peering with the NSX T0 gateway');
    lines.push(`set protocols bgp system-as ${vyosAs}`);
    if (nsx.enabled && nsx.ipAddress) {
      lines.push(`set protocols bgp neighbor ${nsx.ipAddress} remote-as ${nsxAs}`);
      lines.push(`set protocols bgp neighbor ${nsx.ipAddress} address-family ipv4-unicast`);
    } else {
      lines.push('# NSX T0 uplink IP is not known yet -- deploy NSX first (nsx-deploy.ps1 / nsx-configure.ps1),');
      lines.push('# then replace <NSX-T0-UPLINK-IP> below and re-run this block.');
      lines.push(`set protocols bgp neighbor <NSX-T0-UPLINK-IP> remote-as ${nsxAs}`);
      lines.push(`set protocols bgp neighbor <NSX-T0-UPLINK-IP> address-family ipv4-unicast`);
    }
    lines.push('');
  }
  lines.push('commit');
  lines.push('save');
  lines.push('');
  lines.push('# Verify: from a machine on the management network, ping the VyOS LAN interface');
  lines.push(`# (${mgmtGwCidr.split('/')[0]}) and confirm you can reach the internet through NAT.`);
  lines.push('');

  return lines.join('\n');
}

// --- Stage 2: Domain controller VM shell ---

function buildDcDeploy(spec) {
  const lines = [];
  const dc = spec.domainController;

  const physHosts = spec.physicalHosts || [spec.physicalHost];
  const dcHostIdx = Math.min((spec.componentPlacement?.dc ?? 0), physHosts.length - 1);
  const dcPhysHost = physHosts[dcHostIdx];
  const dcDefaultIp = dcPhysHost?.ipAddress ? ` = "${dcPhysHost.ipAddress}"` : '';

  const profile     = dc.profile || 'dc-only';
  const hasJumpbox  = dc.hasJumpbox  || false;
  const hasFileServer = dc.hasFileServer || false;
  const storageDiskGB = dc.storageDiskGB || 200;
  const onPhysicalNet = dc.networkPlacement === 'physical';

  const vcpu   = profile === 'dc-only' ? 2 : 4;
  const ramGB  = profile === 'dc-only' ? 4 : 8;
  const diskGB = profile === 'dc-only' ? 60 : 100;

  const profileLabel = profile === 'dc-only' ? 'DC only' : profile === 'dc-jumpbox' ? 'DC + Jumpbox' : 'DC + Jumpbox + File Server';

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push(`    Stage 2: Deploy the Windows DC VM shell (${profileLabel}).`);
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  if (onPhysicalNet) {
    lines.push('    DC is placed on the physical/home network, not the lab network -- it does not');
    lines.push('    depend on VyOS being configured. It still must be up and promoted before nested');
    lines.push('    ESXi hosts are installed, since every host points at it for DNS and NTP.');
  } else {
    lines.push('    Run this after vyos-deploy.ps1 and after VyOS is configured.');
    lines.push('    The DC must be up and promoted before nested ESXi hosts are installed.');
    lines.push('    Every host points at the DC for DNS and NTP, and vCenter needs DNS to');
    lines.push('    resolve its own FQDN during installation. DC first, everything else after.');
  }
  lines.push('    Install Windows Server manually, then run:');
  lines.push('      Install-WindowsFeature AD-Domain-Services -IncludeManagementTools');
  lines.push(`      Install-ADDSForest -DomainName "${dc.domainName || 'lab.yourdomain.com'}" -SafeModeAdministratorPassword (Read-Host -AsSecureString)`);
  if (hasJumpbox) {
    lines.push('    After promotion, enable RDP: System Properties > Remote > Allow remote connections.');
    lines.push('    Open Windows Firewall for RDP (TCP 3389) if not already open.');
  }
  if (hasFileServer) {
    lines.push(`    A ${storageDiskGB}GB storage disk is attached for ISO/software sharing.`);
    lines.push('    After Windows install, initialise the disk and share it as LabISOs (see build-guide.md).');
  }
  lines.push('');
  lines.push('.NOTES');
  if (dc.domainName) lines.push(`    Domain: ${dc.domainName}`);
  if (dc.ipAddress) lines.push(`    DC IP: ${dc.ipAddress} -- set this as a static IP during Windows setup`);
  lines.push(`    DC profile: ${profileLabel}`);
  lines.push(`    DC sizing: ${vcpu} vCPU, ${ramGB}GB RAM, ${diskGB}GB OS disk${hasFileServer ? `, ${storageDiskGB}GB storage disk` : ''}`);
  if (onPhysicalNet) {
    lines.push('    Network: physical/home network (WAN port group) -- reachable directly, not routed through VyOS');
  } else {
    lines.push('    Network: Nested-Trunk (untagged/native traffic -- the DC does not do its own VLAN tagging)');
  }
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push(`    [string]$VIServer${dcDefaultIp},`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push(`    [string]$VMHostName${dcDefaultIp},`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$Datastore,');
  lines.push('');
  if (onPhysicalNet) {
    lines.push('    # Port group with the physical uplink -- same one VyOS uses for its WAN NIC');
    lines.push('    [string]$PortGroup = "VM Network",');
    lines.push('');
  }
  lines.push('    [string]$VmName = "lab-dc-01"');
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  emitLabConfigLoader(lines);
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('$cred = Get-Credential -Message "Credentials for $VIServer"');
  lines.push('Connect-VIServer -Server $VIServer -Credential $cred | Out-Null');
  lines.push('');
  lines.push('$vmHost = Get-VMHost -Name $VMHostName');
  lines.push('$ds = Get-Datastore -Name $Datastore');
  lines.push('');
  emitDatastoreIsoResolution(lines, { varName: 'WindowsIsoPath', configKey: 'windowsServerIso', label: 'Windows Server ISO' });
  lines.push('');
  lines.push('# Note: no -Location/VM folder here -- this connects directly to a standalone');
  lines.push('# ESXi host (vCenter does not exist yet), and standalone hosts have no VM folders.');
  lines.push('');
  lines.push('if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) {');
  lines.push('    Write-Host "$VmName already exists, skipping."');
  lines.push('    exit 0');
  lines.push('}');
  lines.push('');
  lines.push(`$vm = New-VM -Name $VmName \``);
  lines.push('    -VMHost $vmHost `');
  lines.push('    -Datastore $ds `');
  lines.push(`    -DiskGB ${diskGB} \``);
  lines.push(`    -MemoryGB ${ramGB} \``);
  lines.push(`    -NumCpu ${vcpu} \``);
  lines.push('    -GuestId "windows2019srv_64Guest" `');
  lines.push('    -CD');
  lines.push('');
  if (onPhysicalNet) {
    lines.push('New-NetworkAdapter -VM $vm -NetworkName $PortGroup -Type Vmxnet3 -StartConnected | Out-Null');
  } else {
    lines.push('New-NetworkAdapter -VM $vm -NetworkName "Nested-Trunk" -Type Vmxnet3 -StartConnected | Out-Null');
  }
  lines.push('');
  if (hasFileServer) {
    lines.push(`# Storage disk for ISO/software sharing`);
    lines.push(`New-HardDisk -VM $vm -CapacityGB ${storageDiskGB} -StorageFormat Thin | Out-Null`);
    lines.push(`Write-Host "Storage disk (${storageDiskGB}GB) attached to $VmName"`);
    lines.push('');
  }
  if (spec.nestedCluster.legacyCpuCompatibility) {
    lines.push('New-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU" -Value "TRUE" -Confirm:$false | Out-Null');
    lines.push('');
  }
  lines.push('Get-CDDrive -VM $vm | Set-CDDrive -IsoPath $WindowsIsoPath -StartConnected $true -Confirm:$false | Out-Null');
  lines.push('');
  if (dc.ipAddress || dc.domainName) {
    const noteVal = [dc.ipAddress && `IP: ${dc.ipAddress}`, dc.domainName && `Domain: ${dc.domainName}`, `Profile: ${profileLabel}`].filter(Boolean).join('  ');
    lines.push(`Set-VM -VM $vm -Notes "${noteVal}" -Confirm:$false | Out-Null`);
    lines.push('');
  }
  lines.push(`Write-Host "DC VM shell ready: $VmName (${profileLabel})"`);
  lines.push('Write-Host "Power it on, install Windows Server, set a static IP, then promote to DC."');
  if (dc.ipAddress) lines.push(`Write-Host "Planned DC IP: ${dc.ipAddress}"`);
  if (dc.domainName) lines.push(`Write-Host "Domain: ${dc.domainName}"`);
  if (hasJumpbox) lines.push('Write-Host "After promotion: enable RDP and open TCP 3389 in Windows Firewall."');
  if (hasFileServer) lines.push(`Write-Host "After promotion: initialise the ${storageDiskGB}GB disk and share it as LabISOs (see build-guide.md)."`);
  lines.push('Write-Host "Once the DC is up, proceed to deploy-lab.ps1 to build the nested ESXi hosts."');
  lines.push('');
  lines.push('Disconnect-VIServer -Server $VIServer -Confirm:$false');
  lines.push('');

  return lines.join('\n');
}

function buildRdpFile(dc) {
  if (!dc.hasJumpbox || !dc.ipAddress) return null;
  return [
    `full address:s:${dc.ipAddress}`,
    'username:s:Administrator',
    'prompt for credentials:i:1',
    'redirectclipboard:i:1',
    'redirectdrives:i:0',
    'redirectprinters:i:0',
    'autoreconnection enabled:i:1',
    'session bpp:i:32',
    'screen mode id:i:2',
    'desktopwidth:i:1920',
    'desktopheight:i:1080',
    '',
  ].join('\r\n');
}

// --- Helper: emit the internal lab vSwitch + single VLAN-4095 trunk port group ---
// (reused across single/multi-host paths). vSwitch1 has no physical uplink -- it only
// carries traffic between lab VMs and VyOS, which does the inter-VLAN routing.

function emitTrunkPortGroupBlock(lines, indent = '') {
  lines.push(`${indent}if (-not (Get-VirtualSwitch -VMHost $vmHost -Name $LabVSwitchName -ErrorAction SilentlyContinue)) {`);
  lines.push(`${indent}    New-VirtualSwitch -VMHost $vmHost -Name $LabVSwitchName -Confirm:$false | Out-Null`);
  lines.push(`${indent}}`);
  lines.push(`${indent}$vSwitch = Get-VirtualSwitch -VMHost $vmHost -Name $LabVSwitchName`);
  lines.push('');
  lines.push(`${indent}if (-not (Get-VirtualPortGroup -VirtualSwitch $vSwitch -Name "Nested-Trunk" -ErrorAction SilentlyContinue)) {`);
  lines.push(`${indent}    New-VirtualPortGroup -VirtualSwitch $vSwitch -Name "Nested-Trunk" -VlanId 4095 | Out-Null`);
  lines.push(`${indent}}`);
  lines.push(`${indent}$trunkPg = Get-VirtualPortGroup -VirtualSwitch $vSwitch -Name "Nested-Trunk"`);
  lines.push(`${indent}Get-SecurityPolicy -VirtualPortGroup $trunkPg |`);
  lines.push(`${indent}    Set-SecurityPolicy -AllowPromiscuous $true -ForgedTransmits $true -MacChanges $true | Out-Null`);
  lines.push(`${indent}Write-Host "Port group ready: Nested-Trunk (VLAN 4095 trunk on $LabVSwitchName)"`);
}

// Emit the PowerShell block that adds an NVMe controller + one disk per vSAN ESA storage pool
// entry to an already-created VM.  vmVar is the PS variable holding the VM ($vm, $vm etc).
// esaDisks is the JS array of {sizeGB} objects -- sizes are baked in statically.
function emitEsaNvmeBlock(lines, esaDisks, vmVar, indent) {
  const sizeArr = `@(${esaDisks.map((d) => d.sizeGB).join(', ')})`;
  lines.push(`${indent}# vSAN ESA: storage pool disks must be NVMe -- SCSI disks are not claimed by ESA`);
  lines.push(`${indent}$ctrl = New-Object VMware.Vim.VirtualNVMEController`);
  lines.push(`${indent}$ctrl.key = -100; $ctrl.busNumber = 0`);
  lines.push(`${indent}$cs   = New-Object VMware.Vim.VirtualDeviceConfigSpec`);
  lines.push(`${indent}$cs.device = $ctrl`);
  lines.push(`${indent}$cs.operation = [VMware.Vim.VirtualDeviceConfigSpecOperation]::add`);
  lines.push(`${indent}$devChg = @($cs); $unitNum = 0`);
  lines.push(`${indent}foreach ($esaGB in ${sizeArr}) {`);
  lines.push(`${indent}    $d = New-Object VMware.Vim.VirtualDisk`);
  lines.push(`${indent}    $d.key = -101 - $unitNum; $d.controllerKey = -100; $d.unitNumber = $unitNum`);
  lines.push(`${indent}    $d.capacityInKB = $esaGB * 1MB`);
  lines.push(`${indent}    $b = New-Object VMware.Vim.VirtualDiskFlatVer2BackingInfo`);
  lines.push(`${indent}    $b.diskMode = "persistent"; $b.thinProvisioned = $true; $b.fileName = ""`);
  lines.push(`${indent}    $d.backing = $b`);
  // $diskCfgSpec, not $ds -- callers already use $ds for the datastore object
  // (Get-Datastore), and this runs once per host; reusing $ds here would
  // silently clobber it after host 1, breaking -Datastore $ds on host 2+.
  lines.push(`${indent}    $diskCfgSpec = New-Object VMware.Vim.VirtualDeviceConfigSpec`);
  lines.push(`${indent}    $diskCfgSpec.device = $d`);
  lines.push(`${indent}    $diskCfgSpec.operation = [VMware.Vim.VirtualDeviceConfigSpecOperation]::add`);
  lines.push(`${indent}    $diskCfgSpec.fileOperation = [VMware.Vim.VirtualDeviceConfigSpecFileOperation]::create`);
  lines.push(`${indent}    $devChg += $diskCfgSpec; $unitNum++`);
  lines.push(`${indent}}`);
  lines.push(`${indent}$cfgSpec = New-Object VMware.Vim.VirtualMachineConfigSpec`);
  lines.push(`${indent}$cfgSpec.deviceChange = $devChg`);
  lines.push(`${indent}${vmVar}.ExtensionData.ReconfigVM_Task($cfgSpec) | Wait-Task | Out-Null`);
}

function emitVmCreationLoop(lines, hostNums, nc, guestId, additionalDisks, sessionId) {
  const hostNumsArr = `@(${hostNums.join(', ')})`;
  lines.push(`foreach ($i in ${hostNumsArr}) {`);
  lines.push('    $vmName = "nested-esxi-{0:D2}" -f $i');
  lines.push('');
  lines.push('    if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) {');
  lines.push('        Write-Host "$vmName already exists, skipping."');
  lines.push('        continue');
  lines.push('    }');
  lines.push('');
  lines.push('    $vm = New-VM -Name $vmName `');
  lines.push('        -VMHost $vmHost `');
  lines.push('        -Datastore $ds `');
  lines.push('        -DiskGB $bootDiskGB `');
  lines.push('        -MemoryGB $vramPerHostGB `');
  lines.push('        -NumCpu $vcpuPerHost `');
  lines.push(`        -GuestId "${guestId}" \``);
  lines.push('        -CD');
  lines.push('');
  lines.push('    New-NetworkAdapter -VM $vm -NetworkName "Nested-Trunk" -Type Vmxnet3 -StartConnected | Out-Null');
  lines.push('');
  lines.push('    New-AdvancedSetting -Entity $vm -Name "vhv.enable" -Value "TRUE" -Confirm:$false | Out-Null');
  if (nc.legacyCpuCompatibility) {
    lines.push('    New-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU" -Value "TRUE" -Confirm:$false | Out-Null');
  }
  const isEsa = nc.vsanArchitecture === 'esa';
  const esaPoolDisks = isEsa ? additionalDisks.filter((d) => d.purpose === 'vsan_storage_pool') : [];
  const scsiDisks    = additionalDisks.filter((d) => d.purpose !== 'vsan_storage_pool');

  if (esaPoolDisks.length > 0) {
    lines.push('');
    emitEsaNvmeBlock(lines, esaPoolDisks, '$vm', '    ');
  }
  if (scsiDisks.length > 0) {
    lines.push('');
    lines.push('    foreach ($disk in $additionalDisks) {');
    lines.push("        if ($disk.Purpose -eq 'local_datastore' -and $i -ne 1) { continue }");
    lines.push('        New-HardDisk -VM $vm -CapacityGB $disk.SizeGB -StorageFormat Thin -Confirm:$false | Out-Null');
    lines.push('    }');
  }
  lines.push('');
  lines.push('    Get-CDDrive -VM $vm | Set-CDDrive -IsoPath $EsxiIsoPath -StartConnected $true -Confirm:$false | Out-Null');
  lines.push('    Start-VM -VM $vm | Out-Null');
  lines.push('    Write-Host "Created and powered on $vmName."');
  if (sessionId) {
    lines.push('    if ($WizardIp) {');
    lines.push(`        Write-Host "    Kickstart: at the ESXi boot menu press Shift+O and append:"`);
    lines.push(`        Write-Host "      ks=http://\$WizardIp:3000/api/ks/${sessionId}/\$i"`);
    lines.push('    }');
  }
  lines.push('}');
}

// --- Stage 3: Port groups + nested ESXi VM shells (ISO) or OVA import ---

function buildDeployLab(spec, sessionId) {
  const isOva = spec.esxiDeployMethod === 'ova';
  return isOva ? buildDeployLabOva(spec) : buildDeployLabIso(spec, sessionId);
}

function buildDeployLabIso(spec, sessionId) {
  const lines = [];
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const dc = spec.domainController;
  const localDs = spec.localDatastore;
  const versionKey = spec.esxiVersion?.version || null;
  const guestId = ESXI_GUEST_ID[versionKey] || 'vmkernel65Guest';
  const versionLabel = spec.esxiVersion?.label || 'ESXi (version not specified)';

  const prereqs = [];
  if (spec.vyos?.enabled) prereqs.push('vyos-deploy.ps1 (VyOS installed and configured)');
  if (dc.enabled) prereqs.push('dc-deploy.ps1 (DC installed and promoted)');

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push(`    Stage ${prereqs.length + 1}: Port groups and nested ESXi VM shells.`);
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  if (prereqs.length) {
    lines.push(`    Run this after: ${prereqs.join(', ')}.`);
  }
  lines.push('    This script does not install ESXi. Power on each VM, run through the ESXi');
  lines.push('    installer, then proceed to vcenter-deploy.ps1.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    ESXi version: ${versionLabel} (GuestId: ${guestId})`);
  lines.push(`    Nested hosts: ${nc.hostCount} x (${nc.vcpuPerHost} vCPU, ${nc.vramPerHostGB}GB vRAM, ${nc.bootDiskGB}GB boot disk)`);
  const additionalDisks = nc.additionalDisks || [];
  const vsanDisks = additionalDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache' || d.purpose === 'vsan_storage_pool');
  const localDsDisk = additionalDisks.find((d) => d.purpose === 'local_datastore');
  if (vsanDisks.length > 0) {
    lines.push(`    vSAN disks added per host: ${vsanDisks.map((d) => d.sizeGB + 'GB ' + d.purpose.replace('vsan_', '') + ' VMDK').join(' + ')}`);
    lines.push('    Do NOT format or partition these during ESXi installation -- vsan-cluster.ps1 claims them.');
  }
  if (localDsDisk) {
    lines.push(`    Local datastore: an extra ${localDsDisk.sizeGB}GB VMDK is added to nested-esxi-01 only.`);
    lines.push('    Format it as VMFS during ESXi setup (name it "local-ds").');
    lines.push('    vCenter deploys onto this datastore in vcenter-deploy.ps1.');
  }
  if (dc.enabled && dc.ipAddress) {
    lines.push(`    After installing ESXi on each host, set DNS and NTP to ${dc.ipAddress} (the DC).`);
  }
  // Physical storage inventory
  const storageDev = (spec.physicalHost?.storageDevices || []);
  if (storageDev.length > 0) {
    lines.push('');
    lines.push('    Physical storage inventory:');
    const TYPE_LABEL = { nvme: 'NVMe', sata_ssd: 'SATA SSD', sas_ssd: 'SAS SSD', spinning_disk: 'HDD' };
    storageDev.forEach((d, i) => {
      const capLabel = d.capacityGB >= 1000 ? `${(d.capacityGB / 1000).toFixed(1)}TB` : `${d.capacityGB}GB`;
      lines.push(`    Disk ${i + 1}: ${TYPE_LABEL[d.type] || d.type} ${capLabel}`);
    });
  }
  if (additionalDisks.length > 0) {
    lines.push('');
    lines.push('    Nested host disk layout (additional VMDKs per host):');
    additionalDisks.forEach((d) => {
      const hostsNote = d.purpose === 'local_datastore' ? ' (host 1 only)' : ' (all hosts)';
      lines.push(`    - ${d.sizeGB}GB [${d.purpose}]${hostsNote}`);
    });
  }
  lines.push('');
  lines.push('    Each nested host gets ONE vNIC, on Nested-Trunk (VLAN 4095 trunk on vSwitch1).');
  lines.push('    During/after ESXi install, create these VLAN-tagged port groups on the nested');
  lines.push('    host\'s own vSwitch so its vmkernel ports can reach each lab network:');
  const trunkVlans = [];
  if (nets.management) trunkVlans.push(['Management', nets.management.vlanId]);
  if (nets.vMotion) trunkVlans.push(['vMotion', nets.vMotion.vlanId]);
  if (nc.vsanEnabled && nets.vsan) trunkVlans.push(['vSAN', nets.vsan.vlanId]);
  if (nets.vmTraffic) trunkVlans.push(['VM Traffic', nets.vmTraffic.vlanId]);
  trunkVlans.forEach(([label, vlanId]) => {
    lines.push(`      ${label}: VLAN ${vlanId || 'untagged (native)'}`);
  });
  lines.push('    Source spec: lab-spec.json');
  if (sessionId) {
    lines.push('');
    lines.push('    Kickstart (unattended install):');
    lines.push(`    ks.cfg files are in the output folder: ks-esxi-01.cfg … ks-esxi-${String(nc.hostCount || 1).padStart(2, '0')}.cfg`);
    lines.push('    Pass -WizardIp <ip> to have this script print the kickstart URL for each host.');
    lines.push('    At the ESXi boot menu press Shift+O and append the URL shown (e.g. ks=http://...).');
  }
  lines.push('#>');
  lines.push('');
  // Per-physical-host placement from spec
  const physHosts = spec.physicalHosts || [spec.physicalHost];
  const hostPlacement = nc.hosts || [];
  const physCount = physHosts.length;

  // Group nested host indices by physical host
  const groupsByPhys = Array.from({ length: physCount }, () => []);
  for (let i = 0; i < nc.hostCount; i++) {
    const physIdx = (hostPlacement[i]?.physicalHostIndex ?? (i % physCount));
    groupsByPhys[Math.min(physIdx, physCount - 1)].push(i + 1);
  }

  lines.push('param(');
  if (physCount === 1) {
    lines.push('    [Parameter(Mandatory = $true)]');
    lines.push(`    [string]$VIServer${physHosts[0]?.ipAddress ? ` = "${physHosts[0].ipAddress}"` : ''},`);
    lines.push('');
    lines.push('    [Parameter(Mandatory = $true)]');
    lines.push('    [string]$VMHostName,');
    lines.push('');
  } else {
    physHosts.forEach((ph, pi) => {
      const defaultIp = ph.ipAddress ? ` = "${ph.ipAddress}"` : '';
      lines.push(`    [string]$PhysHost${pi + 1}IP${defaultIp},`);
      lines.push('');
    });
  }
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$Datastore,');
  lines.push('');
  lines.push('    # IP or hostname of the machine running zero-to-hero-lab.');
  lines.push('    # When set, the script prints a kickstart URL for each nested host after VM creation.');
  lines.push('    [string]$WizardIp = "",');
  lines.push('');
  lines.push('    [string]$LabVSwitchName = "vSwitch1"');
  lines.push(')');
  lines.push('');
  if (sessionId) {
    lines.push(`$KsSessionId = "${sessionId}"`);
    lines.push('');
  }
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  emitLabConfigLoader(lines);
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');

  const isEsaIso = nc.vsanArchitecture === 'esa';
  const scsiDisksIso = additionalDisks.filter((d) => !isEsaIso || d.purpose !== 'vsan_storage_pool');
  if (scsiDisksIso.length > 0) {
    lines.push('$additionalDisks = @(');
    scsiDisksIso.forEach((d) => {
      lines.push(`    @{ SizeGB = ${d.sizeGB}; Purpose = '${d.purpose}' }`);
    });
    lines.push(')');
    lines.push('');
  }

  lines.push(`$vcpuPerHost    = ${nc.vcpuPerHost}`);
  lines.push(`$vramPerHostGB  = ${nc.vramPerHostGB}`);
  lines.push(`$bootDiskGB     = ${nc.bootDiskGB}`);
  lines.push('');

  if (physCount === 1) {
    // Single physical host -- simple connect/disconnect
    const h1HostNums = groupsByPhys[0];
    lines.push('# --- Connect ---');
    lines.push('$cred = Get-Credential -Message "Credentials for $VIServer"');
    lines.push('Connect-VIServer -Server $VIServer -Credential $cred | Out-Null');
    lines.push('');
    lines.push('$vmHost = Get-VMHost -Name $VMHostName');
    lines.push('$ds = Get-Datastore -Name $Datastore');
    lines.push('');
    emitDatastoreIsoResolution(lines, { varName: 'EsxiIsoPath', configKey: 'esxiIso', label: 'Nested ESXi install ISO' });
    lines.push('');
    lines.push('# --- Internal lab vSwitch + trunk port group ---');
    lines.push('# vSwitch1 has no physical uplink. Promiscuous mode, forged transmits, and MAC');
    lines.push('# address changes must all be allowed -- nested ESXi/VyOS send frames from MAC');
    lines.push('# addresses the vSwitch never learned, and it silently drops them otherwise.');
    lines.push('');
    emitTrunkPortGroupBlock(lines);
    lines.push('');
    emitVmCreationLoop(lines, h1HostNums, nc, guestId, additionalDisks, sessionId);
    lines.push('Disconnect-VIServer -Server $VIServer -Confirm:$false');
  } else {
    // Multiple physical hosts -- loop per host
    lines.push('# ── Physical host groups ──────────────────────────────────────────────────');
    lines.push('# Edit the IP defaults above if your host IPs differ from the spec.');
    lines.push('$physicalHostGroups = @(');
    groupsByPhys.forEach((hostNums, pi) => {
      const ip = physHosts[pi]?.ipAddress ? physHosts[pi].ipAddress : `<phys-host-${pi + 1}-ip>`;
      const numList = hostNums.map((n) => `"nested-esxi-${String(n).padStart(2, '0')}"`).join(', ');
      lines.push(`    @{ IP = $PhysHost${pi + 1}IP; NestedVMs = @(${numList}) }`);
    });
    lines.push(')');
    lines.push('');
    lines.push('foreach ($physHost in $physicalHostGroups) {');
    lines.push('    Write-Host "=== Connecting to physical host: $($physHost.IP) ==="');
    lines.push('    $cred = Get-Credential -Message "Credentials for $($physHost.IP)"');
    lines.push('    Connect-VIServer -Server $physHost.IP -Credential $cred | Out-Null');
    lines.push('');
    lines.push('    $vmHost = Get-VMHost');
    lines.push('    $ds = Get-Datastore -Name $Datastore');
    lines.push('');
    emitDatastoreIsoResolution(lines, { varName: 'EsxiIsoPath', configKey: 'esxiIso', label: 'Nested ESXi install ISO', indent: '    ' });
    lines.push('');
    lines.push('    # Internal lab vSwitch + trunk port group -- must be created on every physical host.');
    lines.push('    # vSwitch1 has no physical uplink. Promiscuous mode and MAC changes must be on for');
    lines.push('    # nested ESXi/VyOS frames to pass.');
    lines.push('');
    emitTrunkPortGroupBlock(lines, '    ');
    lines.push('');
    lines.push('    foreach ($vmName in $physHost.NestedVMs) {');
    lines.push('        $hostIndex = [int]($vmName -replace "nested-esxi-","")');
    lines.push('        if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) {');
    lines.push('            Write-Host "$vmName already exists, skipping."');
    lines.push('            continue');
    lines.push('        }');
    lines.push('');
    lines.push('        $vm = New-VM -Name $vmName `');
    lines.push('            -VMHost $vmHost `');
    lines.push('            -Datastore $ds `');
    lines.push('            -DiskGB $bootDiskGB `');
    lines.push('            -MemoryGB $vramPerHostGB `');
    lines.push('            -NumCpu $vcpuPerHost `');
    lines.push(`            -GuestId "${guestId}" \``);
    lines.push('            -CD');
    lines.push('');
    lines.push('        New-NetworkAdapter -VM $vm -NetworkName "Nested-Trunk" -Type Vmxnet3 -StartConnected | Out-Null');
    lines.push('');
    lines.push('        New-AdvancedSetting -Entity $vm -Name "vhv.enable" -Value "TRUE" -Confirm:$false | Out-Null');
    if (nc.legacyCpuCompatibility) {
      lines.push('        New-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU" -Value "TRUE" -Confirm:$false | Out-Null');
    }
    const esaPoolDisksMulti = isEsaIso ? additionalDisks.filter((d) => d.purpose === 'vsan_storage_pool') : [];
    const scsiDisksMulti    = additionalDisks.filter((d) => d.purpose !== 'vsan_storage_pool');
    if (esaPoolDisksMulti.length > 0) {
      lines.push('');
      emitEsaNvmeBlock(lines, esaPoolDisksMulti, '$vm', '        ');
    }
    if (scsiDisksMulti.length > 0) {
      lines.push('');
      lines.push('        foreach ($disk in $additionalDisks) {');
      lines.push("            if ($disk.Purpose -eq 'local_datastore' -and $hostIndex -ne 1) { continue }");
      lines.push('            New-HardDisk -VM $vm -CapacityGB $disk.SizeGB -StorageFormat Thin -Confirm:$false | Out-Null');
      lines.push('        }');
    }
    lines.push('');
    lines.push('        Get-CDDrive -VM $vm | Set-CDDrive -IsoPath $EsxiIsoPath -StartConnected $true -Confirm:$false | Out-Null');
    lines.push('        Start-VM -VM $vm | Out-Null');
    lines.push('        Write-Host "Created and powered on $vmName on $($physHost.IP)."');
    if (sessionId) {
      lines.push('        if ($WizardIp) {');
      lines.push(`            $ksIdx = [int]($vmName -replace "nested-esxi-", "")`);
      lines.push(`            Write-Host "    Kickstart: at the ESXi boot menu press Shift+O and append:"`);
      lines.push(`            Write-Host "      ks=http://\$WizardIp:3000/api/ks/${sessionId}/\$ksIdx"`);
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
    lines.push('    Disconnect-VIServer -Server $physHost.IP -Confirm:$false');
    lines.push('}');
  }

  lines.push('');
  lines.push('Write-Host ""');
  lines.push('Write-Host "Port groups created and all nested ESXi VMs created and powered on."');
  if (sessionId) {
    lines.push('if ($WizardIp) {');
    lines.push('    Write-Host "Kickstart URLs were printed above -- use them at each VM\'s boot menu."');
    lines.push('    Write-Host "Without kickstart: open each VM console and step through the ESXi installer."');
    lines.push('}');
  } else {
    lines.push('Write-Host "Open each VM console and step through the ESXi installer."');
  }
  if (dc.enabled && dc.ipAddress) {
    lines.push(`Write-Host "After installing ESXi: set DNS and NTP to ${dc.ipAddress} on each host."`);
  }
  if (localDs.enabled) {
    lines.push('Write-Host "On nested-esxi-01: format the extra disk as VMFS -- name it local-ds."');
  }
  lines.push('Write-Host "Then proceed to vcenter-deploy.ps1."');
  lines.push('');

  return lines.join('\n');
}

function buildDeployLabOva(spec) {
  const lines = [];
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const dc = spec.domainController;
  const localDs = spec.localDatastore;
  const versionLabel = spec.esxiVersion?.label || 'ESXi (version not specified)';
  const mgmtVlanId = nets.management?.vlanId || 0;

  const additionalDisks = nc.additionalDisks || [];
  const defaultNtp = dc.enabled && dc.ipAddress ? dc.ipAddress : 'pool.ntp.org';

  const prereqs = [];
  if (spec.vyos?.enabled) prereqs.push('vyos-deploy.ps1 (VyOS configured)');
  if (dc.enabled) prereqs.push('dc-deploy.ps1 (DC promoted)');

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push(`    Stage ${prereqs.length + 1}: Port groups and nested ESXi hosts -- fully automated via William Lam OVA.`);
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  if (prereqs.length) lines.push(`    Run this after: ${prereqs.join(', ')}.`);
  lines.push('    Deploys nested ESXi using William Lam\'s Nested ESXi Virtual Appliance OVA.');
  lines.push('    ESXi is pre-installed in the OVA -- no interactive install required.');
  lines.push('    OVF properties configure hostname, IP, credentials, and SSH on first boot.');
  lines.push('    Download the OVA for your version from:');
  lines.push('      https://williamlam.com/nested-virtualization/nested-esxi-virtual-appliance');
  lines.push('    ESXi 8.x OVAs: free with a Broadcom Community account.');
  lines.push('    ESXi 9.x OVAs: require an active VCF/VVF subscription entitlement.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    ESXi version: ${versionLabel}`);
  lines.push(`    Nested hosts: ${nc.hostCount} x (${nc.vcpuPerHost} vCPU, ${nc.vramPerHostGB}GB vRAM)`);
  lines.push('    OVF property names are from William Lam\'s Nested ESXi Virtual Appliance.');
  lines.push('    If import fails with property errors, inspect with:');
  lines.push('      govc import.spec $EsxiOvaPath');
  lines.push('    Requires govc for the OVA import -- PowerCLI\'s Import-VApp/Get-OvfConfiguration has');
  lines.push('    known reliability problems against a standalone ESXi host, since vApp import assumes');
  lines.push('    a vCenter-managed inventory that does not exist yet at this stage. Install govc from:');
  lines.push('      https://github.com/vmware/govmomi/releases');
  lines.push('    PowerCLI is still required too (vSwitch/port group setup, host/datastore lookup,');
  lines.push('    post-import disk/advanced-setting reconfiguration). govc has no NVMe controller');
  lines.push('    support, so ESA storage-pool disks are attached via PowerCLI after the govc import.');
  lines.push('');
  lines.push('    Each nested host gets ONE vNIC, on Nested-Trunk (VLAN 4095 trunk on vSwitch1).');
  lines.push(`    The OVA's guestinfo.vlan property tags its management vmkernel port with VLAN ${mgmtVlanId || '(untagged)'}.`);
  lines.push('    vMotion/vSAN/VM Traffic vmkernel ports are not part of the OVF template --');
  lines.push('    add them after first boot with the matching VLAN IDs from lab-spec.json.');
  lines.push('#>');
  lines.push('');
  // Per-physical-host placement from spec
  const physHostsOva = spec.physicalHosts || [spec.physicalHost];
  const hostPlacementOva = nc.hosts || [];
  const physCountOva = physHostsOva.length;
  const groupsByPhysOva = Array.from({ length: physCountOva }, () => []);
  for (let i = 0; i < nc.hostCount; i++) {
    const physIdx = (hostPlacementOva[i]?.physicalHostIndex ?? (i % physCountOva));
    groupsByPhysOva[Math.min(physIdx, physCountOva - 1)].push(i);  // 0-based indices
  }

  lines.push('param(');
  if (physCountOva === 1) {
    lines.push('    [Parameter(Mandatory = $true)]');
    lines.push(`    [string]$VIServer${physHostsOva[0]?.ipAddress ? ` = "${physHostsOva[0].ipAddress}"` : ''},`);
    lines.push('');
    lines.push('    [Parameter(Mandatory = $true)]');
    lines.push('    [string]$VMHostName,');
    lines.push('');
  } else {
    physHostsOva.forEach((ph, pi) => {
      const defaultIp = ph.ipAddress ? ` = "${ph.ipAddress}"` : '';
      lines.push(`    [string]$PhysHost${pi + 1}IP${defaultIp},`);
      lines.push('');
    });
  }
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$Datastore,');
  lines.push('');
  lines.push('    # One management IP per nested host, comma-separated, in order');
  const exampleIps = Array.from({ length: nc.hostCount }, (_, i) => `192.168.10.${11 + i}`).join(',');
  lines.push(`    # e.g. "${exampleIps}"`);
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$NestedHostIPsCSV,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$MgmtSubnetMask,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$MgmtGateway,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$MgmtDnsServer,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [securestring]$NestedRootPassword,');
  lines.push('');
  lines.push(`    [string]$MgmtDomain = "${dc.enabled && dc.domainName ? dc.domainName : 'lab.local'}",`);
  lines.push('');
  lines.push(`    [string]$NtpServer = "${defaultNtp}",`);
  lines.push('');
  lines.push('    [string]$LabVSwitchName = "vSwitch1"');
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  emitLabConfigLoader(lines);
  emitLocalFileResolution(lines, { varName: 'EsxiOvaPath', configKey: 'nestedEsxiOva', label: 'Nested ESXi appliance OVA' });
  lines.push('');
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('# govc is required for the OVA import -- PowerCLI\'s Import-VApp/Get-OvfConfiguration');
  lines.push('# has known reliability problems against a standalone ESXi host (vApp import semantics');
  lines.push('# assume a vCenter-managed inventory that does not exist yet at this stage).');
  lines.push('if (-not (Get-Command govc -ErrorAction SilentlyContinue)) {');
  lines.push('    throw "govc not found. Install it first: https://github.com/vmware/govmomi/releases"');
  lines.push('}');
  lines.push('');
  lines.push('$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(');
  lines.push('    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($NestedRootPassword))');
  lines.push('');
  lines.push('# --- Parse and validate host IPs ---');
  lines.push('$nestedHostIPs = $NestedHostIPsCSV -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }');
  lines.push(`if ($nestedHostIPs.Count -ne ${nc.hostCount}) {`);
  lines.push(`    throw "Expected ${nc.hostCount} IP(s) in NestedHostIPsCSV, got $($nestedHostIPs.Count)."`);
  lines.push('}');
  lines.push('');
  const isEsaOva = nc.vsanArchitecture === 'esa';
  const scsiDisksOva = additionalDisks.filter((d) => !isEsaOva || d.purpose !== 'vsan_storage_pool');
  if (scsiDisksOva.length > 0) {
    lines.push('$additionalDisks = @(');
    scsiDisksOva.forEach((d) => {
      lines.push(`    @{ SizeGB = ${d.sizeGB}; Purpose = '${d.purpose}' }`);
    });
    lines.push(')');
    lines.push('');
  }

  // Inline OVA import body -- used inside both single-host and multi-host loops.
  // hostRef is the PowerShell expression identifying the target host for govc's
  // -host flag (redundant with GOVC_URL when connected directly to a standalone
  // host, but matches the pattern already used in vcenter-deploy.ps1).
  const emitOvaImport = (lines, indent = '', hostRef) => {
    lines.push(`${indent}if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) {`);
    lines.push(`${indent}    Write-Host "$vmName already exists, skipping."`);
    lines.push(`${indent}    continue`);
    lines.push(`${indent}}`);
    lines.push('');
    lines.push(`${indent}Write-Host "Deploying $vmName ($hostIp) ..."`);
    lines.push('');
    lines.push(`${indent}$specFile = [System.IO.Path]::GetTempFileName() + ".json"`);
    lines.push(`${indent}govc import.spec $EsxiOvaPath | ConvertFrom-Json | ForEach-Object {`);
    lines.push(`${indent}    $_.NetworkMapping[0].Network = "Nested-Trunk"`);
    lines.push(`${indent}    foreach ($p in $_.PropertyMapping) {`);
    lines.push(`${indent}        switch ($p.Key) {`);
    lines.push(`${indent}            "guestinfo.hostname"   { $p.Value = $vmName }`);
    lines.push(`${indent}            "guestinfo.ipaddress"  { $p.Value = $hostIp }`);
    lines.push(`${indent}            "guestinfo.netmask"    { $p.Value = $MgmtSubnetMask }`);
    lines.push(`${indent}            "guestinfo.gateway"    { $p.Value = $MgmtGateway }`);
    lines.push(`${indent}            "guestinfo.vlan"       { $p.Value = "${mgmtVlanId}" }`);
    lines.push(`${indent}            "guestinfo.dns"        { $p.Value = $MgmtDnsServer }`);
    lines.push(`${indent}            "guestinfo.domain"     { $p.Value = $MgmtDomain }`);
    lines.push(`${indent}            "guestinfo.ntp"        { $p.Value = $NtpServer }`);
    lines.push(`${indent}            "guestinfo.password"   { $p.Value = $plainPassword }`);
    lines.push(`${indent}            "guestinfo.ssh"        { $p.Value = "true" }`);
    lines.push(`${indent}            "guestinfo.createvmfs" { $p.Value = "false" }`);
    lines.push(`${indent}        }`);
    lines.push(`${indent}    }`);
    lines.push(`${indent}    $_`);
    lines.push(`${indent}} | ConvertTo-Json -Depth 10 | Set-Content $specFile`);
    lines.push('');
    lines.push(`${indent}govc import.ova -options $specFile -ds $Datastore -host ${hostRef} -name $vmName $EsxiOvaPath`);
    lines.push(`${indent}Remove-Item $specFile -Force`);
    lines.push(`${indent}$vm = Get-VM -Name $vmName`);
    lines.push(`${indent}govc vm.change -vm $vmName -e vhv.enable=TRUE`);
    if (nc.legacyCpuCompatibility) {
      lines.push(`${indent}govc vm.change -vm $vmName -e monitor.allowLegacyCPU=TRUE`);
    }
    const esaPoolDisksOva = isEsaOva ? additionalDisks.filter((d) => d.purpose === 'vsan_storage_pool') : [];
    const scsiDisksOvaInner = additionalDisks.filter((d) => d.purpose !== 'vsan_storage_pool');
    if (esaPoolDisksOva.length > 0) {
      lines.push('');
      lines.push(`${indent}# govc has no NVMe controller support -- ESA storage-pool disks are always`);
      lines.push(`${indent}# attached via PowerCLI, regardless of which import path created the VM.`);
      emitEsaNvmeBlock(lines, esaPoolDisksOva, '$vm', indent);
    }
    if (scsiDisksOvaInner.length > 0) {
      lines.push('');
      lines.push(`${indent}foreach ($disk in $additionalDisks) {`);
      lines.push(`${indent}    if ($disk.Purpose -eq 'local_datastore' -and $hostNum -ne 1) { continue }`);
      lines.push(`${indent}    New-HardDisk -VM $vm -CapacityGB $disk.SizeGB -StorageFormat Thin -Confirm:$false | Out-Null`);
      lines.push(`${indent}}`);
    }
    lines.push('');
    lines.push(`${indent}Start-VM -VM $vm | Out-Null`);
    lines.push(`${indent}Write-Host "  Started $vmName -- ESXi booting (allow 2-3 minutes for first boot)"`);
  };

  if (physCountOva === 1) {
    lines.push('$cred = Get-Credential -Message "Credentials for $VIServer"');
    lines.push('Connect-VIServer -Server $VIServer -Credential $cred | Out-Null');
    lines.push('');
    lines.push('$env:GOVC_URL      = "https://$VIServer"');
    lines.push('$env:GOVC_INSECURE = "true"');
    lines.push('$env:GOVC_USERNAME = $cred.UserName');
    lines.push('$env:GOVC_PASSWORD = $cred.GetNetworkCredential().Password');
    lines.push('');
    lines.push('$vmHost = Get-VMHost -Name $VMHostName');
    lines.push('$ds = Get-Datastore -Name $Datastore');
    lines.push('');
    lines.push('# --- Internal lab vSwitch + trunk port group ---');
    emitTrunkPortGroupBlock(lines);
    lines.push('');
    lines.push('# --- Import OVA for each nested host ---');
    lines.push(`for ($i = 0; $i -lt ${nc.hostCount}; $i++) {`);
    lines.push('    $hostNum = $i + 1');
    lines.push('    $vmName  = "nested-esxi-{0:D2}" -f $hostNum');
    lines.push('    $hostIp  = $nestedHostIPs[$i]');
    lines.push('');
    emitOvaImport(lines, '    ', '$VMHostName');
    lines.push('}');
    lines.push('');
    lines.push('Disconnect-VIServer -Server $VIServer -Confirm:$false');
  } else {
    lines.push('# Physical host groups -- nested hosts distributed per spec placement');
    lines.push('$physicalHostGroups = @(');
    groupsByPhysOva.forEach((indices, pi) => {
      const idxList = indices.map((idx) => idx).join(', ');
      lines.push(`    @{ IP = $PhysHost${pi + 1}IP; Indices = @(${idxList}) }   # nested-esxi-${indices.map((idx) => String(idx + 1).padStart(2, '0')).join(', -')}`);
    });
    lines.push(')');
    lines.push('');
    lines.push('foreach ($physHost in $physicalHostGroups) {');
    lines.push('    Write-Host "=== Connecting to physical host: $($physHost.IP) ==="');
    lines.push('    $cred = Get-Credential -Message "Credentials for $($physHost.IP)"');
    lines.push('    Connect-VIServer -Server $physHost.IP -Credential $cred | Out-Null');
    lines.push('');
    lines.push('    $env:GOVC_URL      = "https://$($physHost.IP)"');
    lines.push('    $env:GOVC_INSECURE = "true"');
    lines.push('    $env:GOVC_USERNAME = $cred.UserName');
    lines.push('    $env:GOVC_PASSWORD = $cred.GetNetworkCredential().Password');
    lines.push('');
    lines.push('    $vmHost = Get-VMHost');
    lines.push('    $ds = Get-Datastore -Name $Datastore');
    lines.push('');
    lines.push('    # Internal lab vSwitch + trunk port group on this physical host');
    emitTrunkPortGroupBlock(lines, '    ');
    lines.push('');
    lines.push('    foreach ($idx in $physHost.Indices) {');
    lines.push('        $hostNum = $idx + 1');
    lines.push('        $vmName  = "nested-esxi-{0:D2}" -f $hostNum');
    lines.push('        $hostIp  = $nestedHostIPs[$idx]');
    lines.push('');
    emitOvaImport(lines, '        ', '$($physHost.IP)');
    lines.push('    }');
    lines.push('');
    lines.push('    Disconnect-VIServer -Server $physHost.IP -Confirm:$false');
    lines.push('}');
  }

  lines.push('');
  lines.push('Write-Host ""');
  lines.push('Write-Host "All nested hosts deployed and started."');
  lines.push('Write-Host "Allow 2-3 minutes per host for ESXi first-boot to complete."');
  if (dc.enabled && dc.ipAddress) {
    lines.push(`Write-Host "Each host is configured with DNS: ${dc.ipAddress}"`);
  }
  if (localDs.enabled) {
    lines.push('Write-Host "Next: format the local datastore disk on nested-esxi-01 as VMFS (name: local-ds)."');
  }
  lines.push('Write-Host "Then proceed to vcenter-deploy.ps1."');
  lines.push('');

  return lines.join('\n');
}

// --- Stage 4: vCenter VCSA deployment ---

function buildVcenterDeploy(spec) {
  const lines = [];
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const dc = spec.domainController;
  const localDs = spec.localDatastore;
  const ra = spec.remoteAccess;

  const deploySize = ra.vcenterDeploymentSize || 'small';
  const dnsServer = dc.enabled && dc.ipAddress ? dc.ipAddress : '8.8.8.8';

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push('    Deploy vCenter VCSA onto nested-esxi-01.');
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('    Run this after all nested ESXi hosts are installed and reachable.');
  lines.push('    Connects directly to nested-esxi-01 in standalone mode (vCenter does not');
  lines.push('    exist yet). Detects govc and uses it if available; falls back to PowerCLI.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    Deployment size: ${deploySize}`);
  lines.push(`    DNS for VCSA: ${dnsServer}${dc.enabled ? ' (domain controller)' : ''}`);
  if (localDs.enabled) {
    lines.push('    Target datastore: local-ds on nested-esxi-01');
  }
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    # Management IP/hostname of nested-esxi-01 (standalone, not in vCenter yet)');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$EsxiHostName,');
  lines.push('');
  lines.push(`    [string]$Datastore = "${localDs.enabled ? 'local-ds' : 'datastore1'}",`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$VcenterFqdn,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$VcenterIp,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$VcenterGateway,');
  lines.push('');
  lines.push(`    [string]$VcenterDnsServer = "${dnsServer}",`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [securestring]$VcenterPassword,');
  lines.push('');
  lines.push(`    [string]$DeploymentSize = "${deploySize}",`);
  lines.push('');
  lines.push('    [string]$MgmtPortGroup = "Nested-Trunk",');
  lines.push('');
  lines.push(`    [string]$SsoDomain = "${nc.ssoDomain || 'vsphere.local'}"`);
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  emitLabConfigLoader(lines);
  emitLocalFileResolution(lines, { varName: 'VcsaOvaPath', configKey: 'vCenterOva', label: 'vCenter Server Appliance OVA' });
  lines.push('');
  lines.push('$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(');
  lines.push('    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($VcenterPassword))');
  lines.push('');
  lines.push('# --- Detect govc vs PowerCLI and deploy accordingly ---');
  lines.push('$govcAvailable = Get-Command govc -ErrorAction SilentlyContinue');
  lines.push('');
  lines.push('if ($govcAvailable) {');
  lines.push('    Write-Host "govc found -- using govc to deploy VCSA"');
  lines.push('');
  lines.push('    $env:GOVC_URL      = "https://$EsxiHostName"');
  lines.push('    $env:GOVC_INSECURE = "true"');
  lines.push('    $esxiCred = Get-Credential -Message "ESXi credentials for $EsxiHostName"');
  lines.push('    $env:GOVC_USERNAME = $esxiCred.UserName');
  lines.push('    $env:GOVC_PASSWORD = $esxiCred.GetNetworkCredential().Password');
  lines.push('');
  lines.push('    $specFile = [System.IO.Path]::GetTempFileName() + ".json"');
  lines.push('    govc import.spec $VcsaOvaPath | ConvertFrom-Json | ForEach-Object {');
  lines.push('        $_.NetworkMapping[0].Network = $MgmtPortGroup');
  lines.push('        $_.DeploymentOption = $DeploymentSize');
  lines.push('        foreach ($p in $_.PropertyMapping) {');
  lines.push('            switch ($p.Key) {');
  lines.push('                "guestinfo.cis.appliance.net.addr"       { $p.Value = $VcenterIp }');
  lines.push('                "guestinfo.cis.appliance.net.gateway"    { $p.Value = $VcenterGateway }');
  lines.push('                "guestinfo.cis.appliance.net.dns.servers"{ $p.Value = $VcenterDnsServer }');
  lines.push('                "guestinfo.cis.appliance.net.pnid"       { $p.Value = $VcenterFqdn }');
  lines.push('                "guestinfo.cis.appliance.net.mode"       { $p.Value = "static" }');
  lines.push('                "guestinfo.cis.appliance.net.addr.family"{ $p.Value = "ipv4" }');
  lines.push('                "guestinfo.cis.appliance.net.prefix"     { $p.Value = "24" }');
  lines.push('                "guestinfo.cis.appliance.root.passwd"    { $p.Value = $plainPassword }');
  lines.push('                "guestinfo.cis.vmdir.password"           { $p.Value = $plainPassword }');
  lines.push('                "guestinfo.cis.vmdir.domain-name"        { $p.Value = $SsoDomain }');
  lines.push('                "guestinfo.cis.deployment.node.type"     { $p.Value = "embedded" }');
  lines.push('                "guestinfo.cis.appliance.ssh.enabled"    { $p.Value = "true" }');
  if (dc.ipAddress) {
    lines.push(`                "guestinfo.cis.appliance.ntp.servers"    { $p.Value = "${dc.ipAddress}" }`);
  }
  lines.push('            }');
  lines.push('        }');
  lines.push('        $_');
  lines.push('    } | ConvertTo-Json -Depth 10 | Set-Content $specFile');
  lines.push('');
  lines.push('    govc import.ova -options $specFile -ds $Datastore -host $EsxiHostName -name "vcenter" $VcsaOvaPath');
  lines.push('    Remove-Item $specFile -Force');
  lines.push('');
  lines.push('    Write-Host "VCSA deployed via govc. Power it on and allow ~20 min for first-boot."');
  lines.push('');
  lines.push('} else {');
  lines.push('    Write-Host "govc not found -- using PowerCLI Import-VApp"');
  lines.push('');
  lines.push('    if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('        throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('    }');
  lines.push('    Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('    $esxiCred = Get-Credential -Message "ESXi credentials for $EsxiHostName"');
  lines.push('    Connect-VIServer -Server $EsxiHostName -Credential $esxiCred | Out-Null');
  lines.push('');
  lines.push('    $vmHost = Get-VMHost -Name $EsxiHostName');
  lines.push('    $ds = Get-Datastore -Name $Datastore');
  lines.push('');
  lines.push('    $ovfConfig = Get-OvfConfiguration -Ovf $VcsaOvaPath');
  lines.push('    $ovfConfig.NetworkMapping.Network_1.Value                           = $MgmtPortGroup');
  lines.push('    $ovfConfig.DeploymentOption.Value                                   = $DeploymentSize');
  lines.push('    $ovfConfig.guestinfo.cis.deployment.node.type.Value                 = "embedded"');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.addr.family.Value            = "ipv4"');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.mode.Value                   = "static"');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.addr.Value                   = $VcenterIp');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.prefix.Value                 = "24"');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.gateway.Value                = $VcenterGateway');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.dns.servers.Value            = $VcenterDnsServer');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.net.pnid.Value                   = $VcenterFqdn');
  lines.push('    $ovfConfig.guestinfo.cis.appliance.root.passwd.Value                = $plainPassword');
  lines.push('    $ovfConfig.guestinfo.cis.vmdir.password.Value                       = $plainPassword');
  // PowerShell dot-notation can't reach a property whose name contains a
  // hyphen -- quote the segment (domain-name / site-name) to reach it.
  lines.push(`    $ovfConfig.guestinfo.cis.vmdir.'domain-name'.Value                  = $SsoDomain`);
  lines.push(`    $ovfConfig.guestinfo.cis.vmdir.'site-name'.Value                    = "Default-First-Site"`);
  lines.push('    $ovfConfig.guestinfo.cis.appliance.ssh.enabled.Value                = "true"');
  if (dc.ipAddress) {
    lines.push(`    $ovfConfig.guestinfo.cis.appliance.ntp.servers.Value               = "${dc.ipAddress}"`);
  }
  lines.push('');
  lines.push('    # No -Location here -- $EsxiHostName is a standalone ESXi host (vCenter');
  lines.push('    # does not exist yet), and standalone hosts have no VM folders.');
  lines.push('    Import-VApp -Source $VcsaOvaPath `');
  lines.push('        -OvfConfiguration $ovfConfig `');
  lines.push('        -VMHost $vmHost `');
  lines.push('        -Datastore $ds `');
  lines.push('        -Name "vcenter" | Out-Null');
  lines.push('');
  lines.push('    Start-VM -VM (Get-VM -Name "vcenter") | Out-Null');
  lines.push('    Write-Host "VCSA deployed and powered on. Allow ~20 min for first-boot."');
  lines.push('');
  lines.push('    Disconnect-VIServer -Server $EsxiHostName -Confirm:$false');
  lines.push('}');
  lines.push('');
  lines.push('Write-Host "vCenter will be available at https://$VcenterFqdn  or  https://$VcenterIp"');
  if (nc.vsanEnabled) {
    lines.push('Write-Host "Once vCenter is ready, proceed to vsan-cluster.ps1."');
  }
  if (spec.workloadVms?.enabled) {
    lines.push('Write-Host "After the cluster is formed, proceed to deploy-workloads.ps1."');
  }
  lines.push('');

  return lines.join('\n');
}

// --- Stage 5: vSAN cluster formation ---

function buildVsanCluster(spec) {
  const lines = [];
  const nc = spec.nestedCluster;
  const nets = spec.networks;

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push('    Create the vSphere cluster in vCenter and enable vSAN.');
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('    Prerequisites: vCenter is deployed and accessible (vcenter-deploy.ps1 done).');
  lines.push('    Connects to vCenter, creates a datacenter and cluster, adds the nested ESXi');
  lines.push('    hosts, and enables vSAN with manual disk claiming so it does not accidentally');
  lines.push('    claim the local-ds disk on host 1.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    Nested hosts to add: ${nc.hostCount}`);
  if (nets.vsan) {
    const vsanNet = [nets.vsan.cidr, nets.vsan.vlanId !== null ? `VLAN ${nets.vsan.vlanId}` : null].filter(Boolean).join(', ');
    lines.push(`    vSAN network: ${vsanNet || 'not set'}`);
  }
  lines.push('    NestedHostIPsCSV: management IPs assigned during ESXi installation, comma-separated');
  lines.push('    e.g. "10.0.71.101,10.0.71.102,10.0.71.103"');
  lines.push(`    vSAN architecture: ${nc.vsanArchitecture || 'esa'} (${nc.vsanArchitecture === 'osa' ? 'two-tier cache+capacity' : 'single-tier, no cache disk'})`);
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$VCenterServer,');
  lines.push('');
  lines.push(`    [string]$DatacenterName = "${nc.datacenterName || 'Lab-DC'}",`);
  lines.push('');
  lines.push(`    [string]$ClusterName = "${nc.clusterName || 'mgmt-cluster'}",`);
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$NestedHostIPsCSV');
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push(`$vcCred = Get-Credential -Message "vCenter credentials (administrator@${nc.ssoDomain || 'vsphere.local'})"`);
  lines.push('Connect-VIServer -Server $VCenterServer -Credential $vcCred | Out-Null');
  lines.push('');
  lines.push('$nestedHostIPs = $NestedHostIPsCSV -split ","');
  lines.push('');
  lines.push('# --- Datacenter ---');
  lines.push('if (-not (Get-Datacenter -Name $DatacenterName -ErrorAction SilentlyContinue)) {');
  lines.push('    New-Datacenter -Location (Get-Folder -Type Datacenter -NoRecursion | Select-Object -First 1) `');
  lines.push('        -Name $DatacenterName | Out-Null');
  lines.push('    Write-Host "Created datacenter: $DatacenterName"');
  lines.push('}');
  lines.push('$dc = Get-Datacenter -Name $DatacenterName');
  lines.push('');
  lines.push('# --- Cluster with vSAN, manual disk claiming ---');
  lines.push('# Manual claim mode prevents vSAN from grabbing the local-ds disk on host 1.');
  lines.push('if (-not (Get-Cluster -Name $ClusterName -Location $dc -ErrorAction SilentlyContinue)) {');
  lines.push('    New-Cluster -Name $ClusterName -Location $dc `');
  lines.push('        -DrsEnabled -HAEnabled `');
  lines.push('        -VsanEnabled -VsanDiskClaimMode Manual | Out-Null');
  lines.push('    Write-Host "Created cluster: $ClusterName"');
  lines.push('}');
  lines.push('$cluster = Get-Cluster -Name $ClusterName -Location $dc');
  lines.push('');
  lines.push('# --- Add nested hosts ---');
  lines.push('$hostCred = Get-Credential -Message "ESXi root credentials (same password for all nested hosts)"');
  lines.push('');
  lines.push('foreach ($hostIp in $nestedHostIPs) {');
  lines.push('    $hostIp = $hostIp.Trim()');
  lines.push('    if (-not $hostIp) { continue }');
  lines.push('');
  lines.push('    if (Get-VMHost -Name $hostIp -ErrorAction SilentlyContinue) {');
  lines.push('        Write-Host "$hostIp already in inventory, skipping."');
  lines.push('        continue');
  lines.push('    }');
  lines.push('');
  lines.push('    Write-Host "Adding $hostIp to cluster..."');
  lines.push('    Add-VMHost -Name $hostIp -Location $cluster -Credential $hostCred -Force | Out-Null');
  lines.push('    Write-Host "Added: $hostIp"');
  lines.push('}');
  lines.push('');
  lines.push('# --- Report vSAN-eligible disks for manual claiming ---');
  lines.push('Write-Host ""');
  lines.push('Write-Host "Hosts added. Eligible vSAN disks per host:"');
  lines.push('foreach ($vmHost in (Get-Cluster $ClusterName -Location $dc | Get-VMHost)) {');
  lines.push('    $eligible = Get-VMHost $vmHost | Get-VMHostDisk |');
  lines.push('        Where-Object { $_.ExtensionData.Vsan.State -eq "eligible" }');
  lines.push('    Write-Host "  $($vmHost.Name): $($eligible.Count) eligible disk(s)"');
  lines.push('}');
  lines.push('');
  lines.push('Write-Host ""');
  if ((nc.vsanArchitecture || 'esa') === 'esa') {
    lines.push('Write-Host "Claim disks via vCenter UI: Configure > vSAN > Disk Management > Claim unused disks"');
    lines.push('Write-Host "ESA: all eligible NVMe disks join a single storage pool -- no cache/capacity split."');
    lines.push('Write-Host "     Select all eligible disks and click Claim for Storage Pool."');
  } else {
    lines.push('Write-Host "Claim disks via vCenter UI (Configure > vSAN > Disk Management) or:"');
    lines.push('Write-Host "  OSA: Get-VMHost <host> | Get-VsanEligibleDisk | New-VsanDiskGroup -SsdsAsCache"');
    lines.push('Write-Host "  OSA disk groups: one cache disk (SSD/NVMe) + one or more capacity disks per host."');
  }
  lines.push('Write-Host "Verify vSAN health in vCenter before proceeding."');
  lines.push('');
  lines.push('Disconnect-VIServer -Server $VCenterServer -Confirm:$false');
  lines.push('');

  return lines.join('\n');
}

// --- Final stage: workload test VMs ---

function buildWorkloadsDeploy(spec) {
  const lines = [];
  const nc = spec.nestedCluster;
  const wl = spec.workloadVms;
  const vmNetPg = 'Nested-Trunk';

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push('    Final stage: Deploy test workload VM shells onto the vSAN cluster.');
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('    Prerequisites: vCenter up, vSAN cluster formed and healthy.');
  lines.push(`    Creates ${wl.count} blank VM shell${wl.count === 1 ? '' : 's'} (${wl.vcpu} vCPU / ${wl.vramGB}GB each) on the cluster.`);
  lines.push('    These VMs have no OS installed. They are useful for practising vMotion,');
  lines.push('    DRS, HA failover, and storage policy changes without needing live workloads.');
  lines.push('    To actually run something on them, power on and attach an OS ISO manually --');
  lines.push('    same interactive install pattern as the nested ESXi hosts.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    VM count: ${wl.count}    Size: ${wl.size} (${wl.vcpu} vCPU, ${wl.vramGB}GB RAM)`);
  lines.push(`    Network: ${vmNetPg}`);
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$VCenterServer,');
  lines.push('');
  lines.push(`    [string]$DatacenterName = "${nc.datacenterName || 'Lab-DC'}",`);
  lines.push('');
  lines.push(`    [string]$ClusterName = "${nc.clusterName || 'mgmt-cluster'}",`);
  lines.push('');
  lines.push('    # Workload VMs land on the cluster default datastore (vSAN) unless overridden');
  lines.push('    [string]$Datastore = "",');
  lines.push('');
  lines.push('    [string]$VmFolder = "Nested-Lab",');
  lines.push('');
  lines.push(`    [string]$PortGroup = "${vmNetPg}"`,);
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('$vcCred = Get-Credential -Message "vCenter credentials"');
  lines.push('Connect-VIServer -Server $VCenterServer -Credential $vcCred | Out-Null');
  lines.push('');
  lines.push('$cluster = Get-Cluster -Name $ClusterName');
  lines.push('$vmHost = $cluster | Get-VMHost | Select-Object -First 1');
  lines.push('');
  lines.push('if ($Datastore) {');
  lines.push('    $ds = Get-Datastore -Name $Datastore');
  lines.push('} else {');
  lines.push('    $ds = Get-Datastore | Where-Object { $_.Type -eq "vsan" } | Select-Object -First 1');
  lines.push('    if (-not $ds) { $ds = $cluster | Get-VMHost | Get-Datastore | Select-Object -First 1 }');
  lines.push('}');
  lines.push('');
  lines.push('if (-not (Get-Folder -Name $VmFolder -ErrorAction SilentlyContinue)) {');
  lines.push('    $vmFolderParent = Get-Folder -Type VM -NoRecursion | Select-Object -First 1');
  lines.push('    New-Folder -Name $VmFolder -Location $vmFolderParent | Out-Null');
  lines.push('}');
  lines.push('');
  lines.push(`$vmCount = ${wl.count}`);
  lines.push(`$vcpu = ${wl.vcpu}`);
  lines.push(`$vramGB = ${wl.vramGB}`);
  lines.push('');
  lines.push('for ($i = 1; $i -le $vmCount; $i++) {');
  lines.push('    $vmName = "workload-{0:D2}" -f $i');
  lines.push('');
  lines.push('    if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) {');
  lines.push('        Write-Host "$vmName already exists, skipping."');
  lines.push('        continue');
  lines.push('    }');
  lines.push('');
  lines.push('    $vm = New-VM -Name $vmName `');
  lines.push('        -VMHost $vmHost `');
  lines.push('        -Datastore $ds `');
  lines.push('        -DiskGB 40 `');
  lines.push('        -MemoryGB $vramGB `');
  lines.push('        -NumCpu $vcpu `');
  lines.push('        -GuestId "ubuntu64Guest" `');
  lines.push('        -Location $VmFolder');
  lines.push('');
  lines.push('    New-NetworkAdapter -VM $vm -NetworkName $PortGroup -Type Vmxnet3 -StartConnected | Out-Null');
  lines.push('');
  if (spec.nestedCluster.legacyCpuCompatibility) {
    lines.push('    New-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU" -Value "TRUE" -Confirm:$false | Out-Null');
    lines.push('');
  }
  lines.push('    Write-Host "Created $vmName ($vcpu vCPU / ${vramGB}GB) on $($ds.Name)"');
  lines.push('}');
  lines.push('');
  lines.push('Write-Host ""');
  lines.push(`Write-Host "${wl.count} workload VM shell${wl.count === 1 ? '' : 's'} created. Power them on for vMotion/DRS/HA practice."`);
  lines.push('Write-Host "To install an OS: attach an ISO to each VM via vCenter and boot."');
  lines.push('');
  lines.push('Disconnect-VIServer -Server $VCenterServer -Confirm:$false');
  lines.push('');

  return lines.join('\n');
}

// --- Jumpbox / WireGuard server VM shell ---

function buildJumpboxDeploy(spec) {
  const lines = [];
  const nc = spec.nestedCluster;
  const ra = spec.remoteAccess;
  const isWgVm = ra.method === 'vpn' && ra.vpnType === 'wireguard';
  const vmDefault = isWgVm ? 'lab-wireguard' : 'lab-jumpbox';
  const role = isWgVm ? 'WireGuard VPN server' : 'SSH jump host';
  const mgmtPg = 'Nested-Trunk';

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push(`    Deploy a lightweight Linux VM to serve as the ${role}.`);
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('    Prerequisites: vCenter deployed, cluster formed.');
  lines.push('    VM spec: Ubuntu 22.04 LTS, 1 vCPU, 1GB RAM, 20GB disk.');
  lines.push('    The script also generates an ed25519 SSH keypair for access.');
  lines.push('    No ISO is attached -- use a cloud image or Ubuntu Server ISO manually.');
  lines.push('');
  lines.push('.NOTES');
  lines.push('    After creating this VM, install Ubuntu Server (attach ISO via vCenter).');
  lines.push('    Then add the public key to ~/.ssh/authorized_keys on the VM.');
  if (isWgVm) {
    lines.push('    Once Ubuntu is installed, copy wireguard-server.sh to the VM and run it as root.');
  }
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$VCenterServer,');
  lines.push('');
  lines.push(`    [string]$DatacenterName = "${nc.datacenterName || 'Lab-DC'}",`);
  lines.push('');
  lines.push(`    [string]$ClusterName = "${nc.clusterName || 'mgmt-cluster'}",`);
  lines.push('');
  lines.push('    # Leave blank to use the cluster default (vSAN if available)');
  lines.push('    [string]$Datastore = "",');
  lines.push('');
  lines.push(`    [string]$PortGroup = "${mgmtPg}",`);
  lines.push('');
  lines.push('    [string]$VmFolder = "Nested-Lab",');
  lines.push('');
  lines.push(`    [string]$VmName = "${vmDefault}",`);
  lines.push('');
  lines.push('    # Where the SSH keypair is written on this machine');
  lines.push(`    [string]$SshKeyPath = "$env:USERPROFILE\\.ssh\\${vmDefault}"`);
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  lines.push('# --- Generate SSH keypair ---');
  lines.push('$sshKeygenAvailable = Get-Command ssh-keygen -ErrorAction SilentlyContinue');
  lines.push('if (-not $sshKeygenAvailable) {');
  lines.push('    Write-Warning "ssh-keygen not found. Install OpenSSH (Settings > Optional Features > OpenSSH Client)"');
  lines.push('    Write-Warning "or generate a keypair manually before connecting to the jumpbox."');
  lines.push('} elseif (-not (Test-Path $SshKeyPath)) {');
  lines.push('    $keyDir = Split-Path $SshKeyPath -Parent');
  lines.push('    if (-not (Test-Path $keyDir)) { New-Item -ItemType Directory -Path $keyDir | Out-Null }');
  lines.push('    ssh-keygen -t ed25519 -f $SshKeyPath -N "" -C "${VmName}@$(hostname)"');
  lines.push('    Write-Host ""');
  lines.push('    Write-Host "SSH keypair generated:"');
  lines.push('    Write-Host "  Private key: $SshKeyPath"');
  lines.push('    Write-Host "  Public key:  $SshKeyPath.pub"');
  lines.push('    Write-Host ""');
  lines.push('    Write-Host "IMPORTANT: Keep the private key secure. Do not commit it to version control."');
  lines.push('} else {');
  lines.push('    Write-Host "SSH keypair already exists at $SshKeyPath -- reusing it."');
  lines.push('}');
  lines.push('');
  lines.push('$pubKey = if (Test-Path "$SshKeyPath.pub") { Get-Content "$SshKeyPath.pub" } else { "<run ssh-keygen manually>" }');
  lines.push('');
  lines.push('# --- Connect to vCenter ---');
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('$vcCred = Get-Credential -Message "vCenter credentials"');
  lines.push('Connect-VIServer -Server $VCenterServer -Credential $vcCred | Out-Null');
  lines.push('');
  lines.push('$cluster = Get-Cluster -Name $ClusterName');
  lines.push('$vmHost = $cluster | Get-VMHost | Select-Object -First 1');
  lines.push('');
  lines.push('if ($Datastore) {');
  lines.push('    $ds = Get-Datastore -Name $Datastore');
  lines.push('} else {');
  lines.push('    $ds = Get-Datastore | Where-Object { $_.Type -eq "vsan" } | Select-Object -First 1');
  lines.push('    if (-not $ds) { $ds = $cluster | Get-VMHost | Get-Datastore | Select-Object -First 1 }');
  lines.push('}');
  lines.push('');
  lines.push('if (-not (Get-Folder -Name $VmFolder -ErrorAction SilentlyContinue)) {');
  lines.push('    $vmFolderParent = Get-Folder -Type VM -NoRecursion | Select-Object -First 1');
  lines.push('    New-Folder -Name $VmFolder -Location $vmFolderParent | Out-Null');
  lines.push('}');
  lines.push('');
  lines.push('if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) {');
  lines.push('    Write-Host "$VmName already exists, skipping VM creation."');
  lines.push('} else {');
  lines.push('    $vm = New-VM -Name $VmName `');
  lines.push('        -VMHost $vmHost `');
  lines.push('        -Datastore $ds `');
  lines.push('        -DiskGB 20 `');
  lines.push('        -MemoryGB 1 `');
  lines.push('        -NumCpu 1 `');
  lines.push('        -GuestId "ubuntu64Guest" `');
  lines.push('        -Location $VmFolder');
  lines.push('');
  lines.push(`    New-NetworkAdapter -VM $vm -NetworkName "${mgmtPg}" -Type Vmxnet3 -StartConnected | Out-Null`);
  lines.push('');
  if (spec.nestedCluster.legacyCpuCompatibility) {
    lines.push('    New-AdvancedSetting -Entity $vm -Name "monitor.allowLegacyCPU" -Value "TRUE" -Confirm:$false | Out-Null');
    lines.push('');
  }
  lines.push('    # Store the public key in VM notes -- easy to retrieve from vCenter UI after OS install');
  lines.push('    Set-VM -VM $vm -Notes "SSH public key for access:`n$pubKey`n`nAdd this to ~/.ssh/authorized_keys after OS install." -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('    Write-Host "Created: $VmName (1 vCPU / 1GB / 20GB on $($ds.Name))"');
  lines.push('}');
  lines.push('');
  lines.push('Write-Host ""');
  lines.push('Write-Host "Next steps:"');
  lines.push('Write-Host "  1. Power on $VmName in vCenter and install Ubuntu Server 22.04 LTS"');
  lines.push('Write-Host "  2. During or after install, add the public key to ~/.ssh/authorized_keys:"');
  lines.push('Write-Host "       $pubKey"');
  lines.push('Write-Host "  3. Connect: ssh -i $SshKeyPath <vm-ip>"');
  if (isWgVm) {
    lines.push('Write-Host "  4. Copy wireguard-server.sh to the VM and run it as root to set up WireGuard"');
  }
  lines.push('');
  lines.push('Disconnect-VIServer -Server $VCenterServer -Confirm:$false');
  lines.push('');

  return lines.join('\n');
}

// --- WireGuard server setup script (bash, runs on the jumpbox/WireGuard VM) ---

function buildWireGuardSetup(spec) {
  const lines = [];
  const nets = spec.networks;
  const mgmtCidr = nets.management?.cidr || '192.168.10.0/24';
  // WireGuard tunnel uses a separate /24 to avoid overlapping lab networks
  const wgSubnet = '10.200.0.0/24';
  const wgServerIp = '10.200.0.1';

  lines.push('#!/usr/bin/env bash');
  lines.push('# wireguard-server.sh');
  lines.push('# Run this as root on the jumpbox/WireGuard VM after Ubuntu 22.04 is installed.');
  lines.push('#');
  lines.push('# What this does:');
  lines.push('#   - Installs WireGuard');
  lines.push('#   - Generates the server keypair');
  lines.push('#   - Writes /etc/wireguard/wg0.conf');
  lines.push('#   - Enables IP forwarding so VPN clients can reach lab networks');
  lines.push('#   - Starts and enables the wg-quick@wg0 service');
  lines.push('#');
  lines.push('# After running this script, share the server public key with each client');
  lines.push('# and add client [Peer] blocks to /etc/wireguard/wg0.conf.');
  lines.push(`# Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('');
  lines.push('set -euo pipefail');
  lines.push('');
  lines.push('if [ "$(id -u)" -ne 0 ]; then');
  lines.push('    echo "Run this as root: sudo bash wireguard-server.sh"');
  lines.push('    exit 1');
  lines.push('fi');
  lines.push('');
  lines.push('echo "Installing WireGuard..."');
  lines.push('apt-get update -qq && apt-get install -y -qq wireguard');
  lines.push('');
  lines.push('# Generate server keypair');
  lines.push('umask 077');
  lines.push('SERVER_PRIVATE_KEY=$(wg genkey)');
  lines.push('SERVER_PUBLIC_KEY=$(echo "$SERVER_PRIVATE_KEY" | wg pubkey)');
  lines.push('');
  lines.push('# Detect the default outbound interface (the one with internet/lab access)');
  lines.push('DEFAULT_IFACE=$(ip route show default | awk \'/default/ {print $5; exit}\')');
  lines.push('echo "Outbound interface: $DEFAULT_IFACE"');
  lines.push('');
  lines.push('cat > /etc/wireguard/wg0.conf << EOF');
  lines.push('[Interface]');
  lines.push(`Address = ${wgServerIp}/24`);
  lines.push('ListenPort = 51820');
  lines.push('PrivateKey = ${SERVER_PRIVATE_KEY}');
  lines.push('');
  lines.push('# NAT client traffic out to the lab network');
  lines.push('PostUp   = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE');
  lines.push('PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE');
  lines.push('');
  lines.push('# ---- Add client peers below ----');
  lines.push('# Each peer looks like:');
  lines.push('#');
  lines.push('# [Peer]');
  lines.push('# # Human-readable comment');
  lines.push('# PublicKey = <client-public-key>');
  lines.push('# AllowedIPs = 10.200.0.X/32');
  lines.push('EOF');
  lines.push('');
  lines.push('chmod 600 /etc/wireguard/wg0.conf');
  lines.push('');
  lines.push('# Enable IP forwarding');
  lines.push('echo "net.ipv4.ip_forward=1" | tee -a /etc/sysctl.conf > /dev/null');
  lines.push('sysctl -p -q');
  lines.push('');
  lines.push('systemctl enable --now wg-quick@wg0');
  lines.push('');
  lines.push('echo ""');
  lines.push('echo "========================================"');
  lines.push('echo "  WireGuard VPN server is running"');
  lines.push('echo "========================================"');
  lines.push('echo "Server public key: ${SERVER_PUBLIC_KEY}"');
  lines.push(`echo "VPN subnet:        ${wgSubnet}  (server is ${wgServerIp})"`);
  lines.push('echo "Listen port:       51820"');
  lines.push('echo ""');
  lines.push('echo "To add a client peer:"');
  lines.push('echo "  1. On the client: wg genkey | tee client.key | wg pubkey > client.pub"');
  lines.push('echo "  2. Add to /etc/wireguard/wg0.conf on this server:"');
  lines.push('echo "       [Peer]"');
  lines.push('echo "       PublicKey = $(cat client.pub)"');
  lines.push('echo "       AllowedIPs = 10.200.0.X/32"');
  lines.push('echo "  3. Reload: wg syncconf wg0 <(wg-quick strip wg0)"');
  lines.push(`echo "  4. Client wg0.conf AllowedIPs should include ${mgmtCidr} to reach lab hosts"`);
  lines.push('echo ""');
  lines.push('echo "See lab-design.md for the full client configuration template."');

  return lines.join('\n');
}

// --- VyOS site-to-site WireGuard tunnel config ---

function buildVyosSiteToSite(spec) {
  const lines = [];
  const nets = spec.networks;
  const mgmtCidr = nets.management?.cidr || '192.168.10.0/24';

  lines.push('# vyos-site-to-site.conf');
  lines.push('# VyOS WireGuard site-to-site tunnel configuration.');
  lines.push('# Paste these commands into the VyOS CLI after the base config');
  lines.push('# (NAT, DHCP, DNS) is working. Requires VyOS 1.4 (Sagitta) or later.');
  lines.push(`# Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('#');
  lines.push('# BEFORE RUNNING:');
  lines.push('# Step 1 -- Generate a WireGuard keypair on this VyOS router:');
  lines.push('#   run generate pki wireguard key-pair');
  lines.push('#   Copy the "Private Key" value for use in the private-key line below.');
  lines.push('#   Share the "Public Key" value with the operator at the remote site.');
  lines.push('#');
  lines.push('# Step 2 -- Get the remote site\'s WireGuard public key and endpoint IP.');
  lines.push('#   Fill in <remote-public-key> and <remote-endpoint-ip> below.');
  lines.push('');
  lines.push('# --- Tunnel interface ---');
  lines.push('set interfaces wireguard wg0 description \'Site-to-site VPN\'');
  lines.push("set interfaces wireguard wg0 address '10.201.0.1/30'");
  lines.push("set interfaces wireguard wg0 port '51821'");
  lines.push("set interfaces wireguard wg0 private-key '<paste-private-key-here>'");
  lines.push('');
  lines.push('# --- Remote peer ---');
  lines.push("set interfaces wireguard wg0 peer remote-site public-key '<remote-public-key>'");
  lines.push("set interfaces wireguard wg0 peer remote-site address '<remote-endpoint-ip>'");
  lines.push("set interfaces wireguard wg0 peer remote-site port '51821'");
  lines.push("set interfaces wireguard wg0 peer remote-site allowed-ips '0.0.0.0/0'");
  lines.push('');
  lines.push('# --- Route remote network over the tunnel ---');
  lines.push('# Replace 192.168.100.0/24 with the actual subnet at the remote site.');
  lines.push("set protocols static route 192.168.100.0/24 interface wg0");
  lines.push('');
  lines.push('# --- Firewall: allow WireGuard on the WAN interface ---');
  lines.push("set firewall name WAN_LOCAL rule 20 action accept");
  lines.push("set firewall name WAN_LOCAL rule 20 description 'WireGuard site-to-site'");
  lines.push("set firewall name WAN_LOCAL rule 20 destination port 51821");
  lines.push("set firewall name WAN_LOCAL rule 20 protocol udp");
  lines.push('');
  lines.push('commit');
  lines.push('save');
  lines.push('');
  lines.push('# --- Verify ---');
  lines.push('# After both sides are configured, check the tunnel status:');
  lines.push('#   run show interfaces wireguard wg0');
  lines.push('#   run ping 10.201.0.2    # remote tunnel endpoint');
  lines.push(`#   run ping <ip-in-${mgmtCidr}>  # host in lab management network`);

  return lines.join('\n');
}

// --- NVMe memory tiering configuration ---

function buildMemoryTiering(spec) {
  const lines = [];
  const nc = spec.nestedCluster;
  const mt = nc.memoryTiering;
  const nets = spec.networks;
  const dc = spec.domainController || {};

  lines.push('<#');
  lines.push('.SYNOPSIS');
  lines.push('    Optional stage: Add NVMe tier VMDKs to nested hosts and configure ESXi memory tiering.');
  lines.push('');
  lines.push('.DESCRIPTION');
  lines.push(`    Generated by zero-to-hero-lab on ${spec.generatedAt}.`);
  lines.push('    Prerequisites: vSAN cluster formed and healthy (run after vsan-cluster.ps1).');
  lines.push('');
  lines.push('    Phase 1 (this script): Adds a virtual NVMe disk to each nested ESXi host VM');
  lines.push('    on the physical host. Run this while connected to the PHYSICAL ESXi host.');
  lines.push('');
  lines.push('    Phase 2 (manual, per-host): After adding the disk, put each nested host into');
  lines.push('    maintenance mode and run the esxcli commands below to configure tiering.');
  lines.push('    Memory tiering shows Configured=TRUE immediately, but Runtime=FALSE until the');
  lines.push('    host exits maintenance mode and reboots.');
  lines.push('');
  lines.push('.NOTES');
  lines.push(`    NVMe VMDK per host: ${mt.nvmeSizeGB}GB`);
  if (mt.physicalDiskSizeGB != null) {
    lines.push(`    Physical source: disk #${mt.physicalDiskIndex + 1} (NVMe, ${mt.physicalDiskSizeGB}GB) from hardware inventory`);
    lines.push(`    Datastore: create a datastore on that NVMe device before running this script`);
  }
  lines.push(`    Memory tier percentage: ${mt.tierNvmePct}%`);
  lines.push(`    Nested host count: ${nc.hostCount}`);
  lines.push(`    Total NVMe storage needed: ${nc.hostCount * mt.nvmeSizeGB}GB`);
  lines.push('    These are virtual NVMe disks -- they behave like NVMe inside nested ESXi');
  lines.push('    but consume space from the physical host datastore like any other VMDK.');
  lines.push('#>');
  lines.push('');
  lines.push('param(');
  lines.push('    # Physical ESXi host that runs the nested host VMs');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$PhysicalESXiHost,');
  lines.push('');
  lines.push('    [Parameter(Mandatory = $true)]');
  lines.push('    [string]$Datastore,');
  lines.push('');
  lines.push(`    [int]$NvmeSizeGB = ${mt.nvmeSizeGB},`);
  lines.push('');
  lines.push('    [string]$VmNamePrefix = "nested-esxi-"');
  lines.push(')');
  lines.push('');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  lines.push('if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI)) {');
  lines.push('    throw "VMware.PowerCLI module not found. Install it first: Install-Module VMware.PowerCLI -Scope CurrentUser"');
  lines.push('}');
  lines.push('');
  lines.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false | Out-Null');
  lines.push('');
  lines.push('$cred = Get-Credential -Message "Physical ESXi host credentials"');
  lines.push('Connect-VIServer -Server $PhysicalESXiHost -Credential $cred | Out-Null');
  lines.push('');
  lines.push('$ds = Get-Datastore -Name $Datastore');
  lines.push('');
  lines.push(`$hostNames = 1..${nc.hostCount} | ForEach-Object { "{0}{1:D2}" -f $VmNamePrefix, $_ }`);
  lines.push('');
  lines.push('foreach ($vmName in $hostNames) {');
  lines.push('    $vm = Get-VM -Name $vmName -ErrorAction SilentlyContinue');
  lines.push('    if (-not $vm) {');
  lines.push('        Write-Warning "VM $vmName not found -- skipping."');
  lines.push('        continue');
  lines.push('    }');
  lines.push('');
  lines.push('    Write-Host "Adding ${NvmeSizeGB}GB NVMe VMDK to $vmName ..."');
  lines.push('');
  lines.push('    # Add a virtual NVMe controller if one does not exist');
  lines.push('    $vmView = $vm.ExtensionData');
  lines.push('    $hasNvme = $vmView.Config.Hardware.Device | Where-Object { $_ -is [VMware.Vim.VirtualNVMEController] }');
  lines.push('');
  lines.push('    $configSpec = New-Object VMware.Vim.VirtualMachineConfigSpec');
  lines.push('    $devChanges  = @()');
  lines.push('');
  lines.push('    if (-not $hasNvme) {');
  lines.push('        $nvmeCtrl = New-Object VMware.Vim.VirtualNVMEController');
  lines.push('        $nvmeCtrl.key       = -100');
  lines.push('        $nvmeCtrl.busNumber = 0');
  lines.push('        $ctrlSpec           = New-Object VMware.Vim.VirtualDeviceConfigSpec');
  lines.push('        $ctrlSpec.device    = $nvmeCtrl');
  lines.push('        $ctrlSpec.operation = [VMware.Vim.VirtualDeviceConfigSpecOperation]::add');
  lines.push('        $devChanges        += $ctrlSpec');
  lines.push('    } else {');
  lines.push('        $nvmeCtrl     = $hasNvme | Select-Object -First 1');
  lines.push('        $nvmeCtrl.key = $nvmeCtrl.key');
  lines.push('    }');
  lines.push('');
  lines.push('    # Add NVMe disk on the controller');
  lines.push('    $disk                      = New-Object VMware.Vim.VirtualDisk');
  lines.push('    $disk.key                  = -101');
  lines.push('    $disk.controllerKey        = -100');
  lines.push('    $disk.unitNumber           = 0');
  lines.push('    $disk.capacityInKB         = $NvmeSizeGB * 1MB');
  lines.push('    $backing                   = New-Object VMware.Vim.VirtualDiskFlatVer2BackingInfo');
  lines.push('    $backing.diskMode          = "persistent"');
  lines.push('    $backing.thinProvisioned   = $true');
  lines.push('    $backing.fileName          = ""');
  lines.push('    $disk.backing              = $backing');
  lines.push('    $diskSpec                  = New-Object VMware.Vim.VirtualDeviceConfigSpec');
  lines.push('    $diskSpec.device           = $disk');
  lines.push('    $diskSpec.operation        = [VMware.Vim.VirtualDeviceConfigSpecOperation]::add');
  lines.push('    $diskSpec.fileOperation    = [VMware.Vim.VirtualDeviceConfigSpecFileOperation]::create');
  lines.push('    $devChanges               += $diskSpec');
  lines.push('');
  lines.push('    $configSpec.deviceChange = $devChanges');
  lines.push('    $task = $vmView.ReconfigVM_Task($configSpec)');
  lines.push('    $task | Wait-Task | Out-Null');
  lines.push('    Write-Host "  Done: $vmName -- NVMe VMDK added."');
  lines.push('}');
  lines.push('');
  lines.push('Disconnect-VIServer -Server $PhysicalESXiHost -Confirm:$false');
  lines.push('');
  lines.push('Write-Host ""');
  lines.push('Write-Host "Phase 1 complete. NVMe VMDKs added to all nested hosts."');
  lines.push('Write-Host ""');
  lines.push('Write-Host "Phase 2 (manual) -- run on each nested host via esxcli or SSH:"');
  lines.push('Write-Host ""');
  lines.push('Write-Host "  1. Put host in maintenance mode"');
  lines.push('Write-Host "  2. SSH into the nested host and run:"');
  lines.push('Write-Host ""');
  lines.push(`Write-Host "     # Enable early memory reservation (required for tiering)"`);
  lines.push('Write-Host "     esxcli system settings advanced set -o /Mem/MemEarlyReserve -i 1"');
  lines.push('Write-Host ""');
  lines.push(`Write-Host "     # Find the NVMe device path (look for the ~${mt.nvmeSizeGB}GB device)"`);
  lines.push('Write-Host "     esxcli storage core device list | grep -A5 capacity"');
  lines.push('Write-Host ""');
  lines.push('Write-Host "     # Add the NVMe device as a memory tier"');
  lines.push('Write-Host "     esxcli system memtiering add --device /vmfs/devices/disks/<nvme-device-naa>"');
  lines.push('Write-Host ""');
  lines.push(`Write-Host "     # Set the tier percentage (${mt.tierNvmePct}% of host memory becomes NVMe-backed)"`);
  lines.push(`Write-Host "     esxcli system memtiering set --enable 1 --tier-nvme-pct ${mt.tierNvmePct}"`);
  lines.push('Write-Host ""');
  lines.push('Write-Host "  3. Exit maintenance mode -- the host will reboot to apply the NVMe tier."');
  lines.push('Write-Host "     After reboot: Configured=TRUE, Runtime=TRUE."');
  lines.push('Write-Host "     Before reboot: Configured=TRUE, Runtime=FALSE -- this is expected."');
  lines.push('');

  return lines.join('\n');
}

// lab-config.json template written alongside the generated scripts.
// localPaths -- files read directly off the Windows machine running the
//   scripts. vyosIso/windowsServerIso/esxiIso get auto-uploaded to the target
//   datastore before being mounted (Set-CDDrive only accepts a datastore
//   path); nestedEsxiOva/vCenterOva are read directly by Import-VApp/govc,
//   which upload them as part of deployment -- no separate upload needed.
// datastorePaths -- escape hatch for the three CD-ROM ISOs when they're
//   already staged on the datastore (e.g. reused across lab rebuilds). If
//   set, the script uses that path directly and skips the local file check
//   and upload entirely. Left blank, it falls back to localPaths + upload.
//   VCSA/nested-ESXi-OVA have no datastore variant -- Import-VApp/govc
//   require a local (or URL) source, so they always come from localPaths.
function buildLabConfigExample() {
  const example = {
    localPaths: {
      vyosIso: 'C:\\LabBuild\\ISOs\\vyos.iso',
      windowsServerIso: 'C:\\LabBuild\\ISOs\\windows-server-2022.iso',
      esxiIso: 'C:\\LabBuild\\ISOs\\esxi-9.0.iso',
      nestedEsxiOva: 'C:\\LabBuild\\ISOs\\nested-esxi-9.0.ova',
      vCenterOva: 'C:\\LabBuild\\ISOs\\vcsa.ova',
      visOva: 'C:\\LabBuild\\ISOs\\vcf-infrastructure-services-appliance-1.0.3.ova'
    },
    datastorePaths: {
      vyosIso: '',
      windowsServerIso: '',
      esxiIso: ''
    }
  };
  return JSON.stringify(example, null, 2) + '\n';
}

// The real lab-config.json, pre-filled from the "File locations" wizard step
// (spec.labConfig). Blank/unset fields are written as empty strings rather
// than omitted, so the file is still a valid, edit-in-place starting point
// for anyone who skipped a field in the wizard. datastorePaths is left empty
// -- it's a manual escape hatch for files already staged on the datastore,
// documented in PREREQUISITES.md, not something the wizard collects.
function buildLabConfigFromSpec(spec) {
  const lc = spec.labConfig || {};
  const config = {
    localPaths: {
      vyosIso: lc.vyosIso || '',
      windowsServerIso: lc.windowsServerIso || '',
      esxiIso: lc.esxiIso || '',
      nestedEsxiOva: lc.nestedEsxiOva || '',
      vCenterOva: lc.vCenterOva || '',
      visOva: lc.visOva || ''
    },
    datastorePaths: {
      vyosIso: '',
      windowsServerIso: '',
      esxiIso: ''
    }
  };
  return JSON.stringify(config, null, 2) + '\n';
}

module.exports = { buildPowerShellScripts, buildRdpFile, buildLabConfigExample, buildLabConfigFromSpec };
