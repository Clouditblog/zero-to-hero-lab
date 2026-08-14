// public/wizard.js
// No build step, no dependencies. Runs entirely against the Express API.

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Renders a string that may contain <code> tags into el safely.
// Only <code> elements are permitted — everything else is plain text.
function setRichText(el, html) {
  el.innerHTML = '';
  html.split(/(<code>[^<]*<\/code>)/).forEach(part => {
    const m = part.match(/^<code>([^<]*)<\/code>$/);
    if (m) {
      const code = document.createElement('code');
      code.textContent = m[1];
      el.appendChild(code);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}

// Basic structural check — a valid spec must be a plain object with at least
// the top-level keys the wizard generates. Rejects arrays, strings, or
// completely unrelated JSON files.
function isValidSpecStructure(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const required = ['nestedCluster', 'networks', 'esxiVersion'];
  return required.every((k) => k in obj);
}

const TOTAL_STEPS = 13;
const NSX_STEP = 9;           // always shown
const TROUBLESHOOT_STEP = 12; // only reachable when troubleshooting mode is active

const USE_CASE_LABELS = {
  certification: 'Certification study',
  feature_testing: 'Feature testing',
  homelab: 'General homelab',
  demo: 'Customer demo',
  devtest: 'Dev/test sandbox'
};

const DEVICE_TYPE_LABELS = { nvme: 'NVMe', sata_ssd: 'SATA SSD', sas_ssd: 'SAS SSD', spinning_disk: 'Spinning disk' };
const NESTED_DISK_PURPOSE_LABELS = {
  vsan_storage_pool: 'vSAN storage pool (ESA)',
  vsan_capacity:     'vSAN capacity tier (OSA)',
  vsan_cache:        'vSAN cache / perf tier (OSA)',
  local_datastore:   'Local datastore (host 1 only)',
  data:              'Additional data disk'
};
const NETTYPE_LABELS = { flat: 'Flat, no VLANs', vlans: 'VLANs configured', unsure: 'Not sure' };
const FIREWALL_LABELS = { allow_all: 'Allow all', restricted: 'Restricted to needed ports', isolated: 'Fully isolated' };
const REMOTE_LABELS = { vpn: 'VPN', ssh_jump: 'SSH jump host', none: 'Local only', reverse_proxy: 'Reverse proxy' };
const VPN_TYPE_LABELS = { wireguard: 'WireGuard server VM', vyos_site_to_site: 'VyOS site-to-site' };

const ESXI_VERSION_LABELS = {
  '9.1':   'ESXi 9.1',
  '9.0u2': 'ESXi 9.0 U2',
  '9.0u1': 'ESXi 9.0 U1',
  '9.0':   'ESXi 9.0',
  '8.0u3': 'ESXi 8.0 U3',
  '8.0u2': 'ESXi 8.0 U2',
  '8.0u1': 'ESXi 8.0 U1'
};

// Minimum vRAM per nested host by ESXi version
const ESXI_MIN_VRAM = { '9.1': 8, '9.0u2': 8, '9.0u1': 8, '9.0': 8, '8.0u3': 8, '8.0u2': 8, '8.0u1': 8 };
const ESXI9X_VERSIONS = new Set(['9.1', '9.0u2', '9.0u1', '9.0']);
const VCENTER_TINY_RAM_GB = 14;
const DC_RAM_GB_BY_PROFILE = { 'none': 0, 'dc-only': 4, 'dc-jumpbox': 8, 'dc-jumpbox-fileserver': 8 };
const VYOS_RAM_GB_SIZING = 1;
const ESXI_OVERHEAD_GB = 4;

// RAM thresholds -> what's realistically achievable at that physical RAM size.
// Shared reference point between the prereq checklist (static copy) and the
// live Hardware-step validator (renderHardwareValidator) below.
const RAM_TIERS = [
  { ramGB: 64,  label: 'vSphere basics',            detail: '1–2 hosts only' },
  { ramGB: 128, label: 'vSphere + vSAN',             detail: '3 hosts' },
  { ramGB: 192, label: 'vSphere + NSX',              detail: '3–4 hosts' },
  { ramGB: 256, label: 'vSphere + NSX + basic VCF',  detail: '' },
  { ramGB: 384, label: 'Full VCF recommended',       detail: '' },
  { ramGB: 512, label: 'Full VCF + workload domains', detail: '' }
];

const NET_COLORS = {
  management: '#4fb3a4',
  vMotion: '#5b8fd9',
  vsan: '#d99a4e',
  vmTraffic: '#9b86d9'
};

const NSX_TOPOLOGY_LABELS = {
  T0T1:    'T0 + T1 Gateways',
  T0T1DFW: 'T0 + T1 + DFW',
  full:    'Full (T0/T1/DFW/LB)'
};

const SCRIPT_LABELS = {
  'spec':             'lab-spec.json',
  'design-doc':       'design-doc.md',
  'build-guide':      'build-guide.md',
  'prerequisites':    'PREREQUISITES.md',
  'diagram-html':     'diagram.html',
  'network-diagram':  'network-diagram.svg',
  'lab-config':         'lab-config.json',
  'lab-config-example': 'lab-config.json.example',
  'deploy-lab':       'deploy-lab.ps1',
  'vyos-deploy': 'vyos-deploy.ps1',
  'vyos-config': 'vyos-config.txt',
  'dc-deploy': 'dc-deploy.ps1',
  'vcenter-deploy': 'vcenter-deploy.ps1',
  'vsan-cluster': 'vsan-cluster.ps1',
  'deploy-workloads': 'deploy-workloads.ps1',
  'jumpbox-deploy': 'jumpbox-deploy.ps1',
  'wireguard-server': 'wireguard-server.sh',
  'vyos-site-to-site': 'vyos-site-to-site.conf',
  'memory-tiering': 'configure-memory-tiering.ps1',
  'depot-deploy':       'depot-deploy.ps1',
  'depot-configure':    'depot-configure.sh',
  'depot-iis':          'depot-iis.ps1',
  'depot-instructions': 'depot-instructions.md',
  'nsx-deploy':     'nsx-deploy.ps1',
  'nsx-configure':  'nsx-configure.ps1',
  'nsx-bgp':        'nsx-bgp.ps1',
  'vis-deploy':     'vis-deploy.ps1'
};

const state = {
  step: 0,
  modeSelected: false,
  learningMode: false,
  designRationale: {
    // Onboarding fields (captured before wizard starts)
    learningGoal: '',        // certification | technology | customer | homelab | role
    certTarget: '',          // VCP-VCF-Architect | VCP-VCF-Admin | VCP-VCF-Support | VCP-VVF-Admin | VCP-VVF-Support | VCAP-VCF-Automation | VCAP-VCF-Operations | VCAP-VCF-Storage | VCAP-VCF-VKS | VCAP-VCF-Networking
    techFocus: '',           // vsphere | vsan | nsx | vcf
    experienceLevel: '',     // new | some | experienced
    successStatement: '',    // free text — opening statement of design rationale
    timeAvailable: '',       // wizard-only | wizard-build | full-day
    // Per-step rationale fields (captured as the wizard progresses)
    routerChoice: '',
    networkSecurity: '',
    availabilityRequirement: '',
    nsxRationale: ''
  },
  architectMode: false,
  discovery: {
    problemStatement: '',
    moscow: {
      networking:  'must',
      compute:     'must',
      storage:     'must',
      security:    'must',
      management:  'must'
    },
    constraints: {
      time:        '',
      budget:      '',
      skills:      '',
      compliance:  ''
    },
    successCriteria: '',
    successMeasure:  '',
    risks: [],
    designPrinciples: []
  },
  decisionLog: [],
  riskRegister: [],
  troubleshootLearningMode: false,
  tsMethodology: { symptom: '', scope: '', layer: '' },
  troubleshootingMode: false,
  troubleshootPhase: 1,
  troubleshootSpec: null,
  troubleshootTopics: [],
  troubleshootExamObjectives: [],
  troubleshootDifficulty: 'medium',
  troubleshootFileTopics: [],
  troubleshootToken: null,
  troubleshootScenario: null,
  troubleshootClueText: null,
  troubleshootClueUsed: false,
  troubleshootNotes: '',
  troubleshootTicket: null,
  troubleshootTicketSubmitted: false,
  troubleshootHintLevel: 0,
  troubleshootHints: {},
  troubleshootResolved: false,
  troubleshootSessionData: null,
  extendMode: false,
  originalSpec: null,           // spec loaded from file in extend mode
  answers: {
    discovery: { useCase: null, networkType: null, vlanCapable: null, dhcpAvailable: null },
    hardware: {
      hostCount: 1,
      ipAddress: null,
      cpuCores: null, ramGB: null,
      storageDevices: [{ type: '', capacityGB: null, capacityUnit: 'GB' }],
      nicCount: null, nicSpeed: null, nicModel: null,
      additionalHosts: []
    },
    design: {
      esxiVersion: null,
      esxiDeployMethod: 'ova',
      vyosEnabled: false, vyosNetworkMode: null,
      dcProfile: 'none', dcDomainName: null, dcIpAddress: null, dcStorageDiskGB: 200, dcNetworkPlacement: 'lab',
      visIpAddress: null,
      mgmtCidr: null, mgmtVlan: null, mgmtVlanMode: 'untagged',
      vmotionCidr: null, vmotionVlan: null,
      vmCidr: null, vmVlan: null,
      vsanEnabled: false, vsanCidr: null, vsanVlan: null,
      nsxEnabled: false, nsxSize: 'small', nsxTopology: 'T0T1',
      nsxEdgeCount: 1, nsxEdgeSize: 'medium',
      nsxIpAddress: null, nsxBgpLocalAs: 65001, nsxBgpPeerAs: 65002,
      nsxBgpRouteAdvert: 'all', nsxBgpPrefixes: '',
      nsxRedistConnected: true, nsxRedistStatic: false, nsxRedistT1Lb: false,
      vcfEnabled: false,
      vcfSddcMgrIp: null, vcfSddcMgrHostname: 'sddcmgr',
      vcfVcenterIp: null,
      vcfVtepCidr: null, vcfVtepVlan: null,
      vcfEdgeUplink1Cidr: null, vcfEdgeUplink1Vlan: null,
      vcfEdgeUplink2Cidr: null, vcfEdgeUplink2Vlan: null,
      vcfEsxiPassword: '', vcfEsxiLicense: '', vcfVcenterLicense: '',
      depotEnabled: false, depotMode: 'linux', depotIpAddress: null,
      nestedHostCount: 3, vcpuPerHost: 4, vramPerHostGB: 16, nestedDiskGB: 32,
      nestedEsxiPassword: '',
      clusterName: 'mgmt-cluster', datacenterName: 'Lab-DC', ssoDomain: 'vsphere.local',
      vsanArch: 'esa',
      legacyCpuCompat: false,
      memTieringEnabled: false, nvmeSizeGB: 100, tierNvmePct: 25, nvmeTieringDiskIndex: null,
      workloadVmsEnabled: false, workloadVmCount: 3, workloadVmSize: 'small',
      nestedDisks: [],
      nestedHostPlacement: 'auto', nestedHostAssignments: [],
      deployVyosHostIdx: 0, deployDcHostIdx: 0,
      isolateLab: false, firewallPolicy: null, internetAccess: false,
      remoteAccessMethod: null, vpnType: null, vcenterSize: null,
      vyosIso: null, windowsServerIso: null, esxiIso: null, nestedEsxiOva: null, vCenterOva: null, visOva: null
    }
  },
  generated: null
};

function val(v, suffix = '') {
  return (v === null || v === undefined || v === '') ? '—' : `${v}${suffix}`;
}

// --- Inline field validation ---

const RE_IP   = /^(\d{1,3}\.){3}\d{1,3}$/;
const RE_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

// HCL compatibility patterns (mirrors lib/hclData.js)
const HCL_FLAGGED = [
  { re: /realtek|rtl\s*\d{3,4}/i,                      chipsets: 'RTL8111/8168/8125',   reason: 'No native inbox driver in ESXi 8.0+. Community drivers exist but are unsupported.' },
  { re: /intel.*(i210|i211)|\bi210\b|\bi211\b/i,        chipsets: 'Intel I210/I211',      reason: 'Removed from inbox net-igb driver in ESXi 8.0. Requires a community driver.' },
  { re: /killer|rivet\s*networks?/i,                    chipsets: 'Killer E2x00/E3x00',   reason: 'Not on the ESXi HCL — PCI vendor ID differs from Intel retail NICs.' },
  { re: /atheros|qualcomm.*qca|qca\d{4}|\bar\d{4,5}\b/i, chipsets: 'Qualcomm/Atheros',  reason: 'No ESXi driver available.' },
  { re: /marvell.*9235|88se9235/i,                      chipsets: 'Marvell 88SE9235',     reason: 'Not supported in ESXi 8.0+.' },
  { re: /jmicron|jmb\d{3}/i,                            chipsets: 'JMicron JMB36x',       reason: 'No ESXi driver available.' }
];
const HCL_GOOD = [
  { re: /intel.*(x710|xl710|x520|x540|x550|82599|82576|82574|82579|\bi350\b|\bi354\b)/i, label: 'Intel X-series / I350' },
  { re: /broadcom.*(57\d{3}|bcm57|5709|5720|578\d{2})/i, label: 'Broadcom BCM57xx' },
  { re: /mellanox|connectx[-\s]?[2-6]/i,                 label: 'Mellanox ConnectX' },
  { re: /chelsio\s*t\d/i,                                label: 'Chelsio T-series' },
  { re: /solarflare|xilinx.*sfc|sfc\d{4}/i,              label: 'Solarflare/AMD SFC' }
];

function checkNicHcl(model) {
  if (!model || !model.trim()) return null;
  for (const e of HCL_FLAGGED) { if (e.re.test(model)) return { status: 'flagged', chipsets: e.chipsets, reason: e.reason }; }
  for (const e of HCL_GOOD)    { if (e.re.test(model)) return { status: 'good', label: e.label }; }
  return { status: 'unknown' };
}

function fieldHclStatus(id, result) {
  const el = document.getElementById(id);
  if (!el) return;
  let msg = el.parentNode.querySelector('.field-hcl-msg');
  if (!msg) {
    msg = document.createElement('p');
    msg.className = 'field-hcl-msg hint';
    msg.style.marginTop = '3px';
    el.parentNode.insertBefore(msg, el.nextSibling);
  }
  if (!result) { msg.hidden = true; el.style.borderColor = ''; return; }
  if (result.status === 'flagged') {
    msg.style.color = 'var(--warn)';
    msg.textContent = `⚠ ${result.chipsets} — ${result.reason}`;
    el.style.borderColor = 'var(--warn)';
  } else if (result.status === 'good') {
    msg.style.color = 'var(--accent)';
    msg.textContent = `✓ ${result.label} — confirmed on ESXi HCL`;
    el.style.borderColor = 'var(--accent)';
  } else {
    msg.style.color = 'var(--text-dim)';
    msg.textContent = 'Not in the known-good list — verify against the VMware HCL before purchasing.';
    el.style.borderColor = '';
  }
  msg.hidden = false;
}

function fieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  let err = el.parentNode.querySelector('.field-inline-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'field-inline-error hint';
    err.style.color = 'var(--danger)';
    err.style.marginTop = '3px';
    el.parentNode.insertBefore(err, el.nextSibling);
  }
  err.textContent = msg;
  err.hidden = !msg;
  el.style.borderColor = msg ? 'var(--danger)' : '';
}

function addIpValidation(id, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('blur', () => {
    const v = el.value.trim();
    if (!v) { fieldError(id, ''); return; }
    if (!RE_IP.test(v)) { fieldError(id, `${label}: enter a valid IPv4 address (e.g. 192.168.1.10)`); return; }
    const octets = v.split('.').map(Number);
    if (octets.some((o) => o > 255)) { fieldError(id, `${label}: all octets must be 0–255`); return; }
    fieldError(id, '');
  });
  el.addEventListener('focus', () => fieldError(id, ''));
}

function addCidrValidation(id, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('blur', () => {
    const v = el.value.trim();
    if (!v) { fieldError(id, ''); return; }
    if (!RE_CIDR.test(v)) { fieldError(id, `${label}: enter CIDR notation (e.g. 192.168.10.0/24)`); return; }
    const [addr, prefix] = v.split('/');
    const octets = addr.split('.').map(Number);
    const plen   = Number(prefix);
    if (octets.some((o) => o > 255)) { fieldError(id, `${label}: all octets must be 0–255`); return; }
    if (plen < 8 || plen > 30)       { fieldError(id, `${label}: prefix length must be /8 – /30`); return; }
    fieldError(id, '');
  });
  el.addEventListener('focus', () => fieldError(id, ''));
}

function addRangeValidation(id, label, min, max) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('blur', () => {
    const v = el.value.trim();
    if (!v) { fieldError(id, ''); return; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      fieldError(id, `${label} must be ${min}–${max}`);
    } else {
      fieldError(id, '');
    }
  });
  el.addEventListener('focus', () => fieldError(id, ''));
}

function wireInlineValidation() {
  // Physical host
  addIpValidation('host1Ip',     'Physical host IP');
  addRangeValidation('cpuCores',  'CPU cores',   4,    512);
  addRangeValidation('ramGB',     'RAM',         16,   4096);
  addRangeValidation('nicCount',  'NIC count',   1,    32);

  // NIC HCL check
  const nicModelEl = document.getElementById('nicModel');
  if (nicModelEl) {
    nicModelEl.addEventListener('blur', () => {
      fieldHclStatus('nicModel', checkNicHcl(nicModelEl.value));
    });
    nicModelEl.addEventListener('focus', () => {
      const msg = nicModelEl.parentNode.querySelector('.field-hcl-msg');
      if (msg) msg.hidden = true;
      nicModelEl.style.borderColor = '';
    });
  }

  // Domain controller
  addIpValidation('dcIpAddress', 'DC IP address');
  addIpValidation('visIpAddress', 'VIS appliance IP address');

  // Networks
  ['mgmtCidr', 'vmotionCidr', 'vsanCidr', 'vmCidr'].forEach((id) => {
    addCidrValidation(id, id.replace('Cidr', '').replace(/([A-Z])/g, ' $1').trim() + ' CIDR');
  });

  // Nested cluster
  addRangeValidation('nestedHostCount', 'Nested host count', 1,   16);
  addRangeValidation('vcpuPerHost',     'vCPU per host',     2,   64);
  addRangeValidation('vramPerHostGB',   'RAM per host',      4,   2048);
  addRangeValidation('nestedDiskGB',    'Boot disk',         8,   2048);

  // NSX
  addIpValidation('nsxIpAddress', 'NSX Manager IP');

  // Depot
  addIpValidation('depotIpAddress', 'Depot IP address');

  // Memory tiering
  addRangeValidation('nvmeSizeGB',  'NVMe tier disk size', 10, 2000);
  addRangeValidation('tierNvmePct', 'Tier percentage',      1,  400);

  // Workload VMs
  addRangeValidation('workloadVmCount', 'Workload VM count', 1, 50);
}

// --- Field binding ---

function bindNumber(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    obj[key] = el.value === '' ? null : Number(el.value);
    onChange();
  });
}
function bindText(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    obj[key] = el.value.trim() === '' ? null : el.value.trim();
    onChange();
  });
}
function bindSelect(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    obj[key] = el.value === '' ? null : el.value;
    onChange();
  });
}
function bindCheckbox(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    obj[key] = el.checked;
    onChange();
  });
}
function bindRadio(name, obj, key, onChange, transform) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        obj[key] = transform ? transform(el.value) : el.value;
        onChange();
      }
    });
  });
}

// ── ESXi 9.x sizing helpers ───────────────────────────────────────────────────

function updateHostCountWarning() {
  const warn = document.getElementById('host-count-warning');
  if (warn) warn.hidden = (state.answers.hardware.hostCount || 1) <= 3;
}

function updateEsxi9Notices() {
  const notices = document.getElementById('esxi9-notices');
  if (notices) notices.hidden = !ESXI9X_VERSIONS.has(state.answers.design.esxiVersion);
}

function updateVramWarning() {
  const g = state.answers.design;
  const warn = document.getElementById('vram-min-warning');
  if (!warn) return;
  const minVram = g.esxiVersion ? (ESXI_MIN_VRAM[g.esxiVersion] || null) : null;
  if (minVram && g.vramPerHostGB > 0 && g.vramPerHostGB < minVram) {
    warn.hidden = false;
    warn.textContent = `Below minimum recommended for ESXi ${ESXI_VERSION_LABELS[g.esxiVersion] || g.esxiVersion} — ${minVram} GB vRAM per host is the minimum. Nested hosts may be unstable or fail to boot.`;
  } else {
    warn.hidden = true;
  }
}

// Hardware step "validator": shows what's achievable at the entered RAM,
// a live RAM budget breakdown, and a warning if the current (or a
// representative example) deployment exceeds the physical RAM. Called on
// RAM/CPU input on the Hardware step, from the shared onChange closure (so
// it stays live as later-step choices like nestedHostCount/nsxEnabled
// change), and once on step-0 entry.
function renderHardwareValidator() {
  const h = state.answers.hardware;
  const g = state.answers.design;
  const panel = document.getElementById('hardware-validator');
  if (!panel) return;
  const physRam = Number(h.ramGB) || 0;
  if (!physRam) { panel.hidden = true; return; }
  panel.hidden = false;

  // Achievable tier: highest threshold at or below the entered RAM.
  let achieved = null, next = null;
  for (const tier of RAM_TIERS) {
    if (physRam >= tier.ramGB) achieved = tier;
    else { next = tier; break; }
  }

  const tierEl = document.getElementById('hw-validator-tier');
  if (tierEl) {
    let html;
    if (achieved) {
      html = `<strong>${physRam} GB</strong> gets you: <strong>${escHtml(achieved.label)}</strong>` +
        (achieved.detail ? ` (${escHtml(achieved.detail)})` : '');
      if (next) {
        html += `<br><span class="hw-validator-next">+${next.ramGB - physRam} GB more (${next.ramGB} GB total) unlocks ${escHtml(next.label)}${next.detail ? ' — ' + escHtml(next.detail) : ''}.</span>`;
      }
    } else {
      const first = RAM_TIERS[0];
      html = `<strong>${physRam} GB</strong> is below the ${first.ramGB} GB minimum for a vSphere lab. ` +
        `Add ${first.ramGB - physRam} GB more to reach "${escHtml(first.label)}" (${escHtml(first.detail)}).`;
    }
    tierEl.innerHTML = html;
  }

  // RAM math breakdown — nestedHostCount/vramPerHostGB carry real defaults
  // (3 hosts / 16 GB) from state init, not null, so this always reflects the
  // wizard's current nested-cluster plan (defaults included) rather than a
  // separate guess — same numbers the Nested cluster step itself would show.
  const hosts = Number(g.nestedHostCount) || 1;
  const perHost = Number(g.vramPerHostGB) || (ESXI_MIN_VRAM[g.esxiVersion] || 8);
  const nestedTotal = hosts * perHost;
  const overhead = hosts * ESXI_OVERHEAD_GB;
  const dcRam = DC_RAM_GB_BY_PROFILE[g.dcProfile] || 0;
  const vyosRam = g.vyosEnabled ? VYOS_RAM_GB_SIZING : 0;
  const nsxRam = g.nsxEnabled ? 12 : 0; // small edge size — matches sizing.js NSX_SMALL_VRAM_GB
  const fixedTotal = VCENTER_TINY_RAM_GB + dcRam + vyosRam + nsxRam + overhead;
  const grandTotal = nestedTotal + fixedTotal;
  const remaining = physRam - grandTotal;

  const breakdown = document.getElementById('hw-validator-breakdown');
  if (breakdown) {
    const rows = [
      [`${hosts} nested ESXi host${hosts === 1 ? '' : 's'} × ${perHost} GB`, nestedTotal],
      [`ESXi overhead (${ESXI_OVERHEAD_GB} GB × ${hosts} host${hosts === 1 ? '' : 's'})`, overhead],
      ['vCenter Server Appliance (Tiny)', VCENTER_TINY_RAM_GB]
    ];
    if (vyosRam) rows.push(['VyOS virtual router', vyosRam]);
    if (dcRam) rows.push(['Domain controller' + (g.dcProfile && g.dcProfile !== 'dc-only' ? ' + jumpbox' : ''), dcRam]);
    if (nsxRam) rows.push(['NSX Manager (small)', nsxRam]);

    const cpuCores = Number(h.cpuCores) || 0;
    const assumedVcpu = Number(g.vcpuPerHost) || 4;
    const maxHostsByCpu = cpuCores ? Math.floor((cpuCores * 4) / assumedVcpu) : null;

    breakdown.innerHTML = `
      <p class="hint">Based on the nested cluster's current settings (${hosts} host${hosts === 1 ? '' : 's'} × ${perHost} GB — defaults until you change them on the Nested cluster step):</p>
      <table class="hw-validator-table">
        ${rows.map(([label, val]) => `<tr><td>${escHtml(label)}</td><td>${val} GB</td></tr>`).join('')}
        <tr class="hw-validator-total"><td>Total needed</td><td>${grandTotal} GB</td></tr>
        <tr class="hw-validator-total"><td>Physical RAM</td><td>${physRam} GB</td></tr>
      </table>
      ${maxHostsByCpu !== null ? `<p class="hint">CPU: ${cpuCores} cores supports up to ~${maxHostsByCpu} nested hosts at ${assumedVcpu} vCPU each before oversubscription gets uncomfortable (4:1 ratio).</p>` : ''}
    `;
  }

  const warnEl = document.getElementById('hw-validator-warning');
  if (warnEl) {
    if (remaining < 0) {
      warnEl.hidden = false;
      warnEl.textContent = `The current nested cluster plan needs ${grandTotal} GB but you only have ${physRam} GB — over by ${Math.abs(remaining)} GB. ` +
        `Reduce nested host count or RAM per host on the Nested cluster step, or add more physical RAM.`;
    } else {
      warnEl.hidden = true;
    }
  }
}

function calcHostTiers(physRamGB, esxiVer) {
  const g = state.answers.design;
  const perHostMin = ESXI_MIN_VRAM[esxiVer] || 8;
  const fixedRam = ESXI_OVERHEAD_GB + VCENTER_TINY_RAM_GB
    + (DC_RAM_GB_BY_PROFILE[g.dcProfile] || 0)
    + (g.vyosEnabled ? VYOS_RAM_GB_SIZING : 0);
  const available = Math.max(0, physRamGB - fixedRam);
  const maxHosts = Math.min(Math.floor(available / perHostMin), 12);
  return {
    perHostMin, fixedRam, available, maxHosts,
    tiers: [
      { id: 'minimal',  hosts: 1,        vsanCapable: false,         ramNeeded: fixedRam + perHostMin,           feasible: physRamGB >= fixedRam + perHostMin },
      { id: 'standard', hosts: 3,        vsanCapable: true,          ramNeeded: fixedRam + 3 * perHostMin,       feasible: physRamGB >= fixedRam + 3 * perHostMin },
      { id: 'maximum',  hosts: maxHosts, vsanCapable: maxHosts >= 3, ramNeeded: fixedRam + maxHosts * perHostMin, feasible: maxHosts >= 1 }
    ]
  };
}

function renderSizingRecommendations() {
  const g = state.answers.design;
  const h = state.answers.hardware;
  const panel = document.getElementById('sizing-recommendations');
  if (!panel) return;

  const physRam = h.ramGB;
  const esxiVer = g.esxiVersion;
  const show = physRam && esxiVer && ESXI9X_VERSIONS.has(esxiVer);
  panel.hidden = !show;
  if (!show) return;

  const t = calcHostTiers(physRam, esxiVer);
  const tierLabels = [
    'Minimal — 1 host, learn vSphere basics',
    'Standard — 3 hosts, enables vSAN',
    `Maximum — ${t.maxHosts} host${t.maxHosts !== 1 ? 's' : ''} on your hardware`
  ];

  const grid = document.getElementById('sizing-tier-grid');
  grid.innerHTML = '';

  t.tiers.forEach((tier, i) => {
    const card = document.createElement('div');
    const isSelected = Number(g.nestedHostCount) === tier.hosts && tier.feasible;
    card.className = 'sizing-tier-card' + (isSelected ? ' selected' : '') + (tier.feasible ? '' : ' infeasible');

    const hostNum = document.createElement('div');
    hostNum.className = 'tier-host-count';
    hostNum.textContent = tier.feasible ? tier.hosts : '—';

    const label = document.createElement('div');
    label.className = 'tier-label';
    label.textContent = tierLabels[i];

    const ramLine = document.createElement('div');
    ramLine.className = 'tier-ram-line';
    ramLine.textContent = tier.feasible
      ? `Needs ${tier.ramNeeded} GB of ${physRam} GB`
      : `Needs ${tier.ramNeeded} GB — you have ${physRam} GB`;

    card.append(hostNum, label, ramLine);

    if (tier.vsanCapable && tier.feasible) {
      const badge = document.createElement('div');
      badge.className = 'tier-vsan-badge';
      badge.textContent = 'vSAN capable';
      card.appendChild(badge);
    }

    if (!tier.feasible) {
      const note = document.createElement('div');
      note.className = 'tier-infeasible-note';
      note.textContent = `Need ${tier.ramNeeded - physRam} GB more RAM`;
      card.appendChild(note);
    }

    if (tier.feasible) {
      card.addEventListener('click', () => {
        g.nestedHostCount = tier.hosts;
        g.vcpuPerHost = Math.max(g.vcpuPerHost || 0, 4);
        g.vramPerHostGB = Math.max(g.vramPerHostGB || 0, tier.perHostMin);
        const hostEl = document.getElementById('nestedHostCount');
        const vcpuEl = document.getElementById('vcpuPerHost');
        const vramEl = document.getElementById('vramPerHostGB');
        if (hostEl) hostEl.value = tier.hosts;
        if (vcpuEl) vcpuEl.value = g.vcpuPerHost;
        if (vramEl) vramEl.value = g.vramPerHostGB;
        renderSizingRecommendations();
        renderResourceTips();
        updateVramWarning();
      });
    }

    grid.appendChild(card);
  });
}

