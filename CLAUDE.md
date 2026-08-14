# Zero to Hero Lab — Developer Context

This file is loaded automatically by Claude Code. It captures architectural decisions,
current roadmap state, and working constraints so every session starts with full context.

---

## Project overview

A local Express.js wizard (port 3000) that guides a user through designing a nested
vSphere lab and generates ready-to-run PowerShell/bash automation scripts, a design
document, network diagram, and build guide. No framework (React/Vue/etc.) — plain
HTML/CSS/JS in `public/`. Server-side generation only (no client-side bundling).

Key files:
- `server.js` — Express app, `/api/generate`, `/api/download/:id/:kind`, `/api/diagram/:id`, `/api/diagram/:id/save`, `/api/diagram/from-spec`, `/api/ks/:sessionId/:hostIndex`, `/diagram`, troubleshoot scenario endpoints
- `lib/scenarioLibrary.js` — scenario CRUD (loadScenarios, getScenario, saveScenario, deleteScenario, getActive, setActive)
- `lib/templateLibrary.js` — curated `.labtemplate` list (loadTemplates); backs the public `GET /api/templates`
- `templates/<id>.json` — pre-built lab templates offered on the "Start from template" screen and the post-Use-case suggestion overlay (Learn NSX, Learn vSAN, VCF certification prep, Basic homelab, Advanced networking)
- `lib/vcenterClient.js` — vSphere REST API client (createSession, listVMs, findSnapshot, revertAllToSnapshot, testConnection)
- `lib/vcenterConfig.js` — load/save vcenter-config.json from BASE_DIR (gitignored)
- `lib/hclData.js` — NIC HCL database: FLAGGED_NICS, KNOWN_GOOD_NICS, checkNic(model)
- `scenarios/<id>.json` — scenario metadata files (22 scenarios ship with the wizard)
- `scenarios/verify/<name>.ps1` — PowerShell verify scripts (check FAULT_PRESENT/FAULT_RESOLVED)
- `public/index.html` — all wizard steps in one HTML file
- `public/wizard.js` — all client state, step logic, form wiring
- `public/style.css` — all styles
- `public/diagram.html` — diagram viewer (live Mermaid, zoom/pan, download SVG/PNG, file picker, session load, edit mode with live-preview source editor, manual component addition)
- `lib/generateSpec.js` — builds the canonical spec object from wizard answers
- `lib/sizing.js` — resource maths (vCPU / vRAM totals, warnings)
- `lib/validateAnswers.js` — server-side input validation
- `lib/generatePowerShell.js` — main script generator
- `lib/generateNsx.js` — NSX-T deploy/configure/BGP scripts
- `lib/generateVcf.js` — VCF bring-up JSON (Cloud Builder workbook) + vcf-prep.ps1; also exports `firstHostInCidr`/`cidrToMask` for reuse
- `lib/generateVis.js` — vis-deploy.ps1 (William Lam's VIS Appliance, deployed via OVF Tool)
- `lib/generateBuildGuide.js` — step-by-step human build guide
- `lib/generateMarkdown.js` — design-doc.md
- `lib/generateNetworkDiagram.js` — Mermaid flowchart
- `lib/generateDiagramHtml.js` — standalone diagram.html with embedded mermaid source
- `lib/generatePrerequisites.js` — PREREQUISITES.md (VCF section conditional on vcf.enabled)
- `lib/generateKickstart.js` — per-host ks.cfg files for unattended ESXi install (buildKickstartFiles, buildKickstartForHost)
- `lib/generateDepot.js` — optional local depot scripts

### Packaging

`IS_PKG` / `BASE_DIR` pattern supports `pkg` standalone executable. All writable
output goes to `BASE_DIR` (next to the binary), never `__dirname` (read-only snapshot).

---

## Step numbering (as of v1.34 — Storage split out, Template promoted to a real step)

| # | Step name | Notes |
|---|-----------|-------|
| 0 | Physical host | CPU/RAM/NIC/hostCount; NIC model + inline HCL check; per-host specs when hostCount > 1; absorbs old ESXi-version field and old File-locations fields (now an always-visible "software library" subsection — no longer conditionally gated, since the gating fields (`esxiDeployMethod`/`vyosEnabled`/`dcProfile`) are answered in later steps and all five path fields are optional anyway). Storage devices moved OUT to their own step (2) as of v1.34 |
| 1 | Home network | |
| 2 | Storage | Split out of the old combined Hardware step in v1.34 — just `storageDevices` (`#storage-device-list`/`add-storage-device`), nothing else |
| 3 | Use case | |
| 4 | Recommended template | New in v1.34 — was previously a one-time overlay shown after Use case (`showTemplateSuggestOverlay`, v1.30.0); now a real numbered step (`renderTemplateStep()`) with its own rail entry, reachable via normal Back/Next like any other step, no "once per session" gating needed since revisiting it behaves like any other step (picking a card just re-applies `applyTemplateDesignOnly`) |
| 5 | Virtual router (VyOS) | |
| 6 | Domain controller | |
| 7 | Lab networks | absorbs old Security & access step (`isolateLab`, `firewallPolicy`, `internetAccess`, `remoteAccessMethod`, `vpnType`, `vcenterSize`) |
| 8 | Nested cluster | mega-step; ESA/OSA vSAN; memory tiering; `esxiDeployMethod` (iso/ova) chosen here; absorbs old Deployment placement (shown inline when hostCount > 1, via `renderDeploymentPlacement()` called on step entry — `placementStepVisible()`'s dependency (`hostCount`) is set on the earlier Physical host step so on-entry computation is still correct), old Nested disks, old Bundle depot (`#nested-cluster-depot-section`, visibility live-toggled by `updateDepotVisibility()`), and old VCF Bring-up (self-contained, own `vcfEnabled` checkbox toggle) |
| 9 | NSX-T | Edge node count/size; BGP route advert mode; redistribution checkboxes; deliberately kept standalone (not merged with anything) |
| 10 | Workload VMs | |
| 11 | Review & generate | Live Mermaid diagram preview; `TOTAL_STEPS - 2` |
| 12 | Troubleshooting | Hidden; activated via Ctrl+Shift+X / Cmd+Shift+X |

`TOTAL_STEPS = 13`, `NSX_STEP = 9`, `TROUBLESHOOT_STEP = 12`. `PLACEMENT_STEP`/`DEPOT_STEP`/`VCF_STEP`/`FILE_LOCATIONS_STEP` no longer exist as constants — their content are inline subsections of step 0 or step 8, not separate pages, so `getNextStep`/`getPrevStep` are plain `n±1` with no skip logic. Note this reopens the "max 10 steps" constraint from v1.24 — the later explicit ask (split Storage out, promote Template to a real step) superseded that earlier constraint.

---

## Security constraints (permanent — do not remove)

- **No PATs in remote URLs.** SSH-only: `git@github.com:redeye365/zero-to-hero-lab.git`
- Three leaked PATs have been revoked — they MUST NOT be referenced, regenerated, or
  re-used under any circumstances. If git operations fail, investigate SSH key auth only.
- git config: `user.email = claude.faceless597@passmail.net`, `user.name = redeye365`
- **License**: non-commercial community license (`LICENSE` file), not MIT/permissive.
  Free for personal/educational/non-commercial use; commercial use, paid-product
  redistribution, and white-labelling require written permission from CloudITBlog.com;
  attribution (credit + link back to the repo) is required in all cases; forks for
  personal use are fine, forks for commercial use are not without permission. Keep this
  in mind before suggesting an OSI-approved/permissive license, a standard MIT badge, or
  wording that implies unrestricted commercial reuse.

---

## Spec schema version history

| schemaVersion | Added in | Key changes |
|---------------|----------|-------------|
| 1 | v0.1 | Initial |
| 2 | v0.2 | remoteAccess, workloadVms |
| 3 | v0.4 | nsx section, extendMode flag |
| 4 | v0.4.8-beta | `physicalHosts[]` array (multi-host); `nestedCluster.hosts[]` placement; `nestedCluster.hostPlacement` ('auto'/'manual') |
| 4 (extended) | v0.5.3-beta | Added to existing v4: `physicalHost.nicModel`; `nsx.edgeCount`, `nsx.edgeSize`, `nsx.bgpRouteAdvert`, `nsx.bgpPrefixes[]`, `nsx.redistConnected/Static/T1Lb`; `nestedCluster.memoryTiering`, `vsanArchitecture` |
| 4 (extended) | v0.6.0-beta | Added to existing v4: `vcf` section (enabled, sddcManagerIp, sddcManagerHostname, vcenterIp, vtepCidr/Vlan, edgeUplink1/2 Cidr/Vlan, esxiPassword, esxiLicense, vcenterLicense) |
| 4 (extended) | v0.6.3-beta | Added to existing v4: `nestedCluster.rootPassword` |
| 4 (extended) | v0.6.7-beta | Added to existing v4: `learningMode` (bool), `designRationale` (object with useCase, routerChoice, networkSecurity, availabilityRequirement, nsxRationale) |
| 4 (extended) | v0.6.8-beta | Added to existing v4: `architectMode` (bool), `discovery` (object), `decisionLog` (array), `riskRegister` (array) |

---

## Versioning roadmap

### v1.0 (shipped)
Core wizard: physical host → networks → DC → VyOS → nested cluster → depot →
workloads → security → review. Generates PowerShell scripts, design doc, build guide,
network diagram, prerequisites.

### v0.4.9-beta (diagram viewer)
- **Network diagram viewer** (`/diagram` route, `public/diagram.html`):
  - Live Mermaid render in review screen (step 13) — auto-updates on entry, "Open in viewer" link
  - Standalone `/diagram` viewer: file picker for spec.json, session ID load, zoom/pan, fullscreen, download SVG/PNG, component key
  - "View Diagram" button in left rail (always visible); updates to `?id=<session>` after generate
  - `diagram.html` included in every generated output (CDN Mermaid, embedded source, standalone)
  - New endpoints: `GET /api/diagram/:id`, `POST /api/diagram/from-spec`, `GET /diagram`
- **Multi-host support** (v0.4.8-beta):
  - Per-host hardware collection (step 1) when hostCount > 1
  - Nested VM placement: auto (round-robin) or manual assignment
  - deploy-lab.ps1: `$physicalHostGroups` loop; per-host port group creation
  - sizing.js: per-host RAM/CPU checks
  - Network diagram: PHYS1/PHYS2 subgraphs
  - schemaVersion 4

### v1.5 → v0.4-beta
- NSX-T wizard step (step 8): Small/Medium sizing; T0T1 / T0T1DFW / Full topology;
  BGP peering auto-populated from VyOS config (AS 65001/65002).
  Generates: nsx-deploy.ps1, nsx-configure.ps1, nsx-bgp.ps1
- Spec versioning: "Extend existing lab" option loads a prior spec.json back into the
  wizard; only new/changed scripts are regenerated.
- Troubleshooting mode (hidden, Ctrl+Shift+X / Cmd+Shift+X):
  - Amber fixed badge; step 14 added to rail (hidden by default)
  - **No mention of troubleshooting mode anywhere in UI, docs, or README.**

### v0.4.15-beta (scenario snapshot library)
- **Architecture change**: fault injection replaced by scenario snapshot library
  - Scenarios are pre-built lab states with a fault already present, saved as vCenter
    snapshots. Troubleshooters load a scenario, lab reverts, they fix it for real.
  - `lib/faultLibrary.js` removed. `lib/scenarioLibrary.js` replaces it.
  - `scenarios/` directory: 10 starter JSON files + `scenarios/verify/` PS1 scripts
- **Scenario metadata format** (`scenarios/<id>.json`):
  - `id`, `name`, `description`, `difficulty`, `examObjectives`, `topics`
  - `customerScenario` (initial call text), `customerFollowUp` (one-time clue)
  - `snapshotName` (vCenter snapshot name, set after capture), `verifyScript` (PS1)
  - `fixSteps[]`, `hints[5]` (5 progressive levels), `labRequirements[]`
- **`.labscenario` format**: plain JSON envelope `{version:"1", scenario:{…}, verifyScript:"…"}`
  — no zip, no extra dependencies, fully portable
- **Admin: Scenario Library** (left tab in step 14):
  - List view with search, difficulty/topic filters, per-card Load/Edit/Export/Delete
  - Build form: snapshot name capture, full metadata editor, 5 hint fields, verify script editor
  - Import `.labscenario` file (clears snapshotName — must re-capture for local lab)
  - Active scenario banner + Unload button
- **Troubleshooter** (right tab in step 14):
  - Phase 1: lab ready confirmation
  - Phase 2: scenario picker — shows admin-loaded scenario (if any) or full library browser
  - Phase 3: investigation (unchanged — customer scenario, notes, ticket, hints, "I've fixed it")
  - Phase 4: debrief (unchanged — fault description, fix steps, stats, ticket quality)
- **Backend endpoints** (admin — not in README):
  - `GET  /api/admin/scenario-list` — all scenarios
  - `GET  /api/admin/scenario-active` — currently loaded scenario
  - `POST /api/admin/scenario-load` — set active + auto-revert vCenter snapshot if configured
  - `POST /api/admin/scenario-unload` — clear active
  - `POST /api/admin/scenario-save` — create/update scenario + verify script
  - `DELETE /api/admin/scenario/:id` — delete
  - `GET  /api/admin/scenario-export/:id` — download `.labscenario` bundle
  - `POST /api/admin/scenario-import` — import `.labscenario` bundle
  - `POST /api/admin/scenario-capture` — record snapshot name in metadata
  - `POST /api/admin/scenario-verify` — run PS1 verify script (requires pwsh)
  - `GET  /api/admin/vcenter-config` — return saved vCenter settings (password redacted)
  - `POST /api/admin/vcenter-config` — save vCenter connection settings to vcenter-config.json
  - `POST /api/admin/vcenter-test` — test vCenter connectivity (auth + immediate log-out)
- **Backend endpoints** (troubleshooter):
  - `POST /api/troubleshoot/start` — begin session with scenario id, returns token
  - `POST /api/troubleshoot/customer-info` — one-time clue (customerFollowUp)
  - `POST /api/troubleshoot/ticket` — record ticket, unlocks hints
  - `POST /api/troubleshoot/hint` — level 1–5 hint
  - `POST /api/troubleshoot/debrief` — session close, returns fix steps + ticket score
- **Starter scenario library** (10 scenarios):
  1. BGP AS Number Mismatch (T0/VyOS) — bgp-as-mismatch
  2. Management VLAN Mismatch — mgmt-vlan-mismatch
  3. SSH Service Policy Wrong — ssh-service-policy
  4. DNS PTR Records Missing — dns-ptr-missing
  5. NTP Source Mismatch — ntp-source-mismatch
  6. Hosts File Duplicate Entry — hosts-file-ordering
  7. SSL Certificate Shows localhost.localdomain — ssl-cert-localhost
  8. DVS Teaming Policy Set to Custom — dvs-profile-custom
  9. monitor.allowLegacyCPU Missing — monitor-allow-legacy-cpu
  10. Local Datastore Missing Before vSAN — local-datastore-missing

### v0.5.1-beta (vCenter snapshot automation)
- **vCenter snapshot revert** wired in `POST /api/admin/scenario-load`:
  - Connects to vCenter using `vcenter-config.json` (gitignored, stored at BASE_DIR)
  - Lists all VMs via vSphere REST API, reverts any VM that has the named snapshot
  - Error `SNAPSHOT_NOT_FOUND`: surfaced to admin with clear message pointing to Capture button
  - Graceful fallback if vCenter not configured (admin can still revert manually)
- **vCenter snapshot capture** wired in `POST /api/admin/scenario-capture`:
  - Creates the snapshot on all VMs in vCenter inventory automatically
  - Snapshot name auto-generated (`scenario-<id>-<epoch>`) or admin-provided
  - Per-VM success/error reported back; name always recorded in scenario metadata
  - Graceful fallback if vCenter not configured — name recorded, admin creates manually
- **vCenter Settings panel** (⚙ vCenter button in Admin toolbar):
  - Form: server, username, password, trust self-signed cert checkbox
  - "Test Connection" — authenticate + immediate log-out to verify credentials
  - Credentials stored in `vcenter-config.json`, never in git
- **New endpoints**: `GET/POST /api/admin/vcenter-config`, `POST /api/admin/vcenter-test`
- **New lib files**: `lib/vcenterClient.js`, `lib/vcenterConfig.js` (no new npm deps — built-in `https` only)

### v0.5.3-beta (HCL NIC validation + NSX full depth + ESA/memory tiering)
- **HCL NIC validation** (step 1): inline check on blur against `lib/hclData.js`
  - Flagged (Realtek, I210/I211, Killer, Atheros, Marvell 88SE9235, JMicron): amber warning + reason
  - Known-good (Intel X-series, Broadcom BCM57xx, Mellanox ConnectX, etc.): teal badge
  - Unknown: grey hint
- **ESA / memory tiering** (step 7): ESA vs OSA vSAN architecture toggle; memory tiering with NVMe disk picker and `tierNvmePct` slider
- **NSX full depth** (step 8):
  - Edge transport node count + size (small / medium / large → vCPU/vRAM)
  - BGP route advertisement: all connected vs. specific prefix list (CIDR textarea)
  - Redistribution checkboxes: connected, static, T1 LB VIP
  - `nsx-configure.ps1`: edge cluster creation via `POST /api/v1/edge-clusters`
  - `nsx-bgp.ps1`: prefix list PATCH + outbound neighbour filter when `bgpRouteAdvert === 'specific'`
- **New spec fields**: `physicalHost.nicModel`; `nsx.edgeCount/edgeSize/bgpRouteAdvert/bgpPrefixes[]/redistConnected/redistStatic/redistT1Lb`; `nestedCluster.memoryTiering`, `vsanArchitecture`

### v0.6.0-beta (VCF layer)
- **New step 9 — VCF Bring-up** (inserted between NSX-T and Nested disks; old steps 9–14 → 10–15):
  - Generates `vcf-bringup.json` — VCF 5.x Cloud Builder deployment parameter workbook with all 6 network types (MANAGEMENT, VMOTION, VSAN, NSX_VTEP, NSX_EDGE_UPLINK1/2), per-host specs, dvs config, nsxSpec, vcenterSpec, sddcManagerSpec
  - Generates `vcf-prep.ps1` — pre-flight: NTP running, SSH enabled, hostname report per nested host
  - UI fields: SDDC Manager IP/hostname, vCenter IP, VTEP + Edge Uplink 1/2 CIDR/VLAN, ESXi password, ESXi/vCenter license keys
  - Review warnings: SSO domain = AD domain collision; nested host count < 4
  - Nested host IPs are sequential placeholders (.101+) in management CIDR — must match `deploy-lab.ps1` assignment
- **Step constant changes**: TOTAL_STEPS 15 → 16, DEPOT_STEP 10 → 11, TROUBLESHOOT_STEP 14 → 15, VCF_STEP = 9 (new)
- **New lib**: `lib/generateVcf.js` (buildVcfFiles, buildBringupJson, buildPrepScript, firstHostInCidr, cidrToMask, ipRange)
- **New spec section**: `vcf` (enabled, sddcManagerIp, sddcManagerHostname, vcenterIp, vtepCidr/Vlan, edgeUplink1/2 Cidr/Vlan, esxiPassword, esxiLicense, vcenterLicense)
- **Community repo**: `github.com/redeye365/vsphere-lab-scenarios` — 10 starter troubleshooting scenarios, contributor README, `.labscenario` import/export

### v0.6.1-beta (VCF prerequisites)
- **VCF prerequisites** added to `generatePrerequisites.js` (all conditional on `vcf.enabled`):
  - Broadcom portal section split into vSphere + VCF download locations
  - Cloud Builder OVA subsection: download location, manual deploy steps 1–4, bundle depot note
  - **VCF bring-up requirements** section: DNS records table (personalised from spec IPs/hostnames), NTP sync note, VLAN trunk table (all 6 types), license key check (confirms if entered / reminds if blank), minimum 4-host warning, ordered 7-step bring-up checklist
  - Cloud Builder OVA entry in recommended folder layout tree
  - Time table: Cloud Builder download/deploy, bring-up, bundle depot sync rows

### v0.6.2-beta (CLAUDE.md housekeeping)
- CLAUDE.md updated to reflect v0.6.1-beta state: step table, constants, key files, schema history, roadmap

### v0.6.3-beta (Kickstart generator)
- **Unattended ESXi install via Kickstart** — eliminates the main manual step in the build guide:
  - `lib/generateKickstart.js`: new — `buildKickstartFiles(spec)` generates one `ks-esxi-N.cfg` per nested host
    - Management IP `.101`/`.102`/… in management CIDR (matches vcf-bringup.json convention)
    - VLAN ID, gateway, DNS (DC if enabled, else `1.1.1.1`), hostname (`esxi-N.<domain>`), NTP from spec
    - `%firstboot` section: enables SSH persistently via `esxcli`, configures NTP, suppresses shell warning
  - `server.js`: writes `ks-esxi-N.cfg` files to output on every generate; adds `GET /api/ks/:sessionId/:hostIndex` endpoint — wizard serves ks.cfg files directly at boot time
  - `deploy-lab.ps1` (`generatePowerShell.js`): new `-WizardIp` param; embeds `$KsSessionId` constant; powers on VMs with `Start-VM`; prints `ks=http://$WizardIp:3000/api/ks/<id>/<n>` URL per host when `-WizardIp` is set
  - New wizard field: "Nested ESXi root password" (step 7) → `spec.nestedCluster.rootPassword`; blank → `<REPLACE_ME>` placeholder in ks.cfg

### v0.6.4-beta (build guide kickstart section)
- **`lib/generateBuildGuide.js`** — ISO-path nested ESXi install step updated:
  - AUTOMATED step: command example shows `-WizardIp` flag; description notes VMs are powered on immediately and ks.cfg files land in the output folder
  - MANUAL install step split into two options:
    - **Option A (Kickstart, recommended):** Shift+O at boot menu, `ks=` URL format, `-WizardIp` URL reference, post-install state (IP, hostname, SSH, NTP), `<REPLACE_ME>` warning when no password set, self-hosting fallback note
    - **Option B (Manual):** existing DCUI walkthrough, updated to note VMs are already powered on

### v0.6.5-beta (scenario library expansion)
- **12 new scenarios** added to `scenarios/` and mirrored to `vsphere-lab-scenarios` repo:
  - **Easy (3):** vm-snapshot-consolidation, host-disconnected-vcenter, vmotion-failing
  - **Medium (4):** ha-admission-control, nsx-t0-uplink-wrong, nsx-dfw-blocking, vsan-disk-claimed
  - **Hard (5):** vcf-ssh-config-corruption, vcf-ntp-drift, vcf-dns-ptr-missing, nsx-edge-transport-zone, storage-all-paths-down
- Wizard now ships 22 scenarios total (was 10); verify scripts added for all 12 in `scenarios/verify/`
- `vsphere-lab-scenarios` README updated: count corrected, table split into vSphere/NSX/VCF sections
- Authors: Jon — CloudITBlog.com

### v0.6.7-beta (current — Learning Mode)
- **Wizard Learning Mode**: mode selector screen (Build vs Learn) before wizard enters
  - Per-step `<div class="learn-block">` panels at steps 0, 1, 3, 5, 6, 7, 8, 14
  - Design rationale capture: useCase, routerChoice, networkSecurity, availabilityRequirement, nsxRationale (all in `state.designRationale`)
  - Architecture scorecard on step 14: Isolation / Resilience / Scalability / Complexity / VCF Readiness (Green/Amber/Red)
  - Anti-pattern detection: single-host HA, vSAN < 3 hosts, NSX without BGP, untagged management VLAN
  - RAM insights on steps 1 (cluster tier options) and 7 (headroom after cluster)
  - `learningMode` + `designRationale` added to spec by `generateSpec.js`
  - `generateMarkdown.js`: Design Rationale section (problem statement, router/networking, network security, availability, architecture assessment)
  - `generateBuildGuide.js`: Learning objectives + certification mapping (when useCase === 'certification')
- **Troubleshooter Learning Mode**: phase 0 mode selector (Fix vs Learn to troubleshoot)
  - 7-step methodology framework shown in phase 1 header
  - Guided prompts in phase 3: symptom, scope, layer isolation (saved to `state.tsMethodology`)
  - Hint meta-context framing for each of the 5 hint levels
  - Enhanced debrief: why it happened / what made it hard / learning point / prevention / methodology scorecard + pattern summary
  - Design rationale connection: if a learning-mode spec is loaded, debrief links back to the relevant design decisions

### v1.26.0 (current -- pre-built lab templates)
- **New "Start from template" flow**: clicking the existing `#mode-template` card on the
  mode-select screen no longer opens a file picker directly -- it now shows
  `#template-picker-screen` (`public/index.html`), a card grid (reusing the `.mode-card`
  styling already used for the four mode-select cards) rendered from `GET /api/templates`.
  Each card is one of the four curated templates; clicking it runs the exact same
  `isValidWizardConfig()` -> `enterAppWithConfig()` path a manually-uploaded `.labtemplate`
  file already used -- no changes needed to that pipeline, since `loadWizardConfig()`'s
  `Object.assign` merge onto the default `state.answers.{discovery,hardware,design}` means
  a template only needs to specify the fields it wants to override, not the full schema.
  A "Have a `.labtemplate` file someone shared with you? Upload it instead" link at the
  bottom still opens the pre-existing `#load-template-input` file picker, and a Back
  button returns to the four original mode-select cards.
- **`lib/templateLibrary.js`** (`loadTemplates()`) mirrors the existing `scenarioLibrary.js`
  read pattern -- reads every `templates/*.json`, sorts by name. Backs a new **public**
  `GET /api/templates` endpoint in `server.js` (deliberately not under the
  `requireLocalhost`-gated `/api/admin/*` prefix, since these files ship read-only with the
  app and contain no secrets by construction).
- **Four starter templates** (`templates/<id>.json`, each a `_type: 'lab-template'` envelope
  with a partial `answers` object -- only the fields that differ from the wizard's defaults):
  `learn-nsx` (3 hosts, NSX-T full topology + BGP-peered VyOS), `learn-vsan` (3 hosts, vSAN
  ESA pre-wired with storage-pool disks), `vcf-cert-prep` (4 hosts, vSAN + NSX + VCF Bring-up
  switched on -- VCF-specific IP fields deliberately left blank for the user to fill in),
  `basic-homelab` (1 host, everything optional switched off). The first three set
  `learningMode: true` and a matching `designRationale.techFocus`/`learningGoal` so the
  learn-blocks and onboarding tie-ins are consistent with picking a "Learn X" template.
- Verified with Playwright: all 4 templates list correctly, selecting one lands in the
  wizard at step 0 with the right fields pre-filled (spot-checked `nsxEnabled`/`vyosEnabled`/
  `cpuCores` for Learn NSX), Back and "upload your own file" both still work, normal step
  navigation (Next/Back) is unaffected after loading a template. Zero console/page errors.

### v1.25.0 (prerequisites gate covers ISOs/OVAs and govc)
- Expanded `#prereq-screen` (`public/index.html`) from 5 to 7 checklist items -- the gating
  mechanism (`wirePrereqScreen()`/`updatePrereqStart()` in `public/wizard.js`) is fully
  generic over `.prereq-check` count, so no JS changes were needed, only markup:
  1. New **"ISOs and OVAs downloaded"** item -- lists exactly which files a lab needs and
     where to get each: ESXi ISO + vCenter Server Appliance OVA (Broadcom portal), Nested
     ESXi Virtual Appliance OVA (William Lam's williamlam.com/nested-virtualization, same
     link already used at the OVA-deploy hint in the Nested cluster step), VyOS ISO
     (vyos.io/get-vyos -- same URL `lib/generatePrerequisites.js` already uses), Windows
     Server ISO (Microsoft Evaluation Center -- same URL `generatePrerequisites.js` uses).
  2. New **govc** item -- was previously only name-dropped inside the OVF Tool item's
     description with stale framing ("a fallback alongside PowerCLI/govc"); this is
     inaccurate since v1.19.0 made govc mandatory (no PowerCLI fallback) for
     `deploy-lab.ps1`'s OVA-based nested-ESXi import. New item states this plainly --
     required for OVA deploys, not needed for Kickstart/ISO -- with the same
     github.com/vmware/govmomi/releases download instructions `generatePrerequisites.js`
     already documents.
  - **OVF Tool item's description corrected**: dropped the "fallback alongside
    PowerCLI/govc" claim (no longer true given the no-fallback decision); now describes
    it as a standalone manual-deployment option, not part of the generated scripts' path.
  - Verified with Playwright: all 7 checkboxes gate `#prereq-start-btn` correctly
    (generic `.prereq-check` count, no hardcoded assumption), full page reload restores
    checked state, Start reveals mode-select. Zero console/page errors.

### v1.22.0 (prerequisites gate before the wizard starts)
- **New `#prereq-screen`** (`public/index.html`), shown first on page load, before
  `#mode-select-screen` (which now starts with the `hidden` attribute instead of being
  visible by default). Five checklist items, each a `<label class="prereq-item">`
  wrapping a `.prereq-check` checkbox + title/description, styled to match the existing
  `.mode-card` aesthetic (`.prereq-item:has(.prereq-check:checked)` for the checked
  state, consistent with the `:has()` pattern already used for `.radio-card`/
  `.choice-pill`/`.dc-profile-card` elsewhere in `style.css`):
  1. Broadcom portal account (free registration, needed before any ISO downloads)
  2. PowerShell 7.2+
  3. VMware PowerCLI 13.x+
  4. VMware OVF Tool (new -- not referenced by any generated script; documented here as a
     standalone/alternative command-line OVA deployment option, same spirit as govc)
  5. Physical host hardware minimum -- 64GB RAM (128GB+ recommended), 8+ cores,
     500GB+ NVMe/SSD, nested virtualization enabled
- **`wirePrereqScreen()`** (`public/wizard.js`, called from Init alongside the other
  `wire*()` calls): restores checkbox state from `localStorage['vsphere-wizard-prereq-checklist']`
  (a plain `{id: bool}` map, deliberately separate from the `vsphere-wizard-autosave` key
  -- this is a standing preference, not wizard progress) on load, wires each checkbox's
  `change` to persist and re-run `updatePrereqStart()`, which enables `#prereq-start-btn`
  only when every `.prereq-check` is checked and updates the hint text with a remaining
  count. Clicking Start hides `#prereq-screen` and reveals `#mode-select-screen` -- the
  previous single entry point, unchanged beyond no longer being visible by default.
  Help links inside each item's description have `click` -> `stopPropagation()` wired
  (`.prereq-item-desc a`) so opening one doesn't also toggle that item's checkbox --
  labels forward clicks to their wrapped control by default, links included.
  - Does **not** auto-skip the screen when all items are already checked from a previous
    visit -- by design, restoring checked state and immediately enabling Start (one click
    to continue) was judged sufficient; auto-skip would need extra logic to reliably
    distinguish "returning, already confirmed" from "first-ever load with a lucky
    localStorage collision," not worth it for a one-click screen.
  - `checkAutoSave()` is unaffected -- it only toggles `#autosave-banner` (inside
    `#mode-select-screen`), not that screen's own visibility, so a saved in-progress
    session is still offered once the user gets past the prereq gate.
- Verified with Playwright + real Brave, against both `node server.js` and a real
  Docker container: fresh load shows the gate with Start disabled; a real click
  (not just programmatic) on an item's title toggles its checkbox and re-toggles on a
  second click; clicking a help link does NOT toggle its checkbox; checking all five
  enables Start and correctly populates localStorage; clicking Start reveals
  mode-select; a full page reload restores all checked state and Start stays enabled.
  Zero console/page errors throughout.

### v1.21.1 ("Open in viewer" was a dead link before Generate; init-order hardening)
- **Root cause of "the /diagram page shows nothing"**: the review screen's "Open in
  viewer" link (`.review-diagram-open` in `public/index.html`) was always a static
  `href="/diagram"` with no session id -- unlike the left-rail "View Diagram" button
  (`#rail-diagram-btn`), which was already correctly updated to `/diagram?id=<session>`
  inside the `/api/generate` success handler in `wireGenerate()`. Clicking "Open in
  viewer" from the review screen -- the natural thing to do right next to the live
  preview, and before Generate has necessarily been run yet -- opened `/diagram` with
  no id and no spec, i.e. the genuinely-empty "load a file or enter a session id" state.
  This was a real, reproducible bug, independent of the v1.21.0 Docker/mermaid fix.
  - Fix: `renderReviewDiagram()` now stashes the in-progress review spec into
    `localStorage['vsphere-diagram-preview-spec']` after every successful live-preview
    render (localStorage, not sessionStorage -- sessionStorage is only reliably inherited
    by a new tab when it's a same-origin *auxiliary browsing context*, an extra condition
    not worth depending on; localStorage is shared with any same-origin tab
    unconditionally, opened however). `public/diagram.html`'s `autoLoadFromQuery()` falls
    back to reading and consuming (removing) that key when there's no `?id=`/`?session=`
    param, via the existing `loadFromSpec()`.
  - Once `/api/generate` succeeds, `wireGenerate()`'s success handler now updates
    `.review-diagram-open`'s href to `/diagram?id=<session>` exactly like it already did
    for `#rail-diagram-btn` -- the real session link takes over and the localStorage
    fallback becomes moot (though harmless if stale).
  - Verified with Playwright + real Brave: review screen renders live -> stash lands in
    localStorage -> a separate new tab (opened independently in the same context, not
    via the flaky "click a target=_blank link" pattern some Playwright/Brave headless
    combinations don't reliably fire a `popup` event for) loads `/diagram` with no id and
    correctly renders the stashed spec, clearing the key after. Re-verified after
    Generate that both links correctly carry the real session id and `/diagram?id=`
    renders. Zero page errors in all cases.
- **Init-order hardening on the review screen** (the other half of this fix, requested
  explicitly): `<script src="/vendor/mermaid.min.js">` already loads before `wizard.js`
  in `public/index.html` as a classic (non-async/non-module) script, so `mermaid` is
  guaranteed defined by the time any wizard.js code runs -- the previous one-shot
  `typeof mermaid === 'undefined'` check wasn't actually racy under normal script
  loading. Hardened anyway for defense-in-depth on slow connections: `renderReviewDiagram()`
  is now `async` and calls a new `waitForMermaid()` (polls every 100ms, up to 3s) instead
  of failing immediately on the first check. Only shows the "diagram preview
  unavailable" fallback if mermaid genuinely never becomes defined within that window.
- Re-verified the whole v1.21.0 Docker/Brave fix still holds with a **`docker build
  --no-cache`** fresh image (not relying on any previously-built/cached image or running
  container) -- `/vendor/mermaid.min.js` 200s, review screen and `/diagram?id=` both
  render, zero console/page errors. If you were still seeing the old symptoms, the
  running container was almost certainly built from an image tag predating v1.21.0/1 --
  pull `redeye365/zero-to-hero:latest` again (or `:1.21.1`) and recreate the container.

### v1.21.0 (Docker rendering fix, editable diagram source, manual components)
- **Root-caused and fixed the "diagram doesn't render in Docker" bug**: `mermaid` (the
  client-side rendering library served at `/vendor/mermaid.min.js`) was only ever pulled
  in as a *transitive* dependency of `@mermaid-js/mermaid-cli`, which is a devDependency.
  `npm install --production` (what the Docker image runs) therefore never installed it,
  so `/vendor/mermaid.min.js` 404'd in every container -- both the review-screen preview
  (`public/index.html` / `wizard.js`) and `/diagram` (`public/diagram.html`) were broken
  in Docker specifically, silently, since both already loaded Mermaid locally rather than
  from a CDN (that part was already correct). Fix: `mermaid` promoted to a **direct**
  `dependencies` entry (`package.json`) at the same version mermaid-cli already pins, so
  it survives `--production`/`--omit=dev` installs regardless of whether mermaid-cli is
  present. Verified with a real `docker build` + fresh container: `/vendor/mermaid.min.js`
  now 200s, and with Playwright driving the actual Brave Browser binary
  (`executablePath` to `/Applications/Brave Browser.app/...`) against that container --
  zero console/page errors on both the review screen and `/diagram`, confirming the
  "must render in Brave without errors" requirement too. The CDN-loaded Mermaid in the
  standalone downloaded `diagram.html` (`lib/generateDiagramHtml.js`) is unrelated and
  intentional -- that file has to work with no server behind it at all, hence CDN +
  offline fallback (mermaid.live link + raw source) is the correct design there, not a bug.
- **`/diagram` edit mode**: new toolbar toggle (`#btn-toggle-edit`) opens a side panel
  with the raw Mermaid source in a textarea (`#mermaid-editor`). Every edit re-renders
  the preview after a 350ms debounce (`renderFromEditor()`); a bad edit shows an inline
  error under the textarea (`#editor-error`) without blanking the last good diagram.
  Panel also has Download SVG (shares `downloadSvg()` with the toolbar button) and Copy
  Mermaid source (`copyText()` -- tries `navigator.clipboard`, falls back to a hidden
  `execCommand('copy')` textarea, since the Clipboard API requires a secure context and
  this app is commonly reached over plain HTTP on a LAN IP, e.g. a Raspberry Pi).
- **Save changes persists to the session, not just the browser**: `spec.diagramOverride`
  (string) is a new optional field on the spec. `POST /api/diagram/:id/save` writes the
  edited Mermaid onto `lab-spec.json` as `diagramOverride`, and regenerates that session's
  `diagram.html` / `network-diagram.svg` download artifacts to match (`svgGenerated:
  false` in the container, since `mmdc` isn't bundled there -- handled gracefully, same
  as the existing pattern). `GET /api/diagram/:id` and `POST /api/diagram/from-spec` both
  now check for `diagramOverride` first and return it in place of a fresh
  `buildMermaidDiagram(spec)` call when present (`edited: true` in the response). Only
  available when loaded via a session ID (`currentSessionId` tracked client-side, set by
  `?id=`/`Load session`, cleared on file-based loads) -- file-uploaded specs have no
  server-side session to persist to, so Save is a no-op toast pointing at Copy/Download
  instead.
- **Manual component addition** (`+ Component` toolbar button, opens the same edit panel):
  simple form -- name, IP (optional), type (router/switch/server/VM/appliance), and a
  checkbox list of existing components to connect to. `parseMermaidNodes()` is a
  best-effort regex scan of the current source (`^\s*ID\s*[bracket]+"label"`, deliberately
  narrow so it only matches wizard-shaped node-def lines, never subgraph/class/style/edge
  lines) used purely to populate that connection checklist -- not a real Mermaid parser.
  Submitting appends a new `classDef custom` (once) + a shaped node (stadium/hexagon/
  rect/rounded/subroutine per type, orange dashed border to visually mark it as
  hand-added) + `--- ` edges to every checked component, directly into the same textarea
  buffer edit mode uses, then re-renders and flows through the same Save Changes path.
  This is exactly the William-Lam-adds-a-VIS-appliance case -- no wizard re-run needed.
- **`lastConnectionNodeIds` diffing** in `refreshConnectionsList()`: the checkbox list is
  only rebuilt when the parsed node-ID set actually changes, not on every debounced
  keystroke -- otherwise a user mid-edit with some connection boxes already checked would
  see them silently uncheck themselves on the next render tick.
- Verified end-to-end (Playwright + real Brave, against both `node server.js` and a real
  `docker build` container): generate -> load `/diagram?id=` -> open edit mode -> add a
  component with two connections -> confirm it renders -> Save changes -> confirm
  `GET /api/diagram/:id` returns `edited:true` with the new node -> fresh page load shows
  the saved edit -> Copy Mermaid source -> Download SVG. Zero page/console errors
  (excluding an unrelated, pre-existing `favicon.ico` 404) in both environments.

### v1.20.0 (Docker & Harbor support)
- **`Dockerfile`**: `node:18-alpine` (multi-arch manifests already cover amd64/arm64 --
  no per-arch branching needed); `npm install --production` (skips `mermaid-cli`/`pkg`/
  `playwright` devDependencies, which aren't needed at runtime); runs as the built-in
  non-root `node` user; `EXPOSE 3000`; `CMD ["node", "server.js"]`.
- **Binding conflict with the v0.6.6-beta security audit, resolved via env vars, not by
  reverting the audit**: the server still defaults to `127.0.0.1` (see `startServer()`,
  `HOST` const) for native/`npm start` use -- unchanged. The Docker image sets two env
  vars instead: `HOST=0.0.0.0` (127.0.0.1 inside a container is unreachable through
  Docker's port mapping) and `ADMIN_ENABLED=false` (new -- when false, `/api/admin/*`
  is replaced with a blanket 404 instead of being wired to `requireLocalhost`, since that
  middleware's loopback-IP check stops being a meaningful gate once `HOST` is `0.0.0.0`).
  `ADMIN_ENABLED` defaults to `true` (enabled) for native use, so `npm start` behavior is
  unchanged. This was a deliberate tradeoff discussed and chosen over two alternatives:
  shipping Docker support but leaving the app unreachable in a container, or trusting the
  Docker bridge subnet in `requireLocalhost` instead of disabling admin outright.
- **`docker-compose.yml`**: builds from the local `Dockerfile`, maps `3000:3000`, mounts
  `./scenarios:/app/scenarios` for persistence, sets `PORT`/`HOST`/`ADMIN_ENABLED`.
- **`.dockerignore`**: `node_modules/`, `dist/`, `output/`, `.git/`, `*.exe`, `*.zip`,
  plus `vcenter-config.json` / `scenarios/active.json` / `crash.log` so local secrets and
  run state never get baked into an image layer.
- **`harbor-push.sh`**: builds, tags (`<version>` from `package.json` + `latest`), and
  pushes a single-arch image to Harbor. Registry defaults: `harbor.lab.clouditblog.com`,
  project `lab-tools`, image `zero-to-hero` -- overridable via `HARBOR_URL`/
  `HARBOR_PROJECT` env vars. Credentials (`HARBOR_USERNAME`/`HARBOR_PASSWORD`) are read
  from the environment only, never hardcoded or committed.
- **`build-multiarch.sh`**: `docker buildx build --platform linux/amd64,linux/arm64
  --push`, tagging and pushing to **both** Docker Hub (`redeye365/zero-to-hero`) and
  Harbor in one pass. Creates a dedicated buildx builder (`zero-to-hero-builder`) if one
  doesn't already exist. Same env-var credential handling as `harbor-push.sh`, plus
  optional `DOCKERHUB_USERNAME`/`DOCKERHUB_PASSWORD` (skippable if already `docker
  login`'d to Docker Hub).
- **`package.json`**: `docker:build` / `docker:run` / `docker:push` scripts added;
  version bumped `1.19.0` -> `1.20.0`.
- **README**: new "Running with Docker" section -- Docker Hub run command, Harbor
  pull+run command, Raspberry Pi instructions (64-bit Pi OS, Docker pulls arm64
  automatically), `docker compose up -d --build`, and the build/push scripts. Explicitly
  documents the `HOST=0.0.0.0` / `ADMIN_ENABLED=false` tradeoff and warns the image isn't
  hardened for exposure beyond a trusted home-lab network.

### v1.19.0 (govc-only OVA import, dropping the PowerCLI fallback)
- **`buildDeployLabOva` now requires `govc` for the nested-ESXi OVA import -- no PowerCLI**
  **fallback.** v1.18.2 added `govc` as the preferred path with `Import-VApp`/
  `Get-OvfConfiguration` kept as a fallback for when `govc` wasn't installed; this release
  removes that fallback entirely; PowerCLI's OVF import is not just unreliable against a
  standalone ESXi host, it's unwanted here at all now.
  - The script throws early (`if (-not (Get-Command govc ...)) { throw ... }`) if `govc`
    isn't on PATH, instead of silently falling back.
  - `$env:GOVC_URL`/`GOVC_USERNAME`/`GOVC_PASSWORD` (from the same credential already
    collected for `Connect-VIServer`) and the `govc import.spec` / patch-JSON /
    `govc import.ova` / `govc vm.change -e vhv.enable=TRUE` / `monitor.allowLegacyCPU=TRUE`
    sequence are now unconditional, not branched on `$govcAvailable`.
  - PowerCLI is still required for everything else in the script (vSwitch/port group setup,
    host/datastore lookup, ESA NVMe disk attachment via the existing `emitEsaNvmeBlock()` --
    govc still has no NVMe controller support -- and post-import SCSI disk/Start-VM).
  - `vcenter-deploy.ps1`'s own govc/PowerCLI dual-path is unrelated and unchanged -- this only
    affects `deploy-lab.ps1`'s OVA-based nested ESXi import.
  - `PREREQUISITES.md` and `build-guide.md` updated: the govc section is now conditional on
    `spec.esxiDeployMethod === 'ova'` -- "required, no fallback" instead of "at least one of
    PowerCLI/govc, both is fine" when OVA deploy is selected.
- Re-validated every generated script with PowerShell's own parser after removing the
  fallback branch, across single/multi-host and ESA/OSA configs.

### v1.18.2 (govc OVA import for standalone ESXi, remaining em-dash sweep)
- **`buildDeployLabOva` now detects and prefers `govc` for the nested-ESXi OVA import**,
  matching the pattern already used in `vcenter-deploy.ps1`: `Get-OvfConfiguration`/`Import-VApp`
  has known reliability problems against a standalone ESXi host, since vApp import assumes a
  vCenter-managed inventory that doesn't exist yet at this stage. When `govc` is on PATH:
  `govc import.spec` generates the OVF property spec, guestinfo properties (hostname, IP,
  netmask, gateway, VLAN, DNS, domain, NTP, password, ssh, createvmfs) and the network mapping
  are patched into it, `govc import.ova` deploys, then `govc vm.change -e` sets
  `vhv.enable`/`monitor.allowLegacyCPU`. Falls back to the existing PowerCLI `Import-VApp` path
  when `govc` isn't installed. `$env:GOVC_URL`/`GOVC_USERNAME`/`GOVC_PASSWORD` are set from the
  same credential already collected for `Connect-VIServer`, so the user isn't prompted twice.
  - **ESA vSAN storage-pool disks stay on PowerCLI regardless of import path** -- govc's
    `vm.disk.create` only supports SCSI controllers (verified against the govmomi docs), not
    NVMe, so there's no govc equivalent for the raw `VirtualNVMEController` API calls this
    needs. After a govc import, the script bridges back to a PowerCLI object (`Get-VM -Name
    $vmName`) and reuses the same `emitEsaNvmeBlock()` used by the PowerCLI/ISO paths.
  - **Found and fixed a real pre-existing bug while wiring this up**: `emitEsaNvmeBlock()`
    reused `$ds` as a local variable name for the per-disk `VirtualDeviceConfigSpec`, which
    collided with the `$ds` datastore object every caller already had in scope (`Get-Datastore`).
    On host 2+ in any multi-host deployment with ESA vSAN, this silently clobbered `$ds` after
    host 1, so `-Datastore $ds` on subsequent hosts passed a leftover device-config object
    instead of the datastore. Renamed to `$diskCfgSpec`. Affected both the ISO and OVA paths,
    pre-dating this release.
- **Em dash/en dash sweep completed**: every remaining `lib/generate*.js` file
  (`generateBuildGuide.js`, `generateMarkdown.js`, `generatePrerequisites.js`,
  `generateKickstart.js`, `generateDiagramHtml.js`) had its `—`/`–` characters
  replaced with `--`, on top of the `.ps1`-generating files already fixed in v1.18.1. Zero
  em/en-dash characters remain anywhere in the generator source or in a full regeneration's
  output (`.ps1`, `.md`, `.json`, `.sh`, `.txt`).
- Re-validated every generated script with PowerShell's own parser across single/multi-host,
  ISO/OVA, ESA/OSA, and BGP+NSX+VCF+depot configs after both changes.

### v1.18.1 (fix mis-encoded .ps1 scripts on Windows PowerShell 5.1)
- **Root cause of the recurring "random syntax error deep in the file" reports**: generated
  `.ps1` files are written as UTF-8 with no BOM. Windows PowerShell 5.1 (`powershell.exe`,
  still the default on most Windows machines — as opposed to PowerShell Core/`pwsh`, which
  defaults to UTF-8) reads a BOM-less script using the system's ANSI codepage instead. Every
  non-ASCII character we emitted (em dashes throughout comments/`Write-Host` strings) got
  mis-decoded byte-by-byte, and depending on the codepage one of those stray bytes can land on
  an actual quote or brace character — producing exactly the "missing quote terminator" /
  "missing closing '}'" errors reported, at a line number nowhere near the real cause. This
  never reproduced under `pwsh` (used for validation), which is why it looked intermittent.
  - `writeGeneratedFile()` (`server.js`) now prepends a UTF-8 BOM (`\uFEFF`) to every `.ps1`
    file at write time — this makes both `powershell.exe` and `pwsh` detect the encoding
    correctly regardless of system codepage. `.sh` scripts are deliberately excluded (a BOM
    before `#!` breaks shebang detection); `.json`/`.md` etc. don't need one.
  - Also replaced every em dash with `--` in the generator files that actually emit `.ps1`
    content (`generatePowerShell.js`, `generateNsx.js`, `generateVcf.js`, `generateDepot.js`)
    as a belt-and-suspenders fix, so the BOM isn't the only thing standing between a stray
    typographic character and a broken script.
  - Confirmed via `[System.Management.Automation.Language.Parser]::ParseFile` across several
    configs (single/multi-host, ISO/OVA, minimal and heavy/ESA+legacy-CPU+VCF+NSX+depot) that
    every generated script still parses cleanly with the BOM present.

### v1.18.0 (VLAN trunk network model, DC network placement)
- **Two-vSwitch VLAN trunk model replaces one-port-group-per-network**: physical host now gets
  **vSwitch0** (existing switch, physical uplink, carries VyOS's WAN NIC only) and **vSwitch1**
  (no physical uplink, created automatically by `deploy-lab.ps1`) with a single **Nested-Trunk**
  port group set to VLAN 4095 (trunk — passes every VLAN tag through). VyOS is the only device
  that routes between VLANs, via a per-network `vif` sub-interface on its own trunk NIC (see
  `vyos-config.txt`). All other lab VMs — nested ESXi, DC, jumpbox, workload VMs, depot — connect
  a single NIC to Nested-Trunk instead of one NIC per network.
  - `emitTrunkPortGroupBlock()` (`lib/generatePowerShell.js`) creates vSwitch1 + the trunk port
    group with the required Promiscuous/Forged-transmits/MAC-changes security policy, replacing
    the old per-network `emitPortGroupBlock()`.
  - `vyos-deploy.ps1` now attaches exactly 2 NICs (WAN + Nested-Trunk) instead of one per network.
  - Nested ESXi hosts (ISO and OVA paths) get one NIC on Nested-Trunk; they tag their own
    vMotion/vSAN/VM-Traffic vmkernel ports internally using the VLAN IDs from `lab-spec.json`
    (documented in the generated `.NOTES` and `build-guide.md`). OVA path additionally feeds the
    real management VLAN ID into the appliance's `guestinfo.vlan` OVF property.
  - `build-guide.md` / `design-doc.md` updated: two-vSwitch architecture description, VLAN
    "two-layer rule" (VyOS vif + nested vmk0 — the port group is always a fixed trunk, so it's
    no longer a factor, unlike the old three-layer rule).
- **`vyos-config.txt`**: new ready-to-paste VyOS CLI configuration file, generated alongside
  `vyos-deploy.ps1` whenever VyOS is enabled. Resolves real values from the spec — management
  CIDR/VLAN, NAT, DHCP range, DNS/NTP source, and (BGP mode) the actual AS numbers and NSX T0
  peer IP. `vyos-deploy.ps1`'s completion message now points here instead of printing generic
  instructions. New download kind `vyos-config` in `server.js` / `SCRIPT_LABELS` in `wizard.js`.
- **DC network placement option** (step 4): "Lab management network (Nested-Trunk)" vs
  "Physical/home network (VM Network)" — `g.dcNetworkPlacement`, `spec.domainController.networkPlacement`.
  Physical placement puts the DC's NIC on the WAN port group (`$PortGroup` param, default
  `"VM Network"`) instead of Nested-Trunk, and `build-guide.md`'s static-IP instructions switch to
  the home router as the gateway instead of VyOS. DNS/NTP references elsewhere already just use
  `dc.ipAddress`, so no other changes were needed for those to pick up a home-network IP.
- **VyOS DHCP syntax fixed for current/rolling release**: `subnet-id` is now required per subnet,
  and `name-server`/`default-router` moved under `option` (`set service dhcp-server
  shared-network-name LAB subnet '<cidr>' option name-server '<ip>'`) — the old flat
  `subnet '<cidr>' name-server '<ip>'` syntax silently fails to commit on rolling. Fixed in both
  `vyos-config.txt` and `build-guide.md`. Also added the previously-missing `option default-router`.
- **Another parse bug found by validating every generated script with PowerShell's own parser**
  (`[System.Management.Automation.Language.Parser]::ParseFile`): `nsx-configure.ps1` shelled out
  to `openssl s_client ... </dev/null` — literal bash redirection syntax, invalid in PowerShell
  (and the computed fingerprint was never even used — `thumbprint` was hardcoded to `""`).
  Replaced with a native `System.Net.Security.SslStream` fetch and wired the real thumbprint into
  the compute-manager registration body.

### v1.13 (lab-config.json / File locations step)
- **New step 15 — File locations** (inserted between Security & access and Review; old step 15 Review → 16, step 16 Troubleshooting → 17; `TOTAL_STEPS` 17 → 18, new `FILE_LOCATIONS_STEP = 15`):
  - Collects local Windows paths for `vyosIso`, `windowsServerIso`, `esxiIso`, `nestedEsxiOva`, `vCenterOva` — whichever are relevant given `vyosEnabled` / `dcProfile` / `esxiDeployMethod` (evaluated fresh on step entry by `renderFileLocationsVisibility()`, since those flags are decided in earlier steps)
  - Fields are optional in the wizard — leaving one blank just means editing `lab-config.json` by hand later; the generated scripts still hard-require it at runtime
  - New `spec.labConfig` section (`lib/generateSpec.js`) carries the five fields through to script generation
- **`lab-config.json` is now generated pre-filled**, not just a `.example` template: `buildLabConfigFromSpec(spec)` (`lib/generatePowerShell.js`) writes real values (or `""` if left blank in the wizard) into `localPaths`; `datastorePaths` stays empty (manual escape hatch, documented in PREREQUISITES.md, not collected by the wizard). `buildLabConfigExample()` is still written alongside as a blank reference copy of the schema. Both are new download kinds (`lab-config` / `lab-config-example`) in `server.js` and `SCRIPT_LABELS`/`renderDownloads()` in `wizard.js`.
- **Every deploy script reads ISO/OVA paths from `lab-config.json`, never a script parameter**: `vyos-deploy.ps1`, `dc-deploy.ps1`, `deploy-lab.ps1` (both ISO and OVA variants), `vcenter-deploy.ps1`. Shared helpers in `lib/generatePowerShell.js`: `emitLabConfigLoader()` (loads the JSON once, throws if missing), `emitLocalFileResolution()` (OVA appliances — Import-VApp/govc read the local file directly), `emitDatastoreIsoResolution()` (CD-ROM ISOs — auto-uploads the local file to `[<datastore>] ISOs/<filename>` via a `VimDatastore` PSDrive, or uses `datastorePaths` directly if set). No `[Parameter(Mandatory = $true)]` ISO/OVA params remain anywhere.
- **Template strips** (`buildWizardSave(true)`) now also clears `vyosIso`, `windowsServerIso`, `esxiIso`, `nestedEsxiOva`, `vCenterOva` — local file paths are machine-specific and shouldn't leak into a shared `.labtemplate`.
- Fixed a pre-existing parse bug found while syntax-validating the regenerated `vcenter-deploy.ps1` with PowerShell's own parser: `$ovfConfig.guestinfo.cis.vmdir.domain-name.Value` doesn't parse (hyphen in a bare dot-path) — quoted the property segment.

### v1.11.0 (Save and resume)
- **Auto-save to localStorage** (`vsphere-wizard-autosave`): state serialised after every `onChange` and every `showStep`. Cleared on successful generate. Key format: `{ _type, _version:1, _savedAt, _step, learningMode, architectMode, answers, designRationale, discovery, decisionLog, riskRegister }`.
- **Resume banner** on mode-select screen: `checkAutoSave()` runs at init; if a valid autosave exists, `#autosave-banner` is shown above the mode cards with the saved step and time-ago. Resume loads the config and enters the app; Start Fresh discards it.
- **4-option mode-select screen**: Build / Learning / Continue saved design / Start from template. Continue and template cards trigger hidden file inputs (`#load-config-input`, `#load-template-input`).
- **Save progress button** (`#rail-save-btn`) in the wizard sidebar: downloads `wizard-config-[ts].json` containing full state (including passwords). Present on every step.
- **Export as template** (`#btn-export-template`) on the review screen (step 14): same format but strips IPs and passwords → `.labtemplate` extension. Sits next to the Generate button in a `.generate-actions` flex row.
- **Load flow**: file → `isValidWizardConfig()` → `loadWizardConfig()` → `populateFormFromState()` → `enterAppWithConfig()` → `showStep(savedStep)`. A `#config-loaded-banner` confirms the load for 5 s.
- **`populateFormFromState()`**: syncs all wizard DOM fields from `state.answers` — inputs, selects, radios, checkboxes, conditional show/hide, dynamic lists (storage devices, additional hosts, nested disks, placement rows). Uses `_onFormChange` so re-rendered dynamic rows are fully wired.
- **`_onFormChange`**: module-level reference to the `onChange` closure in `wireForm()`, set at wireForm init. Used by `populateFormFromState` to pass the real onChange to render functions.
- **Template strips**: `hardware.ipAddress`, `additionalHosts[].ipAddress`, `dcIpAddress`, `nsxIpAddress`, `depotIpAddress`, `nestedEsxiPassword`, `vcfEsxiPassword`, `vcfEsxiLicense`, `vcfVcenterLicense`, `vcfSddcMgrIp`, `vcfVcenterIp`.

### v1.10.0 (DC deployment profiles)
- **DC deployment profile radio card layout** replaces single DC checkbox (step 4):
  - Four options: **No DC** / **DC only** / **DC + Jumpbox** / **DC + Jumpbox + File Server**
  - Profile-aware sizing: No DC → 0; DC only → 2 vCPU / 4 GB; Jumpbox → 4 vCPU / 8 GB; File Server → 4 vCPU / 8 GB OS + configurable second disk
  - `dc-jumpbox-fileserver` profile: `dcStorageDiskGB` input (default 200 GB); build guide includes PowerShell to init disk + create `\\dc\LabISOs` share
  - Jumpbox profiles: `buildRdpFile(dc)` in `generatePowerShell.js` generates `lab-dc.rdp` in output zip (pre-configured with DC IP, 1920×1080, clipboard redirect)
  - State: `g.dcProfile` (`'none'` | `'dc-only'` | `'dc-jumpbox'` | `'dc-jumpbox-fileserver'`), `g.dcStorageDiskGB`
  - `lib/sizing.js`: `DC_VCPU_BY_PROFILE` / `DC_VRAM_GB_BY_PROFILE` lookup objects replace scalar constants
  - `lib/generateSpec.js`: `domainController` spec now includes `profile`, `hasJumpbox`, `hasFileServer`, `storageDiskGB`; backward-compat fallback from `enabled` bool
  - `server.js`: writes `lab-dc.rdp` to output dir when `buildRdpFile` returns non-null
  - `module.exports` for `generatePowerShell.js`: `{ buildPowerShellScripts, buildRdpFile }`

### v1.9.2 (cert relevance field in build form)
- **Cert relevance checkbox grid** replaces free-text field in scenario build form:
  - 10-cert grid (`VCP-VCF-Architect`, `VCP-VCF-Admin`, `VCP-VCF-Support`, `VCP-VVF-Admin`, `VCP-VVF-Support`, `VCAP-VCF-Automation`, `VCAP-VCF-Operations`, `VCAP-VCF-Storage`, `VCAP-VCF-VKS`, `VCAP-VCF-Networking`)
  - `.ts-build-cert-checks` / `.ts-cert-check-item` styles; `tsLibOpenBuild()` pre-checks saved values; `tsLibSave()` reads checked values into `certRelevance[]`
- **Learning objectives textarea**: `#ts-build-objectives` (2–4 lines); stored as `learningObjectives[]` (one item per non-blank line)

### v1.9.1 (scenario library expansion — cert coverage)
- **5 new scenarios** added to fill zero-coverage certs; wizard now ships 27 scenarios (was 22):
  - `vcsa-disk-space-log` — easy, VCP-VVF-Support + VCP-VVF-Admin
  - `esxi-coredump-unconfigured` — easy, VCP-VVF-Support
  - `aria-automation-project-zone-missing` — medium, VCAP-VCF-Automation
  - `aria-ops-adapter-credentials` — medium, VCAP-VCF-Operations
  - `tkg-namespace-storage-policy` — medium, VCAP-VCF-VKS
- All 10 cert codes now have at least one scenario

### v1.9.0 (Study Plan tab)
- **Study Plan** — third tab in the troubleshooter panel (`#ts-studyplan-panel`):
  - Scenarios grouped by cert, sorted Easy → Medium → Hard within each cert
  - Per-cert progress bar + overall progress bar at top
  - Per-row: Load button + Mark Done / Undo toggle (persisted to `'vsphere-completed-scenarios'` localStorage key)
  - `tsRenderStudyPlan()` — main render function; `SP_CERT_LABELS` — cert display name map; `SP_DIFF_ORDER` — sort constants
  - `tsGetCompleted()` / `tsSetCompleted(id, done)` — localStorage helpers
  - Tab button: `#ts-tab-studyplan` (`data-mode="studyplan"`)

### v1.36.0 (current — prereq checklist: two-column layout on desktop)
- **`.prereq-list` restructured into two `.prereq-col` groups** (`public/index.html`): left column is
  hardware/files (`hardware`, `isos`), right column is software/accounts (`powershell`, `powercli`, `ovftool`,
  `govc`, `broadcom-account`). No JS changes needed — `wirePrereqScreen()`/`updatePrereqStart()` already select
  `.prereq-check` globally regardless of DOM nesting.
- **`@media (min-width: 760px)`** (`public/style.css`): `.prereq-list` switches from a stacked flex column to a
  side-by-side flex row (`.prereq-col { flex: 1 1 0 }`), and `.prereq-panel` widens from 720px to 980px so the
  two columns have room. Below 760px, unchanged single-column stack (mobile-first default).
- Also added macOS Gatekeeper instructions to README's "Running the standalone executable" section (right-click
  → Open, or `xattr -d com.apple.quarantine <binary>`), using the current binary naming
  (`zero-to-hero-lab-macos-arm64`/`-macos-x64`) rather than the pre-rebrand filename.
- Verified with Playwright at two viewports: 1280px shows both columns at the same Y (true side-by-side, not
  wrapped), correct 2/5 item split with correct titles; 390px shows the right column stacked below the left.
  Checkbox gating (`#prereq-start-btn` disabled until all 7 checked) still works across both columns. Zero
  console errors.

### v1.35.0 (VIS Appliance as a 5th Domain controller/infra option)
- **New `dcProfile` value `'vis'`** — William Lam's VCF Infrastructure Services Appliance, a 5th card on the
  Domain controller step (`.dc-profile-card[data-profile="vis"]`) alongside the four existing Windows-DC
  profiles. Recommended-for-VCF badge (`.dc-profile-recommended`), description, and a link to
  https://lamw.github.io/vcf-infrastructure-service-appliance/ per the appliance's own docs (verified: 2 vCPU /
  4GB RAM / 30GB disk minimum — matches exactly).
- **New `#vis-fields` block** (separate from `#dc-fields`, which stays Windows-DC-only) — just one field,
  `visIpAddress` (IP validated like `dcIpAddress`), since VIS has no AD domain to name. New Software-library
  field `visOvaPath` → `design.visOva` → `lab-config.json`'s `localPaths.visOva`, same pattern as the other
  OVA paths.
- **`domainController.enabled` is now `profile !== 'none' && profile !== 'vis'`** — VIS is deliberately NOT
  represented as a domain controller in the spec; it gets its own top-level **`vis: { enabled, ipAddress, ova }`**
  spec section (`generateSpec.js`), mutually exclusive with `domainController` via the same `dcProfile` radio.
  `dc.enabled` in `lib/sizing.js` stays `true` for `vis` (RAM/CPU accounting is correct — VIS consumes resources
  like any other appliance, `DC_VCPU_BY_PROFILE.vis = 2` / `DC_VRAM_GB_BY_PROFILE.vis = 4` reuse the same
  profile-keyed lookup maps DC already used), but three DC-specific checks needed a new `windowsDcEnabled =
  dcEnabled && !visEnabled` flag to stay correct for VIS: the NTP-fallback warning (now also fires for VIS,
  checking `visIpAddress` instead of `dcIpAddress`), the "IIS depot needs a DC" warning (VIS is Linux, can't
  host IIS either), and the appliance-breakdown label (now says "VIS" instead of falling through to "DC").
  `VIS_DISK_GB = 30` folds into the existing physical-storage-overcommit check the same way
  `dcStorageDiskGB` does for the file-server DC profile.
- **`lib/generateVis.js`** (new) — `buildVisDeploy(spec)`, returns `null` when `!spec.vis.enabled` (same gating
  pattern as `buildRdpFile`). Generates `vis-deploy.ps1` using **OVF Tool (`ovftool`)** specifically, not
  govc/PowerCLI like the other OVA deploys — reads `localPaths.visOva` via the same `lab-config.json` loader,
  shells out to `ovftool` with `--prop:VIS_FQDN/VIS_IP/VIS_NETMASK/VIS_GATEWAY/VIS_DNS_SERVER/VIS_DNS_DOMAIN/
  VIS_NTP_SERVER/VIS_ROOT_PASSWORD` (the exact variable names William Lam's own `deploy_vis_esx.sh` reference
  documents — the literal OVF property IDs aren't published anywhere, so the script's header comment tells the
  user to run `ovftool "<path>"` alone first to confirm/adjust property names if ovftool rejects any of them).
  Gateway/netmask default from the management CIDR via `firstHostInCidr`/`cidrToMask` (now exported from
  `generateVcf.js` for reuse, alongside `buildVcfFiles`). Wired into `server.js` (`SCRIPT_KINDS['vis-deploy']`,
  written with the same BOM-safe `writeGeneratedFile` every other `.ps1` uses) and `SCRIPT_LABELS` in
  `wizard.js` for the downloads list.
- **`generateMarkdown.js`** (design-doc.md): a VIS design-rationale paragraph parallel to the existing DC one,
  a "Lab components" entry (2 vCPU/4GB/30GB, IP, deploy method), a DNS records table (VIS/vCenter/VyOS/each
  nested host, generated conditionally on what's actually enabled), and the requested attribution line.
- **`generateBuildGuide.js`**: a "Deploy the VIS Appliance" + "Enable VIS services" step pair (parallel to but
  much shorter than the Windows DC promotion flow, since VIS ships pre-built), explicitly stating VIS replaces
  the need for a separate DC for DNS/NTP/DHCP in VCF deployments, plus the attribution line and a
  certification-mode skills-list entry.
- **`generateNetworkDiagram.js`**: VIS renders as a node in the management-network "direct VMs" subgraph
  (reusing the `dc` Mermaid classDef color — same conceptual role), with a `VyOS -> VIS` NAT/DHCP/DNS edge and
  a dashed `VIS -> nested ESXi hosts` DNS/NTP/DHCP edge, mirroring the existing DC edges exactly.
  `hasDirect`/`style DIRECT` conditions extended to include `vis.enabled` so the subgraph still renders when
  VIS is the only direct-VM appliance present (no DC, no jumpbox).
- Verified end-to-end with Playwright + the real generate pipeline: DC step shows 5 cards, selecting VIS hides
  `#dc-fields` and shows `#vis-fields`, validation requires the VIS IP before continuing, a full `/api/generate`
  run produces a BOM-prefixed `vis-deploy.ps1` that parses cleanly under PowerShell's own parser
  (`[System.Management.Automation.Language.Parser]::ParseFile`), `lab-config.json` carries the `visOva` key,
  and `design-doc.md`/`build-guide.md`/the embedded Mermaid diagram all correctly reference VIS. Zero
  console/page errors.

### v1.34.0 (Storage split into its own step; Template promoted to a real step)
- **New front-of-wizard sequence, superseding v1.23's reorder**: Physical host (0) → Home
  network (1) → **Storage (2, new)** → Use case (3) → **Recommended template (4, new — was
  an overlay)** → Virtual router (5) → ... existing steps continue, all shifted +2. See the
  Step numbering table above for the full new layout.
- **Storage split out of the old combined "Hardware" step**: `storageDevices` (the
  `#storage-device-list`/`add-storage-device` UI, `renderStorageDevices()`) moved into a new
  standalone step 2, between Home network and Use case. Its `validateStep` check (device
  count + type/capacity per device) moved with it into a new `case 2`; the old combined
  `case 0` no longer validates storage, only CPU/RAM/hostCount/additionalHosts/esxiVersion.
  Per-additional-host fields (`renderAdditionalHosts()`) stayed on step 0 unchanged — that
  section only ever exposed CPU/RAM overrides, never a separate storage-device editor (extra
  hosts' storage/NIC always inherit host 1's via `sameAsFirst`), so there was nothing to move.
- **"Recommended template" promoted from a one-time overlay to a real numbered step (4)**:
  the v1.30.0 `#template-suggest-overlay` (shown once, intercepted in `wireNav`'s Next
  handler) is removed entirely — its markup becomes a normal `<section class="step"
  data-step="4">`, its card-rendering logic becomes `renderTemplateStep()` (triggered by
  `if (n === 4) renderTemplateStep();` in `showStep()`, same pattern as every other step's
  render-on-entry call), and picking a card still calls the same `applyTemplateDesignOnly()`
  from v1.30.0 unchanged (design-only merge, hardware/network preserved) — it just no longer
  auto-advances or needs a "once per session" flag, since revisiting a normal step via
  Back/rail-click is expected behavior, not a special case to guard against. `state.
  _templateSuggestSeen` and the `#template-suggest-skip` button are both gone; the existing
  Next button is enough (`case 4` in `validateStep` returns null unconditionally — picking a
  template is optional).
- **Every literal step-number reference updated**: `TOTAL_STEPS` 11→13, `NSX_STEP` 7→9,
  `TROUBLESHOOT_STEP` 10→12, the `analysisMap` in architect mode (`{5:'router',
  8:'clusterSize', 9:'nsx'}`), the `sectionHint` map in `wireGenerate()` (Physical host and
  Storage are now two separate entries instead of one combined "Hardware" entry), `STEP_
  LABELS` (12 entries, was 10), the rail `<li data-step>` list (13 entries, relabeled
  "Physical host"/"Home network"/"Storage"/"Template" for the new/renamed ones), all
  `data-learn-step` attributes, and two user-facing warning strings that named a step number
  in prose ("Enable the DC (step 6)", "Change the SSO domain in Nested cluster (step 8)").
- **This explicitly reopens the "max 10 visible steps" constraint from v1.24.0** — that was
  a real, deliberate goal at the time, but this later, more specific instruction (split
  Storage out, make Template a full step) takes precedence over it. Visible step count is
  now 12 (+ hidden Troubleshooting), up from 10.
- Verified end-to-end with Playwright: all 13 sections render with correct H1s in the right
  order, rail shows 13 correctly-labelled entries, Storage step validates independently of
  Physical host, the Template step lists all 5 templates and preserves hardware/network
  answers when applied, and a full walkthrough through to `/api/generate` succeeds and
  produces the same output files as before (`design-doc.md`, `deploy-lab.ps1`,
  `vcf-bringup.json`, etc.). Zero console/page errors throughout.

### v1.33.0 (Docker support removed)
- **Deleted**: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `harbor-push.sh`,
  `build-multiarch.sh`. Removed `docker:build`/`docker:run`/`docker:push` from
  `package.json` scripts. Distribution is standalone-executable-only now (`pkg`,
  see `npm run build`) — README's "Running with Docker" section replaced with a
  three-step "download the exe from Releases, double-click, open localhost:3000"
  section, and its `Dockerfile`/`docker-compose.yml`/`harbor-push.sh`/
  `build-multiarch.sh` entries removed from the Project layout tree.
  - Fixed two now-stale **Coding conventions** bullets that stated Docker facts as
    ongoing truths (not historical): the `mermaid` direct-dependency rationale no
    longer cites "works in the Docker image" (rephrased to the general packaging
    concern that's still true — surviving `npm install --production`/the `pkg`
    executable); the server-binding bullet's `HOST=0.0.0.0`/`ADMIN_ENABLED=false`
    Docker exception is removed, pointing instead at the v1.20.0/v1.21.x history
    below for anyone wondering why those env vars still exist in `server.js` (the
    code itself was left alone — out of scope for this change, just the files/
    scripts/docs).
  - **Historical roadmap entries below (v1.20.0 "Docker & Harbor support", the
    v1.21.x Docker rendering-fix entries) are deliberately left untouched** — same
    reasoning as the v1.32.0 rebrand entry above: they describe what shipped and
    why at the time, and rewriting them would misrepresent history.
  - Verified: `node --check server.js` passes, server starts and serves 200 with no
    Docker-related code paths exercised at runtime (none were touched).

### v1.32.0 (rebrand to Zero to Hero Lab)
- **Product renamed** "vSphere Lab Wizard" → **Zero to Hero Lab** (tagline: *"Build it. Break
  it. Fix it. Learn it."*), v1.31.0 → v1.32.0. Every user-facing brand string and package
  identifier was updated: `package.json`/`package-lock.json` `name` (`vsphere-lab-wizard` →
  `zero-to-hero-lab`), README title/tagline/clone URL/firewall rule/license-attribution link,
  `public/index.html` `<title>`, mode-select H1 + tagline, left-rail brand name,
  `public/diagram.html` title/header, the `author`/`tool` metadata fields written into
  generated output (`lib/generateSpec.js`, `public/wizard.js`), the "Generated by
  vsphere-lab-wizard" footer line in every generator (`generateMarkdown.js` — which also
  gained a tagline line under the design-doc's title — `generateBuildGuide.js`,
  `generateNsx.js`, `generateVcf.js`, `generateDepot.js`, `generateKickstart.js`,
  `generatePrerequisites.js`, `generatePowerShell.js`), all 24 `scenarios/*.json` `author`
  fields, and `server.js`'s header comment/startup banner/startup-error dialog title/vCenter
  snapshot description template.
- **Deliberately left alone**: the GitHub repo itself (renamed separately, out of scope
  here), Docker/Harbor image naming (`Dockerfile`, `docker-compose.yml`, `harbor-push.sh`,
  `build-multiarch.sh` — already coincidentally "zero-to-hero", untouched), and the generic
  word "wizard" everywhere it describes the step-by-step UI pattern rather than the brand
  (`public/wizard.js` filename, `wireForm`/`showStep`, "Wizard Learning Mode", etc.).
- **Historical entries below this one intentionally keep the old "vSphere Lab Wizard" name**
  — they describe what shipped at the time under that name, and rewriting them would
  misrepresent history. Only this file's H1 and this new entry reflect the rebrand.

### v1.31.0 (5th template: Advanced networking)
- **`templates/advanced-networking.json`**: 2 physical hosts, NSX-T full topology (T0/T1/DFW), 2 medium edge
  nodes, BGP with `nsxBgpRouteAdvert: 'specific'` + two `nsxBgpPrefixes` entries and all three redistribution
  flags on — distinct from `learn-nsx` (which uses `'all'` route advertisement, 1 small edge node, single host)
  by going deeper into route-advertisement/redistribution rather than just switching NSX on. vSAN deliberately
  left off so the template stays focused on networking, not storage.
  - No code changes needed — `lib/templateLibrary.js`'s `loadTemplates()` already reads every `templates/*.json`,
    and both template-picking UIs (`renderTemplatePicker()` on mode-select, `showTemplateSuggestOverlay()` from
    v1.30.0) already render whatever `GET /api/templates` returns.
  - Verified: `GET /api/templates` returns 5 templates; mode-select "Start from template" screen shows 5 cards;
    selecting Advanced networking there sets `hostCount:2` (correctly reveals the additional-hosts section on
    the Hardware step), `nsxTopology:'full'`, `nsxEdgeCount:2`. Zero console errors.

### v1.30.0 (template selection joins the reorder flow)
- **Reorder (Hardware → Existing network → Use case) confirmed unchanged from v1.23**; this release adds a
  fifth stop — template selection — after Use case, without growing `TOTAL_STEPS` past the v1.24.0 10-step
  target: it's a one-time full-page **overlay** (`#template-suggest-overlay`, styled like the existing
  `.arch-options-overlay` architect-mode pattern), not a new numbered step.
  - `wireNav()`'s Next handler: when leaving step 2 (Use case) and `!state._templateSuggestSeen`, shows the
    overlay instead of advancing (sets the flag first, so it only ever fires once per session — same pattern
    `state._optionsAnalysisSeen` already uses for architect-mode option overlays).
  - `showTemplateSuggestOverlay()` renders the same curated template cards as the mode-select "Start from
    template" picker (`_templatesCache`, shared — fetched once, reused here). A "Skip — I'll customise
    manually" button and each template card both call `showStep(getNextStep(state.step))` to continue to step 3.
  - **`applyTemplateDesignOnly(tpl)`** — new, deliberately different from `loadWizardConfig()`: only
    `Object.assign`s the template's `answers.design` (networking/cluster/NSX/VCF) onto `state.answers.design`,
    leaving `state.answers.hardware`/`discovery` untouched. By this point in the flow the user has already
    answered real Hardware and Existing-network questions (steps 0-1) — `loadWizardConfig`'s full-object merge
    would have silently overwritten those with the template's example numbers (e.g. Learn NSX's `cpuCores: 16`
    replacing whatever the user actually has). Then calls the existing `populateFormFromState()` to sync the DOM.
  - Verified: overlay appears after Use case with 4 template cards, picking "Learn vSAN" applies
    `vsanEnabled`/`vsanArch` etc. while `hardware.cpuCores`/`ramGB` stay exactly as the user entered them,
    advances to step 3, and does not reappear on a second pass through step 2 (Back then Next again). Zero
    console errors.

### v1.29.0 (live Hardware-step RAM validator)
- **New `#hardware-validator` panel** (`public/index.html`), shown on the Hardware step directly under the
  CPU/RAM fields, hidden until `ramGB` has a value. Two parts:
  1. **Achievable tier** (`RAM_TIERS` constant, `public/wizard.js`) — same 6 thresholds as the v1.28.0 prereq
     checklist table, now computed live from whatever the user just typed: "128 GB gets you: vSphere + vSAN (3
     hosts)" plus a "+64 GB more unlocks..." hint for the next tier up. Below the first tier (64GB) it shows how
     much more RAM is needed to reach it instead.
  2. **RAM math breakdown** (`<details>` — no JS needed for the toggle), reusing the *actual* current
     `state.answers.design.nestedHostCount`/`vramPerHostGB` (which carry real non-null defaults — 3 hosts / 16GB
     — from state init, not placeholders) plus `ESXI_OVERHEAD_GB`/`VCENTER_TINY_RAM_GB`/`DC_RAM_GB_BY_PROFILE`/
     `VYOS_RAM_GB_SIZING` (all pre-existing constants, already used by `calcHostTiers`) to show a per-component
     GB table, a live over-commit warning if the total exceeds the entered physical RAM, and a one-line CPU note
     (max nested hosts by vCPU oversubscription).
  - **`renderHardwareValidator()`** is called from three places so it stays live regardless of which step the
    triggering field lives on: the shared `onChange` closure in `wireForm()` (fires on nearly every field change
    already, including `nestedHostCount`/`vramPerHostGB`/`nsxEnabled`/`vyosEnabled`/`dcProfile` — all bound
    through the same closure), the RAM/CPU inputs directly (same `onChange` path via `bindNumber`), and once on
    `showStep(0)` entry so returning to Hardware after changing later-step answers refreshes the numbers.
  - **Deliberately does not distinguish "default" from "user-set" values** for `nestedHostCount`/`vramPerHostGB`
    — an earlier draft tried to label untouched defaults as "a representative example," but since those defaults
    are real, meaningful values already used everywhere else in the app (3 hosts/16GB is what actually ships in
    the generated scripts if the user changes nothing), pretending they're a hypothetical was actively
    misleading — e.g. it produced a breakdown assuming 3 hosts on a 64GB box (the "vSphere basics, 1-2 hosts"
    tier) with no indication that the 3-host figure came from an unrelated global default, not the achieved
    tier. Fixed by always describing the breakdown as "the nested cluster's current settings (defaults until you
    change them)" — honest either way, and the over-commit warning it produces (74GB needed vs 64GB physical, if
    the user never visits the Nested cluster step) is correct and useful, not a false positive.
  - Verified: tier text and next-tier hint correct at 64/128/192/256 GB; over-commit warning shows at 64GB
    (default 3×16GB cluster doesn't fit) and correctly hides at 256GB; breakdown updates live after changing
    `nestedHostCount`/`vramPerHostGB` on the Nested cluster step and returning to Hardware. Zero console errors.

### v1.28.0 (prereq screen shows the RAM capability tiers)
- **Hardware checklist item rewritten** (`public/index.html`, `data-prereq-id="hardware"`): replaced the flat
  "64GB min, 128GB+ recommended" line with a 6-tier RAM table (`.prereq-ram-table`): 64GB vSphere basics (1-2
  hosts) / 128GB +vSAN (3 hosts) / 192GB +NSX (3-4 hosts) / 256GB +basic VCF / 384GB+ Full VCF recommended /
  512GB+ Full VCF + workload domains. Static HTML, since the prereq screen runs before any wizard field exists
  to compute from — the next release (v1.29.0) reuses these exact same thresholds in a live, RAM-driven version
  on the Hardware step itself (`RAM_TIERS` in `public/wizard.js`). No JS changes needed here — `wirePrereqScreen()`/
  `updatePrereqStart()` are generic over `.prereq-check` count and don't care about item content.
- Verified: table renders (6 rows), checklist still 7 items, Start button still gates on all-checked. Zero
  console/page errors.

### v1.27.0 (Architect Mode discovery cut to 5 sections)
- **Phase 0 discovery reduced from 7 sections to 5**, per direct feedback that architect mode
  asked too many questions on top of the standard wizard:
  - **Stakeholder Analysis removed entirely** — the `.arch-stakeholder-card` picker, its
    `wireDiscovery()` click-wiring, `state.discovery.stakeholders`, its CSS, and the
    `## Stakeholder Analysis` block + readiness-score check in `generateMarkdown.js` are all
    gone (not just hidden — genuinely removed, since the field was already optional there:
    `if (disc.stakeholders)` meant an empty value silently skipped the section, so removing
    the input is a behavior-preserving no-op for anyone who never used it).
  - **Success criteria merged into the Problem statement section** — same two fields
    (`arch-success-criteria`/`arch-success-measure`), same `state.discovery` keys, just
    moved into the same `.arch-disc-section` as `arch-problem-stmt` instead of a separate one.
  - **MoSCoW simplified to Must/Won't only** — dropped the Should Have/Could Have columns
    (both HTML and the `.arch-moscow-col`/`.arch-moscow-cell` CSS); all five areas now default
    to `must` (previously storage/security defaulted to `should`, which no longer exists).
    `buildOpenItems()`'s dead "`could` → flag for confirmation" check removed from
    `generateMarkdown.js` since that value can no longer occur.
  - Final 5 sections, in order: Problem statement + success criteria, MoSCoW (Must/Won't),
    Constraints, Top-3 risks, Design principles.
  - **`generateMarkdown.js`'s architect document is now 9 sections, not 10** (Stakeholder
    Analysis dropped): Executive Summary, Requirements/MoSCoW, Constraints, Design
    Principles, Architecture Overview, Design Decisions, Risk Register, Component
    Specifications, Open Items — plus the Design readiness % blockquote, whose `checks`
    array also dropped the now-permanently-false `!!disc.stakeholders` entry (leaving it in
    would have silently capped every architect-mode doc's readiness score below 100%).
  - Verified: discovery screen renders exactly 5 `.arch-disc-section` blocks, 0 stakeholder
    cards, 2 MoSCoW columns with all rows defaulting to `must`, problem statement and success
    fields share one section, discovery still completes into the wizard correctly, and
    `buildMarkdown()` produces a valid architect doc with no `Stakeholder Analysis` heading
    and no `should`/`could` labels anywhere. Zero console/page errors.
  - **Found and left unfixed, out of scope for this change**: `test-architect-mode.js` (a
    standalone Playwright regression script, not wired into `package.json` or CI) was already
    broken before this change — it fails on its very first `page.click('#mode-learn')` because
    the v1.22.0 prereq-screen gate (see below) hides the mode-select screen until the
    checklist is complete, which the script never fills in. It also hardcodes step numbers
    (`showStep(3/7/8/14)`) that predate the v1.24.0 step consolidation, and references the
    now-removed `.arch-stakeholder-card`/4-column MoSCoW markup. It needs a full rewrite, not
    a patch — flagged here rather than fixed silently since nobody asked for test-suite work.

### v0.6.8-beta (Architect Thinking mode)
- **Three-tier mode system**: Standard (fast wizard) / Learning (onboarding + learn-blocks + scorecard) /
  Architect (Learning PLUS Phase 0 discovery, options analysis, decision log, risk register, architect design doc).
  Architect mode is a secondary toggle (`#learn-arch-toggle`) shown at the bottom of the learn-onboard screen,
  only visible once goal + experience + time are answered (`updateOnboardStart()` toggles `#learn-arch-toggle-wrap`).
- **Architect state** (in `state`): `architectMode` (bool); `discovery` {
  moscow{networking/compute/storage/security/management}, constraints{time/budget/skills/compliance},
  successCriteria, successMeasure, risks[], designPrinciples[] } (originally also had `stakeholders` and a
  separate problem-statement section — removed/merged in v1.27.0, see above); `decisionLog[]`; `riskRegister[]`.
- **Phase 0 discovery** (`#arch-discovery-screen`, full-screen, shown by `showArchDiscovery()` after onboarding when
  architectMode on): originally 7 sections, now 5 as of v1.27.0 (see above). `finishDiscovery()` imports the
  discovery risks into `riskRegister` (source:'discovery'), reveals the sidebar panels, then enters the wizard.
- **Options analysis** (`OPTIONS_ANALYSIS` constant, 4 keys: `router`, `storage`, `nsx`, `clusterSize`):
  full-page overlay (`#arch-options-panel`) shown once per session via `showOptionsAnalysis(key)`. Hooked into
  `showStep()` (as of the v1.24.0 step consolidation: step 3→router, step 6→clusterSize, step 7→nsx) and the
  vSAN toggle (→storage). Confirming logs a decision.
- **Decision log + risk register** sidebar panels (`#arch-decision-log-panel`, `#arch-risk-register-panel`):
  collapsible (`wireArchPanelToggles()`), rendered by `renderDecisionLog()` / `renderRiskRegister()`.
  `addDecision()` appends to log; `addAutoRisk()` dedupes by description. `detectDesignRisks()`
  (wired by `wireArchitectWizardSteps()` on nestedHostCount / vramPerHostGB / nsxEnabled / mgmtVlan / vsanEnabled)
  auto-detects: single-host SPOF, >85% RAM overcommit, vSAN < 3 hosts, NSX without BGP, untagged management VLAN.
- **generateMarkdown.js**: when `spec.architectMode && spec.learningMode`, emits an architect document (originally
  10 sections, now 9 as of v1.27.0 — Stakeholder Analysis removed: Executive Summary, Requirements/MoSCoW,
  Constraints, Design Principles, Architecture Overview, Design Decisions, Risk Register, Component
  Specifications, Open Items) plus a **Design readiness %**
  blockquote. Takes priority over the learning-mode Design Rationale block (`else if (spec.learningMode)`).
- **generateSpec.js**: adds `architectMode`, `discovery`, `decisionLog`, `riskRegister` to the spec.
- **Wizard → server**: `wireGenerate()` posts `architectMode`, `discovery`, `decisionLog`, `riskRegister`.

### v0.6.6-beta (pre-v1.0 security audit)
- **Server binding**: `app.listen` now binds to `127.0.0.1` only (was `0.0.0.0`)
- **Admin endpoint protection**: `requireLocalhost` middleware added to all `/api/admin/*` routes; rejects non-loopback connections with 403
- **Path traversal fix**: `saveScenario` now validates `verifyScript` field with `^[a-zA-Z0-9-]+\.ps1$`; admin-verify re-validates the filename before `path.join` + `spawnSync` — blocks malicious `.labscenario` imports
- **Sensitive field stripping**: `rootPassword`, `esxiPassword`, `esxiLicense`, `vcenterLicense` stripped from spec before returning in `/api/generate` response
- **Debrief response cleaned**: `verifyScript` filename removed from `/api/troubleshoot/debrief` response
- **XSS hardening**: resource tip rendering replaced with `setRichText()` helper (only `<code>` elements permitted); mermaid diagram preview switched from `innerHTML = svg` to `DOMParser` + `document.adoptNode`
- **Client cleanup**: `console.error` removed from debrief error path in `wizard.js`
- **Housekeeping**: `scenarios/active.json` added to `.gitignore`; `package.json` version updated from `0.2.0` to `0.6.5`

---

## Coding conventions

- No frontend framework. All state in a plain `state` object in `wizard.js`.
- No build step. `public/` is served as-is.
- Server endpoints never trust client data — `validateAnswers()` runs on every generate.
- NSX configuration via REST (`Invoke-RestMethod`) — no full PowerCLI NSX module.
- `depotStepVisible()` is the canonical gating function; depot step only appears when
  vSAN is on AND local_datastore is a storage type in the spec.
- Step visibility in `showStep()` uses `TOTAL_STEPS - 2` for the review step index so
  the troubleshooting step can follow without hardcoding.
- Troubleshooting endpoints intentionally not in README, UI text, or any error messages.
- `mermaid` is a **direct** dependency (`package.json`), not just a transitive
  devDependency of `@mermaid-js/mermaid-cli` — it must survive `npm install
  --production` so `/vendor/mermaid.min.js` (served by `server.js`, consumed by both
  `public/index.html`'s review-screen preview and `public/diagram.html`) works regardless
  of how the app is packaged. `mermaid-cli` itself (needed only for server-side SVG export
  via `mmdc`) stays devDependency-only — `renderSvg()` already degrades gracefully when
  `mmdc` isn't found (e.g. inside the standalone `pkg` executable, which can't bundle it).
- `spec.diagramOverride` (string, optional) — a hand-edited Mermaid source saved via
  `POST /api/diagram/:id/save` from `/diagram`'s edit mode. When present, it takes
  priority over `buildMermaidDiagram(spec)` everywhere a diagram is produced for that
  session (`GET /api/diagram/:id`, `POST /api/diagram/from-spec` when the override rode
  along in an uploaded spec.json, and the session's `diagram.html`/`network-diagram.svg`
  download artifacts, regenerated at save time).
- Server binds to `127.0.0.1` by default — never `0.0.0.0`. All `/api/admin/*` routes
  are additionally protected by `requireLocalhost` middleware as defence-in-depth.
  (Docker support — and the `HOST=0.0.0.0` / `ADMIN_ENABLED=false` exception it needed —
  was removed; see the v1.20.0/v1.21.x roadmap entries below for that history.)
- `saveScenario` and the admin-verify endpoint both validate `verifyScript` filenames
  with `^[a-zA-Z0-9-]+\.ps1$` to prevent path traversal via imported `.labscenario` files.
- Sensitive spec fields (`rootPassword`, `esxiPassword`, `esxiLicense`, `vcenterLicense`)
  are stripped before the spec is returned to the browser in the generate response.
- `setRichText(el, html)` in `wizard.js` is the safe alternative to `innerHTML` for
  strings that need `<code>` formatting — all other tags are rendered as plain text.
- Learning mode state lives in `state.learningMode` (bool) and `state.designRationale` (object).
  Toggled at startup by `wireModeSelect()`. Per-step learn-blocks are shown/hidden in `showStep()`.
- Architecture scorecard (`renderScorecard()`) and anti-pattern detection (`collectAntiPatterns()`)
  run entirely in the browser on step 14; a server-side mirror in `generateMarkdown.js`
  (`assessArchitecture`, `collectAntiPatterns`) reproduces the same logic for the design doc.
- Troubleshoot learning mode: `state.troubleshootLearningMode` set in phase 0; methodology
  prompts wired in `tsWirePhase3()`; enhanced debrief built by `tsBuildLearnDebrief(data)`.
- DC profile state: `g.dcProfile` (`'none'`|`'dc-only'`|`'dc-jumpbox'`|`'dc-jumpbox-fileserver'`).
  All old `g.dcEnabled` references replaced. Sizing uses `DC_RAM_GB_BY_PROFILE[g.dcProfile]`
  in `wizard.js` and `DC_VCPU_BY_PROFILE` / `DC_VRAM_GB_BY_PROFILE` in `lib/sizing.js`.
- Study plan helpers: `tsGetCompleted()` / `tsSetCompleted(id, done)` read/write `'vsphere-completed-scenarios'`
  localStorage key (JSON array of IDs). `tsRenderStudyPlan()` is the full render function.
- Cert codes (10, canonical): `VCP-VCF-Architect`, `VCP-VCF-Admin`, `VCP-VCF-Support`,
  `VCP-VVF-Admin`, `VCP-VVF-Support`, `VCAP-VCF-Automation`, `VCAP-VCF-Operations`,
  `VCAP-VCF-Storage`, `VCAP-VCF-VKS`, `VCAP-VCF-Networking`.
- Save/resume key: `vsphere-wizard-autosave` (localStorage). Save format: `_type` `wizard-config` | `lab-template`, `_version:1`, `_savedAt` ISO, `_step`, mode flags, `answers`, `designRationale`, `discovery`, `decisionLog`, `riskRegister`.
- `_onFormChange` — module-level reference to the real `onChange` inside `wireForm()`. Must be used (not `() => {}`) when calling render functions from outside wireForm so dynamic list elements stay wired.
