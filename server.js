// server.js
//
// Local-only server for Zero to Hero Lab. Run with `npm start`,
// then open http://localhost:3000

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');

// pkg bundles the app as a standalone executable. Detect that mode so we can
// resolve writable output dirs relative to the executable rather than __dirname
// (which points into the read-only snapshot FS when running under pkg).
const IS_PKG = typeof process.pkg !== 'undefined';
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

// Windows PowerShell 5.1 (powershell.exe, still the default on most Windows
// machines) reads .ps1 files with no BOM using the system's ANSI codepage,
// not UTF-8. Any non-ASCII character we emit (em dashes, etc.) then gets
// mis-decoded byte-by-byte, and if one of those stray bytes happens to land
// on a quote/brace character in that codepage, the script fails to parse --
// with an error that looks like a random "missing quote terminator" deep in
// the file. A UTF-8 BOM makes both powershell.exe and pwsh (Core) detect the
// encoding correctly regardless of system codepage. Only .ps1 needs this --
// .sh scripts must NOT get a BOM (it breaks shebang detection), and
// .json/.md/etc. readers already handle UTF-8 without one just fine.
const UTF8_BOM = '\uFEFF';
function writeGeneratedFile(dir, filename, content) {
  const withBom = filename.endsWith('.ps1') ? UTF8_BOM + content : content;
  fs.writeFileSync(path.join(dir, filename), withBom);
}

// ── Fatal startup error handling ───────────────────────────────────────────
// On Windows, double-clicking the .exe (or a scheduled task) gives the user no
// terminal to read a stack trace from — the console window can close before
// they see anything. Show a blocking message box instead of failing silently.
function logCrash(message) {
  try {
    fs.writeFileSync(path.join(BASE_DIR, 'crash.log'), `${new Date().toISOString()}\n${message}\n`);
  } catch { /* best effort only */ }
}

// Shows a native Windows message box via PowerShell. The message is passed over
// stdin (read with Console.In.ReadToEnd()) so error text never has to be escaped
// into the PowerShell command line. No-op on non-Windows platforms.
function showWindowsErrorBox(title, message) {
  if (process.platform !== 'win32') return;
  try {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `[System.Windows.Forms.MessageBox]::Show([Console]::In.ReadToEnd(), '${title.replace(/'/g, "''")}', 'OK', 'Error') | Out-Null`
    ].join('\n');
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      input: message,
      timeout: 120000
    });
  } catch { /* best effort only — never let error reporting crash the process */ }
}

function fatalError(err) {
  const message = (err && err.stack) || String(err);
  console.error('Fatal error during startup:', message);
  logCrash(message);
  showWindowsErrorBox(
    'Zero to Hero Lab — Startup Error',
    `The wizard failed to start.\n\n${message}\n\nDetails were written to:\n${path.join(BASE_DIR, 'crash.log')}`
  );
  process.exit(1);
}

process.on('uncaughtException', fatalError);
process.on('unhandledRejection', (reason) => fatalError(reason instanceof Error ? reason : new Error(String(reason))));

// ── Troubleshoot session store ─────────────────────────────────────────────
// token → { scenario, createdAt, clueUsed, ticket, hintsGiven }
const tsSessions = new Map();

setInterval(() => {
  const cutoff = Date.now() - 7200000; // 2 hours
  for (const [token, session] of tsSessions) {
    if (session.createdAt < cutoff) tsSessions.delete(token);
  }
}, 300000); // prune every 5 minutes

const { buildSpec } = require('./lib/generateSpec');
const { buildPowerShellScripts, buildRdpFile, buildLabConfigExample, buildLabConfigFromSpec } = require('./lib/generatePowerShell');
const { buildMarkdown } = require('./lib/generateMarkdown');
const { buildBuildGuide } = require('./lib/generateBuildGuide');
const { buildPrerequisites } = require('./lib/generatePrerequisites');
const { buildDepotFiles } = require('./lib/generateDepot');
const { buildNsxScripts } = require('./lib/generateNsx');
const { buildVcfFiles }  = require('./lib/generateVcf');
const { buildVisDeploy } = require('./lib/generateVis');
const { buildKickstartFiles, buildKickstartForHost } = require('./lib/generateKickstart');
const { buildMermaidDiagram } = require('./lib/generateNetworkDiagram');
const { buildDiagramHtml } = require('./lib/generateDiagramHtml');
const { evaluateSizing } = require('./lib/sizing');
const { loadScenarios, getScenario, saveScenario, deleteScenario, getVerifyScript, saveVerifyScript, getActive, setActive, nameToId } = require('./lib/scenarioLibrary');
const { loadTemplates } = require('./lib/templateLibrary');
const { validateAnswers } = require('./lib/validateAnswers');
const { revertAllToSnapshot, createSnapshotsOnAllVMs, testConnection: vcenterTestConnection } = require('./lib/vcenterClient');
const vcenterConfig = require('./lib/vcenterConfig');