function renderResourceTips() {
  const g = state.answers.design;
  const h = state.answers.hardware;
  const panel  = document.getElementById('resource-tips-panel');
  const list   = document.getElementById('resource-tips-list');
  const sub    = document.getElementById('resource-tips-subtitle');
  if (!panel || !list) return;

  const physRam = h.ramGB || 0;
  const esxiVer = g.esxiVersion;
  if (!physRam || !ESXI9X_VERSIONS.has(esxiVer)) { panel.hidden = true; return; }

  const t = calcHostTiers(physRam, esxiVer);
  const standardNeed = t.tiers[1].ramNeeded;
  if (physRam >= standardNeed + 16) { panel.hidden = true; return; }

  panel.hidden = false;
  if (sub) sub.textContent = `— ${physRam} GB available, ${standardNeed} GB needed for 3-host setup`;

  const tips = [];

  if (g.esxiDeployMethod !== 'ova') {
    tips.push({ saving: 'time', text: "Use William Lam's nested ESXi OVA — pre-built appliance, automated deployment, no manual ISO install." });
  }

  tips.push({ saving: '7 GB', text: 'Use vCenter Tiny deployment size (2 vCPU, 14 GB) instead of Small (4 vCPU, 21 GB) — fully adequate for a lab with fewer than 10 hosts.' });

  if (g.dcProfile === 'dc-jumpbox' || g.dcProfile === 'dc-jumpbox-fileserver') {
    tips.push({ saving: '4 GB', text: 'If you only need DNS/AD (no RDP jumpbox), switch the DC to "DC only" — saves 4 GB RAM by dropping from 8 GB to 4 GB.' });
  }

  tips.push({ saving: 'overhead', text: 'Disable memory reservation on nested ESXi VMs and rely on the memory balloon driver — lets the physical host reclaim idle guest RAM.' });

  if (g.workloadVmsEnabled) {
    tips.push({ saving: `${(g.workloadVmCount || 3) * 4}+ GB`, text: 'Defer workload VMs until the base cluster is healthy. Each small VM adds 4+ GB; deploy after vSAN health checks pass.' });
  }

  const hasNvme = (h.storageDevices || []).some((d) => d.type === 'nvme');
  if (hasNvme && !g.memTieringEnabled) {
    tips.push({ saving: 'up to 2×', text: 'Enable NVMe memory tiering (ESXi 9.1) — extends effective RAM using NVMe as a memory tier. Set <code>sched.mem.enableNestedTiering = true</code> on each nested host before first power-on.' });
  }

  list.innerHTML = '';
  tips.forEach((tip) => {
    const item = document.createElement('div');
    item.className = 'resource-tip-item';
    const badge = document.createElement('span');
    badge.className = 'resource-tip-saving';
    badge.textContent = tip.saving;
    const text = document.createElement('span');
    text.className = 'resource-tip-text';
    setRichText(text, tip.text);
    item.append(badge, text);
    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

// Depot section (inside the Nested cluster step) is only relevant when vSAN is
// enabled AND a local_datastore disk is configured.
function depotStepVisible() {
  const g = state.answers.design;
  const hasLocalDs = (g.nestedDisks || []).some((d) => d.purpose === 'local_datastore');
  return !!g.vsanEnabled && hasLocalDs;
}

// Toggles the depot subsection's visibility live, since vsanEnabled and
// nestedDisks now both live on the same step (Nested cluster) as the depot
// section itself, unlike the old separate-page arrangement.
function updateDepotVisibility() {
  const el = document.getElementById('nested-cluster-depot-section');
  if (el) el.hidden = !depotStepVisible();
}

function placementStepVisible() {
  return (Number(state.answers.hardware.hostCount) || 1) > 1;
}

let _onFormChange = () => {};

function wireForm() {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;
  const onChange = () => {
    renderTopology();
    updateWorkloadNote();
    updateDcNotice();
    updateEsxi9Notices();
    renderSizingRecommendations();
    renderResourceTips();
    updateVramWarning();
    renderHardwareValidator();
    renderInfraPlacement(onChange);
    renderPlacementRamSummary();
    updateDepotVisibility();
    autoSave();
  };
  _onFormChange = onChange;

  bindRadio('useCase', d, 'useCase', onChange);

  bindText('host1Ip', h, 'ipAddress', onChange);
  document.getElementById('hostCount').addEventListener('input', () => {
    h.hostCount = Number(document.getElementById('hostCount').value) || 1;
    updateHostCountWarning();
    syncAdditionalHosts();
    renderAdditionalHosts(onChange);
    renderPlacementRows(onChange);
    onChange();
  });
  // initial render for multi-host sections
  syncAdditionalHosts();
  renderAdditionalHosts(onChange);

  bindNumber('cpuCores', h, 'cpuCores', onChange);
  bindNumber('ramGB', h, 'ramGB', onChange);

  // --- Storage device list ---
  renderStorageDevices(onChange);
  document.getElementById('add-storage-device').addEventListener('click', () => {
    h.storageDevices.push({ type: '', capacityGB: null, capacityUnit: 'GB' });
    renderStorageDevices(onChange);
    onChange();
  });

  bindNumber('nicCount', h, 'nicCount', onChange);
  bindSelect('nicSpeed', h, 'nicSpeed', onChange);
  bindText('nicModel', h, 'nicModel', onChange);

  document.getElementById('esxiVersion').addEventListener('change', (e) => {
    g.esxiVersion = e.target.value || null;
    if (g.esxiVersion && ESXI9X_VERSIONS.has(g.esxiVersion)) {
      const minVram = ESXI_MIN_VRAM[g.esxiVersion] || 8;
      if ((g.vramPerHostGB || 0) < minVram) {
        g.vramPerHostGB = minVram;
        const vramEl = document.getElementById('vramPerHostGB');
        if (vramEl) vramEl.value = minVram;
      }
      if ((g.vcpuPerHost || 0) < 4) {
        g.vcpuPerHost = 4;
        const vcpuEl = document.getElementById('vcpuPerHost');
        if (vcpuEl) vcpuEl.value = 4;
      }
    }
    onChange();
  });

  // OVA vs ISO deploy method
  document.querySelectorAll('input[name="esxiDeployMethod"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.esxiDeployMethod = el.value;
        document.getElementById('esxi-ova-hint').hidden = el.value !== 'ova';
        document.getElementById('esxi-iso-hint').hidden = el.value !== 'iso';
        onChange();
      }
    });
  });

  // VyOS
  const vyosCheckbox = document.getElementById('vyosEnabled');
  vyosCheckbox.addEventListener('change', () => {
    g.vyosEnabled = vyosCheckbox.checked;
    document.getElementById('vyos-mode-field').hidden = !g.vyosEnabled;
    onChange();
  });
  bindRadio('vyosNetworkMode', g, 'vyosNetworkMode', onChange);

  // DC profile cards
  document.querySelectorAll('input[name="dcProfile"]').forEach(radio => {
    radio.addEventListener('change', () => {
      g.dcProfile = radio.value;
      const dcEnabled = g.dcProfile !== 'none' && g.dcProfile !== 'vis';
      document.getElementById('dc-fields').hidden = !dcEnabled;
      const visFields = document.getElementById('vis-fields');
      if (visFields) visFields.hidden = g.dcProfile !== 'vis';
      const storageDiskField = document.getElementById('dc-storage-disk-field');
      if (storageDiskField) storageDiskField.hidden = g.dcProfile !== 'dc-jumpbox-fileserver';
      onChange();
    });
  });
  const dcStorageDiskEl = document.getElementById('dcStorageDiskGB');
  if (dcStorageDiskEl) dcStorageDiskEl.addEventListener('input', () => {
    g.dcStorageDiskGB = Number(dcStorageDiskEl.value) || 200;
    onChange();
  });
  bindText('dcDomainName', g, 'dcDomainName', () => { checkSsoCollision(); onChange(); });
  bindText('dcIpAddress', g, 'dcIpAddress', onChange);
  bindRadio('dcNetworkPlacement', g, 'dcNetworkPlacement', onChange);
  bindText('visIpAddress', g, 'visIpAddress', onChange);
  bindText('visOvaPath', g, 'visOva', onChange);

  bindRadio('networkType', d, 'networkType', onChange);
  bindRadio('vlanCapable', d, 'vlanCapable', onChange, (v) => (v === 'yes' ? true : v === 'no' ? false : null));
  bindRadio('dhcpAvailable', d, 'dhcpAvailable', onChange, (v) => v === 'yes');

  bindText('mgmtCidr', g, 'mgmtCidr', onChange);

  // VLAN mode radio — toggles VLAN ID field visibility
  document.querySelectorAll('input[name="mgmtVlanMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.mgmtVlanMode = el.value;
        const tagged = el.value === 'tagged';
        document.getElementById('mgmt-vlan-id-field').hidden = !tagged;
        document.getElementById('mgmt-vlan-hint-untagged').hidden = tagged;
        document.getElementById('mgmt-vlan-hint-tagged').hidden = !tagged;
        if (!tagged) g.mgmtVlan = null;
        onChange();
      }
    });
  });
  bindNumber('mgmtVlan', g, 'mgmtVlan', onChange);
  bindText('vmotionCidr', g, 'vmotionCidr', onChange);
  bindNumber('vmotionVlan', g, 'vmotionVlan', onChange);
  bindText('vmCidr', g, 'vmCidr', onChange);
  bindNumber('vmVlan', g, 'vmVlan', onChange);
  bindText('vsanCidr', g, 'vsanCidr', onChange);
  bindNumber('vsanVlan', g, 'vsanVlan', onChange);

  bindNumber('nestedHostCount', g, 'nestedHostCount', onChange);
  bindNumber('vcpuPerHost', g, 'vcpuPerHost', onChange);
  bindNumber('vramPerHostGB', g, 'vramPerHostGB', onChange);
  bindNumber('nestedDiskGB', g, 'nestedDiskGB', onChange);

  document.getElementById('vsanEnabled').addEventListener('change', (e) => {
    g.vsanEnabled = e.target.checked;
    document.getElementById('vsan-network-row').hidden = !g.vsanEnabled;
    document.getElementById('vsan-network-hint').hidden = !g.vsanEnabled;
    document.getElementById('vsan-arch-field').hidden = !g.vsanEnabled;
    onChange();
    updateDepotVisibility();
    if (state.architectMode && e.target.checked) {
      showOptionsAnalysis('storage');
    }
  });
  bindRadio('vsanArch', g, 'vsanArch', () => {
    const esa = g.vsanArch !== 'osa';
    document.getElementById('vsan-esa-hint').hidden = !esa;
    document.getElementById('vsan-osa-hint').hidden = esa;
    // Migrate existing disk purposes to match the new architecture
    (g.nestedDisks || []).forEach((disk) => {
      if (esa) {
        if (disk.purpose === 'vsan_capacity') disk.purpose = 'vsan_storage_pool';
        else if (disk.purpose === 'vsan_cache') disk.purpose = '';
      } else {
        if (disk.purpose === 'vsan_storage_pool') disk.purpose = 'vsan_capacity';
      }
    });
    renderNestedDisks(onChange);
    onChange();
  });

  bindText('nestedEsxiPassword', g, 'nestedEsxiPassword', onChange);
  bindText('clusterName', g, 'clusterName', onChange);

  function checkSsoCollision() {
    const sso = (g.ssoDomain || '').toLowerCase().trim();
    const ad = (g.dcDomainName || '').toLowerCase().trim();
    const collides = ad.length > 0 && (
      sso === ad || sso.endsWith('.' + ad) || ad.endsWith('.' + sso)
    );
    document.getElementById('sso-collision-warning').hidden = !collides;
  }
  const ssoDomainEl = document.getElementById('ssoDomain');
  ssoDomainEl.addEventListener('input', () => {
    g.ssoDomain = ssoDomainEl.value.trim() || 'vsphere.local';
    checkSsoCollision();
    onChange();
  });

  // host count → VCF headroom note
  document.getElementById('nestedHostCount').addEventListener('input', () => {
    const note = document.getElementById('host-count-vcf-note');
    if (note) note.hidden = (g.nestedHostCount || 0) >= 3;
    renderPlacementRows(onChange);
  });

  // Nested host placement (Nested cluster step, shown when physCount > 1)
  document.querySelectorAll('input[name="nestedHostPlacement"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.nestedHostPlacement = el.value;
        renderPlacementRows(onChange);
        onChange();
      }
    });
  });
  renderPlacementRows(onChange);

  bindCheckbox('legacyCpuCompat', g, 'legacyCpuCompat', onChange);

  // Memory tiering (Nested cluster step)
  document.getElementById('memTieringEnabled').addEventListener('change', (e) => {
    g.memTieringEnabled = e.target.checked;
    document.getElementById('mem-tiering-fields').hidden = !g.memTieringEnabled;
    if (g.memTieringEnabled) renderNvmeDiskPicker(onChange);
    onChange();
  });
  bindNumber('nvmeSizeGB',  g, 'nvmeSizeGB',  onChange);
  bindNumber('tierNvmePct', g, 'tierNvmePct', onChange);

  // NSX step (NSX-T, step 7)
  const nsxCheckbox = document.getElementById('nsxEnabled');
  if (nsxCheckbox) {
    nsxCheckbox.addEventListener('change', () => {
      g.nsxEnabled = nsxCheckbox.checked;
      document.getElementById('nsx-fields').hidden = !g.nsxEnabled;
      updateNsxBgpVisibility();
      onChange();
    });
  }
  bindRadio('nsxSize', g, 'nsxSize', onChange);
  bindRadio('nsxTopology', g, 'nsxTopology', onChange);
  bindRadio('nsxEdgeCount', g, 'nsxEdgeCount', onChange, Number);
  bindSelect('nsxEdgeSize', g, 'nsxEdgeSize', onChange);
  bindText('nsxIpAddress', g, 'nsxIpAddress', onChange);
  bindNumber('nsxBgpLocalAs', g, 'nsxBgpLocalAs', onChange);
  bindNumber('nsxBgpPeerAs', g, 'nsxBgpPeerAs', onChange);
  bindRadio('nsxBgpRouteAdvert', g, 'nsxBgpRouteAdvert', onChange);
  bindCheckbox('nsxRedistConnected', g, 'nsxRedistConnected', onChange);
  bindCheckbox('nsxRedistStatic', g, 'nsxRedistStatic', onChange);
  bindCheckbox('nsxRedistT1Lb', g, 'nsxRedistT1Lb', onChange);

  const nsxBgpPrefixesEl = document.getElementById('nsxBgpPrefixes');
  if (nsxBgpPrefixesEl) {
    nsxBgpPrefixesEl.addEventListener('input', () => {
      g.nsxBgpPrefixes = nsxBgpPrefixesEl.value;
      onChange();
    });
  }
  document.querySelectorAll('input[name="nsxBgpRouteAdvert"]').forEach((el) => {
    el.addEventListener('change', () => {
      const prefixFields = document.getElementById('nsx-bgp-prefix-fields');
      if (prefixFields) prefixFields.hidden = (el.value !== 'specific' || !el.checked);
    });
  });

  function updateNsxBgpVisibility() {
    const bgpSection = document.getElementById('nsx-bgp-section');
    if (!bgpSection) return;
    const show = g.nsxEnabled && g.vyosEnabled && g.vyosNetworkMode === 'bgp';
    bgpSection.hidden = !show;
  }
  // Re-run when VyOS BGP changes
  const origVyosHandler = () => { updateNsxBgpVisibility(); };
  document.querySelectorAll('input[name="vyosNetworkMode"]').forEach((el) => {
    el.addEventListener('change', origVyosHandler);
  });
  document.getElementById('vyosEnabled').addEventListener('change', origVyosHandler);

  // VCF step (merged into Nested cluster, step 6)
  const vcfCheckbox = document.getElementById('vcfEnabled');
  if (vcfCheckbox) {
    vcfCheckbox.addEventListener('change', () => {
      g.vcfEnabled = vcfCheckbox.checked;
      const vcfFields = document.getElementById('vcf-fields');
      if (vcfFields) vcfFields.hidden = !g.vcfEnabled;
      onChange();
    });
  }
  bindText('vcfSddcMgrIp',       g, 'vcfSddcMgrIp',       onChange);
  bindText('vcfSddcMgrHostname', g, 'vcfSddcMgrHostname', onChange);
  bindText('vcfVcenterIp',       g, 'vcfVcenterIp',       onChange);
  bindText('vcfVtepCidr',        g, 'vcfVtepCidr',        onChange);
  bindNumber('vcfVtepVlan',      g, 'vcfVtepVlan',        onChange);
  bindText('vcfEdgeUplink1Cidr', g, 'vcfEdgeUplink1Cidr', onChange);
  bindNumber('vcfEdgeUplink1Vlan', g, 'vcfEdgeUplink1Vlan', onChange);
  bindText('vcfEdgeUplink2Cidr', g, 'vcfEdgeUplink2Cidr', onChange);
  bindNumber('vcfEdgeUplink2Vlan', g, 'vcfEdgeUplink2Vlan', onChange);
  bindText('vcfEsxiPassword',    g, 'vcfEsxiPassword',    onChange);
  bindText('vcfEsxiLicense',     g, 'vcfEsxiLicense',     onChange);
  bindText('vcfVcenterLicense',  g, 'vcfVcenterLicense',  onChange);

  // Spec versioning — "Extend existing lab" file picker
  const extendRadios = document.querySelectorAll('input[name="labMode"]');
  const specFileField = document.getElementById('spec-file-field');
  const specFileInput = document.getElementById('spec-file-input');
  if (extendRadios.length && specFileField && specFileInput) {
    extendRadios.forEach((el) => {
      el.addEventListener('change', () => {
        state.extendMode = el.value === 'extend';
        document.getElementById('extend-mode-indicator').hidden = !state.extendMode;
        specFileField.hidden = !state.extendMode;
        if (!state.extendMode) {
          state.originalSpec = null;
          state.answers.extendMode = false;
        }
        onChange();
      });
    });
    specFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById('spec-load-status');
      if (file.size > 512 * 1024) {
        statusEl.textContent = 'File too large — spec.json must be under 512 KB.';
        statusEl.className = 'spec-load-error';
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const spec = JSON.parse(ev.target.result);
          if (!isValidSpecStructure(spec)) {
            statusEl.textContent = 'Not a valid lab spec file.';
            statusEl.className = 'spec-load-error';
            return;
          }
          state.originalSpec = spec;
          state.answers.extendMode = true;
          loadSpecIntoState(spec);
          statusEl.textContent = `Loaded: ${file.name}`;
          statusEl.className = 'spec-load-ok';
        } catch {
          statusEl.textContent = 'Invalid JSON — could not load spec.';
          statusEl.className = 'spec-load-error';
        }
      };
      reader.readAsText(file);
    });
  }

  // Nested disk list (merged into Nested cluster, step 6)
  renderNestedDisks(onChange);
  document.getElementById('add-nested-disk').addEventListener('click', () => {
    g.nestedDisks.push({ sizeGB: null, purpose: '' });
    renderNestedDisks(onChange);
    onChange();
  });

  // Workload VMs (step 10)
  const wlCheckbox = document.getElementById('workloadVmsEnabled');
  wlCheckbox.addEventListener('change', () => {
    g.workloadVmsEnabled = wlCheckbox.checked;
    document.getElementById('workload-fields').hidden = !g.workloadVmsEnabled;
    onChange();
  });
  bindNumber('workloadVmCount', g, 'workloadVmCount', onChange);
  bindRadio('workloadVmSize', g, 'workloadVmSize', onChange);

  bindCheckbox('isolateLab', g, 'isolateLab', onChange);
  bindRadio('firewallPolicy', g, 'firewallPolicy', onChange);
  bindCheckbox('internetAccess', g, 'internetAccess', onChange);
  const remoteMethodEl = document.getElementById('remoteAccessMethod');
  const vpnTypeField = document.getElementById('vpn-type-field');
  remoteMethodEl.addEventListener('change', () => {
    g.remoteAccessMethod = remoteMethodEl.value || null;
    const isVpn = g.remoteAccessMethod === 'vpn';
    vpnTypeField.hidden = !isVpn;
    if (!isVpn) {
      g.vpnType = null;
      vpnTypeField.querySelectorAll('input[type=radio]').forEach((r) => { r.checked = false; });
    }
    onChange();
  });
  bindRadio('vpnType', g, 'vpnType', onChange);
  bindSelect('vcenterSize', g, 'vcenterSize', onChange);

  // Software library / file locations (merged into Hardware, step 0) — written into lab-config.json at generate time
  bindText('vyosIsoPath', g, 'vyosIso', onChange);
  bindText('windowsServerIsoPath', g, 'windowsServerIso', onChange);
  bindText('esxiIsoPath', g, 'esxiIso', onChange);
  bindText('nestedEsxiOvaPath', g, 'nestedEsxiOva', onChange);
  bindText('vCenterOvaPath', g, 'vCenterOva', onChange);

  // Bundle depot (merged into Nested cluster, step 6)
  const depotCheckbox = document.getElementById('depotEnabled');
  depotCheckbox.addEventListener('change', () => {
    g.depotEnabled = depotCheckbox.checked;
    document.getElementById('depot-fields').hidden = !g.depotEnabled;
    onChange();
  });
  document.querySelectorAll('input[name="depotMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.depotMode = el.value;
        const isIis = el.value === 'iis';
        document.getElementById('depot-linux-hint').hidden = isIis;
        document.getElementById('depot-iis-hint').hidden = !isIis;
        document.getElementById('depot-iis-no-dc-warning').hidden = !(isIis && (g.dcProfile === 'none' || g.dcProfile === 'vis'));
        onChange();
      }
    });
  });
  bindText('depotIpAddress', g, 'depotIpAddress', onChange);
}

function renderStorageDevices(onChange) {
  const h = state.answers.hardware;
  const devices = h.storageDevices;
  const listEl = document.getElementById('storage-device-list');
  listEl.innerHTML = '';

  if (devices.length > 0) {
    const header = document.createElement('div');
    header.className = 'storage-device-list-header';
    ['Type', 'Size', 'Unit', ''].forEach((label) => {
      const s = document.createElement('span');
      s.textContent = label;
      header.appendChild(s);
    });
    listEl.appendChild(header);
  }

  devices.forEach((dev, idx) => {
    const entry = document.createElement('div');
    entry.className = 'storage-device-entry';

    const typeSelect = document.createElement('select');
    [['', 'Type…'], ['nvme', 'NVMe'], ['sata_ssd', 'SATA SSD'], ['sas_ssd', 'SAS SSD'], ['spinning_disk', 'Spinning disk']]
      .forEach(([v, label]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = label; o.selected = dev.type === v;
        typeSelect.appendChild(o);
      });
    typeSelect.addEventListener('change', () => { devices[idx].type = typeSelect.value || ''; if (onChange) onChange(); });

    const capacityInput = document.createElement('input');
    capacityInput.type = 'number'; capacityInput.min = '1'; capacityInput.placeholder = 'e.g. 2';
    if (dev.capacityGB) capacityInput.value = dev.capacityGB;
    capacityInput.addEventListener('input', () => { devices[idx].capacityGB = Number(capacityInput.value) || null; if (onChange) onChange(); });

    const unitSelect = document.createElement('select');
    [['GB', 'GB'], ['TB', 'TB']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label; o.selected = (dev.capacityUnit || 'GB') === v;
      unitSelect.appendChild(o);
    });
    unitSelect.addEventListener('change', () => { devices[idx].capacityUnit = unitSelect.value; if (onChange) onChange(); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn-remove'; removeBtn.textContent = '×';
    removeBtn.title = 'Remove this device'; removeBtn.disabled = devices.length <= 1;
    removeBtn.addEventListener('click', () => {
      if (devices.length > 1) {
        devices.splice(idx, 1);
        renderStorageDevices(onChange);
        if (onChange) onChange();
      }
    });

    entry.append(typeSelect, capacityInput, unitSelect, removeBtn);
    listEl.appendChild(entry);
  });

  // Keep the memory-tiering disk picker in sync when the hardware list changes
  if (state.answers.design.memTieringEnabled) renderNvmeDiskPicker(onChange);
}

function syncAdditionalHosts() {
  const h = state.answers.hardware;
  const count = Number(h.hostCount) || 1;
  const target = Math.max(0, count - 1);
  while (h.additionalHosts.length < target) {
    h.additionalHosts.push({
      ipAddress: null, sameAsFirst: true,
      cpuCores: null, ramGB: null,
      storageDevices: [{ type: '', capacityGB: null, capacityUnit: 'GB' }],
      nicCount: null, nicSpeed: null
    });
  }
  h.additionalHosts.length = target;
}

function renderAdditionalHosts(onChange) {
  const h = state.answers.hardware;
  const section = document.getElementById('additional-hosts-section');
  const list = document.getElementById('additional-hosts-list');
  if (!section || !list) return;

  const count = Number(h.hostCount) || 1;
  section.hidden = count < 2;
  if (count < 2) return;

  list.innerHTML = '';
  h.additionalHosts.forEach((host, idx) => {
    const hostNum = idx + 2;
    const block = document.createElement('div');
    block.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:14px;';

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';
    const title = document.createElement('strong');
    title.style.cssText = 'font-size:13px;color:var(--text);';
    title.textContent = `Physical host ${hostNum}`;
    titleRow.appendChild(title);
    block.appendChild(titleRow);

    // IP address
    const ipRow = document.createElement('div');
    ipRow.style.cssText = 'margin-bottom:10px;';
    const ipLabel = document.createElement('label');
    ipLabel.textContent = `Host ${hostNum} management IP`;
    ipLabel.style.cssText = 'display:block;font-size:12px;margin-bottom:4px;color:var(--text-muted);';
    const ipInput = document.createElement('input');
    ipInput.type = 'text'; ipInput.placeholder = 'e.g. 192.168.1.11';
    ipInput.style.cssText = 'width:220px;';
    if (host.ipAddress) ipInput.value = host.ipAddress;
    ipInput.addEventListener('input', () => {
      h.additionalHosts[idx].ipAddress = ipInput.value.trim() || null;
      onChange();
    });
    ipRow.append(ipLabel, ipInput);
    block.appendChild(ipRow);

    // Same specs checkbox
    const sameRow = document.createElement('label');
    sameRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);cursor:pointer;';
    const sameCheck = document.createElement('input');
    sameCheck.type = 'checkbox'; sameCheck.checked = host.sameAsFirst !== false;
    const sameLabel = document.createElement('span');
    sameLabel.textContent = 'Same CPU, RAM, storage, and NIC specs as host 1';
    sameRow.append(sameCheck, sameLabel);
    block.appendChild(sameRow);

    // Extra specs section (hidden unless sameAsFirst = false)
    const extraSpecs = document.createElement('div');
    extraSpecs.hidden = host.sameAsFirst !== false;
    extraSpecs.style.cssText = 'margin-top:12px;';

    const extraCpuRam = document.createElement('div');
    extraCpuRam.style.cssText = 'display:flex;gap:12px;margin-bottom:10px;';

    const cpuF = document.createElement('div');
    const cpuL = document.createElement('label');
    cpuL.textContent = 'CPU cores'; cpuL.style.cssText = 'display:block;font-size:12px;margin-bottom:3px;color:var(--text-muted);';
    const cpuI = document.createElement('input');
    cpuI.type = 'number'; cpuI.min = '1'; cpuI.placeholder = 'e.g. 36'; cpuI.style.width = '100px';
    if (host.cpuCores) cpuI.value = host.cpuCores;
    cpuI.addEventListener('input', () => { h.additionalHosts[idx].cpuCores = Number(cpuI.value) || null; onChange(); });
    cpuF.append(cpuL, cpuI);

    const ramF = document.createElement('div');
    const ramL = document.createElement('label');
    ramL.textContent = 'RAM (GB)'; ramL.style.cssText = 'display:block;font-size:12px;margin-bottom:3px;color:var(--text-muted);';
    const ramI = document.createElement('input');
    ramI.type = 'number'; ramI.min = '1'; ramI.placeholder = 'e.g. 256'; ramI.style.width = '100px';
    if (host.ramGB) ramI.value = host.ramGB;
    ramI.addEventListener('input', () => { h.additionalHosts[idx].ramGB = Number(ramI.value) || null; onChange(); });
    ramF.append(ramL, ramI);

    extraCpuRam.append(cpuF, ramF);
    extraSpecs.appendChild(extraCpuRam);

    sameCheck.addEventListener('change', () => {
      h.additionalHosts[idx].sameAsFirst = sameCheck.checked;
      extraSpecs.hidden = sameCheck.checked;
      onChange();
    });

    block.append(extraSpecs);
    list.appendChild(block);
  });
}

function renderPlacementRows(onChange) {
  const h = state.answers.hardware;
  const g = state.answers.design;
  const physCount = Number(h.hostCount) || 1;
  const nestedCount = Number(g.nestedHostCount) || 0;
  const placementSection = document.getElementById('placement-section');
  const manualRows = document.getElementById('manual-placement-rows');
  if (!placementSection || !manualRows) return;

  placementSection.hidden = physCount < 2;
  if (physCount < 2) return;

  const isManual = g.nestedHostPlacement === 'manual';
  manualRows.hidden = !isManual;
  if (!isManual) return;

  // Ensure assignments array is sized correctly
  while (g.nestedHostAssignments.length < nestedCount) g.nestedHostAssignments.push(0);
  g.nestedHostAssignments.length = nestedCount;

  manualRows.innerHTML = '';
  for (let i = 0; i < nestedCount; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;';
    const lbl = document.createElement('span');
    lbl.textContent = `nested-esxi-${String(i + 1).padStart(2, '0')}`;
    lbl.style.cssText = 'min-width:140px;color:var(--text);';
    const sel = document.createElement('select');
    sel.style.width = '180px';
    for (let p = 0; p < physCount; p++) {
      const o = document.createElement('option');
      o.value = p; o.textContent = `Physical host ${p + 1}`;
      o.selected = (g.nestedHostAssignments[i] === p);
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { g.nestedHostAssignments[i] = Number(sel.value); onChange(); });
    row.append(lbl, sel);
    manualRows.appendChild(row);
  }
  renderPlacementRamSummary();
}

function renderNvmeDiskPicker(onChange) {
  const container = document.getElementById('nvme-disk-options');
  const warningEl = document.getElementById('nvme-disk-warning');
  if (!container) return;

  const g = state.answers.design;
  const h = state.answers.hardware;
  const nvmeDisks = (h.storageDevices || [])
    .map((dev, idx) => ({ dev, idx }))
    .filter(({ dev }) => dev.type === 'nvme' && dev.capacityGB);

  container.innerHTML = '';

  if (nvmeDisks.length === 0) {
    if (warningEl) warningEl.hidden = false;
    return;
  }
  if (warningEl) warningEl.hidden = true;

  // Auto-select first NVMe if nothing selected (or selection no longer valid)
  if (g.nvmeTieringDiskIndex === null || !nvmeDisks.find(({ idx }) => idx === g.nvmeTieringDiskIndex)) {
    g.nvmeTieringDiskIndex = nvmeDisks[0].idx;
    // Pre-fill tier disk size from the physical disk unless the user has already set a custom value
    if (!g.nvmeSizeGB || g.nvmeSizeGB === 100) {
      const firstDev = nvmeDisks[0].dev;
      const firstRaw = Number(firstDev.capacityGB) || 0;
      const firstGB  = firstDev.capacityUnit === 'TB' ? firstRaw * 1000 : firstRaw;
      if (firstGB) { g.nvmeSizeGB = firstGB; const el = document.getElementById('nvmeSizeGB'); if (el) el.value = firstGB; }
    }
  }

  nvmeDisks.forEach(({ dev, idx }) => {
    const raw = Number(dev.capacityGB) || 0;
    const sizeGB = dev.capacityUnit === 'TB' ? raw * 1000 : raw;
    const sizeLabel = sizeGB >= 1000
      ? (sizeGB / 1000).toFixed(1).replace(/\.0$/, '') + ' TB'
      : sizeGB + ' GB';

    const label = document.createElement('label');
    label.className = 'nvme-disk-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'nvmeTieringDisk';
    radio.value = String(idx);
    radio.checked = g.nvmeTieringDiskIndex === idx;
    radio.addEventListener('change', () => {
      g.nvmeTieringDiskIndex = idx;
      g.nvmeSizeGB = sizeGB;
      const sizeInput = document.getElementById('nvmeSizeGB');
      if (sizeInput) sizeInput.value = sizeGB;
      if (onChange) onChange();
    });

    const badge = document.createElement('span');
    badge.className = 'nvme-disk-badge';
    badge.textContent = 'NVMe';

    const size = document.createElement('span');
    size.className = 'nvme-disk-size';
    size.textContent = sizeLabel;

    const desc = document.createElement('span');
    desc.className = 'nvme-disk-desc';
    desc.textContent = `Disk #${idx + 1} — tier VMDKs will be provisioned from a datastore on this device`;

    label.append(radio, badge, size, desc);
    container.appendChild(label);
  });
}

