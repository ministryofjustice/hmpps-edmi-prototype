#!/usr/bin/env node
// build_spline_scenarios.js
//
// Usage:
//   node scripts/build_spline_scenarios.js \
//     app/assets/data/gps-traces-bh-demo-nov01.json \
//     app/assets/data/anchors.json \
//     app/assets/data/gps-traces-bh-demo-nov01.json
//
// It will:
//   - Read the existing scenarios JSON
//   - Read anchors.json (your 6 anchor points per day)
//   - For each bh_YYYYMMDD in anchors, generate ~300–350 points
//     spread across the full 24h, interpolating between anchors
//   - Add stronger jitter and more frequent "stop" clusters so it
//     looks more like real GPS data
//   - Preserve any existing `areas` polygons for that day
//   - Write back to outPath

const fs = require('fs');
const path = require('path');

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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Simple piecewise linear interpolation along the anchor list
function makeAnchorSampler(anchorList) {
  const n = anchorList.length;
  return function sample(u) {
    if (n === 1) return anchorList[0];
    const s = u * (n - 1);
    const i = Math.floor(s);
    const v = s - i;
    const a = anchorList[i];
    const b = anchorList[Math.min(i + 1, n - 1)];
    return {
      lat: lerp(a.lat, b.lat, v),
      lng: lerp(a.lng, b.lng, v)
    };
  };
}

// Convert a "jitter in metres" into small lat/lng offsets.
// Approximate is fine – we just want a few–tens of metres of wobble.
function jitterLatLng(lat, lng, meters) {
  const metersPerDegLat = 111_000;            // ~111 km per degree
  const metersPerDegLng = 111_000 * Math.cos(lat * Math.PI / 180);

  const maxLatOffsetDeg = meters / metersPerDegLat;
  const maxLngOffsetDeg = meters / metersPerDegLng;

  const jLat = (Math.random() - 0.5) * 2 * maxLatOffsetDeg;
  const jLng = (Math.random() - 0.5) * 2 * maxLngOffsetDeg;

  return {
    lat: lat + jLat,
    lng: lng + jLng
  };
}

function buildDay(dayKey, anchorList, existingDay) {
  // Base number of "backbone" points along the route.
  // Extra stop-cluster points get added on top.
  const BASE_POINTS = 240;

  const sample = makeAnchorSampler(anchorList);

  // dayKey like "bh_20251103"
  const ymd = dayKey.replace(/^bh_/, ''); // "20251103"
  const year  = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day   = Number(ymd.slice(6, 8));

  const pad2 = (n) => String(n).padStart(2, '0');

  const backbonePoints = [];
  const minutesInDay = 24 * 60; // 1440

  let labelCounter = 0;

  // Stronger backbone jitter so the path is clearly not a perfect line
  const BACKBONE_JITTER_METERS = 15; // was ~6m before

  for (let i = 0; i < BASE_POINTS; i++) {
    const u = i / (BASE_POINTS - 1); // 0..1 along the whole day
    const { lat, lng } = sample(u);

    // Spread timestamps across the whole day
    const mins = Math.round(u * (minutesInDay - 1)); // 0..1439
    const hh = pad2(Math.floor(mins / 60));
    const mm = pad2(mins % 60);

    const time = `${year}-${pad2(month)}-${pad2(day)}T${hh}:${mm}`;

    // Mild jittered accuracy, roughly “GPS-ish”
    const baseAcc = 10;
    const accJitter  = Math.random() * 8;
    const accuracy = Math.round(baseAcc + accJitter);

    // Add more metres of positional jitter so the line isn't straight
    const jittered = jitterLatLng(lat, lng, BACKBONE_JITTER_METERS);

    backbonePoints.push({
      lat: jittered.lat,
      lng: jittered.lng,
      time,
      accuracy,
      label: labelCounter++
    });
  }

  // Create the final list, adding more frequent and larger "stop clusters"
  const points = [];

  // Higher probability of a stop after a point
  const STOP_PROBABILITY = 0.18; // ~18% chance after a point
  // Stop clusters spread a bit wider than before
  const MAX_EXTRA_JITTER_METERS = 8;

  for (let i = 0; i < backbonePoints.length; i++) {
    const p = backbonePoints[i];
    points.push(p);

    // Avoid stops right at the very start/end of the day
    if (i < 10 || i > backbonePoints.length - 10) continue;

    if (Math.random() < STOP_PROBABILITY) {
      // Bigger clusters: 3–6 extra points
      const clusterSize = 3 + Math.floor(Math.random() * 4); // 3,4,5,6

      for (let k = 0; k < clusterSize; k++) {
        const jittered = jitterLatLng(
          p.lat,
          p.lng,
          MAX_EXTRA_JITTER_METERS
        );

        points.push({
          lat: jittered.lat,
          lng: jittered.lng,
          time: p.time,      // same minute = "stopped here for a bit"
          accuracy: p.accuracy,
          label: labelCounter++
        });
      }
    }
  }

  // Preserve any existing areas (polygons) for that day
  let areas = [];
  if (existingDay && Array.isArray(existingDay.areas)) {
    areas = existingDay.areas;
  }

  return { points, areas };
}

// ---- main transform ----
for (const dayKey of Object.keys(anchors)) {
  const anchorList = anchors[dayKey];
  if (!Array.isArray(anchorList) || !anchorList.length) {
    console.warn('[build_spline_scenarios] Skipping', dayKey, '- no anchors');
    continue;
  }

  const existing = base[dayKey] || {};
  const dayObj   = buildDay(dayKey, anchorList, existing);
  base[dayKey]   = dayObj;

  console.log(
    '[build_spline_scenarios] built day',
    dayKey,
    'points:', dayObj.points.length,
    'areas:', (dayObj.areas || []).length
  );
}

// Write out
fs.writeFileSync(outPath, JSON.stringify(base, null, 2));
console.log('[build_spline_scenarios] wrote', outPath);
