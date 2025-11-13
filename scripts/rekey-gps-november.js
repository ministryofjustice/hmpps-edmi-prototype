// scripts/rekey-gps-november.js
// Rewrite existing GPS JSON keys so they run from bh_20251101 .. bh_20251111

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve('app/assets/data/gps-traces-bh-demo-nov01.json');
const OUTPUT = path.resolve('app/assets/data/gps-traces-bh-demo-nov01.json');

const pad = (n) => String(n).padStart(2, '0');

try {
  const json = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const oldKeys = Object.keys(json).sort();
  console.log('Found', oldKeys.length, 'days (first:', oldKeys[0], ')');

  // Create new keys: bh_20251101..bh_20251111
  const start = new Date(2025, 10, 1); // month 10 = November
  const newKeys = Array.from({ length: 11 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return `bh_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  });

  if (oldKeys.length !== newKeys.length) {
    console.warn('Counts differ — truncating or padding as needed.');
  }

  const out = {};
  for (let i = 0; i < Math.min(oldKeys.length, newKeys.length); i++) {
    out[newKeys[i]] = json[oldKeys[i]];
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log('✅ Rewritten:', newKeys[0], '→', newKeys[newKeys.length - 1]);
} catch (err) {
  console.error('❌ Error:', err);
}