function renderNestedDisks(onChange) {
  const g = state.answers.design;
  const disks = g.nestedDisks;
  const listEl = document.getElementById('nested-disk-list');
  listEl.innerHTML = '';

  if (disks.length > 0) {
    const header = document.createElement('div');
    header.className = 'nested-disk-list-header';
    ['Size (GB)', 'Purpose', ''].forEach((label) => {
      const s = document.createElement('span');
      s.textContent = label;
      header.appendChild(s);
    });
    listEl.appendChild(header);
  }

  disks.forEach((disk, idx) => {
    const entry = document.createElement('div');
    entry.className = 'nested-disk-entry';

    const sizeInput = document.createElement('input');
    sizeInput.type = 'number'; sizeInput.min = '1'; sizeInput.placeholder = 'e.g. 200';
    if (disk.sizeGB) sizeInput.value = disk.sizeGB;
    sizeInput.addEventListener('input', () => { disks[idx].sizeGB = Number(sizeInput.value) || null; if (onChange) onChange(); });

    const purposeSelect = document.createElement('select');
    const isEsa = state.answers.design.vsanArch !== 'osa';
    const purposeOpts = isEsa
      ? [['', 'Purpose…'], ['vsan_storage_pool', 'vSAN storage pool (ESA)'], ['local_datastore', 'Local datastore (host 1 only)'], ['data', 'Additional data disk']]
      : [['', 'Purpose…'], ['vsan_capacity', 'vSAN capacity tier'], ['vsan_cache', 'vSAN cache / perf tier'], ['local_datastore', 'Local datastore (host 1 only)'], ['data', 'Additional data disk']];
    purposeOpts.forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label; o.selected = disk.purpose === v;
      purposeSelect.appendChild(o);
    });
    purposeSelect.addEventListener('change', () => { disks[idx].purpose = purposeSelect.value || ''; if (onChange) onChange(); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn-remove'; removeBtn.textContent = '×';
    removeBtn.title = 'Remove this disk';
    removeBtn.addEventListener('click', () => {
      disks.splice(idx, 1);
      renderNestedDisks(onChange);
      if (onChange) onChange();
    });

    entry.append(sizeInput, purposeSelect, removeBtn);
    listEl.appendChild(entry);
  });

  updateEsaNvmeWarning();
}

function updateEsaNvmeWarning() {
  const warn = document.getElementById('vsan-esa-nvme-warn');
  if (!warn) return;
  const g = state.answers.design;
  const h = state.answers.hardware;
  const isEsa = g.vsanEnabled && g.vsanArch !== 'osa';
  const hasNvme = (h.storageDevices || []).some((d) => d.type === 'nvme');
  warn.hidden = !(isEsa && !hasNvme);
}

function updateWorkloadNote() {
  const g = state.answers.design;
  const note = document.getElementById('workload-sizing-note');
  if (!note || !g.workloadVmsEnabled) return;
  const size = g.workloadVmSize === 'medium' ? { vcpu: 4, vram: 8 } : { vcpu: 2, vram: 4 };
  const count = g.workloadVmCount || 0;
  const totalVcpu = count * size.vcpu;
  const totalVram = count * size.vram;
  note.textContent = count
    ? `${count} VM${count === 1 ? '' : 's'} × ${size.vcpu} vCPU / ${size.vram}GB = ${totalVcpu} vCPU and ${totalVram}GB vRAM added to the sizing total.`
    : '';
}

function updateDcNotice() {
  const g = state.answers.design;
  const isPhysical = g.dcNetworkPlacement === 'physical';

  const hintLab = document.getElementById('dc-network-placement-hint-lab');
  const hintPhysical = document.getElementById('dc-network-placement-hint-physical');
  if (hintLab) hintLab.hidden = isPhysical;
  if (hintPhysical) hintPhysical.hidden = !isPhysical;

  const ipLabel = document.getElementById('dc-ip-address-label');
  const ipHint = document.getElementById('dc-ip-address-hint');
  const ipInput = document.getElementById('dcIpAddress');
  if (ipLabel) ipLabel.textContent = isPhysical ? 'DC IP address (physical/home network)' : 'DC IP address';
  if (ipHint) {
    ipHint.textContent = isPhysical
      ? 'This is an IP on your physical/home network, not the lab management CIDR — the DC connects to the WAN port group directly.'
      : 'Checked against the lab network ranges in the next steps to flag IP conflicts.';
  }
  if (ipInput) ipInput.placeholder = isPhysical ? 'e.g. 10.0.0.50' : 'e.g. 192.168.10.5';

  const notice = document.getElementById('dc-ip-notice');
  if (!notice) return;
  if (g.dcProfile !== 'none' && g.dcIpAddress) {
    notice.hidden = false;
    notice.textContent = isPhysical
      ? `DC IP ${g.dcIpAddress} is planned for this lab, on your physical/home network. All DNS/NTP references in the generated scripts will point at this address.`
      : `DC IP ${g.dcIpAddress} is planned for this lab. Make sure it falls inside the management CIDR below and doesn’t conflict with any DHCP range.`;
  } else {
    notice.hidden = true;
  }
}

// --- Step navigation ---

function validateStep(n) {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  switch (n) {
    case 0: {
      // Physical host specs — also absorbs old ESXi version + Software library
      if (!h.cpuCores || !h.ramGB) {
        return 'CPU cores and RAM are needed to size the nested cluster.';
      }
      if ((h.hostCount || 1) > 1) {
        const addl = h.additionalHosts || [];
        for (let i = 0; i < addl.length; i++) {
          if (!addl[i].ipAddress) return `Enter an IP address for physical host ${i + 2}.`;
        }
      }
      if (!g.esxiVersion) return 'Select an ESXi version to continue.';
      return null;
    }
    case 2: {
      // Storage — split out of the old combined Hardware step
      const devs = h.storageDevices || [];
      if (devs.length === 0) return 'Add at least one storage device.';
      if (devs.some((d) => !d.type || !d.capacityGB)) {
        return 'Each storage device needs a type and capacity before continuing.';
      }
      return null;
    }
    case 3:
      return d.useCase ? null : 'Pick a use case to continue.';
    case 4:
      // Recommended template — optional, no required fields
      return null;
    case 5:
      // VyOS
      if (g.vyosEnabled && !g.vyosNetworkMode) {
        return 'Select a VyOS network mode.';
      }
      return null;
    case 6:
      // DC / VIS
      if (g.dcProfile === 'vis') {
        if (!g.visIpAddress) return 'Enter an IP address for the VIS appliance.';
      } else if (g.dcProfile !== 'none') {
        if (!g.dcDomainName) return 'Enter a domain name for the DC.';
        if (!g.dcIpAddress) return 'Enter an IP address for the DC.';
      }
      return null;
    case 7:
      // Lab networks — also absorbs old step 14 (Security & access)
      if (!g.mgmtCidr) return 'Management CIDR is needed at minimum.';
      if (g.mgmtVlanMode === 'tagged' && !g.mgmtVlan) return 'Tagged mode requires a management VLAN ID.';
      // Merged from old step 14: Security & access
      if (g.remoteAccessMethod === 'vpn' && !g.vpnType) {
        return 'Select a VPN type (WireGuard or VyOS site-to-site) to continue.';
      }
      return null;
    case 8: {
      // Nested cluster (mega-step) — also absorbs old step 8 (Deployment
      // placement), old step 10 (VCF Bring-up), old step 11 (Nested disks),
      // old step 12 (Bundle depot)
      if (!g.nestedHostCount || !g.vcpuPerHost || !g.vramPerHostGB) {
        return 'Nested host count, vCPU, and vRAM per host are all needed.';
      }
      if (g.vsanEnabled && !g.vsanCidr) {
        return 'vSAN is switched on, so it needs a CIDR too.';
      }

      // Merged from old step 8: Deployment placement — no required fields (no-op)

      // Merged from old step 10: VCF Bring-up — no required fields unless vcfEnabled
      if (g.vcfEnabled) {
        if (!g.vcfSddcMgrIp) return 'Enter the SDDC Manager IP address.';
        if (!g.vcfVcenterIp) return 'Enter the vCenter IP address for the VCF bring-up.';
        if (!g.vcfVtepCidr) return 'Enter the NSX VTEP CIDR for overlay TEP traffic.';
        if (!g.vcfEdgeUplink1Cidr) return 'Enter the NSX Edge Uplink 1 CIDR.';
      }

      // Merged from old step 11: Nested disks
      const ndisks = g.nestedDisks || [];
      if (g.vsanEnabled) {
        const isEsa = g.vsanArch !== 'osa';
        const hasStorageDisk = isEsa
          ? ndisks.some((d) => d.purpose === 'vsan_storage_pool')
          : ndisks.some((d) => d.purpose === 'vsan_capacity');
        if (!hasStorageDisk) {
          return isEsa
            ? 'vSAN ESA is enabled — add at least one vSAN storage pool disk to the nested host disk layout.'
            : 'vSAN OSA is enabled — add at least one vSAN capacity disk to the nested host disk layout.';
        }
      }
      if (ndisks.some((d) => !d.sizeGB || !d.purpose)) {
        return 'Each nested disk needs a size and purpose before continuing.';
      }

      // Merged from old step 12: Bundle depot — only relevant when depotStepVisible(); no required fields (no-op)
      return null;
    }
    case 9:
      // NSX-T — no required fields (nsxEnabled is optional)
      return null;
    case 10:
      // Workload VMs
      if (g.workloadVmsEnabled) {
        if (!g.workloadVmCount || g.workloadVmCount < 1) return 'Enter the number of workload VMs.';
        if (!g.workloadVmSize) return 'Select a workload VM size.';
      }
      return null;
    default:
      return null;
  }
}

function showStep(n) {
  state.step = n;
  autoSave();
  document.querySelectorAll('.step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === n);
  });
  document.querySelectorAll('#rail-steps li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n && s !== TROUBLESHOOT_STEP);
  });

  document.getElementById('btn-back').style.visibility = n === 0 ? 'hidden' : 'visible';

  // The review step (TOTAL_STEPS-2) is the effective last step in normal mode.
  // When troubleshootingMode is on, the user can navigate one step further to TROUBLESHOOT_STEP.
  const reviewStep = TOTAL_STEPS - 2;  // step 9
  const isLastVisible = state.troubleshootingMode ? n === TROUBLESHOOT_STEP : n === reviewStep;
  document.getElementById('btn-next').style.display = isLastVisible ? 'none' : 'inline-flex';
  document.getElementById('step-error').textContent = '';

  if (n === reviewStep) renderReview();
  if (n === reviewStep) renderReviewPlacement();
  if (n === TROUBLESHOOT_STEP) initTroubleshootStep();
  if (n === 0) renderHardwareValidator();
  if (n === 4) renderTemplateStep();
  if (n === 8) {
    // Nested cluster (mega-step): sizing/resource helpers plus the
    // Deployment placement subsection (renderDeploymentPlacement) and the
    // Bundle depot subsection's live-visibility toggle (updateDepotVisibility).
    renderSizingRecommendations();
    renderResourceTips();
    updateVramWarning();
    renderDeploymentPlacement(_onFormChange);
    updateDepotVisibility();
  }
  updateDcNotice();
  updateEsxi9Notices();

  // Learning mode: toggle the learn-block panels for this step and refresh
  // any computed insights that belong to it.
  document.querySelectorAll('.learn-block').forEach((el) => {
    const learnStep = Number(el.dataset.learnStep);
    el.style.display = (state.learningMode && learnStep === n) ? '' : 'none';
  });
  if (state.learningMode) {
    if (n === 0) updateLearnRamContext();
    if (n === 8) updateLearnRamHeadroom();
    if (n === reviewStep) renderScorecard();
  }

  // In architect mode, show options analysis before certain steps (once per session)
  if (state.architectMode) {
    const analysisMap = { 5: 'router', 8: 'clusterSize', 9: 'nsx' };
    const key = analysisMap[n];
    const alreadySeen = state._optionsAnalysisSeen || {};
    if (key && !alreadySeen[key]) {
      state._optionsAnalysisSeen = alreadySeen;
      alreadySeen[key] = true;
      showOptionsAnalysis(key);
    }
  }
}

function getNextStep(n) {
  return n + 1;
}

function getPrevStep(n) {
  return n - 1;
}

function wireNav() {
  document.getElementById('btn-next').addEventListener('click', () => {
    const err = validateStep(state.step);
    if (err) {
      document.getElementById('step-error').textContent = err;
      return;
    }
    if (state.step < TOTAL_STEPS - 1) showStep(getNextStep(state.step));
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.step > 0) showStep(getPrevStep(state.step));
  });

  document.querySelectorAll('#rail-steps li').forEach((li) => {
    li.addEventListener('click', () => {
      const target = Number(li.dataset.step);
      if (target <= state.step) showStep(target);
    });
  });
}

// --- Live topology ---

function netRow(name, cidr, vlanId, color) {
  const parts = [];
  if (cidr) parts.push(cidr);
  if (vlanId !== null && vlanId !== undefined) parts.push(`VLAN ${vlanId}`);
  const value = parts.length ? parts.join(' · ') : 'not set';

  const row = document.createElement('div');
  row.className = 'topo-net-row';

  const dot = document.createElement('span');
  dot.className = 'topo-net-dot';
  dot.style.background = color;

  const label = document.createElement('span');
  label.className = 'topo-net-name';
  label.textContent = name;

  const v = document.createElement('span');
  v.className = 'topo-net-value';
  v.textContent = value;

  row.append(dot, label, v);
  return row;
}

function renderTopology() {
  const h = state.answers.hardware;
  const g = state.answers.design;

  const stats = document.getElementById('topo-host-stats');
  stats.innerHTML = '';
  const storageChipText = (() => {
    const devs = h.storageDevices || [];
    if (!devs.length || devs.every((d) => !d.capacityGB)) return '– storage';
    const totalGB = devs.reduce((s, d) => s + (d.capacityUnit === 'TB' ? (d.capacityGB || 0) * 1000 : (d.capacityGB || 0)), 0);
    if (devs.length === 1) {
      const d = devs[0];
      return `${d.capacityGB || '?'}${d.capacityUnit || 'GB'} ${DEVICE_TYPE_LABELS[d.type] || ''}`.trim();
    }
    return `${devs.length} disks${totalGB ? ' · ' + (totalGB >= 1000 ? (totalGB / 1000).toFixed(1) + 'TB' : totalGB + 'GB') : ''}`;
  })();
  [
    h.cpuCores ? `${h.cpuCores} cores` : '– cores',
    h.ramGB ? `${h.ramGB}GB RAM` : '– RAM',
    storageChipText
  ].forEach((text) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = text;
    stats.appendChild(chip);
  });

  // Appliance VMs (VyOS, DC)
  const appliancesEl = document.getElementById('topo-appliances');
  appliancesEl.innerHTML = '';
  if (g.vyosEnabled) {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    a.textContent = `vyos${g.vyosNetworkMode === 'bgp' ? ' (BGP)' : ''}`;
    appliancesEl.appendChild(a);
  }
  if (g.dcProfile === 'vis') {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    a.textContent = `vis${g.visIpAddress ? ' · ' + g.visIpAddress : ''}`;
    appliancesEl.appendChild(a);
  } else if (g.dcProfile !== 'none') {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    const profileSuffix = g.dcProfile === 'dc-jumpbox' ? ' + jumpbox' : g.dcProfile === 'dc-jumpbox-fileserver' ? ' + jumpbox + files' : '';
    a.textContent = `dc${profileSuffix}${g.dcDomainName ? ' · ' + g.dcDomainName : ''}`;
    appliancesEl.appendChild(a);
  }
  if (g.depotEnabled && depotStepVisible()) {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    a.textContent = `depot${g.depotIpAddress ? ' · ' + g.depotIpAddress : ''} (${g.depotMode === 'iis' ? 'IIS' : 'nginx'})`;
    appliancesEl.appendChild(a);
  }

  // Nested hosts
  const nested = document.getElementById('topo-nested');
  nested.innerHTML = '';
  const count = g.nestedHostCount || 0;
  if (count === 0) {
    const empty = document.createElement('div');
    empty.className = 'topo-empty';
    empty.textContent = 'No nested hosts yet';
    nested.appendChild(empty);
  } else {
    const shown = Math.min(count, 9);
    for (let i = 1; i <= shown; i++) {
      const vm = document.createElement('div');
      vm.className = 'topo-vm';
      const name = document.createElement('span');
      name.className = 'topo-vm-name';
      name.textContent = `esxi-${String(i).padStart(2, '0')}`;
      const spec = document.createElement('span');
      spec.className = 'topo-vm-spec';
      spec.textContent = `${val(g.vcpuPerHost)}vCPU/${val(g.vramPerHostGB)}GB`;
      vm.append(name, spec);
      nested.appendChild(vm);
    }
    if (count > shown) {
      const more = document.createElement('div');
      more.className = 'topo-more';
      more.textContent = `+${count - shown} more`;
      nested.appendChild(more);
    }
  }

  const nets = document.getElementById('topo-networks');
  nets.innerHTML = '';
  nets.appendChild(netRow('Mgmt', g.mgmtCidr, g.mgmtVlan, NET_COLORS.management));
  nets.appendChild(netRow('vMotion', g.vmotionCidr, g.vmotionVlan, NET_COLORS.vMotion));
  if (g.vsanEnabled) nets.appendChild(netRow('vSAN', g.vsanCidr, g.vsanVlan, NET_COLORS.vsan));
  nets.appendChild(netRow('VM traffic', g.vmCidr, g.vmVlan, NET_COLORS.vmTraffic));
}

// --- Review ---

function reviewCard(title, rows) {
  const card = document.createElement('div');
  card.className = 'review-card';

  const header = document.createElement('div');
  header.className = 'review-card-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'review-card-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'review-card-body';

  rows.forEach(([label, value, opts]) => {
    const full = opts?.full;
    const dim = value === '—' || value === 'Disabled' || value === 'No' || value === 'Local only';
    const kv = document.createElement('div');
    kv.className = full ? 'review-kv review-kv-full' : 'review-kv';

    const labelEl = document.createElement('div');
    labelEl.className = 'review-kv-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'review-kv-value' + (dim ? ' value-dim' : '');
    valueEl.textContent = value;

    kv.append(labelEl, valueEl);
    body.appendChild(kv);
  });

  card.appendChild(body);
  return card;
}

function renderReview() {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  const container = document.getElementById('review-summary');
  container.innerHTML = '';

  // --- Use case + Hardware ---
  const hwRows = [
    ['Use case', USE_CASE_LABELS[d.useCase] || val(d.useCase)],
    ['Physical hosts', val(h.hostCount)],
    ['Host 1 IP', val(h.ipAddress)],
    ['CPU cores / host', val(h.cpuCores)],
    ['RAM / host', val(h.ramGB, 'GB')],
    ...((h.storageDevices || []).map((dev, i) => [
      `Disk ${i + 1}`,
      `${dev.capacityGB || '?'}${dev.capacityUnit || 'GB'} ${DEVICE_TYPE_LABELS[dev.type] || '?'}`
    ])),
    ['NICs / host', h.nicCount ? `${h.nicCount} × ${h.nicSpeed || '?'}` : '—'],
    ...(h.nicModel ? [['NIC model', h.nicModel]] : []),
    ...((h.additionalHosts || []).map((ah, i) => [
      `Host ${i + 2} IP`,
      val(ah.ipAddress) + (ah.sameAsFirst !== false ? ' (same specs as host 1)' : ` — ${ah.cpuCores || '?'} cores / ${ah.ramGB || '?'}GB`)
    ]))
  ];
  container.appendChild(reviewCard('Hardware', hwRows));

  // --- ESXi version + deploy method ---
  const deployLabel = g.esxiDeployMethod === 'ova' ? 'William Lam OVA (automated)' : 'ISO (interactive install)';
  container.appendChild(reviewCard('ESXi', [
    ['Version', ESXI_VERSION_LABELS[g.esxiVersion] || val(g.esxiVersion)],
    ['Deploy method', deployLabel]
  ]));

  // --- Infrastructure: VyOS, DC ---
  const infraComponents = [];
  infraComponents.push(['VyOS router', g.vyosEnabled ? (g.vyosNetworkMode === 'bgp' ? 'Enabled (BGP)' : 'Enabled') : 'No']);
  if (g.vyosEnabled && g.vyosNetworkMode) {
    infraComponents.push(['VyOS mode', g.vyosNetworkMode === 'bgp' ? 'Basic + BGP' : 'Basic (NAT, DHCP, DNS)']);
  }
  const dcProfileLabels = { 'none': 'No', 'dc-only': 'DC only', 'dc-jumpbox': 'DC + Jumpbox', 'dc-jumpbox-fileserver': 'DC + Jumpbox + File Server', 'vis': 'No (using VIS instead)' };
  infraComponents.push(['Domain controller', dcProfileLabels[g.dcProfile] || 'No']);
  if (g.dcProfile === 'vis') {
    infraComponents.push(['VIS appliance', "William Lam's VCF Infrastructure Services Appliance"]);
    infraComponents.push(['VIS IP', val(g.visIpAddress)]);
  } else if (g.dcProfile !== 'none') {
    infraComponents.push(['DC domain', val(g.dcDomainName)]);
    infraComponents.push(['DC IP', val(g.dcIpAddress)]);
    infraComponents.push(['DC network', g.dcNetworkPlacement === 'physical' ? 'Physical/home network (VM Network)' : 'Lab management network (Nested-Trunk)']);
    if (g.dcProfile === 'dc-jumpbox-fileserver') infraComponents.push(['Storage disk', `${g.dcStorageDiskGB || 200} GB`]);
  }
  const localDsEnabled = (g.nestedDisks || []).some((dd) => dd.purpose === 'local_datastore');
  infraComponents.push(['Local datastore (host 1)', localDsEnabled ? 'Yes' : 'No']);
  if (depotStepVisible() && g.depotEnabled) {
    infraComponents.push(['Bundle depot', g.depotMode === 'iis' ? 'IIS on DC' : 'Linux/nginx VM']);
    infraComponents.push(['Depot IP', val(g.depotIpAddress)]);
  }
  container.appendChild(reviewCard('Infrastructure', infraComponents));

  // --- Network ---
  const netRows = [
    ['Existing network', NETTYPE_LABELS[d.networkType] || val(d.networkType)],
    ['VLAN capable', d.vlanCapable === null ? '—' : (d.vlanCapable ? 'Yes' : 'No')],
    ['Management', `${val(g.mgmtCidr)} ${g.mgmtVlanMode === 'tagged' ? `VLAN ${g.mgmtVlan || '?'}` : '(untagged)'}`.trim()],
    ['vMotion', `${val(g.vmotionCidr)}${g.vmotionVlan != null ? ` VLAN ${g.vmotionVlan}` : ''}`.trim()]
  ];
  if (g.vsanEnabled) {
    netRows.push(['vSAN net', `${val(g.vsanCidr)}${g.vsanVlan != null ? ` VLAN ${g.vsanVlan}` : ''}`.trim()]);
  }
  netRows.push(['VM traffic', `${val(g.vmCidr)}${g.vmVlan != null ? ` VLAN ${g.vmVlan}` : ''}`.trim()]);
  container.appendChild(reviewCard('Networking', netRows));

  // --- Cluster ---
  container.appendChild(reviewCard('Nested cluster', [
    ['Hosts', val(g.nestedHostCount)],
    ['vCPU / host', val(g.vcpuPerHost)],
    ['vRAM / host', val(g.vramPerHostGB, 'GB')],
    ['Boot disk', val(g.nestedDiskGB, 'GB')],
    ['Cluster name', val(g.clusterName)],
    ['SSO domain', val(g.ssoDomain)],
    ['vSAN', g.vsanEnabled ? `Enabled — ${g.vsanArch === 'osa' ? 'OSA' : 'ESA'}` : 'Disabled'],
    ['Legacy CPU compat', g.legacyCpuCompat ? 'Enabled' : 'Disabled'],
    ['Memory tiering', g.memTieringEnabled ? (() => {
      const devs = state.answers.hardware.storageDevices || [];
      const disk = g.nvmeTieringDiskIndex != null ? devs[g.nvmeTieringDiskIndex] : null;
      if (disk && disk.capacityGB) {
        const raw = Number(disk.capacityGB) || 0;
        const sizeGB = disk.capacityUnit === 'TB' ? raw * 1000 : raw;
        const lbl = sizeGB >= 1000 ? (sizeGB / 1000).toFixed(1).replace(/\.0$/, '') + ' TB' : sizeGB + ' GB';
        return `Disk #${g.nvmeTieringDiskIndex + 1} (NVMe ${lbl}) · ${g.tierNvmePct}%`;
      }
      return `${g.nvmeSizeGB || 100}GB NVMe · ${g.tierNvmePct}%`;
    })() : 'Disabled']
  ]));

  // --- Nested disks ---
  const ndisks = g.nestedDisks || [];
  if (ndisks.length > 0) {
    container.appendChild(reviewCard('Nested host disks',
      ndisks.map((dd, i) => [
        `Disk ${i + 1}`,
        `${dd.sizeGB || '?'}GB — ${NESTED_DISK_PURPOSE_LABELS[dd.purpose] || dd.purpose || '?'}`
      ])
    ));
  }

  // --- Workload VMs ---
  if (g.workloadVmsEnabled) {
    const wlSpec = g.workloadVmSize === 'medium' ? '4 vCPU / 8GB' : '2 vCPU / 4GB';
    container.appendChild(reviewCard('Workload VMs', [
      ['Count', val(g.workloadVmCount)],
      ['Size', `${g.workloadVmSize || '—'} (${wlSpec})`]
    ]));
  }

  // --- NSX ---
  if (g.nsxEnabled) {
    const bgpEnabled = g.vyosEnabled && g.vyosNetworkMode === 'bgp';
    const bgpLabel = bgpEnabled
      ? `AS ${g.nsxBgpLocalAs} ↔ VyOS AS ${g.nsxBgpPeerAs}`
      : 'Disabled';
    const edgeSizeLabels = { small: 'Small (2 vCPU / 4 GB)', medium: 'Medium (4 vCPU / 8 GB)', large: 'Large (8 vCPU / 32 GB)' };
    const nsxRows = [
      ['Size', g.nsxSize === 'medium' ? 'Medium (6 vCPU / 24GB)' : 'Small (3 vCPU / 12GB)'],
      ['Topology', NSX_TOPOLOGY_LABELS[g.nsxTopology] || val(g.nsxTopology)],
      ['Edge nodes', `${g.nsxEdgeCount || 1} × ${edgeSizeLabels[g.nsxEdgeSize] || g.nsxEdgeSize}`],
      ['Manager IP', val(g.nsxIpAddress)],
      ['BGP peering', bgpLabel]
    ];
    if (bgpEnabled) {
      const redistParts = [];
      if (g.nsxRedistConnected !== false) redistParts.push('Connected');
      if (g.nsxRedistStatic) redistParts.push('Static');
      if (g.nsxRedistT1Lb)   redistParts.push('T1 LB VIPs');
      nsxRows.push(['BGP redistribute', redistParts.length ? redistParts.join(', ') : '—']);
      if (g.nsxBgpRouteAdvert === 'specific') {
        const prefixes = (g.nsxBgpPrefixes || '').split('\n').map((s) => s.trim()).filter(Boolean);
        nsxRows.push(['BGP prefix list', prefixes.length ? prefixes.join(', ') : '—']);
      }
    }
    container.appendChild(reviewCard('NSX-T', nsxRows));
  }

  // --- VCF Bring-up ---
  if (g.vcfEnabled) {
    container.appendChild(reviewCard('VCF Bring-up', [
      ['SDDC Manager', `${val(g.vcfSddcMgrIp)} (${g.vcfSddcMgrHostname || 'sddcmgr'})`],
      ['vCenter IP', val(g.vcfVcenterIp)],
      ['NSX VTEP', g.vcfVtepCidr ? `${g.vcfVtepCidr}${g.vcfVtepVlan ? ` VLAN ${g.vcfVtepVlan}` : ''}` : '—'],
      ['Edge Uplink 1', g.vcfEdgeUplink1Cidr ? `${g.vcfEdgeUplink1Cidr}${g.vcfEdgeUplink1Vlan ? ` VLAN ${g.vcfEdgeUplink1Vlan}` : ''}` : '—'],
      ['Edge Uplink 2', g.vcfEdgeUplink2Cidr ? `${g.vcfEdgeUplink2Cidr}${g.vcfEdgeUplink2Vlan ? ` VLAN ${g.vcfEdgeUplink2Vlan}` : ''}` : 'Not configured'],
      ['ESXi license', g.vcfEsxiLicense ? 'Provided' : '60-day eval'],
      ['vCenter license', g.vcfVcenterLicense ? 'Provided' : '60-day eval']
    ]));
  }

  // --- Security & access ---
  const accessRows = [
    ['Isolated segment', g.isolateLab ? 'Yes' : 'No'],
    ['Firewall policy', FIREWALL_LABELS[g.firewallPolicy] || val(g.firewallPolicy)],
    ['Internet access', g.internetAccess ? 'Yes' : 'No'],
    ['Remote access', REMOTE_LABELS[g.remoteAccessMethod] || val(g.remoteAccessMethod)]
  ];
  if (g.remoteAccessMethod === 'vpn') {
    accessRows.push(['VPN type', VPN_TYPE_LABELS[g.vpnType] || val(g.vpnType)]);
  }
  accessRows.push(['vCenter size', val(g.vcenterSize)]);
  container.appendChild(reviewCard('Security & access', accessRows));

  // --- Inline warnings ---
  const hclResult = checkNicHcl(h.nicModel);
  if (hclResult && hclResult.status === 'flagged') {
    const warn = document.createElement('div');
    warn.className = 'review-warn';
    warn.style.borderColor = 'var(--warn)';
    warn.style.color = 'var(--warn)';
    warn.textContent = `⚠ NIC compatibility: ${h.nicModel} matches ${hclResult.chipsets} — ${hclResult.reason}`;
    container.appendChild(warn);
  }

  if (g.vsanEnabled) {
    const isEsa = g.vsanArch !== 'osa';
    const hasStorageDisk = isEsa
      ? ndisks.some((dd) => dd.purpose === 'vsan_storage_pool')
      : ndisks.some((dd) => dd.purpose === 'vsan_capacity');
    if (!hasStorageDisk) {
      const warn = document.createElement('div');
      warn.className = 'review-warn';
      warn.textContent = isEsa
        ? '⚠ vSAN ESA is enabled but no storage pool disk is defined. Go back to Nested disks and add a vSAN storage pool (ESA) disk.'
        : '⚠ vSAN OSA is enabled but no capacity disk is defined. Go back to Nested disks and add a vSAN capacity tier disk.';
      container.appendChild(warn);
    }
  }

  if (g.depotEnabled && g.depotMode === 'iis' && (g.dcProfile === 'none' || g.dcProfile === 'vis')) {
    const warn = document.createElement('div');
    warn.className = 'review-warn';
    warn.textContent = '⚠ Bundle depot is set to IIS mode but no Windows domain controller is included (VIS is a Linux appliance and cannot host IIS). Enable a Windows DC (step 6) or switch to Linux/nginx mode.';
    container.appendChild(warn);
  }

  if (g.vcfEnabled) {
    const sso = (g.ssoDomain || '').toLowerCase().replace(/\.$/, '');
    const ad  = (g.dcDomainName || '').toLowerCase().replace(/\.$/, '');
    if (sso && ad && sso === ad) {
      const warn = document.createElement('div');
      warn.className = 'review-warn';
      warn.textContent = `⚠ SSO domain "${g.ssoDomain}" matches the AD domain "${g.dcDomainName}" — this causes VCF bring-up failures. Change the SSO domain in Nested cluster (step 8) to a subdomain, e.g. vsphere.${g.dcDomainName}.`;
      container.appendChild(warn);
    }
    const nestedCount = Number(g.nestedHostCount) || 0;
    if (nestedCount < 4) {
      const warn = document.createElement('div');
      warn.className = 'review-warn';
      warn.style.borderColor = 'var(--warn)';
      warn.style.color = 'var(--warn)';
      warn.textContent = `⚠ VCF management domain requires 4 ESXi hosts (3 minimum with vSAN ESA). You have ${nestedCount}. Cloud Builder will reject the bring-up unless the host count is met.`;
      container.appendChild(warn);
    }
  }

  document.getElementById('results').hidden = true;

  renderReviewDiagram();
}

