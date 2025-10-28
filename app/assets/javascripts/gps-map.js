// /public/javascripts/gps-map.js
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  function $(sel, root = document) { return root.querySelector(sel); }

  // Wait until Leaflet map is attached to window.map (handles soft reloads)
  function whenMapReady(cb, tries = 40) {
    if (window.map && typeof window.map.addLayer === 'function') return cb();
    if (tries <= 0) return console.warn('[gps-map] Map not ready after waiting.');
    setTimeout(() => whenMapReady(cb, tries - 1), 50);
  }

// ---------- per-page config with sensible defaults ----------
const CFG = Object.assign({
  DEFAULT_LOI_URL: '/public/data/gps-traces-bh.json',
  SCENARIOS_URL:   '/public/data/gps-traces-bh-demo-oct22.json',
  DEFAULT_SCENARIO_KEY: 'bh_20251022'   // safe fallback string
}, (window.GPS_CONFIG || {}));

// Make available to other files
window.CFG = CFG;

// add near your CFG block
const MINI_POINTS = (CFG.MINI_TRACE_POINTS || 30);

// --- first-load mini trace (latest N points) ---
whenMapReady(async () => {
  if (window.__bh_initial_plotted) return;
  window.__bh_initial_plotted = true;

  try {
    const data = await (await fetch(CFG.SCENARIOS_URL, { cache: 'no-store' })).json();
    const base = data[CFG.DEFAULT_SCENARIO_KEY];
    if (!base || !Array.isArray(base.points) || base.points.length === 0) {
      console.warn('[gps-map] scenario missing or empty; plotting fallback default');
      await plotTrace(CFG.DEFAULT_SCENARIO_KEY, {
        scrollToMap: false,
        highlightRowEl: null,
        dataUrl: CFG.SCENARIOS_URL
      });
      return;
    }

    // Take the last N points by index (not by time window)
    const pts = base.points.slice(-MINI_POINTS);
    const mini = { ...base, points: pts };

    await window.plotTraceObject(mini, {
      scrollToMap: false,
      highlightRowEl: null
    });
  } catch (e) {
    console.warn('[gps-map] mini-trace preload failed; plotting fallback:', e);
    await plotTrace(CFG.DEFAULT_SCENARIO_KEY, {
      scrollToMap: false,
      highlightRowEl: null,
      dataUrl: CFG.SCENARIOS_URL
    });
  }
});



  // Convert HTML like "Wednesday 3 September<br/>2025" to "Wednesday 3 September 2025"
  function htmlToPlain(html) {
    if (typeof html !== 'string') return '';
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extract the time range (text after the first comma) from
  // "Thursday 24 July 2025, 9:33pm to 10:42pm"
  function extractTimeRange(timeanddate) {
    if (!timeanddate || typeof timeanddate !== 'string') return '';
    const idx = timeanddate.indexOf(',');
    if (idx === -1) return '';
    return timeanddate.slice(idx + 1).trim();
  }

  // cache per-URL
  const dataCache = new Map();

  // fallback single group (when overlay groups aren’t present)
  let plotGroup = null;

  // keep last highlighted row
  let highlightedRow = null;

  // ---------- overlay group helpers ----------
  function getGroups(map) {
    if (window.mapLayers) {
      return {
        directionInfo: window.mapLayers.directionInfo || L.layerGroup().addTo(map), // track + arrows together
        accuracy:      window.mapLayers.accuracy      || L.layerGroup(),
        numbers:       window.mapLayers.numbers       || L.layerGroup().addTo(map),
        areas:         window.mapLayers.areas         || L.layerGroup().addTo(map)
      };
    }
    if (!plotGroup) plotGroup = L.layerGroup().addTo(map);
    return {
      directionInfo: plotGroup,
      accuracy:      plotGroup,
      numbers:       plotGroup,
      areas:         plotGroup
    };
  }

  function clearGroups(groups) {
    groups.directionInfo.clearLayers();
    groups.accuracy.clearLayers();
    groups.numbers.clearLayers();
    groups.areas.clearLayers();
  }

  async function loadGpsData(url) {
    const key = url;
    if (dataCache.has(key)) return dataCache.get(key);
    const res = await fetch(key, { cache: 'no-store' });
    const json = await res.json();
    dataCache.set(key, json);
    return json;
  }

  // --- Densify helpers (paste once) -------------------------------------------

// Ray-casting: point inside polygon?
function pointInPolygon(point, vs) {
  const x = point[1], y = point[0];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][1], yi = vs[i][0];
    const xj = vs[j][1], yj = vs[j][0];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Random point inside polygon by rejection sampling within its bbox
function randomPointInPolygon(polyLatLngs) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  polyLatLngs.forEach(p => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  });
  // try up to N times (polygon is small; this is fine)
  for (let i = 0; i < 2000; i++) {
    const lat = minLat + Math.random() * (maxLat - minLat);
    const lng = minLng + Math.random() * (maxLng - minLng);
    if (pointInPolygon([lat, lng], polyLatLngs.map(p => [p.lat, p.lng]))) {
      return { lat, lng };
    }
  }
  // fallback to centroid if something odd happens
  const c = polyLatLngs.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: c.lat / polyLatLngs.length, lng: c.lng / polyLatLngs.length };
}

