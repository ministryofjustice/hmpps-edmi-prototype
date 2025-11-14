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
//   - Add strong curvature between anchors, GPS-style drift and
//     larger stop clusters so it looks like messy real-world data
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

// Simple piecewise linear interpolation along an anchor list
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

// Convert a "jitter in metres" into small lat/lng offsets (approximate).
function jitterLatLng(lat, lng, meters) {
  if (!meters || meters <= 0) return { lat, lng };

  const metersPerDegLat = 111000; // ~111km per degree latitude
  const metersPerDegLng = 111000 * Math.cos(lat * Math.PI / 180);

  const maxLatOffsetDeg = meters / metersPerDegLat;
  const maxLngOffsetDeg = meters / metersPerDegLng;

  const jLat = (Math.random() - 0.5) * 2 * maxLatOffsetDeg;
  const jLng = (Math.random() - 0.5) * 2 * maxLngOffsetDeg;

  return {
    lat: lat + jLat,
    lng: lng + jLng
  };
}

// Build a "curved" anchor list by inserting bent midpoints between anchors
// so the route bows and kinks instead of being perfectly straight.
function buildCurvedAnchors(anchorList) {
  if (!Array.isArray(anchorList) || anchorList.length < 2) {
    return anchorList || [];
  }

  const out = [];
  for (let i = 0; i < anchorList.length - 1; i++) {
    const a = anchorList[i];
    const b = anchorList[i + 1];

    if (i === 0) {
      out.push(a);
    }

    // Midpoint between a and b
    const midLat = (a.lat + b.lat) / 2;
    const midLng = (a.lng + b.lng) / 2;

    // Strong sideways bend: 20–60m jitter at the midpoint
    const bendMeters = 20 + Math.random() * 40;
    const bentMid = jitterLatLng(midLat, midLng, bendMeters);

    out.push({ lat: bentMid.lat, lng: bentMid.lng });
    out.push(b);
  }
  return out;
}

// Build one day’s noisy, curved, clustered trace
function buildDay(dayKey, anchorList, existingDay) {
  // Base backbone points; clusters get added on top.
  const BASE_POINTS = 230;

  // First, bend the anchor list so segments arc instead of being straight.
  const curvedAnchors = buildCurvedAnchors(anchorList);
  const sample = makeAnchorSampler(curvedAnchors);

  // dayKey like "bh_20251103"
  const ymd = dayKey.replace(/^bh_/, ''); // "20251103"
  const year  = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day   = Number(ymd.slice(6, 8));

  const pad2 = (n) => String(n).padStart(2, '0');

  const minutesInDay = 24 * 60; // 1440
  const backbonePoints = [];
  let labelCounter = 0;

  // --- Variable speed: build a non-linear time mapping ---
  // Random weights along the route, then normalise to [0,1].
  const weights = [];
  for (let i = 0; i < BASE_POINTS; i++) {
    // 0.4–2.0 weight range: some slow, some fast
    weights.push(0.4 + Math.random() * 1.6);
  }
  const totalW = weights.reduce((a, b) => a + b, 0);
  const timeUs = [];
  let cum = 0;
  for (let i = 0; i < BASE_POINTS; i++) {
    cum += weights[i];
    timeUs.push(cum / totalW); // monotonically increasing 0..1
  }

  const BACKBONE_JITTER_METERS = 18; // general wobble around the route
  const BLIP_PROBABILITY       = 0.08; // ~8% of points with big GPS blips
  const BLIP_MIN_METERS        = 25;
  const BLIP_EXTRA_RANGE       = 15;   // so 25–40m blips

  for (let i = 0; i < BASE_POINTS; i++) {
    const spatialU = i / (BASE_POINTS - 1); // 0..1 along geometry
    const timeU    = timeUs[i];             // 0..1 along time

    const sampled = sample(spatialU);
    let lat = sampled.lat;
    let lng = sampled.lng;

    // Apply strong jitter around the curved path
    const jittered = jitterLatLng(lat, lng, BACKBONE_JITTER_METERS);
    lat = jittered.lat;
    lng = jittered.lng;

    // Occasional bigger GPS blips (20–40m jumps)
    if (Math.random() < BLIP_PROBABILITY) {
      const blipMeters = BLIP_MIN_METERS + Math.random() * BLIP_EXTRA_RANGE;
      const blipped = jitterLatLng(lat, lng, blipMeters);
      lat = blipped.lat;
      lng = blipped.lng;
    }

    // Time based on the warped timeU (variable speed)
    const mins = Math.round(timeU * (minutesInDay - 1)); // 0..1439
    const hh = pad2(Math.floor(mins / 60));
    const mm = pad2(mins % 60);

    const time = `${year}-${pad2(month)}-${pad2(day)}T${hh}:${mm}`;

    // Mild jittered accuracy, roughly “GPS-ish”
    const baseAcc = 10;
    const accJitter  = Math.random() * 10;
    const accuracy = Math.round(baseAcc + accJitter);

    backbonePoints.push({
      lat,
      lng,
      time,
      accuracy,
      label: labelCounter++
    });
  }

  // --- Add messy stop clusters on top of the backbone ---
  const points = [];

  // More frequent + bigger clusters
  const STOP_PROBABILITY = 0.22; // ~22% chance after a point
  const MAX_CLUSTER_JITTER_METERS = 10;

  for (let i = 0; i < backbonePoints.length; i++) {
    const p = backbonePoints[i];
    points.push(p);

    // Avoid stops right at the very start/end of the day
    if (i < 10 || i > backbonePoints.length - 10) continue;

    if (Math.random() < STOP_PROBABILITY) {
      // Bigger clusters: 4–8 extra points
      const clusterSize = 4 + Math.floor(Math.random() * 5); // 4,5,6,7,8

      for (let k = 0; k < clusterSize; k++) {
        const jittered = jitterLatLng(
          p.lat,
          p.lng,
          MAX_CLUSTER_JITTER_METERS
        );

        points.push({
          lat: jittered.lat,
          lng: jittered.lng,
          time: p.time,      // same minute = "stopped / lingered here"
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
