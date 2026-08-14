# Zero to Hero Lab

*Build it. Break it. Fix it. Learn it.*

A local wizard that guides you through designing a nested vSphere home lab, then generates a complete set of personalised PowerCLI scripts, a written design document, a step-by-step build guide, and a network topology diagram.

The pitch: **every consultant who has built a nested vSphere lab has spent days rediscovering the same gotchas** — promiscuous mode on the parent vSwitch, VLAN tagging at three separate layers, NTP sync across all appliances, SSO domain collision with Active Directory. This wizard encodes those lessons. Answer the questions once; get the scripts and the knowledge together.

Blog posts explaining the background: **[CloudITBlog.com](https://CloudITBlog.com)**

Community scenario library: **[github.com/redeye365/vsphere-lab-scenarios](https://github.com/redeye365/vsphere-lab-scenarios)** — download and share troubleshooting scenarios for the built-in lab trainer.

---

## What it produces

Run the wizard and click **Generate** — it writes the following to an output folder and offers them as individual downloads:

| File | What it is |
|------|-----------|
| `PREREQUISITES.md` | **Start here.** Personalised checklist of software and ISOs needed for your specific design |
| `design-doc.md` | Written explanation of every design decision and why it was made |
| `build-guide.md` | Step-by-step deployment guide in order, with manual steps clearly flagged |
| `lab-spec.json` | The full design as structured JSON — machine-readable, diff-able |
| `network-diagram.svg` | SVG topology diagram *(requires mmdc — see below; Mermaid source always in build-guide.md)* |
| `deploy-lab.ps1` | Creates port groups on the physical vSwitch, deploys nested ESXi VM shells |
| `vyos-deploy.ps1` | Deploys the VyOS virtual router VM *(if VyOS chosen)* |
| `dc-deploy.ps1` | Deploys the Windows Server domain controller VM *(if DC chosen)* |
| `vcenter-deploy.ps1` | Deploys vCenter VCSA via govc or PowerCLI *(always)* |
| `vsan-cluster.ps1` | Creates datacenter, cluster, adds nested hosts, enables vSAN *(if vSAN chosen)* |
| `deploy-workloads.ps1` | Creates blank test VM shells on the vSAN cluster *(if workload VMs chosen)* |
| `configure-memory-tiering.ps1` | Adds virtual NVMe + enables ESXi memory tiering *(if memory tiering chosen)* |
| `jumpbox-deploy.ps1` | Deploys a lightweight jumpbox VM *(if chosen)* |
| `wireguard-server.sh` | WireGuard server setup *(if WireGuard remote access chosen)* |
| `vyos-site-to-site.conf` | VyOS site-to-site VPN config *(if site-to-site VPN chosen)* |

---

## Software prerequisites

### PowerShell 7.2 or newer

The scripts use PowerShell 7 (PowerShell Core) syntax. Windows PowerShell 5.1 will not work.

- **Windows**: `winget install Microsoft.PowerShell` or download from [github.com/PowerShell/PowerShell/releases](https://github.com/PowerShell/PowerShell/releases)
- **macOS**: `brew install powershell/tap/powershell`
- **Linux**: [learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux)

Verify: `pwsh --version`

### VMware PowerCLI 13.x or newer

```powershell
Install-Module VMware.PowerCLI -Scope CurrentUser
Set-PowerCLIConfiguration -ParticipateInCEIP $false -Confirm:$false
```

You will see an "untrusted repository" prompt during install — type `Y`. The download is around 200 MB.

Verify: `Get-Module VMware.PowerCLI -ListAvailable | Select Version`

### govc (optional but recommended)

`vcenter-deploy.ps1` detects `govc` and uses it for VCSA deployment when available. It falls back to PowerCLI `Import-VApp` if govc is missing, but govc is faster and more reliable for large OVA files.

Download the latest release from [github.com/vmware/govmomi/releases](https://github.com/vmware/govmomi/releases) and place the binary on your PATH.

- **macOS**: `brew install govc`
- **Windows/Linux**: download the binary for your platform, rename to `govc` (or `govc.exe`), add to PATH

Verify: `govc version`

### Node.js 18 or newer

Required only to run the wizard itself — not needed on the machine where you run the scripts.

Download from [nodejs.org](https://nodejs.org) or `brew install node`.

### @mermaid-js/mermaid-cli (optional — SVG export only)

The Mermaid diagram source for your lab topology is **always included** in `build-guide.md` as a fenced code block. Paste it into [mermaid.live](https://mermaid.live) to view the diagram without any extra software.

`@mermaid-js/mermaid-cli` (mmdc) is only needed if you want the `network-diagram.svg` file download. Without it, the SVG download button does not appear — everything else works normally.

**If running from source** (`npm start`): mmdc is already in devDependencies and is installed by `npm install` automatically.

**If running the standalone executable** (`dist/zero-to-hero-lab-*`): mmdc cannot be bundled into the executable. It uses Puppeteer which requires a headless Chromium binary (~170 MB per platform) — too large and platform-specific to embed. Install it separately if you want SVG export:

```sh
npm install -g @mermaid-js/mermaid-cli
```

Then restart the wizard — SVG export will be available on the next Generate. The startup log will confirm: `Network diagram: SVG generation enabled`.

---

## ISO and OVA prerequisites

### Broadcom portal account

VMware ISOs are now hosted on the Broadcom portal. Registration is free — but it is not obvious for people encountering it post-acquisition.

1. Go to [support.broadcom.com](https://support.broadcom.com)
2. Click **Register** — use a personal or work email
3. After registration, go to **My Dashboard → My Downloads → VMware vSphere**
4. Select your version and download the ISO(s)

Allow 15–30 minutes the first time, including working through the registration flow.

### ESXi ISO

Always required. Filename starts with `VMware-VMvisor-Installer-`.

Download: [support.broadcom.com](https://support.broadcom.com) → VMware vSphere → My Downloads

### vCenter Server Appliance (VCSA)

Always required. Download the **VMware vCenter Server Appliance** bundle (filename starts with `VMware-VCSA-all-`). This is an ISO containing an OVA — mount it or extract it; the OVA is at `vcsa/VMware-vCenter-Server-Appliance-*.ova`.

Download: [support.broadcom.com](https://support.broadcom.com) → VMware vSphere → My Downloads

### VyOS ISO *(if VyOS virtual router chosen)*

Download the LTS rolling release from [vyos.io/get-vyos](https://vyos.io/get-vyos/). Filename starts with `vyos-`.

### Windows Server ISO *(if domain controller chosen)*

Download the 180-day evaluation from the [Microsoft Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2022). Select **ISO download** (~5 GB).

---

## Hardware prerequisites

The wizard's sizing checks validate against these minimums at generate time — warnings appear in the UI if your design exceeds what the hardware can support.

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Physical host RAM | 64 GB | 256 GB+ |
| Physical host CPU | 8 cores | 16–32 cores |
| Physical storage | 500 GB NVMe or SSD | 1–2 TB NVMe |
| NIC | 1 × 1 GbE | 1 × 10 GbE |
| Host OS | VMware ESXi 8.0+ | ESXi 8.0 U3 or 9.0 |

**Nested virtualisation must be enabled on the physical host.** `deploy-lab.ps1` creates port groups with promiscuous mode, forged transmits, and MAC address changes — all three are required for nested ESXi networking to work.

For vSAN ESA (the default), all storage must be all-flash (NVMe or high-performance SSD). Spinning disks are not eligible.

---

## Recommended folder structure

```
C:\Lab\                 (Windows) — or ~/Lab/ on macOS/Linux
├── ISOs\
│   ├── VMware-VMvisor-Installer-*.iso      (ESXi)
│   ├── VMware-VCSA-all-*.iso               (vCenter bundle)
│   ├── vyos-*.iso                          (VyOS, if used)
│   └── WinServer2022-eval.iso              (Windows Server, if used)
├── Scripts\            ← save generated scripts here
└── Output\             ← wizard output folder
```

---

## Running the wizard

```
git clone https://github.com/redeye365/zero-to-hero-lab.git
cd zero-to-hero-lab
npm install
npm start
```

Open **http://localhost:3000** in your browser. If port 3000 is already taken, the wizard automatically falls back to 3001, then 3002 — check the console output for the URL it actually landed on.

The wizard runs entirely locally. No data leaves your machine.

### Getting started on Windows (standalone .exe)

`npm run build` produces a standalone Windows executable (`dist/zero-to-hero-lab.exe`, via `pkg`) that doesn't require Node.js to be installed on the target machine. Two one-time PowerShell steps clear up the most common first-run issues on Windows Server 2025:

**1. Allow the port through Windows Firewall.** The wizard binds to `127.0.0.1` only, so this is usually unnecessary for local-only use, but if Windows Firewall is prompting or blocking anyway, allow it from an elevated PowerShell prompt:

```powershell
New-NetFirewallRule -DisplayName "Zero to Hero Lab" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

If the wizard fell back to port 3001 or 3002 because 3000 was already in use, repeat the command with `-LocalPort 3001` (or `3002`) — the console output (and the browser window it opens) tells you which port it landed on.

**2. Fix script/exe execution blocks.** PowerShell's default execution policy blocks unsigned scripts — this affects the `.ps1` files the wizard *generates* (`deploy-lab.ps1`, `vcenter-deploy.ps1`, etc.), not the wizard's own `.exe`. From an elevated PowerShell prompt:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

If the `.exe` itself won't launch because Windows SmartScreen flagged it as downloaded from the internet, unblock it first:

```powershell
Unblock-File -Path .\zero-to-hero-lab.exe
```

If the wizard still fails to start, a message box now describes the error instead of the window just disappearing — full details are written to `crash.log` next to the `.exe`.

### Wizard steps

1. **Use case** — certification, homelab, feature testing, demo, or dev/test
2. **Physical hardware** — CPU, RAM, storage devices, NIC
3. **Existing network** — flat or VLANs, DHCP available
4. **ESXi version** — 8.0 U3, 9.0, etc.
5. **Appliances** — VyOS router, Windows domain controller
6. **Networks** — management CIDR, VLAN mode (tagged/untagged), vMotion, vSAN, VM traffic
7. **Nested cluster** — host count, vCPU/vRAM per host, vSAN ESA/OSA, cluster name, SSO domain, memory tiering
8. **Additional disks** — per-host VMDKs for vSAN, local datastore
9. **Security** — segment isolation, firewall policy
10. **Remote access** — VPN type, jumpbox
11. **Review** — live summary of the full design with sizing warnings
12. **Generate** — writes all output files, shows download links

---

## Running the standalone executable

Download the exe from [Releases](../../releases), double-click it, then open your browser
at `http://localhost:3000`.

### macOS security warning (unsigned binary)

The macOS builds (`zero-to-hero-lab-macos-arm64`, `zero-to-hero-lab-macos-x64`) aren't
code-signed, so Gatekeeper will show a security warning the first time you run one.

**To open it:** right-click the file → **Open** → **Open**.

**Or from Terminal:**

```sh
xattr -d com.apple.quarantine zero-to-hero-lab-macos-arm64
```

(substitute `zero-to-hero-lab-macos-x64` if you downloaded the Intel build). You only need
to do this once per download.

---

## Known limitations (v1)

- **VCF / SDDC Manager out of scope.** The wizard is designed to produce a vSphere foundation that *could* have VCF layered on top later (correct SSO domain, DNS PTR records, NTP single-source, cluster naming, vSAN ESA) but does not deploy VCF itself.
- **Interactive ESXi install is still manual.** `deploy-lab.ps1` creates the VM shells and attaches the ISO; you power on each VM and step through the installer.
- **vCenter first-boot is still manual.** `vcenter-deploy.ps1` deploys the OVA; the ~20-minute first-boot configurator runs inside the appliance.
- **SVG diagram requires mmdc.** The Mermaid source is always in build-guide.md; SVG export requires mmdc installed separately (see above). Not bundled in the standalone executable.
- **Single physical host assumed.** Nested VM shell placement across multiple physical hosts is not yet implemented.
- **NSX, Aria, and HCX are out of scope.** Deliberate scope cut for v1.

---

## Project layout

```
server.js                    Express app: UI, /api/generate, /api/download
public/
  index.html                 Step definitions and form fields
  wizard.js                  State machine, validation, rendering
  style.css                  Styles
lib/
  sizing.js                  RAM/CPU overcommit checks, vSAN sanity checks
  generateSpec.js            Builds the JSON spec from wizard answers
  generatePowerShell.js      Builds all PowerCLI scripts from the spec
  generateMarkdown.js        Builds design-doc.md from the spec
  generateBuildGuide.js      Builds build-guide.md from the spec
  generatePrerequisites.js   Builds PREREQUISITES.md from the spec
  generateNetworkDiagram.js  Builds Mermaid topology diagram from the spec
output/                      Generated files (one subfolder per run, gitignored)
```

---

## Acknowledgements

**[William Lam](https://williamlam.com)** — The nested ESXi path in this wizard is built around William's [Nested ESXi Virtual Appliance](https://williamlam.com/nested-virtualization/nested-esxi-virtual-appliance). His OVA handles the hard parts of nested deployment (OVF property injection, pre-configured networking, version-specific hardware compatibility) and his blog is the authoritative reference for nested vSphere gotchas, ESXi 9.x minimum specs, VCF local depot patterns, and everything in between. If you're serious about nested virtualisation, his site is the first place to look.

**[VyOS Project](https://vyos.io)** — Open-source network OS used as the lab's virtual router and firewall. The generated scripts deploy and configure VyOS for NAT, DHCP, DNS forwarding, and optionally BGP or site-to-site WireGuard.

**[govmomi / govc](https://github.com/vmware/govmomi)** — Go library and CLI for the vSphere API. The generated `vcenter-deploy.ps1` uses govc for VCSA OVA deployment when available — it handles large OVA files more reliably than PowerCLI's `Import-VApp`.

**[Mermaid](https://mermaid.js.org)** — JavaScript diagramming library used to generate the network topology diagram. The wizard embeds the Mermaid source in `build-guide.md` so diagrams are viewable without any extra tooling via [mermaid.live](https://mermaid.live).

---

## License

Non-commercial community license — see [LICENSE](LICENSE) for the full terms.

- **Free** for personal, educational, and other non-commercial use.
- **Commercial use** — selling it, bundling it into a paid product or service, using it
  for paid consulting/training, or white-labelling it — **requires written permission**
  from the author. Contact [CloudITBlog.com](https://CloudITBlog.com) to request it.
- **Attribution required**: credit CloudITBlog.com and link back to
  [the original repository](https://github.com/redeye365/zero-to-hero-lab) in any use
  or redistribution.
- **Forks**: welcome for personal/non-commercial use (attribution preserved); forks for
  commercial use are prohibited without permission.

---

*Built by [CloudITBlog.com](https://CloudITBlog.com)*
