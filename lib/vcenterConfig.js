'use strict';

const fs   = require('fs');
const path = require('path');

function load(baseDir) {
  const p = path.join(baseDir, 'vcenter-config.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function save(baseDir, config) {
  const p = path.join(baseDir, 'vcenter-config.json');
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
}

module.exports = { load, save };
