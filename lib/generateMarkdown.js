// lib/generateMarkdown.js
//
// Produces design-doc.md: the reference document covering network topology,
// IP addressing, architecture decisions, sizing analysis, and credential
// locations. This is NOT a how-to -- config snippets and step-by-step
// instructions live in build-guide.md (see generateBuildGuide.js).

const { buildMermaidDiagram } = require('./generateNetworkDiagram');
const { firstHostInCidr } = require('./generateVcf');

const USE_CASE_LABELS = {
  certification: 'VCP / VCF study and certification practice',
  feature_testing: 'vSAN and NSX feature testing',
  homelab: 'general homelab and tinkering',
  demo: 'customer-facing demo environment',
  devtest: 'dev/test sandbox'
};

const NETWORK_TYPE_LABELS = {
  flat: 'a flat network with no VLANs',
  vlans: 'a network with VLANs already configured',
  unsure: 'a network of unknown VLAN capability'
};

const FIREWALL_LABELS = {
  allow_all: 'allow all traffic, treating the lab as part of the trusted network',
  restricted: 'restrict traffic to the specific ports the lab actually needs',
  isolated: 'fully isolate the lab with no outbound access'
};

const DEVICE_TYPE_LABELS = {
  nvme: 'NVMe',
  sata_ssd: 'SATA SSD',
  sas_ssd: 'SAS SSD',
  spinning_disk: 'Spinning disk'
};

const NESTED_DISK_PURPOSE_LABELS = {
  vsan_storage_pool: 'vSAN storage pool (ESA)',
  vsan_capacity:     'vSAN capacity tier (OSA)',
  vsan_cache:        'vSAN cache / performance tier (OSA)',
  local_datastore:   'Local datastore (host 1 only)',
  data:              'Additional data disk'
};

const NIC_SPEED_LABELS = {
  '1gbe': '1GbE',
  '10gbe': '10GbE',
  '25gbe': '25GbE or faster'
};

const REMOTE_ACCESS_LABELS = {
  vpn: 'VPN back into the home network',
  ssh_jump: 'SSH jump host',
  none: 'local access only, no remote path',
  reverse_proxy: 'reverse proxy in front of lab services'
};

const VPN_TYPE_LABELS = {
  wireguard: 'WireGuard server VM',
  vyos_site_to_site: 'VyOS site-to-site WireGuard tunnel'
};

function fmtNet(net) {
  if (!net) return null;
  const parts = [];
  if (net.cidr) parts.push(net.cidr);
  if (net.vlanId !== null && net.vlanId !== undefined) parts.push(`VLAN ${net.vlanId}`);
  return parts.length ? parts.join(', ') : null;
}

const AVAILABILITY_LABELS = {
  devtest:        'Dev/test -- HA is not a priority for this environment',
  learning:       'Basic HA -- the cluster is sized to tolerate a single host failure',
  productionlike: 'Production-like -- full HA and DRS are configured to simulate an enterprise environment'
};

// Server-side mirror of the wizard scorecard so the design narrative includes
// the architecture assessment even though scoring happens in the browser.
function assessArchitecture(spec) {
  const nc = spec.nestedCluster || {};
  const nets = spec.networks || {};
  const nsx = spec.nsx || {};
  const vcf = spec.vcf || {};
  const hosts = nc.hostCount || 0;
  const dims = [];

  // Isolation
  const mgmtV = nets.management && nets.management.vlanId != null;
  const vmotV = nets.vMotion && nets.vMotion.vlanId != null;
  const vsanV = !nc.vsanEnabled || (nets.vsan && nets.vsan.vlanId != null);
  if (!mgmtV && !vmotV) dims.push(['Isolation', 'Poor', 'no dedicated VLANs are configured, so traffic types are not separated.']);
  else if (mgmtV && vmotV && vsanV) dims.push(['Isolation', 'Good', 'management, vMotion, and vSAN each have dedicated VLANs.']);
  else dims.push(['Isolation', 'Partial', 'management is tagged but vSAN or vMotion lacks dedicated isolation.']);

  // Resilience
  if (hosts >= 3) dims.push(['Resilience', 'Good', `${hosts} nested hosts allow HA to tolerate a host failure.`]);
  else if (hosts === 2) dims.push(['Resilience', 'Limited', 'two hosts give basic HA but vSAN needs three.']);
  else dims.push(['Resilience', 'Poor', 'a single host is a single point of failure.']);

  // Scalability
  const physRam = (spec.physicalHost && spec.physicalHost.ramGB) || 0;
  let used = hosts * (nc.vramPerHostGB || 0) + 21;
  if (spec.domainController && spec.domainController.enabled) used += 4;
  if (nsx.enabled) used += 48;
  const remaining = physRam - used;
  if (remaining < 0) dims.push(['Scalability', 'Over-committed', `the design needs ${used} GB but only ${physRam} GB is available.`]);
  else if (remaining >= 32) dims.push(['Scalability', 'Good', `${remaining} GB of RAM headroom remains for additional workloads.`]);
  else dims.push(['Scalability', 'Tight', `${remaining} GB of RAM headroom remains -- workable but limited.`]);

  // Complexity
  const uc = spec.useCase;
  if (vcf.enabled && hosts < 4) dims.push(['Complexity', 'Mismatched', 'VCF is enabled but the cluster is under four hosts.']);
  else if (nsx.enabled && (uc === 'homelab' || uc === 'devtest')) dims.push(['Complexity', 'Possibly over-engineered', 'NSX adds overhead that may exceed the stated use case.']);
  else dims.push(['Complexity', 'Appropriate', 'the design complexity matches the stated use case.']);

  // VCF readiness (only if enabled)
  if (vcf.enabled) {
    if (hosts < 4) dims.push(['VCF readiness', 'Not ready', 'VCF needs at least four hosts in the management domain.']);
    else if (!nsx.enabled) dims.push(['VCF readiness', 'Missing NSX', 'VCF bring-up deploys NSX -- enable it to match the reference architecture.']);
    else dims.push(['VCF readiness', 'Ready', 'four or more hosts with NSX -- aligned with the VCF reference architecture.']);
  }

  return dims;
}

function collectAntiPatterns(spec) {
  const nc = spec.nestedCluster || {};
  const nsx = spec.nsx || {};
  const vyos = spec.vyos || {};
  const mgmt = spec.networks && spec.networks.management;
  const hosts = nc.hostCount || 0;
  const out = [];
  if (hosts === 1) out.push('HA only makes sense with two or more hosts -- a single-host cluster cannot tolerate a failure.');
  if (nc.vsanEnabled && hosts < 3) out.push(`vSAN requires a minimum of 3 hosts -- the current cluster size of ${hosts} will not form a cluster.`);
  if (nsx.enabled && vyos.enabled && vyos.networkMode !== 'bgp') out.push('VyOS is deployed but BGP is not configured -- an opportunity to practise T0 BGP peering is being missed.');
  if (mgmt && mgmt.mode === 'untagged') out.push('Management traffic is on an untagged VLAN -- confirm this is intentional.');
  return out;
}