// ── Live diagram preview on review screen ─────────────────────────────────

let reviewMermaidInit = false;
let reviewDiagramPending = false;

// The <script src="/vendor/mermaid.min.js"> tag is at the end of the document, so on a
// slow connection (or a very fast click-through straight to the review step on first
// page load) it's possible to reach renderReviewDiagram() before the global exists yet.
// Poll briefly rather than giving up on the very first check — this is the "fix the
// initialisation order" half of the diagram fix: a slow load is no longer indistinguishable
// from mermaid genuinely being unavailable.
function waitForMermaid(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (typeof mermaid !== 'undefined') return resolve(true);
    const start = Date.now();
    const poll = setInterval(() => {
      if (typeof mermaid !== 'undefined') {
        clearInterval(poll);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        resolve(false);
      }
    }, 100);
  });
}

// Self-close any bare void HTML tag (<br>, <img>, <hr>, <input>, <meta>, <link>) inside
// a Mermaid-rendered SVG string. Mermaid's HTML node/edge labels (used for multi-line
// "name\nrole\nip" text via a foreignObject) can leave these unclosed -- valid loose
// HTML, invalid XML. Idempotent: already-self-closed tags pass through unchanged.
function fixSvgVoidTags(svgStr) {
  return svgStr.replace(/<(br|img|hr|input|meta|link)((?:\s[^>]*)?)\/?>/gi, (m, tag, attrs) => {
    const cleanAttrs = attrs.replace(/\/\s*$/, '');
    return `<${tag}${cleanAttrs}/>`;
  });
}

async function renderReviewDiagram() {
  const section = document.getElementById('review-diagram-section');
  const inner   = document.getElementById('review-diagram-inner');
  const empty   = document.getElementById('review-diagram-empty');

  section.hidden = false;
  inner.innerHTML = '';
  empty.textContent = 'Rendering…';
  empty.style.display = 'flex';

  if (!reviewMermaidInit) {
    const ready = await waitForMermaid();
    if (!ready) {
      empty.textContent = 'Diagram preview unavailable — your network-diagram.svg will still be included in the generated zip';
      return;
    }
    // htmlLabels: false -- multi-line node labels ("name\nrole\nip") render as SVG
    // <tspan> line breaks instead of an HTML <br> inside a foreignObject. Mermaid
    // doesn't self-close that <br>, which is valid loose HTML but not valid XML, and
    // this preview is parsed with DOMParser(..., 'image/svg+xml') below (XSS hardening,
    // v0.6.6-beta) -- a strict XML parser rejects the malformed SVG outright and the
    // browser inserts its own <parsererror> box in place of the diagram. Keeping labels
    // as pure SVG avoids the whole class of bug.
    mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true, securityLevel: 'antiscript', flowchart: { curve: 'basis', htmlLabels: false } });
    reviewMermaidInit = true;
  }

  // 5-second timeout: if mermaid render hangs, show fallback
  const renderTimeout = setTimeout(() => {
    if (empty.textContent === 'Rendering…') {
      empty.textContent = 'Diagram preview unavailable — your network-diagram.svg will still be included in the generated zip';
    }
  }, 5000);

  // Build spec from current state and request mermaid source from server
  const reviewSpec = buildReviewSpec();
  fetch('/api/diagram/from-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: reviewSpec })
  })
    .then((r) => r.json())
    .then(async (data) => {
      if (!data.mermaid) throw new Error('No mermaid source returned');
      const id = 'review-diag-' + Date.now();
      let { svg } = await mermaid.render(id, data.mermaid);
      // Belt-and-suspenders: even with flowchart.htmlLabels:false (set above), force
      // any stray unclosed void tag (<br>, <img>, <hr>...) closed. This SVG is about to
      // go through a strict XML parser (DOMParser below) -- one unclosed <br> and the
      // whole diagram is replaced by the browser's native parser-error box instead of
      // rendering. Cheap and idempotent, so it's safe to always run.
      svg = fixSvgVoidTags(svg);
      clearTimeout(renderTimeout);
      // Parse as SVG rather than injecting raw HTML string
      const svgDoc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      inner.innerHTML = '';
      inner.appendChild(document.adoptNode(svgDoc.documentElement));
      const svgEl = inner.querySelector('svg');
      if (svgEl) { svgEl.style.maxWidth = '100%'; svgEl.style.height = 'auto'; }
      empty.style.display = 'none';

      // "Open in viewer" has no session id to link to until Generate has run (see the
      // /api/generate success handler below, which overwrites this with a real
      // ?id=<session> link once one exists). Until then, hand /diagram the in-progress
      // spec via localStorage (not sessionStorage — a new tab only reliably inherits
      // sessionStorage when opened as a same-origin auxiliary browsing context, which is
      // an extra condition to depend on; localStorage is shared with any same-origin tab
      // unconditionally) so the link isn't just a dead, empty page.
      try {
        localStorage.setItem('vsphere-diagram-preview-spec', JSON.stringify(reviewSpec));
      } catch { /* storage unavailable/full — non-fatal, link just won't have a fallback */ }
    })
    .catch(() => {
      clearTimeout(renderTimeout);
      empty.textContent = 'Diagram preview unavailable — your network-diagram.svg will still be included in the generated zip';
    });
}

function buildReviewSpec() {
  // Minimal spec build from current answers — mirrors what the server does in generateSpec.js
  // We only need enough for buildMermaidDiagram; full spec is built server-side on generate.
  const h = state.answers.hardware || {};
  const g = state.answers.design || {};

  const host1 = {
    ipAddress: h.ipAddress || null,
    cpuCores: Number(h.cpuCores) || null,
    ramGB: Number(h.ramGB) || null
  };
  const physicalHosts = [
    host1,
    ...(h.additionalHosts || []).map((ah) => ({
      ipAddress: ah.ipAddress || null,
      cpuCores: ah.sameAsFirst !== false ? host1.cpuCores : (Number(ah.cpuCores) || null),
      ramGB: ah.sameAsFirst !== false ? host1.ramGB : (Number(ah.ramGB) || null)
    }))
  ];
  const physCount = physicalHosts.length;
  const nestedCount = Number(g.nestedHostCount) || 0;
  let placement;
  if (g.nestedHostPlacement === 'manual' && Array.isArray(g.nestedHostAssignments)
      && g.nestedHostAssignments.length === nestedCount) {
    placement = g.nestedHostAssignments.map((v) => Math.min(Number(v) || 0, physCount - 1));
  } else {
    placement = Array.from({ length: nestedCount }, (_, i) => i % physCount);
  }

  return {
    physicalHost: host1,
    physicalHosts,
    esxiVersion: { label: ESXI_VERSION_LABELS[g.esxiVersion] || 'ESXi' },
    vyos: { enabled: !!g.vyosEnabled, networkMode: g.vyosNetworkMode || 'basic' },
    domainController: { enabled: g.dcProfile !== 'none' && g.dcProfile !== 'vis', profile: g.dcProfile || 'none', domainName: g.dcDomainName || null, ipAddress: g.dcIpAddress || null, storageDiskGB: g.dcStorageDiskGB || 200, networkPlacement: g.dcNetworkPlacement || 'lab' },
    vis: { enabled: g.dcProfile === 'vis', ipAddress: g.visIpAddress || null },
    networks: {
      management: { cidr: g.mgmtCidr || null, vlanId: g.mgmtVlan != null ? Number(g.mgmtVlan) : null, mode: g.mgmtVlanMode || 'untagged' },
      vMotion: { cidr: g.vmotionCidr || null, vlanId: g.vmotionVlan != null ? Number(g.vmotionVlan) : null },
      vsan: g.vsanEnabled ? { cidr: g.vsanCidr || null, vlanId: g.vsanVlan != null ? Number(g.vsanVlan) : null } : null,
      vmTraffic: { cidr: g.vmCidr || null, vlanId: g.vmVlan != null ? Number(g.vmVlan) : null }
    },
    nestedCluster: {
      hostCount: nestedCount,
      vcpuPerHost: Number(g.vcpuPerHost) || 0,
      vramPerHostGB: Number(g.vramPerHostGB) || 0,
      vsanEnabled: !!g.vsanEnabled,
      clusterName: g.clusterName || 'mgmt-cluster',
      hosts: placement.map((pi, i) => ({ index: i + 1, physicalHostIndex: pi }))
    },
    workloadVms: { enabled: !!g.workloadVmsEnabled, count: Number(g.workloadVmCount) || 0, vcpu: 2, vramGB: 4 },
    remoteAccess: { method: g.remoteAccessMethod || null },
    nsx: { enabled: !!g.nsxEnabled, bgpEnabled: !!(g.nsxEnabled && g.vyosEnabled && g.vyosNetworkMode === 'bgp') }
  };
}

// --- Spec loading (extend mode) ---

function loadSpecIntoState(spec) {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  if (spec.useCase) d.useCase = spec.useCase;
  if (spec.existingNetwork) {
    if (spec.existingNetwork.type) d.networkType = spec.existingNetwork.type;
    if (spec.existingNetwork.vlanCapableRouter != null) d.vlanCapable = spec.existingNetwork.vlanCapableRouter;
    if (spec.existingNetwork.dhcpAvailable != null) d.dhcpAvailable = spec.existingNetwork.dhcpAvailable;
  }
  if (spec.physicalHosts && spec.physicalHosts.length) {
    // New multi-host format
    h.hostCount = spec.physicalHosts.length;
    const ph0 = spec.physicalHosts[0];
    if (ph0.ipAddress) h.ipAddress = ph0.ipAddress;
    if (ph0.cpuCores) h.cpuCores = ph0.cpuCores;
    if (ph0.ramGB) h.ramGB = ph0.ramGB;
    if (ph0.nicCount) h.nicCount = ph0.nicCount;
    if (ph0.nicSpeed) h.nicSpeed = ph0.nicSpeed;
    if (ph0.storageDevices && ph0.storageDevices.length) {
      h.storageDevices = ph0.storageDevices.map((d) => ({
        type: d.type || '', capacityGB: d.capacityGB || null, capacityUnit: 'GB'
      }));
    }
    h.additionalHosts = spec.physicalHosts.slice(1).map((ph) => ({
      ipAddress: ph.ipAddress || null,
      sameAsFirst: false,
      cpuCores: ph.cpuCores || null,
      ramGB: ph.ramGB || null,
      storageDevices: (ph.storageDevices || []).map((d) => ({
        type: d.type || '', capacityGB: d.capacityGB || null, capacityUnit: 'GB'
      })),
      nicCount: ph.nicCount || null,
      nicSpeed: ph.nicSpeed || null
    }));
  } else if (spec.physicalHost) {
    // Legacy single-host format
    const ph = spec.physicalHost;
    if (ph.hostCount) h.hostCount = ph.hostCount;
    if (ph.cpuCores) h.cpuCores = ph.cpuCores;
    if (ph.ramGB) h.ramGB = ph.ramGB;
    if (ph.nicCount) h.nicCount = ph.nicCount;
    if (ph.nicSpeed) h.nicSpeed = ph.nicSpeed;
    if (ph.storageDevices && ph.storageDevices.length) {
      h.storageDevices = ph.storageDevices.map((d) => ({
        type: d.type || '', capacityGB: d.capacityGB || null, capacityUnit: 'GB'
      }));
    }
  }
  if (spec.esxiVersion?.version) g.esxiVersion = spec.esxiVersion.version;
  if (spec.esxiDeployMethod) g.esxiDeployMethod = spec.esxiDeployMethod;
  if (spec.vyos) {
    g.vyosEnabled = !!spec.vyos.enabled;
    if (spec.vyos.networkMode) g.vyosNetworkMode = spec.vyos.networkMode;
  }
  if (spec.domainController) {
    // Backward compat: old specs have `enabled` bool but no `profile`
    g.dcProfile = spec.domainController.profile || (spec.domainController.enabled ? 'dc-only' : 'none');
    if (spec.domainController.domainName) g.dcDomainName = spec.domainController.domainName;
    if (spec.domainController.ipAddress)  g.dcIpAddress  = spec.domainController.ipAddress;
    if (spec.domainController.storageDiskGB) g.dcStorageDiskGB = spec.domainController.storageDiskGB;
    g.dcNetworkPlacement = spec.domainController.networkPlacement === 'physical' ? 'physical' : 'lab';
    const placementRadio = document.querySelector(`input[name="dcNetworkPlacement"][value="${g.dcNetworkPlacement}"]`);
    if (placementRadio) placementRadio.checked = true;
    // Sync radio UI
    const profileRadio = document.querySelector(`input[name="dcProfile"][value="${g.dcProfile}"]`);
    if (profileRadio) profileRadio.checked = true;
    document.getElementById('dc-fields').hidden = g.dcProfile === 'none' || g.dcProfile === 'vis';
    const storageDiskField = document.getElementById('dc-storage-disk-field');
    if (storageDiskField) storageDiskField.hidden = g.dcProfile !== 'dc-jumpbox-fileserver';
  }
  if (spec.vis && spec.vis.enabled) {
    g.dcProfile = 'vis';
    g.visIpAddress = spec.vis.ipAddress || null;
    const profileRadio = document.querySelector('input[name="dcProfile"][value="vis"]');
    if (profileRadio) profileRadio.checked = true;
    document.getElementById('dc-fields').hidden = true;
    const visFields = document.getElementById('vis-fields');
    if (visFields) visFields.hidden = false;
  }
  if (spec.networks) {
    const nets = spec.networks;
    if (nets.management) {
      if (nets.management.cidr) g.mgmtCidr = nets.management.cidr;
      if (nets.management.vlanId != null) g.mgmtVlan = nets.management.vlanId;
      if (nets.management.mode) g.mgmtVlanMode = nets.management.mode;
    }
    if (nets.vMotion) {
      if (nets.vMotion.cidr) g.vmotionCidr = nets.vMotion.cidr;
      if (nets.vMotion.vlanId != null) g.vmotionVlan = nets.vMotion.vlanId;
    }
    if (nets.vsan) {
      g.vsanEnabled = true;
      if (nets.vsan.cidr) g.vsanCidr = nets.vsan.cidr;
      if (nets.vsan.vlanId != null) g.vsanVlan = nets.vsan.vlanId;
    }
    if (nets.vmTraffic) {
      if (nets.vmTraffic.cidr) g.vmCidr = nets.vmTraffic.cidr;
      if (nets.vmTraffic.vlanId != null) g.vmVlan = nets.vmTraffic.vlanId;
    }
  }
  if (spec.nestedCluster) {
    const nc = spec.nestedCluster;
    if (nc.hostCount) g.nestedHostCount = nc.hostCount;
    if (nc.vcpuPerHost) g.vcpuPerHost = nc.vcpuPerHost;
    if (nc.vramPerHostGB) g.vramPerHostGB = nc.vramPerHostGB;
    if (nc.bootDiskGB) g.nestedDiskGB = nc.bootDiskGB;
    if (nc.clusterName) g.clusterName = nc.clusterName;
    if (nc.datacenterName) g.datacenterName = nc.datacenterName;
    if (nc.ssoDomain) g.ssoDomain = nc.ssoDomain;
    if (nc.vsanArchitecture) g.vsanArch = nc.vsanArchitecture;
    g.legacyCpuCompat = !!nc.legacyCpuCompatibility;
    if (nc.memoryTiering) {
      g.memTieringEnabled = !!nc.memoryTiering.enabled;
      if (nc.memoryTiering.nvmeSizeGB) g.nvmeSizeGB = nc.memoryTiering.nvmeSizeGB;
      if (nc.memoryTiering.tierNvmePct) g.tierNvmePct = nc.memoryTiering.tierNvmePct;
      if (nc.memoryTiering.physicalDiskIndex != null) g.nvmeTieringDiskIndex = nc.memoryTiering.physicalDiskIndex;
    }
    if (nc.additionalDisks && nc.additionalDisks.length) {
      g.nestedDisks = nc.additionalDisks.map((d) => ({ sizeGB: d.sizeGB, purpose: d.purpose }));
    }
    g.vsanEnabled = !!nc.vsanEnabled;
  }
  if (spec.nsx) {
    g.nsxEnabled = !!spec.nsx.enabled;
    if (spec.nsx.size) g.nsxSize = spec.nsx.size;
    if (spec.nsx.topology) g.nsxTopology = spec.nsx.topology;
    if (spec.nsx.edgeCount) g.nsxEdgeCount = spec.nsx.edgeCount;
    if (spec.nsx.edgeSize) g.nsxEdgeSize = spec.nsx.edgeSize;
    if (spec.nsx.ipAddress) g.nsxIpAddress = spec.nsx.ipAddress;
    if (spec.nsx.bgpLocalAs) g.nsxBgpLocalAs = spec.nsx.bgpLocalAs;
    if (spec.nsx.bgpPeerAs) g.nsxBgpPeerAs = spec.nsx.bgpPeerAs;
    if (spec.nsx.bgpRouteAdvert) g.nsxBgpRouteAdvert = spec.nsx.bgpRouteAdvert;
    if (spec.nsx.bgpPrefixes) g.nsxBgpPrefixes = spec.nsx.bgpPrefixes.join('\n');
    if (spec.nsx.redistConnected != null) g.nsxRedistConnected = !!spec.nsx.redistConnected;
    if (spec.nsx.redistStatic != null) g.nsxRedistStatic = !!spec.nsx.redistStatic;
    if (spec.nsx.redistT1Lb != null) g.nsxRedistT1Lb = !!spec.nsx.redistT1Lb;
  }
  if (spec.workloadVms) {
    g.workloadVmsEnabled = !!spec.workloadVms.enabled;
    if (spec.workloadVms.count) g.workloadVmCount = spec.workloadVms.count;
    if (spec.workloadVms.size) g.workloadVmSize = spec.workloadVms.size;
  }
  if (spec.security) {
    g.isolateLab = !!spec.security.isolateLabSegment;
    if (spec.security.firewallPolicy) g.firewallPolicy = spec.security.firewallPolicy;
    g.internetAccess = !!spec.security.internetAccess;
  }
  if (spec.remoteAccess) {
    if (spec.remoteAccess.method) g.remoteAccessMethod = spec.remoteAccess.method;
    if (spec.remoteAccess.vpnType) g.vpnType = spec.remoteAccess.vpnType;
    if (spec.remoteAccess.vcenterDeploymentSize) g.vcenterSize = spec.remoteAccess.vcenterDeploymentSize;
  }
  if (spec.bundleDepot) {
    g.depotEnabled = !!spec.bundleDepot.enabled;
    if (spec.bundleDepot.mode) g.depotMode = spec.bundleDepot.mode;
    if (spec.bundleDepot.ipAddress) g.depotIpAddress = spec.bundleDepot.ipAddress;
  }
  if (spec.vcf) {
    g.vcfEnabled = !!spec.vcf.enabled;
    if (spec.vcf.sddcManagerIp) g.vcfSddcMgrIp = spec.vcf.sddcManagerIp;
    if (spec.vcf.sddcManagerHostname) g.vcfSddcMgrHostname = spec.vcf.sddcManagerHostname;
    if (spec.vcf.vcenterIp) g.vcfVcenterIp = spec.vcf.vcenterIp;
    if (spec.vcf.vtepCidr) g.vcfVtepCidr = spec.vcf.vtepCidr;
    if (spec.vcf.vtepVlan) g.vcfVtepVlan = spec.vcf.vtepVlan;
    if (spec.vcf.edgeUplink1Cidr) g.vcfEdgeUplink1Cidr = spec.vcf.edgeUplink1Cidr;
    if (spec.vcf.edgeUplink1Vlan) g.vcfEdgeUplink1Vlan = spec.vcf.edgeUplink1Vlan;
    if (spec.vcf.edgeUplink2Cidr) g.vcfEdgeUplink2Cidr = spec.vcf.edgeUplink2Cidr;
    if (spec.vcf.edgeUplink2Vlan) g.vcfEdgeUplink2Vlan = spec.vcf.edgeUplink2Vlan;
  }
  renderStorageDevices(() => {});
  renderNestedDisks(() => {});
}

// --- Troubleshooting mode ---

function toggleTroubleshootingMode() {
  state.troubleshootingMode = !state.troubleshootingMode;
  const badge = document.getElementById('ts-badge');
  if (badge) badge.hidden = !state.troubleshootingMode;

  const tsRailItem = document.querySelector('#rail-steps li[data-step="' + TROUBLESHOOT_STEP + '"]');
  if (tsRailItem) tsRailItem.hidden = !state.troubleshootingMode;

  if (!state.troubleshootingMode && state.step === TROUBLESHOOT_STEP) {
    showStep(TOTAL_STEPS - 2);
  }
  if (state.step === TOTAL_STEPS - 2) {
    const isLastVisible = !state.troubleshootingMode;
    document.getElementById('btn-next').style.display = isLastVisible ? 'none' : 'inline-flex';
  }
}

// ── Mode switching ──────────────────────────────────────────────────────────

function tsSwitchMode(mode) {
  const libPanel      = document.getElementById('ts-library-panel');
  const buildPanel    = document.getElementById('ts-build-panel');
  const sessPanel     = document.getElementById('ts-session-panel');
  const studyPanel    = document.getElementById('ts-studyplan-panel');
  [libPanel, buildPanel, sessPanel, studyPanel].forEach(el => { if (el) el.hidden = true; });

  document.querySelectorAll('.ts-mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode || (mode === 'build' && t.dataset.mode === 'library'));
  });

  if (mode === 'library')   { if (libPanel)   { libPanel.hidden   = false; tsLibLoad(); } }
  else if (mode === 'build')    { if (buildPanel)  buildPanel.hidden  = false; }
  else if (mode === 'session')  { if (sessPanel)   sessPanel.hidden   = false; }
  else if (mode === 'studyplan') { if (studyPanel) { studyPanel.hidden = false; tsRenderStudyPlan(); } }
}

// ── Study Plan ───────────────────────────────────────────────────────────────

const SP_CERT_LABELS = {
  'VCP-VCF-Architect':   'VCP — VCF Architect',
  'VCP-VCF-Admin':       'VCP — VCF Admin',
  'VCP-VCF-Support':     'VCP — VCF Support',
  'VCP-VVF-Admin':       'VCP — VVF Admin',
  'VCP-VVF-Support':     'VCP — VVF Support',
  'VCAP-VCF-Automation': 'VCAP — VCF Automation',
  'VCAP-VCF-Operations': 'VCAP — VCF Operations',
  'VCAP-VCF-Storage':    'VCAP — VCF Storage',
  'VCAP-VCF-VKS':        'VCAP — VCF VKS',
  'VCAP-VCF-Networking': 'VCAP — VCF Networking',
};
const SP_DIFF_ORDER = { easy: 0, medium: 1, hard: 2 };

function tsRenderStudyPlan() {
  const panel = document.getElementById('ts-studyplan-panel');
  if (!panel) return;
  const scenarios = state.tsAllScenarios || [];
  const completed = tsGetCompleted();

  const totalCount = scenarios.length;
  const doneCount  = scenarios.filter(s => completed.has(s.id)).length;
  const overallPct = totalCount ? Math.round(doneCount / totalCount * 100) : 0;

  let html = `<div class="ts-sp-header">
    <span class="ts-sp-overall-label">${doneCount} of ${totalCount} scenario${totalCount !== 1 ? 's' : ''} completed</span>
    <div class="ts-sp-overall-bar-wrap"><div class="ts-sp-overall-bar" style="width:${overallPct}%"></div></div>
  </div>`;

  const certOrder = Object.keys(SP_CERT_LABELS);
  certOrder.forEach(cert => {
    const certScenarios = scenarios
      .filter(s => Array.isArray(s.certRelevance) && s.certRelevance.includes(cert))
      .sort((a, b) => (SP_DIFF_ORDER[a.difficulty] ?? 1) - (SP_DIFF_ORDER[b.difficulty] ?? 1));

    const certTotal = certScenarios.length;
    const certDone  = certScenarios.filter(s => completed.has(s.id)).length;
    const certPct   = certTotal ? Math.round(certDone / certTotal * 100) : 0;
    const label     = SP_CERT_LABELS[cert];

    html += `<div class="ts-sp-cert-section${certTotal === 0 ? ' ts-sp-empty' : ''}">
      <div class="ts-sp-cert-header">
        <span class="ts-sp-cert-title">${escHtml(label)}</span>
        <span class="ts-sp-cert-stats">${certTotal === 0 ? 'No scenarios yet' : `${certDone} / ${certTotal}`}</span>
        ${certTotal > 0 ? `<div class="ts-sp-cert-bar-wrap"><div class="ts-sp-cert-bar" style="width:${certPct}%"></div></div>` : ''}
      </div>`;

    if (certTotal === 0) {
      html += `<p class="ts-sp-no-scenarios">No scenarios available for this certification yet.</p>`;
    } else {
      certScenarios.forEach(s => {
        const isDone   = completed.has(s.id);
        const diffCls  = `ts-diff-${s.difficulty || 'medium'}`;
        const noSnap   = !s.snapshotName ? ' ts-sp-no-snap' : '';
        const snapTitle = !s.snapshotName ? ' title="No snapshot — configure in Scenario Library"' : '';
        html += `<div class="ts-sp-row${isDone ? ' ts-sp-done' : ''}${noSnap}" data-sid="${escHtml(s.id)}">
          <span class="ts-diff-badge ${diffCls}">${escHtml(s.difficulty || '')}</span>
          <span class="ts-sp-row-name">${escHtml(s.name)}</span>
          ${isDone ? '<span class="ts-sp-check">&#10003;</span>' : ''}
          <div class="ts-sp-row-actions">
            <button type="button" class="btn btn-primary btn-sm ts-sp-load-btn" data-sid="${escHtml(s.id)}"${snapTitle}>Load</button>
            <button type="button" class="ts-sp-toggle-btn${isDone ? ' ts-complete-btn-done' : ''}" data-sid="${escHtml(s.id)}">${isDone ? '&#10003; Done' : 'Mark done'}</button>
          </div>
        </div>`;
      });
    }
    html += `</div>`;
  });

  panel.innerHTML = html;

  panel.querySelectorAll('.ts-sp-load-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.sid;
      btn.disabled = true; btn.textContent = 'Loading…';
      try {
        const res  = await fetch('/api/admin/scenario-load', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Load failed');
        tsRenderActiveBanner(data.scenario);
        const note = data.snapshotNote ? `\n\n${data.snapshotNote}` : '';
        if (data.snapshotError) {
          alert(`Scenario loaded: ${data.scenario.name}\n\n⚠ Snapshot revert failed:\n${data.snapshotError}`);
        } else if (data.reverted && data.reverted.length > 0) {
          alert(`Scenario loaded: ${data.scenario.name}\n\nReverted ${data.reverted.length} VM(s): ${data.reverted.map(v => v.name).join(', ')}`);
        } else {
          alert(`Scenario loaded: ${data.scenario.name}${note}`);
        }
      } catch (err) {
        alert('Failed to load scenario: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Load';
      }
    };
  });

  panel.querySelectorAll('.ts-sp-toggle-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.sid;
      tsSetCompleted(id, !tsGetCompleted().has(id));
      tsRenderStudyPlan();
    };
  });
}

// ── Library: load and render ────────────────────────────────────────────────

async function tsLibLoad() {
  const listEl   = document.getElementById('ts-scenario-list');
  const statusEl = document.getElementById('ts-lib-status');
  if (!listEl) return;
  listEl.innerHTML = '<p class="hint">Loading…</p>';

  try {
    // Check for active scenario
    const activeRes  = await fetch('/api/admin/scenario-active');
    const activeData = await activeRes.json();
    tsRenderActiveBanner(activeData.active ? activeData.active.scenario : null);

    // Load full list
    const res  = await fetch('/api/admin/scenario-list');
    const data = await res.json();
    state.tsAllScenarios = data.scenarios || [];
    tsPopulateTopicFilter(state.tsAllScenarios, 'ts-lib-filter-topic');
    tsLibRender();
    if (statusEl) statusEl.textContent = `${state.tsAllScenarios.length} scenario${state.tsAllScenarios.length !== 1 ? 's' : ''} in library`;
  } catch (err) {
    if (listEl) listEl.innerHTML = '<p class="hint" style="color:var(--danger)">Failed to load scenarios: ' + escHtml(err.message) + '</p>';
  }
}

function tsGetCompleted() {
  try { return new Set(JSON.parse(localStorage.getItem('vsphere-completed-scenarios') || '[]')); }
  catch { return new Set(); }
}

function tsSetCompleted(id, done) {
  const c = tsGetCompleted();
  if (done) c.add(id); else c.delete(id);
  localStorage.setItem('vsphere-completed-scenarios', JSON.stringify([...c]));
}

function tsObjectivesHtml(objectives) {
  if (!objectives || objectives.length === 0) return '';
  return `<div class="ts-lib-card-objectives"><span class="ts-obj-label">Objectives</span><ul class="ts-obj-list">${objectives.map(o => `<li>${escHtml(o)}</li>`).join('')}</ul></div>`;
}

