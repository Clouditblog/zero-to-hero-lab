'use strict';

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const BASE = 'http://127.0.0.1:3000';
  let pass = 0, fail = 0;

  function ok(label) { console.log(`  PASS  ${label}`); pass++; }
  function ko(label, detail) { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  async function check(label, fn) {
    try { const r = await fn(); if (r === false) ko(label); else ok(label); }
    catch (e) { ko(label, e.message); }
  }

  // Helper: complete learning mode onboarding and enable architect toggle
  async function enterArchitectMode() {
    await page.goto(BASE);
    await page.click('#mode-learn');
    await page.evaluate(() => document.querySelector('.learn-goal-card[data-goal="certification"]').click());
    await page.selectOption('#learn-cert-target', 'VCAP-VCF-Networking');
    await page.evaluate(() => document.querySelector('.learn-exp-card[data-exp="some"]').click());
    await page.fill('#learn-success-stmt', 'Practise NSX BGP peering for VCAP Networking.');
    await page.evaluate(() => document.querySelector('.learn-time-card[data-time="full-day"]').click());
    await page.check('#learn-arch-toggle');
    await page.evaluate(() => document.getElementById('learn-onboard-start').click());
  }

  // Helper: complete discovery and enter wizard
  async function completeDiscovery() {
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.arch-stakeholder-card[data-stakeholder="solo"]').click());
    await page.fill('#arch-problem-stmt', 'Need a reproducible NSX lab to validate DFW policies.');
    await page.selectOption('#arch-constraint-time', 'one-week');
    await page.selectOption('#arch-constraint-budget', 'homelab');
    await page.fill('#arch-success-criteria', 'Pass VCAP Networking exam.');
    await page.fill('#arch-success-measure', 'Run through exam scenarios without notes.');
    await page.evaluate(() => document.querySelectorAll('.arch-principle-card')[0].click());
    await page.click('#arch-disc-start');
    await page.waitForTimeout(400);
  }

  // ── Cert dropdown ────────────────────────────────────────────────────────────
  console.log('\n── Certification dropdown ──');
  await page.goto(BASE);
  await page.click('#mode-learn');
  await page.evaluate(() => document.querySelector('.learn-goal-card[data-goal="certification"]').click());

  // VCP level options
  await check('VCP-VCF-Architect option present (2V0-13.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCP-VCF-Architect"]')));
  await check('VCP-VCF-Admin option present (2V0-17.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCP-VCF-Admin"]')));
  await check('VCP-VCF-Support option present (2V0-15.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCP-VCF-Support"]')));
  await check('VCP-VVF-Admin option present (2V0-16.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCP-VVF-Admin"]')));
  await check('VCP-VVF-Support option present (2V0-18.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCP-VVF-Support"]')));
  // VCAP level options
  await check('VCAP-VCF-Automation option present (3V0-21.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCAP-VCF-Automation"]')));
  await check('VCAP-VCF-Operations option present (3V0-22.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCAP-VCF-Operations"]')));
  await check('VCAP-VCF-Storage option present (3V0-23.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCAP-VCF-Storage"]')));
  await check('VCAP-VCF-VKS option present (3V0-24.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCAP-VCF-VKS"]')));
  await check('VCAP-VCF-Networking option present (3V0-25.25)', async () =>
    page.evaluate(() => !!document.querySelector('#learn-cert-target option[value="VCAP-VCF-Networking"]')));
  // Retired certs absent
  await check('Old VCP-VVF (no suffix) NOT present', async () =>
    page.evaluate(() => !document.querySelector('#learn-cert-target option[value="VCP-VVF"]')));
  await check('Old VCP-NV NOT present', async () =>
    page.evaluate(() => !document.querySelector('#learn-cert-target option[value="VCP-NV"]')));
  await check('Old VCAP-DCV NOT present', async () =>
    page.evaluate(() => !document.querySelector('#learn-cert-target option[value="VCAP-DCV"]')));
  await check('Old VCAP-NV NOT present', async () =>
    page.evaluate(() => !document.querySelector('#learn-cert-target option[value="VCAP-NV"]')));
  await check('Old VCF catch-all NOT present', async () =>
    page.evaluate(() => !document.querySelector('#learn-cert-target option[value="VCF"]')));
  await check('10 cert options total', async () =>
    page.evaluate(() => document.querySelectorAll('#learn-cert-target option:not([value=""])').length === 10));

  await check('VCP-VCF-Admin triggers NSX pre-fill', async () => {
    await page.selectOption('#learn-cert-target', 'VCP-VCF-Admin');
    await page.evaluate(() => document.querySelector('.learn-exp-card[data-exp="some"]').click());
    await page.evaluate(() => document.querySelector('.learn-time-card[data-time="full-day"]').click());
    await page.evaluate(() => document.getElementById('learn-onboard-start').click());
    await page.waitForTimeout(200);
    return await page.evaluate(() => document.getElementById('nsxEnabled')?.checked === true);
  });

  await check('VCAP-VCF-Networking triggers NSX pre-fill', async () => {
    await page.goto(BASE);
    await page.click('#mode-learn');
    await page.evaluate(() => document.querySelector('.learn-goal-card[data-goal="certification"]').click());
    await page.selectOption('#learn-cert-target', 'VCAP-VCF-Networking');
    await page.evaluate(() => document.querySelector('.learn-exp-card[data-exp="some"]').click());
    await page.evaluate(() => document.querySelector('.learn-time-card[data-time="full-day"]').click());
    await page.evaluate(() => document.getElementById('learn-onboard-start').click());
    await page.waitForTimeout(200);
    return await page.evaluate(() => document.getElementById('nsxEnabled')?.checked === true);
  });

  // ── Onboarding + architect toggle ───────────────────────────────────────────
  console.log('\n── Onboarding + architect toggle ──');
  await page.goto(BASE);
  await page.click('#mode-learn');
  await check('Architect toggle hidden before all fields set', async () =>
    page.evaluate(() => document.getElementById('learn-arch-toggle-wrap').hidden));

  await page.evaluate(() => document.querySelector('.learn-goal-card[data-goal="certification"]').click());
  await page.selectOption('#learn-cert-target', 'VCAP-VCF-Networking');
  await page.evaluate(() => document.querySelector('.learn-exp-card[data-exp="some"]').click());
  await page.fill('#learn-success-stmt', 'Practise NSX BGP peering for VCAP Networking.');
  await page.evaluate(() => document.querySelector('.learn-time-card[data-time="full-day"]').click());

  await check('Architect toggle visible after all fields set', async () =>
    page.evaluate(() => !document.getElementById('learn-arch-toggle-wrap').hidden));
  await check('Architect toggle unchecked by default', async () =>
    page.evaluate(() => !document.getElementById('learn-arch-toggle').checked));

  await page.check('#learn-arch-toggle');
  await page.evaluate(() => document.getElementById('learn-onboard-start').click());

  // ── Phase 0 discovery ────────────────────────────────────────────────────────
  console.log('\n── Phase 0 discovery ──');
  await check('Discovery screen visible after start in architect mode', async () =>
    page.evaluate(() => !document.getElementById('arch-discovery-screen').hidden));
  await check('.app hidden during discovery', async () =>
    page.evaluate(() => document.querySelector('.app').hidden));
  await check('4 stakeholder cards', async () =>
    (await page.$$('.arch-stakeholder-card')).length === 4);
  await check('5 MoSCoW rows (networking/compute/storage/security/management)', async () =>
    (await page.$$('.arch-moscow-row')).length === 5);
  await check('3 risk input rows', async () =>
    (await page.$$('.arch-risk-row')).length === 3);
  await check('8 design principle cards', async () =>
    (await page.$$('.arch-principle-card')).length === 8);
  await check('Suggested risk chips present', async () =>
    (await page.$$('.arch-risk-chip')).length > 0);

  // Stakeholder selection
  await page.evaluate(() => document.querySelector('.arch-stakeholder-card[data-stakeholder="solo"]').click());
  await check('Stakeholder card toggles selected', async () =>
    page.evaluate(() => document.querySelector('.arch-stakeholder-card[data-stakeholder="solo"]').classList.contains('selected')));

  // Principle toggle
  await page.evaluate(() => document.querySelectorAll('.arch-principle-card')[0].click());
  await check('Principle card toggles selected', async () =>
    page.evaluate(() => document.querySelectorAll('.arch-principle-card')[0].classList.contains('selected')));

  // Custom principle
  await page.fill('#arch-principle-custom-input', 'Changes must be reversible within 15 minutes');
  await page.click('#arch-principle-add-btn');
  await check('Custom principle appears in list', async () =>
    page.evaluate(() => document.getElementById('arch-custom-principles-list').textContent.includes('reversible')));

  // Suggested risk chip populates a row
  await page.evaluate(() => document.querySelector('.arch-risk-chip').click());
  await check('Suggested risk chip populates a risk row', async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.arch-risk-row .arch-risk-desc')).some(t => t.value.trim().length > 0)));

  // ── Wizard in architect mode ─────────────────────────────────────────────────
  console.log('\n── Wizard in architect mode ──');
  await page.fill('#arch-problem-stmt', 'Need a reproducible NSX lab.');
  await page.selectOption('#arch-constraint-time', 'one-week');
  await page.selectOption('#arch-constraint-budget', 'homelab');
  await page.fill('#arch-success-criteria', 'Pass VCAP Networking exam.');
  await page.fill('#arch-success-measure', 'Run through scenarios without notes.');
  await page.click('#arch-disc-start');
  await page.waitForTimeout(400);

  await check('Discovery hidden after start', async () =>
    page.evaluate(() => document.getElementById('arch-discovery-screen').hidden));
  await check('.app visible after discovery', async () =>
    page.evaluate(() => !document.querySelector('.app').hidden));
  await check('Decision log panel visible in rail', async () =>
    page.evaluate(() => !document.getElementById('arch-decision-log-panel').hidden));
  await check('Risk register panel visible in rail', async () =>
    page.evaluate(() => !document.getElementById('arch-risk-register-panel').hidden));
  await check('Risk register seeded from discovery', async () =>
    page.evaluate(() => parseInt(document.getElementById('arch-rr-count').textContent) >= 1));
  await check('state.architectMode is true', async () =>
    page.evaluate(() => state.architectMode === true));

  // ── Options analysis overlays ────────────────────────────────────────────────
  console.log('\n── Options analysis overlays ──');

  // Router (step 3)
  await page.evaluate(() => window.showStep(3));
  await page.waitForTimeout(300);
  await check('Router options overlay shown at step 3', async () =>
    page.evaluate(() => !document.getElementById('arch-options-panel').hidden));
  await check('Router overlay has correct title', async () => {
    const txt = await page.$eval('#arch-options-title', e => e.textContent);
    return txt.toLowerCase().includes('router');
  });
  await check('3 option columns rendered', async () =>
    (await page.$$('.arch-opt-header-btn')).length === 3);

  // Select option + confirm → logs decision
  await page.evaluate(() => document.querySelectorAll('.arch-opt-header-btn')[0].click());
  await page.fill('#arch-options-rationale', 'BGP practice needed for VCAP Networking.');
  await page.click('#arch-options-confirm');
  await page.waitForTimeout(200);
  await check('Overlay dismissed after confirm', async () =>
    page.evaluate(() => document.getElementById('arch-options-panel').hidden));
  await check('Decision log count incremented', async () =>
    page.evaluate(() => parseInt(document.getElementById('arch-dl-count').textContent) >= 1));
  await check('Decision log row rendered', async () =>
    page.evaluate(() => document.getElementById('arch-dl-body').querySelector('.arch-dl-row') !== null));

  // Cluster size (step 7)
  await page.evaluate(() => window.showStep(7));
  await page.waitForTimeout(300);
  await check('Cluster size overlay shown at step 7', async () =>
    page.evaluate(() => !document.getElementById('arch-options-panel').hidden));
  await check('Cluster overlay has correct title', async () => {
    const txt = await page.$eval('#arch-options-title', e => e.textContent);
    return txt.toLowerCase().includes('cluster');
  });
  await page.click('#arch-options-skip');
  await page.waitForTimeout(200);
  await check('Overlay dismissed without logging after skip', async () =>
    page.evaluate(() => document.getElementById('arch-options-panel').hidden));

  // NSX (step 8)
  await page.evaluate(() => window.showStep(8));
  await page.waitForTimeout(300);
  await check('NSX options overlay shown at step 8', async () =>
    page.evaluate(() => !document.getElementById('arch-options-panel').hidden));
  await check('NSX overlay has correct title', async () => {
    const txt = await page.$eval('#arch-options-title', e => e.textContent);
    return txt.toLowerCase().includes('nsx');
  });
  await page.click('#arch-options-skip');
  await page.waitForTimeout(200);

  // vSAN toggle re-triggers storage overlay
  await page.evaluate(() => window.showStep(7));
  await page.waitForTimeout(200);
  if (!await page.evaluate(() => document.getElementById('arch-options-panel').hidden)) {
    await page.click('#arch-options-skip');
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {
    const vsan = document.getElementById('vsanEnabled');
    if (vsan) { vsan.checked = true; vsan.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(200);
  await check('Storage overlay shown when vSAN toggled on', async () =>
    page.evaluate(() => !document.getElementById('arch-options-panel').hidden));
  await page.click('#arch-options-skip');
  await page.waitForTimeout(200);
  // Toggle off then back on — should show again (re-trigger fix)
  await page.evaluate(() => {
    const vsan = document.getElementById('vsanEnabled');
    if (vsan) { vsan.checked = false; vsan.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const vsan = document.getElementById('vsanEnabled');
    if (vsan) { vsan.checked = true; vsan.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(200);
  await check('Storage overlay re-shown on second vSAN toggle (re-trigger fix)', async () =>
    page.evaluate(() => !document.getElementById('arch-options-panel').hidden));
  await page.click('#arch-options-skip');
  await page.waitForTimeout(200);

  // ── Auto-detected risks ──────────────────────────────────────────────────────
  console.log('\n── Auto-detected risks ──');
  await page.evaluate(() => window.showStep(7));
  await page.waitForTimeout(200);
  if (!await page.evaluate(() => document.getElementById('arch-options-panel').hidden)) {
    await page.click('#arch-options-skip'); await page.waitForTimeout(200);
  }
  const rrBefore = await page.evaluate(() => parseInt(document.getElementById('arch-rr-count').textContent));
  await page.evaluate(() => {
    state.answers.design.nestedHostCount = 1;
    // Call directly — detectDesignRisks is a top-level function in wizard.js
    if (typeof detectDesignRisks === 'function') detectDesignRisks();
  });
  await page.waitForTimeout(200);
  await check('Single-host SPOF risk auto-added', async () =>
    page.evaluate((before) => parseInt(document.getElementById('arch-rr-count').textContent) > before, rrBefore));

  // ── Scorecard still works in architect mode ──────────────────────────────────
  console.log('\n── Architecture scorecard (step 14) ──');
  await page.evaluate(() => window.showStep(14));
  await check('Scorecard renders in architect mode', async () =>
    page.isVisible('#learn-scorecard'));
  await check('Score rows present', async () =>
    (await page.$$('.learn-score-row')).length >= 3);

  // ── Architect readiness banner ───────────────────────────────────────────────
  console.log('\n── Architect readiness banner ──');
  await check('Readiness banner hidden before generate', async () =>
    page.evaluate(() => document.getElementById('arch-readiness-banner').hidden));

  // ── Regression: standard mode unaffected ─────────────────────────────────────
  console.log('\n── Regression: standard mode ──');
  await page.goto(BASE);
  await page.click('#mode-build');
  await check('Standard mode: .app visible', async () =>
    page.evaluate(() => !document.querySelector('.app').hidden));
  await check('Standard mode: no architect panels visible', async () =>
    page.evaluate(() => document.getElementById('arch-decision-log-panel').hidden));
  await check('Standard mode: no discovery screen visible', async () =>
    page.evaluate(() => document.getElementById('arch-discovery-screen').hidden));
  await check('Standard mode: no options overlay visible', async () =>
    page.evaluate(() => document.getElementById('arch-options-panel').hidden));

  // ── Unit: buildOpenItems MoSCoW 'could' → Open Items ────────────────────────
  console.log('\n── buildOpenItems: MoSCoW could items ──');
  const { buildOpenItems } = require('./lib/generateMarkdown');

  function unitCheck(label, fn) {
    try { const r = fn(); if (r === false) ko(label); else ok(label); }
    catch (e) { ko(label, e.message); }
  }

  const discWithCould = {
    problemStatement: 'Need NSX lab.',
    moscow: { networking: 'must', compute: 'must', storage: 'could', security: 'could', management: 'should' },
  };
  const allDecisions = [
    { decision: 'Virtual router', chosen: 'VyOS', alternative: 'pfSense', rationale: 'BGP' },
    { decision: 'Storage architecture', chosen: 'vSAN', alternative: 'NFS', rationale: 'Integrated' },
    { decision: 'NSX deployment', chosen: 'NSX-T', alternative: 'none', rationale: 'Required' },
    { decision: 'Cluster size', chosen: '3 hosts', alternative: '2 hosts', rationale: 'HA' },
  ];
  const items = buildOpenItems(discWithCould, allDecisions, [], { successStatement: 'Build NSX lab.' });

  unitCheck('Storage could item present', () => items.some(i => i.includes('Storage area marked "Could Have"')));
  unitCheck('Security could item present', () => items.some(i => i.includes('Security area marked "Could Have"')));
  unitCheck('Networking must NOT in items', () => !items.some(i => i.includes('Networking area marked "Could Have"')));
  unitCheck('Compute must NOT in items', () => !items.some(i => i.includes('Compute area marked "Could Have"')));
  unitCheck('Management should NOT in items', () => !items.some(i => i.includes('Management area marked "Could Have"')));
  unitCheck('Problem statement check passes when provided', () => !items.some(i => i.includes('Problem statement')));

  // No could items → only other checks contribute
  const discNoCould = { problemStatement: 'Need NSX lab.', moscow: { networking: 'must', compute: 'must', storage: 'must', security: 'must', management: 'must' } };
  const itemsNoCould = buildOpenItems(discNoCould, allDecisions, [], { successStatement: 'x' });
  unitCheck('No could items produces empty list (when all other checks pass)', () => itemsNoCould.length === 0);

  // High-risk without mitigation still added
  const highRisk = [{ likelihood: 'high', impact: 'high', mitigation: '' }];
  const itemsWithRisk = buildOpenItems(discNoCould, allDecisions, highRisk, { successStatement: 'x' });
  unitCheck('High-severity unmitiated risk still appears in open items', () =>
    itemsWithRisk.some(i => i.includes('high-severity risk')));

  console.log(`\n── Results: ${pass} passed, ${fail} failed ──\n`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
