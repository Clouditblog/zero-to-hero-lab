'use strict';

const https = require('https');

async function request(hostname, reqPath, method, headers, body, agent) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body != null
      ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      : null;
    const opts = {
      hostname, path: reqPath, method, agent,
      headers: {
        ...headers,
        'Content-Length': bodyBuf ? bodyBuf.length : 0,
        ...(bodyBuf ? { 'Content-Type': 'application/json' } : {})
      }
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { /* leave null */ }
        resolve({ status: res.statusCode, data, raw });
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function createSession(server, user, password, insecure) {
  const agent = new https.Agent({ rejectUnauthorized: !insecure });
  const creds = Buffer.from(`${user}:${password}`).toString('base64');
  const r = await request(server, '/api/session', 'POST', { Authorization: `Basic ${creds}` }, null, agent);
  if (r.status !== 201) {
    throw new Error(`vCenter authentication failed (HTTP ${r.status}) — check server address and credentials`);
  }
  // vSphere 7+ returns the token as a quoted JSON string
  const token = typeof r.data === 'string' ? r.data : r.raw.replace(/^"|"$/g, '').trim();
  return { token, agent };
}

async function deleteSession(server, token, agent) {
  await request(server, '/api/session', 'DELETE', { 'vmware-api-session-id': token }, null, agent)
    .catch(() => {});
}

async function listVMs(server, token, agent) {
  const r = await request(server, '/api/vcenter/vm', 'GET', { 'vmware-api-session-id': token }, null, agent);
  if (r.status !== 200) throw new Error(`Failed to list VMs from vCenter (HTTP ${r.status})`);
  return Array.isArray(r.data) ? r.data : [];
}

function findInTree(nodes, name) {
  for (const node of (nodes || [])) {
    if (node.name === name) return node.snapshot;
    const found = findInTree(node.children, name);
    if (found) return found;
  }
  return null;
}

async function findSnapshot(server, token, agent, vmId, snapshotName) {
  const r = await request(
    server, `/api/vcenter/vm/${vmId}/snapshot`, 'GET',
    { 'vmware-api-session-id': token }, null, agent
  );
  if (r.status !== 200) return null;
  return findInTree(Array.isArray(r.data) ? r.data : (r.data && r.data.snapshots), snapshotName);
}

async function revertSnapshot(server, token, agent, vmId, snapshotId) {
  const r = await request(
    server, `/api/vcenter/vm/${vmId}/snapshot/${snapshotId}?action=revert`, 'POST',
    { 'vmware-api-session-id': token }, null, agent
  );
  if (r.status !== 204 && r.status !== 200) {
    throw new Error(`Snapshot revert failed (HTTP ${r.status}): ${r.raw.slice(0, 200)}`);
  }
}

async function createSnapshot(server, token, agent, vmId, name, description) {
  const r = await request(
    server, `/api/vcenter/vm/${vmId}/snapshot`, 'POST',
    { 'vmware-api-session-id': token },
    { name, description: description || '', memory: false, quiesce: false },
    agent
  );
  if (r.status !== 200 && r.status !== 201 && r.status !== 202) {
    throw new Error(`Snapshot creation failed (HTTP ${r.status}): ${r.raw.slice(0, 200)}`);
  }
}

// Create a named snapshot on every VM in the inventory.
// Returns { created: [{vm, name}], errors: [{vm, name, error}] }.
// Throws if no VMs exist or vCenter connection fails.
async function createSnapshotsOnAllVMs(config, snapshotName, description) {
  const { server, user, password, insecure } = config;
  const { token, agent } = await createSession(server, user, password, !!insecure);
  try {
    const vms = await listVMs(server, token, agent);
    const created = [];
    const errors  = [];
    for (const vm of vms) {
      try {
        await createSnapshot(server, token, agent, vm.vm, snapshotName, description);
        created.push({ vm: vm.vm, name: vm.name });
      } catch (e) {
        errors.push({ vm: vm.vm, name: vm.name, error: e.message });
      }
    }
    if (created.length === 0 && errors.length === 0) {
      throw new Error('No VMs found in vCenter inventory.');
    }
    return { created, errors };
  } finally {
    await deleteSession(server, token, agent);
  }
}

// Authenticate, walk all VMs, revert every VM that has the named snapshot.
// Throws with err.code === 'SNAPSHOT_NOT_FOUND' if no VM has the snapshot.
async function revertAllToSnapshot(config, snapshotName) {
  const { server, user, password, insecure } = config;
  const { token, agent } = await createSession(server, user, password, !!insecure);
  try {
    const vms = await listVMs(server, token, agent);
    const reverted = [];
    for (const vm of vms) {
      const snapId = await findSnapshot(server, token, agent, vm.vm, snapshotName);
      if (snapId) {
        await revertSnapshot(server, token, agent, vm.vm, snapId);
        reverted.push({ vm: vm.vm, name: vm.name });
      }
    }
    if (reverted.length === 0) {
      const err = new Error(
        `Snapshot '${snapshotName}' not found on vCenter — please capture a scenario snapshot first using the Capture button in the Lab Admin panel.`
      );
      err.code = 'SNAPSHOT_NOT_FOUND';
      throw err;
    }
    return reverted;
  } finally {
    await deleteSession(server, token, agent);
  }
}

// Authenticate and immediately log out — used for "Test Connection".
async function testConnection(config) {
  const { server, user, password, insecure } = config;
  const { token, agent } = await createSession(server, user, password, !!insecure);
  await deleteSession(server, token, agent);
}

module.exports = { revertAllToSnapshot, createSnapshotsOnAllVMs, testConnection };