// Locate mmdc (mermaid-cli) — checks local node_modules first, then PATH.
// Returns the path string if found and executable, otherwise null.
function findMmdc() {
  const candidates = [
    path.join(__dirname, 'node_modules', '.bin', 'mmdc'),
    'mmdc'
  ];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['--version'], { timeout: 5000, encoding: 'utf8' });
    if (result.status === 0) return cmd;
  }
  return null;
}

const MMDC = findMmdc();
if (MMDC) {
  console.log('Network diagram: SVG generation enabled (mmdc found)');
} else {
  // mmdc/mermaid-cli uses Puppeteer (headless Chromium) and cannot be bundled
  // into the standalone executable — it must be installed separately.
  // The Mermaid diagram source is always included in build-guide.md regardless.
  const installHint = IS_PKG
    ? 'npm install -g @mermaid-js/mermaid-cli'
    : 'npm install (already in devDependencies) or npm install -g @mermaid-js/mermaid-cli';
  console.log(`Network diagram: SVG export unavailable — mmdc not found.`);
  console.log(`  The Mermaid diagram source is included in build-guide.md and can be`);
  console.log(`  pasted into mermaid.live for a visual preview.`);
  console.log(`  To enable SVG export: ${installHint}`);
}

// mmdc config: htmlLabels false, matching public/wizard.js and public/diagram.html.
// Without this, mermaid's default renders multi-line node labels ("name\nrole\nip")
// as an HTML <br> inside a foreignObject instead of an SVG <tspan>; mermaid doesn't
// self-close that <br>, which is invalid XML. The exported network-diagram.svg is
// opened directly by browsers using a strict XML parser, so a malformed file shows
// a parser error instead of the diagram -- same underlying bug as the client-side
// preview, fixed the same way here for the file mmdc writes to disk.
const MMDC_CONFIG_PATH = path.join(os.tmpdir(), 'zero-to-hero-mermaid-config.json');
try {
  fs.writeFileSync(MMDC_CONFIG_PATH, JSON.stringify({ flowchart: { htmlLabels: false } }), 'utf8');
} catch { /* ignore -- falls back to mermaid defaults if this couldn't be written */ }

// Self-close any bare void HTML tag (<br>, <img>, <hr>, <input>, <meta>, <link>) left in
// an SVG string. Mermaid's HTML labels can leave these unclosed -- valid loose HTML,
// invalid XML -- and browsers open a standalone .svg file with a strict XML parser, so a
// malformed file fails to render at all (blank page) instead of just looking odd.
// Idempotent: already-self-closed tags pass through unchanged. Same fix as
// public/wizard.js's fixSvgVoidTags(), duplicated here since this runs server-side.
function fixSvgVoidTags(svgStr) {
  return svgStr.replace(/<(br|img|hr|input|meta|link)((?:\s[^>]*)?)\/?>/gi, (m, tag, attrs) => {
    const cleanAttrs = attrs.replace(/\/\s*$/, '');
    return `<${tag}${cleanAttrs}/>`;
  });
}

// Attempt to render a Mermaid string to SVG via mmdc.
// Returns true if the SVG was written, false otherwise.
function renderSvg(mermaidContent, outputPath) {
  if (!MMDC) return false;
  const tmpInput = path.join(os.tmpdir(), `mermaid-${Date.now()}.mmd`);
  try {
    fs.writeFileSync(tmpInput, mermaidContent, 'utf8');
    const args = ['-i', tmpInput, '-o', outputPath, '--theme', 'neutral', '--quiet'];
    if (fs.existsSync(MMDC_CONFIG_PATH)) args.push('-c', MMDC_CONFIG_PATH);
    const result = spawnSync(MMDC, args, { timeout: 30000 });
    const ok = result.status === 0 && fs.existsSync(outputPath);
    if (ok) {
      try {
        const raw = fs.readFileSync(outputPath, 'utf8');
        fs.writeFileSync(outputPath, fixSvgVoidTags(raw), 'utf8');
      } catch { /* ignore -- file still written by mmdc, just not post-processed */ }
    }
    return ok;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpInput); } catch { /* ignore */ }
  }
}

