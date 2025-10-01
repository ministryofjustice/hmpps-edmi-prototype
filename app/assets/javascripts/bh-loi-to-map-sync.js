// /public/javascripts/bh-loi-to-map-sync.js
// Syncs LOI table "View" clicks to the map AND to the map filter form date/time.
// Works with the markup in bh-location.html (MOJ date picker + time inputs).

(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function isoToDMY(iso) {
    // iso "2025-09-23" -> "23/09/2025"
    if (!iso || typeof iso !== 'string') return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  function parseTime12h(str) {
    // e.g. "2:19pm" -> { h:14, m:19 }
    if (!str) return null;
    const m = str.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return { h, m: min };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function setFormDateTime(dateIso, startStr, endStr) {
    const dateFromInput = $('#bh-date-from');
    const dateToInput   = $('#bh-date-to');

    const timeFH = $('#bh-time-from-hour');
    const timeFM = $('#bh-time-from-min');
    const timeTH = $('#bh-time-to-hour');
    const timeTM = $('#bh-time-to-min');

    // Convert date
    const dmy = isoToDMY(dateIso);

    if (dateFromInput) dateFromInput.value = dmy;
    if (dateToInput)   dateToInput.value   = dmy;

    // Parse "2:19pm to 7:59pm"
    const start = parseTime12h(startStr);
    const end   = parseTime12h(endStr);

    if (start && timeFH) timeFH.value = pad2(start.h);
    if (start && timeFM) timeFM.value = pad2(start.m);

    if (end && timeTH) timeTH.value = pad2(end.h);
    if (end && timeTM) timeTM.value = pad2(end.m);
  }

  function extractDateIsoFromRow(tr) {
    // first cell has data-sort-value = ISO date
    const firstCell = tr && tr.cells && tr.cells[0];
    if (!firstCell) return '';
    return firstCell.getAttribute('data-sort-value') || '';
  }

  function extractTimeRangeFromRow(tr) {
    // 4th cell has "2:19pm to 7:59pm<br/>(5 hours 40 mins)"
    const timeCell = tr && tr.cells && tr.cells[3];
    if (!timeCell) return [null, null];

    const text = timeCell.textContent.replace(/\s+/g, ' ').trim(); // normalize
    // Find "X:YYam/pm to A:BBam/pm"
    const m = text.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*to\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
    if (!m) return [null, null];
    return [m[1], m[2]];
  }

  function smoothScrollToMap() {
    const header = document.getElementById('map-header') || document.getElementById('map');
    if (!header) return;
    header.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function triggerMapUpdate() {
    // Prefer submitting the existing map filters form so we reuse your current logic.
    const applyBtn = document.getElementById('bh-apply-filters');
    if (applyBtn) {
      applyBtn.click();
      return;
    }

    // Fallback: submit the form directly
    const form = document.getElementById('bh-map-filters');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    // As a last-ditch fallback, broadcast a custom event that other scripts can listen for.
    document.dispatchEvent(new CustomEvent('bh:map:filters-updated'));
  }

  function maybePlotTrace(traceKey) {
    // Try obvious global hooks if they exist in your codebase:
    if (typeof window.plotTrace === 'function') {
      window.plotTrace(traceKey);
      return;
    }
    if (window.gpsMap && typeof window.gpsMap.plotTrace === 'function') {
      window.gpsMap.plotTrace(traceKey);
      return;
    }
    // Broadcast an event so bh-update-map.js or others can react.
    document.dispatchEvent(new CustomEvent('bh:plot-trace', { detail: { trace: traceKey } }));
  }

  function onViewClick(ev) {
    const a = ev.currentTarget;
    const traceKey = a.getAttribute('data-trace');
    if (!traceKey) return; // let it bubble if not our link

    ev.preventDefault();

    // Find the row
    const tr = a.closest('tr');
    const iso = extractDateIsoFromRow(tr);
    const [startStr, endStr] = extractTimeRangeFromRow(tr);

    // Update form to match the row
    setFormDateTime(iso, startStr, endStr);

    // Scroll to the map
    smoothScrollToMap();

    // Plot that LOI on the map
    maybePlotTrace(traceKey);

    // And trigger the normal map update pipeline so everything stays in sync
    triggerMapUpdate();
  }

  function init() {
    $all('a.plot-link[data-trace]').forEach(a => {
      a.addEventListener('click', onViewClick);
    });

    // If your table re-renders dynamically, you could re-bind like this:
    document.addEventListener('bh:loi:table-updated', () => {
      $all('a.plot-link[data-trace]').forEach(a => {
        a.removeEventListener('click', onViewClick);
        a.addEventListener('click', onViewClick);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