// Make HH:MM minutes between a start and end time (strings 'HH:MM')
function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
function addMinutes(hhmm, m) {
  const [h, mm] = hhmm.split(':').map(Number);
  const t = h * 60 + mm + m;
  const H = Math.floor((t % 1440) / 60);
  const M = t % 60;
  return `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}`;
}

// --- helpers for random-walk densify ---
function metersToDegrees(lat, meters) {
  const dLat = meters / 111320; // ~111.32km per degree latitude
  const dLng = meters / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  return { dLat, dLng };
}

function polygonCentroid(poly) {
  // basic polygon centroid (lat/lng objects)
  let x = 0, y = 0, f, area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    f = (poly[i].lng * poly[j].lat) - (poly[j].lng * poly[i].lat);
    x += (poly[i].lng + poly[j].lng) * f;
    y += (poly[i].lat + poly[j].lat) * f;
    area += f;
  }
  area *= 0.5;
  if (!area) return { lat: poly[0].lat, lng: poly[0].lng };
  return { lat: y / (6 * area), lng: x / (6 * area) };
}


// Densify a trace: generate N extra points inside polygon, with label/accuracy/time,
// and return the LOI time window so the caller can splice into the right place.
function densifyTrace(original, areaPoly, opts) {
  const extra = opts?.count || 0;
  if (!extra || !Array.isArray(areaPoly) || !areaPoly.length) {
    return { points: [], startHHMM: null, endHHMM: null };
  }

  // Read LOI window from areas[0].timeanddate (e.g. "... 11:05am to 12:26pm")
  // Fallback to first/last original point times.
  const timeStr = original?.areas?.[0]?.timeanddate || '';
  const m = timeStr.match(/(\d{1,2}:\d{2})\s*(am|pm)\s*to\s*(\d{1,2}:\d{2})\s*(am|pm)/i);

  const to24 = (hhmm, ap) => {
    let [h, mm] = hhmm.split(':').map(Number);
    const apu = ap.toLowerCase();
    if (apu === 'pm' && h !== 12) h += 12;
    if (apu === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  };

  let startHHMM = original?.points?.[0]?.time || '11:05';
  let endHHMM   = original?.points?.[original.points.length - 1]?.time || '12:26';
  if (m) {
    startHHMM = to24(m[1], m[2]);
    endHHMM   = to24(m[3], m[4]);
  }

  const windowMins = Math.max(1, minutesBetween(startHHMM, endHHMM));
  const startLabel = Number(original?.points?.[0]?.label || 0); // we will relabel after merge
  const out = [];

  // pick a sensible anchor inside the LOI window if possible, else centroid
  const toMin = (s) => {
    const [H, M] = String(s || '00:00').split(':').map(Number);
    return H * 60 + M;
  };
  const sMin = toMin(startHHMM), eMin = toMin(endHHMM);
  const anchor = (original.points || []).find(p => {
    const t = toMin(p.time);
    return t >= sMin && t <= eMin;
  }) || polygonCentroid(areaPoly);

  let cur = { lat: anchor.lat, lng: anchor.lng };

  for (let i = 0; i < extra; i++) {
    // 8–35 m step, random bearing; keep steps modest so it "meanders"
    const stepMeters = 8 + Math.random() * 27;
    const bearing = Math.random() * 2 * Math.PI;
    const { dLat, dLng } = metersToDegrees(cur.lat, stepMeters);

    // candidate step
    let next = {
      lat: cur.lat + Math.sin(bearing) * dLat,
      lng: cur.lng + Math.cos(bearing) * dLng
    };

    // keep it inside the polygon: re-roll a few times, then snap to centroid
    let attempts = 0;
    while (
      !pointInPolygon([next.lat, next.lng], areaPoly.map(p => [p.lat, p.lng])) &&
      attempts < 4
    ) {
      const b2 = Math.random() * 2 * Math.PI;
      const m2 = 6 + Math.random() * 16;
      const d2 = metersToDegrees(cur.lat, m2);
      next = {
        lat: cur.lat + Math.sin(b2) * d2.dLat,
        lng: cur.lng + Math.cos(b2) * d2.dLng
      };
      attempts++;
    }
    if (!pointInPolygon([next.lat, next.lng], areaPoly.map(p => [p.lat, p.lng]))) {
      next = polygonCentroid(areaPoly);
    }

    const accuracy = Math.floor(8 + Math.random() * 33);
    const t = addMinutes(startHHMM, Math.floor((i % windowMins)));

    out.push({
      lat: +next.lat.toFixed(6),
      lng: +next.lng.toFixed(6),
      label: String(startLabel + i + 1), // temp label; we relabel after splice
      accuracy,
      time: t,
      isDensified: true
    });

    cur = next;
  }


  return { points: out, startHHMM, endHHMM };
}

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60) + m;
}