const app = express();
// PORT env var (if set) is used as-is — no fallback. Otherwise try 3000, then
// 3001, 3002 in case something else on the machine already holds the default
// (e.g. another local dev server, common on Windows boxes running multiple tools).
const CANDIDATE_PORTS = process.env.PORT ? [parseInt(process.env.PORT, 10)] : [3000, 3001, 3002];
const HOST = process.env.HOST || '127.0.0.1';

const OUTPUT_DIR = path.join(BASE_DIR, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve mermaid.js locally so wizard pages don't depend on CDN. `mermaid` is a direct
// dependency (not just a transitive devDependency of mermaid-cli) specifically so this
// file survives `npm install --production` -- otherwise the Docker image would 404 here
// and both the review-screen preview and /diagram would silently fail to render.
app.get('/vendor/mermaid.min.js', (req, res) => {
  const localPath = path.join(__dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  if (fs.existsSync(localPath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(localPath);
  } else {
    res.status(404).send('mermaid not found');
  }
});

// Static files always present in every output
const FIXED_OUTPUT_FILES = {
  spec:              'lab-spec.json',
  'design-doc':      'design-doc.md',
  'build-guide':     'build-guide.md',
  'prerequisites':   'PREREQUISITES.md',
  'network-diagram': 'network-diagram.svg',
  'diagram-html':    'diagram.html',
  'lab-config':         'lab-config.json',
  'lab-config-example': 'lab-config.json.example'
};

// Dynamic script filenames -- the key is the download URL kind
const SCRIPT_KINDS = {
  'deploy-lab':          'deploy-lab.ps1',
  'vyos-deploy':         'vyos-deploy.ps1',
  'vyos-config':         'vyos-config.txt',
  'dc-deploy':           'dc-deploy.ps1',
  'vcenter-deploy':      'vcenter-deploy.ps1',
  'vsan-cluster':        'vsan-cluster.ps1',
  'deploy-workloads':    'deploy-workloads.ps1',
  'jumpbox-deploy':      'jumpbox-deploy.ps1',
  'wireguard-server':    'wireguard-server.sh',
  'vyos-site-to-site':   'vyos-site-to-site.conf',
  'memory-tiering':      'configure-memory-tiering.ps1',
  'depot-deploy':        'depot-deploy.ps1',
  'depot-configure':     'depot-configure.sh',
  'depot-iis':           'depot-iis.ps1',
  'depot-instructions':  'depot-instructions.md',
  'nsx-deploy':          'nsx-deploy.ps1',
  'nsx-configure':       'nsx-configure.ps1',
  'nsx-bgp':             'nsx-bgp.ps1',
  'vis-deploy':          'vis-deploy.ps1'
};

const ALL_OUTPUT_FILES = { ...FIXED_OUTPUT_FILES, ...SCRIPT_KINDS };

app.post('/api/generate', (req, res) => {
  try {
    const answers = req.body || {};

    const validationErrors = validateAnswers(answers);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const sizing = evaluateSizing(answers);
    const spec = buildSpec(answers, sizing);
    const id = crypto.randomBytes(4).toString('hex');
    const dir = path.join(OUTPUT_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const scripts = buildPowerShellScripts(spec, id);
    const designDoc = buildMarkdown(spec);
    const buildGuide = buildBuildGuide(spec);

    const prerequisites = buildPrerequisites(spec);
    const depotFiles = buildDepotFiles(spec);
    const generatedScripts = [];

    fs.writeFileSync(path.join(dir, 'lab-spec.json'), JSON.stringify(spec, null, 2));
    fs.writeFileSync(path.join(dir, 'design-doc.md'), designDoc);
    fs.writeFileSync(path.join(dir, 'build-guide.md'), buildGuide);
    fs.writeFileSync(path.join(dir, 'PREREQUISITES.md'), prerequisites);
    fs.writeFileSync(path.join(dir, 'lab-config.json'), buildLabConfigFromSpec(spec));
    fs.writeFileSync(path.join(dir, 'lab-config.json.example'), buildLabConfigExample());

    // Attempt SVG network diagram (requires mmdc / @mermaid-js/mermaid-cli)
    const mermaidDiagram = buildMermaidDiagram(spec);
    const svgGenerated = renderSvg(mermaidDiagram, path.join(dir, 'network-diagram.svg'));

    // Standalone diagram.html (renders from CDN, no server required)
    fs.writeFileSync(path.join(dir, 'diagram.html'), buildDiagramHtml(spec, mermaidDiagram));

    // Write each generated PowerShell/bash script
    for (const [filename, content] of Object.entries(scripts)) {
      writeGeneratedFile(dir, filename, content);
      const kind = Object.entries(SCRIPT_KINDS).find(([, fn]) => fn === filename)?.[0];
      if (kind) generatedScripts.push(kind);
    }

    // Depot files (only when depot is enabled and conditions met in spec)
    for (const [filename, content] of Object.entries(depotFiles)) {
      writeGeneratedFile(dir, filename, content);
      const kind = Object.entries(SCRIPT_KINDS).find(([, fn]) => fn === filename)?.[0];
      if (kind) generatedScripts.push(kind);
    }

    // NSX scripts (only when NSX is enabled)
    const nsxFiles = buildNsxScripts(spec);
    for (const [filename, content] of Object.entries(nsxFiles)) {
      writeGeneratedFile(dir, filename, content);
      const kind = Object.entries(SCRIPT_KINDS).find(([, fn]) => fn === filename)?.[0];
      if (kind) generatedScripts.push(kind);
    }

    // VCF bring-up files (only when VCF is enabled)
    const vcfFiles = buildVcfFiles(spec);
    for (const [filename, content] of Object.entries(vcfFiles)) {
      writeGeneratedFile(dir, filename, content);
    }

    // Kickstart files (ISO-based deploys only)
    const ksFiles = buildKickstartFiles(spec);
    for (const [filename, content] of Object.entries(ksFiles)) {
      fs.writeFileSync(path.join(dir, filename), content);
    }

    // RDP file for DC+Jumpbox and DC+Jumpbox+FileServer profiles
    const rdpContent = buildRdpFile(spec.domainController);
    if (rdpContent) {
      fs.writeFileSync(path.join(dir, 'lab-dc.rdp'), rdpContent);
    }

    // VIS appliance deploy script (only when the VIS Appliance DC/infra option is selected)
    const visDeployContent = buildVisDeploy(spec);
    if (visDeployContent) {
      writeGeneratedFile(dir, 'vis-deploy.ps1', visDeployContent);
      generatedScripts.push('vis-deploy');
    }

    // Strip sensitive fields before returning spec to browser — rootPassword and
    // VCF passwords are written to files on disk and not needed in the response.
    const { nestedCluster: nc, vcf: vcfSection, ...restSpec } = spec;
    const { rootPassword: _rp, ...safeNc } = nc || {};
    const { esxiPassword: _ep, esxiLicense: _el, vcenterLicense: _vl, ...safeVcf } = vcfSection || {};
    const safeSpec = { ...restSpec, nestedCluster: safeNc, vcf: safeVcf };

    res.json({
      id,
      warnings: sizing.warnings,
      spec: safeSpec,
      markdownPreview: designDoc,
      svgGenerated,
      generatedScripts
    });
  } catch (err) {
    console.error('Generate failed:', err.message);
    res.status(500).json({ error: 'Generation failed. Check the server log for details.' });
  }
});

// Serve per-host ks.cfg files for kickstart unattended ESXi install.
// URL format: GET /api/ks/:sessionId/:hostIndex  (hostIndex is 1-based)
// Intended for use at the ESXi boot menu: press Shift+O and append
//   ks=http://<wizard-machine-ip>:3000/api/ks/<sessionId>/<hostIndex>
app.get('/api/ks/:id/:hostIndex', (req, res) => {
  const { id, hostIndex } = req.params;
  if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).send('Invalid session id');
  const idx = parseInt(hostIndex, 10);
  if (!Number.isFinite(idx) || idx < 1 || idx > 64) return res.status(400).send('Invalid host index');

  const specPath = path.join(OUTPUT_DIR, id, 'lab-spec.json');
  if (!fs.existsSync(specPath)) return res.status(404).send('Session not found');

  try {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const content = buildKickstartForHost(spec, idx);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `inline; filename="ks-esxi-${String(idx).padStart(2, '0')}.cfg"`);
    res.send(content);
  } catch (err) {
    res.status(500).send('Failed to generate ks.cfg');
  }
});

app.get('/api/download/:id/:kind', (req, res) => {
  const { id, kind } = req.params;

  if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).send('Invalid id');
  const filename = ALL_OUTPUT_FILES[kind];
  if (!filename) return res.status(404).send('Unknown file kind');

  const filePath = path.join(OUTPUT_DIR, id, filename);

  // Defense in depth: verify the resolved path hasn't escaped OUTPUT_DIR.
  // The regex on id and allowlist on kind already prevent this, but be explicit.
  const resolvedOutput = path.resolve(OUTPUT_DIR);
  if (!path.resolve(filePath).startsWith(resolvedOutput + path.sep)) {
    return res.status(400).send('Invalid path');
  }

  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  res.download(filePath, filename);
});

// GET /api/templates — pre-built lab templates offered on the "Start from
// template" mode-select screen. Public (no requireLocalhost gate) since the
// files ship read-only with the app and contain no secrets by construction.
app.get('/api/templates', (req, res) => {
  res.json(loadTemplates());
});

// ── Diagram endpoints ──────────────────────────────────────────────────────

// GET /api/diagram/:id — returns { mermaid: "...", spec: {...} } for a saved output
app.get('/api/diagram/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const specPath = path.join(OUTPUT_DIR, id, 'lab-spec.json');
  const resolvedOutput = path.resolve(OUTPUT_DIR);
  if (!path.resolve(specPath).startsWith(resolvedOutput + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(specPath)) return res.status(404).json({ error: 'Not found' });

  try {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    // A saved edit (via POST /api/diagram/:id/save) takes priority over the
    // wizard-generated diagram — that's the whole point of "save changes".
    const edited  = typeof spec.diagramOverride === 'string' && spec.diagramOverride.length > 0;
    const mermaid = edited ? spec.diagramOverride : buildMermaidDiagram(spec);
    // Return only the fields the viewer needs for its status line — not the full spec.
    const nc = spec.nestedCluster || {};
    const meta = {
      nestedHostCount:   nc.hostCount    || 0,
      physicalHostCount: (spec.physicalHosts || []).length || 1,
      esxiVersionLabel:  spec.esxiVersion?.label || '',
      clusterName:       nc.clusterName  || ''
    };
    res.json({ mermaid, meta, edited });
  } catch {
    res.status(500).json({ error: 'Failed to read spec' });
  }
});

// POST /api/diagram/:id/save — persist a hand-edited Mermaid source back onto the
// session's spec, so future loads of this session (reload, /diagram?id=, re-downloading
// diagram-html/network-diagram) show the edit instead of the wizard-generated diagram.
app.post('/api/diagram/:id/save', (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const dir = path.join(OUTPUT_DIR, id);
  const specPath = path.join(dir, 'lab-spec.json');
  const resolvedOutput = path.resolve(OUTPUT_DIR);
  if (!path.resolve(specPath).startsWith(resolvedOutput + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(specPath)) return res.status(404).json({ error: 'Not found' });

  const { mermaid } = req.body || {};
  if (typeof mermaid !== 'string' || !mermaid.trim()) {
    return res.status(400).json({ error: 'mermaid source (non-empty string) required' });
  }
  if (mermaid.length > 200_000) {
    return res.status(400).json({ error: 'Mermaid source too large' });
  }

  try {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    spec.diagramOverride = mermaid;
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));

    // Keep the downloadable artifacts for this session in sync with the edit.
    fs.writeFileSync(path.join(dir, 'diagram.html'), buildDiagramHtml(spec, mermaid));
    const svgGenerated = renderSvg(mermaid, path.join(dir, 'network-diagram.svg'));

    res.json({ ok: true, svgGenerated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save diagram: ' + err.message });
  }
});

// POST /api/diagram/from-spec — build mermaid source from a posted spec object
app.post('/api/diagram/from-spec', (req, res) => {
  try {
    const { spec } = req.body || {};
    if (!spec || typeof spec !== 'object') {
      return res.status(400).json({ error: 'spec object required' });
    }
    const edited  = typeof spec.diagramOverride === 'string' && spec.diagramOverride.length > 0;
    const mermaid = edited ? spec.diagramOverride : buildMermaidDiagram(spec);
    res.json({ mermaid, edited });
  } catch (err) {
    res.status(500).json({ error: 'Diagram generation failed' });
  }
});

// GET /diagram — serve the standalone diagram viewer page
app.get('/diagram', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'diagram.html'));
});