function tsLibRender() {
  const listEl  = document.getElementById('ts-scenario-list');
  const search  = (document.getElementById('ts-lib-search')?.value || '').toLowerCase();
  const diff    = document.getElementById('ts-lib-filter-diff')?.value || '';
  const topic   = document.getElementById('ts-lib-filter-topic')?.value || '';
  const cert    = state.tsCertFilter || '';

  const filtered = (state.tsAllScenarios || []).filter(s => {
    if (diff  && s.difficulty !== diff) return false;
    if (topic && !(s.topics || []).includes(topic)) return false;
    if (cert  && !(s.certRelevance || []).includes(cert)) return false;
    if (search && !s.name.toLowerCase().includes(search) && !s.description.toLowerCase().includes(search)) return false;
    return true;
  });

  if (!listEl) return;
  if (filtered.length === 0) { listEl.innerHTML = '<p class="hint">No scenarios match the current filter.</p>'; return; }

  const completed = tsGetCompleted();

  // Update progress summary (counts whole library, not just filtered view)
  const allScenarios = state.tsAllScenarios || [];
  const progressEl   = document.getElementById('ts-lib-progress');
  const barEl        = document.getElementById('ts-progress-bar');
  const labelEl      = document.getElementById('ts-progress-label');
  if (progressEl && allScenarios.length > 0) {
    const doneCount = allScenarios.filter(s => completed.has(s.id)).length;
    const pct       = Math.round((doneCount / allScenarios.length) * 100);
    progressEl.hidden        = false;
    if (barEl)   barEl.style.width = `${pct}%`;
    if (labelEl) labelEl.textContent = `${doneCount} of ${allScenarios.length} completed`;
  } else if (progressEl) {
    progressEl.hidden = true;
  }

  listEl.innerHTML = '';
  filtered.forEach(s => {
    const isDone = completed.has(s.id);
    const certBadges = (s.certRelevance || []).map(c => `<span class="ts-cert-badge ts-cert-badge-${c.toLowerCase().replace(/[^a-z0-9]/g, '-')}">${escHtml(c)}</span>`).join('');
    const card = document.createElement('div');
    card.className = `ts-lib-card${isDone ? ' ts-completed' : ''}`;
    card.innerHTML = `
      <div class="ts-lib-card-main">
        <div class="ts-lib-card-name">${escHtml(s.name)}</div>
        <div class="ts-lib-card-desc">${escHtml(s.description || '')}</div>
        <div class="ts-lib-card-meta">
          <span class="ts-diff-badge ts-diff-${s.difficulty}">${escHtml(s.difficulty || '')}</span>
          ${(s.topics || []).map(t => `<span class="ts-topic-chip-inline">${escHtml(t)}</span>`).join('')}
          ${certBadges}
          ${isDone ? '<span class="ts-completed-badge">✓ Completed</span>' : ''}
          ${s.snapshotName ? '<span class="ts-snapshot-badge">snapshot captured</span>' : '<span class="ts-no-snapshot-badge">no snapshot</span>'}
        </div>
        ${tsObjectivesHtml(s.learningObjectives)}
      </div>
      <div class="ts-lib-card-actions">
        <button type="button" class="btn btn-primary btn-sm ts-load-btn" data-id="${escHtml(s.id)}">Load</button>
        <button type="button" class="btn btn-secondary btn-sm ts-edit-btn" data-id="${escHtml(s.id)}">Edit</button>
        <button type="button" class="btn btn-secondary btn-sm ts-export-btn" data-id="${escHtml(s.id)}">Export</button>
        <button type="button" class="btn btn-danger btn-sm ts-delete-btn" data-id="${escHtml(s.id)}">Delete</button>
        <button type="button" class="btn btn-sm ts-complete-btn ${isDone ? 'ts-complete-btn-done' : 'btn-secondary'}" data-id="${escHtml(s.id)}">${isDone ? '✓ Done' : 'Mark done'}</button>
      </div>`;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('.ts-load-btn').forEach(btn => btn.onclick = () => tsLibLoad_scenario(btn.dataset.id));
  listEl.querySelectorAll('.ts-edit-btn').forEach(btn => btn.onclick = () => tsLibEdit(btn.dataset.id));
  listEl.querySelectorAll('.ts-export-btn').forEach(btn => btn.onclick = () => tsLibExport(btn.dataset.id));
  listEl.querySelectorAll('.ts-delete-btn').forEach(btn => btn.onclick = () => tsLibDelete(btn.dataset.id));
  listEl.querySelectorAll('.ts-complete-btn').forEach(btn => btn.onclick = () => {
    tsSetCompleted(btn.dataset.id, !tsGetCompleted().has(btn.dataset.id));
    tsLibRender();
  });
}

function tsRenderActiveBanner(scenario) {
  const banner = document.getElementById('ts-active-banner');
  const label  = document.getElementById('ts-active-label');
  if (!banner) return;
  if (scenario) {
    if (label) label.textContent = `Active: ${scenario.name}`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function tsPopulateTopicFilter(scenarios, filterId) {
  const sel = document.getElementById(filterId);
  if (!sel) return;
  const topics = [...new Set(scenarios.flatMap(s => s.topics || []))].sort();
  const first  = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(first);
  topics.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
}

async function tsLibLoad_scenario(id) {
  const btn = document.querySelector(`.ts-load-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const res  = await fetch('/api/admin/scenario-load', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Load failed');
    tsRenderActiveBanner(data.scenario);
    if (data.snapshotError) {
      alert(`Scenario loaded: ${data.scenario.name}\n\n⚠ Snapshot revert failed:\n${data.snapshotError}`);
    } else if (data.reverted && data.reverted.length > 0) {
      const names = data.reverted.map(v => v.name).join(', ');
      alert(`Scenario loaded: ${data.scenario.name}\n\nReverted ${data.reverted.length} VM(s): ${names}`);
    } else {
      const note = data.snapshotNote ? `\n\n${data.snapshotNote}` : '';
      alert(`Scenario loaded: ${data.scenario.name}${note}`);
    }
  } catch (err) {
    alert('Failed to load scenario: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
  }
}

// ── vCenter Settings ────────────────────────────────────────────────────────

async function tsVcenterSettingsToggle() {
  const panel = document.getElementById('ts-vcenter-settings');
  if (!panel) return;
  if (panel.hidden) {
    panel.hidden = false;
    await tsVcenterSettingsLoad();
  } else {
    panel.hidden = true;
  }
}

async function tsVcenterSettingsLoad() {
  try {
    const res  = await fetch('/api/admin/vcenter-config');
    const data = await res.json();
    if (data.configured) {
      document.getElementById('vc-server').value   = data.server   || '';
      document.getElementById('vc-user').value     = data.user     || '';
      document.getElementById('vc-insecure').checked = !!data.insecure;
    }
  } catch { /* ignore — fields stay blank */ }
}

async function tsVcenterSave() {
  const server   = (document.getElementById('vc-server')  .value || '').trim();
  const user     = (document.getElementById('vc-user')    .value || '').trim();
  const password =  document.getElementById('vc-password').value || '';
  const insecure =  document.getElementById('vc-insecure').checked;
  const status   =  document.getElementById('vc-status');
  if (!server || !user) { status.textContent = 'Server and username are required.'; status.style.color = 'var(--danger)'; return; }
  try {
    const res  = await fetch('/api/admin/vcenter-config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ server, user, password, insecure }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    status.textContent = 'Saved.';
    status.style.color = 'var(--accent)';
    document.getElementById('vc-password').value = '';
  } catch (err) {
    status.textContent = 'Save failed: ' + err.message;
    status.style.color = 'var(--danger)';
  }
}

async function tsVcenterTest() {
  const status = document.getElementById('vc-status');
  status.textContent = 'Testing…';
  status.style.color = 'var(--text-dim)';
  try {
    const res  = await fetch('/api/admin/vcenter-test', { method: 'POST', headers: {'Content-Type':'application/json'} });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    status.textContent = data.message;
    status.style.color = 'var(--accent)';
  } catch (err) {
    status.textContent = 'Connection failed: ' + err.message;
    status.style.color = 'var(--danger)';
  }
}

function tsLibExport(id) {
  window.location.href = `/api/admin/scenario-export/${encodeURIComponent(id)}`;
}

async function tsLibDelete(id) {
  const s = (state.tsAllScenarios || []).find(x => x.id === id);
  if (!confirm(`Delete scenario "${s ? s.name : id}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/admin/scenario/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    await tsLibLoad();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ── Build / Edit form ───────────────────────────────────────────────────────

function tsLibOpenBuild(scenario) {
  tsSwitchMode('build');
  const buildPanel = document.getElementById('ts-build-panel');
  if (buildPanel) buildPanel.hidden = false;
  document.getElementById('ts-library-panel').hidden = true;
  document.getElementById('ts-build-title').textContent = scenario ? 'Edit Scenario' : 'New Scenario';

  const id = scenario ? scenario.id : '';
  document.getElementById('ts-build-id').value           = id;
  document.getElementById('ts-build-name').value         = scenario ? scenario.name : '';
  document.getElementById('ts-build-desc').value         = scenario ? scenario.description || '' : '';
  document.getElementById('ts-build-difficulty').value   = scenario ? scenario.difficulty || 'medium' : 'medium';
  document.getElementById('ts-build-topics').value       = scenario ? (scenario.topics || []).join(', ') : '';
  document.getElementById('ts-build-exams').value        = scenario ? (scenario.examObjectives || []).join(', ') : '';
  document.getElementById('ts-build-reqs').value         = scenario ? (scenario.labRequirements || []).join(', ') : '';
  document.getElementById('ts-build-scenario').value     = scenario ? scenario.customerScenario || '' : '';
  document.getElementById('ts-build-followup').value     = scenario ? scenario.customerFollowUp || '' : '';
  document.getElementById('ts-build-fixsteps').value     = scenario ? (scenario.fixSteps || []).join('\n') : '';
  document.getElementById('ts-snapshot-name').value      = scenario ? scenario.snapshotName || '' : '';

  // certRelevance checkboxes
  document.querySelectorAll('.ts-cert-check').forEach(cb => {
    cb.checked = !!(scenario && (scenario.certRelevance || []).includes(cb.value));
  });
  // learningObjectives
  const objEl = document.getElementById('ts-build-objectives');
  if (objEl) objEl.value = scenario ? (scenario.learningObjectives || []).join('\n') : '';
  document.getElementById('ts-capture-status').textContent = '';

  // Hints
  const hintsContainer = document.getElementById('ts-build-hints-container');
  if (hintsContainer) {
    hintsContainer.innerHTML = '';
    const hintLabels = ['Level 1 — Customer nudge', 'Level 2 — Technical nudge', 'Level 3 — Specific direction', 'Level 4 — Near-answer', 'Level 5 — Full solution'];
    for (let i = 0; i < 5; i++) {
      const div = document.createElement('div');
      div.className = 'field';
      div.innerHTML = `<label>${escHtml(hintLabels[i])}</label><textarea class="ts-notes ts-hint-input" rows="2" data-hint="${i}" placeholder="${escHtml(hintLabels[i])}"></textarea>`;
      hintsContainer.appendChild(div);
      div.querySelector('textarea').value = scenario && scenario.hints ? (scenario.hints[i] || '') : '';
    }
  }

  // Verify script content (fetch if editing)
  const verifyEl = document.getElementById('ts-build-verify');
  if (verifyEl) {
    verifyEl.value = '';
    if (id) {
      fetch(`/api/admin/scenario-export/${encodeURIComponent(id)}`)
        .then(r => r.json()).then(d => { if (d.verifyScript) verifyEl.value = d.verifyScript; }).catch(() => {});
    }
  }

  const testBtn = document.getElementById('ts-test-btn');
  if (testBtn) testBtn.disabled = !id;
}

function tsLibEdit(id) {
  const s = (state.tsAllScenarios || []).find(x => x.id === id);
  if (s) tsLibOpenBuild(s);
}

async function tsLibSave() {
  const errEl = document.getElementById('ts-build-error');
  if (errEl) errEl.textContent = '';

  const name    = document.getElementById('ts-build-name')?.value.trim();
  if (!name) { if (errEl) errEl.textContent = 'Name is required.'; return; }

  const hints = [];
  document.querySelectorAll('.ts-hint-input').forEach((el, i) => { hints[i] = el.value.trim(); });

  const fixLines = (document.getElementById('ts-build-fixsteps')?.value || '').split('\n')
    .map(l => l.trim().replace(/^\d+[\.\)]\s*/, '')).filter(Boolean);

  const scenario = {
    id:               document.getElementById('ts-build-id')?.value || '',
    name,
    description:      document.getElementById('ts-build-desc')?.value.trim() || '',
    difficulty:       document.getElementById('ts-build-difficulty')?.value || 'medium',
    topics:           (document.getElementById('ts-build-topics')?.value || '').split(',').map(t=>t.trim()).filter(Boolean),
    examObjectives:   (document.getElementById('ts-build-exams')?.value || '').split(',').map(t=>t.trim()).filter(Boolean),
    labRequirements:  (document.getElementById('ts-build-reqs')?.value || '').split(',').map(t=>t.trim()).filter(Boolean),
    certRelevance:    [...document.querySelectorAll('.ts-cert-check:checked')].map(cb => cb.value),
    learningObjectives: (document.getElementById('ts-build-objectives')?.value || '').split('\n').map(l=>l.trim()).filter(Boolean),
    customerScenario: document.getElementById('ts-build-scenario')?.value.trim() || '',
    customerFollowUp: document.getElementById('ts-build-followup')?.value.trim() || '',
    snapshotName:     document.getElementById('ts-snapshot-name')?.value.trim() || '',
    hints,
    fixSteps:         fixLines,
    author:           'Zero to Hero Lab',
    created:          new Date().toISOString().slice(0, 10)
  };

  const verifyScriptContent = document.getElementById('ts-build-verify')?.value.trim() || '';
  const saveBtn = document.getElementById('ts-build-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const res  = await fetch('/api/admin/scenario-save', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ scenario, verifyScriptContent })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    tsSwitchMode('library');
    document.getElementById('ts-library-panel').hidden = false;
    document.getElementById('ts-build-panel').hidden   = true;
    await tsLibLoad();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save to library'; }
  }
}

async function tsCaptureSnapshot() {
  const idEl      = document.getElementById('ts-build-id');
  const nameEl    = document.getElementById('ts-snapshot-name');
  const statusEl  = document.getElementById('ts-capture-status');
  const captureBtn = document.getElementById('ts-capture-btn');

  const id = idEl?.value;
  if (!id) {
    if (statusEl) { statusEl.textContent = 'Save the scenario first, then capture a snapshot.'; statusEl.style.color = 'var(--warn)'; }
    return;
  }

  const buildName = document.getElementById('ts-build-name')?.value.trim();
  const customName = nameEl?.value.trim();
  const snapshotName = customName || `scenario-${buildName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now()}`;

  if (captureBtn) { captureBtn.disabled = true; captureBtn.textContent = 'Creating…'; }
  if (statusEl)   { statusEl.textContent = 'Connecting to vCenter…'; statusEl.style.color = 'var(--text-dim)'; }

  try {
    const res  = await fetch('/api/admin/scenario-capture', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id, snapshotName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Capture failed');

    if (nameEl) nameEl.value = data.snapshotName;

    if (data.vcenterNote) {
      if (statusEl) { statusEl.textContent = `Name saved: ${data.snapshotName}. ${data.vcenterNote}`; statusEl.style.color = 'var(--text-dim)'; }
    } else if (data.vcenterError) {
      if (statusEl) { statusEl.textContent = `Name saved but vCenter error: ${data.vcenterError}`; statusEl.style.color = 'var(--warn)'; }
    } else {
      const vmList = (data.created || []).map(v => v.name).join(', ');
      const errCount = (data.errors || []).length;
      const errNote = errCount > 0 ? ` (${errCount} VM(s) failed — check vCenter)` : '';
      if (statusEl) { statusEl.textContent = `Snapshot '${data.snapshotName}' created on ${(data.created || []).length} VM(s): ${vmList}${errNote}`; statusEl.style.color = 'var(--accent)'; }
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Capture failed: ' + err.message; statusEl.style.color = 'var(--danger)'; }
  } finally {
    if (captureBtn) { captureBtn.disabled = false; captureBtn.textContent = 'Capture snapshot'; }
  }
}

async function tsLibImport(file) {
  const statusEl = document.getElementById('ts-lib-status');
  try {
    const text = await file.text();
    const bundle = JSON.parse(text);
    const res  = await fetch('/api/admin/scenario-import', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ bundle })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    if (statusEl) statusEl.textContent = `Imported: ${data.name}. Note: imported scenarios have no local snapshot — introduce the fault manually, then capture a new snapshot.`;
    await tsLibLoad();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Import failed: ' + err.message;
  }
}

// ── Troubleshooter: initialise ──────────────────────────────────────────────

function initTroubleshootStep() {
  state.troubleshootPhase           = 1;
  state.troubleshootToken           = null;
  state.troubleshootScenario        = null;
  state.troubleshootClueText        = null;
  state.troubleshootClueUsed        = false;
  state.troubleshootNotes           = '';
  state.troubleshootTicket          = null;
  state.troubleshootTicketSubmitted = false;
  state.troubleshootHintLevel       = 0;
  state.troubleshootHints           = {};
  state.troubleshootResolved        = false;
  state.troubleshootSessionData     = null;
  state.tsAllScenarios              = [];
  state.tsCertFilter                = '';
  state.troubleshootLearningMode    = false;
  state.tsMethodology               = { symptom: '', scope: '', layer: '' };

  // Default to library mode when the step opens
  tsSwitchMode('library');

  // Wire mode tabs — the session tab opens the troubleshoot mode selector (phase 0)
  document.querySelectorAll('.ts-mode-tab').forEach(tab => {
    tab.onclick = () => {
      if (tab.dataset.mode === 'session') { tsSwitchMode('session'); tsShowPhase(0); tsWirePhase0(); }
      else if (tab.dataset.mode === 'studyplan') { tsSwitchMode('studyplan'); }
      else tsSwitchMode('library');
    };
  });

  // Wire build form buttons
  const newBtn  = document.getElementById('ts-new-scenario-btn');
  const saveBtn = document.getElementById('ts-build-save');
  const cancelBtn = document.getElementById('ts-build-cancel');
  const closeBtn  = document.getElementById('ts-build-close');
  const captureBtn = document.getElementById('ts-capture-btn');
  const importFile = document.getElementById('ts-import-file');
  const unloadBtn  = document.getElementById('ts-unload-btn');
  const vcSettingsBtn = document.getElementById('ts-vcenter-settings-btn');
  const vcSaveBtn     = document.getElementById('vc-save-btn');
  const vcTestBtn     = document.getElementById('vc-test-btn');

  if (vcSettingsBtn) vcSettingsBtn.onclick = () => tsVcenterSettingsToggle();
  if (vcSaveBtn)     vcSaveBtn.onclick     = () => tsVcenterSave();
  if (vcTestBtn)     vcTestBtn.onclick     = () => tsVcenterTest();

  if (newBtn)    newBtn.onclick    = () => tsLibOpenBuild(null);
  if (saveBtn)   saveBtn.onclick   = () => tsLibSave();
  if (cancelBtn) cancelBtn.onclick = () => { tsSwitchMode('library'); document.getElementById('ts-build-panel').hidden = true; document.getElementById('ts-library-panel').hidden = false; };
  if (closeBtn)  closeBtn.onclick  = () => cancelBtn?.click();
  if (captureBtn) captureBtn.onclick = () => tsCaptureSnapshot();
  if (unloadBtn) unloadBtn.onclick = async () => {
    await fetch('/api/admin/scenario-unload', { method: 'POST' });
    tsRenderActiveBanner(null);
  };
  if (importFile) importFile.onchange = (e) => {
    const f = e.target.files[0];
    if (f) tsLibImport(f);
    e.target.value = '';
  };

  // Wire library search/filter
  document.getElementById('ts-lib-search')?.addEventListener('input',  tsLibRender);
  document.getElementById('ts-lib-filter-diff')?.addEventListener('change',  tsLibRender);
  document.getElementById('ts-lib-filter-topic')?.addEventListener('change', tsLibRender);

  // Wire cert filter chips
  document.querySelectorAll('.ts-cert-chip').forEach(chip => {
    chip.onclick = () => {
      state.tsCertFilter = chip.dataset.cert || '';
      document.querySelectorAll('.ts-cert-chip').forEach(c => c.classList.toggle('active', c === chip));
      tsLibRender();
    };
  });
}

// ── Phase helpers ───────────────────────────────────────────────────────────

function tsShowPhase(n) {
  state.troubleshootPhase = n;
  for (let i = 0; i <= 4; i++) {
    const el = document.getElementById(`ts-phase-${i}`);
    if (el) el.hidden = i !== n;
  }
}

// ── Phase 0: Troubleshoot mode selector (Fix vs Learn) ──────────────────────
function tsWirePhase0() {
  const fixBtn   = document.getElementById('ts-mode-fix');
  const learnBtn = document.getElementById('ts-mode-learn');
  const proceed = (learning) => {
    state.troubleshootLearningMode = learning;
    tsShowPhase(1);
    tsWirePhase1();
  };
  if (fixBtn)   fixBtn.onclick   = () => proceed(false);
  if (learnBtn) learnBtn.onclick = () => proceed(true);
}

// ── Phase 1: Lab confirmation ───────────────────────────────────────────────

function tsWirePhase1() {
  const methodology = document.getElementById('ts-learn-methodology');
  if (methodology) methodology.hidden = !state.troubleshootLearningMode;

  const check1   = document.getElementById('ts-check-1');
  const check2   = document.getElementById('ts-check-2');
  const startBtn = document.getElementById('ts-start-btn');

  if (check1) check1.checked = false;
  if (check2) check2.checked = false;
  if (startBtn) startBtn.disabled = true;

  const updateStart = () => { if (startBtn) startBtn.disabled = !(check1?.checked && check2?.checked); };
  check1?.addEventListener('change', updateStart);
  check2?.addEventListener('change', updateStart);

  if (startBtn) startBtn.onclick = () => { tsShowPhase(2); tsWirePhase2(); };
}

// ── Phase 2: Scenario picker ────────────────────────────────────────────────

async function tsWirePhase2() {
  const adminBanner = document.getElementById('ts-admin-loaded');
  const selfPicker  = document.getElementById('ts-self-picker');
  const errEl       = document.getElementById('ts-pick-error');
  if (errEl) errEl.textContent = '';

  // Check if admin has loaded a scenario
  try {
    const res  = await fetch('/api/admin/scenario-active');
    const data = await res.json();
    if (data.active && data.active.scenario) {
      const s = data.active.scenario;
      if (adminBanner) adminBanner.hidden = false;
      if (selfPicker)  selfPicker.hidden  = true;
      const nameEl = document.getElementById('ts-admin-loaded-name');
      const metaEl = document.getElementById('ts-admin-loaded-meta');
      if (nameEl) nameEl.textContent = s.name;
      if (metaEl) metaEl.textContent = [s.difficulty, ...(s.topics || [])].join(' · ');

      document.getElementById('ts-use-active-btn').onclick = () => tsStartSession(s.id);
      document.getElementById('ts-pick-own-btn').onclick   = () => {
        if (adminBanner) adminBanner.hidden = true;
        if (selfPicker)  selfPicker.hidden  = false;
        tsLoadPickList();
      };
    } else {
      if (adminBanner) adminBanner.hidden = true;
      if (selfPicker)  selfPicker.hidden  = false;
      tsLoadPickList();
    }
  } catch {
    if (adminBanner) adminBanner.hidden = true;
    if (selfPicker)  selfPicker.hidden  = false;
    tsLoadPickList();
  }

  document.getElementById('ts-pick-back').onclick = () => { tsShowPhase(1); tsWirePhase1(); };
}

async function tsLoadPickList() {
  const listEl = document.getElementById('ts-pick-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="hint">Loading…</p>';

  try {
    const res  = await fetch('/api/admin/scenario-list');
    const data = await res.json();
    const scenarios = data.scenarios || [];
    tsPopulateTopicFilter(scenarios, 'ts-pick-topic');
    state.tsPickScenarios = scenarios;
    tsRenderPickList();

    document.getElementById('ts-pick-diff')?.addEventListener('change',  tsRenderPickList);
    document.getElementById('ts-pick-topic')?.addEventListener('change', tsRenderPickList);
  } catch (err) {
    listEl.innerHTML = '<p class="hint" style="color:var(--danger)">Could not load scenarios: ' + escHtml(err.message) + '</p>';
  }
}

function tsRenderPickList() {
  const listEl = document.getElementById('ts-pick-list');
  if (!listEl) return;
  const diff  = document.getElementById('ts-pick-diff')?.value  || '';
  const topic = document.getElementById('ts-pick-topic')?.value || '';

  const filtered = (state.tsPickScenarios || []).filter(s => {
    if (diff  && s.difficulty !== diff) return false;
    if (topic && !(s.topics || []).includes(topic)) return false;
    return true;
  });

  if (filtered.length === 0) { listEl.innerHTML = '<p class="hint">No scenarios match.</p>'; return; }

  listEl.innerHTML = '';
  filtered.forEach(s => {
    const card = document.createElement('div');
    card.className = 'ts-lib-card ts-pick-card';
    card.innerHTML = `
      <div class="ts-lib-card-main">
        <div class="ts-lib-card-name">${escHtml(s.name)}</div>
        <div class="ts-lib-card-desc">${escHtml(s.description || '')}</div>
        <div class="ts-lib-card-meta">
          <span class="ts-diff-badge ts-diff-${s.difficulty}">${escHtml(s.difficulty || '')}</span>
          ${(s.topics || []).map(t => `<span class="ts-topic-chip-inline">${escHtml(t)}</span>`).join('')}
          ${(s.certRelevance || []).map(c => `<span class="ts-cert-badge ts-cert-badge-${c.toLowerCase().replace(/[^a-z0-9]/g, '-')}">${escHtml(c)}</span>`).join('')}
        </div>
        ${tsObjectivesHtml(s.learningObjectives)}
      </div>
      <div class="ts-lib-card-actions">
        <button type="button" class="btn btn-primary btn-sm" data-id="${escHtml(s.id)}">Select</button>
      </div>`;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('button[data-id]').forEach(btn => btn.onclick = () => tsStartSession(btn.dataset.id));
}

async function tsStartSession(id) {
  const errEl = document.getElementById('ts-pick-error');
  if (errEl) errEl.textContent = '';
  try {
    const res  = await fetch('/api/troubleshoot/start', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start session');
    state.troubleshootToken    = data.token;
    state.troubleshootScenario = { id, callerName: data.callerName, message: data.scenarioMessage, name: data.scenarioName };
    tsShowPhase(3);
    tsWirePhase3();
  } catch (err) {
    if (errEl) errEl.textContent = 'Could not start session: ' + err.message;
  }
}

// ── Phase 3: Investigation ──────────────────────────────────────────────────

function tsWirePhase3() {
  const scenario = state.troubleshootScenario;
  if (!scenario) return;

  const headerEl  = document.getElementById('ts-scenario-header');
  const messageEl = document.getElementById('ts-scenario-message');
  if (headerEl)  headerEl.innerHTML  = `<span class="ts-caller-icon">&#128222;</span><strong class="ts-caller-name">${escHtml(scenario.callerName || 'Customer')}</strong>`;
  if (messageEl) messageEl.textContent = scenario.message || '';

  // Learning mode: guided methodology prompts above the investigation notes.
  const promptsPanel = document.getElementById('ts-learn-prompts');
  if (promptsPanel) {
    promptsPanel.hidden = !state.troubleshootLearningMode;
    if (state.troubleshootLearningMode) {
      const sym = document.getElementById('ts-prompt-symptom-text');
      const scp = document.getElementById('ts-prompt-scope-text');
      const lay = document.getElementById('ts-prompt-layer-select');
      if (sym) { sym.value = state.tsMethodology.symptom; sym.oninput = () => { state.tsMethodology.symptom = sym.value; }; }
      if (scp) { scp.value = state.tsMethodology.scope;   scp.oninput = () => { state.tsMethodology.scope = scp.value; }; }
      if (lay) { lay.value = state.tsMethodology.layer;   lay.onchange = () => { state.tsMethodology.layer = lay.value; }; }
    }
  }

  const notesEl = document.getElementById('ts-notes');
  if (notesEl) {
    notesEl.value = state.troubleshootNotes;
    notesEl.oninput = () => { state.troubleshootNotes = notesEl.value; };
  }

  const askBtn = document.getElementById('ts-ask-customer');
  if (askBtn) { askBtn.disabled = state.troubleshootClueUsed; askBtn.onclick = () => tsAskCustomer(); }

  const logTicketBtn = document.getElementById('ts-log-ticket-btn');
  const ticketPanel  = document.getElementById('ts-ticket-panel');
  if (logTicketBtn) {
    logTicketBtn.hidden = state.troubleshootTicketSubmitted;
    logTicketBtn.onclick = () => { if (ticketPanel) ticketPanel.hidden = false; logTicketBtn.hidden = true; };
  }

  document.getElementById('ts-ticket-cancel').onclick = () => {
    if (ticketPanel) ticketPanel.hidden = true;
    if (logTicketBtn) logTicketBtn.hidden = false;
  };
  document.getElementById('ts-ticket-submit').onclick = () => tsSubmitTicket();

  const hintBtn = document.getElementById('ts-request-hint');
  if (hintBtn) {
    hintBtn.disabled = !state.troubleshootTicketSubmitted;
    hintBtn.title    = state.troubleshootTicketSubmitted ? 'Request the next hint' : 'Submit a ticket first to unlock hints';
    hintBtn.onclick  = () => tsRequestHint();
  }

  document.getElementById('ts-mark-resolved').onclick = () => tsMarkResolved();

  if (state.troubleshootClueText) {
    const clueEl = document.getElementById('ts-scenario-clue');
    if (clueEl) { clueEl.hidden = false; clueEl.textContent = state.troubleshootClueText; }
  }
  if (state.troubleshootTicketSubmitted) tsShowTicketConfirm();
  if (state.troubleshootHintLevel > 0) {
    const panel = document.getElementById('ts-hints-panel');
    if (panel) panel.hidden = false;
    tsRenderHints();
  }
}

async function tsAskCustomer() {
  const askBtn = document.getElementById('ts-ask-customer');
  if (askBtn) { askBtn.disabled = true; askBtn.textContent = 'Asking…'; }
  try {
    const res  = await fetch('/api/troubleshoot/customer-info', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token: state.troubleshootToken }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.troubleshootClueText = data.clue;
    state.troubleshootClueUsed = true;
    const clueEl = document.getElementById('ts-scenario-clue');
    if (clueEl) { clueEl.hidden = false; clueEl.textContent = data.clue; }
  } catch { /* leave button disabled */ }
  if (askBtn) askBtn.textContent = 'Ask customer for more info';
}

function tsSubmitTicket() {
  const symptom = document.getElementById('ts-symptom')?.value.trim();
  const tried   = document.getElementById('ts-tried')?.value.trim();
  const cause   = document.getElementById('ts-cause')?.value.trim();
  const impact  = document.getElementById('ts-impact')?.value.trim();
  const errEl   = document.getElementById('ts-ticket-error');
  if (!symptom) { if (errEl) errEl.textContent = 'Symptom is required.'; return; }
  if (errEl) errEl.textContent = '';
  state.troubleshootTicket = { symptom, tried, cause, impact };
  state.troubleshootTicketSubmitted = true;
  fetch('/api/troubleshoot/ticket', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token: state.troubleshootToken, ticket: state.troubleshootTicket }) });
  document.getElementById('ts-ticket-panel').hidden = true;
  document.getElementById('ts-log-ticket-btn').hidden = true;
  tsShowTicketConfirm();
  const hintBtn = document.getElementById('ts-request-hint');
  if (hintBtn) { hintBtn.disabled = false; hintBtn.title = 'Request the next hint'; }
}

function tsShowTicketConfirm() {
  let confirm = document.getElementById('ts-ticket-logged-confirm');
  if (!confirm) {
    confirm = document.createElement('p');
    confirm.id = 'ts-ticket-logged-confirm';
    confirm.className = 'ts-ticket-logged hint';
    document.querySelector('.ts-action-row')?.insertAdjacentElement('afterend', confirm);
  }
  confirm.textContent = 'Ticket logged — hints are now available.';
}

async function tsRequestHint() {
  const nextLevel = state.troubleshootHintLevel + 1;
  if (nextLevel > 5) return;
  const hintBtn = document.getElementById('ts-request-hint');
  if (hintBtn) { hintBtn.disabled = true; hintBtn.textContent = 'Loading…'; }
  try {
    const res  = await fetch('/api/troubleshoot/hint', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token: state.troubleshootToken, level: nextLevel }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.troubleshootHintLevel = nextLevel;
    state.troubleshootHints[nextLevel] = data.hint;
    const panel = document.getElementById('ts-hints-panel');
    if (panel) panel.hidden = false;
    tsRenderHints();
    if (hintBtn) { hintBtn.disabled = nextLevel >= 5; hintBtn.textContent = nextLevel >= 5 ? 'No more hints' : 'Request hint'; }
  } catch (err) {
    if (hintBtn) { hintBtn.disabled = false; hintBtn.textContent = 'Request hint'; }
  }
}

function tsRenderHints() {
  const container = document.getElementById('ts-hints-container');
  const badge     = document.getElementById('ts-hint-level-badge');
  if (!container) return;
  if (badge) badge.textContent = `Level ${state.troubleshootHintLevel} of 5`;
  const levelLabels = ['Customer nudge', 'Technical nudge', 'Specific direction', 'Near-answer', 'Full solution'];
  const hintMeta = [
    'This hint teaches you to identify which layer the fault is at — before checking specific components.',
    'This hint teaches you to check the calling machine before assuming the target is broken — one of the most common troubleshooting mistakes.',
    'This hint shows you exactly where to look in the UI or CLI — this is the diagnostic step a senior engineer would do first.',
    'This hint describes what you will see when you look at the right place. You still have to find it and fix it.',
    'Full solution — exact command or click sequence. Review this carefully to understand the fix.'
  ];
  container.innerHTML = '';
  Object.entries(state.troubleshootHints).forEach(([level, text]) => {
    const i    = Number(level) - 1;
    const card = document.createElement('div');
    card.className = 'ts-hint-card revealed';
    const hdr  = document.createElement('div');
    hdr.className = 'ts-hint-header';
    const lbadge = document.createElement('span');
    lbadge.className = 'ts-hint-level-badge';
    lbadge.textContent = `Level ${level}: ${levelLabels[i] || ''}`;
    hdr.appendChild(lbadge);
    card.appendChild(hdr);
    if (state.troubleshootLearningMode && hintMeta[i]) {
      const meta = document.createElement('div');
      meta.className = 'ts-hint-meta';
      meta.textContent = hintMeta[i];
      card.appendChild(meta);
    }
    const body = document.createElement('div');
    body.className = 'ts-hint-body';
    body.textContent = text;
    card.appendChild(body);
    container.appendChild(card);
  });
}

async function tsMarkResolved() {
  state.troubleshootResolved = true;
  try {
    const res  = await fetch('/api/troubleshoot/debrief', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token: state.troubleshootToken, ticket: state.troubleshootTicket }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.troubleshootSessionData = data;
    tsShowPhase(4);
    tsWirePhase4(data);
  } catch {
    tsShowPhase(4);
    tsWirePhase4(null);
  }
}

// ── Phase 4: Debrief ────────────────────────────────────────────────────────

function tsWirePhase4(data) {
  const faultEl      = document.getElementById('ts-debrief-fault');
  const statsEl      = document.getElementById('ts-debrief-stats');
  const ticketEl     = document.getElementById('ts-debrief-ticket');
  const objectivesEl = document.getElementById('ts-debrief-objectives');

  if (faultEl && data) {
    faultEl.innerHTML = `
      <h3 class="ts-debrief-heading">What the fault was</h3>
      <p class="ts-debrief-fault-text">${escHtml(data.faultDescription)}</p>
      <div class="ts-fix-steps"><strong>Fix steps:</strong><ol>
        ${(data.fixSteps || []).map(s => `<li>${escHtml(s)}</li>`).join('')}
      </ol></div>`;
  }

  if (statsEl && data) {
    const hintFeedback = ['', 'Excellent — solved without any hints.', 'Strong — solved with just a gentle nudge.', 'Good — needed some direction but got there.', 'Getting there — needed specific guidance.', 'Used the full hint chain — review this topic area.'];
    statsEl.innerHTML = `
      <div class="ts-debrief-stat-grid">
        <div class="ts-debrief-stat"><span class="ts-stat-label">Hints used</span><span class="ts-stat-value">${state.troubleshootHintLevel} of 5</span></div>
        <div class="ts-debrief-stat"><span class="ts-stat-label">Ticket quality</span><span class="ts-stat-value">${data.ticketScore || '—'}</span></div>
        <div class="ts-debrief-stat"><span class="ts-stat-label">Customer info</span><span class="ts-stat-value">${state.troubleshootClueUsed ? 'Used' : 'Not used'}</span></div>
      </div>
      ${hintFeedback[state.troubleshootHintLevel] ? `<p class="ts-hint-feedback">${hintFeedback[state.troubleshootHintLevel]}</p>` : ''}
      ${data.ticketAnalysis ? `<p class="ts-ticket-analysis">${escHtml(data.ticketAnalysis)}</p>` : ''}`;
  }

  if (ticketEl && state.troubleshootTicket) {
    const t = state.troubleshootTicket;
    ticketEl.innerHTML = `
      <h3 class="ts-debrief-heading">Your ticket</h3>
      <table class="ts-debrief-table">
        <tr><td>Symptom</td><td>${escHtml(t.symptom || '—')}</td></tr>
        <tr><td>Steps tried</td><td>${escHtml(t.tried || '—')}</td></tr>
        <tr><td>Suspected cause</td><td>${escHtml(t.cause || '—')}</td></tr>
        <tr><td>Impact</td><td>${escHtml(t.impact || '—')}</td></tr>
      </table>`;
  }

  if (objectivesEl && data) {
    objectivesEl.innerHTML = `
      <h3 class="ts-debrief-heading">Exam objectives covered</h3>
      <p>${escHtml(data.objectives || '—')}</p>`;
  }

  const learnDebrief = document.getElementById('ts-learn-debrief');
  if (learnDebrief) {
    learnDebrief.hidden = !(state.troubleshootLearningMode && data);
    if (state.troubleshootLearningMode && data) {
      learnDebrief.innerHTML = tsBuildLearnDebrief(data);
    }
  }

  // Auto-mark scenario complete on successful debrief
  if (data && state.troubleshootScenario?.id) {
    tsSetCompleted(state.troubleshootScenario.id, true);
    if (statsEl) {
      const note = document.createElement('p');
      note.className = 'ts-debrief-completed-note';
      note.textContent = '✓ Scenario marked as completed in your library.';
      statsEl.appendChild(note);
    }
  }

  // In architect mode, log the troubleshoot fault as a risk register entry
  if (state.architectMode && data && data.faultDescription) {
    const topicsStr = (data.topics || '').toLowerCase();
    const likelihood = state.troubleshootHintLevel >= 3 ? 'high' : 'medium';
    const impact = /vsan|storage|network|routing|bgp/.test(topicsStr) ? 'high' : 'medium';
    addAutoRisk(
      `${data.faultDescription} (identified in troubleshoot session)`,
      likelihood,
      impact,
      (data.fixSteps && data.fixSteps.length) ? `Fix: ${data.fixSteps[0]}` : 'Review fix steps in troubleshoot debrief'
    );
  }

  document.getElementById('ts-another-scenario').onclick = () => {
    state.troubleshootToken = null; state.troubleshootScenario = null;
    state.troubleshootClueText = null; state.troubleshootClueUsed = false;
    state.troubleshootNotes = ''; state.troubleshootTicket = null;
    state.troubleshootTicketSubmitted = false; state.troubleshootHintLevel = 0;
    state.troubleshootHints = {}; state.troubleshootResolved = false;
    state.troubleshootSessionData = null;
    tsShowPhase(2); tsWirePhase2();
  };
  document.getElementById('ts-end-session').onclick    = () => initTroubleshootStep();
  document.getElementById('ts-download-summary').onclick = () => tsDownloadSummary(data);
}

// Builds the enhanced learning-mode debrief HTML: the "why" behind the fault,
// what made it hard, a topic learning point, a methodology scorecard, and a
// connection back to wizard design decisions where relevant.
function tsBuildLearnDebrief(data) {
  const topicsStr = (data.topics || '').toLowerCase();
  const topicList = (data.topics || '').split(',').map(s => s.trim()).filter(Boolean);
  const topicArea = topicList[0] || 'this area';
  const fault = data.faultDescription || 'a misconfiguration';

  // Topic-specific learning point.
  let learningPoint;
  if (/dns/.test(topicsStr)) {
    learningPoint = 'Always validate both forward and reverse DNS records — missing PTR records cause failures in systems that validate identity by reverse lookup, not just forward resolution.';
  } else if (/bgp|routing|nsx-routing/.test(topicsStr)) {
    learningPoint = 'Routing faults are almost always symmetric — check that AS numbers, neighbour IPs, and advertised prefixes match on both ends before assuming a device is broken.';
  } else if (/vsan|storage/.test(topicsStr)) {
    learningPoint = 'Storage faults often present as latency or VM hangs rather than outright errors — check vSAN health and disk-group status before blaming the workload.';
  } else if (/vlan|network|networking|portgroup/.test(topicsStr)) {
    learningPoint = 'A single mismatched VLAN tag or trunk setting can isolate traffic silently — verify tagging end-to-end from the port group to the physical uplink.';
  } else if (/cert|identity|sso|ad/.test(topicsStr)) {
    learningPoint = 'Identity and certificate faults cascade — one expired or mismatched certificate can break authentication across multiple services at once.';
  } else {
    learningPoint = 'Work from the symptom toward the cause methodically — confirm each layer before moving to the next rather than guessing.';
  }

  // "What made it hard" framing based on difficulty.
  let hardness;
  if (data.difficulty === 'hard') {
    hardness = 'The symptom pointed away from the root cause — a classic misdirection pattern. The obvious component looked healthy while the real fault sat one layer deeper.';
  } else if (data.difficulty === 'easy') {
    hardness = 'The fault was relatively localised, but it still rewards a disciplined check of the calling side before assuming the target is broken.';
  } else {
    hardness = 'The symptom did not map cleanly onto a single component, so scoping the impact was essential before diving into any one layer.';
  }

  // Methodology scorecard.
  const scoped   = !!(state.tsMethodology.scope && state.tsMethodology.scope.trim());
  const layered  = !!(state.tsMethodology.layer && state.tsMethodology.layer.trim());
  const hints    = state.troubleshootHintLevel;
  const ticket   = state.troubleshootTicket || {};
  const allFour  = !!(ticket.symptom && ticket.tried && ticket.cause && ticket.impact);
  const mark = (ok) => ok ? '&#10003;' : '&#10007;';
  let hintQuality;
  if (hints === 0) hintQuality = '&#10003; Excellent — no hints needed';
  else if (hints <= 2) hintQuality = '&#10003; Strong — solved with minimal guidance';
  else if (hints <= 4) hintQuality = '&#10003; Good — needed some direction';
  else hintQuality = '&#10007; Used the full hint chain';

  let pattern;
  if (hints === 0) pattern = 'Independent — solved without guidance';
  else if (hints > 3) pattern = `Developing — consider reviewing the ${topicArea} area before your exam`;
  else pattern = 'Methodical — used guidance proportionately';

  // Connection back to wizard design decisions, if a learning-mode design was loaded.
  let connection = '';
  const spec = state.troubleshootSpec || state.generated?.spec || null;
  if (spec && spec.learningMode && spec.designRationale &&
      (spec.designRationale.networkSecurity || spec.designRationale.routerChoice)) {
    connection = `
      <h3 class="ts-debrief-heading">Connecting back to your design</h3>
      <p>Looking back at your design decisions — did anything you chose make this fault harder or easier to diagnose?</p>`;
  }

  return `
    <h3 class="ts-debrief-heading">Why did this fault happen?</h3>
    <p>${escHtml(fault)} Faults like this typically stem from a configuration value that drifted out of sync with what another component expects.</p>

    <h3 class="ts-debrief-heading">What made it hard to spot?</h3>
    <p>${escHtml(hardness)}</p>

    <h3 class="ts-debrief-heading">What does this teach you about ${escHtml(topicArea)}?</h3>
    <p>${escHtml(learningPoint)}</p>

    <h3 class="ts-debrief-heading">How would you prevent this in future?</h3>
    <p>Build a verification checklist for ${escHtml(topicArea)} and run it after every change — most faults of this kind are caught by confirming both ends of a configuration agree before declaring work done.</p>

    <h3 class="ts-debrief-heading">Methodology scorecard</h3>
    <ul class="ts-methodology-scorecard">
      <li>${mark(scoped)} Scoped the problem before diving in</li>
      <li>${mark(layered)} Identified a starting layer</li>
      <li>${hintQuality}</li>
      <li>${mark(allFour)} Ticket submitted with all four fields</li>
    </ul>
    <p class="ts-methodology-pattern"><strong>Your troubleshooting pattern:</strong> ${escHtml(pattern)}</p>
    ${connection}`;
}

function tsDownloadSummary(data) {
  if (!data) return;
  const t = state.troubleshootTicket || {};
  const lines = [
    '# Troubleshooting Session Summary',
    '',
    `Date: ${new Date().toLocaleDateString()}`,
    `Scenario: ${data.scenarioName || '—'}`,
    '',
    '## Fault',
    data.faultDescription || '—',
    '',
    '## Fix steps',
    ...(data.fixSteps || []).map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Exam objectives',
    data.objectives || '—',
    '',
    '## Performance',
    `- Hints used: ${state.troubleshootHintLevel} of 5`,
    `- Ticket quality: ${data.ticketScore || '—'}`,
    `- Customer info used: ${state.troubleshootClueUsed ? 'Yes' : 'No'}`,
    '',
    '## Your ticket',
    `- Symptom: ${t.symptom || '—'}`,
    `- Steps tried: ${t.tried || '—'}`,
    `- Suspected cause: ${t.cause || '—'}`,
    `- Impact: ${t.impact || '—'}`
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'troubleshoot-session.md';
  a.click();
}

// --- Generate ---

function renderWarnings(warnings) {
  const block = document.getElementById('warnings-block');
  block.innerHTML = '';
  if (!warnings || !warnings.length) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  const h3 = document.createElement('h3');
  h3.textContent = 'Sizing warnings';
  const ul = document.createElement('ul');
  warnings.forEach((w) => {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  });
  block.append(h3, ul);
}

function renderDownloads(id, generatedScripts, svgGenerated) {
  const container = document.getElementById('downloads');
  container.innerHTML = '';

  function makeLink(kind) {
    const a = document.createElement('a');
    a.className = 'btn btn-secondary';
    a.href = `/api/download/${id}/${kind}`;
    a.download = SCRIPT_LABELS[kind];
    a.textContent = SCRIPT_LABELS[kind];
    return a;
  }

  // Always-present reference files
  container.appendChild(makeLink('prerequisites'));
  container.appendChild(makeLink('lab-config'));
  container.appendChild(makeLink('lab-config-example'));
  container.appendChild(makeLink('spec'));
  container.appendChild(makeLink('design-doc'));
  container.appendChild(makeLink('build-guide'));
  container.appendChild(makeLink('diagram-html'));
  if (generatedScripts.includes('depot-instructions')) {
    container.appendChild(makeLink('depot-instructions'));
  }

  // SVG diagram — only when mmdc rendered it successfully
  if (svgGenerated) {
    container.appendChild(makeLink('network-diagram'));
  }

  // Script files in deployment order
  const scriptOrder = [
    'vyos-deploy', 'vyos-config', 'dc-deploy', 'deploy-lab', 'vcenter-deploy',
    'vsan-cluster', 'memory-tiering',
    'depot-deploy', 'depot-configure', 'depot-iis',
    'deploy-workloads', 'jumpbox-deploy', 'wireguard-server', 'vyos-site-to-site',
    'nsx-deploy', 'nsx-configure', 'nsx-bgp'
  ];
  for (const kind of scriptOrder) {
    if (generatedScripts.includes(kind)) container.appendChild(makeLink(kind));
  }
}

function wireGenerate() {
  const btn = document.getElementById('btn-generate');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Generating…';

    const errBlock = document.getElementById('generate-error-block');
    errBlock.hidden = true;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...state.answers,
          learningMode: state.learningMode,
          designRationale: state.designRationale,
          architectMode: state.architectMode,
          discovery: state.discovery,
          decisionLog: state.decisionLog,
          riskRegister: state.riskRegister
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const details = Array.isArray(data.details) && data.details.length ? data.details : null;
        if (details) {
          // step: data-step value (0-indexed); railNum: user-visible step number shown in rail
          const sectionHint = (msg) => {
            const map = [
              [/^(cpuCores|ramGB|nicCount|nicSpeed|nicModel|hostCount)/,        {label: 'Physical host',     step: 0,  railNum: 1}],
              [/^storageDevice/,                                                {label: 'Storage',           step: 2,  railNum: 3}],
              [/^(mgmtCidr|mgmtVlan|vmotionCidr|vmotionVlan|vsanCidr|vsanVlan|vmCidr|vmVlan)/, {label: 'Lab networks',     step: 7,  railNum: 8}],
              [/^(dcIpAddress|dcDomainName)/,                                  {label: 'Domain controller', step: 6,  railNum: 7}],
              [/^(vyosNetworkMode)/,                                            {label: 'Virtual router',    step: 5,  railNum: 6}],
              [/^(nestedHostCount|vcpuPerHost|vramPerHostGB|vsanArch|clusterName|datacenterName|ssoDomain|nvmeSizeGB|Memory tiering|nestedEsxiPassword)/, {label: 'Nested cluster',    step: 8,  railNum: 9}],
              [/^(nsxSize|nsxTopology|nsxEdge|nsxIpAddress|nsxBgp|nsxRedist)/,   {label: 'NSX-T',             step: 9,  railNum: 10}],
              [/^vcf/,                                                          {label: 'VCF Bring-up',      step: 8,  railNum: 9}],
              [/^nestedDisk/,                                                   {label: 'Nested disks',      step: 8,  railNum: 9}],
              [/^depot/,                                                        {label: 'Bundle depot',      step: 8,  railNum: 9}],
              [/^workloadVm/,                                                   {label: 'Workload VMs',      step: 10, railNum: 11}],
              [/^(firewallPolicy|remoteAccess|vpnType|vcenterSize)/,            {label: 'Security & access', step: 7,  railNum: 8}],
            ];
            for (const [re, hint] of map) {
              if (re.test(msg)) return hint;
            }
            return null;
          };

          const groups = {};
          for (const msg of details) {
            const hint = sectionHint(msg);
            const key = hint ? hint.label : 'General';
            if (!groups[key]) groups[key] = { step: hint ? hint.step : null, railNum: hint ? hint.railNum : null, msgs: [] };
            groups[key].msgs.push(msg);
          }

          let html = '<strong>Fix the following before generating:</strong><ul>';
          for (const [sectionLabel, {step, railNum, msgs}] of Object.entries(groups)) {
            const goLink = step !== null
              ? ` — <a href="#" onclick="showStep(${step});return false;" class="geb-step-link">go to step ${railNum}</a>`
              : '';
            html += `<li class="geb-section">${escHtml(sectionLabel)}${goLink}<ul>`;
            for (const m of msgs) {
              // strip internal field name prefix (e.g. "fieldName: ") added for regex matching
              const display = m.replace(/^\w+:\s*/, '');
              html += `<li>${escHtml(display)}</li>`;
            }
            html += '</ul></li>';
          }
          html += '</ul>';
          errBlock.innerHTML = html;
        } else {
          errBlock.textContent = data.error || 'Generation failed.';
        }
        errBlock.hidden = false;
        errBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        throw new Error('');
      }

      errBlock.hidden = true;
      state.generated = data;
      clearAutoSave();

      renderWarnings(data.warnings);
      renderDownloads(data.id, data.generatedScripts || [], !!data.svgGenerated);

      // Architect mode: show readiness banner + relabel heading
      const archBanner  = document.getElementById('arch-readiness-banner');
      const previewHdr  = document.getElementById('markdown-preview-heading');
      if (state.architectMode && data.markdownPreview) {
        const m = data.markdownPreview.match(/Design readiness:\s*(\d+)%/);
        const score = m ? parseInt(m[1]) : null;
        if (archBanner) {
          archBanner.hidden = false;
          if (score !== null) {
            const scoreEl = document.getElementById('arch-readiness-score');
            const color = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red';
            if (scoreEl) {
              scoreEl.textContent = `${score}%`;
              scoreEl.className = `arch-readiness-score arch-readiness-${color}`;
            }
          }
        }
        if (previewHdr) previewHdr.textContent = 'Architect Design Document preview';
      } else {
        if (archBanner) archBanner.hidden = true;
        if (previewHdr) previewHdr.textContent = 'Design doc preview';
      }

      document.getElementById('markdown-preview').textContent = data.markdownPreview;
      document.getElementById('results').hidden = false;
      document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Update "View Diagram" rail button and the review screen's "Open in viewer"
      // link to point directly at this session now that one actually exists.
      const railDiagramBtn = document.getElementById('rail-diagram-btn');
      if (railDiagramBtn && data.id) {
        railDiagramBtn.href = `/diagram?id=${data.id}`;
      }
      const reviewOpenLink = document.querySelector('.review-diagram-open');
      if (reviewOpenLink && data.id) {
        reviewOpenLink.href = `/diagram?id=${data.id}`;
      }
    } catch (err) {
      if (err.message) {
        const isNetworkErr = err instanceof TypeError || /NetworkError|Failed to fetch|Network request failed/i.test(err.message);
        if (isNetworkErr) {
          errBlock.textContent = 'Cannot connect to server — is the wizard running? Check your terminal.';
          errBlock.hidden = false;
          errBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        // non-network errors with a message go to step-error (e.g. internal validation throws)
        // empty-message throw from validation error display path is intentionally ignored
        else if (err.message) {
          document.getElementById('step-error').textContent = err.message;
        }
      }
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// --- Keyboard shortcut: Ctrl+Shift+X / Cmd+Shift+X → toggle troubleshooting mode ---
// X is not reserved by any major browser on any platform.

document.addEventListener('keydown', (e) => {
  const modifier = e.ctrlKey || e.metaKey;
  if (modifier && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    toggleTroubleshootingMode();
  }
});

// =============================================================================
// Learning mode
// =============================================================================

// =============================================================================
// Learning mode onboarding
// =============================================================================

const CERT_AREAS = {
  'VCP-VCF-Architect':    ['VCF solution design and sizing', 'multi-domain architecture decisions', 'VCF security and compliance design', 'migration and lifecycle planning'],
  'VCP-VCF-Admin':        ['VCF bring-up and SDDC Manager', 'management domain design', 'NSX in VCF context', 'workload domain provisioning'],
  'VCP-VCF-Support':      ['VCF troubleshooting methodology', 'SDDC Manager log analysis', 'VCF incident management', 'component health and remediation'],
  'VCP-VVF-Admin':        ['ESXi deployment', 'vCenter and cluster management', 'vSAN configuration', 'HA and DRS'],
  'VCP-VVF-Support':      ['ESXi and vCenter troubleshooting', 'performance analysis', 'log collection and analysis', 'support escalation processes'],
  'VCAP-VCF-Automation':  ['Aria Automation configuration', 'infrastructure as code', 'day-2 automation workflows', 'service catalog design'],
  'VCAP-VCF-Operations':  ['Aria Operations monitoring', 'capacity planning and optimisation', 'performance management', 'alerting and reporting'],
  'VCAP-VCF-Storage':     ['vSAN deep-dive configuration', 'storage policy design', 'vVols and stretched clusters', 'storage performance tuning'],
  'VCAP-VCF-VKS':         ['VCF Kubernetes Service', 'TKG cluster deployment', 'supervisor cluster configuration', 'container networking with NSX'],
  'VCAP-VCF-Networking':  ['advanced NSX routing', 'BGP prefix filtering', 'advanced DFW design', 'NSX load balancing and services'],
};

const TECH_FOCUS_AREAS = {
  vsphere: 'vSphere cluster design, vCenter architecture, vSAN fundamentals, and HA/DRS configuration',
  vsan:    'vSAN cluster sizing, ESA vs OSA architecture, disk group design, and storage policies',
  nsx:     'NSX Manager deployment, T0/T1 gateway design, DFW rule creation, and BGP peering with VyOS',
  vcf:     'VCF bring-up requirements, SDDC Manager, management domain design, and the NSX integration',
};

function wireLearningOnboard() {
  const onboard  = document.getElementById('learn-onboard-screen');
  const app      = document.querySelector('.app');
  const startBtn = document.getElementById('learn-onboard-start');
  const dr       = state.designRationale;

  // Goal cards
  document.querySelectorAll('.learn-goal-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.learn-goal-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      dr.learningGoal = card.dataset.goal;
      document.getElementById('learn-cert-wrap').hidden = (dr.learningGoal !== 'certification');
      document.getElementById('learn-tech-wrap').hidden = (dr.learningGoal !== 'technology');
      updateOnboardSummary();
      updateOnboardStart();
    });
  });

  // Cert / tech dropdowns
  document.getElementById('learn-cert-target')?.addEventListener('change', e => {
    dr.certTarget = e.target.value;
    updateOnboardSummary();
  });
  document.getElementById('learn-tech-focus')?.addEventListener('change', e => {
    dr.techFocus = e.target.value;
    updateOnboardSummary();
  });

  // Experience cards
  document.querySelectorAll('.learn-exp-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.learn-exp-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      dr.experienceLevel = card.dataset.exp;
      updateOnboardSummary();
      updateOnboardStart();
    });
  });

  // Success statement
  document.getElementById('learn-success-stmt')?.addEventListener('input', e => {
    dr.successStatement = e.target.value;
  });

  // Time cards
  document.querySelectorAll('.learn-time-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.learn-time-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      dr.timeAvailable = card.dataset.time;
      updateOnboardSummary();
      updateOnboardStart();
    });
  });

  // Architect mode toggle
  document.getElementById('learn-arch-toggle')?.addEventListener('change', e => {
    state.architectMode = e.target.checked;
  });

  // Start button
  startBtn?.addEventListener('click', () => {
    applyOnboardingToWizard();
    state.architectMode = document.getElementById('learn-arch-toggle')?.checked || false;
    if (state.architectMode) {
      if (onboard) onboard.hidden = true;
      showArchDiscovery();
      return;
    }
    if (onboard) onboard.hidden = true;
    if (app)     app.hidden     = false;
    showStep(0);
    renderTopology();
  });
}