function spliceDensifiedIntoWindow(points, densified, startHHMM, endHHMM) {
  if (!densified?.length) return points;

  const startMin = hhmmToMinutes(startHHMM);
  const endMin   = hhmmToMinutes(endHHMM);

  // Find the first point whose time falls INSIDE the LOI window.
  const firstInsideIdx = points.findIndex(p => {
    const t = hhmmToMinutes(p.time);
    return t >= startMin && t <= endMin;
  });

  // Fallback: if none detected, insert near the start (but this should not happen)
  const insertAt = (firstInsideIdx === -1) ? 0 : firstInsideIdx + 1;

  const merged = points.slice();
  merged.splice(insertAt, 0, ...densified);

  // Renumber labels 1..N (keeps everything tidy for tooltips/overlays)
  for (let i = 0; i < merged.length; i++) {
    merged[i] = { ...merged[i], label: String(i + 1) };
  }
  return merged;
}




  // Build arrowed polyline; BOTH line and arrows go into "directionInfo"
  function addPolylineWithArrows(map, latlngs, groups) {
    const targetGroup = groups.directionInfo || L.layerGroup().addTo(map);

    const line = L.polyline(latlngs, { color: '#1d70b8', weight: 3, opacity: 0.9 });
    targetGroup.addLayer(line);

    if (L.polylineDecorator && L.Symbol && typeof L.Symbol.arrowHead === 'function') {
      const arrows = L.polylineDecorator(line, {
        patterns: [{
          offset: 12,
          repeat: 80,
          symbol: L.Symbol.arrowHead({
            pixelSize: 8,
            pathOptions: { weight: 2, opacity: 0.9, color: '#1d70b8' }
          })
        }]
      });
      targetGroup.addLayer(arrows);
    }
    return line;
  }

  // ------- formatting helpers for point popups --------
  function fmtNum(n, dp = 0) {
    return (typeof n === 'number') ? n.toFixed(dp) : '—';
  }
  function fmtCoord(n) {
    return (typeof n === 'number') ? n.toFixed(6) : '—';
  }
  function fmtTimeHHMM(val) {
    if (!val) return '—';

    if (typeof val === 'string') {
      const m = val.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (m) {
        const hh = m[1].padStart(2, '0');
        const mm = m[2];
        return `${hh}:${mm}`;
      }
      const d = new Date(val);
      if (!isNaN(d)) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }
      return '—';
    }

    if (val instanceof Date && !isNaN(val)) {
      const hh = String(val.getHours()).padStart(2, '0');
      const mm = String(val.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }

    if (typeof val === 'number') {
      const d = new Date(val);
      if (!isNaN(d)) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }
    }

    return '—';
  }

  function pointPopupHTML(pt, idx) {
    const label = (pt.label != null) ? String(pt.label) : String(idx + 1);
    const acc   = (typeof pt.accuracy === 'number') ? `${fmtNum(pt.accuracy, 0)}m` : '—';
    const time  = fmtTimeHHMM(pt.time);
    const lat   = fmtCoord(pt.lat);
    const lng   = fmtCoord(pt.lng);
    return `
      <div class="gps-point-card">
        <h4 class="govuk-heading-s govuk-!-margin-bottom-2">Point ${label}</h4>
        <dl class="govuk-summary-list govuk-!-margin-bottom-0">
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Accuracy</dt>
            <dd class="govuk-summary-list__value">${acc}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Time</dt>
            <dd class="govuk-summary-list__value">${time}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Lat / Lng</dt>
            <dd class="govuk-summary-list__value"><code>${lat}, ${lng}</code></dd>
          </div>
        </dl>
      </div>
    `;
  }

  // Build the "when" line for an Area card using an override date (from the LOI table) if provided.
  function buildAreaWhen(area, overrideDateText) {
    const timePart = extractTimeRange(area.timeanddate);
    if (overrideDateText) {
      return timePart ? `${overrideDateText}, ${timePart}` : `${overrideDateText}`;
    }
    return area.timeanddate || '';
  }

