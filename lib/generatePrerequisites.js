// lib/generatePrerequisites.js
//
// Generates PREREQUISITES.md -- a short, personalised checklist included
// alongside every set of generated scripts. Everything here should be
// actionable before the user runs their first script.

function buildPrerequisites(spec) {
  const nc   = spec.nestedCluster || {};
  const vyos = spec.vyos || {};
  const dc   = spec.domainController || {};
  const vcf  = spec.vcf  || {};
  const esxiLabel = spec.esxiVersion?.label || 'ESXi';

  const lines = [];

  lines.push('# Prerequisites');
  lines.push('');
  lines.push('Read this before running any of the generated scripts.');
  lines.push('Everything here needs to be in place first -- the scripts will');
  lines.push('fail with unhelpful errors if these are missing.');
  lines.push('');

  // ── 1. PowerShell ──────────────────────────────────────────────────────
  lines.push('## PowerShell');
  lines.push('');
  lines.push('**Required: PowerShell 7.2 or newer** (PowerShell Core, not Windows PowerShell 5.1).');
  lines.push('');
  lines.push('- Windows: download from https://github.com/PowerShell/PowerShell/releases');
  lines.push('  or `winget install Microsoft.PowerShell`');
  lines.push('- macOS: `brew install powershell/tap/powershell`');
  lines.push('- Linux: follow the install guide at https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux');
  lines.push('');
  lines.push('Verify: `pwsh --version` should print `PowerShell 7.x.x`.');
  lines.push('');

  // ── 2. VMware PowerCLI ─────────────────────────────────────────────────
  lines.push('## VMware PowerCLI');
  lines.push('');
  lines.push('**Required: PowerCLI 13.x or newer.**');
  lines.push('');
  lines.push('Install from a PowerShell 7 session:');
  lines.push('');
  lines.push('```powershell');
  lines.push('Install-Module VMware.PowerCLI -Scope CurrentUser');
  lines.push('```');
  lines.push('');
  lines.push('You will see an "untrusted repository" prompt -- type `Y` to accept.');
  lines.push('The install downloads ~200 MB and takes a few minutes.');
  lines.push('');
  lines.push('After installing, suppress the CEIP prompt:');
  lines.push('');
  lines.push('```powershell');
  lines.push('Set-PowerCLIConfiguration -ParticipateInCEIP $false -Confirm:$false');
  lines.push('```');
  lines.push('');
  lines.push('Verify: `Get-Module VMware.PowerCLI -ListAvailable | Select Version`');
  lines.push('');

  // ── 3. govc ─────────────────────────────────────────────────────────────
  const ovaDeployMethod = spec.esxiDeployMethod === 'ova';
  lines.push('## govc');
  lines.push('');
  if (ovaDeployMethod) {
    lines.push('**Required.** `deploy-lab.ps1` uses `govc` for the nested ESXi OVA import --');
    lines.push('there is no PowerCLI fallback, since `Import-VApp`/`Get-OvfConfiguration` has');
    lines.push('known reliability problems against a standalone ESXi host (vApp import assumes');
    lines.push('a vCenter-managed inventory that does not exist yet at this stage of the build).');
    lines.push('`vcenter-deploy.ps1` also detects `govc` and uses it as the primary deployment');
    lines.push('method there, falling back to PowerCLI `Import-VApp` if govc is not found.');
  } else {
    lines.push('**Required for vCenter deployment.** `vcenter-deploy.ps1` detects `govc`');
    lines.push('and uses it as the primary deployment method; it falls back to PowerCLI');
    lines.push('`Import-VApp` if govc is not found -- but govc is faster and more reliable');
    lines.push('for large OVA files.');
  }
  lines.push('');
  lines.push('Download the latest release for your platform from:');
  lines.push('https://github.com/vmware/govmomi/releases');
  lines.push('');
  lines.push('- Windows: download `govc_windows_amd64.exe`, rename to `govc.exe`,');
  lines.push('  place it in a directory on your `$PATH` (e.g. `C:\\Windows\\System32`)');
  lines.push('- macOS: `brew install govc`');
  lines.push('- Linux: `curl -L <url> | gunzip > /usr/local/bin/govc && chmod +x /usr/local/bin/govc`');
  lines.push('');
  lines.push('Verify: `govc version`');
  lines.push('');

  // ── 4. Broadcom account ────────────────────────────────────────────────
  lines.push('## Broadcom portal account');
  lines.push('');
  lines.push('You need a free account at **https://support.broadcom.com** to download');
  lines.push('ESXi and vCenter ISOs. Registration is free -- use a personal or work email.');
  if (vcf.enabled) {
    lines.push('');
    lines.push('For VCF you need downloads from two locations in the portal:');
    lines.push('- **VMware vSphere → My Downloads** -- ESXi ISO, vCenter VCSA');
    lines.push('- **VMware Cloud Foundation → My Downloads** -- Cloud Builder OVA');
  } else {
    lines.push('Once logged in, ISOs are under **VMware vSphere → My Downloads**.');
  }
  lines.push('');

  // ── 5. ISO files ───────────────────────────────────────────────────────
  lines.push('## ISO / OVA files');
  lines.push('');
  lines.push('The following files are required for **your specific design**.');
  lines.push('Download them before running the scripts.');
  lines.push('');
  lines.push('**None of the scripts prompt you for these paths.** Every script reads them from');
  lines.push('`lab-config.json` (included in this output), which must sit in the same folder as');
  lines.push('the scripts. It\'s already filled in with whatever you entered on the "File locations"');
  lines.push('step of the wizard -- double-check the paths below match reality (especially if you');
  lines.push('left any blank there) before running anything. Each script validates that its file');
  lines.push('actually exists at the configured path and stops with a clear error if not.');
  lines.push('`lab-config.json.example` is also included as a blank reference copy of the schema.');
  lines.push('');

  // ── Where files go: localPaths vs datastorePaths ──────────────────────
  lines.push('### Where each file goes: `localPaths` vs `datastorePaths`');
  lines.push('');
  lines.push('`lab-config.json` has two sections, and which one a file belongs in depends on');
  lines.push('*how the script mounts it* -- not on where you happened to download it:');
  lines.push('');
  lines.push('| File | Config key | Lives in | Why |');
  lines.push('|------|-----------|----------|-----|');
  lines.push(`| ${esxiLabel} install ISO | \`localPaths.esxiIso\` | Windows machine | Mounted as CD-ROM media (\`Set-CDDrive\`) -- the script uploads it to the datastore automatically |`);
  lines.push('| VyOS ISO | `localPaths.vyosIso` | Windows machine | Same -- CD-ROM mount, auto-uploaded |');
  lines.push('| Windows Server ISO | `localPaths.windowsServerIso` | Windows machine | Same -- CD-ROM mount, auto-uploaded |');
  lines.push('| vCenter Server Appliance OVA | `localPaths.vCenterOva` | Windows machine | Deployed via `Import-VApp`/`govc`, which read and upload the file themselves |');
  lines.push('| Nested ESXi appliance OVA *(OVA deploy method only)* | `localPaths.nestedEsxiOva` | Windows machine | Same -- `Import-VApp` reads it directly |');
  lines.push('');
  lines.push('**Why the CD-ROM ISOs need a datastore path at all:** `Set-CDDrive -IsoPath` only');
  lines.push('accepts a path already on a datastore the ESXi host can see -- it cannot read a file');
  lines.push('off your Windows machine directly. The scripts handle this for you: point');
  lines.push('`localPaths` at the file on your Windows machine, and the script uploads it to');
  lines.push('`[<your datastore>] ISOs/<filename>` on first run (skipped on later runs if it\'s');
  lines.push('already there).');
  lines.push('');
  lines.push('**If you already have an ISO staged on the datastore** (e.g. reused from a previous');
  lines.push('lab build), set the matching key under `datastorePaths` instead -- e.g.');
  lines.push('`datastorePaths.esxiIso = "[datastore1] ISOs/esxi-9.0.iso"`. The script uses that path');
  lines.push('directly and skips the local file check and upload entirely. Leave it blank (the');
  lines.push('default) to use the `localPaths` + auto-upload flow.');
  lines.push('');
  lines.push('**VCSA and the nested-ESXi OVA have no `datastorePaths` equivalent** -- the tools that');
  lines.push('deploy them (`Import-VApp`, `govc`) always read the source file from wherever the');
  lines.push('script runs, so they only ever come from `localPaths`.');
  lines.push('');

  // ESXi ISO -- always required
  lines.push(`### ${esxiLabel} ISO`);
  lines.push('');
  lines.push(`**Required** -- \`deploy-lab.ps1\` attaches this to each nested ESXi VM.`);
  lines.push('Set `localPaths.esxiIso` (or `datastorePaths.esxiIso` if already staged) in `lab-config.json`.');
  lines.push('');
  lines.push('Download from: https://support.broadcom.com → VMware vSphere → My Downloads');
  lines.push(`Search for \`${esxiLabel}\` and download the full installer ISO`);
  lines.push('(filename starts with `VMware-VMvisor-Installer-`).`');
  lines.push('');

  // vCenter VCSA OVA -- always required
  lines.push('### vCenter Server Appliance (VCSA) OVA');
  lines.push('');
  lines.push('**Required** -- `vcenter-deploy.ps1` deploys the VCSA from this file.');
  lines.push('Set `localPaths.vCenterOva` in `lab-config.json` -- this one is always a local path');
  lines.push('(see "Where each file goes" above).');
  lines.push('');
  lines.push('Download from: https://support.broadcom.com → VMware vSphere → My Downloads');
  lines.push('Download the **VMware vCenter Server Appliance** ISO bundle');
  lines.push('(filename starts with `VMware-VCSA-all-`). Mount or extract it -- the');
  lines.push('OVA is inside under `vcsa/`. Point `localPaths.vCenterOva` at the extracted OVA,');
  lines.push('not the original ISO bundle.');
  lines.push('');

  // VyOS ISO -- conditional
  if (vyos.enabled) {
    lines.push('### VyOS ISO');
    lines.push('');
    lines.push('**Required** -- `vyos-deploy.ps1` attaches this to the VyOS router VM.');
    lines.push('Set `localPaths.vyosIso` (or `datastorePaths.vyosIso` if already staged) in `lab-config.json`.');
    lines.push('');
    lines.push('Download the latest LTS rolling release from: https://vyos.io/get-vyos/');
    lines.push('Click **Download** and select **LTS** -- filename starts with `vyos-`.``');
    lines.push('');
  }

  // Windows Server ISO -- conditional
  if (dc.enabled) {
    lines.push('### Windows Server ISO');
    lines.push('');
    lines.push('**Required** -- `dc-deploy.ps1` attaches this to the domain controller VM.');
    lines.push('Set `localPaths.windowsServerIso` (or `datastorePaths.windowsServerIso` if already');
    lines.push('staged) in `lab-config.json`.');
    lines.push('');
    lines.push('Download a **180-day evaluation** from:');
    lines.push('https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2022');
    lines.push('Select **ISO download** -- a 5 GB file.');
    lines.push('');
  }

  // Cloud Builder OVA -- VCF only
  if (vcf.enabled) {
    lines.push('### VMware Cloud Builder OVA');
    lines.push('');
    lines.push('**Required for VCF bring-up.** Cloud Builder is a separate appliance that');
    lines.push('orchestrates the entire VCF management-domain deployment -- it is distinct from');
    lines.push('the vCenter VCSA OVA.');
    lines.push('');
    lines.push('Download from: https://support.broadcom.com → VMware Cloud Foundation → My Downloads');
    lines.push('Filename starts with `VMware-Cloud-Builder-`. Match the version to your VCF release.');
    lines.push('');
    lines.push('Deploy Cloud Builder manually before running `vcf-prep.ps1`:');
    lines.push('1. Deploy the OVA onto your physical ESXi host (not a nested host).');
    lines.push('2. Set the management IP to a static address reachable from your workstation.');
    lines.push('3. Open `https://<CLOUD-BUILDER-IP>` -- accept the self-signed cert.');
    lines.push('4. Upload `vcf-bringup.json` (generated by this wizard) when prompted.');
    lines.push('');
    lines.push('> **VCF bundles are downloaded separately.** After bring-up, SDDC Manager');
    lines.push('> will prompt you to configure a bundle depot and download component bundles');
    lines.push('> (~10--30 GB) from the Broadcom portal. This is separate from the Cloud Builder OVA.');
    lines.push('');
  }

  // ── 6. Network diagram ────────────────────────────────────────────────
  lines.push('## Network topology diagram (optional)');
  lines.push('');
  lines.push('A Mermaid diagram of your lab topology is always embedded in **build-guide.md**');
  lines.push('as a fenced code block. You can paste it into [mermaid.live](https://mermaid.live)');
  lines.push('at any time to see the full diagram -- no extra software needed.');
  lines.push('');
  lines.push('**For an SVG file export**, `@mermaid-js/mermaid-cli` (mmdc) must be installed');
  lines.push('on the machine running the wizard. The SVG download button only appears when');
  lines.push('mmdc is available.');
  lines.push('');
  lines.push('> **Why it cannot be built in:** mmdc renders diagrams by launching a headless');
  lines.push('> Chromium browser via Puppeteer (~170 MB per platform). That native binary');
  lines.push('> cannot be embedded in the standalone wizard executable.');
  lines.push('');
  lines.push('Install mmdc:');
  lines.push('');
  lines.push('```');
  lines.push('npm install -g @mermaid-js/mermaid-cli');
  lines.push('```');
  lines.push('');
  lines.push('Verify: `mmdc --version`');
  lines.push('');
  lines.push('Then restart the wizard -- SVG export will be available on the next Generate.');
  lines.push('');

  // ── 7. VCF bring-up requirements ──────────────────────────────────────
  if (vcf.enabled) {
    const nets      = spec.networks || {};
    const nsx       = spec.nsx || {};
    const domain    = dc.domainName || 'lab.local';
    const sddcHost  = vcf.sddcManagerHostname || 'sddcmgr';
    const ntpSrc    = spec.ntp?.source || 'pool.ntp.org';
    const hostCount = nc.hostCount || 3;

    const vlanOrBlank = (v) => (v != null ? String(v) : '<not set -- fill in vcf-bringup.json>');

    lines.push('## VCF bring-up requirements');
    lines.push('');
    lines.push('Cloud Builder validates your environment before deploying anything.');
    lines.push('Every item below must be in place before you upload `vcf-bringup.json`.');
    lines.push('');

    // DNS
    lines.push('### DNS -- forward and reverse resolution for all components');
    lines.push('');
    lines.push('Cloud Builder fails pre-validation if it cannot resolve every hostname');
    lines.push('in both directions. Create these records before running `vcf-prep.ps1`:');
    lines.push('');
    lines.push('| Hostname | Type | Value |');
    lines.push('|----------|------|-------|');
    lines.push(`| \`${sddcHost}.${domain}\` | A | ${vcf.sddcManagerIp || '<SDDC Manager IP>'} |`);
    lines.push(`| \`vcenter.${domain}\` | A | ${vcf.vcenterIp || '<vCenter IP>'} |`);
    lines.push(`| \`lab-nsxmgr.${domain}\` | A | ${nsx.ipAddress || '<NSX Manager IP>'} |`);
    for (let i = 1; i <= hostCount; i++) {
      lines.push(`| \`esxi-${i}.${domain}\` | A | <nested ESXi ${i} management IP> |`);
    }
    lines.push('| Reverse PTR for each IP above | PTR | Matching FQDN |');
    lines.push('');
    if (dc.enabled && dc.ipAddress) {
      lines.push(`Add these records in **DNS Manager** on your domain controller (${dc.ipAddress}).`);
    } else {
      lines.push('Add these records in your router\'s local DNS or a dedicated DNS server.');
    }
    lines.push('');
    lines.push('> **SSO domain vs AD domain:** if your SSO domain matches your AD domain name,');
    lines.push('> Cloud Builder bring-up will fail. Use `vsphere.local` (or similar) for SSO.');
    lines.push('');

    // NTP
    lines.push('### NTP sync');
    lines.push('');
    lines.push(`All nested ESXi hosts must be synced to \`${ntpSrc}\` before Cloud Builder`);
    lines.push('connects to them. `vcf-prep.ps1` checks and enables the NTP service');
    lines.push(`automatically -- but \`${ntpSrc}\` must be reachable from each nested host.`);
    lines.push('');

    // VLANs
    lines.push('### Network -- VLAN trunks');
    lines.push('');
    lines.push('Your physical switch port (or virtual switch uplink) must trunk all six');
    lines.push('traffic VLANs to the physical host carrying the nested ESXi VMs:');
    lines.push('');
    lines.push('| Traffic type | VLAN ID |');
    lines.push('|--------------|---------|');
    lines.push(`| Management | ${vlanOrBlank(nets.management?.vlanId)} |`);
    lines.push(`| vMotion | ${vlanOrBlank(nets.vMotion?.vlanId)} |`);
    lines.push(`| vSAN | ${vlanOrBlank(nets.vsan?.vlanId)} |`);
    lines.push(`| NSX VTEP | ${vlanOrBlank(vcf.vtepVlan)} |`);
    lines.push(`| NSX Edge Uplink 1 | ${vlanOrBlank(vcf.edgeUplink1Vlan)} |`);
    lines.push(`| NSX Edge Uplink 2 | ${vlanOrBlank(vcf.edgeUplink2Vlan)} |`);
    lines.push('');

    // Licenses
    lines.push('### Licenses');
    lines.push('');
    lines.push('VCF bring-up requires **production (non-eval) license keys** for ESXi');
    lines.push('and vCenter. Eval keys are rejected by Cloud Builder pre-validation.');
    lines.push('');
    if (vcf.esxiLicense || vcf.vcenterLicense) {
      lines.push('License keys you entered in the wizard are embedded in `vcf-bringup.json`.');
      lines.push('Verify the values in that file before uploading to Cloud Builder.');
    } else {
      lines.push('You did not enter license keys in the wizard. Open `vcf-bringup.json` and');
      lines.push('fill in these fields before uploading:');
      lines.push('- `esxLicense` -- ESXi license key');
      lines.push('- `vcenterSpec.licenseFile` -- vCenter license key');
    }
    lines.push('');

    // Minimum host count
    if (hostCount < 4) {
      lines.push('### ⚠ Minimum host count');
      lines.push('');
      lines.push(`Your design has **${hostCount} nested host(s)**. VCF management domain requires`);
      lines.push('**a minimum of 4 ESXi hosts** (3 for vSAN striping + 1 witness or additional).');
      lines.push('Increase the nested host count in the wizard and regenerate before proceeding.');
      lines.push('');
    }

    // Bring-up order
    lines.push('### Bring-up order');
    lines.push('');
    lines.push('Run steps in this order -- skipping any will cause failures:');
    lines.push('');
    lines.push('1. Deploy all nested ESXi VMs (`deploy-lab.ps1`)');
    lines.push('2. Complete manual ESXi configuration (hostname, IP, DNS suffix)');
    lines.push('3. Create DNS records for all components (see table above)');
    lines.push('4. Deploy Cloud Builder OVA onto the physical host');
    lines.push('5. Run `vcf-prep.ps1` -- fixes NTP/SSH, reports pass/fail per host');
    lines.push('6. Open `https://<CLOUD-BUILDER-IP>` and upload `vcf-bringup.json`');
    lines.push('7. Monitor the bring-up dashboard -- full deployment takes 2--4 hours');
    lines.push('');
  }

  // ── 8. Folder structure ────────────────────────────────────────────────
  lines.push('## Recommended folder layout');
  lines.push('');
  lines.push('Store everything under a single root -- this keeps `lab-config.json` simple');
  lines.push('to fill in and matches the example below.');
  lines.push('');
  lines.push('```');
  lines.push('C:\\Lab\\               (Windows) -- or ~/Lab/ on macOS/Linux');
  lines.push('├── ISOs\\');
  lines.push(`│   ├── VMware-VMvisor-Installer-*.iso   (${esxiLabel})`);
  lines.push('│   ├── VMware-VCSA-all-*.iso             (vCenter bundle/ISO -- extract the OVA from this)');
  if (vyos.enabled) {
    lines.push('│   ├── vyos-*.iso                        (VyOS)');
  }
  if (dc.enabled) {
    lines.push('│   ├── WinServer2022-eval.iso            (Windows Server)');
  }
  if (vcf.enabled) {
    lines.push('│   └── VMware-Cloud-Builder-*.ova        (Cloud Builder -- VCF)');
  }
  lines.push('├── Scripts\\            ← extract the generated scripts here, including');
  lines.push('│                         lab-config.json (already generated -- see below)');
  lines.push('└── Output\\             ← generated output lands here');
  lines.push('```');
  lines.push('');
  lines.push('With that layout, `lab-config.json` (in `Scripts\\`, next to the scripts) would look like:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "localPaths": {');
  lines.push(`    "esxiIso": "C:\\\\Lab\\\\ISOs\\\\VMware-VMvisor-Installer-${esxiLabel.replace(/\s+/g, '')}.iso",`);
  lines.push('    "vCenterOva": "C:\\\\Lab\\\\ISOs\\\\vcsa\\\\vcsa.ova"' + (vyos.enabled || dc.enabled ? ',' : ''));
  if (vyos.enabled) {
    lines.push('    "vyosIso": "C:\\\\Lab\\\\ISOs\\\\vyos-rolling.iso"' + (dc.enabled ? ',' : ''));
  }
  if (dc.enabled) {
    lines.push('    "windowsServerIso": "C:\\\\Lab\\\\ISOs\\\\WinServer2022-eval.iso"');
  }
  lines.push('  },');
  lines.push('  "datastorePaths": {}');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('Datastore uploads for the CD-ROM ISOs happen automatically the first time each');
  lines.push('script runs -- see "Where each file goes" above.');
  lines.push('');

  // ── 7. Time ────────────────────────────────────────────────────────────
  lines.push('## Time to set aside');
  lines.push('');
  lines.push('| Stage | Estimate |');
  lines.push('|-------|----------|');
  lines.push('| ISO downloads | 1--3 hours (depends on your connection) |');
  lines.push('| Software prerequisites | 15--30 minutes |');
  lines.push(`| Running all scripts + manual ESXi install × ${nc.hostCount || 1} | 2--4 hours |`);
  lines.push('| vCenter first-boot + vSAN formation | 30--60 minutes |');
  if (vcf.enabled) {
    lines.push('| Cloud Builder OVA download + deployment | 30--60 minutes |');
    lines.push('| VCF bring-up (Cloud Builder dashboard) | 2--4 hours |');
    lines.push('| Post bring-up: bundle depot sync (optional) | 1--8 hours |');
  }
  lines.push('');
  lines.push('Read the **build-guide.md** alongside these scripts -- it explains');
  lines.push('each step in order and flags which steps require manual interaction.');
  lines.push('');
  lines.push('---');
  lines.push(`*Generated by zero-to-hero-lab on ${spec.generatedAt}*`);

  return lines.join('\n');
}

module.exports = { buildPrerequisites };
