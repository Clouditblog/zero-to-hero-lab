// lib/generateSpec.js
//
// Turns the raw wizard answers into a clean, structured spec. This is the
// single source of truth that the PowerShell and markdown generators both
// read from, so it's worth keeping deliberately flat and explicit rather
// than passing the raw form payload around.

const ESXI_VERSION_LABELS = {
  '9.1':   'ESXi 9.1',
  '9.0u2': 'ESXi 9.0 Update 2',
  '9.0u1': 'ESXi 9.0 Update 1',
  '9.0':   'ESXi 9.0',
  '8.0u3': 'ESXi 8.0 Update 3',
  '8.0u2': 'ESXi 8.0 Update 2',
  '8.0u1': 'ESXi 8.0 Update 1'
};

const WORKLOAD_VM_SIZES = {
  small:  { vcpu: 2, vramGB: 4 },
  medium: { vcpu: 4, vramGB: 8 }
};

function buildSpec(answers, sizing) {
  const hardware = answers.hardware || {};
  const discovery = answers.discovery || {};
  const design = answers.design || {};

  // Resolve memory-tiering physical disk selection
  const storageDevices = hardware.storageDevices || [];
  const nvmeTieringIdx = design.nvmeTieringDiskIndex != null ? Number(design.nvmeTieringDiskIndex) : null;
  const nvmeTieringDisk = (nvmeTieringIdx != null && storageDevices[nvmeTieringIdx]?.type === 'nvme')
    ? storageDevices[nvmeTieringIdx]
    : null;
  const nvmeTieringSizeGB = nvmeTieringDisk
    ? (nvmeTieringDisk.capacityUnit === 'TB'
        ? (Number(nvmeTieringDisk.capacityGB) || 0) * 1000
        : Number(nvmeTieringDisk.capacityGB) || 0)
    : null;

  const wlSize = WORKLOAD_VM_SIZES[design.workloadVmSize] || WORKLOAD_VM_SIZES.small;
  const wlCount = Number(design.workloadVmCount) || 0;

  // Build per-host specs array
  function normaliseDevices(devs) {
    return (devs || [])
      .map((d) => ({
        type: d.type || null,
        capacityGB: d.capacityUnit === 'TB'
          ? (Number(d.capacityGB) || 0) * 1000
          : Number(d.capacityGB) || null
      }))
      .filter((d) => d.type && d.capacityGB);
  }

  const host1 = {
    ipAddress: hardware.ipAddress || null,
    cpuCores: Number(hardware.cpuCores) || null,
    ramGB: Number(hardware.ramGB) || null,
    storageDevices: normaliseDevices(hardware.storageDevices),
    nicCount: Number(hardware.nicCount) || null,
    nicSpeed: hardware.nicSpeed || null,
    nicModel: hardware.nicModel || null
  };

  const physicalHosts = [
    host1,
    ...(hardware.additionalHosts || []).map((ah) => ({
      ipAddress: ah.ipAddress || null,
      cpuCores: ah.sameAsFirst !== false ? host1.cpuCores : (Number(ah.cpuCores) || null),
      ramGB: ah.sameAsFirst !== false ? host1.ramGB : (Number(ah.ramGB) || null),
      storageDevices: ah.sameAsFirst !== false ? host1.storageDevices : normaliseDevices(ah.storageDevices),
      nicCount: ah.sameAsFirst !== false ? host1.nicCount : (Number(ah.nicCount) || null),
      nicSpeed: ah.sameAsFirst !== false ? host1.nicSpeed : (ah.nicSpeed || null)
    }))
  ];

  // Compute nested host placement across physical hosts
  const nestedCount = Number(design.nestedHostCount) || 0;
  const physCount = physicalHosts.length;
  let placement;
  if (design.nestedHostPlacement === 'manual'
      && Array.isArray(design.nestedHostAssignments)
      && design.nestedHostAssignments.length === nestedCount) {
    placement = design.nestedHostAssignments.map((v) => Math.min(Number(v) || 0, physCount - 1));
  } else {
    // Auto: round-robin
    placement = Array.from({ length: nestedCount }, (_, i) => i % physCount);
  }

  return {
    generatedAt: new Date().toISOString(),
    tool: 'zero-to-hero-lab',
    schemaVersion: 4,
    scope: 'vsphere-only',

    useCase: discovery.useCase || null,

    physicalHosts,

    componentPlacement: {
      vyos: Math.min(Number(design.deployVyosHostIdx) || 0, physCount - 1),
      dc:   Math.min(Number(design.deployDcHostIdx)   || 0, physCount - 1),
    },

    physicalHost: { ...host1, hostCount: physicalHosts.length },

    esxiVersion: {
      version: design.esxiVersion || null,
      label: ESXI_VERSION_LABELS[design.esxiVersion] || null
    },

    esxiDeployMethod: design.esxiDeployMethod || 'iso',

    existingNetwork: {
      type: discovery.networkType || null,
      vlanCapableRouter: discovery.vlanCapable || null,
      dhcpAvailable: discovery.dhcpAvailable || null
    },

    vyos: {
      enabled: !!design.vyosEnabled,
      networkMode: design.vyosNetworkMode || null
    },

    domainController: (function() {
      const profile = design.dcProfile || (design.dcEnabled ? 'dc-only' : 'none');
      return {
        enabled:       profile !== 'none' && profile !== 'vis',
        profile,
        hasJumpbox:    profile === 'dc-jumpbox' || profile === 'dc-jumpbox-fileserver',
        hasFileServer: profile === 'dc-jumpbox-fileserver',
        storageDiskGB: profile === 'dc-jumpbox-fileserver' ? (Number(design.dcStorageDiskGB) || 200) : null,
        domainName:    design.dcDomainName || null,
        ipAddress:     design.dcIpAddress  || null,
        networkPlacement: design.dcNetworkPlacement === 'physical' ? 'physical' : 'lab',
      };
    })(),

    // William Lam's VCF Infrastructure Services Appliance — an alternative to a Windows DC
    // for DNS/NTP/DHCP in VCF-focused labs. Mutually exclusive with domainController above
    // (selected via the same dcProfile radio group in the wizard).
    vis: {
      enabled:   design.dcProfile === 'vis',
      ipAddress: design.visIpAddress || null,
      ova:       design.visOva || null
    },

    networks: {
      management: {
        cidr: design.mgmtCidr || null,
        vlanId: numOrNull(design.mgmtVlan),
        mode: design.mgmtVlanMode === 'tagged' ? 'tagged' : 'untagged'
      },
      vMotion: { cidr: design.vmotionCidr || null, vlanId: numOrNull(design.vmotionVlan) },
      vsan: design.vsanEnabled
        ? { cidr: design.vsanCidr || null, vlanId: numOrNull(design.vsanVlan) }
        : null,
      vmTraffic: { cidr: design.vmCidr || null, vlanId: numOrNull(design.vmVlan) }
    },

    nestedCluster: {
      hostCount: nestedCount,
      vcpuPerHost: Number(design.vcpuPerHost) || 0,
      vramPerHostGB: Number(design.vramPerHostGB) || 0,
      bootDiskGB: Number(design.nestedDiskGB) || 32,
      additionalDisks: (design.nestedDisks || [])
        .map((d) => ({ sizeGB: Number(d.sizeGB) || null, purpose: d.purpose || null }))
        .filter((d) => d.sizeGB && d.purpose),
      vsanEnabled: !!design.vsanEnabled,
      vsanArchitecture: !!design.vsanEnabled ? (design.vsanArch || 'esa') : null,
      legacyCpuCompatibility: !!design.legacyCpuCompat,
      memoryTiering: {
        enabled: !!design.memTieringEnabled,
        nvmeSizeGB: nvmeTieringSizeGB || Number(design.nvmeSizeGB) || 100,
        physicalDiskIndex: nvmeTieringIdx,
        physicalDiskSizeGB: nvmeTieringSizeGB,
        tierNvmePct: Number(design.tierNvmePct) || 25
      },
      rootPassword: design.nestedEsxiPassword || null,
      clusterName: design.clusterName || 'mgmt-cluster',
      datacenterName: design.datacenterName || 'Lab-DC',
      ssoDomain: design.ssoDomain || 'vsphere.local',
      hostPlacement: design.nestedHostPlacement || 'auto',
      hosts: placement.map((physIdx, i) => ({ index: i + 1, physicalHostIndex: physIdx }))
    },

    workloadVms: {
      enabled: !!design.workloadVmsEnabled,
      count: wlCount,
      size: design.workloadVmSize || null,
      vcpu: wlSize.vcpu,
      vramGB: wlSize.vramGB
    },

    localDatastore: {
      enabled: (design.nestedDisks || []).some((d) => d.purpose === 'local_datastore')
    },

    security: {
      isolateLabSegment: !!design.isolateLab,
      firewallPolicy: design.firewallPolicy || null,
      internetAccess: !!design.internetAccess
    },

    remoteAccess: {
      method: design.remoteAccessMethod || null,
      vpnType: design.vpnType || null,
      vcenterDeploymentSize: design.vcenterSize || null
    },

    // File locations entered in the wizard -- written into lab-config.json
    // (localPaths) so the generated scripts don't need to prompt for them.
    labConfig: {
      vyosIso:          design.vyosIso          || null,
      windowsServerIso: design.windowsServerIso || null,
      esxiIso:          design.esxiIso          || null,
      nestedEsxiOva:    design.nestedEsxiOva    || null,
      vCenterOva:       design.vCenterOva       || null,
      visOva:           design.visOva           || null
    },

    bundleDepot: {
      enabled: !!design.depotEnabled,
      mode: design.depotMode || 'linux',
      ipAddress: design.depotIpAddress || null
    },

    nsx: {
      enabled: !!design.nsxEnabled,
      size: design.nsxSize || 'small',
      topology: design.nsxTopology || 'T0T1',
      edgeCount: Number(design.nsxEdgeCount) || 1,
      edgeSize: design.nsxEdgeSize || 'medium',
      ipAddress: design.nsxIpAddress || null,
      bgpEnabled: !!(design.nsxEnabled && design.vyosEnabled && design.vyosNetworkMode === 'bgp'),
      bgpLocalAs: Number(design.nsxBgpLocalAs) || 65001,
      bgpPeerAs: Number(design.nsxBgpPeerAs) || 65002,
      bgpRouteAdvert: design.nsxBgpRouteAdvert || 'all',
      bgpPrefixes: (design.nsxBgpPrefixes || '')
        .split('\n').map((s) => s.trim()).filter(Boolean),
      redistConnected: design.nsxRedistConnected !== false,
      redistStatic: !!design.nsxRedistStatic,
      redistT1Lb: !!design.nsxRedistT1Lb
    },

    vcf: {
      enabled: !!design.vcfEnabled,
      sddcManagerIp:       design.vcfSddcMgrIp       || null,
      sddcManagerHostname: design.vcfSddcMgrHostname  || 'sddcmgr',
      vcenterIp:           design.vcfVcenterIp        || null,
      vtepCidr:            design.vcfVtepCidr         || null,
      vtepVlan:            numOrNull(design.vcfVtepVlan),
      edgeUplink1Cidr:     design.vcfEdgeUplink1Cidr  || null,
      edgeUplink1Vlan:     numOrNull(design.vcfEdgeUplink1Vlan),
      edgeUplink2Cidr:     design.vcfEdgeUplink2Cidr  || null,
      edgeUplink2Vlan:     numOrNull(design.vcfEdgeUplink2Vlan),
      esxiPassword:        design.vcfEsxiPassword      || null,
      esxiLicense:         design.vcfEsxiLicense       || null,
      vcenterLicense:      design.vcfVcenterLicense    || null
    },

    ntp: {
      source: (!!design.dcEnabled && design.dcIpAddress) ? design.dcIpAddress : 'pool.ntp.org'
    },

    extendMode: !!answers.extendMode,

    learningMode: !!answers.learningMode,
    designRationale: answers.designRationale || null,

    architectMode: !!answers.architectMode,
    discovery: answers.discovery || null,
    decisionLog: answers.decisionLog || [],
    riskRegister: answers.riskRegister || [],

    sizing
  };
}

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = { buildSpec, ESXI_VERSION_LABELS };