function areaPopupHTML(area, overrideDateText) {
  // 1) Remove anchors entirely, then all tags, then specific junk like "Send to NDelius"
  const cleanText = (s) => {
    let str = String(s || "");
    // remove <a ...>...</a> completely
    str = str.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
    // remove any remaining tags
    str = str.replace(/<\/?[^>]+>/g, "");
    // remove literal "Send to NDelius" if it snuck in via textContent
    str = str.replace(/\bSend\s+to\s+NDelius\b/gi, "");
    // tidy double spaces/stray commas
    str = str.replace(/\s{2,}/g, " ").replace(/\s*,\s*,/g, ",").replace(/\s+,/g, ",").trim();
    return str;
  };

  const escapeHTML = (s) => String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // Plain, safe values only
  const labelText = escapeHTML(cleanText(area.label || "Area"));
  const typeText  = escapeHTML(cleanText(area.type || ""));

  // buildAreaWhen may include the link text if it read from the table cell; clean it hard.
  const whenRaw  = buildAreaWhen(area, overrideDateText);
  const whenText = escapeHTML(cleanText(whenRaw));

  const typeChip = typeText ? `<span class="app-area-chip">${typeText}</span>` : "";

  // Optional building functions panel
  const hasFunctions = Array.isArray(area.buildingFunctions) && area.buildingFunctions.length > 0;
  const headingText  = escapeHTML(cleanText(area.notesHeading || "Mixed-use building:"));

  const notes = hasFunctions ? `
    <div class="app-popup-panel" role="group" aria-labelledby="bf-title">
      <div class="app-popup-panel__icon" aria-hidden="true">
        <img src="/public/images/icons/multi-use.svg" width="48" height="48" alt="">
      </div>
      <div class="app-popup-panel__content">
        <p id="bf-title" class="govuk-body-s govuk-!-margin-bottom-1 govuk-!-margin-top-0">
          ${headingText}
        </p>
        <ul class="app-popup-functions govuk-list govuk-list--bullet">
          ${area.buildingFunctions.map(item => `<li>${escapeHTML(cleanText(item))}</li>`).join("")}
        </ul>
      </div>
    </div>
  ` : "";

  const when = whenText
    ? `<p class="app-area-when govuk-!-margin-bottom-0 govuk-!-margin-top-0">${whenText}</p>`
    : "";

  return `
    <div class="app-area-card">
      <h4 class="govuk-heading-s govuk-!-margin-bottom-1">${labelText}</h4>
      ${typeChip}
      ${when}
      ${notes}
    </div>
  `;
}



  function accumulateBounds(bounds, latlngs) {
    latlngs.forEach(ll => bounds.extend(ll));
  }

  // ---------- plot by key (existing behaviour) ----------
