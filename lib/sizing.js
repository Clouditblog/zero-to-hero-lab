// lib/sizing.js
//
// Works out whether the requested nested cluster fits on the physical hardware
// and flags the failure modes that show up in real nested labs. Accounts for
// all VMs in the design: nested ESXi hosts, lab appliances (VyOS, DC),
// workload VMs, and access VMs (jumpbox or WireGuard server).

const VYOS_VCPU = 1;
const VYOS_VRAM_GB = 1;
const DC_VCPU_BY_PROFILE    = { 'none': 0, 'dc-only': 2, 'dc-jumpbox': 4, 'dc-jumpbox-fileserver': 4, 'vis': 2 };
const DC_VRAM_GB_BY_PROFILE = { 'none': 0, 'dc-only': 4, 'dc-jumpbox': 8, 'dc-jumpbox-fileserver': 8, 'vis': 4 };
const VIS_DISK_GB = 30; // William Lam's VCF Infrastructure Services Appliance — 2 vCPU / 4GB RAM / 30GB disk
const DEPOT_VCPU = 2;
const DEPOT_VRAM_GB = 4;
const DEPOT_DISK_GB = 100;   // Minimum disk for bundle hosting; bundles themselves are extra
const JUMPBOX_VCPU = 1;
const JUMPBOX_VRAM_GB = 1;   // Ubuntu jumpbox / WireGuard server: minimal footprint
const NSX_SMALL_VCPU = 3;
const NSX_SMALL_VRAM_GB = 12;
const NSX_MEDIUM_VCPU = 6;
const NSX_MEDIUM_VRAM_GB = 24;

// Minimum vRAM per nested ESXi host by version -- below these the host will
// either refuse to boot or thrash memory constantly.
const ESXI_MIN_VRAM_GB = {
  '9.1':   8,
  '9.0u2': 8,
  '9.0u1': 8,
  '9.0':   8,
  '8.0u3': 8,
  '8.0u2': 8,
  '8.0u1': 8
};

const VCENTER_TINY_VRAM_GB = 14;   // vCenter Tiny: minimum viable for lab
const ESXI_HOST_OVERHEAD_GB = 4;   // ESXi kernel + services reservation per host

