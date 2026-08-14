// lib/generateNetworkDiagram.js
//
// Produces a Mermaid flowchart from the spec. Embedded in design-doc.md as a
// fenced ```mermaid block and optionally rendered to network-diagram.svg via
// mmdc (mermaid-cli) in server.js if it is available.

// Strip characters that break Mermaid node-label syntax or enable HTML injection.
// Mermaid node labels are quoted with double-quotes; a bare " closes the label early.
// < and > allow HTML injection when securityLevel is not strict.
function sanitizeLabel(s) {
  if (s == null) return '';
  return String(s)
    .replace(/["\[\]<>]/g, '')   // mermaid syntax chars and HTML angle brackets
    .replace(/\n|\r/g, ' ')      // no actual newlines (use \n literal in mermaid)
    .trim()
    .slice(0, 120);
}

function firstHostInCidr(cidr) {
  if (!cidr) return null;
  const base = cidr.split('/')[0];
  const p = base.split('.').map(Number);
  p[3] = 1;
  return p.join('.');
}

function segLabel(name, net) {
  if (!net) return name;
  const parts = [name];
  if (net.vlanId != null) parts.push(`VLAN ${Number(net.vlanId)}`);
  if (net.cidr) parts.push(sanitizeLabel(net.cidr));
  return parts.join(' · ');
}

function buildMermaidDiagram(spec) {
  const nc  = spec.nestedCluster;
  const nets = spec.networks;
  const dc   = spec.domainController || {};
  const vis  = spec.vis || {};
  const vyos = spec.vyos || {};
  const ra   = spec.remoteAccess || {};
  const wl   = spec.workloadVms || {};
  const ph   = spec.physicalHost;
  const esxiVer = spec.esxiVersion || {};

  const nsx = spec.nsx || {};

  const lines = [];
  lines.push('graph TD');
  lines.push('');
  lines.push('classDef physHost fill:#dbeafe,stroke:#1d4ed8,color:#1e3a5f,stroke-width:2px');
  lines.push('classDef esxi     fill:#ccfbf1,stroke:#0d9488,color:#134e4a,stroke-width:2px');
  lines.push('classDef vyos     fill:#ffedd5,stroke:#ea580c,color:#7c2d12,stroke-width:2px');
  lines.push('classDef dc       fill:#f3e8ff,stroke:#9333ea,color:#581c87,stroke-width:2px');
  lines.push('classDef jb       fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:2px');
  lines.push('classDef vcsa     fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px');
  lines.push('classDef nsx      fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px');
  lines.push('classDef workload fill:#f3f4f6,stroke:#6b7280,color:#374151,stroke-width:1px');
  lines.push('classDef wan      fill:#e0e7ff,stroke:#4338ca,color:#312e81,stroke-width:2px');
  lines.push('classDef segment  fill:#f8fafc,stroke:#94a3b8,color:#475569,stroke-width:1px');
  lines.push('');

  // WAN (only when VyOS provides NAT/routing)
  if (vyos.enabled) {
    lines.push('    WAN(["Internet / Home Network"])');
    lines.push('');
  }

  const hasJumpbox = ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard');
  const hostCount  = nc.hostCount || 0;
  const shownHosts = Math.min(hostCount, 6);

  // Compute nested host → physical host mapping
  const physicalHosts = spec.physicalHosts || [ph];
  const physCount = physicalHosts.length;
  const hostPlacement = nc.hosts || [];
  const groupsByPhys = Array.from({ length: physCount }, () => []);
  for (let i = 0; i < hostCount && i < shownHosts; i++) {
    const physIdx = (hostPlacement[i]?.physicalHostIndex ?? (i % physCount));
    groupsByPhys[Math.min(physIdx, physCount - 1)].push(i + 1);
  }

  // Helper to render one physical host's subgraph
  const renderPhysSubgraph = (physIdx) => {
    const phSpec = physicalHosts[physIdx] || ph;
    const physLabel = physCount > 1 ? `Physical Host ${physIdx + 1}` : 'Physical Host';
    const physParts = [physLabel];
    if (phSpec.cpuCores) physParts.push(`${Number(phSpec.cpuCores)} cores`);
    if (phSpec.ramGB)    physParts.push(`${Number(phSpec.ramGB)} GB RAM`);
    if (phSpec.ipAddress) physParts.push(sanitizeLabel(phSpec.ipAddress));
    const graphId = physCount > 1 ? `PHYS${physIdx + 1}` : 'PHYS';
    lines.push(`    subgraph ${graphId}["${physParts.join(' · ')}"]`);

    // VyOS and direct VMs only on host 1 (physIdx === 0)
    if (physIdx === 0) {
      if (vyos.enabled) {
        const gwIp  = firstHostInCidr(nets.management?.cidr);
        const gwSafe = gwIp ? sanitizeLabel(gwIp) : null;
        const vyosL = gwSafe
          ? `lab-vyos\\nVyOS Router\\nWAN: DHCP · LAN: ${gwSafe}`
          : `lab-vyos\\nVyOS Router`;
        lines.push(`        VYOS["${vyosL}"]`);
        lines.push('');
      }

      const hasDirect = dc.enabled || vis.enabled || hasJumpbox;
      if (hasDirect) {
        lines.push(`        subgraph DIRECT["${segLabel('Management', nets.management)} · direct VMs"]`);
        if (dc.enabled) {
          const dcParts = ['lab-dc', 'Domain Controller'];
          const dcIp  = dc.ipAddress  ? sanitizeLabel(dc.ipAddress)  : null;
          const dcDom = dc.domainName ? sanitizeLabel(dc.domainName) : null;
          if (dcIp)       dcParts.push(dcIp + (dcDom ? ' · ' + dcDom : ''));
          else if (dcDom) dcParts.push(dcDom);
          lines.push(`            DC["${dcParts.join('\\n')}"]`);
        }
        if (vis.enabled) {
          const visParts = ['vis-appliance', 'VIS Appliance', 'DNS · NTP · DHCP · depot'];
          const visIp = vis.ipAddress ? sanitizeLabel(vis.ipAddress) : null;
          if (visIp) visParts.push(visIp);
          lines.push(`            VIS["${visParts.join('\\n')}"]`);
        }
        if (hasJumpbox) {
          const jbName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
          const jbRole = ra.method === 'ssh_jump' ? 'SSH jump host' : 'WireGuard VPN server';
          lines.push(`            JB["${jbName}\\n${jbRole}"]`);
        }
        lines.push('        end');
        lines.push('');
      }
    }

    // Nested ESXi VMs assigned to this physical host
    const nestedLabel = physCount > 1
      ? `Nested ESXi VMs on host ${physIdx + 1}`
      : 'Nested lab · VMs deployed inside nested ESXi hosts';
    const nestedId = physCount > 1 ? `NESTED${physIdx + 1}` : 'NESTED';
    lines.push(`        subgraph ${nestedId}["${nestedLabel}"]`);
    const thisHostNums = groupsByPhys[physIdx] || [];
    for (const i of thisHostNums) {
      const name     = `nested-esxi-${String(i).padStart(2, '0')}`;
      const hostSpec = `${Number(nc.vcpuPerHost) || '?'} vCPU / ${Number(nc.vramPerHostGB) || '?'} GB`;
      const verLabel = sanitizeLabel(esxiVer.label || 'ESXi');
      lines.push(`            ESXI${i}["${name}\\n${verLabel}\\n${hostSpec}"]`);
    }
    // vCenter on host 1 (physical host 0, nested-esxi-01)
    if (physIdx === 0) {
      lines.push('            VCSA["vcenter\\nvCenter Server\\n(VM on nested-esxi-01)"]');
      if (nsx.enabled) {
        const nsxIp = nsx.ipAddress ? `\\n${sanitizeLabel(nsx.ipAddress)}` : '';
        lines.push(`            NSX["lab-nsxmgr\\nNSX-T Manager${nsxIp}\\n(VM on cluster)"]`);
      }
    }
    lines.push('        end');
    lines.push('');
    lines.push('    end');
    lines.push('');
  };

  for (let pi = 0; pi < physCount; pi++) {
    renderPhysSubgraph(pi);
  }

  // Network segment nodes (outside all physical host subgraphs)
  const hasVmotion = nets.vMotion?.cidr || nets.vMotion?.vlanId != null;
  if (hasVmotion) {
    lines.push(`    VMOT["${segLabel('vMotion', nets.vMotion)}"]`);
  }

  const hasVsan = nc.vsanEnabled && nets.vsan;
  if (hasVsan) {
    lines.push(`    VSANNET["${segLabel('vSAN', nets.vsan)}"]`);
  }

  const hasVmnet = nets.vmTraffic?.cidr || nets.vmTraffic?.vlanId != null;
  if (hasVmnet) {
    lines.push(`    VMNET["${segLabel('VM Traffic', nets.vmTraffic)}"]`);
  }

  if (wl.enabled && wl.count > 0) {
    const wlCount = Number(wl.count) || 0;
    const wlSpec = `${wlCount} VM${wlCount === 1 ? '' : 's'} · ${Number(wl.vcpu) || '?'} vCPU / ${Number(wl.vramGB) || '?'} GB each`;
    lines.push(`    WL["workload VMs\\n${wlSpec}"]`);
  }

  lines.push('');

  // ---- Edges ----

  const esxiRefs = Array.from({ length: shownHosts }, (_, i) => `ESXI${i + 1}`);
  if (hostCount > shownHosts) esxiRefs.push('ESXIREST');

  if (vyos.enabled) {
    lines.push('    WAN -->|"WAN"| VYOS');

    // VyOS → non-ESXi management devices
    const nonEsxi = [];
    if (dc.enabled)  nonEsxi.push('DC');
    if (vis.enabled) nonEsxi.push('VIS');
    nonEsxi.push('VCSA');
    if (hasJumpbox)  nonEsxi.push('JB');
    lines.push(`    VYOS -->|"NAT · DHCP · DNS"| ${nonEsxi.join(' & ')}`);

    // VyOS → ESXi hosts (separate line to keep edge labels readable)
    if (esxiRefs.length > 0) {
      lines.push(`    VYOS --> ${esxiRefs.join(' & ')}`);
    }
  }

  // DC → ESXi hosts (DNS / NTP, dashed)
  if (dc.enabled && esxiRefs.length > 0) {
    lines.push(`    DC -.->|"DNS · NTP"| ${esxiRefs.join(' & ')}`);
  }

  // VIS → ESXi hosts (DNS / NTP / DHCP, dashed) -- same role as DC above, mutually exclusive with it
  if (vis.enabled && esxiRefs.length > 0) {
    lines.push(`    VIS -.->|"DNS · NTP · DHCP"| ${esxiRefs.join(' & ')}`);
  }

  // ESXi hosts → vCenter (managed by); ESXI1 also physically hosts the VCSA VM
  if (esxiRefs.length > 0) {
    lines.push(`    ${esxiRefs.join(' & ')} --> VCSA`);
  }
  if (shownHosts >= 1) {
    lines.push('    ESXI1 -.->|"hosts VCSA VM"| VCSA');
  }

  // NSX Manager → vCenter (registered compute manager)
  if (nsx.enabled) {
    lines.push('    NSX -->|"compute manager"| VCSA');
    if (nsx.bgpEnabled && vyos.enabled) {
      lines.push('    NSX -.->|"BGP"| VYOS');
    }
  }

  // ESXi hosts ↔ vMotion / vSAN (dashed = same-segment traffic, not routed)
  if (esxiRefs.length > 0) {
    const netRefs = [];
    if (hasVmotion) netRefs.push('VMOT');
    if (hasVsan)    netRefs.push('VSANNET');
    if (netRefs.length > 0) {
      lines.push(`    ${esxiRefs.join(' & ')} -.- ${netRefs.join(' & ')}`);
    }
  }

  // vCenter → workload VMs; workload VMs on VM-traffic segment
  if (wl.enabled) {
    lines.push('    VCSA --> WL');
    if (hasVmnet) lines.push('    WL -.- VMNET');
  } else if (hasVmnet) {
    lines.push('    VCSA -.- VMNET');
  }

  // VyOS site-to-site WireGuard tunnel endpoint
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    lines.push('');
    lines.push('    REMOTE(["Remote Network"])');
    lines.push('    VYOS -.->|"WireGuard tunnel\\n10.201.0.0/30"| REMOTE');
  }

  // ---- Node colour classes ----
  lines.push('');
  const esxiIds = Array.from({ length: shownHosts }, (_, i) => `ESXI${i + 1}`);
  if (esxiIds.length > 0) lines.push(`class ${esxiIds.join(',')} esxi`);
  lines.push('class VCSA vcsa');
  if (vyos.enabled) {
    lines.push('class VYOS vyos');
    lines.push('class WAN wan');
    if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
      lines.push('class REMOTE wan');
    }
  }
  if (dc.enabled)   lines.push('class DC dc');
  if (vis.enabled)  lines.push('class VIS dc');
  if (hasJumpbox)   lines.push('class JB jb');
  if (nsx.enabled)  lines.push('class NSX nsx');
  if (wl.enabled && wl.count > 0) lines.push('class WL workload');
  const segIds = [];
  if (hasVmotion) segIds.push('VMOT');
  if (hasVsan)    segIds.push('VSANNET');
  if (hasVmnet)   segIds.push('VMNET');
  if (segIds.length > 0) lines.push(`class ${segIds.join(',')} segment`);

  // ---- Subgraph background styles ----
  lines.push('');
  for (let pi = 0; pi < physCount; pi++) {
    const graphId  = physCount > 1 ? `PHYS${pi + 1}` : 'PHYS';
    const nestedId = physCount > 1 ? `NESTED${pi + 1}` : 'NESTED';
    lines.push(`style ${graphId}  fill:#eff6ff,stroke:#1d4ed8,color:#1e3a5f,stroke-width:2px`);
    lines.push(`style ${nestedId} fill:#f0fdfa,stroke:#0d9488,color:#134e4a,stroke-width:1px`);
  }
  if (dc.enabled || vis.enabled || hasJumpbox) {
    lines.push('style DIRECT fill:#faf5ff,stroke:#9333ea,color:#581c87,stroke-width:1px');
  }

  return lines.join('\n');
}

module.exports = { buildMermaidDiagram };