async function plotTrace(traceKey, opts = {}) {
  const {
    scrollToMap = true,
    highlightRowEl = null,
    dataUrl = CFG.DEFAULT_LOI_URL
  } = opts;

  const map = window.map;
  if (!map || typeof map.addLayer !== 'function') {
    console.warn('[gps-map] window.map not ready yet.');
    return;
  }

  const data = await loadGpsData(dataUrl);

  const trace = data && data[traceKey];
  if (!trace) {
    console.error(`[gps-map] Trace not found for key: ${traceKey} (in ${dataUrl})`);
    return;
  }

  // If this was triggered from a table row, compute an override date from the first cell
  let overrideDateText = '';
  if (highlightRowEl) {
    const dateCell = highlightRowEl.querySelector('td');
    if (dateCell) {
      overrideDateText = htmlToPlain(dateCell.innerHTML).trim();
    }
  }

  // Delegate to object plotter
  return window.plotTraceObject(trace, { scrollToMap, highlightRowEl, overrideDateText });
}


  // ⚠️ Export plotTrace for other scripts (e.g. bh-update-map.js)
  window.plotTrace = plotTrace;

  // ---------- plot a provided trace object (for filtered scenarios) ----------
  window.plotTraceObject = async function (traceObj, opts = {}) {
    const {
      scrollToMap = true,
      highlightRowEl = null,
      overrideDateText = ''
    } = opts;

    const map = window.map;
    if (!map || typeof map.addLayer !== 'function') {
      console.warn('[gps-map] window.map not ready yet.');
      return;
    }

    const groups = getGroups(map);
    clearGroups(groups);

    const allBounds = L.latLngBounds([]);

    // ---- points, accuracy circles, numbered markers (+ POPUPS) ----
    const latlngs = [];
    (traceObj.points || []).forEach((pt, idx) => {
      const ll = [pt.lat, pt.lng];
      latlngs.push(ll);

if (Number.isFinite(pt.accuracy) && pt.accuracy > 0) {
  // Add the large confidence circle (existing behaviour)
  L.circle(ll, {
    radius: pt.accuracy,
    color: '#1d70b8',
    weight: 1,
    fillOpacity: 0.1
  }).addTo(groups.accuracy);

  // Add the small centre dot (new behaviour)
  if (window.addConfidenceCircle) {
    // uses the helper defined in map-overlays.js
    window.addConfidenceCircle(pt.lat, pt.lng, pt.accuracy);
  } else {
    // fallback if helper not loaded
    L.circleMarker(ll, {
      radius: 2.5,
      color: '#1d70b8',
      weight: 0,
      fillColor: '#1d70b8',
      fillOpacity: 1,
      interactive: false
    }).addTo(groups.accuracy);
  }
}


      const marker = L.marker(ll, { title: `Point ${idx + 1}` })
        .bindTooltip(String(pt.label || idx + 1), {
          permanent: true,
          direction: 'center',
          className: 'gps-point-label'
        })
        .addTo(groups.numbers);

      marker.bindPopup(pointPopupHTML(pt, idx), {
        closeButton: true,
        autoClose: true,
        closeOnClick: true,
        className: 'gps-point-popup'
      });
    });
    if (latlngs.length) accumulateBounds(allBounds, latlngs);

    // ---- polyline with arrows (Direction info) ----
    if (latlngs.length >= 2) {
      addPolylineWithArrows(map, latlngs, groups);
    }

    // ---- polygons / areas + always-visible info card ----
    (traceObj.areas || []).forEach(area => {
      const pts = (area.coordinates || []).map(c => [c.lat, c.lng]);
      if (pts.length >= 3) {
        const poly = L.polygon(pts, {
          color: '#DB90B7',
          fillColor: '#DB90B7',
          fillOpacity: 0.3,
          weight: 5,
          pane: 'loi-areas'   // <- draw in our high-z pane
        }).addTo(groups.areas);

        accumulateBounds(allBounds, pts);

        poly.bindPopup(areaPopupHTML(area, overrideDateText), {
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          className: 'app-area-popup'
        });
        poly.openPopup();
        poly.on('click', () => poly.openPopup());
      }
    });

    if (allBounds.isValid()) {
      groups.areas.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
      map.fitBounds(allBounds, { padding: [28, 28] });
    }

    if (highlightRowEl) {
      if (highlightedRow) highlightedRow.classList.remove('highlighted-row');
      highlightRowEl.classList.add('highlighted-row');
      highlightedRow = highlightRowEl;
    }

    if (scrollToMap) {
      const heading = document.getElementById('map');
      if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const status = document.getElementById('map-status');
    if (status) status.textContent = 'Map updated with filtered GPS trace.';
  };

  // ---------- wire up clicks & initial plot ----------
  onReady(function () {
    // Remove any server-side default highlight on first paint
    document.querySelectorAll('tr.highlighted-row').forEach(tr => tr.classList.remove('highlighted-row'));
    highlightedRow = null;

    // 1) LOI table “View” links
    document.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('.plot-link');
      if (!a) return;
      e.preventDefault();

      const key = a.dataset.trace;
      if (!key) return;

      const row = a.closest('tr');
      plotTrace(key, {
        scrollToMap: true,
        highlightRowEl: row,
        dataUrl: CFG.DEFAULT_LOI_URL
      });
    });


// 2) Default “latest 5 minutes” mini-trace on first load
whenMapReady(async () => {
  try {
    const scenariosUrl = CFG.SCENARIOS_URL;
    const lib = await loadGpsData(scenariosUrl);
    window.GPS_TRACES = lib; // expose for other modules

    // Get all bh_YYYYMMDD keys sorted by date
    const keys = Object.keys(lib).filter(k => /^bh_\d{8}$/.test(k))
                                 .sort((a, b) => {
                                   const da = new Date(`${a.slice(3,7)}-${a.slice(7,9)}-${a.slice(9,11)}T00:00:00Z`);
                                   const db = new Date(`${b.slice(3,7)}-${b.slice(7,9)}-${b.slice(9,11)}T00:00:00Z`);
                                   return da - db;
                                 });

    if (!keys.length) {
      console.warn('[gps-map] No scenario keys found; plotting fallback.');
      return plotTrace(CFG.DEFAULT_SCENARIO_KEY, {
        scrollToMap: false,
        highlightRowEl: null,
        dataUrl: scenariosUrl
      });
    }

    const latestKey = keys.at(-1);
    window.CFG.DEFAULT_SCENARIO_KEY = latestKey;

    // Build a mini-trace: only points from the last N minutes of the latest day
    const MINUTES = 60; // ← change to 4/5 as you like
    const trace = lib[latestKey] || { points: [] };
    const pts = Array.isArray(trace.points) ? trace.points.slice() : [];

    // Find max timestamp, then keep points within [max - MINUTES, max]
    const toDate = (p) => new Date(p.time);
    const maxDate = pts.reduce((acc, p) => {
      const d = toDate(p);
      return isNaN(d) ? acc : (d > acc ? d : acc);
    }, new Date(0));

    const windowStart = new Date(maxDate.getTime() - MINUTES * 60 * 1000);
    const mini = pts.filter(p => {
      const d = toDate(p);
      return !isNaN(d) && d >= windowStart && d <= maxDate;
    });

    // If we somehow get fewer than 2 points, fall back to last 10 points
    const pointsToPlot = (mini.length >= 2) ? mini
                         : pts.slice(Math.max(0, pts.length - 10));

    // Renumber labels 1..N and keep accuracy/time as-is
    const miniTrace = {
      meta: {
        description: `Latest ${MINUTES} minutes from ${latestKey}`,
        point_count: pointsToPlot.length
      },
      points: pointsToPlot.map((p, i) => ({
        lat: p.lat, lng: p.lng,
        label: String(i + 1),
        accuracy: p.accuracy,
        time: p.time
      })),
      areas: [] // none for the mini trace
    };

    // Plot just this compact trace
    if (miniTrace.points.length >= 2) {
      return window.plotTraceObject(miniTrace, {
        scrollToMap: false,
        highlightRowEl: null,
        overrideDateText: '' // let popup use times only
      });
    }

    // Fallback to single default if mini couldn't be built
    plotTrace(latestKey, {
      scrollToMap: false,
      highlightRowEl: null,
      dataUrl: scenariosUrl
    });
  } catch (e) {
    console.warn('[gps-map] scenario preload failed; plotting single default:', e);
    plotTrace(CFG.DEFAULT_SCENARIO_KEY, {
      scrollToMap: false,
      highlightRowEl: null,
      dataUrl: CFG.SCENARIOS_URL
    });
  }
});


  });

  // ---------- dev helper: click map to log coords ----------
  onReady(function () {
    if (window.map && typeof window.map.on === 'function') {
      window.map.on('click', function (e) {
        const { lat, lng } = e.latlng;
        console.log(`{ "lat": ${lat.toFixed(6)}, "lng": ${lng.toFixed(6)} },`);
      });
    }
  });
  
})();