// Pre-fills wizard state from onboarding answers so the user doesn't repeat themselves.
function applyOnboardingToWizard() {
  const dr = state.designRationale;
  const goalToUseCase = {
    certification: 'certification',
    technology:    'feature_testing',
    customer:      'customer_demo',
    homelab:       'homelab',
    role:          'feature_testing',
  };
  const uc = goalToUseCase[dr.learningGoal];
  if (uc) {
    const radio = document.querySelector(`[name="useCase"][value="${uc}"]`);
    if (radio) {
      radio.checked = true;
      state.answers.discovery = state.answers.discovery || {};
      state.answers.discovery.useCase = uc;
    }
  }
  // NSX is strongly implied by cert/tech focus — pre-tick it as a hint (user can untick)
  if (dr.certTarget === 'VCP-VCF-Admin' || dr.certTarget === 'VCP-VCF-Architect' ||
      dr.certTarget === 'VCP-VCF-Support' || dr.certTarget === 'VCAP-VCF-Networking' ||
      dr.certTarget === 'VCAP-VCF-VKS' ||
      dr.techFocus === 'nsx' || dr.techFocus === 'vcf') {
    const nsxCheck = document.getElementById('nsxEnabled');
    if (nsxCheck && !nsxCheck.checked) nsxCheck.checked = true;
  }
}

function updateOnboardStart() {
  const btn = document.getElementById('learn-onboard-start');
  if (!btn) return;
  const dr = state.designRationale;
  const ready = !!(dr.learningGoal && dr.experienceLevel && dr.timeAvailable);
  btn.disabled = !ready;
  const archWrap = document.getElementById('learn-arch-toggle-wrap');
  if (archWrap) archWrap.hidden = !ready;
}

function updateOnboardSummary() {
  const summaryEl = document.getElementById('learn-path-summary');
  const textEl    = document.getElementById('learn-path-text');
  if (!summaryEl || !textEl) return;
  const dr = state.designRationale;

  if (!dr.learningGoal && !dr.experienceLevel) { summaryEl.hidden = true; return; }

  const parts = [];

  // Focus sentence
  if (dr.learningGoal === 'certification') {
    const cert  = dr.certTarget;
    const areas = cert && CERT_AREAS[cert]
      ? CERT_AREAS[cert]
      : ['vSphere cluster design', 'vCenter deployment', 'storage and networking fundamentals'];
    const label = cert || 'your certification';
    parts.push(`Based on your goal, we will focus on <strong>${areas.join(', ')}</strong> — the core areas ${label} tests.`);
  } else if (dr.learningGoal === 'technology') {
    const tech = dr.techFocus;
    const desc = tech ? TECH_FOCUS_AREAS[tech] : 'the key design decisions for your chosen technology';
    parts.push(`We will deep-dive on <strong>${desc}</strong>.`);
  } else if (dr.learningGoal === 'customer') {
    parts.push('We will emphasise <strong>design rationale documentation</strong> — translating business requirements into architecture decisions, the same way you would in a customer engagement.');
  } else if (dr.learningGoal === 'homelab') {
    parts.push('We will keep the design <strong>practical and focused</strong> on what gives you the most learning value for your hardware.');
  } else if (dr.learningGoal === 'role') {
    parts.push('We will build a <strong>rounded lab</strong> covering the breadth of VMware infrastructure skills used in infrastructure and cloud roles.');
  }

  // Experience calibration
  if (dr.experienceLevel === 'new') {
    parts.push('Guidance will explain <em>why</em> each decision matters — not just what to select.');
  } else if (dr.experienceLevel === 'some') {
    parts.push('Guidance will connect decisions to real-world implications and common mistakes.');
  } else if (dr.experienceLevel === 'experienced') {
    parts.push('Guidance will focus on the nuances and trade-offs, assuming you already know the basics.');
  }

  // Time
  const timeText = {
    'wizard-only':  'Estimated time: <strong>~30 minutes</strong> for the design wizard and script generation.',
    'wizard-build': 'Estimated time: <strong>~4 hours</strong> — design wizard, then guided build of your lab.',
    'full-day':     'Estimated time: <strong>a full day+</strong> — design, build, and troubleshooting practice with pre-built fault scenarios.',
  };
  if (dr.timeAvailable) parts.push(timeText[dr.timeAvailable] || '');

  if (!parts.length) { summaryEl.hidden = true; return; }
  textEl.innerHTML = parts.map(p => `<p>${p}</p>`).join('');
  summaryEl.hidden = false;
}

// Prerequisites gate, shown before the mode-select screen. Checkbox state is stored in
// localStorage (not autosave/session state) so it persists across browser sessions —
// once someone has confirmed PowerCLI/OVF Tool/etc. are installed, they shouldn't have
// to re-tick the same boxes the next time they open the wizard.
const PREREQ_STORAGE_KEY = 'vsphere-wizard-prereq-checklist';