function buildOpenItems(disc, decisions, risks, dr) {
  const items = [];
  if (!disc.problemStatement && !(dr && dr.successStatement)) items.push('Problem statement not captured');
  const highRisks = risks.filter(r => r.likelihood === 'high' && r.impact === 'high' && !r.mitigation);
  if (highRisks.length) items.push(`${highRisks.length} high-severity risk(s) without mitigation`);
  const majDecisions = ['Virtual router', 'Storage architecture', 'NSX deployment', 'Cluster size'];
  const loggedDecisions = new Set(decisions.map(d => d.decision));
  const missing = majDecisions.filter(d => !loggedDecisions.has(d));
  if (missing.length) items.push(`Decision rationale missing for: ${missing.join(', ')}`);
  return items;
}

function buildMarkdown(spec) {
  const ph = spec.physicalHost;
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const sec = spec.security;
  const ra = spec.remoteAccess;
  const sizing = spec.sizing;
  const vyos = spec.vyos || {};
  const dc = spec.domainController || {};
  const localDs = spec.localDatastore || {};
  const wl = spec.workloadVms || {};
  const esxiVer = spec.esxiVersion || {};
  const nsx = spec.nsx || {};
  const vis = spec.vis || {};

  const useCase = USE_CASE_LABELS[spec.useCase] || spec.useCase || 'not specified';
  const out = [];

  out.push('# Lab Design Reference');
  out.push('');
  out.push('*Zero to Hero Lab — Build it. Break it. Fix it. Learn it.*');
  out.push('');
  out.push(`Generated ${new Date(spec.generatedAt).toUTCString()} by zero-to-hero-lab.`);
  out.push('');
  out.push(
    `This lab targets ${useCase}, running on ${ph.hostCount} physical host${ph.hostCount === 1 ? '' : 's'} ` +
    `with ${nc.hostCount} nested ESXi host${nc.hostCount === 1 ? '' : 's'} on top. ` +
    `This document explains what was designed and why. For step-by-step build instructions, see \`build-guide.md\`.`
  );
  out.push('');

  // --- Architect-quality design document (architect mode) ---
  if (spec.architectMode && spec.learningMode) {
    const dr = spec.designRationale || {};
    const disc = spec.discovery || {};
    const decisions = spec.decisionLog || [];
    const risks = spec.riskRegister || [];

    // 1. Executive Summary
    out.push('## Executive Summary');
    out.push('');
    const stmt = (dr.successStatement || disc.problemStatement || '').trim();
    if (stmt) { out.push(stmt); out.push(''); }
    const criteria = (disc.successCriteria || '').trim();
    if (criteria) { out.push(`**Success criteria:** ${criteria}`); out.push(''); }
    const measure = (disc.successMeasure || '').trim();
    if (measure) { out.push(`**Measure of success:** ${measure}`); out.push(''); }

    // 2. Requirements (MoSCoW)
    if (disc.moscow && Object.keys(disc.moscow).length) {
      out.push('## Requirements');
      out.push('');
      out.push('| Area | Priority | Notes |');
      out.push('|------|----------|-------|');
      const areaLabels = { networking: 'Networking (VLANs, router, segmentation)', compute: 'Compute (nested ESXi, cluster)', storage: 'Storage (vSAN, datastores)', security: 'Security (NSX DFW, micro-segmentation)', management: 'Management (vCenter, SDDC Manager)' };
      const priorityLabels = { must: 'Must Have', wont: "Won't Have" };
      Object.entries(disc.moscow).forEach(([area, priority]) => {
        if (priority) out.push(`| ${areaLabels[area] || area} | ${priorityLabels[priority] || priority} | |`);
      });
      out.push('');
    }

    // 3. Constraints
    if (disc.constraints) {
      const c = disc.constraints;
      out.push('## Constraints');
      out.push('');
      const timeMap = { weekend: 'One weekend', 'one-week': 'One week', 'one-month': 'One month', ongoing: 'Ongoing / no deadline' };
      const budgetMap = { homelab: 'Home lab -- no additional spend', small: 'Small budget (up to £500)', project: 'Project budget' };
      if (c.time) out.push(`- **Time:** ${timeMap[c.time] || c.time}`);
      if (c.budget) out.push(`- **Budget:** ${budgetMap[c.budget] || c.budget}`);
      if (c.skills && c.skills.trim()) out.push(`- **Skills:** ${c.skills.trim()}`);
      if (c.compliance && c.compliance.trim()) out.push(`- **Compliance:** ${c.compliance.trim()}`);
      out.push('');
    }

    // 4. Design Principles
    const principleLabels = {
      'security-default': 'Security by default -- if in doubt, restrict access',
      'automate': 'Automate anything done more than once',
      'document-decisions': 'Document decisions not just outcomes',
      'design-for-failure': 'Design for the failure you have not thought of yet',
      'keep-simple': 'Keep it as simple as the requirement allows',
      'monitorable': 'Every component must be monitorable',
      'change-process': 'Changes go through a process, never ad-hoc',
      'design-day2': 'Design for day 2, not just day 1',
    };
    const principles = disc.designPrinciples || [];
    if (principles.length) {
      out.push('## Design Principles');
      out.push('');
      principles.forEach(p => out.push(`- ${principleLabels[p] || p}`));
      out.push('');
    }

    // 5. Architecture Overview
    out.push('## Architecture Overview');
    out.push('');
    out.push('See network diagram and topology sections below.');
    out.push('');

    // 6. Design Decisions
    if (decisions.length) {
      out.push('## Design Decisions');
      out.push('');
      out.push('| Decision | Chosen | Alternative | Rationale | Date |');
      out.push('|----------|--------|-------------|-----------|------|');
      decisions.forEach(d => {
        out.push(`| ${d.decision || ''} | ${d.chosen || ''} | ${d.alternative || '--'} | ${(d.rationale || '--').replace(/\|/g, '/')} | ${d.timestamp || ''} |`);
      });
      out.push('');
    }

    // 7. Risk Register
    if (risks.length) {
      out.push('## Risk Register');
      out.push('');
      out.push('| Risk | Likelihood | Impact | Mitigation |');
      out.push('|------|------------|--------|------------|');
      risks.forEach(r => {
        out.push(`| ${(r.description || '').replace(/\|/g, '/')} | ${r.likelihood || '--'} | ${r.impact || '--'} | ${(r.mitigation || '--').replace(/\|/g, '/')} |`);
      });
      out.push('');
    }

    // 8. Component Specifications (from existing content below)
    out.push('## Component Specifications');
    out.push('');
    out.push('See Architecture Decisions and specifications sections below.');
    out.push('');

    // 9. Open Items -- flag unresolved issues
    const openItems = buildOpenItems(disc, decisions, risks, dr);
    const highRisks = risks.filter(r => r.likelihood === 'high' && r.impact === 'high' && !r.mitigation);
    const loggedDecisions = new Set(decisions.map(d => d.decision));
    const majDecisions = ['Virtual router', 'Storage architecture', 'NSX deployment', 'Cluster size'];
    const missing = majDecisions.filter(d => !loggedDecisions.has(d));
    if (openItems.length) {
      out.push('## Open Items');
      out.push('');
      openItems.forEach(item => out.push(`- [ ] ${item}`));
      out.push('');
    }

    // Design readiness score
    const checks = [
      !!(disc.problemStatement || dr.successStatement),
      !!(disc.moscow && Object.values(disc.moscow).some(Boolean)),
      !!(disc.constraints && (disc.constraints.time || disc.constraints.budget)),
      !!disc.successCriteria,
      risks.length > 0,
      principles.length > 0,
      decisions.length >= 2,
      !highRisks.length,
      missing.length === 0,
    ];
    const score = Math.round(checks.filter(Boolean).length / checks.length * 100);
    out.push(`> **Design readiness: ${score}%**`);
    if (openItems.length) out.push(`> Missing: ${openItems.join('; ')}`);
    out.push('');

  } else if (spec.learningMode) {
    const dr = spec.designRationale || {};
    out.push('## Design Rationale');
    out.push('');
    out.push('This design was developed in guided learning mode. The following rationale captures the thinking behind the key decisions.');
    out.push('');

    // Opening design statement -- from onboarding Q3
    const stmt = (dr.successStatement && dr.successStatement.trim()) || (dr.useCase && dr.useCase.trim());
    if (stmt) {
      out.push('### Design statement');
      out.push('');
      out.push(stmt);
      out.push('');
    }

    // Learning context -- from onboarding Q1, Q2, Q4
    const goalLabels = {
      certification: 'Certification preparation',
      technology:    'Technology deep-dive',
      customer:      'Customer scenario replication',
      homelab:       'Home lab and experimentation',
      role:          'New role skill building',
    };
    const expLabels = {
      new:        'New to VMware (< 1 year)',
      some:       'Some experience (1--3 years)',
      experienced: 'Experienced (3+ years, deepening specific skills)',
    };
    const timeLabels = {
      'wizard-only':  'Design wizard only (~30 minutes)',
      'wizard-build': 'Design wizard plus build (~half day)',
      'full-day':     'Full lab including troubleshooting (full day+)',
    };
    const hasContext = dr.learningGoal || dr.experienceLevel || dr.timeAvailable;
    if (hasContext) {
      out.push('### Learning context');
      out.push('');
      if (dr.learningGoal) out.push(`- **Goal:** ${goalLabels[dr.learningGoal] || dr.learningGoal}`);
      if (dr.certTarget)   out.push(`- **Target certification:** ${dr.certTarget}`);
      if (dr.techFocus)    out.push(`- **Technology focus:** ${dr.techFocus.toUpperCase()}`);
      if (dr.experienceLevel) out.push(`- **Experience level:** ${expLabels[dr.experienceLevel] || dr.experienceLevel}`);
      if (dr.timeAvailable)   out.push(`- **Session scope:** ${timeLabels[dr.timeAvailable] || dr.timeAvailable}`);
      out.push('');
    }

    const routerBits = [];
    if (dr.routerChoice && dr.routerChoice.trim()) {
      routerBits.push(dr.routerChoice.trim());
      if (vyos.enabled && vyos.networkMode === 'bgp') {
        routerBits.push('Running VyOS with BGP means the lab can peer a T0 gateway with the router and practise dynamic route exchange -- the same pattern used in enterprise NSX deployments.');
      }
    }
    if (dr.nsxRationale && dr.nsxRationale.trim()) {
      routerBits.push(`The decision to include NSX was driven by: ${dr.nsxRationale.trim()}`);
    }
    if (routerBits.length) {
      out.push('### Router and networking approach');
      out.push('');
      routerBits.forEach((b) => { out.push(b); out.push(''); });
    }

    if (dr.networkSecurity && dr.networkSecurity.trim()) {
      out.push('### Network security approach');
      out.push('');
      out.push(dr.networkSecurity.trim());
      out.push('');
    }

    if (dr.availabilityRequirement && AVAILABILITY_LABELS[dr.availabilityRequirement]) {
      out.push('### Availability requirement');
      out.push('');
      out.push(AVAILABILITY_LABELS[dr.availabilityRequirement]);
      out.push('');
    }

    out.push('### Architecture assessment');
    out.push('');
    assessArchitecture(spec).forEach(([dim, rating, reason]) => {
      out.push(`- ${dim}: ${rating} -- ${reason}`);
    });
    out.push('');
    const aps = collectAntiPatterns(spec);
    if (aps.length) {
      out.push('The following design considerations were flagged:');
      out.push('');
      aps.forEach((ap) => out.push(`- ${ap}`));
      out.push('');
    }
  }

  // --- Architecture decisions ---
  out.push('## Architecture decisions');
  out.push('');

  if (vyos.enabled) {
    out.push(
      '**VyOS as the first thing deployed.** VyOS provides the network foundation everything else runs on. ' +
      'Until the router is up, the nested hosts have no routable path to the outside world and DHCP on the ' +
      'lab networks doesn\'t exist. Every subsequent stage assumes the lab networks are routable.'
    );
    out.push('');
  }

  if (dc.enabled) {
    out.push(
      '**Domain controller before nested ESXi installs.** The nested hosts point at the DC for DNS and NTP ' +
      'from the moment they boot. More critically, vCenter\'s TLS certificates are generated using the FQDN ' +
      'given at install time. If DNS isn\'t resolving that FQDN correctly at install time, the certificates ' +
      'generate incorrectly and the environment accumulates certificate errors that are difficult to clean up later.'
    );
    out.push('');
  }

  if (vis.enabled) {
    out.push(
      "**VIS Appliance before nested ESXi installs, in place of a Windows DC.** William Lam's VCF " +
      'Infrastructure Services Appliance provides DNS, NTP, DHCP, a software depot, and a container registry ' +
      'from a single pre-built Ubuntu appliance -- the same role a domain controller plays for DNS/NTP in a ' +
      'Windows-based design, without the Windows license or AD promotion step. Recommended specifically for ' +
      'VCF lab deployments, where the depot and registry are also useful for hosting install bundles. ' +
      'Attribution: William Lam (williamlam.com) -- VCF Infrastructure Services Appliance ' +
      '(https://lamw.github.io/vcf-infrastructure-service-appliance/).'
    );
    out.push('');
  }

  if (localDs.enabled) {
    out.push(
      '**Local datastore on host 1 to break the vCenter/vSAN circular dependency.** vSAN requires a ' +
      'vCenter to manage it, but vCenter needs somewhere to live before the cluster exists. A dedicated ' +
      'VMFS disk on nested-esxi-01 (`local-ds`) gives vCenter a home that doesn\'t depend on the cluster ' +
      'it will go on to manage. vsan-cluster.ps1 runs in manual disk claim mode specifically so vSAN doesn\'t ' +
      'accidentally absorb the local-ds disk during cluster formation.'
    );
    out.push('');
  }

  out.push(
    '**vCenter deploys in standalone mode (directly to nested-esxi-01).** Once vCenter is up, the nested ' +
    'hosts join the cluster and vSAN forms. vSAN cannot exist without a vCenter -- that\'s why cluster ' +
    'formation is the last infrastructure step, not the first.'
  );
  out.push('');

  if (wl.enabled) {
    out.push(
      '**Workload VMs after the cluster is healthy.** They are placed on vSAN storage by default, so vSAN ' +
      'needs to be up and passing health checks first.'
    );
    out.push('');
  }

  // SSO / AD domain
  if (dc.enabled && nc.ssoDomain) {
    out.push(
      `**SSO domain (\`${nc.ssoDomain}\`) kept distinct from AD domain (\`${dc.domainName || 'TBD'}\`).** ` +
      'Colliding SSO and Active Directory domain names have caused real VCF bring-up failures. ' +
      'The SSO domain is the vCenter internal identity domain; the AD domain is your Windows forest root. ' +
      'They must not match, overlap, or be subdomains of each other.'
    );
    out.push('');
  }

  out.push(
    `**Cluster name \`${nc.clusterName}\`, datacenter \`${nc.datacenterName}\`.** ` +
    'These names propagate through every generated script. If you plan to convert this lab to a VCF management ' +
    'domain later, the cluster name is visible in SDDC Manager and painful to rename mid-deployment. ' +
    'The default `mgmt-cluster` matches the VCF reference architecture naming.'
  );
  out.push('');

  out.push(
    '**DNS forward AND reverse zones required.** Forward DNS (name → IP) is table stakes; ' +
    'reverse DNS (IP → name, via PTR records) is equally critical but often skipped. ' +
    'VCF bring-up and SDDC Manager validate reverse DNS for every appliance. ' +
    'A missing PTR record produces misleading "host unresponsive" errors that point at the wrong root cause. ' +
    'The build guide includes commands to create the reverse zone and PTR records for all known components.'
  );
  out.push('');

  out.push(
    `**Single NTP source (\`${spec.ntp?.source || 'pool.ntp.org'}\`) for all lab components.** ` +
    'VyOS, nested ESXi hosts, vCenter, and the DC all reference the same NTP server. ' +
    'Strict bring-up validation checks time sync across every appliance. One component drifting from ' +
    'the rest causes certificate validation failures and SSO authentication errors that are hard to diagnose.'
  );
  out.push('');

  if (nsx.enabled) {
    out.push(
      `**NSX-T deployed after vCenter and vSAN are healthy.** NSX-T requires a registered compute manager ` +
      `(vCenter) to function. vSAN must be healthy first because NSX Manager is deployed onto the cluster. ` +
      `This design uses ${nsx.size} sizing (${nsx.size === 'medium' ? '6 vCPU / 24GB' : '3 vCPU / 12GB'}) ` +
      `and a ${nsx.topology === 'T0T1' ? 'T0 + T1 gateway' : nsx.topology === 'T0T1DFW' ? 'T0 + T1 + Distributed Firewall' : 'full NSX-T'} topology.`
    );
    out.push('');
  }

  if (nc.vsanEnabled && nc.vsanArchitecture) {
    const archLabel = nc.vsanArchitecture === 'esa' ? 'ESA (Express Storage Architecture)' : 'OSA (Original Storage Architecture)';
    if (nc.vsanArchitecture === 'esa') {
      out.push(
        `**vSAN ${archLabel} -- single storage tier.** ESA is the current vSAN architecture. ` +
        'No separate cache and capacity disks -- all eligible disks are capacity. ' +
        'Requires all-flash storage (NVMe or high-performance SSD). ' +
        'OSA (two-tier cache/capacity) is the legacy architecture being phased down in favour of ESA.'
      );
    } else {
      out.push(
        `**vSAN ${archLabel} -- two-tier storage (cache + capacity).** ` +
        'OSA uses a separate SSD/NVMe cache tier and a capacity tier (can include HDDs). ' +
        'Consider migrating to ESA for any new lab design -- OSA is legacy and phased down.'
      );
    }
    out.push('');
  }

  // --- Physical hardware ---
  out.push('## Physical hardware');
  out.push('');
  const nicSpeedLabel = NIC_SPEED_LABELS[ph.nicSpeed] || 'unspecified';
  const nicWord = ph.nicCount === 1 ? 'NIC' : 'NICs';
  out.push(`${ph.cpuCores || '?'} logical cores, ${ph.ramGB || '?'}GB RAM, ${ph.nicCount || '?'} ${nicWord} at ${nicSpeedLabel}.`);
  out.push('');
  if (esxiVer.label) {
    out.push(`Target ESXi version for nested hosts: **${esxiVer.label}**.`);
    out.push('');
  }

  const storageDevices = ph.storageDevices || [];
  if (storageDevices.length > 0) {
    out.push('### Physical storage inventory');
    out.push('');
    out.push('| # | Type | Capacity |');
    out.push('|---|---|---|');
    storageDevices.forEach((d, i) => {
      const capLabel = d.capacityGB >= 1000
        ? `${(d.capacityGB / 1000).toFixed(1)} TB`
        : `${d.capacityGB} GB`;
      out.push(`| ${i + 1} | ${DEVICE_TYPE_LABELS[d.type] || d.type || '?'} | ${capLabel} |`);
    });
    out.push('');
  }

  const additionalDisks = nc.additionalDisks || [];
  if (additionalDisks.length > 0) {
    out.push('### Nested host disk layout');
    out.push('');
    out.push(`Each nested ESXi host VM gets a ${nc.bootDiskGB}GB boot disk plus the following virtual disks:`);
    out.push('');
    out.push('| Size | Purpose | Hosts |');
    out.push('|---|---|---|');
    additionalDisks.forEach((d) => {
      const hosts = d.purpose === 'local_datastore' ? 'Host 1 only' : 'All hosts';
      out.push(`| ${d.sizeGB}GB | ${NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose || '?'} | ${hosts} |`);
    });
    out.push('');
  }

  // --- Network diagram ---
  out.push('## Network diagram');
  out.push('');
  out.push('```mermaid');
  out.push(buildMermaidDiagram(spec));
  out.push('```');
  out.push('');

  // --- Network topology ---
  out.push('## Network topology');
  out.push('');
  const netTypeDesc = NETWORK_TYPE_LABELS[spec.existingNetwork?.type] || 'unspecified';
  out.push(`Existing network: ${netTypeDesc}.`);
  out.push('');
  out.push('| Network | CIDR | VLAN | Purpose |');
  out.push('|---|---|---|---|');
  const mgmtNet = nets.management;
  const vmotionNet = nets.vMotion;
  const vsanNet = nets.vsan;
  const vmNet = nets.vmTraffic;
  out.push(`| Management | ${mgmtNet?.cidr || '--'} | ${mgmtNet?.vlanId ?? '(native)'} | ESXi hosts, vCenter, DC, jumpbox |`);
  out.push(`| vMotion | ${vmotionNet?.cidr || '--'} | ${vmotionNet?.vlanId ?? '(native)'} | Live migration traffic |`);
  if (nc.vsanEnabled) {
    out.push(`| vSAN | ${vsanNet?.cidr || '--'} | ${vsanNet?.vlanId ?? '(native)'} | vSAN storage replication |`);
  }
  out.push(`| VM traffic | ${vmNet?.cidr || '--'} | ${vmNet?.vlanId ?? '(native)'} | Nested guest VMs |`);
  out.push('');
  out.push(
    'All of these VLANs ride a single **Nested-Trunk** port group (VLAN 4095 trunk) on an internal-only ' +
    '**vSwitch1** -- there is no per-network port group on the physical host. VyOS is the only device ' +
    'that routes between VLANs; it does so with a VLAN sub-interface per network on its own trunk NIC. ' +
    'Nested ESXi hosts, the DC, the jumpbox, and workload VMs all connect a single NIC to Nested-Trunk. ' +
    '`deploy-lab.ps1` creates vSwitch1 and the trunk port group automatically, with **Promiscuous mode**, ' +
    '**Forged transmits**, and **MAC address changes** set to Accept (required for nested ESXi traffic).'
  );
  out.push('');

  // --- Lab components ---
  out.push('## Lab components');
  out.push('');

  if (vyos.enabled) {
    const modeDesc = vyos.networkMode === 'bgp'
      ? 'NAT, DHCP, DNS forwarding, BGP peering'
      : 'NAT, DHCP, DNS forwarding';
    out.push(`**VyOS virtual router** -- 2 vCPU / 1GB RAM. Functions: ${modeDesc}.`);
    out.push('');
  }

  if (dc.enabled) {
    const domainStr = dc.domainName ? `\`${dc.domainName}\`` : 'domain TBD';
    const ipStr     = dc.ipAddress  ? `\`${dc.ipAddress}\``  : 'static IP TBD';
    const profile   = dc.profile || 'dc-only';
    const vcpu   = profile === 'dc-only' ? 2 : 4;
    const ramGB  = profile === 'dc-only' ? 4 : 8;
    const diskGB = profile === 'dc-only' ? 60 : 100;
    const profileLabel = profile === 'dc-only' ? 'DC only' : profile === 'dc-jumpbox' ? 'DC + Jumpbox' : 'DC + Jumpbox + File Server';
    let dcLine = `**Domain controller** (${profileLabel}) -- ${vcpu} vCPU / ${ramGB}GB RAM / ${diskGB}GB OS disk. IP: ${ipStr}. Domain: ${domainStr}. Provides AD, DNS, and NTP for the lab.`;
    if (dc.hasJumpbox) dcLine += ' RDP access enabled -- a pre-configured `.rdp` file is included in the output zip.';
    if (dc.hasFileServer) dcLine += ` Additional ${dc.storageDiskGB}GB storage disk attached and shared as \`\\\\dc\\LabISOs\`.`;
    out.push(dcLine);
    out.push('');
  }

  if (vis.enabled) {
    const visIpStr = vis.ipAddress ? `\`${vis.ipAddress}\`` : 'static IP TBD';
    out.push(
      `**VIS Appliance** (William Lam's VCF Infrastructure Services Appliance) -- 2 vCPU / 4GB RAM / 30GB disk. ` +
      `IP: ${visIpStr}. Provides DNS, NTP, DHCP, a software depot, and a container registry for the lab, in place ` +
      'of a Windows domain controller. No license required. Deployed via `vis-deploy.ps1` (OVF Tool).'
    );
    out.push('');
    out.push('DNS records to create on VIS once it is up and its DNS service is enabled:');
    out.push('');
    out.push('| Record | Type | Value |');
    out.push('|--------|------|-------|');
    out.push(`| \`vis.lab.local\` | A | ${vis.ipAddress || '<VIS IP>'} |`);
    out.push(`| \`vcenter.lab.local\` | A | ${(spec.vcf && spec.vcf.enabled && spec.vcf.vcenterIp) || '<vCenter IP, set when you run vcenter-deploy.ps1>'} |`);
    if (vyos.enabled) {
      out.push(`| \`vyos.lab.local\` | A | ${(spec.networks && spec.networks.management && firstHostInCidr(spec.networks.management.cidr)) || '<VyOS IP>'} |`);
    }
    for (let i = 1; i <= (nc.hostCount || 0); i++) {
      out.push(`| \`nested-esxi-${String(i).padStart(2, '0')}.lab.local\` | A | \`<host ${i} IP>\` |`);
    }
    out.push('');
    out.push('Add the matching PTR record for each once its IP is finalised -- see Lessons learned #1 below for why reverse DNS matters just as much as forward.');
    out.push('');
  }

  {
    const vsanDesc = nc.vsanEnabled
      ? ` vSAN ${nc.vsanArchitecture === 'osa' ? 'OSA (two-tier)' : 'ESA (single-tier)'} enabled.`
      : '';
    out.push(
      `**Nested ESXi cluster \`${nc.clusterName}\`** (datacenter: \`${nc.datacenterName}\`) -- ` +
      `${nc.hostCount} host${nc.hostCount === 1 ? '' : 's'}, ` +
      `${nc.vcpuPerHost} vCPU / ${nc.vramPerHostGB}GB vRAM / ${nc.bootDiskGB}GB boot disk each.` +
      vsanDesc +
      (nc.legacyCpuCompatibility ? ' `monitor.allowLegacyCPU` enabled.' : '')
    );
    out.push('');
  }

  const vcSize = ra.vcenterDeploymentSize || 'small';
  out.push(`**vCenter (VCSA)** -- deployed onto nested-esxi-01. Deployment size: ${vcSize}. SSO domain: \`${nc.ssoDomain || 'vsphere.local'}\`.`);

  if (localDs.enabled) {
    out.push('**Local datastore (local-ds)** -- 200GB VMDK on nested-esxi-01, formatted as VMFS. Hosts vCenter. Not claimed by vSAN.');
    out.push('');
  }

  if (nc.memoryTiering && nc.memoryTiering.enabled) {
    const diskRef = nc.memoryTiering.physicalDiskSizeGB != null
      ? `physical disk #${nc.memoryTiering.physicalDiskIndex + 1} (NVMe, ${nc.memoryTiering.physicalDiskSizeGB}GB)`
      : `a ${nc.memoryTiering.nvmeSizeGB}GB NVMe device`;
    out.push(
      `**NVMe memory tiering** -- ${nc.memoryTiering.nvmeSizeGB}GB virtual NVMe VMDK added to each nested host, ` +
      `provisioned from ${diskRef}. Configured at ${nc.memoryTiering.tierNvmePct}% of host RAM. ` +
      `Run \`configure-memory-tiering.ps1\` after vSAN cluster formation.`
    );
    out.push('');
  }

  out.push('');

  if (wl.enabled && wl.count > 0) {
    out.push(`**Workload VMs** -- ${wl.count} blank VM shell${wl.count === 1 ? '' : 's'}, ${wl.vcpu} vCPU / ${wl.vramGB}GB RAM each. No OS pre-installed.`);
    out.push('');
  }

  const hasAccessVm = ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard');
  if (hasAccessVm) {
    const vmName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
    const role = ra.method === 'ssh_jump' ? 'SSH jump host' : 'WireGuard VPN server';
    out.push(`**${vmName}** -- 1 vCPU / 1GB RAM / 20GB disk, Ubuntu 22.04 LTS. Role: ${role}.`);
    out.push('');
  }

  if (nsx.enabled) {
    const { NSX_TOPOLOGY_LABELS, NSX_SIZES } = require('./generateNsx');
    const nsxSz = NSX_SIZES[nsx.size] || NSX_SIZES.small;
    const nsxTopLabel = NSX_TOPOLOGY_LABELS[nsx.topology] || nsx.topology;
    const nsxIpStr = nsx.ipAddress ? ` IP: \`${nsx.ipAddress}\`.` : '';
    out.push(
      `**NSX-T Manager** -- ${nsxSz.vcpu} vCPU / ${nsxSz.vramGB}GB RAM / ${nsxSz.diskGB}GB disk (${nsx.size}).${nsxIpStr} ` +
      `Topology: ${nsxTopLabel}.${nsx.bgpEnabled ? ` BGP peering with VyOS (NSX AS ${nsx.bgpLocalAs} ↔ VyOS AS ${nsx.bgpPeerAs}).` : ''}`
    );
    out.push('');
  }

  const depot = spec.bundleDepot || {};
  if (depot.enabled) {
    const depotIpStr = depot.ipAddress ? ` IP: \`${depot.ipAddress}\`.` : '';
    if (depot.mode === 'iis') {
      out.push(`**Bundle depot (IIS on DC)** -- Hosted on the domain controller via IIS.${depotIpStr} URL: \`https://${depot.ipAddress || '<depot-ip>'}/depot/\`. Self-signed cert -- SDDC Manager must trust it before bring-up.`);
    } else {
      out.push(`**Bundle depot (lab-depot)** -- 2 vCPU / 4GB RAM / 100GB disk, nginx HTTPS file server.${depotIpStr} URL: \`https://${depot.ipAddress || '<depot-ip>'}/depot/\`. Self-signed cert -- SDDC Manager must trust it before bring-up.`);
    }
    out.push('');
  }

  // --- Sizing analysis ---
  out.push('## Sizing analysis');
  out.push('');
  out.push('| Category | vCPU | vRAM |');
  out.push('|---|---|---|');
  out.push(`| Nested ESXi hosts (${nc.hostCount}×) | ${sizing.nestedVcpu} | ${sizing.nestedVramGB}GB |`);
  if (sizing.applianceVcpu > 0) {
    const depotLinux = spec.bundleDepot?.enabled && spec.bundleDepot?.mode !== 'iis';
    const names = [vyos.enabled && 'VyOS', dc.enabled && 'DC', depotLinux && 'depot VM', nsx.enabled && 'NSX Manager'].filter(Boolean).join(', ');
    out.push(`| Lab appliances (${names}) | ${sizing.applianceVcpu} | ${sizing.applianceVramGB}GB |`);
  }
  if (sizing.workloadVcpu > 0) {
    out.push(`| Workload VMs (${wl.count}×) | ${sizing.workloadVcpu} | ${sizing.workloadVramGB}GB |`);
  }
  if (sizing.accessVmVcpu > 0) {
    const label = ra.method === 'ssh_jump' ? 'jumpbox' : 'WireGuard VM';
    out.push(`| ${label} | ${sizing.accessVmVcpu} | ${sizing.accessVmVramGB}GB |`);
  }
  out.push(`| **Total** | **${sizing.totalRequestedVcpu}** | **${sizing.totalRequestedVramGB}GB** |`);
  out.push('');
  if (sizing.usableRamGB) {
    out.push(
      `Physical RAM: ${ph.ramGB}GB -- ${sizing.reservedOverheadGB}GB reserved for host overhead = ` +
      `**${sizing.usableRamGB}GB usable**.`
    );
    if (sizing.ramOvercommitRatio !== null) {
      out.push(`RAM overcommit: **${sizing.ramOvercommitRatio}:1**`);
    }
    if (sizing.cpuOvercommitRatio !== null) {
      out.push(`CPU overcommit: **${sizing.cpuOvercommitRatio}:1**`);
    }
  }
  out.push('');

  // --- Resource summary (traffic-light) ---
  {
    const vcSize    = ra.vcenterDeploymentSize || 'tiny';
    const vcRamMap  = { tiny: 14, small: 21, medium: 30, large: 39 };
    const vcRam     = vcRamMap[vcSize] || 14;
    const rows      = [];
    rows.push({ name: `Nested ESXi hosts (${nc.hostCount}×)`,      ram: nc.hostCount * nc.vramPerHostGB });
    rows.push({ name: `vCenter (${vcSize})`,                        ram: vcRam });
    if (vyos.enabled) rows.push({ name: 'VyOS router',              ram: 1 });
    if (dc.enabled) {
      const dcRam = (dc.profile === 'dc-jumpbox' || dc.profile === 'dc-jumpbox-fileserver') ? 8 : 4;
      const dcLabel = dc.profile === 'dc-jumpbox' ? 'DC + Jumpbox' : dc.profile === 'dc-jumpbox-fileserver' ? 'DC + Jumpbox + File Server' : 'Domain controller';
      rows.push({ name: dcLabel, ram: dcRam });
    }
    if (nsx.enabled) {
      const nsxRam = (nsx.size === 'medium') ? 24 : 12;
      rows.push({ name: `NSX Manager (${nsx.size || 'small'})`,     ram: nsxRam });
    }
    if (sizing.workloadVramGB > 0) {
      rows.push({ name: `Workload VMs (${wl.count}×)`,              ram: sizing.workloadVramGB });
    }
    if (sizing.accessVmVramGB > 0) {
      const aLabel = ra.method === 'ssh_jump' ? 'Jumpbox' : 'WireGuard VM';
      rows.push({ name: aLabel,                                      ram: sizing.accessVmVramGB });
    }
    const totalAlloc = rows.reduce((s, r) => s + r.ram, 0) + sizing.reservedOverheadGB;
    const headroom   = ph.ramGB - totalAlloc;
    const headroomPct = ph.ramGB > 0 ? Math.round((headroom / ph.ramGB) * 100) : 0;

    out.push('## Resource summary');
    out.push('');
    out.push('| Component | RAM |');
    out.push('|---|---|');
    rows.forEach((r) => out.push(`| ${r.name} | ${r.ram} GB |`));
    out.push(`| ESXi host overhead | ${sizing.reservedOverheadGB} GB |`);
    out.push(`| **Total allocated** | **${totalAlloc} GB** |`);
    out.push(`| Physical RAM | ${ph.ramGB} GB |`);
    out.push(`| **Headroom** | **${headroom} GB (${headroomPct}%)** |`);
    out.push('');

    const ratio = sizing.ramOvercommitRatio || 0;
    let statusLine;
    if (ratio < 0.7 && headroom >= 16) {
      statusLine = '**🟢 Green** -- plenty of headroom; no tuning needed.';
    } else if (ratio <= 1.0) {
      statusLine = '**🟡 Amber** -- tight but workable; monitor memory balloon and swap usage.';
    } else {
      statusLine = '**🔴 Red** -- overcommitted; expect swapping and degraded performance. Reduce cluster size or add RAM.';
    }
    out.push(statusLine);
    out.push('');

    if (nc.memTieringEnabled) {
      out.push(`Memory tiering: enabled -- ${nc.nvmeSizeGB || 100} GB NVMe tier at ${nc.tierNvmePct || 25}% of host RAM. Set \`sched.mem.enableNestedTiering = true\` on each nested ESXi host before power-on to allow nested VMs to use the tier.`);
      out.push('');
    }
  }

  if (sizing.warnings && sizing.warnings.length) {
    out.push('## Sizing warnings');
    out.push('');
    for (const w of sizing.warnings) {
      out.push(`- ${w}`);
    }
    out.push('');
  }

  // --- Security posture ---
  out.push('## Security posture');
  out.push('');
  out.push('| Setting | Value |');
  out.push('|---|---|');
  out.push(`| Isolated segment | ${sec.isolateLabSegment ? 'Yes' : 'No'} |`);
  out.push(`| Firewall policy | ${FIREWALL_LABELS[sec.firewallPolicy] || 'not specified'} |`);
  out.push(`| Outbound internet | ${sec.internetAccess ? 'Yes' : 'No'} |`);
  out.push('');

  // --- Remote access ---
  out.push('## Remote access');
  out.push('');
  out.push(`| Setting | Value |`);
  out.push('|---|---|');
  out.push(`| Method | ${REMOTE_ACCESS_LABELS[ra.method] || 'not specified'} |`);
  if (ra.method === 'vpn' && ra.vpnType) {
    out.push(`| VPN type | ${VPN_TYPE_LABELS[ra.vpnType] || ra.vpnType} |`);
  }
  if (ra.vcenterDeploymentSize) {
    out.push(`| vCenter size | ${ra.vcenterDeploymentSize} |`);
  }
  out.push('');

  if (ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard')) {
    const vmName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
    out.push('### SSH key locations');
    out.push('');
    out.push('| Item | Path |');
    out.push('|---|---|');
    out.push(`| Private key | \`%USERPROFILE%\\.ssh\\${vmName}\` |`);
    out.push(`| Public key | \`%USERPROFILE%\\.ssh\\${vmName}.pub\` |`);
    out.push('');
    out.push(
      '**Security:** the private key is generated on your local machine by `jumpbox-deploy.ps1`. ' +
      'Do not check it into version control or paste it into chat. It is the only credential ' +
      'protecting remote access to the lab.'
    );
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push('### WireGuard addressing');
    out.push('');
    out.push('| Item | Value |');
    out.push('|---|---|');
    out.push('| VPN subnet | `10.200.0.0/24` |');
    out.push('| Server address | `10.200.0.1` |');
    out.push('| Listen port | UDP 51820 |');
    out.push('');
    out.push('Client IPs are assigned sequentially from `10.200.0.2` onward, one per device.');
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push('### VyOS site-to-site tunnel addressing');
    out.push('');
    out.push('| Item | Value |');
    out.push('|---|---|');
    out.push('| Tunnel subnet | `10.201.0.0/30` |');
    out.push('| This router | `10.201.0.1` |');
    out.push('| Remote router | `10.201.0.2` |');
    out.push('| Listen port | UDP 51821 |');
    out.push('');
  }

  // --- Lessons learned ---
  out.push('## Lessons learned');
  out.push('');
  out.push(
    'Non-obvious things that eat hours in a real nested lab build. ' +
    'Documented here so you can skip them the first time.'
  );
  out.push('');

  out.push('### 1. `/etc/hosts` ordering');
  out.push('');
  out.push(
    'On nested ESXi hosts, list the management IP entry *before* `127.0.0.1` in `/etc/hosts`. ' +
    'Reverse-lookup on loopback resolves to `localhost` instead of the FQDN, which breaks ' +
    'anything that resolves its own identity (vSAN health checks, VCSA internal services, SMS).'
  );
  out.push('');

  out.push('### 2. `sshd_config` vs `ssh_config`');
  out.push('');
  out.push(
    '`/etc/ssh/sshd_config` configures the **SSH server** daemon. ' +
    '`~/.ssh/config` (or `/etc/ssh/ssh_config`) configures the **SSH client**. ' +
    'They are separate files and separate services. Editing the wrong one produces no error and has no effect.'
  );
  out.push('');

  out.push('### 3. ESXi SSH service policy (TSM-SSH)');
  out.push('');
  out.push(
    'The `TSM-SSH` service defaults to **"Start and stop manually"**. ' +
    'This means SSH stops every time the host exits maintenance mode, requiring manual re-enable each time. ' +
    'Set the startup policy to **"Start and stop with host"** on every nested host you need persistent SSH access on:'
  );
  out.push('');
  out.push('```powershell');
  out.push('$svc = Get-VMHostService -VMHost $vmHost | Where-Object { $_.Key -eq "TSM-SSH" }');
  out.push('Set-VMHostService -HostService $svc -Policy "On"   # "On" = start with host');
  out.push('```');
  out.push('');

  out.push('### 4. SSL certificate regeneration after hostname change');
  out.push('');
  out.push(
    'A fresh ESXi install auto-generates a self-signed certificate with `CN=localhost.localdomain`. ' +
    'Setting the real hostname via DCUI does **not** update the certificate. ' +
    'vCenter\'s certificate checks will warn or fail. Regenerate after setting the FQDN:'
  );
  out.push('');
  out.push('```bash');
  out.push('# On each nested ESXi host via SSH:');
  out.push('/sbin/generate-certificates');
  out.push('/etc/init.d/hostd restart && /etc/init.d/vpxa restart');
  out.push('```');
  out.push('');

  out.push('### 5. DVS port group profile -- choose Default, not Custom');
  out.push('');
  out.push(
    'When creating a Distributed Virtual Switch in vCenter, the wizard asks for a switch profile. ' +
    'Select **Default** (not **Custom**). ' +
    'The Custom profile prompts for additional configuration that doesn\'t apply to a nested lab ' +
    'and leaves the DVS in an incomplete state that blocks port group creation.'
  );
  out.push('');

  out.push('### 6. `monitor.allowLegacyCPU` on every VM type');
  out.push('');
  out.push(
    'On hosts with older CPUs, `monitor.allowLegacyCPU = TRUE` is needed on **every** lab VM -- ' +
    'not just nested ESXi hosts. DC, jumpbox, workload VMs, and VyOS can all fail to power on or ' +
    'hang at boot if the physical CPU doesn\'t expose the instructions they expect. ' +
    'The generated scripts propagate this setting to all VM types when legacy CPU compatibility is enabled.'
  );
  out.push('');

  out.push('### 7. The VLAN two-layer rule');
  out.push('');
  out.push(
    'The physical-host port group (`Nested-Trunk`) is always a VLAN 4095 trunk -- it passes every ' +
    'tag through unmodified, so it is never part of the VLAN matching problem. Only two layers have ' +
    'to agree on the same VLAN ID, or traffic is silently dropped:'
  );
  out.push('');
  out.push('| Layer | Configuration |');
  out.push('|---|---|');
  out.push('| VyOS sub-interface | `set interfaces ethernet eth1 vif <id>` instead of plain `eth1` |');
  out.push('| Nested vmk0 | VLAN ID in DCUI → Configure Management Network → VLAN (per host) |');
  out.push('');
  out.push(
    'Miss either layer and management traffic is dropped with no error. ' +
    'The safest default is **untagged** management (VLAN 0 everywhere) until you need segmentation -- ' +
    'in that case both layers are simply left blank/native, and non-ESXi VMs (DC, jumpbox, workload VMs, ' +
    'which cannot tag VLANs themselves) reach the management network with zero extra configuration.'
  );
  out.push('');

  // --- Files in this output ---
  out.push('## Files in this output');
  out.push('');
  out.push('| File | Description |');
  out.push('|---|---|');
  out.push('| `lab-spec.json` | Full structured spec (source of truth for all generators) |');
  out.push('| `design-doc.md` | This document -- reference only |');
  out.push('| `build-guide.md` | Step-by-step runbook -- what to run, in what order |');
  if (vyos.enabled) out.push('| `vyos-deploy.ps1` | Stage 1: VyOS VM shell |');
  if (dc.enabled) out.push('| `dc-deploy.ps1` | Stage 2: DC VM shell |');
  out.push('| `deploy-lab.ps1` | Port groups and nested ESXi VM shells |');
  out.push('| `vcenter-deploy.ps1` | vCenter VCSA deployment (govc or PowerCLI) |');
  if (nc.vsanEnabled) out.push('| `vsan-cluster.ps1` | vSAN cluster formation |');
  if (wl.enabled) out.push('| `deploy-workloads.ps1` | Test workload VM shells |');
  if (nc.memoryTiering && nc.memoryTiering.enabled) {
    const diskRef = nc.memoryTiering.physicalDiskSizeGB != null
      ? `physical disk #${nc.memoryTiering.physicalDiskIndex + 1} (NVMe, ${nc.memoryTiering.physicalDiskSizeGB}GB)`
      : `${nc.memoryTiering.nvmeSizeGB}GB NVMe device`;
    out.push(`| \`configure-memory-tiering.ps1\` | Add ${nc.memoryTiering.nvmeSizeGB}GB NVMe VMDKs to nested hosts from ${diskRef} + esxcli tiering config (${nc.memoryTiering.tierNvmePct}%) |`);
  }
  if (ra.method === 'ssh_jump') out.push('| `jumpbox-deploy.ps1` | Jump host VM shell + SSH keypair generation |');
  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push('| `jumpbox-deploy.ps1` | WireGuard server VM shell + SSH keypair generation |');
    out.push('| `wireguard-server.sh` | WireGuard server setup (run on VM after OS install) |');
  }
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push('| `vyos-site-to-site.conf` | VyOS CLI commands for site-to-site tunnel |');
  }
  if (nsx.enabled) {
    out.push('| `nsx-deploy.ps1` | Deploy NSX-T Manager OVA |');
    out.push('| `nsx-configure.ps1` | Register with vCenter, create T0/T1 topology |');
    if (nsx.bgpEnabled) out.push('| `nsx-bgp.ps1` | Configure BGP on T0 gateway |');
  }
  out.push('');

  return out.join('\n');
}

module.exports = { buildMarkdown, buildOpenItems };
