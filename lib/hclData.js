'use strict';

// Curated ESXi HCL compatibility reference for common lab/prosumer NICs.
// Patterns matched case-insensitively against the user-entered NIC model string.

const FLAGGED_NICS = [
  {
    pattern: /realtek|rtl\s*\d{3,4}/i,
    chipsets: 'RTL8111/8168/8125',
    reason: 'Realtek NICs have no native inbox driver in ESXi 8.0+. Community drivers (realtek-r8125) exist but are unsupported and may break during upgrades.'
  },
  {
    pattern: /intel.*(i210|i211)|\bi210\b|\bi211\b/i,
    chipsets: 'Intel I210/I211',
    reason: 'Intel I210 and I211 were removed from the inbox net-igb driver in ESXi 8.0. Community net-mgt or net-igbvf drivers work but are not officially supported.'
  },
  {
    pattern: /killer|rivet\s*networks?/i,
    chipsets: 'Killer E2x00/E3x00',
    reason: 'Killer (Intel/Rivet Networks) NICs are not on the ESXi HCL. The underlying Intel chipset uses a different PCI vendor ID that ESXi does not recognise.'
  },
  {
    pattern: /atheros|qualcomm.*qca|qca\d{4}|\bar\d{4,5}\b/i,
    chipsets: 'Qualcomm/Atheros',
    reason: 'Qualcomm/Atheros NICs have no ESXi driver. Common in consumer mainboards and Wi-Fi adapters.'
  },
  {
    pattern: /marvell.*9235|88se9235/i,
    chipsets: 'Marvell 88SE9235',
    reason: 'Marvell 88SE9235 SATA controller is not supported in ESXi 8.0+.'
  },
  {
    pattern: /jmicron|jmb\d{3}/i,
    chipsets: 'JMicron JMB36x',
    reason: 'JMicron SATA controllers have no ESXi driver.'
  }
];

const KNOWN_GOOD_NICS = [
  { pattern: /intel.*(x710|xl710|x520|x540|x550|82599|82576|82574|82579|\bi350\b|\bi354\b)/i, label: 'Intel X-series / I350 (HCL supported)' },
  { pattern: /broadcom.*(57\d{3}|bcm57|5709|5720|578\d{2})/i, label: 'Broadcom BCM57xx (HCL supported)' },
  { pattern: /mellanox|connectx[-\s]?[2-6]/i, label: 'Mellanox ConnectX (HCL supported)' },
  { pattern: /chelsio\s*t\d/i, label: 'Chelsio T-series (HCL supported)' },
  { pattern: /solarflare|xilinx.*sfc|sfc\d{4}/i, label: 'Solarflare/AMD SFC (HCL supported)' }
];

// Returns { status: 'flagged', chipsets, reason }
//       | { status: 'good', label }
//       | { status: 'unknown' }
//       | null if model is blank
function checkNic(model) {
  if (!model || !model.trim()) return null;
  for (const entry of FLAGGED_NICS) {
    if (entry.pattern.test(model)) {
      return { status: 'flagged', chipsets: entry.chipsets, reason: entry.reason };
    }
  }
  for (const entry of KNOWN_GOOD_NICS) {
    if (entry.pattern.test(model)) {
      return { status: 'good', label: entry.label };
    }
  }
  return { status: 'unknown' };
}

module.exports = { FLAGGED_NICS, KNOWN_GOOD_NICS, checkNic };
