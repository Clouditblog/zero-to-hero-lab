'use strict';

// lib/validateAnswers.js
//
// Server-side validation for the raw wizard form payload.
// Called before buildSpec() so generation functions never see untrusted data.
// Returns an array of error strings (empty = valid).

const ALLOWED_USE_CASE        = new Set(['certification','feature_testing','homelab','demo','devtest']);
const ALLOWED_NSX_SIZE        = new Set(['small','medium']);
const ALLOWED_NSX_TOPOLOGY    = new Set(['T0T1','T0T1DFW','full']);
const ALLOWED_NETWORK_TYPE    = new Set(['flat','vlans','unsure']);
const ALLOWED_ESXI_VERSION    = new Set(['9.1','9.0u2','9.0u1','9.0','8.0u3','8.0u2','8.0u1']);
const ALLOWED_DEPLOY_METHOD   = new Set(['ova','iso']);
const ALLOWED_VYOS_MODE       = new Set(['basic','bgp']);
const ALLOWED_MGMT_VLAN_MODE  = new Set(['tagged','untagged']);
const ALLOWED_FIREWALL        = new Set(['allow_all','restricted','isolated']);
const ALLOWED_REMOTE          = new Set(['vpn','ssh_jump','none','reverse_proxy']);
const ALLOWED_VPN_TYPE        = new Set(['wireguard','vyos_site_to_site']);
const ALLOWED_VCENTER_SIZE    = new Set(['tiny','small','medium','large','xlarge']);
const ALLOWED_DEPOT_MODE      = new Set(['linux','iis']);
const ALLOWED_WORKLOAD_SIZE   = new Set(['small','medium']);
const ALLOWED_VSAN_ARCH       = new Set(['osa','esa']);
const ALLOWED_NIC_SPEED       = new Set(['1gbe','10gbe','25gbe']);
const ALLOWED_DEVICE_TYPE     = new Set(['nvme','sata_ssd','sas_ssd','spinning_disk']);
const ALLOWED_DISK_PURPOSE    = new Set(['vsan_storage_pool','vsan_capacity','vsan_cache','local_datastore','data']);
const ALLOWED_CAP_UNIT        = new Set(['GB','TB']);

