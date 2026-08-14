'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const VERIFY_DIR    = path.join(SCENARIOS_DIR, 'verify');

function ensureDirs() {
  if (!fs.existsSync(SCENARIOS_DIR)) fs.mkdirSync(SCENARIOS_DIR, { recursive: true });
  if (!fs.existsSync(VERIFY_DIR))    fs.mkdirSync(VERIFY_DIR,    { recursive: true });
}

function loadScenarios() {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  return fs.readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && f !== 'active.json')
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function getScenario(id) {
  // Prevent path traversal — id must be alphanumeric + hyphens only
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const filePath = path.join(SCENARIOS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function saveScenario(scenario) {
  if (!scenario || !scenario.id) throw new Error('scenario.id is required');
  if (!/^[a-zA-Z0-9-]+$/.test(scenario.id)) throw new Error('invalid scenario id');
  if (scenario.verifyScript && !/^[a-zA-Z0-9-]+\.ps1$/.test(scenario.verifyScript)) {
    throw new Error('invalid verifyScript filename');
  }
  ensureDirs();
  fs.writeFileSync(path.join(SCENARIOS_DIR, `${scenario.id}.json`), JSON.stringify(scenario, null, 2));
}

function deleteScenario(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid scenario id');
  const filePath = path.join(SCENARIOS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function getVerifyScript(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const s = getScenario(id);
  if (!s || !s.verifyScript) return null;
  const scriptPath = path.join(VERIFY_DIR, s.verifyScript);
  if (!fs.existsSync(scriptPath)) return null;
  return fs.readFileSync(scriptPath, 'utf8');
}

function saveVerifyScript(filename, content) {
  if (!/^[a-zA-Z0-9-]+\.ps1$/.test(filename)) throw new Error('invalid script filename');
  ensureDirs();
  fs.writeFileSync(path.join(VERIFY_DIR, filename), content);
}

// Active scenario — persisted to scenarios/active.json so it survives server restart
function getActive() {
  const p = path.join(SCENARIOS_DIR, 'active.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function setActive(scenarioId) {
  ensureDirs();
  if (!scenarioId) {
    const p = path.join(SCENARIOS_DIR, 'active.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return;
  }
  if (!/^[a-zA-Z0-9-]+$/.test(scenarioId)) throw new Error('invalid scenario id');
  fs.writeFileSync(path.join(SCENARIOS_DIR, 'active.json'), JSON.stringify({
    id: scenarioId,
    loadedAt: new Date().toISOString()
  }));
}

// Generate a safe scenario id from a human name
function nameToId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || crypto.randomBytes(4).toString('hex');
}

module.exports = { loadScenarios, getScenario, saveScenario, deleteScenario, getVerifyScript, saveVerifyScript, getActive, setActive, nameToId };