const WORKLOAD_VM_SIZES = {
  small:  { vcpu: 2, vramGB: 4 },
  medium: { vcpu: 4, vramGB: 8 }
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateSizing(answers) {
  const warnings = [];
  const hw = answers.hardware || {};

  // Build per-physical-host list (new multi-host format or single-host fallback)
  function normaliseDevs(devs) {
    return (devs || [])
      .filter((d) => d.type && d.capacityGB)
      .map((d) => ({
        ...d,
        capacityGB: d.capacityUnit === 'TB'
          ? (Number(d.capacityGB) || 0) * 1000
          : Number(d.capacityGB) || 0
      }));
  }

  const host1Specs = {
    cpuCores: toNumber(hw.cpuCores),
    ramGB: toNumber(hw.ramGB),
    storageDevices: normaliseDevs(hw.storageDevices)
  };

  const physicalHosts = [
    host1Specs,
    ...(hw.additionalHosts || []).map((ah) => ({
      cpuCores: ah.sameAsFirst !== false ? host1Specs.cpuCores : toNumber(ah.cpuCores),
      ramGB: ah.sameAsFirst !== false ? host1Specs.ramGB : toNumber(ah.ramGB),
      storageDevices: ah.sameAsFirst !== false ? host1Specs.storageDevices : normaliseDevs(ah.storageDevices)
    }))
  ];

  // Backward-compat aliases (used by remaining single-host checks below)
  const physicalRamGB = host1Specs.ramGB;
  const physicalCores = host1Specs.cpuCores;
  const storageDevices = host1Specs.storageDevices;
  const physicalStorageGB = physicalHosts.reduce(
    (s, h) => s + h.storageDevices.reduce((ss, d) => ss + d.capacityGB, 0), 0
  );

  const nestedDisks = (answers.design?.nestedDisks || [])
    .filter((d) => d.sizeGB && d.purpose);
  const vsanCapacityDisks = nestedDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_storage_pool');

  const nestedHostCount = toNumber(answers.design?.nestedHostCount);
  const vcpuPerHost = toNumber(answers.design?.vcpuPerHost);
  const vramPerHostGB = toNumber(answers.design?.vramPerHostGB);
  const vsanEnabled = !!answers.design?.vsanEnabled;
  const vsanArchitecture = answers.design?.vsanArch || 'esa';
  const vyosEnabled = !!answers.design?.vyosEnabled;
  const dcProfile = answers.design?.dcProfile || (answers.design?.dcEnabled ? 'dc-only' : 'none');
  const dcEnabled = dcProfile !== 'none'; // true for any infra appliance (Windows DC or VIS) — used for RAM/CPU accounting
  const visEnabled = dcProfile === 'vis';
  const windowsDcEnabled = dcEnabled && !visEnabled; // true only for a real Windows DC — used for AD/IIS-specific checks
  const visIpAddress = answers.design?.visIpAddress || null;
  const depotEnabled = !!answers.design?.depotEnabled;
  const depotMode = answers.design?.depotMode || 'linux';
  const esxiVersion = answers.design?.esxiVersion || null;
  const workloadVmsEnabled = !!answers.design?.workloadVmsEnabled;
  const workloadVmCount = toNumber(answers.design?.workloadVmCount);
  const workloadVmSize = answers.design?.workloadVmSize || 'small';
  const remoteMethod = answers.design?.remoteAccessMethod || null;
  const vpnType = answers.design?.vpnType || null;
  const nsxEnabled = !!answers.design?.nsxEnabled;
  const nsxSize = answers.design?.nsxSize || 'small';
  const nsxVcpu = nsxEnabled ? (nsxSize === 'medium' ? NSX_MEDIUM_VCPU : NSX_SMALL_VCPU) : 0;
  const nsxVramGB = nsxEnabled ? (nsxSize === 'medium' ? NSX_MEDIUM_VRAM_GB : NSX_SMALL_VRAM_GB) : 0;

  // ESXi version minimum vRAM check
  const minVramForVersion = esxiVersion ? (ESXI_MIN_VRAM_GB[esxiVersion] ?? null) : null;
  if (minVramForVersion !== null && vramPerHostGB > 0 && vramPerHostGB < minVramForVersion) {
    warnings.push(
      `${esxiVersion} requires at least ${minVramForVersion}GB vRAM per nested host. ` +
      `The current setting of ${vramPerHostGB}GB is below that minimum and the host will likely fail to boot.`
    );
  }

  const nestedVcpu = nestedHostCount * vcpuPerHost;
  const nestedVramGB = nestedHostCount * vramPerHostGB;

  // Depot adds a VM only in Linux/nginx mode; IIS mode reuses the existing DC VM
  const depotLinux = depotEnabled && depotMode !== 'iis';
  const dcVcpu   = DC_VCPU_BY_PROFILE[dcProfile]    ?? 0;
  const dcVramGB = DC_VRAM_GB_BY_PROFILE[dcProfile] ?? 0;
  const applianceVcpu =
    (vyosEnabled ? VYOS_VCPU : 0) + dcVcpu +
    (depotLinux ? DEPOT_VCPU : 0) + nsxVcpu;
  const applianceVramGB =
    (vyosEnabled ? VYOS_VRAM_GB : 0) + dcVramGB +
    (depotLinux ? DEPOT_VRAM_GB : 0) + nsxVramGB;

  const wlSpec = WORKLOAD_VM_SIZES[workloadVmSize] || WORKLOAD_VM_SIZES.small;
  const workloadVcpu = workloadVmsEnabled ? workloadVmCount * wlSpec.vcpu : 0;
  const workloadVramGB = workloadVmsEnabled ? workloadVmCount * wlSpec.vramGB : 0;

  // A jumpbox or dedicated WireGuard VM is a small Linux VM (1 vCPU / 1GB).
  // Count it when the user chose ssh_jump, or chose VPN + WireGuard (which
  // needs a server VM even if no separate jumpbox was selected).
  const needsAccessVm = remoteMethod === 'ssh_jump' ||
    (remoteMethod === 'vpn' && vpnType === 'wireguard');
  const accessVmVcpu = needsAccessVm ? JUMPBOX_VCPU : 0;
  const accessVmVramGB = needsAccessVm ? JUMPBOX_VRAM_GB : 0;
  const accessVmLabel = remoteMethod === 'ssh_jump' ? 'jumpbox' : 'WireGuard VM';

  const totalRequestedVcpu = nestedVcpu + applianceVcpu + workloadVcpu + accessVmVcpu;
  const totalRequestedVramGB = nestedVramGB + applianceVramGB + workloadVramGB + accessVmVramGB;

  // Per-physical-host RAM overcommit check.
  // Appliance VMs (VyOS, DC, jumpbox, depot) run on physical host 1 only.
  // Nested ESXi VMs are distributed via round-robin (or manual placement if provided).
  const physCount = physicalHosts.length;
  const nestedHostPlacement = answers.design?.nestedHostPlacement || 'auto';
  const nestedHostAssignments = Array.isArray(answers.design?.nestedHostAssignments)
    ? answers.design.nestedHostAssignments
    : [];
  const placement = (nestedHostPlacement === 'manual' && nestedHostAssignments.length === nestedHostCount)
    ? nestedHostAssignments.map((v) => Math.min(Number(v) || 0, physCount - 1))
    : Array.from({ length: nestedHostCount }, (_, i) => i % physCount);

  // Compute per-host vRAM (nested VMs only here; appliances added for host 0 below)
  const nestedVramPerHost = physicalHosts.map((_, pi) => {
    const hostNestedCount = placement.filter((p) => p === pi).length;
    return hostNestedCount * vramPerHostGB;
  });
  const nestedVcpuPerHost = physicalHosts.map((_, pi) => {
    const hostNestedCount = placement.filter((p) => p === pi).length;
    return hostNestedCount * vcpuPerHost;
  });

  // Use first host's overhead as the reporting baseline
  const reservedOverheadGB = Math.max(16, Math.round(physicalRamGB * 0.08));
  const usableRamGB = physicalRamGB > 0 ? physicalRamGB - reservedOverheadGB : 0;

  const ramOvercommitRatio = usableRamGB > 0
    ? +(totalRequestedVramGB / usableRamGB).toFixed(2)
    : null;
  const cpuOvercommitRatio = physicalCores > 0
    ? +(totalRequestedVcpu / physicalCores).toFixed(2)
    : null;

  const breakdownParts = [];
  if (applianceVramGB > 0) {
    const dcLabel = dcProfile === 'dc-jumpbox' ? 'DC+Jumpbox' : dcProfile === 'dc-jumpbox-fileserver' ? 'DC+Jumpbox+FS' : visEnabled ? 'VIS' : dcEnabled ? 'DC' : null;
    const names = [vyosEnabled && 'VyOS', dcLabel, depotLinux && 'depot VM', nsxEnabled && 'NSX Manager'].filter(Boolean).join(', ');
    breakdownParts.push(`${applianceVramGB}GB for lab appliances (${names})`);
  }
  if (workloadVramGB > 0) {
    breakdownParts.push(`${workloadVramGB}GB for ${workloadVmCount} workload VM${workloadVmCount === 1 ? '' : 's'}`);
  }
  if (accessVmVramGB > 0) {
    breakdownParts.push(`${accessVmVramGB}GB for ${accessVmLabel}`);
  }
  const breakdownNote = breakdownParts.length ? ` (includes ${breakdownParts.join(' and ')})` : '';

  // Per-host RAM checks
  physicalHosts.forEach((ph, pi) => {
    const hostReservedGB = Math.max(16, Math.round(ph.ramGB * 0.08));
    const hostUsableGB = ph.ramGB > 0 ? ph.ramGB - hostReservedGB : 0;
    // Host 1 (index 0) carries all appliance VMs; other hosts carry only nested VMs
    const hostVramNeeded = nestedVramPerHost[pi] + (pi === 0 ? applianceVramGB + workloadVramGB + accessVmVramGB : 0);
    const hostRatio = hostUsableGB > 0 ? +(hostVramNeeded / hostUsableGB).toFixed(2) : null;
    const hostLabel = physCount > 1 ? ` on physical host ${pi + 1}` : '';
    if (hostUsableGB > 0 && hostVramNeeded > hostUsableGB) {
      warnings.push(
        `Physical host ${pi + 1} (${ph.ramGB}GB RAM) would carry ${hostVramNeeded}GB of vRAM${pi === 0 ? breakdownNote : ''}, ` +
        `but only ${hostUsableGB}GB is usable after ${hostReservedGB}GB overhead. ` +
        `Reduce nested host count${hostLabel} or add more RAM to that host.`
      );
    } else if (hostUsableGB > 0 && hostRatio !== null && hostRatio > 0.85) {
      warnings.push(
        `Physical host ${pi + 1} will use ${Math.round(hostRatio * 100)}% of usable RAM (${hostVramNeeded}GB of ${hostUsableGB}GB).` +
        (physCount > 1 ? ` Consider moving some nested VMs to another host.` : '')
      );
    }
    if (ph.cpuCores > 0) {
      const hostVcpu = nestedVcpuPerHost[pi] + (pi === 0 ? applianceVcpu + workloadVcpu + accessVmVcpu : 0);
      if (hostVcpu > ph.cpuCores * 4) {
        warnings.push(
          `Physical host ${pi + 1} has ${ph.cpuCores} cores but is asked to run ${hostVcpu} vCPUs. ` +
          `That's ${(hostVcpu / ph.cpuCores).toFixed(1)}:1 overcommit — sluggish under load.`
        );
      }
    }
  });

  if (vsanEnabled && nestedHostCount > 0 && nestedHostCount < 3) {
    warnings.push(
      'vSAN wants at least 3 hosts in the cluster. With fewer than that it will run in a degraded or ' +
      'single-host mode, which behaves nothing like a production vSAN cluster.'
    );
  }

  if (vsanEnabled && vsanArchitecture === 'esa') {
    const hasNvmePhysical = storageDevices.some((d) => d.type === 'nvme');
    if (!hasNvmePhysical) {
      warnings.push(
        'vSAN ESA requires NVMe-backed storage. No NVMe device was found in your hardware inventory. ' +
        'Add an NVMe disk in the Physical host step, or switch to OSA which supports SATA SSD and SAS SSD.'
      );
    }
    const hasSpinningPhysical = storageDevices.some((d) => d.type === 'spinning_disk');
    if (hasSpinningPhysical) {
      warnings.push(
        'vSAN ESA requires all-flash storage. At least one physical disk is a spinning disk. ' +
        'ESA will not accept HDD-backed VMDKs as eligible storage. Switch to OSA or replace with SSDs/NVMe.'
      );
    }
    const hasCacheDisk = nestedDisks.some((d) => d.purpose === 'vsan_cache');
    if (hasCacheDisk) {
      warnings.push(
        'vSAN ESA uses a single storage tier — there is no separate cache/capacity split. ' +
        'Remove the vsan_cache disk from the nested host disk layout, or switch to OSA which uses two tiers.'
      );
    }
  }

  if (vsanEnabled) {
    if (vsanCapacityDisks.length === 0 && nestedDisks.length > 0) {
      const diskTypeName = vsanArchitecture === 'osa' ? 'vSAN capacity tier' : 'vSAN storage pool (ESA)';
      warnings.push(
        `vSAN is enabled but no nested disk is designated as the ${diskTypeName}. ` +
        'The cluster formation script will fail without a disk to claim. ' +
        `Add a ${diskTypeName} disk in the nested host disk layout step.`
      );
    }
    const vsanOnHdd = vsanEnabled && storageDevices.some((d) => d.type === 'spinning_disk');
    if (vsanOnHdd) {
      warnings.push(
        'vSAN is enabled and at least one physical disk is a spinning disk. ' +
        'vSAN VMDKs land on the physical ESXi datastore, so performance will be poor if spinning disks are your only storage.'
      );
    }
    if (vsanCapacityDisks.length > 0 && nestedHostCount > 0) {
      const totalVsanCapGB = vsanCapacityDisks.reduce((s, d) => s + (Number(d.sizeGB) || 0), 0);
      const neededCapGB = nestedHostCount * totalVsanCapGB;
      if (physicalStorageGB > 0 && neededCapGB > physicalStorageGB) {
        warnings.push(
          `vSAN capacity VMDKs would need ${neededCapGB}GB total (${nestedHostCount} hosts × ${totalVsanCapGB}GB each), ` +
          `but total physical storage is only ${physicalStorageGB}GB.`
        );
      }
    }
  }

  const memTieringEnabled = !!answers.design?.memTieringEnabled;
  const nvmeTierSizeGB = (() => {
    if (!memTieringEnabled) return 0;
    const devs = answers.hardware?.storageDevices || [];
    const idx = answers.design?.nvmeTieringDiskIndex;
    const disk = (idx != null && devs[idx]?.type === 'nvme') ? devs[idx] : null;
    if (disk?.capacityGB) {
      return disk.capacityUnit === 'TB'
        ? (Number(disk.capacityGB) || 0) * 1000
        : Number(disk.capacityGB) || 0;
    }
    return Number(answers.design?.nvmeSizeGB) || 100;
  })();

  if (physicalStorageGB > 0 && nestedHostCount > 0 && (nestedDisks.length > 0 || memTieringEnabled)) {
    const localDsDisk = nestedDisks.find((d) => d.purpose === 'local_datastore');
    const perHostDisks = nestedDisks.filter((d) => d.purpose !== 'local_datastore');
    const depotDiskAlloc = depotLinux ? DEPOT_DISK_GB : 0;
    const dcStorageDiskAlloc = dcProfile === 'dc-jumpbox-fileserver' ? (Number(answers.design?.dcStorageDiskGB) || 200) : 0;
    const visDiskAlloc = visEnabled ? VIS_DISK_GB : 0;
    const totalVirtualGB =
      nestedHostCount * perHostDisks.reduce((s, d) => s + (Number(d.sizeGB) || 0), 0) +
      (localDsDisk ? Number(localDsDisk.sizeGB) || 0 : 0) +
      nestedHostCount * nvmeTierSizeGB +
      depotDiskAlloc + dcStorageDiskAlloc + visDiskAlloc;
    if (totalVirtualGB > physicalStorageGB) {
      warnings.push(
        `Virtual disk allocation across all nested hosts and appliances (${totalVirtualGB}GB total${depotDiskAlloc ? `, including ${depotDiskAlloc}GB for depot VM` : ''}${dcStorageDiskAlloc ? `, including ${dcStorageDiskAlloc}GB for DC storage disk` : ''}${visDiskAlloc ? `, including ${visDiskAlloc}GB for the VIS appliance` : ''}) exceeds total physical storage ` +
        `(${physicalStorageGB}GB). Reduce disk sizes in the nested host disk layout step or add more physical storage.`
      );
    }
  }

  if (nestedHostCount > 0 && vcpuPerHost === 0) {
    warnings.push('No vCPU count was set for the nested hosts, so the deployment script has nothing to size them with.');
  }

  // NTP source consistency: DC/VIS deployed but no static IP set → pool.ntp.org fallback
  const dcIpAddress = answers.design?.dcIpAddress || null;
  if (windowsDcEnabled && !dcIpAddress) {
    warnings.push(
      'A domain controller is in the design but no static IP is set for it. ' +
      'All lab components will fall back to pool.ntp.org for NTP instead of using the DC as the time source. ' +
      'Set the DC IP so every component references the same internal NTP server — ' +
      'strict bring-up tooling validates time sync across all appliances.'
    );
  }
  if (visEnabled && !visIpAddress) {
    warnings.push(
      'VIS is in the design but no static IP is set for it. ' +
      'All lab components will fall back to pool.ntp.org for NTP instead of using VIS as the time source. ' +
      'Set the VIS IP so every component references the same internal DNS/NTP server.'
    );
  }

  // SSO / AD domain collision
  const ssoDomain = (answers.design?.ssoDomain || 'vsphere.local').toLowerCase().trim();
  const adDomain = (answers.design?.dcDomainName || '').toLowerCase().trim();
  if (dcEnabled && adDomain && adDomain.length > 0) {
    const collision = ssoDomain === adDomain ||
      ssoDomain.endsWith('.' + adDomain) ||
      adDomain.endsWith('.' + ssoDomain);
    if (collision) {
      warnings.push(
        `SSO domain "${ssoDomain}" matches or overlaps with Active Directory domain "${adDomain}". ` +
        'Colliding SSO and AD domains have caused real VCF bring-up failures. ' +
        'Use a clearly distinct SSO domain (e.g. vsphere.local) and keep your AD domain separate (e.g. lab.company.com).'
      );
    }
  }

  if (depotEnabled && depotMode === 'iis' && !windowsDcEnabled) {
    warnings.push(
      'Bundle depot is set to IIS mode but no Windows domain controller is included in this design ' +
      '(VIS is a Linux appliance and cannot host IIS). IIS mode installs the depot on the DC VM — ' +
      'either enable a Windows domain controller or switch the depot to Linux/nginx mode.'
    );
  }

  if (remoteMethod === 'vpn' && vpnType === 'vyos_site_to_site' && !vyosEnabled) {
    warnings.push(
      'VyOS site-to-site VPN is selected but VyOS was not included in this design. ' +
      'The site-to-site config will be generated but you will need a VyOS router to apply it to.'
    );
  }

  return {
    totalRequestedVcpu,
    totalRequestedVramGB,
    nestedVcpu,
    nestedVramGB,
    applianceVcpu,
    applianceVramGB,
    workloadVcpu,
    workloadVramGB,
    accessVmVcpu,
    accessVmVramGB,
    reservedOverheadGB,
    usableRamGB,
    ramOvercommitRatio,
    cpuOvercommitRatio,
    warnings
  };
}

// Returns three sizing tiers (minimal/standard/maximum) for a given physical
// RAM amount and ESXi version. Used by the wizard's step-7 recommendation UI.
function recommendHostTiers(physRamGB, esxiVersion, opts) {
  const dcProfile   = opts && opts.dcProfile !== undefined ? opts.dcProfile : (opts && opts.dcEnabled ? 'dc-only' : 'dc-only');
  const vyosEnabled = opts && opts.vyosEnabled !== undefined ? opts.vyosEnabled : true;
  const perHostMin  = ESXI_MIN_VRAM_GB[esxiVersion] || 8;
  const fixedRam    = ESXI_HOST_OVERHEAD_GB + VCENTER_TINY_VRAM_GB
    + (DC_VRAM_GB_BY_PROFILE[dcProfile] ?? 4)
    + (vyosEnabled ? VYOS_VRAM_GB : 0);
  const available   = Math.max(0, physRamGB - fixedRam);
  const maxHosts    = Math.min(Math.floor(available / perHostMin), 12);

  return {
    perHostMin,
    fixedRam,
    available,
    maxHosts,
    tiers: [
      {
        id: 'minimal',
        hosts: 1,
        vsanCapable: false,
        label: 'Minimal — 1 host, learn vSphere basics',
        ramNeeded: fixedRam + perHostMin,
        feasible: physRamGB >= fixedRam + perHostMin
      },
      {
        id: 'standard',
        hosts: 3,
        vsanCapable: true,
        label: 'Standard — 3 hosts, enables vSAN',
        ramNeeded: fixedRam + 3 * perHostMin,
        feasible: physRamGB >= fixedRam + 3 * perHostMin
      },
      {
        id: 'maximum',
        hosts: maxHosts,
        vsanCapable: maxHosts >= 3,
        isMaximum: true,
        label: `Maximum — ${maxHosts} host${maxHosts !== 1 ? 's' : ''} on your hardware`,
        ramNeeded: fixedRam + maxHosts * perHostMin,
        feasible: maxHosts >= 1
      }
    ]
  };
}

const VIS_VCPU = DC_VCPU_BY_PROFILE.vis;
const VIS_VRAM_GB = DC_VRAM_GB_BY_PROFILE.vis;

module.exports = { evaluateSizing, recommendHostTiers, VIS_VCPU, VIS_VRAM_GB, VIS_DISK_GB };