function loadPrereqState() {
  try {
    const raw = localStorage.getItem(PREREQ_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePrereqState(stateObj) {
  try { localStorage.setItem(PREREQ_STORAGE_KEY, JSON.stringify(stateObj)); }
  catch { /* storage unavailable/full — checklist just won't persist this time */ }
}

function updatePrereqStart() {
  const checks = Array.from(document.querySelectorAll('.prereq-check'));
  const allChecked = checks.length > 0 && checks.every((c) => c.checked);
  const btn  = document.getElementById('prereq-start-btn');
  const hint = document.getElementById('prereq-actions-hint');
  if (btn) btn.disabled = !allChecked;
  if (hint) {
    const remaining = checks.filter((c) => !c.checked).length;
    hint.textContent = allChecked
      ? "You're all set."
      : `Tick everything above to continue (${remaining} remaining).`;
  }
}

function wirePrereqScreen() {
  const checks = Array.from(document.querySelectorAll('.prereq-check'));
  if (checks.length === 0) return;

  // Each checkbox is wrapped in a <label> so clicking anywhere in the item toggles it —
  // except the help links, which should just navigate, not also flip the checkbox.
  document.querySelectorAll('.prereq-item-desc a').forEach((a) => {
    a.addEventListener('click', (e) => e.stopPropagation());
  });

  const saved = loadPrereqState();
  checks.forEach((c) => {
    const id = c.dataset.prereqId;
    if (saved[id]) c.checked = true;
    c.addEventListener('change', () => {
      const current = loadPrereqState();
      current[id] = c.checked;
      savePrereqState(current);
      updatePrereqStart();
    });
  });
  updatePrereqStart();

  document.getElementById('prereq-start-btn')?.addEventListener('click', () => {
    const prereqScreen = document.getElementById('prereq-screen');
    const modeScreen    = document.getElementById('mode-select-screen');
    if (prereqScreen) prereqScreen.hidden = true;
    if (modeScreen)   modeScreen.hidden   = false;
  });
}

// Wires the opening mode selector. Standard mode goes straight to the wizard.
// Learning mode goes to the onboarding screen first.
function wireModeSelect() {
  const screen  = document.getElementById('mode-select-screen');
  const onboard = document.getElementById('learn-onboard-screen');
  const app     = document.querySelector('.app');

  document.getElementById('mode-build')?.addEventListener('click', () => {
    state.modeSelected = true;
    state.learningMode = false;
    if (screen) screen.hidden = true;
    if (app)    app.hidden    = false;
    showStep(0);
    renderTopology();
  });

  document.getElementById('mode-learn')?.addEventListener('click', () => {
    state.modeSelected = true;
    state.learningMode = true;
    document.body.classList.add('learning-mode');
    if (screen)  screen.hidden  = true;
    if (onboard) onboard.hidden = false;
    updateOnboardStart();
  });

  document.getElementById('mode-continue')?.addEventListener('click', () => {
    document.getElementById('load-config-input')?.click();
  });

  document.getElementById('mode-template')?.addEventListener('click', () => {
    if (screen) screen.hidden = true;
    const picker = document.getElementById('template-picker-screen');
    if (picker) picker.hidden = false;
    renderTemplatePicker();
  });

  document.getElementById('template-picker-back')?.addEventListener('click', () => {
    const picker = document.getElementById('template-picker-screen');
    if (picker) picker.hidden = true;
    if (screen) screen.hidden = false;
  });

  document.getElementById('template-picker-upload-btn')?.addEventListener('click', () => {
    document.getElementById('load-template-input')?.click();
  });
}

// Curated .labtemplate files shipped with the app (templates/*.json), offered
// on the "Start from template" screen alongside the option to upload a
// custom one. Fetched once and cached — the list is small and static per session.
let _templatesCache = null;

async function renderTemplatePicker() {
  const list = document.getElementById('template-picker-list');
  if (!list) return;
  if (!_templatesCache) {
    list.innerHTML = '<p class="hint">Loading templates…</p>';
    try {
      const res = await fetch('/api/templates');
      _templatesCache = await res.json();
    } catch {
      list.innerHTML = '<p class="hint">Could not load templates — check your connection and try again.</p>';
      return;
    }
  }
  list.innerHTML = '';
  _templatesCache.forEach((tpl) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-card mode-card-template';
    btn.innerHTML = `
      <span class="mode-card-badge">Template</span>
      <span class="mode-card-heading">${escHtml(tpl.name || tpl.id)}</span>
      <span class="mode-card-desc">${escHtml(tpl.description || '')}</span>
      <span class="mode-card-cta">Use this template &rarr;</span>
    `;
    btn.addEventListener('click', () => {
      if (!isValidWizardConfig(tpl) || tpl._type !== 'lab-template') return;
      enterAppWithConfig(tpl, true);
    });
    list.appendChild(btn);
  });
}

// Applies only a template's `design` answers (networking, cluster, NSX, VCF,
// etc.) — used when a template is picked mid-wizard, after the user has
// already answered Hardware/Existing network/Use case (steps 0-2). Unlike
// the mode-select "Start from template" flow (loadWizardConfig, which
// overwrites everything including hardware), this deliberately leaves
// state.answers.hardware/discovery untouched — the user already gave real
// answers there and a template's example hardware numbers shouldn't
// silently clobber them.
function applyTemplateDesignOnly(tpl) {
  const design = (tpl.answers && tpl.answers.design) || {};
  Object.assign(state.answers.design, design);
  if (tpl.learningMode) {
    state.learningMode = true;
    document.body.classList.add('learning-mode');
  }
  if (tpl.designRationale) Object.assign(state.designRationale, tpl.designRationale);
  populateFormFromState();
}

// Renders the "Recommended template" step (step 4, right after Use case) —
// offers the same curated templates as the mode-select screen, applied via
// applyTemplateDesignOnly so the hardware/network/use-case answers already
// given on the preceding steps aren't overwritten. Picking a card just
// applies it in place; the user still clicks the normal Next button to
// continue (or clicks Next without picking anything to customise manually).
async function renderTemplateStep() {
  const list = document.getElementById('template-step-list');
  if (!list) return;
  if (!_templatesCache) {
    list.innerHTML = '<p class="hint">Loading templates…</p>';
    try {
      const res = await fetch('/api/templates');
      _templatesCache = await res.json();
    } catch {
      list.innerHTML = '<p class="hint">Could not load templates — check your connection.</p>';
      return;
    }
  }
  list.innerHTML = '';
  _templatesCache.forEach((tpl) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-card mode-card-template';
    btn.innerHTML = `
      <span class="mode-card-badge">Template</span>
      <span class="mode-card-heading">${escHtml(tpl.name || tpl.id)}</span>
      <span class="mode-card-desc">${escHtml(tpl.description || '')}</span>
      <span class="mode-card-cta">Use this template &rarr;</span>
    `;
    btn.addEventListener('click', () => {
      if (!isValidWizardConfig(tpl) || tpl._type !== 'lab-template') return;
      applyTemplateDesignOnly(tpl);
      document.querySelectorAll('#template-step-list .mode-card').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
    });
    list.appendChild(btn);
  });
}

// Captures the per-step rationale fields into state.designRationale.
function wireLearningInputs() {
  const dr = state.designRationale;
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { dr[key] = el.value; });
  };
  bind('learn-router-choice', 'routerChoice');
  bind('learn-network-security', 'networkSecurity');
  bind('learn-nsx-rationale', 'nsxRationale');
  const avail = document.getElementById('learn-availability-req');
  if (avail) avail.addEventListener('change', () => { dr.availabilityRequirement = avail.value; });

  // Refresh the RAM insight when RAM (step 0) changes.
  document.getElementById('ramGB')?.addEventListener('input', () => {
    if (state.learningMode && state.step === 0) updateLearnRamContext();
  });
}

// Step 0 insight: what cluster sizes are realistically possible at this RAM.
function updateLearnRamContext() {
  const el = document.getElementById('learn-ram-context');
  if (!el) return;
  const h = state.answers.hardware;
  const g = state.answers.design;
  const physRam = Number(h.ramGB) || 0;
  const esxiVer = g.esxiVersion && ESXI9X_VERSIONS.has(g.esxiVersion) ? g.esxiVersion : '9.1';
  if (!physRam) { el.hidden = true; return; }
  const t = calcHostTiers(physRam, esxiVer);
  const opts = [];
  if (t.tiers[0].feasible) opts.push('a single nested host (vSphere basics)');
  if (t.tiers[1].feasible) opts.push('a 3-host cluster with vSAN');
  if (t.maxHosts >= 4) opts.push(`up to ${t.maxHosts} nested hosts at maximum density`);
  if (!opts.length) opts.push('limited capacity — consider a single minimal host');
  el.hidden = false;
  el.textContent = `With ${physRam} GB RAM you can realistically support: ${opts.join('; ')}. ` +
    `(Roughly ${t.fixedRam} GB is reserved for vCenter and infrastructure before nested hosts.)`;
}

// Step 7 insight: remaining RAM headroom after the cluster, in plain language.
function updateLearnRamHeadroom() {
  const el = document.getElementById('learn-ram-headroom');
  if (!el) return;
  const h = state.answers.hardware;
  const g = state.answers.design;
  const physRam = Number(h.ramGB) || 0;
  if (!physRam) { el.hidden = true; return; }
  const used = computeUsedRam();
  const remaining = physRam - used;
  el.hidden = false;
  if (remaining < 0) {
    el.textContent = `This design needs ${used} GB but you only have ${physRam} GB — ` +
      `you are over-committed by ${Math.abs(remaining)} GB. Reduce host count or per-host RAM.`;
  } else {
    // small VM ~= 4 GB, medium ~= 8 GB; use 4 GB as a rule of thumb
    const workloadVms = Math.floor(remaining / 4);
    el.textContent = `You have ${remaining} GB remaining after the cluster — ` +
      `enough for roughly ${workloadVms} small workload VM${workloadVms === 1 ? '' : 's'}.`;
  }
}

// Shared RAM-usage estimate used by the headroom insight and the scorecard.
function computeUsedRam() {
  const g = state.answers.design;
  const hosts = Number(g.nestedHostCount) || 0;
  const perHost = Number(g.vramPerHostGB) || 0;
  let used = hosts * perHost + 21 /* vCenter */;
  used += (DC_RAM_GB_BY_PROFILE[g.dcProfile] || 0);
  if (g.nsxEnabled) used += 48;
  return used;
}

// =============================================================================
// Architecture scorecard (Review & generate step, learning mode)
// =============================================================================

function scoreIsolation() {
  const g = state.answers.design;
  const mgmt = g.mgmtVlan, vsan = g.vsanVlan, vmot = g.vmotionVlan;
  const hasMgmt = mgmt !== null && mgmt !== '' && mgmt !== undefined;
  const hasVsan = !g.vsanEnabled || (vsan !== null && vsan !== '' && vsan !== undefined);
  const hasVmot = vmot !== null && vmot !== '' && vmot !== undefined;
  if (!hasMgmt && !hasVmot && !(g.vsanEnabled && vsan)) {
    return { rating: 'red', label: 'No VLANs configured', reason: 'Management, vMotion, and vSAN traffic are not separated — a misbehaving VM or storage I/O can starve host management.' };
  }
  if (hasMgmt && hasVsan && hasVmot) {
    return { rating: 'green', label: 'Good', reason: 'Management, vMotion, and vSAN each have dedicated VLANs.' };
  }
  return { rating: 'amber', label: 'Partial', reason: 'Management has a VLAN but vSAN or vMotion is missing dedicated isolation — high-bandwidth traffic may contend with the control plane.' };
}

function scoreResilience() {
  const n = Number(state.answers.design.nestedHostCount) || 0;
  if (n >= 3) return { rating: 'green', label: 'Resilient', reason: `${n} nested hosts — HA can tolerate a host failure.` };
  if (n === 2) return { rating: 'amber', label: 'Limited', reason: 'Two hosts allow basic HA but vSAN and full resilience need three.' };
  return { rating: 'red', label: 'Single point of failure', reason: 'One host means no HA — any failure takes the whole lab down.' };
}

function scoreScalability() {
  const physRam = Number(state.answers.hardware.ramGB) || 0;
  const used = computeUsedRam();
  const remaining = physRam - used;
  if (remaining < 0) return { rating: 'red', label: 'Over-committed', reason: `Design needs ${used} GB but only ${physRam} GB is available (${Math.abs(remaining)} GB short).`, remaining };
  if (remaining >= 32) return { rating: 'green', label: 'Room to grow', reason: `${remaining} GB headroom remains for additional workloads.`, remaining };
  return { rating: 'amber', label: 'Tight', reason: `${remaining} GB headroom — workable but little room for additional workloads.`, remaining };
}

function scoreComplexity() {
  const g = state.answers.design;
  const useCase = state.answers.discovery.useCase;
  const nsx = !!g.nsxEnabled;
  const n = Number(g.nestedHostCount) || 0;
  if (g.vcfEnabled && n < 4) return { rating: 'red', label: 'Under-provisioned for VCF', reason: 'VCF requires at least four hosts in the management domain.' };
  if (nsx && (useCase === 'homelab' || useCase === 'devtest')) {
    return { rating: 'amber', label: 'Possibly over-engineered', reason: 'NSX adds significant overhead for a homelab/dev-test use case — make sure you need it.' };
  }
  if (nsx && (useCase === 'certification' || useCase === 'feature_testing')) {
    return { rating: 'green', label: 'Appropriate', reason: 'NSX matches a certification / feature-testing goal.' };
  }
  if (!nsx) return { rating: 'green', label: 'Appropriate', reason: 'A focused design without NSX overhead suits the stated use case.' };
  return { rating: 'amber', label: 'Review', reason: 'Confirm the complexity matches your goal.' };
}

function scoreVcfReadiness() {
  const g = state.answers.design;
  if (!g.vcfEnabled) return null;
  const n = Number(g.nestedHostCount) || 0;
  if (n < 4) return { rating: 'red', label: 'Not ready', reason: 'VCF needs a minimum of four hosts in the management domain.' };
  if (!g.nsxEnabled) return { rating: 'amber', label: 'Missing NSX', reason: 'VCF bring-up deploys NSX — enable it to match the reference architecture.' };
  return { rating: 'green', label: 'Ready', reason: 'Four or more hosts with NSX enabled — aligned with the VCF reference architecture.' };
}

function collectAntiPatterns() {
  const g = state.answers.design;
  const n = Number(g.nestedHostCount) || 0;
  const out = [];
  if (n === 1) {
    out.push({ title: 'HA with a single host', text: 'HA only makes sense with two or more hosts — a single-host cluster cannot tolerate a failure.' });
  }
  if (g.vsanEnabled && n < 3) {
    out.push({ title: 'vSAN below minimum host count', text: `vSAN requires a minimum of 3 hosts — your current cluster size of ${n} won't work.` });
  }
  if (g.nsxEnabled && g.vyosEnabled && g.vyosNetworkMode !== 'bgp') {
    out.push({ title: 'NSX without BGP peering', text: "VyOS is deployed but BGP is not configured — you're missing the opportunity to practice T0 BGP peering." });
  }
  if (g.mgmtVlanMode === 'untagged') {
    out.push({ title: 'Management on an untagged VLAN', text: 'Management traffic is on an untagged VLAN — consider whether this is intentional for your lab setup.' });
  }
  return out;
}

// Returns the full set of scored dimensions (used by both the UI and the
// markdown design-doc summary).
function computeScorecard() {
  const dims = [
    { key: 'Isolation',   ...scoreIsolation() },
    { key: 'Resilience',  ...scoreResilience() },
    { key: 'Scalability', ...scoreScalability() },
    { key: 'Complexity',  ...scoreComplexity() }
  ];
  const vcf = scoreVcfReadiness();
  if (vcf) dims.push({ key: 'VCF readiness', ...vcf });
  return dims;
}

function renderScorecard() {
  const el = document.getElementById('learn-scorecard');
  if (!el) return;
  const dims = computeScorecard();
  el.innerHTML = '';
  dims.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'learn-score-row';
    const dot = document.createElement('span');
    dot.className = `learn-score-dot ${d.rating}`;
    const body = document.createElement('div');
    body.className = 'learn-score-body';
    const head = document.createElement('div');
    head.className = 'learn-score-head';
    head.textContent = `${d.key}: ${d.label}`;
    const reason = document.createElement('div');
    reason.className = 'learn-score-reason';
    reason.textContent = d.reason;
    body.append(head, reason);
    row.append(dot, body);
    el.appendChild(row);
  });

  const apEl = document.getElementById('learn-antipatterns');
  if (apEl) {
    const aps = collectAntiPatterns();
    apEl.innerHTML = '';
    apEl.hidden = aps.length === 0;
    aps.forEach((ap) => {
      const card = document.createElement('div');
      card.className = 'learn-antipattern-card';
      const title = document.createElement('div');
      title.className = 'learn-antipattern-title';
      title.textContent = ap.title;
      const text = document.createElement('div');
      text.className = 'learn-antipattern-text';
      text.textContent = ap.text;
      card.append(title, text);
      apEl.appendChild(card);
    });
  }
}

// =============================================================================
// Architect Mode
// =============================================================================

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

const DESIGN_PRINCIPLES = [
  { key: 'security-default',    label: 'Security by default',          desc: 'If in doubt, restrict access' },
  { key: 'automate',            label: 'Automate anything done twice',  desc: 'Manual processes introduce drift' },
  { key: 'document-decisions',  label: 'Document decisions not outcomes', desc: 'Capture the why, not just the what' },
  { key: 'design-for-failure',  label: 'Design for the failure you have not thought of yet', desc: 'Resilience by design' },
  { key: 'keep-simple',         label: 'Keep it as simple as the requirement allows', desc: 'Complexity is a cost' },
  { key: 'monitorable',         label: 'Every component must be monitorable', desc: 'You cannot fix what you cannot see' },
  { key: 'change-process',      label: 'Changes go through a process', desc: 'Never ad-hoc in production or production-like labs' },
  { key: 'design-day2',         label: 'Design for day 2, not just day 1', desc: 'Consider operations, not just deployment' },
];

const SUGGESTED_RISKS = [
  { description: 'Physical host runs out of RAM during lab build', likelihood: 'medium', impact: 'high', mitigation: 'Allocate no more than 80% of physical RAM to nested VMs' },
  { description: 'vSAN loses quorum if a nested host becomes unavailable', likelihood: 'medium', impact: 'high', mitigation: 'Ensure 3+ hosts with witness, avoid single-host vSAN' },
  { description: 'Build takes longer than expected, lab becomes a blocker', likelihood: 'high', impact: 'medium', mitigation: 'Set a time budget per phase and stop if exceeded' },
  { description: 'NSX complexity blocks progress on primary learning goal', likelihood: 'medium', impact: 'medium', mitigation: 'Deploy NSX after cluster is healthy; keep NSX config minimal initially' },
  { description: 'Nested VM performance too slow for meaningful testing', likelihood: 'low', impact: 'high', mitigation: 'Use CPU reservation on nested ESXi hosts; minimise VM density during testing' },
];

function showArchDiscovery() {
  const screen = document.getElementById('arch-discovery-screen');
  if (screen) screen.hidden = false;
  renderRiskInputs();
  renderPrinciples();
  renderSuggestedRisks();
  wireDiscovery();
}

let _discoveryWired = false;
function wireDiscovery() {
  if (_discoveryWired) return;
  _discoveryWired = true;
  const disc = state.discovery;

  // Problem statement
  document.getElementById('arch-problem-stmt')?.addEventListener('input', e => {
    disc.problemStatement = e.target.value;
  });

  // MoSCoW radios
  ['networking', 'compute', 'storage', 'security', 'management'].forEach(area => {
    document.querySelectorAll(`input[name="moscow-${area}"]`).forEach(el => {
      el.addEventListener('change', () => { if (el.checked) disc.moscow[area] = el.value; });
    });
  });

  // Constraints
  document.getElementById('arch-constraint-time')?.addEventListener('change', e => { disc.constraints.time = e.target.value; });
  document.getElementById('arch-constraint-budget')?.addEventListener('change', e => { disc.constraints.budget = e.target.value; });
  document.getElementById('arch-constraint-skills')?.addEventListener('input', e => { disc.constraints.skills = e.target.value; });
  document.getElementById('arch-constraint-compliance')?.addEventListener('input', e => { disc.constraints.compliance = e.target.value; });

  // Success
  document.getElementById('arch-success-criteria')?.addEventListener('input', e => { disc.successCriteria = e.target.value; });
  document.getElementById('arch-success-measure')?.addEventListener('input', e => { disc.successMeasure = e.target.value; });

  // Custom principle add
  document.getElementById('arch-principle-add-btn')?.addEventListener('click', () => {
    const input = document.getElementById('arch-principle-custom-input');
    if (!input) return;
    const v = input.value.trim();
    if (!v) return;
    disc.designPrinciples.push(v);
    input.value = '';
    renderCustomPrinciples();
  });

  // Start
  document.getElementById('arch-disc-start')?.addEventListener('click', finishDiscovery);
}

function finishDiscovery() {
  const screen = document.getElementById('arch-discovery-screen');
  if (screen) screen.hidden = true;

  // Import discovery risks into riskRegister
  state.discovery.risks.forEach(r => {
    if (r && r.description) {
      state.riskRegister.push({ ...r, source: 'discovery', id: genId() });
    }
  });

  const dlPanel = document.getElementById('arch-decision-log-panel');
  const rrPanel = document.getElementById('arch-risk-register-panel');
  if (dlPanel) dlPanel.hidden = false;
  if (rrPanel) rrPanel.hidden = false;

  const app = document.querySelector('.app');
  if (app) app.hidden = false;
  showStep(0);
  renderTopology();
  renderDecisionLog();
  renderRiskRegister();
  wireArchitectWizardSteps();
}

function renderRiskInputs() {
  const container = document.getElementById('arch-risk-inputs');
  if (!container) return;
  const disc = state.discovery;
  container.innerHTML = '';
  for (let n = 0; n < 3; n++) {
    if (!disc.risks[n]) disc.risks[n] = { description: '', likelihood: '', impact: '', mitigation: '' };
    const r = disc.risks[n];
    const row = document.createElement('div');
    row.className = 'arch-risk-row';
    row.dataset.riskIdx = n;
    row.innerHTML = `
      <div class="arch-risk-num">Risk ${n + 1}</div>
      <textarea class="arch-risk-desc arch-disc-textarea-sm" rows="2" placeholder="Describe the risk..."></textarea>
      <div class="arch-risk-meta">
        <select class="arch-risk-likelihood">
          <option value="">Likelihood</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <select class="arch-risk-impact">
          <option value="">Impact</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <textarea class="arch-risk-mitigation arch-disc-textarea-sm" rows="2" placeholder="How will you mitigate this?"></textarea>`;
    const descEl = row.querySelector('.arch-risk-desc');
    const likeEl = row.querySelector('.arch-risk-likelihood');
    const impEl  = row.querySelector('.arch-risk-impact');
    const mitEl  = row.querySelector('.arch-risk-mitigation');
    descEl.value = r.description || '';
    likeEl.value = r.likelihood || '';
    impEl.value  = r.impact || '';
    mitEl.value  = r.mitigation || '';
    descEl.addEventListener('input', () => { disc.risks[n].description = descEl.value; });
    likeEl.addEventListener('change', () => { disc.risks[n].likelihood = likeEl.value; });
    impEl.addEventListener('change',  () => { disc.risks[n].impact = impEl.value; });
    mitEl.addEventListener('input',   () => { disc.risks[n].mitigation = mitEl.value; });
    container.appendChild(row);
  }
}

function renderPrinciples() {
  const grid = document.getElementById('arch-principles-grid');
  if (!grid) return;
  const disc = state.discovery;
  grid.innerHTML = '';
  DESIGN_PRINCIPLES.forEach(p => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'arch-principle-card' + (disc.designPrinciples.includes(p.key) ? ' selected' : '');
    const title = document.createElement('div');
    title.className = 'arch-principle-title';
    title.textContent = p.label;
    const desc = document.createElement('div');
    desc.className = 'arch-principle-desc';
    desc.textContent = p.desc;
    card.append(title, desc);
    card.addEventListener('click', () => {
      const i = disc.designPrinciples.indexOf(p.key);
      if (i >= 0) disc.designPrinciples.splice(i, 1);
      else disc.designPrinciples.push(p.key);
      card.classList.toggle('selected');
    });
    grid.appendChild(card);
  });
  renderCustomPrinciples();
}

function renderCustomPrinciples() {
  const list = document.getElementById('arch-custom-principles-list');
  if (!list) return;
  const disc = state.discovery;
  const known = new Set(DESIGN_PRINCIPLES.map(p => p.key));
  const custom = disc.designPrinciples.filter(p => !known.has(p));
  list.innerHTML = '';
  custom.forEach(p => {
    const item = document.createElement('div');
    item.className = 'arch-custom-principle-item';
    const text = document.createElement('span');
    text.textContent = p;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn-remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      const i = disc.designPrinciples.indexOf(p);
      if (i >= 0) disc.designPrinciples.splice(i, 1);
      renderCustomPrinciples();
    });
    item.append(text, rm);
    list.appendChild(item);
  });
}

function renderSuggestedRisks() {
  const container = document.getElementById('arch-risk-chips');
  if (!container) return;
  const disc = state.discovery;
  container.innerHTML = '';
  SUGGESTED_RISKS.forEach(sr => {
    // Skip if already present
    if (disc.risks.some(r => r && r.description === sr.description)) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'arch-risk-chip';
    chip.textContent = sr.description;
    chip.addEventListener('click', () => {
      // Find first empty slot
      let slot = -1;
      for (let i = 0; i < 3; i++) {
        if (!disc.risks[i] || !disc.risks[i].description) { slot = i; break; }
      }
      if (slot === -1) return;
      disc.risks[slot] = { ...sr };
      renderRiskInputs();
      renderSuggestedRisks();
    });
    container.appendChild(chip);
  });
}

// --- Decision log ---

function addDecision(decision, chosen, alternative, rationale) {
  state.decisionLog.push({
    id: genId(),
    decision,
    chosen,
    alternative: alternative || '—',
    rationale: rationale || '',
    timestamp: new Date().toISOString().slice(0, 10)
  });
  renderDecisionLog();
}

function renderDecisionLog() {
  const el = document.getElementById('arch-dl-body');
  const cnt = document.getElementById('arch-dl-count');
  if (!el) return;
  if (cnt) cnt.textContent = state.decisionLog.length;
  el.innerHTML = '';
  if (!state.decisionLog.length) {
    el.innerHTML = '<div class="arch-panel-empty">No decisions logged yet.</div>';
    return;
  }
  state.decisionLog.slice().reverse().forEach(d => {
    const row = document.createElement('div');
    row.className = 'arch-dl-row';
    row.innerHTML = `
      <div class="arch-dl-decision">${escHtml(d.decision)}</div>
      <div class="arch-dl-chosen">${escHtml(d.chosen)}</div>
      ${d.rationale ? `<div class="arch-dl-rationale">${escHtml(d.rationale)}</div>` : ''}
      <div class="arch-dl-meta">${escHtml(d.timestamp)} &middot; vs. ${escHtml(d.alternative)}</div>`;
    el.appendChild(row);
  });
}

// --- Risk register ---

function addAutoRisk(description, likelihood, impact, mitigation) {
  if (state.riskRegister.some(r => r.description === description)) return;
  state.riskRegister.push({ id: genId(), description, likelihood, impact, mitigation, source: 'auto' });
  renderRiskRegister();
}

function renderRiskRegister() {
  const el = document.getElementById('arch-rr-body');
  const cnt = document.getElementById('arch-rr-count');
  if (!el) return;
  if (cnt) cnt.textContent = state.riskRegister.length;
  el.innerHTML = '';
  if (!state.riskRegister.length) {
    el.innerHTML = '<div class="arch-panel-empty">No risks recorded yet.</div>';
    return;
  }
  state.riskRegister.forEach(r => {
    const row = document.createElement('div');
    row.className = `arch-rr-row arch-rr-${r.likelihood || 'low'}`;
    row.innerHTML = `
      <div class="arch-rr-desc">${escHtml(r.description)}</div>
      <div class="arch-rr-meta">
        <span class="arch-rr-badge arch-rr-likelihood-${r.likelihood || 'low'}">${escHtml(r.likelihood || 'unknown')} likelihood</span>
        <span class="arch-rr-badge arch-rr-impact-${r.impact || 'low'}">${escHtml(r.impact || 'unknown')} impact</span>
        ${r.source === 'auto' ? '<span class="arch-rr-source">auto-detected</span>' : ''}
      </div>
      <div class="arch-rr-mitigation">${escHtml(r.mitigation || '—')}</div>`;
    el.appendChild(row);
  });
}

// Collapsible panel headers
function wireArchPanelToggles() {
  const dlHeader = document.getElementById('arch-dl-header');
  const dlBody   = document.getElementById('arch-dl-body');
  if (dlHeader && dlBody) {
    dlHeader.addEventListener('click', () => {
      dlBody.hidden = !dlBody.hidden;
      dlHeader.classList.toggle('collapsed', dlBody.hidden);
    });
  }
  const rrHeader = document.getElementById('arch-rr-header');
  const rrBody   = document.getElementById('arch-rr-body');
  if (rrHeader && rrBody) {
    rrHeader.addEventListener('click', () => {
      rrBody.hidden = !rrBody.hidden;
      rrHeader.classList.toggle('collapsed', rrBody.hidden);
    });
  }
}

// --- Auto risk detection on wizard answers ---

function wireArchitectWizardSteps() {
  if (!state.architectMode) return;

  document.getElementById('nestedHostCount')?.addEventListener('change', detectDesignRisks);
  document.getElementById('vramPerHostGB')?.addEventListener('input', detectDesignRisks);
  document.getElementById('nsxEnabled')?.addEventListener('change', detectDesignRisks);
  document.getElementById('mgmtVlan')?.addEventListener('input', detectDesignRisks);
  document.getElementById('vsanEnabled')?.addEventListener('change', detectDesignRisks);
}

function detectDesignRisks() {
  if (!state.architectMode) return;
  const g = state.answers.design;
  const h = state.answers.hardware;

  const hosts = Number(g.nestedHostCount) || 0;
  const physRam = Number(h.ramGB) || 0;
  const perHost = Number(g.vramPerHostGB) || 0;
  const used = hosts * perHost + 21 + (g.nsxEnabled ? 48 : 0);

  if (hosts === 1) {
    addAutoRisk(
      'Single nested host is a single point of failure — no HA possible',
      'high', 'high',
      'Accept as lab constraint or add a second host'
    );
  }

  if (physRam > 0 && used > physRam * 0.85) {
    addAutoRisk(
      'Memory overcommitment — design uses more than 85% of physical RAM',
      'high', 'high',
      'Reduce host count or per-host RAM, or upgrade physical host'
    );
  }

  if (g.vsanEnabled && hosts < 3) {
    addAutoRisk(
      'vSAN requires a minimum of 3 hosts — current cluster size will not form a cluster',
      'high', 'high',
      'Increase nested host count to at least 3 before enabling vSAN'
    );
  }

  if (g.nsxEnabled && g.vyosEnabled && g.vyosNetworkMode !== 'bgp') {
    addAutoRisk(
      'NSX deployed without BGP peering — static routing limits topology flexibility',
      'low', 'medium',
      'Configure BGP on VyOS and NSX T0 to practise dynamic routing'
    );
  }

  if (!g.mgmtVlan || g.mgmtVlan === '' || g.mgmtVlan === '0') {
    addAutoRisk(
      'Management traffic on untagged VLAN — no L2 segmentation for control plane',
      'low', 'medium',
      'Assign a dedicated VLAN ID for management traffic'
    );
  }
}

// --- Options analysis ---

