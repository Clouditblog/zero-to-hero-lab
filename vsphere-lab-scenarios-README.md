# vsphere-lab-scenarios

Community-contributed scenario library for [zero-to-hero-lab](https://github.com/redeye365/zero-to-hero-lab).

Each scenario is a pre-built lab fault that a vSphere engineer must diagnose and fix. When loaded via the Admin panel the lab automatically reverts to a saved vCenter snapshot — the troubleshooter sees only a support ticket, investigates the live environment, and fixes it for real. No walkthroughs, no safety net.

---

## How scenarios work

1. The **lab admin** loads a scenario from the Admin panel in `zero-to-hero-lab`
2. The wizard reverts all lab VMs to the named vCenter snapshot (the faulted state)
3. The **troubleshooter** opens the Troubleshooter tab and accepts the scenario
4. They receive a fictional support ticket — everything else they have to find themselves
5. When they believe the fault is fixed, the verify script runs and returns a pass/fail

---

## Using these scenarios

### Import a single scenario

1. Download the `.labscenario` file for the scenario you want
2. Open `zero-to-hero-lab` → Troubleshooting tab → Admin → Scenario Library
3. Click **Import .labscenario** and select the file
4. Click **Capture** to create a vCenter snapshot in the faulted state (follow the scenario's setup notes)
5. The scenario is ready to load

### Clone the whole library

```bash
git clone git@github.com:redeye365/vsphere-lab-scenarios.git
```

Copy any `.labscenario` files you want into your wizard's import flow, or use the directory structure below directly with your own wrapper.

---

## Starter scenarios

Ten scenarios ship with zero-to-hero-lab. They are reproduced here as a baseline and reference for contributors.

| ID | Name | Difficulty | Topics | Requires |
|----|------|-----------|--------|---------|
| `bgp-as-mismatch` | BGP AS Number Mismatch | Medium | bgp, nsx-routing | NSX-T, VyOS, 3+ nested hosts |
| `mgmt-vlan-mismatch` | Management VLAN Mismatch | Medium | vsphere-networking | 2+ nested hosts |
| `ssh-service-policy` | SSH Service Policy Wrong | Easy | security, esxi-services | 1+ nested host |
| `dns-ptr-missing` | DNS PTR Records Missing | Medium | dns, active-directory | DC, nested hosts |
| `ntp-source-mismatch` | NTP Source Mismatch | Easy | ntp, esxi-config | 1+ nested host |
| `hosts-file-ordering` | Hosts File Duplicate Entry | Hard | dns, esxi-config | 1+ nested host |
| `ssl-cert-localhost` | SSL Certificate Shows localhost | Medium | certificates, vcenter | vCenter, nested hosts |
| `dvs-profile-custom` | DVS Teaming Policy Set to Custom | Medium | vsphere-networking, dvs | DVS, 2+ nested hosts |
| `monitor-allow-legacy-cpu` | monitor.allowLegacyCPU Missing | Easy | esxi-config, vm-compatibility | 1+ nested host, legacy CPU VM |
| `local-datastore-missing` | Local Datastore Missing Before vSAN | Hard | vsan, esxi-storage | vSAN, 3+ nested hosts |

---

## Scenario format

Each scenario lives in its own directory:

```
scenarios/
  bgp-as-mismatch/
    scenario.json
    verify.ps1
```

### scenario.json

```json
{
  "id": "bgp-as-mismatch",
  "name": "BGP AS Number Mismatch",
  "description": "T0 BGP peer is down due to AS number mismatch between NSX-T and VyOS",
  "difficulty": "easy | medium | hard",
  "examObjectives": ["VCP-VCF-Admin", "VCAP-VCF-Networking"],
  "topics": ["bgp", "nsx-routing"],
  "author": "your-github-handle",
  "created": "2026-06-01",
  "labRequirements": ["nsx", "vyos", "nested-cluster-min-3"],

  "customerScenario": "The initial support ticket text the troubleshooter receives. Write as a realistic user — not a technician. Don't mention the fault directly. Include timing ('30 minutes ago') and symptoms ('can't reach anything external') without giving the cause away.",

  "customerFollowUp": "A one-time clue the troubleshooter can request once. Drops a hint about the cause without spelling it out — 'one of the engineers was doing some cleanup on the VyOS config last night'.",

  "snapshotName": "",

  "verifyScript": "verify-bgp-as-mismatch.ps1",

  "fixSteps": [
    "Step-by-step fix for the debrief screen. Be specific — include commands, menu paths, expected output.",
    "Each string is one numbered step."
  ],

  "hints": [
    "Level 1 — very broad. Directs attention to the right layer (routing, networking, storage). No specific component.",
    "Level 2 — points to the right component (T0, DVS, ESXi service). Still no specific field or value.",
    "Level 3 — tells them where to look in the UI or CLI. No answer yet.",
    "Level 4 — describes what they will see when they look (the wrong value vs the expected value). They still have to find and fix it.",
    "Level 5 — exact command or click sequence to fix it. Full spoiler."
  ]
}
```

#### Field reference

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Kebab-case, unique across the repo. Becomes the filename. |
| `name` | yes | Short, title-case. Shown in the scenario picker. |
| `description` | yes | One sentence. Describes the fault, not the symptom. Shown in the library card. |
| `difficulty` | yes | `easy` / `medium` / `hard` — see calibration notes below |
| `examObjectives` | no | VCP/VCAP objectives this fault covers. Helps learners map study material. |
| `certRelevance` | yes | Array of current Broadcom cert IDs this scenario maps to (see values below). Every scenario must have at least one. |
| `learningObjectives` | yes | Array of 2–4 short strings describing what the learner practises. Shown on the scenario card. |
| `topics` | yes | Kebab-case tags. Used for filtering in the library. |
| `author` | yes | Your GitHub handle or `"Zero to Hero Lab starter library"` |
| `created` | yes | ISO date `YYYY-MM-DD` |
| `labRequirements` | yes | See requirements list below |
| `customerScenario` | yes | Ticket text. Stay in character — this is the user's call. |
| `customerFollowUp` | yes | One-time clue. Should narrow it down but not reveal the answer. |
| `snapshotName` | yes | Leave blank `""` — set by each admin when they capture the snapshot |
| `verifyScript` | yes | Filename of the accompanying `.ps1` |
| `fixSteps` | yes | Array of strings. Step 1 onwards. Used on the debrief screen. |
| `hints` | yes | Exactly 5 strings, progressive from broad to exact. |

#### certRelevance values

Use only these exact strings (current Broadcom certs as of June 2026):

| Value | Certification | Exam |
|-------|--------------|------|
| `VCP-VCF-Architect` | VCP — VMware Cloud Foundation Architect | 2V0-13.25 |
| `VCP-VCF-Admin` | VCP — VMware Cloud Foundation Administrator | 2V0-17.25 |
| `VCP-VCF-Support` | VCP — VMware Cloud Foundation Support | 2V0-15.25 |
| `VCP-VVF-Admin` | VCP — VMware vSphere Foundation Administrator | 2V0-16.25 |
| `VCP-VVF-Support` | VCP — VMware vSphere Foundation Support | 2V0-18.25 |
| `VCAP-VCF-Automation` | VCAP — VMware Cloud Foundation Automation | 3V0-21.25 |
| `VCAP-VCF-Operations` | VCAP — VMware Cloud Foundation Operations | 3V0-22.25 |
| `VCAP-VCF-Storage` | VCAP — VMware Cloud Foundation Storage | 3V0-23.25 |
| `VCAP-VCF-VKS` | VCAP — VMware Cloud Foundation VKS | 3V0-24.25 |
| `VCAP-VCF-Networking` | VCAP — VMware Cloud Foundation Networking | 3V0-25.25 |

Assignment guidance:
- Basic vSphere / HA / DRS / vMotion / vSAN → `VCP-VVF-Admin`; advanced storage design → add `VCAP-VCF-Storage`
- NSX / DFW / T0/T1 / BGP / overlay → `VCP-VCF-Admin`; advanced networking design → add `VCAP-VCF-Networking`
- VCF / SDDC Manager / Cloud Builder → `VCP-VCF-Admin`; architecture-focused → add `VCP-VCF-Architect`
- VCF troubleshooting / log analysis / support → add `VCP-VCF-Support`
- Automation / IaC / day-2 workflows → `VCAP-VCF-Automation`
- Monitoring / capacity / performance → `VCAP-VCF-Operations`
- Kubernetes / containers / TKG → `VCAP-VCF-VKS`
- Multi-component scenarios → all relevant certs

---

#### Difficulty calibration

| Level | Meaning |
|-------|---------|
| `easy` | Single configuration value in an obvious location. A VCP candidate should find it in under 10 minutes. |
| `medium` | Requires correlating two or more systems (e.g. NSX + VyOS, or vCenter + ESXi). Takes 15–30 minutes. |
| `hard` | Non-obvious root cause, requires log diving or knowledge of rarely-seen failure modes. 30+ minutes. |

#### Lab requirements

Use these standard tags. PRs with new tags will be reviewed.

| Tag | Meaning |
|-----|---------|
| `nsx` | NSX-T Manager deployed and configured |
| `vyos` | VyOS router deployed and BGP configured |
| `nested-cluster-min-1` | At least 1 nested ESXi host |
| `nested-cluster-min-2` | At least 2 nested ESXi hosts |
| `nested-cluster-min-3` | At least 3 nested ESXi hosts (minimum for vSAN) |
| `vsan` | vSAN cluster healthy before fault injection |
| `active-directory` | Domain controller deployed and joined |
| `vcenter` | vCenter deployed (always true for zero-to-hero-lab labs, but call it out if the fault affects vCenter itself) |

---

### verify.ps1

The verify script is run by the wizard after the troubleshooter clicks "I've fixed it". It must exit cleanly and print exactly one of:

| Output | Meaning |
|--------|---------|
| `FAULT_RESOLVED` | Fix is confirmed — proceed to debrief |
| `FAULT_PRESENT` | Fault is still present — troubleshooter stays in investigation phase |
| `ERROR: <message>` | Script couldn't check (connectivity issue, wrong credentials) — shown to admin |

The script should be **read-only** — check state, never apply fixes.

```powershell
# verify-bgp-as-mismatch.ps1
# Returns FAULT_PRESENT if the T0 BGP peer is not Established, FAULT_RESOLVED if it is.

param(
    [string]$NSXManager  = "192.168.10.20",
    [string]$NSXUser     = "admin",
    [string]$NSXPassword = "VMware1!VMware1!",
    [switch]$SkipCertCheck
)

if ($SkipCertCheck) {
    $PSDefaultParameterValues['Invoke-RestMethod:SkipCertificateCheck'] = $true
}

$auth    = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${NSXUser}:${NSXPassword}"))
$headers = @{ Authorization = "Basic $auth"; "Content-Type" = "application/json" }

try {
    $t0s  = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/logical-routers?router_type=TIER0" -Headers $headers
    $t0Id = $t0s.results[0].id

    $bgp  = Invoke-RestMethod -Uri "https://$NSXManager/api/v1/logical-routers/$t0Id/routing/bgp/neighbors/status" -Headers $headers

    $allUp = $bgp.results | ForEach-Object { $_.connection_state } | Where-Object { $_ -ne "ESTABLISHED" }
    if ($allUp.Count -eq 0) { Write-Output "FAULT_RESOLVED" } else { Write-Output "FAULT_PRESENT" }
} catch {
    Write-Output "ERROR: $_"
    exit 2
}
```

**Tips for verify scripts:**
- Hardcode sensible defaults for `$NSXManager`, `$NSXPassword`, etc. — the admin pastes in their real values when editing the scenario
- Always catch exceptions and emit `ERROR:` rather than letting the script crash
- Keep it fast — the troubleshooter is waiting on this
- Target pwsh (PowerShell 7+) — use `-SkipCertificateCheck` on `Invoke-RestMethod`, not the legacy workaround

---

## .labscenario bundle format

When you export a scenario from zero-to-hero-lab it produces a `.labscenario` file. This is a plain JSON envelope:

```json
{
  "version": "1",
  "scenario": { ... scenario.json fields ... },
  "verifyScript": "# full PS1 source as a string"
}
```

If you're contributing to this repo, submit the source files (`scenario.json` + `verify.ps1`) in a directory, not the bundle. The bundle format is for end-to-end portability between lab wizard instances.

---

## Contributing

### Before you start

- Test your scenario end-to-end in a real zero-to-hero-lab lab
- The fault must be something a **vSphere engineer** would realistically encounter in production
- The verify script must return `FAULT_RESOLVED` reliably after the correct fix and `FAULT_PRESENT` reliably before it
- The five hints must graduate — hint 1 should not give away anything hint 3 would

### PR checklist

- [ ] New directory under `scenarios/<your-id>/`
- [ ] `scenario.json` — all required fields populated
- [ ] `verify.ps1` — tested and returns `FAULT_RESOLVED` / `FAULT_PRESENT` correctly
- [ ] Difficulty is calibrated against the table above
- [ ] `labRequirements` uses standard tags
- [ ] `snapshotName` is left as `""`
- [ ] No credentials, real IP addresses, or lab-specific values hardcoded — use the param defaults
- [ ] PR description includes: what the fault is, which layer it affects, how the verify script checks it

### What makes a good scenario

**Good:** A misconfigured NTP source that causes certificate validation failures two days after deployment (non-obvious, requires log correlation, time-sensitive).

**Not good:** "Delete a VM and see if they notice." (No diagnostic skill required.)

**Good:** A DVS uplink teaming policy set to `Use Explicit Failover Order` with the wrong active adapter (breaks vMotion in a way that's not immediately obvious from vCenter alarms).

**Not good:** A typo in a VM name. (Trivial, no investigation needed.)

The best scenarios teach a genuine diagnostic pattern — the kind of thing you'd want a junior engineer to know how to find independently next time.

---

## Licence

MIT. Do whatever you want with the scenarios. If you publish a derivative library, a mention is appreciated but not required.
