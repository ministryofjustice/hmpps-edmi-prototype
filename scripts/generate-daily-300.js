// scripts/generate-daily-300.js
// Node 16+
// Regenerates each day in the scenarios file to exactly 300 points,
// using 6 anchors (either provided or derived from the day’s existing points),
// and linear interpolation. Preserves any `areas` for that day.
//
// Usage:
//   node scripts/generate-daily-300.js --in INPUT.json --out OUTPUT.json [--anchors ANCHORS.json] [--days 20251101..20251111]
//
// The --days range is optional; if omitted, all bh_YYYYMMDD keys are processed.

const fs = require('fs');
const path = require('path');

function die(msg) { console.error(msg); process.exit(1); }

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--anchors') out.anchors = argv[++i];
    else if (a === '--days') out.days = argv[++i];      // e.g. 20251101..20251111
    else die(`Unknown arg: ${a}`);
  }
  if (!out.in || !out.out) die('Usage: --in INPUT.json --out OUTPUT.json [--anchors ANCHORS.json] [--days 20251101..20251111]');
  return out;
}

function readJSON(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeJSON(fp, obj) {
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
  console.log(`Wrote ${fp}`);
}

function keyToYMD(key) {
  // bh_YYYYMMDD
  const m = /^bh_(\d{4})(\d{2})(\d{2})$/.exec(String(key));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function pad2(n){ return String(n).padStart(2,'0'); }

function randTriangular(min, max) {
  // Smaller values more likely (triangular-ish distribution)
  const r = Math.min(Math.random(), Math.random()); // bias low
  return min + r * (max - min);
}
function randAccuracy(min = 5, max = 50) {
  return Math.round(randTriangular(min, max));
}


function minutesToIsoLocal({y,m,d}, mins) {
  const hh = Math.floor(mins/60);
  const mm = mins % 60;
  // No timezone suffix (keeps prior behaviour where Date(iso) treats it as local)
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`;
}

function pickSixAnchorsFromPoints(points) {
  // Take six evenly spaced points from the existing list.
  // If fewer than 6, duplicate the last known to reach 6.
  if (!Array.isArray(points) || points.length === 0) return null;
  const want = 6;
  const anchors = [];
  for (let i = 0; i < want; i++) {
    const idx = Math.floor(i * (points.length - 1) / (want - 1));
    anchors.push({ lat: points[idx].lat, lng: points[idx].lng });
  }
  return anchors;
}

function validLatLng(pt) {
  return pt && typeof pt.lat === 'number' && typeof pt.lng === 'number' &&
         isFinite(pt.lat) && isFinite(pt.lng);
}

function buildAnchorTimes() {
  // minutes after midnight for: 00:01, 04:00, 08:00, 12:00, 16:00, 20:00
  return [1, 240, 480, 720, 960, 1200];
}

function distributeCounts(total, segmentMinutes) {
  // Distribute `total` points across segments proportional to their minute spans.
  const sum = segmentMinutes.reduce((a,b)=>a+b,0);
  let raw = segmentMinutes.map(m => (sum ? (total * m / sum) : total/segmentMinutes.length));
  // Round while preserving total
  let rounded = raw.map(Math.round);
  let diff = total - rounded.reduce((a,b)=>a+b,0);

  // Adjust by nudging segments with largest fractional parts
  const fracs = raw.map((v,i)=>({i, frac: v - Math.floor(v)})).sort((a,b)=>b.frac - a.frac);
  let j = 0;
  while (diff !== 0 && j < fracs.length * 2) {
    const idx = fracs[j % fracs.length].i;
    rounded[idx] += (diff > 0 ? 1 : -1);
    diff += (diff > 0 ? -1 : 1);
    j++;
  }

  // Ensure each segment has at least 2 to guarantee endpoints inclusion
  // then re-balance if needed
  for (let i=0;i<rounded.length;i++){
    if (rounded[i] < 2) rounded[i] = 2;
  }
  const totalNow = rounded.reduce((a,b)=>a+b,0);
  if (totalNow !== total) {
    // Trim/add from the largest segments
    const order = rounded.map((v,i)=>({i,v})).sort((a,b)=>b.v - a.v);
    let k = 0, adj = total - totalNow;
    while (adj !== 0 && k < order.length * 5) {
      const t = order[k % order.length].i;
      if (adj > 0) { rounded[t]++; adj--; }
      else if (adj < 0 && rounded[t] > 2) { rounded[t]--; adj++; }
      k++;
    }
  }
  return rounded;
}

function interpolate(a, b, t) {
  // linear interpolate lat/lng
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function generateDay({key, ymd, anchors, totalPoints, accMin = 5, accMax = 50}) {
  const times = buildAnchorTimes(); // 6 timestamps
  if (!anchors || anchors.length !== 6 || !anchors.every(validLatLng)) return null;

  // Segments: [A0->A1], [A1->A2], ... (five segments)
  const segMinutes = [];
  for (let i=0;i<times.length-1;i++) segMinutes.push(times[i+1] - times[i]);

  const segCounts = distributeCounts(totalPoints, segMinutes);

  const outPoints = [];
  let labelCounter = 1; // per-day running label

  for (let s = 0; s < 5; s++) {
    const A = anchors[s], B = anchors[s+1];
    const count = segCounts[s];
    const t0 = times[s], t1 = times[s+1];

    for (let i = 0; i < count; i++) {
      const t = (count === 1) ? 0 : (i / (count - 1));
      const mins = Math.round(t0 + (t1 - t0) * t);
      const pos = interpolate(A, B, t);

      outPoints.push({
        lat: +pos.lat.toFixed(6),
        lng: +pos.lng.toFixed(6),
        time: minutesToIsoLocal(ymd, mins),   // "YYYY-MM-DDTHH:MM:00"
        accuracy: randAccuracy(accMin, accMax),
        label: labelCounter++
      });
    }
  }

  // Deduplicate any accidental duplicates by time (rare rounding issue)
  const seen = new Set();
  const dedup = [];
  for (const p of outPoints) {
    if (seen.has(p.time)) continue;
    seen.add(p.time);
    dedup.push(p);
  }
  return dedup;
}


function jitterAnchors(anchors, meters = 8) {
  // Add tiny jitter to avoid identical daily paths if we cloned anchors.
  // meters -> degrees approx (very rough; ok for tiny offsets)
  const deg = meters / 111_320; // ~ meters per degree lat
  return anchors.map(a => ({
    lat: a.lat + (Math.random()-0.5)*deg,
    lng: a.lng + (Math.random()-0.5)*deg
  }));
}

(async function main(){
  const args = parseArgs(process.argv);
  const input = readJSON(args.in);
  const anchorsMap = args.anchors ? readJSON(args.anchors) : null;

  // Optional day filter: "YYYYMMDD..YYYYMMDD"
  let dayMin = null, dayMax = null;
  if (args.days) {
    const m = /^(\d{8})\.\.(\d{8})$/.exec(args.days.trim());
    if (!m) die('Bad --days format; expected YYYYMMDD..YYYYMMDD');
    dayMin = +m[1]; dayMax = +m[2];
  }

  const OUT = {};
  const TOTAL = 300;

  for (const key of Object.keys(input)) {
    // Only process keys of the form bh_YYYYMMDD; pass others through untouched
    const ymd = keyToYMD(key);
    if (!ymd) { OUT[key] = input[key]; continue; }

    const dayNum = +(String(ymd.y) + pad2(ymd.m) + pad2(ymd.d));
    const inRange = (dayMin == null || (dayNum >= dayMin && dayNum <= dayMax));

    const srcDay = input[key] || {};
    const areas = Array.isArray(srcDay.areas) ? srcDay.areas : [];

    if (!inRange) {
      // copy through unmodified
      OUT[key] = srcDay;
      continue;
    }

    // Choose anchors
    let anchors = null;

    if (anchorsMap && Array.isArray(anchorsMap[key]) && anchorsMap[key].length === 6) {
      anchors = anchorsMap[key];
    } else if (Array.isArray(srcDay.points) && srcDay.points.length >= 6) {
      anchors = pickSixAnchorsFromPoints(srcDay.points);
    } else {
      // Synthesize a small local walk if nothing to go on:
      const base = (srcDay.points && srcDay.points[0]) || { lat: 51.889, lng: 0.903 };
      anchors = [
        { lat: base.lat,            lng: base.lng },
        { lat: base.lat+0.0010,     lng: base.lng+0.0020 },
        { lat: base.lat+0.0020,     lng: base.lng+0.0040 },
        { lat: base.lat+0.0025,     lng: base.lng+0.0060 },
        { lat: base.lat+0.0010,     lng: base.lng+0.0080 },
        { lat: base.lat-0.0005,     lng: base.lng+0.0100 }
      ];
    }

    // Slight jitter so days don’t look copy/pasted
    const anchorsJ = jitterAnchors(anchors, 6);

    const points = generateDay({ key, ymd, anchors: anchorsJ, totalPoints: TOTAL });
    if (!points) {
      console.warn(`[skip] could not generate for ${key}; copying original`);
      OUT[key] = srcDay;
      continue;
    }

    OUT[key] = { points, areas };
  }

  writeJSON(args.out, OUT);
})();