const OPTIONS_ANALYSIS = {
  router: {
    title: 'Virtual router decision',
    context: 'Your router choice sets the foundation for all lab networking. This decision affects BGP capability, NSX peering, and how much networking complexity you take on.',
    options: [
      { label: 'VyOS with BGP', approach: 'VyOS VM with BGP peering to NSX T0', pros: ['Mirrors enterprise routing', 'Enables BGP peering practice', 'Required for advanced NSX study'], cons: ['More complex to configure', 'Requires understanding of BGP concepts'], risk: 'Misconfiguration can block all lab traffic', bestFor: 'Certification study (VCP-VCF Admin, VCP-VCF Architect, VCAP Networking)' },
      { label: 'VyOS basic NAT', approach: 'VyOS VM with NAT only, no dynamic routing', pros: ['Simpler to configure', 'Still provides NAT and DHCP', 'Good for vSphere-only labs'], cons: ['No BGP practice', 'Cannot peer with NSX T0 dynamically'], risk: 'Limits NSX routing capabilities', bestFor: 'vSphere basics study (VCP-VVF Admin)' },
      { label: 'No router', approach: 'No virtual router — direct physical network access', pros: ['Simplest setup', 'No router configuration'], cons: ['No network segmentation practice', 'No NAT for nested hosts'], risk: 'All nested VMs on flat network', bestFor: 'Minimal vSphere basics only' },
    ],
    decisionKey: 'Virtual router'
  },
  storage: {
    title: 'Storage architecture decision',
    context: 'Storage choice determines what you can practice and how resilient the lab is. vSAN requires 3+ hosts and significant RAM.',
    options: [
      { label: 'vSAN', approach: 'Software-defined storage across all nested hosts', pros: ['Practise vSAN configuration', 'Required for VCF/VCAP study', 'Mirrors enterprise deployments'], cons: ['Requires 3+ hosts', 'High RAM overhead', 'Complex to troubleshoot'], risk: 'vSAN health issues can take down the whole cluster', bestFor: 'VCP-VVF Admin, VCP-VCF Admin, VCAP Storage, enterprise simulation' },
      { label: 'Local datastores', approach: 'Each nested host uses its own local disk', pros: ['Simple to configure', 'Lower resource overhead', 'Works on single host'], cons: ['No vMotion across hosts', 'No shared storage features'], risk: 'VMs pinned to one host', bestFor: 'Basic vSphere study, resource-constrained hardware' },
    ],
    decisionKey: 'Storage architecture'
  },
  nsx: {
    title: 'NSX deployment decision',
    context: 'NSX adds powerful networking capabilities but also significant resource overhead and complexity. Be clear on why you need it before committing.',
    options: [
      { label: 'Deploy NSX', approach: 'NSX Manager + T0/T1 gateway topology', pros: ['Micro-segmentation with DFW', 'T0/T1 routing practice', 'Required for VCF certs'], cons: ['48GB+ RAM for NSX Manager', 'Significantly more complex', 'Deployment takes hours'], risk: 'NSX misconfiguration can break all VM networking', bestFor: 'VCP-VCF Admin, VCP-VCF Architect, VCAP Networking, customer NSX environments' },
      { label: 'No NSX', approach: 'Standard vSphere networking only (VDS port groups)', pros: ['Much simpler', 'Lower resource requirements', 'Faster to build'], cons: ['No micro-segmentation', 'No overlay networking practice', 'Cannot study NSX features'], risk: 'Lab does not reflect modern enterprise networking', bestFor: 'VCP-VVF Admin, basic vSphere, resource-constrained hardware' },
    ],
    decisionKey: 'NSX deployment'
  },
  clusterSize: {
    title: 'Cluster size decision',
    context: 'Cluster size is the single biggest factor in lab capability and resource consumption. Balance what you need to learn against what your hardware can support.',
    options: [
      { label: '3 hosts', approach: '3 nested ESXi hosts with vSAN and full HA', pros: ['Full HA/DRS capability', 'vSAN minimum requirement met', 'Mirrors enterprise minimum'], cons: ['Highest resource consumption', 'Requires 192GB+ physical RAM with NSX'], risk: 'May hit physical RAM ceiling', bestFor: 'VCP-VVF Admin with vSAN, VCP-VCF Admin, VCAP Storage, production-like simulation' },
      { label: '2 hosts', approach: '2 nested ESXi hosts, no vSAN', pros: ['Basic vMotion practice', 'Lower resource than 3 hosts', 'HA configured (limited)'], cons: ['No vSAN possible', 'HA cannot tolerate host failure safely'], risk: 'HA admission control issues with only 2 hosts', bestFor: 'Basic vMotion study, resource-constrained hardware' },
      { label: '1 host', approach: 'Single nested ESXi host', pros: ['Lowest resource consumption', 'Fast to build', 'Good for vCenter-only study'], cons: ['No HA, no vMotion, no vSAN', 'No cluster features at all'], risk: 'Single point of failure — any issue takes down all nested VMs', bestFor: 'Minimal footprint, basic vSphere administration' },
    ],
    decisionKey: 'Cluster size'
  }
};

function showOptionsAnalysis(key, onComplete) {
  const config = OPTIONS_ANALYSIS[key];
  if (!config || !state.architectMode) { if (onComplete) onComplete(); return; }

  const panel = document.getElementById('arch-options-panel');
  const title = document.getElementById('arch-options-title');
  const context = document.getElementById('arch-options-context');
  const table = document.getElementById('arch-options-table');
  const rationale = document.getElementById('arch-options-rationale');
  const confirm = document.getElementById('arch-options-confirm');
  const skip = document.getElementById('arch-options-skip');
  if (!panel) { if (onComplete) onComplete(); return; }

  if (title) title.textContent = config.title;
  if (context) context.textContent = config.context;
  if (rationale) rationale.value = '';

  if (table) {
    table.innerHTML = '';
    const opts = config.options;
    const hdr = document.createElement('div');
    hdr.className = 'arch-opt-row arch-opt-header';
    hdr.innerHTML = `<span class="arch-opt-cell arch-opt-label-cell"></span>` +
      opts.map((o, i) => `<button type="button" class="arch-opt-cell arch-opt-header-btn" data-opt-idx="${i}">${escHtml(o.label)}</button>`).join('');
    table.appendChild(hdr);

    const rows = [
      { key: 'approach', label: 'Approach' },
      { key: 'pros',     label: 'Pros',    isList: true },
      { key: 'cons',     label: 'Cons',    isList: true },
      { key: 'risk',     label: 'Main risk' },
      { key: 'bestFor',  label: 'Best for' },
    ];
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'arch-opt-row';
      row.innerHTML = `<span class="arch-opt-cell arch-opt-label-cell">${r.label}</span>` +
        opts.map(o => {
          const value = o[r.key];
          const content = r.isList && Array.isArray(value)
            ? value.map(v => `<div class="arch-opt-list-item">${escHtml(v)}</div>`).join('')
            : escHtml(value || '—');
          return `<div class="arch-opt-cell">${content}</div>`;
        }).join('');
      table.appendChild(row);
    });

    table.querySelectorAll('.arch-opt-header-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        table.querySelectorAll('.arch-opt-header-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        panel.dataset.selectedOpt = btn.dataset.optIdx;
      });
    });
  }

  panel.hidden = false;

  const close = (logIt) => {
    if (logIt && panel.dataset.selectedOpt !== undefined) {
      const idx = Number(panel.dataset.selectedOpt);
      const chosen = config.options[idx];
      const others = config.options.filter((_, i) => i !== idx).map(o => o.label).join(' / ');
      if (chosen) {
        addDecision(config.decisionKey, chosen.label, others, rationale?.value || '');
      }
    }
    panel.hidden = true;
    delete panel.dataset.selectedOpt;
    if (onComplete) onComplete();
  };

  if (confirm) confirm.onclick = () => close(true);
  if (skip)    skip.onclick    = () => close(false);
}

// ── Save / Resume ──────────────────────────────────────────────────────────

const AUTOSAVE_KEY = 'vsphere-wizard-autosave';
const STEP_LABELS  = ['Physical host', 'Home network', 'Storage', 'Use case', 'Recommended template', 'Virtual router', 'Domain controller', 'Lab networks', 'Nested cluster', 'NSX-T', 'Workload VMs', 'Review & generate'];

function buildWizardSave(asTemplate = false) {
  const answers = JSON.parse(JSON.stringify(state.answers));
  if (asTemplate) {
    answers.hardware.ipAddress = null;
    (answers.hardware.additionalHosts || []).forEach(h => { h.ipAddress = null; });
    answers.design.dcIpAddress   = null;
    answers.design.nsxIpAddress  = null;
    answers.design.depotIpAddress = null;
    answers.design.nestedEsxiPassword = '';
    answers.design.vcfEsxiPassword    = '';
    answers.design.vcfEsxiLicense     = '';
    answers.design.vcfVcenterLicense  = '';
    answers.design.vcfSddcMgrIp   = null;
    answers.design.vcfVcenterIp   = null;
    // Local file paths are specific to the machine that generated this
    // template — strip them so a shared template doesn't leak someone else's
    // folder layout.
    answers.design.vyosIso           = null;
    answers.design.windowsServerIso  = null;
    answers.design.esxiIso           = null;
    answers.design.nestedEsxiOva     = null;
    answers.design.vCenterOva        = null;
  }
  return {
    _type:    asTemplate ? 'lab-template' : 'wizard-config',
    _version: 1,
    _savedAt: new Date().toISOString(),
    _step:    state.step,
    learningMode:  state.learningMode,
    architectMode: state.architectMode,
    answers,
    designRationale: JSON.parse(JSON.stringify(state.designRationale)),
    discovery:       JSON.parse(JSON.stringify(state.discovery)),
    decisionLog:     JSON.parse(JSON.stringify(state.decisionLog)),
    riskRegister:    JSON.parse(JSON.stringify(state.riskRegister))
  };
}

function isValidWizardConfig(obj) {
  return obj && typeof obj === 'object' &&
    (obj._type === 'wizard-config' || obj._type === 'lab-template') &&
    obj._version === 1 &&
    obj.answers && typeof obj.answers === 'object';
}

function configSummary(config) {
  const g = (config.answers || {}).design || {};
  const h = (config.answers || {}).hardware || {};
  const parts = [];
  if (g.esxiVersion)    parts.push(`ESXi ${g.esxiVersion}`);
  if (g.nestedHostCount) parts.push(`${g.nestedHostCount}-host cluster`);
  if (g.nsxEnabled)     parts.push('NSX-T');
  if (g.vcfEnabled)     parts.push('VCF');
  if (h.ramGB)          parts.push(`${h.ramGB} GB host`);
  return parts.join(' · ') || 'Saved configuration';
}

function formatTimeAgo(date) {
  const mins  = Math.floor((Date.now() - date.getTime()) / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins  <  2) return 'just now';
  if (mins  < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function autoSave() {
  if (!state.modeSelected) return;
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildWizardSave())); } catch (e) {}
}

function clearAutoSave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
}

function downloadWizardConfig(asTemplate = false) {
  const save = buildWizardSave(asTemplate);
  const ts   = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const fname = asTemplate ? `lab-template-${ts}.labtemplate` : `wizard-config-${ts}.json`;
  const blob  = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = fname; a.click();
  URL.revokeObjectURL(url);
}

function populateFormFromState() {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = (v == null) ? '' : String(v);
  }
  function setCheck(id, v) {
    const el = document.getElementById(id);
    if (el) el.checked = !!v;
  }
  function setRadio(name, v) {
    if (v == null) return;
    const el = document.querySelector(`input[name="${name}"][value="${v}"]`);
    if (el) el.checked = true;
  }

  // Step 0
  setRadio('useCase', d.useCase);

  // Step 1
  setVal('hostCount', h.hostCount || 1);
  setVal('host1Ip', h.ipAddress);
  setVal('cpuCores', h.cpuCores);
  setVal('ramGB', h.ramGB);
  setVal('nicCount', h.nicCount);
  setVal('nicSpeed', h.nicSpeed);
  setVal('nicModel', h.nicModel);
  const addHostsSec = document.getElementById('additional-hosts-section');
  if (addHostsSec) addHostsSec.hidden = (h.hostCount || 1) <= 1;
  renderStorageDevices(_onFormChange);
  renderAdditionalHosts(_onFormChange);

  // Step 2
  setVal('esxiVersion', g.esxiVersion);
  setRadio('esxiDeployMethod', g.esxiDeployMethod);

  // Step 3
  setCheck('vyosEnabled', g.vyosEnabled);
  const vyosModeField = document.getElementById('vyos-mode-field');
  if (vyosModeField) vyosModeField.hidden = !g.vyosEnabled;
  if (g.vyosEnabled) setRadio('vyosNetworkMode', g.vyosNetworkMode);

  // Step 4
  setRadio('dcProfile', g.dcProfile || 'none');
  const dcFields = document.getElementById('dc-fields');
  if (dcFields) dcFields.hidden = (g.dcProfile || 'none') === 'none' || g.dcProfile === 'vis';
  const visFieldsEl = document.getElementById('vis-fields');
  if (visFieldsEl) visFieldsEl.hidden = g.dcProfile !== 'vis';
  const storageDiskField = document.getElementById('dc-storage-disk-field');
  if (storageDiskField) storageDiskField.hidden = g.dcProfile !== 'dc-jumpbox-fileserver';
  setVal('dcDomainName', g.dcDomainName);
  setVal('dcIpAddress', g.dcIpAddress);
  setVal('dcStorageDiskGB', g.dcStorageDiskGB || 200);
  setRadio('dcNetworkPlacement', g.dcNetworkPlacement || 'lab');
  setVal('visIpAddress', g.visIpAddress);
  setVal('visOvaPath', g.visOva);

  // Step 5
  setRadio('networkType', d.networkType);
  setRadio('vlanCapable', d.vlanCapable);
  setRadio('dhcpAvailable', d.dhcpAvailable);

  // Step 6
  setVal('mgmtCidr', g.mgmtCidr);
  setRadio('mgmtVlanMode', g.mgmtVlanMode || 'untagged');
  const mgmtVlanIdField = document.getElementById('mgmt-vlan-id-field');
  if (mgmtVlanIdField) mgmtVlanIdField.hidden = g.mgmtVlanMode !== 'tagged';
  setVal('mgmtVlan', g.mgmtVlan);
  setVal('vmotionCidr', g.vmotionCidr);
  setVal('vmotionVlan', g.vmotionVlan);
  setVal('vmCidr', g.vmCidr);
  setVal('vmVlan', g.vmVlan);
  setCheck('vsanEnabled', g.vsanEnabled);
  const vsanNetRow = document.getElementById('vsan-network-row');
  if (vsanNetRow) vsanNetRow.hidden = !g.vsanEnabled;
  setVal('vsanCidr', g.vsanCidr);
  setVal('vsanVlan', g.vsanVlan);

  // Step 7
  setVal('nestedHostCount', g.nestedHostCount);
  setVal('vcpuPerHost', g.vcpuPerHost);
  setVal('vramPerHostGB', g.vramPerHostGB);
  setVal('nestedDiskGB', g.nestedDiskGB);
  setVal('clusterName', g.clusterName);
  setVal('ssoDomain', g.ssoDomain);
  setRadio('vsanArch', g.vsanArch || 'esa');
  setCheck('legacyCpuCompat', g.legacyCpuCompat);
  setCheck('memTieringEnabled', g.memTieringEnabled);
  const tieringFields = document.getElementById('mem-tiering-fields');
  if (tieringFields) tieringFields.hidden = !g.memTieringEnabled;
  setVal('nvmeSizeGB', g.nvmeSizeGB);
  setVal('tierNvmePct', g.tierNvmePct);
  setRadio('nestedHostPlacement', g.nestedHostPlacement || 'auto');
  setVal('nestedEsxiPassword', g.nestedEsxiPassword);
  renderNestedDisks(_onFormChange);

  // Step 8 — Deployment placement
  renderDeploymentPlacement(_onFormChange);

  // Step 9 — NSX
  setCheck('nsxEnabled', g.nsxEnabled);
  const nsxFields = document.getElementById('nsx-fields');
  if (nsxFields) nsxFields.hidden = !g.nsxEnabled;
  setRadio('nsxSize', g.nsxSize || 'small');
  setRadio('nsxTopology', g.nsxTopology || 'T0T1');
  setRadio('nsxEdgeCount', String(g.nsxEdgeCount || 1));
  setVal('nsxEdgeSize', g.nsxEdgeSize || 'medium');
  setVal('nsxIpAddress', g.nsxIpAddress);
  setVal('nsxBgpLocalAs', g.nsxBgpLocalAs || 65001);
  setVal('nsxBgpPeerAs',  g.nsxBgpPeerAs  || 65002);
  setRadio('nsxBgpRouteAdvert', g.nsxBgpRouteAdvert || 'all');
  const bgpPrefixFields = document.getElementById('nsx-bgp-prefix-fields');
  if (bgpPrefixFields) bgpPrefixFields.hidden = g.nsxBgpRouteAdvert !== 'specific';
  setVal('nsxBgpPrefixes', g.nsxBgpPrefixes);
  setCheck('nsxRedistConnected', g.nsxRedistConnected !== false);
  setCheck('nsxRedistStatic',    g.nsxRedistStatic);
  setCheck('nsxRedistT1Lb',      g.nsxRedistT1Lb);

  // Step 10 — VCF
  setCheck('vcfEnabled', g.vcfEnabled);
  const vcfFields = document.getElementById('vcf-fields');
  if (vcfFields) vcfFields.hidden = !g.vcfEnabled;
  setVal('vcfSddcMgrIp',       g.vcfSddcMgrIp);
  setVal('vcfSddcMgrHostname', g.vcfSddcMgrHostname || 'sddcmgr');
  setVal('vcfVcenterIp',       g.vcfVcenterIp);
  setVal('vcfVtepCidr',        g.vcfVtepCidr);
  setVal('vcfVtepVlan',        g.vcfVtepVlan);
  setVal('vcfEdgeUplink1Cidr', g.vcfEdgeUplink1Cidr);
  setVal('vcfEdgeUplink1Vlan', g.vcfEdgeUplink1Vlan);
  setVal('vcfEdgeUplink2Cidr', g.vcfEdgeUplink2Cidr);
  setVal('vcfEdgeUplink2Vlan', g.vcfEdgeUplink2Vlan);
  setVal('vcfEsxiPassword',    g.vcfEsxiPassword);
  setVal('vcfEsxiLicense',     g.vcfEsxiLicense);
  setVal('vcfVcenterLicense',  g.vcfVcenterLicense);

  // Step 12 — Depot
  setCheck('depotEnabled', g.depotEnabled);
  const depotFields = document.getElementById('depot-fields');
  if (depotFields) depotFields.hidden = !g.depotEnabled;
  setRadio('depotMode', g.depotMode || 'linux');
  setVal('depotIpAddress', g.depotIpAddress);

  // Step 13 — Workloads
  setCheck('workloadVmsEnabled', g.workloadVmsEnabled);
  const workloadFields = document.getElementById('workload-fields');
  if (workloadFields) workloadFields.hidden = !g.workloadVmsEnabled;
  setVal('workloadVmCount', g.workloadVmCount);
  setRadio('workloadVmSize', g.workloadVmSize || 'small');

  // Step 14 — Security
  setCheck('isolateLab',    g.isolateLab);
  setCheck('internetAccess', g.internetAccess);
  if (g.firewallPolicy) setRadio('firewallPolicy', g.firewallPolicy);
  setVal('remoteAccessMethod', g.remoteAccessMethod);
  const vpnTypeField = document.getElementById('vpn-type-field');
  if (vpnTypeField) vpnTypeField.hidden = g.remoteAccessMethod !== 'vpn';
  if (g.vpnType) setRadio('vpnType', g.vpnType);
  setVal('vcenterSize', g.vcenterSize);

  // Software library / file locations (merged into Hardware, step 0)
  setVal('vyosIsoPath', g.vyosIso);
  setVal('windowsServerIsoPath', g.windowsServerIso);
  setVal('esxiIsoPath', g.esxiIso);
  setVal('nestedEsxiOvaPath', g.nestedEsxiOva);
  setVal('vCenterOvaPath', g.vCenterOva);
}

function loadWizardConfig(config) {
  const src = config.answers || {};
  if (src.discovery) Object.assign(state.answers.discovery, src.discovery);
  if (src.hardware)  Object.assign(state.answers.hardware,  src.hardware);
  if (src.design)    Object.assign(state.answers.design,    src.design);
  state.learningMode  = !!config.learningMode;
  state.architectMode = !!config.architectMode;
  if (config.designRationale) Object.assign(state.designRationale, config.designRationale);
  if (config.discovery)       Object.assign(state.discovery, config.discovery);
  if (Array.isArray(config.decisionLog))  state.decisionLog  = config.decisionLog;
  if (Array.isArray(config.riskRegister)) state.riskRegister = config.riskRegister;
  if (state.learningMode) document.body.classList.add('learning-mode');
  populateFormFromState();
  return Math.min(Number(config._step) || 0, TOTAL_STEPS - 2);
}

function enterAppWithConfig(config, showBanner) {
  const targetStep = loadWizardConfig(config);
  state.modeSelected = true;
  const screen = document.getElementById('mode-select-screen');
  const app    = document.querySelector('.app');
  if (screen) screen.hidden = true;
  if (app)    app.hidden    = false;

  if (state.architectMode) {
    const dlPanel = document.getElementById('arch-decision-log-panel');
    const rrPanel = document.getElementById('arch-risk-register-panel');
    if (dlPanel) dlPanel.hidden = false;
    if (rrPanel) rrPanel.hidden = false;
    wireArchitectWizardSteps();
    renderDecisionLog();
    renderRiskRegister();
  }

  showStep(targetStep);
  renderTopology();

  if (showBanner) {
    const banner = document.getElementById('config-loaded-banner');
    if (banner) {
      const d       = new Date(config._savedAt);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const kind    = config._type === 'lab-template' ? 'template' : 'config';
      banner.textContent = `Loaded ${kind} from ${dateStr} — ${configSummary(config)}`;
      banner.hidden = false;
      setTimeout(() => { banner.hidden = true; }, 5000);
    }
  }
}

function checkAutoSave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    const config = JSON.parse(raw);
    if (!isValidWizardConfig(config) || config._type !== 'wizard-config') return;
    const step   = Math.min(Number(config._step) || 0, STEP_LABELS.length - 1);
    const banner = document.getElementById('autosave-banner');
    const msg    = document.getElementById('autosave-banner-msg');
    if (banner && msg) {
      msg.textContent = `Saved session from ${formatTimeAgo(new Date(config._savedAt))} — step ${step + 1}: ${STEP_LABELS[step]}`;
      banner.hidden = false;
    }
  } catch (e) {}
}

function wireAutoSave() {
  // Autosave resume banner
  document.getElementById('autosave-resume-btn')?.addEventListener('click', () => {
    try {
      const config = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
      if (!isValidWizardConfig(config)) return;
      enterAppWithConfig(config, false);
    } catch (e) {}
  });

  document.getElementById('autosave-discard-btn')?.addEventListener('click', () => {
    clearAutoSave();
    const banner = document.getElementById('autosave-banner');
    if (banner) banner.hidden = true;
  });

  // Save progress button in sidebar
  document.getElementById('rail-save-btn')?.addEventListener('click', () => {
    downloadWizardConfig(false);
  });

  // Export as template button on review screen
  document.getElementById('btn-export-template')?.addEventListener('click', () => {
    downloadWizardConfig(true);
  });

  // Continue saved design file input
  document.getElementById('load-config-input')?.addEventListener('change', (e) => {
    const file     = e.target.files[0];
    const statusEl = document.getElementById('load-config-status');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const config = JSON.parse(ev.target.result);
        if (!isValidWizardConfig(config)) {
          if (statusEl) statusEl.textContent = 'Not a valid wizard config file.';
          return;
        }
        if (config._type !== 'wizard-config') {
          if (statusEl) statusEl.textContent = 'This is a template — use “Start from template” instead.';
          return;
        }
        if (statusEl) statusEl.textContent = '';
        enterAppWithConfig(config, true);
      } catch { if (statusEl) statusEl.textContent = 'Invalid file — could not load.'; }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Start from template file input
  document.getElementById('load-template-input')?.addEventListener('change', (e) => {
    const file     = e.target.files[0];
    const statusEl = document.getElementById('load-template-status');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const config = JSON.parse(ev.target.result);
        if (!isValidWizardConfig(config)) {
          if (statusEl) statusEl.textContent = 'Not a valid lab template file.';
          return;
        }
        if (config._type !== 'lab-template') {
          if (statusEl) statusEl.textContent = 'This is a full save — use “Continue saved design” instead.';
          return;
        }
        if (statusEl) statusEl.textContent = '';
        config._step = 0;
        enterAppWithConfig(config, true);
      } catch { if (statusEl) statusEl.textContent = 'Invalid file — could not load.'; }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

function placementBuildHostOptions() {
  const h = state.answers.hardware;
  const physCount = Number(h.hostCount) || 1;
  const hosts = [{ idx: 0, label: `Physical host 1${h.ipAddress ? ' — ' + h.ipAddress : ''}` }];
  const addHosts = h.additionalHosts || [];
  for (let i = 0; i < Math.min(physCount - 1, addHosts.length); i++) {
    const ah = addHosts[i];
    const ip = ah.ipAddress || null;
    hosts.push({ idx: i + 1, label: `Physical host ${i + 2}${ip ? ' — ' + ip : ''}` });
  }
  return hosts;
}

function renderInfraPlacement(onChange) {
  const g = state.answers.design;
  const section = document.getElementById('infra-placement-section');
  const rows = document.getElementById('infra-placement-rows');
  if (!section || !rows) return;

  const comps = [];
  if (g.vyosEnabled) comps.push({ key: 'deployVyosHostIdx', label: 'VyOS router', ram: VYOS_RAM_GB_SIZING });
  if (g.dcProfile && g.dcProfile !== 'none') {
    comps.push({ key: 'deployDcHostIdx', label: 'Domain controller', ram: DC_RAM_GB_BY_PROFILE[g.dcProfile] || 4 });
  }

  section.hidden = comps.length === 0;
  if (comps.length === 0) return;

  const physHosts = placementBuildHostOptions();

  rows.innerHTML = '';
  for (const comp of comps) {
    const row = document.createElement('div');
    row.className = 'placement-infra-row';

    const lbl = document.createElement('span');
    lbl.className = 'placement-vm-name';
    lbl.textContent = comp.label;

    const ramBadge = document.createElement('span');
    ramBadge.className = 'placement-vm-ram';
    ramBadge.textContent = comp.ram + ' GB';

    const sel = document.createElement('select');
    sel.className = 'placement-select';
    for (const ph of physHosts) {
      const opt = document.createElement('option');
      opt.value = ph.idx;
      opt.textContent = ph.label;
      opt.selected = (Number(g[comp.key]) === ph.idx);
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      g[comp.key] = Number(sel.value);
      onChange();
      renderPlacementRamSummary();
    });

    row.append(lbl, ramBadge, sel);
    rows.appendChild(row);
  }
}

function renderPlacementRamSummary() {
  const summaryEl = document.getElementById('placement-ram-summary');
  if (!summaryEl) return;

  const h = state.answers.hardware;
  const g = state.answers.design;
  const physCount = Number(h.hostCount) || 1;

  const physHosts = [];
  physHosts.push({ ip: h.ipAddress || null, ramGB: Number(h.ramGB) || 0, vms: [], totalRam: 0 });
  const addHosts = h.additionalHosts || [];
  for (let i = 0; i < Math.min(physCount - 1, addHosts.length); i++) {
    const ah = addHosts[i];
    physHosts.push({
      ip: ah.ipAddress || null,
      ramGB: ah.sameAsFirst !== false ? (Number(h.ramGB) || 0) : (Number(ah.ramGB) || 0),
      vms: [], totalRam: 0
    });
  }

  const nestedCount = Number(g.nestedHostCount) || 0;
  const vramPerHost = Number(g.vramPerHostGB) || 16;
  const assignments = g.nestedHostPlacement === 'manual' && g.nestedHostAssignments.length >= nestedCount
    ? g.nestedHostAssignments.map((v) => Math.min(Number(v) || 0, physCount - 1))
    : Array.from({ length: nestedCount }, (_, i) => i % physCount);

  for (let i = 0; i < nestedCount; i++) {
    const phIdx = Math.min(assignments[i] ?? (i % physCount), physHosts.length - 1);
    physHosts[phIdx].vms.push({ label: 'nested-esxi-' + String(i + 1).padStart(2, '0'), ram: vramPerHost });
    physHosts[phIdx].totalRam += vramPerHost;
  }

  if (g.vyosEnabled) {
    const phIdx = Math.min(Number(g.deployVyosHostIdx) || 0, physHosts.length - 1);
    physHosts[phIdx].vms.push({ label: 'VyOS router', ram: VYOS_RAM_GB_SIZING });
    physHosts[phIdx].totalRam += VYOS_RAM_GB_SIZING;
  }

  if (g.dcProfile && g.dcProfile !== 'none') {
    const dcRam = DC_RAM_GB_BY_PROFILE[g.dcProfile] || 4;
    const phIdx = Math.min(Number(g.deployDcHostIdx) || 0, physHosts.length - 1);
    physHosts[phIdx].vms.push({ label: 'Domain controller', ram: dcRam });
    physHosts[phIdx].totalRam += dcRam;
  }

  let html = '';
  for (let i = 0; i < physHosts.length; i++) {
    const ph = physHosts[i];
    const pct = ph.ramGB > 0 ? Math.min(100, Math.round(ph.totalRam / ph.ramGB * 100)) : 0;
    const over = ph.ramGB > 0 && ph.totalRam > ph.ramGB;
    const label = 'Physical host ' + (i + 1) + (ph.ip ? ' (' + ph.ip + ')' : '');
    html += '<div class="placement-host-card' + (over ? ' placement-host-over' : '') + '">';
    html += '<div class="placement-host-header"><span class="placement-host-name">' + escHtml(label) + '</span>';
    html += '<span class="placement-host-ram' + (over ? ' over' : '') + '">' + ph.totalRam + ' / ' + (ph.ramGB || '?') + ' GB</span></div>';
    html += '<div class="placement-ram-track"><div class="placement-ram-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div>';
    if (ph.vms.length) {
      html += '<ul class="placement-vm-list">';
      for (const vm of ph.vms) html += '<li>' + escHtml(vm.label) + ': ' + vm.ram + ' GB</li>';
      html += '</ul>';
    } else {
      html += '<p class="placement-no-vms">No VMs assigned to this host</p>';
    }
    if (over) {
      html += '<p class="placement-over-warning">⚠ Over capacity by ' + (ph.totalRam - ph.ramGB) + ' GB &mdash; reduce assignments or add RAM</p>';
    }
    html += '</div>';
  }
  summaryEl.innerHTML = html;
}

function renderDeploymentPlacement(onChange) {
  const h = state.answers.hardware;
  const physCount = Number(h.hostCount) || 1;

  const singleNotice = document.getElementById('placement-singlehost-notice');
  const multiContent = document.getElementById('placement-multihost-content');
  if (singleNotice) singleNotice.hidden = physCount > 1;
  if (multiContent) multiContent.hidden = physCount < 2;
  if (physCount < 2) return;

  renderInfraPlacement(onChange);
  renderPlacementRows(onChange);
  renderPlacementRamSummary();
}

function renderReviewPlacement() {
  const el = document.getElementById('review-placement-section');
  if (!el) return;

  const h = state.answers.hardware;
  const g = state.answers.design;
  const physCount = Number(h.hostCount) || 1;

  if (physCount < 2) { el.hidden = true; return; }
  el.hidden = false;

  const physHosts = [];
  physHosts.push({ ip: h.ipAddress || null, vms: [] });
  const addHosts = h.additionalHosts || [];
  for (let i = 0; i < Math.min(physCount - 1, addHosts.length); i++) {
    physHosts.push({ ip: addHosts[i].ipAddress || null, vms: [] });
  }

  const nestedCount = Number(g.nestedHostCount) || 0;
  const assignments = g.nestedHostPlacement === 'manual' && g.nestedHostAssignments.length >= nestedCount
    ? g.nestedHostAssignments.map((v) => Math.min(Number(v) || 0, physCount - 1))
    : Array.from({ length: nestedCount }, (_, i) => i % physCount);

  for (let i = 0; i < nestedCount; i++) {
    const phIdx = Math.min(assignments[i] ?? (i % physCount), physHosts.length - 1);
    physHosts[phIdx].vms.push('nested-esxi-' + String(i + 1).padStart(2, '0'));
  }
  if (g.vyosEnabled) {
    const phIdx = Math.min(Number(g.deployVyosHostIdx) || 0, physHosts.length - 1);
    physHosts[phIdx].vms.unshift('VyOS router');
  }
  if (g.dcProfile && g.dcProfile !== 'none') {
    const phIdx = Math.min(Number(g.deployDcHostIdx) || 0, physHosts.length - 1);
    physHosts[phIdx].vms.unshift('Domain controller');
  }

  let html = '<table class="review-placement-table"><thead><tr><th>Physical host</th><th>VMs assigned</th></tr></thead><tbody>';
  for (let i = 0; i < physHosts.length; i++) {
    const ph = physHosts[i];
    const hostLabel = 'Physical host ' + (i + 1) + (ph.ip ? ' &mdash; ' + escHtml(ph.ip) : '');
    const vmList = ph.vms.length ? ph.vms.map(escHtml).join(', ') : '<em>none</em>';
    html += '<tr><td>' + hostLabel + '</td><td>' + vmList + '</td></tr>';
  }
  html += '<tr><td colspan="2" class="review-placement-vcenter-note">vCenter deploys onto nested-esxi-01 after that host is running</td></tr>';
  html += '</tbody></table>';
  el.querySelector('.review-placement-body').innerHTML = html;
}

// --- Init ---

wireForm();
wireNav();
wireGenerate();
wireInlineValidation();
wirePrereqScreen();
wireModeSelect();
wireLearningOnboard();
wireLearningInputs();
wireArchPanelToggles();
wireAutoSave();
checkAutoSave();
renderTopology();