function isValidIp(val) {
  if (typeof val !== 'string') return false;
  const parts = val.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isValidCidr(val) {
  if (typeof val !== 'string') return false;
  const slash = val.indexOf('/');
  if (slash < 0) return false;
  const ip = val.slice(0, slash);
  const pfx = Number(val.slice(slash + 1));
  return isValidIp(ip) && Number.isInteger(pfx) && pfx >= 0 && pfx <= 32;
}

// Allows letters, digits, hyphens, dots — safe to embed inside double-quoted PS strings.
function isSafeLabel(val, maxLen = 64) {
  if (typeof val !== 'string') return false;
  if (val.length === 0 || val.length > maxLen) return false;
  return /^[a-zA-Z0-9.\-]+$/.test(val);
}

function isIntInRange(val, min, max) {
  const n = Number(val);
  return Number.isInteger(n) && n >= min && n <= max;
}

function isPresent(val) {
  return val !== null && val !== undefined && val !== '';
}

function validateAnswers(answers) {
  const errors = [];
  const d = answers.discovery || {};
  const h = answers.hardware  || {};
  const g = answers.design    || {};

  // ── Discovery ──────────────────────────────────────────────────────────
  if (isPresent(d.useCase) && !ALLOWED_USE_CASE.has(d.useCase)) {
    errors.push(`Invalid useCase: "${d.useCase}"`);
  }
  if (isPresent(d.networkType) && !ALLOWED_NETWORK_TYPE.has(d.networkType)) {
    errors.push(`Invalid networkType: "${d.networkType}"`);
  }

  // ── Hardware ───────────────────────────────────────────────────────────
  if (isPresent(h.hostCount) && !isIntInRange(h.hostCount, 1, 10)) {
    errors.push('hostCount must be 1–10');
  }
  if (isPresent(h.ipAddress) && !isValidIp(h.ipAddress)) {
    errors.push(`ipAddress (host 1): not a valid IPv4 address — "${h.ipAddress}"`);
  }
  if (isPresent(h.cpuCores) && !isIntInRange(h.cpuCores, 1, 512)) {
    errors.push('cpuCores must be 1–512');
  }
  if (isPresent(h.ramGB) && !isIntInRange(h.ramGB, 4, 4096)) {
    errors.push('ramGB must be 4–4096');
  }
  if (isPresent(h.nicCount) && !isIntInRange(h.nicCount, 1, 32)) {
    errors.push('nicCount must be 1–32');
  }
  if (isPresent(h.nicSpeed) && !ALLOWED_NIC_SPEED.has(h.nicSpeed)) {
    errors.push(`Invalid nicSpeed: "${h.nicSpeed}"`);
  }

  const devices = Array.isArray(h.storageDevices) ? h.storageDevices : [];
  if (devices.length > 16) errors.push('storageDevices: max 16 entries');
  devices.forEach((dev, i) => {
    if (isPresent(dev.type) && !ALLOWED_DEVICE_TYPE.has(dev.type)) {
      errors.push(`storageDevices[${i}].type invalid: "${dev.type}"`);
    }
    if (isPresent(dev.capacityGB)) {
      const cap = Number(dev.capacityGB);
      if (!Number.isFinite(cap) || cap < 1 || cap > 65536) {
        errors.push(`storageDevices[${i}].capacityGB must be 1–65536`);
      }
    }
    if (isPresent(dev.capacityUnit) && !ALLOWED_CAP_UNIT.has(dev.capacityUnit)) {
      errors.push(`storageDevices[${i}].capacityUnit must be GB or TB`);
    }
  });

  // Per-host validation for additional hosts
  const addlHosts = Array.isArray(h.additionalHosts) ? h.additionalHosts : [];
  if (addlHosts.length > 9) errors.push('additionalHosts: max 9 entries (hostCount max 10)');
  addlHosts.forEach((ah, i) => {
    const hostNum = i + 2;
    if (isPresent(ah.ipAddress) && !isValidIp(ah.ipAddress)) {
      errors.push(`additionalHosts[${i}] (host ${hostNum}): ipAddress not a valid IPv4 address — "${ah.ipAddress}"`);
    }
    if (ah.sameAsFirst === false) {
      if (isPresent(ah.cpuCores) && !isIntInRange(ah.cpuCores, 1, 512)) {
        errors.push(`additionalHosts[${i}] (host ${hostNum}): cpuCores must be 1–512`);
      }
      if (isPresent(ah.ramGB) && !isIntInRange(ah.ramGB, 4, 4096)) {
        errors.push(`additionalHosts[${i}] (host ${hostNum}): ramGB must be 4–4096`);
      }
      if (isPresent(ah.nicSpeed) && !ALLOWED_NIC_SPEED.has(ah.nicSpeed)) {
        errors.push(`additionalHosts[${i}] (host ${hostNum}): invalid nicSpeed "${ah.nicSpeed}"`);
      }
    }
  });

  // ── Design — enums ─────────────────────────────────────────────────────
  if (isPresent(g.esxiVersion)        && !ALLOWED_ESXI_VERSION.has(g.esxiVersion)) {
    errors.push(`Invalid esxiVersion: "${g.esxiVersion}"`);
  }
  if (isPresent(g.esxiDeployMethod)   && !ALLOWED_DEPLOY_METHOD.has(g.esxiDeployMethod)) {
    errors.push(`Invalid esxiDeployMethod: "${g.esxiDeployMethod}"`);
  }
  if (isPresent(g.vyosNetworkMode)    && !ALLOWED_VYOS_MODE.has(g.vyosNetworkMode)) {
    errors.push(`Invalid vyosNetworkMode: "${g.vyosNetworkMode}"`);
  }
  if (isPresent(g.mgmtVlanMode)       && !ALLOWED_MGMT_VLAN_MODE.has(g.mgmtVlanMode)) {
    errors.push(`Invalid mgmtVlanMode: "${g.mgmtVlanMode}"`);
  }
  if (isPresent(g.firewallPolicy)     && !ALLOWED_FIREWALL.has(g.firewallPolicy)) {
    errors.push(`Invalid firewallPolicy: "${g.firewallPolicy}"`);
  }
  if (isPresent(g.remoteAccessMethod) && !ALLOWED_REMOTE.has(g.remoteAccessMethod)) {
    errors.push(`Invalid remoteAccessMethod: "${g.remoteAccessMethod}"`);
  }
  if (isPresent(g.vpnType)            && !ALLOWED_VPN_TYPE.has(g.vpnType)) {
    errors.push(`Invalid vpnType: "${g.vpnType}"`);
  }
  if (isPresent(g.vcenterSize)        && !ALLOWED_VCENTER_SIZE.has(g.vcenterSize)) {
    errors.push(`Invalid vcenterSize: "${g.vcenterSize}"`);
  }
  if (isPresent(g.depotMode)          && !ALLOWED_DEPOT_MODE.has(g.depotMode)) {
    errors.push(`Invalid depotMode: "${g.depotMode}"`);
  }
  if (isPresent(g.workloadVmSize)     && !ALLOWED_WORKLOAD_SIZE.has(g.workloadVmSize)) {
    errors.push(`Invalid workloadVmSize: "${g.workloadVmSize}"`);
  }
  if (isPresent(g.vsanArch)           && !ALLOWED_VSAN_ARCH.has(g.vsanArch)) {
    errors.push(`Invalid vsanArch: "${g.vsanArch}"`);
  }

  // ── Design — numeric bounds ────────────────────────────────────────────
  if (isPresent(g.nestedHostCount) && !isIntInRange(g.nestedHostCount, 1, 16)) {
    errors.push('nestedHostCount must be 1–16');
  }
  if (isPresent(g.vcpuPerHost)   && !isIntInRange(g.vcpuPerHost, 1, 64)) {
    errors.push('vcpuPerHost must be 1–64');
  }
  if (isPresent(g.vramPerHostGB) && !isIntInRange(g.vramPerHostGB, 4, 2048)) {
    errors.push('vramPerHostGB: RAM per nested host must be between 4 and 2048 GB');
  }
  if (isPresent(g.nestedDiskGB)  && !isIntInRange(g.nestedDiskGB, 20, 2048)) {
    errors.push('nestedDiskGB: nested host boot disk must be between 20 and 2048 GB');
  }
  if (isPresent(g.workloadVmCount) && !isIntInRange(g.workloadVmCount, 0, 50)) {
    errors.push('workloadVmCount must be 0–50');
  }
  if (isPresent(g.nvmeSizeGB)    && !isIntInRange(g.nvmeSizeGB, 10, 2000)) {
    errors.push('nvmeSizeGB must be 10–2000');
  }
  if (isPresent(g.tierNvmePct)   && !isIntInRange(g.tierNvmePct, 1, 400)) {
    errors.push('Memory tiering percentage (tierNvmePct) must be 1–400. This represents the NVMe tier size as a percentage of host RAM — VMware supports up to a 4:1 NVMe:DRAM ratio (400%).');
  }

  for (const [field, vlanMin, vlanMax] of [
    ['mgmtVlan', 0, 4094], ['vmotionVlan', 0, 4094], ['vsanVlan', 0, 4094], ['vmVlan', 0, 4094]
  ]) {
    if (isPresent(g[field]) && !isIntInRange(g[field], vlanMin, vlanMax)) {
      errors.push(`${field} must be 0–4094`);
    }
  }

  // ── Design — IP / CIDR ─────────────────────────────────────────────────
  if (isPresent(g.dcIpAddress)    && !isValidIp(g.dcIpAddress)) {
    errors.push(`dcIpAddress "${g.dcIpAddress}" is not a valid IPv4 address`);
  }
  if (isPresent(g.visIpAddress)   && !isValidIp(g.visIpAddress)) {
    errors.push(`visIpAddress "${g.visIpAddress}" is not a valid IPv4 address`);
  }
  if (isPresent(g.depotIpAddress) && !isValidIp(g.depotIpAddress)) {
    errors.push(`depotIpAddress "${g.depotIpAddress}" is not a valid IPv4 address`);
  }
  for (const field of ['mgmtCidr', 'vmotionCidr', 'vsanCidr', 'vmCidr']) {
    if (isPresent(g[field]) && !isValidCidr(g[field])) {
      errors.push(`${field} "${g[field]}" is not a valid CIDR (e.g. 10.0.10.0/24)`);
    }
  }

  // ── Design — safe labels (embedded in generated PowerShell) ───────────
  for (const field of ['clusterName', 'datacenterName', 'ssoDomain', 'dcDomainName']) {
    if (isPresent(g[field]) && !isSafeLabel(g[field])) {
      errors.push(`${field} may only contain letters, digits, hyphens, and dots (max 64 chars)`);
    }
  }

  // ── NSX ──────────────────────────────────────────────────────────────────
  if (isPresent(g.nsxSize)      && !ALLOWED_NSX_SIZE.has(g.nsxSize)) {
    errors.push(`Invalid nsxSize: "${g.nsxSize}"`);
  }
  if (isPresent(g.nsxTopology)  && !ALLOWED_NSX_TOPOLOGY.has(g.nsxTopology)) {
    errors.push(`Invalid nsxTopology: "${g.nsxTopology}"`);
  }
  if (isPresent(g.nsxIpAddress) && !isValidIp(g.nsxIpAddress)) {
    errors.push(`nsxIpAddress "${g.nsxIpAddress}" is not a valid IPv4 address`);
  }
  if (isPresent(g.nsxBgpLocalAs) && !isIntInRange(g.nsxBgpLocalAs, 1, 65535)) {
    errors.push('nsxBgpLocalAs must be 1–65535');
  }
  if (isPresent(g.nsxBgpPeerAs) && !isIntInRange(g.nsxBgpPeerAs, 1, 65535)) {
    errors.push('nsxBgpPeerAs must be 1–65535');
  }

  // ── vSAN arch / disk purpose cross-validation ─────────────────────────
  const vsanArch = g.vsanArch || 'esa';
  const ndisksXval = Array.isArray(g.nestedDisks) ? g.nestedDisks : [];
  if (vsanArch === 'esa') {
    if (ndisksXval.some((d) => d.purpose === 'vsan_cache')) {
      errors.push('vSAN ESA does not use a cache tier. Remove vsan_cache disks or switch to OSA.');
    }
    if (ndisksXval.some((d) => d.purpose === 'vsan_capacity')) {
      errors.push('vSAN ESA uses a storage pool, not a capacity tier. Change vsan_capacity disks to vsan_storage_pool or switch to OSA.');
    }
  } else {
    if (ndisksXval.some((d) => d.purpose === 'vsan_storage_pool')) {
      errors.push('vsan_storage_pool is an ESA-only disk purpose. Switch to ESA architecture or change those disks to vsan_capacity.');
    }
  }

  // ── Nested disks ───────────────────────────────────────────────────────
  const ndisks = Array.isArray(g.nestedDisks) ? g.nestedDisks : [];
  if (ndisks.length > 16) errors.push('nestedDisks: max 16 entries');
  ndisks.forEach((disk, i) => {
    if (isPresent(disk.purpose) && !ALLOWED_DISK_PURPOSE.has(disk.purpose)) {
      errors.push(`nestedDisks[${i}].purpose invalid: "${disk.purpose}"`);
    }
    if (isPresent(disk.sizeGB)) {
      const sz = Number(disk.sizeGB);
      if (!Number.isFinite(sz) || sz < 1 || sz > 65536) {
        errors.push(`nestedDisks[${i}].sizeGB must be 1–65536`);
      }
    }
  });

  return errors;
}

module.exports = { validateAnswers };
