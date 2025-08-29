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

  // Data sources
  const DEFAULT_LOI_URL = '/public/data/gps-traces-bh.json';
  const SCENARIOS_URL   = '/public/data/gps-traces-bh-demo.json'; // ← scenarios file in use

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
    const key = url || DEFAULT_LOI_URL;
    if (dataCache.has(key)) return dataCache.get(key);
    const res = await fetch(key, { cache: 'no-store' });
    const json = await res.json();
    dataCache.set(key, json);
    return json;
  }

  // Build arrowed polyline; BOTH line and arrows go into "directionInfo"
  function addPolylineWithArrows(map, latlngs, groups) {
    const targetGroup = groups.directionInfo || L.layerGroup().addTo(map);

    // Trail line (BLUE)
    const line = L.polyline(latlngs, { color: '#1d70b8', weight: 3, opacity: 0.9 });
    targetGroup.addLayer(line);

    // Direction arrows (BLUE)
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

  function areaPopupHTML(area) {
    const label = area.label || 'Area';
    const type = area.type ? `<span class="app-area-chip">${area.type}</span>` : '';
    const when = area.timeanddate ? `<p class="app-area-when govuk-!-margin-bottom-0 govuk-!-margin-top-0">${area.timeanddate}</p>` : '';
    return `
      <div class="app-area-card">
        <h4 class="govuk-heading-s govuk-!-margin-bottom-1">${label}</h4>
        ${type}
        ${when}
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
      dataUrl = DEFAULT_LOI_URL   // <<< default = original LOI file
    } = opts;

    const map = window.map;
    if (!map || typeof map.addLayer !== 'function') {
      console.warn('[gps-map] window.map not ready yet.');
      return;
    }

    // fetch & pick trace (from the specified dataset)
    const data = await loadGpsData(dataUrl);
    const trace = data && data[traceKey];
    if (!trace) {
      console.error(`[gps-map] Trace not found for key: ${traceKey} (in ${dataUrl})`);
      return;
    }

    // Delegate to object plotter
    return window.plotTraceObject(trace, { scrollToMap, highlightRowEl });
  }

  // ---------- plot a provided trace object (for filtered scenarios) ----------
  window.plotTraceObject = async function (traceObj, opts = {}) {
    const {
      scrollToMap = true,
      highlightRowEl = null
    } = opts;

    const map = window.map;
    if (!map || typeof map.addLayer !== 'function') {
      console.warn('[gps-map] window.map not ready yet.');
      return;
    }

    const groups = getGroups(map);
    clearGroups(groups);

    const allBounds = L.latLngBounds([]);

    // ---- points, accuracy circles, numbered markers ----
    const latlngs = [];
    (traceObj.points || []).forEach((pt, idx) => {
      const ll = [pt.lat, pt.lng];
      latlngs.push(ll);

      if (Number.isFinite(pt.accuracy) && pt.accuracy > 0) {
        // keep accuracy circles BLUE (subtle)
        L.circle(ll, { radius: pt.accuracy, color: '#1d70b8', weight: 1, fillOpacity: 0.1 })
          .addTo(groups.accuracy);
      }

      L.marker(ll, { title: `Point ${idx + 1}` })
        .bindTooltip(String(pt.label || idx + 1), {
          permanent: true,
          direction: 'center',
          className: 'gps-point-label'
        })
        .addTo(groups.numbers);
    });
    if (latlngs.length) accumulateBounds(allBounds, latlngs);

    // ---- polyline with arrows (Direction info) - BLUE ----
    if (latlngs.length >= 2) {
      addPolylineWithArrows(map, latlngs, groups);
    }

    // ---- polygons / areas (LOIs) - PINK ----
    (traceObj.areas || []).forEach(area => {
      const pts = (area.coordinates || []).map(c => [c.lat, c.lng]);
      if (pts.length >= 3) {
        const poly = L.polygon(pts, {
          color: '#d53880',       // pink outline
          fillColor: '#d53880',   // pink fill
          fillOpacity: 0.3,
          weight: 2
        }).addTo(groups.areas);

        accumulateBounds(allBounds, pts);

        poly.bindPopup(areaPopupHTML(area), {
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          className: 'app-area-popup'
        });
        poly.openPopup();
        poly.on('click', () => poly.openPopup());
      }
    });

    // ---- fit to everything we added ----
    if (allBounds.isValid()) {
      map.fitBounds(allBounds, { padding: [28, 28] });
    }

    // ---- highlight the clicked row (sticky) ----
    if (highlightRowEl) {
      if (highlightedRow) highlightedRow.classList.remove('highlighted-row');
      highlightRowEl.classList.add('highlighted-row');
      highlightedRow = highlightRowEl;
    }

    // ---- optionally scroll to the map heading on user action ----
    if (scrollToMap) {
      const heading = document.getElementById('map-header');
      if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // status live region
    const status = document.getElementById('map-status');
    if (status) status.textContent = 'Map updated with filtered GPS trace.';
  };

  // ---------- wire up clicks & initial plot ----------
  onReady(function () {
    // 1) LOI table “View” links: ALWAYS use the original LOI JSON
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
        dataUrl: DEFAULT_LOI_URL   // <<< lock to LOI dataset here
      });
    });

    // 2) Auto-load first row on page load (NO SCROLL), also from LOI dataset
    const firstLink = document.querySelector('.plot-link');
    if (firstLink) {
      const firstTrace = firstLink.dataset.trace;
      const firstRow = firstLink.closest('tr');
      plotTrace(firstTrace, {
        scrollToMap: false,
        highlightRowEl: firstRow,
        dataUrl: DEFAULT_LOI_URL    // <<< lock to LOI dataset here
      });
    }

    // 3) Expose helpers for scenarios usage
    window.__BH_SCENARIOS_URL = SCENARIOS_URL;
    window.plotTraceFromScenarios = function (key, opts = {}) {
      return plotTrace(key, { ...opts, dataUrl: SCENARIOS_URL });
    };
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