// ── Admin middleware ────────────────────────────────────────────────────────
// All /api/admin/* routes are restricted to localhost connections only.
// The server also binds exclusively to 127.0.0.1 (see app.listen below),
// so this middleware acts as a defence-in-depth check.
function requireLocalhost(req, res, next) {
  const raw   = req.ip || req.connection.remoteAddress || '';
  const clean = raw.replace(/^::ffff:/, '');
  if (clean === '127.0.0.1' || clean === '::1') return next();
  res.status(403).json({ error: 'Admin endpoints are only accessible from localhost' });
}

// ADMIN_ENABLED=false (set in the Docker image) removes the admin surface entirely,
// rather than relying solely on requireLocalhost's loopback check — that check assumes
// HOST=127.0.0.1, which no longer holds once the container listens on 0.0.0.0.
const ADMIN_ENABLED = process.env.ADMIN_ENABLED !== 'false';
if (ADMIN_ENABLED) {
  app.use('/api/admin', requireLocalhost);
} else {
  app.use('/api/admin', (req, res) => res.status(404).end());
}

// ── Admin: Scenario Library endpoints ──────────────────────────────────────
// Activated via Cmd+Shift+X — not documented in README or public UI.

// GET /api/admin/scenario-list — return all scenarios in the library
app.get('/api/admin/scenario-list', (req, res) => {
  try { res.json({ scenarios: loadScenarios() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/scenario-active — return the currently loaded scenario (if any)
app.get('/api/admin/scenario-active', (req, res) => {
  try {
    const active = getActive();
    if (!active) return res.json({ active: null });
    const scenario = getScenario(active.id);
    res.json({ active: scenario ? { ...active, scenario } : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-load — set the active scenario and revert the vCenter snapshot
app.post('/api/admin/scenario-load', async (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    setActive(id);

    if (!scenario.snapshotName) {
      return res.json({ ok: true, scenario, snapshotNote: 'No snapshot captured yet — introduce the fault manually in the lab.' });
    }

    const cfg = vcenterConfig.load(BASE_DIR);
    if (!cfg || !cfg.server) {
      return res.json({ ok: true, scenario, snapshotNote: `vCenter not configured — revert snapshot '${scenario.snapshotName}' manually, or save vCenter credentials using the vCenter Settings button.` });
    }

    try {
      const reverted = await revertAllToSnapshot(cfg, scenario.snapshotName);
      res.json({ ok: true, scenario, reverted, snapshotNote: `Reverted ${reverted.length} VM(s) to snapshot '${scenario.snapshotName}'.` });
    } catch (vcErr) {
      res.json({ ok: true, scenario, snapshotError: vcErr.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-unload — clear the active scenario
app.post('/api/admin/scenario-unload', (req, res) => {
  try { setActive(null); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/vcenter-config — return saved vCenter settings (password redacted)
app.get('/api/admin/vcenter-config', (req, res) => {
  const cfg = vcenterConfig.load(BASE_DIR);
  if (!cfg) return res.json({ configured: false });
  const { password: _pw, ...safe } = cfg;
  res.json({ configured: true, ...safe });
});

// POST /api/admin/vcenter-config — save vCenter connection settings
app.post('/api/admin/vcenter-config', (req, res) => {
  const { server, user, password, insecure } = req.body || {};
  if (!server || typeof server !== 'string') return res.status(400).json({ error: 'server is required' });
  if (!user   || typeof user   !== 'string') return res.status(400).json({ error: 'user is required' });
  try {
    vcenterConfig.save(BASE_DIR, {
      server:   server.trim(),
      user:     user.trim(),
      password: password || '',
      insecure: !!insecure
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/vcenter-test — authenticate and immediately log out to verify credentials
app.post('/api/admin/vcenter-test', async (req, res) => {
  const cfg = vcenterConfig.load(BASE_DIR);
  if (!cfg || !cfg.server) return res.status(400).json({ error: 'No vCenter configuration saved — fill in the settings form first.' });
  try {
    await vcenterTestConnection(cfg);
    res.json({ ok: true, message: `Connected to ${cfg.server} as ${cfg.user}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/scenario-save — create or update a scenario + optional verify script
app.post('/api/admin/scenario-save', (req, res) => {
  const { scenario, verifyScriptContent } = req.body || {};
  if (!scenario || typeof scenario !== 'object') return res.status(400).json({ error: 'scenario object required' });
  if (!scenario.name) return res.status(400).json({ error: 'scenario.name required' });
  try {
    if (!scenario.id) scenario.id = nameToId(scenario.name);
    if (!scenario.created) scenario.created = new Date().toISOString().slice(0, 10);
    scenario.verifyScript = scenario.verifyScript || `verify-${scenario.id}.ps1`;
    saveScenario(scenario);
    if (verifyScriptContent && typeof verifyScriptContent === 'string') {
      saveVerifyScript(scenario.verifyScript, verifyScriptContent);
    }
    res.json({ ok: true, id: scenario.id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/admin/scenario/:id — delete a scenario from the library
app.delete('/api/admin/scenario/:id', (req, res) => {
  const { id } = req.params;
  try {
    deleteScenario(id);
    // Clear active if this was the loaded scenario
    const active = getActive();
    if (active && active.id === id) setActive(null);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/admin/scenario-export/:id — download scenario as .labscenario bundle
app.get('/api/admin/scenario-export/:id', (req, res) => {
  const { id } = req.params;
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const verifyScript = getVerifyScript(id) || '';
    const bundle = { version: '1', scenario, verifyScript };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.labscenario"`);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-import — import a .labscenario bundle
app.post('/api/admin/scenario-import', (req, res) => {
  const { bundle } = req.body || {};
  if (!bundle || typeof bundle !== 'object') return res.status(400).json({ error: 'bundle object required' });
  if (bundle.version !== '1') return res.status(400).json({ error: 'Unsupported bundle version' });
  const scenario = bundle.scenario;
  if (!scenario || !scenario.id || !scenario.name) return res.status(400).json({ error: 'Invalid scenario in bundle' });
  try {
    // Imported scenarios have no snapshot yet — clear snapshotName
    scenario.snapshotName = '';
    saveScenario(scenario);
    if (bundle.verifyScript && typeof bundle.verifyScript === 'string') {
      saveVerifyScript(scenario.verifyScript || `verify-${scenario.id}.ps1`, bundle.verifyScript);
    }
    res.json({ ok: true, id: scenario.id, name: scenario.name });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/admin/scenario-capture — create a vCenter snapshot on all VMs and record the name
app.post('/api/admin/scenario-capture', async (req, res) => {
  const { id, snapshotName: requestedName } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const snapshotName = (requestedName || '').trim() || `scenario-${id}-${Date.now()}`;

    const cfg = vcenterConfig.load(BASE_DIR);
    if (!cfg || !cfg.server) {
      // No vCenter config — record the name only; admin creates the snapshot manually
      scenario.snapshotName = snapshotName;
      saveScenario(scenario);
      return res.json({ ok: true, snapshotName, vcenterNote: 'vCenter not configured — create this snapshot manually in vCenter using the name above, then load the scenario to auto-revert.' });
    }

    try {
      const { created, errors } = await createSnapshotsOnAllVMs(cfg, snapshotName, `Zero to Hero Lab — ${scenario.name}`);
      scenario.snapshotName = snapshotName;
      saveScenario(scenario);
      res.json({ ok: true, snapshotName, created, errors });
    } catch (vcErr) {
      // vCenter error — still record the name so admin can create manually and load later
      scenario.snapshotName = snapshotName;
      saveScenario(scenario);
      res.json({ ok: true, snapshotName, vcenterError: vcErr.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-verify — run the verify script and return result
app.post('/api/admin/scenario-verify', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const script = getVerifyScript(id);
    if (!script) return res.status(404).json({ error: 'Verify script not found for this scenario' });
    const scenario = getScenario(id);
    const scriptFilename = (scenario && scenario.verifyScript) || `verify-${id}.ps1`;
    // Validate filename before using it in a path — defence-in-depth against stored path traversal
    if (!/^[a-zA-Z0-9-]+\.ps1$/.test(scriptFilename)) return res.status(400).json({ error: 'Invalid verify script filename' });
    const scriptPath = path.join(__dirname, 'scenarios', 'verify', scriptFilename);
    const pwsh = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const result = require('child_process').spawnSync(pwsh, ['-NoProfile', '-File', scriptPath], { timeout: 30000, encoding: 'utf8' });
    if (result.status === null) return res.json({ result: 'ERROR', output: 'Script timed out or PowerShell not found. Install PowerShell Core (pwsh) to run verify scripts.' });
    const output = (result.stdout || '') + (result.stderr || '');
    const verified = output.includes('FAULT_RESOLVED') ? 'FAULT_RESOLVED' : output.includes('FAULT_PRESENT') ? 'FAULT_PRESENT' : 'UNKNOWN';
    res.json({ result: verified, output: output.trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Troubleshooting mode endpoints ─────────────────────────────────────────
// Activated via Cmd+Shift+X — not documented in README or public UI.

// POST /api/troubleshoot/start — begin a session with a specific scenario
app.post('/api/troubleshoot/start', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const token = crypto.randomBytes(16).toString('hex');
    tsSessions.set(token, { scenario, createdAt: Date.now(), clueUsed: false, ticket: null, hintsGiven: 0 });
    res.json({
      token,
      callerName:      scenario.customerScenario ? 'Customer' : 'Lab',
      scenarioMessage: scenario.customerScenario || '',
      scenarioName:    scenario.name,
      difficulty:      scenario.difficulty,
      topics:          scenario.topics || []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/troubleshoot/customer-info — return the follow-up clue (one-time)
app.post('/api/troubleshoot/customer-info', (req, res) => {
  const { token } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  session.clueUsed = true;
  res.json({ clue: session.scenario.customerFollowUp || 'No additional information available.' });
});

// POST /api/troubleshoot/ticket — record the support ticket (unlocks hints)
app.post('/api/troubleshoot/ticket', (req, res) => {
  const { token, ticket } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!ticket || !ticket.symptom) return res.status(400).json({ error: 'Symptom is required' });
  session.ticket = ticket;
  res.json({ ok: true });
});

// POST /api/troubleshoot/hint — return the hint at the requested level
app.post('/api/troubleshoot/hint', (req, res) => {
  const { token, level } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  if (typeof level !== 'number' || level < 1 || level > 5) return res.status(400).json({ error: 'level must be 1–5' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!session.ticket) return res.status(403).json({ error: 'Submit a ticket first to unlock hints' });
  const hint = (session.scenario.hints || [])[level - 1];
  if (!hint) return res.status(400).json({ error: 'Hint not found' });
  if (level > session.hintsGiven) session.hintsGiven = level;
  res.json({ hint, level });
});

// POST /api/troubleshoot/debrief — mark resolved and return full scenario data + ticket score
app.post('/api/troubleshoot/debrief', (req, res) => {
  const { token, ticket } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const t = session.ticket || ticket || {};
  let ticketScore = 'Not logged';
  let ticketAnalysis = '';
  if (t.symptom) {
    const fields = [t.symptom, t.tried, t.cause, t.impact].filter(Boolean).length;
    if (fields === 4) { ticketScore = 'Excellent'; ticketAnalysis = 'All four fields completed — thorough documentation.'; }
    else if (fields === 3) { ticketScore = 'Good';      ticketAnalysis = 'Three fields completed. Adding all four helps replicate issues faster.'; }
    else if (fields === 2) { ticketScore = 'Fair';      ticketAnalysis = 'Symptom plus one other field. More context speeds up triage.'; }
    else                   { ticketScore = 'Minimal';   ticketAnalysis = 'Only the symptom was captured. Document steps tried and suspected cause to build better habits.'; }
  }

  const s = session.scenario;
  res.json({
    scenarioName:    s.name,
    faultDescription: s.description,
    fixSteps:        s.fixSteps        || [],
    objectives:      (s.examObjectives || []).join(', '),
    topics:          (s.topics         || []).join(', '),
    difficulty:      s.difficulty,
    ticketScore,
    ticketAnalysis,
    hintsUsed:       session.hintsGiven,
    clueUsed:        session.clueUsed
  });
});

// Binds to 127.0.0.1 by default — this is a local tool and must not be reachable from
// the network. The Docker image is the one sanctioned exception: it sets HOST=0.0.0.0
// so the container's published port actually works (127.0.0.1 inside a container is
// unreachable through Docker's port mapping), and pairs it with ADMIN_ENABLED=false so
// the admin surface (vCenter credential storage, PowerShell execution) never opens up
// to the network just because requireLocalhost's loopback check no longer holds.
// Walks CANDIDATE_PORTS in order, falling through to the next one on EADDRINUSE.
function startServer(ports, index) {
  const port = ports[index];
  const server = app.listen(port, HOST, () => {
    const url = `http://localhost:${port}`;
    console.log(`Zero to Hero Lab running at ${url} — open this URL in your browser`);
    if (port !== ports[0]) {
      console.log(`(Port ${ports[0]} was already in use — landed on ${port} instead.)`);
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && index < ports.length - 1) {
      console.log(`Port ${port} is already in use, trying ${ports[index + 1]}...`);
      startServer(ports, index + 1);
    } else if (err.code === 'EADDRINUSE') {
      fatalError(new Error(`All candidate ports (${ports.join(', ')}) are already in use. Close whatever is using them, or set the PORT environment variable to pick a different one.`));
    } else {
      fatalError(err);
    }
  });
}

startServer(CANDIDATE_PORTS, 0);
