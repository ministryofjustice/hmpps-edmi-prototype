// /public/javascripts/bh-update-map.js
(function () {
  'use strict';

  // ---------- helpers ----------
  // Convert dd/mm/yyyy -> Date (UTC midnight)
  function pickerDateToUTC(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    let [dd, mm, yyyy] = parts.map(s => s.trim());
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0);
    if (Number.isNaN(d)) return null;
    return new Date(d);
  }

  // Read minutes from paired hour/minute inputs (e.g. "bh-time-from-hour", "bh-time-from-min")
  function readHourMin(prefix) {
    const hourEl = document.getElementById(prefix + '-hour');
    const minEl  = document.getElementById(prefix + '-min');
    if (!hourEl || !minEl) return null;

    const hh = parseInt(hourEl.value, 10);
    const mm = parseInt(minEl.value, 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  function minutesToHM(m) {
    if (m == null) return null;
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function setStatus(msg) {
    const el = document.getElementById('map-status') || document.getElementById('bh-map-status');
    if (el) el.textContent = msg;
    console.log('[bh]', msg);
  }

  async function loadScenarios() {
    const url = (window.__BH_SCENARIOS_URL) || '/public/data/gps-traces-bh-2025.json';
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return { url, json };
  }

  // Build an inclusive list of bh_YYYYMMDD keys between two UTC dates
  function keysBetweenDatesUTC(startDate, endDate) {
    const keys = [];
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    while (d <= end) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      keys.push(`bh_${y}${m}${day}`);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return keys;
  }

  // Filter an array of points by an absolute UTC datetime window [fromDT, toDT]
  function filterPointsByUTCWindow(points, fromDT, toDT) {
    const fromT = fromDT.getTime();
    const toT   = toDT.getTime();
    return (points || []).filter(pt => {
      if (!pt.time) return false;
      const t = Date.parse(pt.time); // ISO Z → ms since epoch
      return t >= fromT && t <= toT;
    });
  }

  // ---------- main ----------
  async function handleUpdate(ev) {
    if (ev) {
      ev.preventDefault();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    }

    // Dates (DD/MM/YYYY via MOJ pickers)
    const fromDateStr = document.getElementById('bh-date-from')?.value || '';
    const toDateStr   = document.getElementById('bh-date-to')?.value || fromDateStr;

    const fromDateUTC = pickerDateToUTC(fromDateStr);
    const toDateUTC   = pickerDateToUTC(toDateStr);

    if (!fromDateUTC || !toDateUTC) {
      setStatus('Please choose valid From and To dates.');
      return;
    }

    // Times (paired hour/min containers)
    const fromMin = readHourMin('bh-time-from'); // e.g. 23:30 → 1410
    const toMin   = readHourMin('bh-time-to');   // e.g. 06:30 → 390
    const fromLbl = minutesToHM(fromMin) || '00:00';
    const toLbl   = minutesToHM(toMin)   || '23:59';

    // Construct absolute UTC datetimes from date + mins
    const fromDT = new Date(Date.UTC(
      fromDateUTC.getUTCFullYear(),
      fromDateUTC.getUTCMonth(),
      fromDateUTC.getUTCDate(),
      Math.floor((fromMin ?? 0) / 60),
      (fromMin ?? 0) % 60,
      0
    ));

    let toDT = new Date(Date.UTC(
      toDateUTC.getUTCFullYear(),
      toDateUTC.getUTCMonth(),
      toDateUTC.getUTCDate(),
      Math.floor((toMin ?? (23*60+59)) / 60),
      (toMin ?? (23*60+59)) % 60,
      59
    ));

    // Support wrap when user selects same day but time-to < time-from (treat as next day)
    if (toDT.getTime() < fromDT.getTime()) {
      toDT = new Date(toDT.getTime() + 24 * 60 * 60 * 1000);
    }

    const { url, json } = await loadScenarios();

    // Collect keys in the date range, pull points, then filter by absolute window
    const keys = keysBetweenDatesUTC(fromDT, toDT);
    let allPoints = [];
    for (const k of keys) {
      const trace = json[k];
      if (trace && Array.isArray(trace.points)) {
        allPoints = allPoints.concat(trace.points);
      }
    }

    if (!allPoints.length) {
      setStatus(`No scenario data found in ${url} for ${fromDateStr} → ${toDateStr}.`);
      return;
    }

    const filteredPoints = filterPointsByUTCWindow(allPoints, fromDT, toDT);

    if (!filteredPoints.length) {
      setStatus(`No points between ${fromDateStr} ${fromLbl} and ${toDateStr} ${toLbl}.`);
      return;
    }

    // Build a minimal trace object for plotting (areas empty for now)
    const filteredTrace = { points: filteredPoints, areas: [] };

    if (typeof window.plotTraceObject === 'function') {
      setStatus(`Showing ${filteredPoints.length} point(s) from ${fromDateStr} ${fromLbl} to ${toDateStr} ${toLbl}.`);
      window.plotTraceObject(filteredTrace, { scrollToMap: true });
    } else {
      setStatus('plotTraceObject not available — check script order.');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn  = document.getElementById('bh-update-map');
    const form = document.getElementById('bh-search-form') || document.getElementById('bh-map-filters');

    if (btn)  btn.addEventListener('click', handleUpdate);
    if (form) form.addEventListener('submit', handleUpdate, true); // capture so we run first
  });
})();
