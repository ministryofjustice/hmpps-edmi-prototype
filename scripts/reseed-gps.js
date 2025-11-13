// Usage:
//   node scripts/reseed-gps.js <in.json> <out.json>
// Example:
//   node scripts/reseed-gps.js public/data/gps-traces-bh-demo-oct22.json public/data/gps-traces-bh-demo-nov01.json

const fs = require('fs');
const path = require('path');

const START_DATE = { y: 2025, m: 11, d: 1 };   // 1 Nov 2025
const TARGET_DAYS = 11;

// Visual “drift” for newly fabricated days (≈ SE in Colchester-ish coords)
// tweak if you want a different direction/speed
const DAILY_LAT_DELTA = -0.00045;
const DAILY_LNG_DELTA =  0.00070;
// tiny random noise so the path doesn’t look laser-straight
const JITTER = 0.00006;

function ymdToKey({ y, m, d }) {
  const mm = String(m).padStart(2,'0');
  const dd = String(d).padStart(2,'0');
  return `bh_${y}${mm}${dd}`;
}
function parseKey(key) {
  // expects "bh_YYYYMMDD"
  const m = /^bh_(\d{4})(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}
function toDate({ y, m, d }) { return new Date(y, m - 1, d); }
function fromDate(date) { return ({ y: date.getFullYear(), m: date.getMonth()+1, d: date.getDate() }); }
function daysBetween(a, b) { // b - a
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / (1000*60*60*24));
}
function addDays(ymd, n) {
  const d = toDate(ymd);
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

// Times in your file are ISO-ish; we’ll rebuild with the new date but same HH:MM
function rebuildIsoTime(newYMD, oldIso) {
  // Extract HH:MM from existing time
  const m = /T(\d{2}):(\d{2})/.exec(String(oldIso));
  const HH = m ? m[1] : '00';
  const MM = m ? m[2] : '00';
  const yyyy = String(newYMD.y);
  const mm = String(newYMD.m).padStart(2,'0');
  const dd = String(newYMD.d).padStart(2,'0');
  // Keep it simple (no Z)—your code uses local parsing for hours/mins anyway
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}`;
}

function isStaticDay(points, eps = 1e-6) {
  if (!Array.isArray(points) || points.length === 0) return true;
  const { lat: aLat = null, lng: aLng = null } = points[0] || {};
  if (aLat == null || aLng == null) return true;
  for (const p of points) {
    if (Math.abs(p.lat - aLat) > eps || Math.abs(p.lng - aLng) > eps) return false;
  }
  return true;
}

function jitter(n) {
  return (Math.random() * 2 - 1) * JITTER * n; // slightly scale with day index
}

// --- main ---
const [,, inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('Usage: node scripts/reseed-gps.js <in.json> <out.json>');
  process.exit(1);
}

const raw = fs.readFileSync(inFile, 'utf8');
const src = JSON.parse(raw);
if (typeof src !== 'object' || Array.isArray(src)) {
  throw new Error('Unexpected JSON shape: expected an object keyed by "bh_YYYYMMDD".');
}

// 1) Sort days
const dayKeys = Object.keys(src).filter(k => /^bh_\d{8}$/.test(k));
dayKeys.sort((a,b) => {
  const A = parseKey(a), B = parseKey(b);
  const dA = toDate(A), dB = toDate(B);
  return dA - dB;
});

// 2) Remove the first “static” day if found
let keys = dayKeys.slice();
if (keys.length) {
  const first = keys[0];
  const pts = (src[first] && src[first].points) || [];
  if (isStaticDay(pts)) {
    // Drop it
    keys = keys.slice(1);
    delete src[first];
    console.log('Removed first static day:', first, `(points: ${pts.length})`);
  }
}
if (!keys.length) {
  throw new Error('No days left after removing static day—aborting.');
}

// 3) Rebase so that the new first day = 1 Nov 2025
const firstAfter = parseKey(keys[0]);
const delta = daysBetween(toDate(firstAfter), toDate(START_DATE)); // START - firstAfter
// Build a new object with rebased keys and rebased point times
const rebased = {};

for (const key of keys) {
  const ymd = parseKey(key);
  const newYMD = addDays(ymd, delta);
  const newKey = ymdToKey(newYMD);

  const day = JSON.parse(JSON.stringify(src[key] || {})); // deep-ish copy
  const points = Array.isArray(day.points) ? day.points : [];
  day.points = points.map(p => {
    const copy = { ...p };
    copy.time = rebuildIsoTime(newYMD, p.time);
    return copy;
  });

  // Carry areas through untouched except date labels, if any
  // (If you have day-specific labels inside areas, adjust here as needed.)

  rebased[newKey] = day;
}

// 4) Ensure we have TARGET_DAYS days: clone from the last available day, drift SE each day
const existingKeys = Object.keys(rebased).sort((a,b) => {
  const A = parseKey(a), B = parseKey(b);
  return toDate(A) - toDate(B);
});

const have = existingKeys.length;
if (have < TARGET_DAYS) {
  const lastKey = existingKeys[existingKeys.length - 1];
  let lastYMD = parseKey(lastKey);

  for (let i = 1; i <= (TARGET_DAYS - have); i++) {
    const newYMD = addDays(lastYMD, i);
    const newKey = ymdToKey(newYMD);

    const baseDay = rebased[lastKey]; // clone shape
    const points = (baseDay && Array.isArray(baseDay.points)) ? baseDay.points : [];
    const areas  = (baseDay && Array.isArray(baseDay.areas))  ? baseDay.areas  : [];

    // drift index i (1,2,3...) so it moves further each new day
    const driftLat = DAILY_LAT_DELTA * i;
    const driftLng = DAILY_LNG_DELTA * i;

    const cloned = {
      points: points.map(p => ({
        ...p,
        lat: p.lat + driftLat + jitter(i),
        lng: p.lng + driftLng + jitter(i),
        time: rebuildIsoTime(newYMD, p.time)
      })),
      areas: areas.map(a => ({
        ...a,
        coordinates: Array.isArray(a.coordinates)
          ? a.coordinates.map(c => ({
              ...c,
              lat: c.lat + driftLat,
              lng: c.lng + driftLng
            }))
          : a.coordinates
      }))
    };

    rebased[newKey] = cloned;
  }
}

// 5) Trim if we somehow overshot (keep the first TARGET_DAYS)
let finalKeys = Object.keys(rebased).sort((a,b) => {
  const A = parseKey(a), B = parseKey(b);
  return toDate(A) - toDate(B);
});
if (finalKeys.length > TARGET_DAYS) {
  finalKeys = finalKeys.slice(0, TARGET_DAYS);
  const keep = new Set(finalKeys);
  for (const k of Object.keys(rebased)) {
    if (!keep.has(k)) delete rebased[k];
  }
}

// 6) Write out
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(rebased, null, 2), 'utf8');

console.log(`Wrote ${Object.keys(rebased).length} day(s) to: ${outFile}`);
console.log('First day:', finalKeys[0], 'Last day:', finalKeys[finalKeys.length - 1]);
