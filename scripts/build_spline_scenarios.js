#!/usr/bin/env node
// build_spline_scenarios.js — Chaos Mode + Road-ish bearing intelligence

const fs = require('fs');

if (process.argv.length < 5) {
  console.error(
    'Usage: node build_spline_scenarios.js <inJson> <anchorsJson> <outJson>'
  );
  process.exit(1);
}

const inPath      = process.argv[2];
const anchorsPath = process.argv[3];
const outPath     = process.argv[4];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const base    = readJson(inPath);
const anchors = readJson(anchorsPath);

// --- tiny helpers ---------------------------------------------------

function lerp(a, b, t) { return a + (b - a) * t; }

function bearing(a, b) {
  const lat1 = a.lat * Math.PI/180, lat2 = b.lat * Math.PI/180;
  const dLng = (b.lng - a.lng) * Math.PI/180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1)*Math.cos(lat2)*Math.cos(dLng) -
            Math.sin(lat1)*Math.sin(lat2);
  return (Math.atan2(y, x) * 180/Math.PI + 360) % 360;
}

function jitterLatLng(lat, lng, meters) {
  const mLat = meters / 111000;
  const mLng = meters / (111000 * Math.cos(lat*Math.PI/180));
  return {
    lat: lat + (Math.random()-0.5)*2*mLat,
    lng: lng + (Math.random()-0.5)*2*mLng
  };
}

function stepInBearing(lat, lng, bearingDeg, meters) {
  const br = bearingDeg * Math.PI/180;
  const dLat = (meters/111000) * Math.cos(br);
  const dLng = (meters/111000) * Math.sin(br) / Math.cos(lat*Math.PI/180);
  return { lat: lat + dLat, lng: lng + dLng };
}

// --- Build a strongly curved, bearing-aware anchor list -------------

function buildCurvedAnchors(anchors) {
  if (!anchors || anchors.length < 2) return anchors;

  const out = [];
  for (let i = 0; i < anchors.length-1; i++) {
    const a = anchors[i];
    const b = anchors[i+1];

    if (i === 0) out.push(a);

    const br = bearing(a, b);

    const angleOffset = 30 + Math.random()*40;    // 30–70 degrees
    const direction = (Math.random() < 0.5) ? -1 : 1;

    const bendMeters = 20 + Math.random()*40;     // 20–60 m offset

    const mid = stepInBearing(
      (a.lat+b.lat)/2,
      (a.lng+b.lng)/2,
      br + direction*angleOffset,
      bendMeters
    );

    out.push(mid);
    out.push(b);
  }
  return out;
}

// Create sampler for the curved anchors
function makeAnchorSampler(arr) {
  const n = arr.length;
  return u => {
    const s = u*(n-1);
    const i = Math.floor(s);
    const v = s - i;
    const a = arr[i], b = arr[Math.min(i+1,n-1)];
    return { lat: lerp(a.lat,b.lat,v), lng: lerp(a.lng,b.lng,v) };
  };
}

// --- Main day builder ------------------------------------------------

function buildDay(dayKey, anchorList, existingDay) {
  const BASE_POINTS = 230;
  const ymd = dayKey.replace(/^bh_/, '');
  const year = +ymd.slice(0,4), month = +ymd.slice(4,6), day = +ymd.slice(6,8);
  const pad2 = n => String(n).padStart(2,'0');

  const curved = buildCurvedAnchors(anchorList);
  const sample = makeAnchorSampler(curved);
  const minutesInDay = 1440;

  // --- Variable speed profile with corner-slowdown ------------------
  const weights = [];
  for (let i = 0; i < BASE_POINTS; i++) {
    let w = 0.6 + Math.random()*1.4;
    const u = i/(BASE_POINTS-1);

    // Slow near anchor transitions by boosting weight
    const segPos = u*(curved.length-1);
    const segIndex = Math.floor(segPos);
    const local = segPos - segIndex;
    if (local < 0.12 || local > 0.88) w *= 1.8; // slow before/after corners

    weights.push(w);
  }
  const totalW = weights.reduce((a,b) => a+b, 0);
  let acc = 0;
  const timeUs = weights.map(w => (acc+=w)/totalW);

  // --- Build backbone with jitter + blips + noise shadows ----------
  const points = [];
  let labelCounter = 1;

  const BLIP_P = 0.08;
  const SHADOW_COUNT = 2 + Math.floor(Math.random()*2); // 2–3 shadows
  const shadowStarts = [];

  for (let s=0; s<SHADOW_COUNT; s++) {
    shadowStarts.push(Math.floor(Math.random()*(BASE_POINTS-10)));
  }

  for (let i = 0; i < BASE_POINTS; i++) {
    const uGeom = i/(BASE_POINTS-1);
    const uTime = timeUs[i];

    const base = sample(uGeom);
    let { lat, lng } = base;

    lat = jitterLatLng(lat, lng, 18).lat;
    lng = jitterLatLng(base.lat, base.lng, 18).lng;

    if (Math.random() < BLIP_P) {
      const m = 25 + Math.random()*15;
      const j = jitterLatLng(lat,lng,m);
      lat = j.lat; lng = j.lng;
    }

    let inShadow = shadowStarts.some(s => i>=s && i<s+6);
    if (inShadow) {
      const m = 25 + Math.random()*25;
      const br = Math.random()*360;
      const step = stepInBearing(lat,lng,br,m);
      lat = step.lat; lng = step.lng;
    }

    const mins = Math.round(uTime * (minutesInDay-1));
    const hh = pad2(Math.floor(mins/60));
    const mm = pad2(mins % 60);
    const time = `${year}-${pad2(month)}-${pad2(day)}T${hh}:${mm}`;

    points.push({
      lat, lng, time,
      accuracy: Math.round(10 + Math.random()*10),
      label: labelCounter++
    });

    // --- Junction dwell ---
    const segPos = uGeom*(curved.length-1);
    const local = segPos - Math.floor(segPos);
    if (local < 0.08 || local > 0.92) {
      if (Math.random() < 0.35 && i>2 && i<BASE_POINTS-3) {
        const dwellCount = 2 + Math.floor(Math.random()*3);
        for (let d=0; d<dwellCount; d++) {
          const j = jitterLatLng(lat,lng,6+Math.random()*6);
          points.push({
            lat: j.lat,
            lng: j.lng,
            time,
            accuracy: Math.round(10 + Math.random()*10),
            label: labelCounter++
          });
        }
      }
    }
  }

  const areas = Array.isArray(existingDay?.areas) ? existingDay.areas : [];
  return { points, areas };
}

// --- Main loop ------------------------------------------------------

for (const dayKey of Object.keys(anchors)) {
  const list = anchors[dayKey];
  if (!list?.length) {
    console.warn('Skipping', dayKey, '- no anchors');
    continue;
  }
  const ex = base[dayKey] || {};
  const dayObj = buildDay(dayKey, list, ex);
  base[dayKey] = dayObj;
  console.log('[build_spline_scenarios]', dayKey, dayObj.points.length, 'pts');
}

fs.writeFileSync(outPath, JSON.stringify(base, null, 2));
console.log('[build_spline_scenarios] wrote', outPath);
