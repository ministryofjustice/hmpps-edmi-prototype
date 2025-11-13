// scripts/fix-scenarios-nov01.js
// Fixes /app/assets/data/gps-traces-bh-demo-nov01.json to contain ONLY
// 2025-11-01 .. 2025-11-11, generating missing days with believable movement.

const fs = require('fs');
const path = require('path');

// ---- Paths (adjust if yours differ)
const SRC = path.join(__dirname, '..', 'app', 'assets', 'data', 'gps-traces-bh-demo-nov01.json');
const DST = SRC; // overwrite in place; change to a new filename if you want to keep the old

function keyFor(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `bh_${y}${m}${day}`;
}

function isoLocal(d) {
  // ISO string without timezone conversion (we want local-like timestamps)
  const pad2 = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

function genWalk(startLat, startLng, startDate, minutes = 360, stepMin = 5, drift = ['E', 0.00025]) {
  // Random walk that trends in a direction so the path *moves*.
  let lat = startLat;
  let lng = startLng;
  const out = [];
  const steps = Math.floor(minutes / stepMin);
  const [dir, mag] = drift;

  for (let i = 0; i <= steps; i++) {
    const t = new Date(startDate.getTime() + i * stepMin * 60 * 1000);
    out.push({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      time: isoLocal(t)
    });

    // jitter
    lat += (Math.random() * 0.00024 - 0.00012);
    lng += (Math.random() * 0.00024 - 0.00012);

    // drift
    if (dir === 'E') lng += mag;
    else if (dir === 'W') lng -= mag;
    else if (dir === 'N') lat += mag;
    else if (dir === 'S') lat -= mag;
  }
  return out;
}

function main() {
  // Load existing (if present)
  let src = {};
  try {
    src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  } catch (e) {
    console.warn('Could not read source JSON, will build fresh:', e.message);
    src = {};
  }

  const start = new Date(2025, 10, 1);  // 1 Nov 2025 (month is 0-based)
  const end   = new Date(2025, 10, 11); // 11 Nov 2025

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d.getTime()));
  }

  // Base near Colchester; daily offset so paths aren't identical
  const baseLat = 51.889, baseLng = 0.899;

  const out = {};
  days.forEach((day, i) => {
    const k = keyFor(day);
    const existing = src[k];

    if (existing && Array.isArray(existing.points) && existing.points.length >= 10) {
      // keep usable existing day
      out[k] = {
        points: existing.points.slice(),
        areas: Array.isArray(existing.areas) ? existing.areas.slice() : []
      };
      return;
    }

    // Generate a fresh day:
    // Start around 09:15–10:30 to feel real, 6h of 5-min pings (good for demo)
    const startHour = 9 + (i % 2);                // 9 or 10
    const startMin  = 15 + ((i * 3) % 30);        // 15..45
    const startDt   = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, startMin, 0, 0);

    // Daily drift variety (mainly East; some North-ish to add interest)
    let drift;
    if (i % 3 === 0) drift = ['E', 0.00022];
    else if (i % 3 === 1) drift = ['N', 0.00018];
    else drift = ['E', 0.00028];

    // Slightly move the start each day
    const startLat = baseLat + i * 0.0006;
    const startLng = baseLng - i * 0.0004;

    const points = genWalk(startLat, startLng, startDt, /*minutes*/ 360, /*step*/ 5, drift);

    // Minimal area polygon for context (matches your schema)
    const dlat = 0.0015, dlng = 0.0015;
    const area = {
      label: 'Home vicinity',
      timeanddate: day.toISOString().slice(0,10),
      coordinates: [
        { lat: startLat - dlat, lng: startLng - dlng },
        { lat: startLat - dlat, lng: startLng + dlng },
        { lat: startLat + dlat, lng: startLng + dlng },
        { lat: startLat + dlat, lng: startLng - dlng }
      ]
    };

    out[k] = { points, areas: [area] };
  });

  // Write fixed file
  fs.writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');

  // Helpful console summary
  const keys = Object.keys(out).sort();
  console.log('[fix-scenarios] wrote:', DST);
  console.log('[fix-scenarios] days:', keys[0], '…', keys[keys.length - 1], `(count: ${keys.length})`);
  console.log('[fix-scenarios] first day points:', out[keys[0]].points.length);
}

main();
