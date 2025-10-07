// /public/javascripts/bh-loi-to-map-sync.js
// Sync LOI table “View” clicks to the map and filter form; smooth-scroll to the MAP (#map).
// Prevent jump back to the table by replacing Leaflet’s close <a> with a real <button>.

(function () {
  'use strict';

  // --- flip to true for one run if you want console breadcrumbs while debugging
  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[bh-loi]', ...args); };

  // Heuristic: is the map usable enough to plot?
  function mapSeemsUsable() {
    return !!(window.map && typeof window.map === 'object');
  }

  // Ensure actions only run once the map is really ready (supports old and new event names)
  function runWhenMapReady(fn) {
    if ((window.BH && window.BH.mapReady) || mapSeemsUsable()) {
      log('Map appears ready → running immediately');
      return fn();
    }
    let ran = false;
    const runOnce = () => {
      if (ran) return;
      ran = true;
      document.removeEventListener('bh:map-ready', runOnce);
      document.removeEventListener('bh:map:ready', runOnce);
      log('Map readiness event received → running');
      fn();
    };
    document.addEventListener('bh:map-ready', runOnce, { once: true });
    document.addEventListener('bh:map:ready', runOnce, { once: true });

    // Last resort: proceed within ~1s if a usable map appears
    const start = Date.now();
    const tick = () => {
      if (ran) return;
      if (mapSeemsUsable()) return runOnce();
      if (Date.now() - start < 1000) return requestAnimationFrame(tick);
      log('Fallback timeout reached; proceeding best-effort');
      runOnce();
    };
    requestAnimationFrame(tick);
  }

  // ---------- tiny helpers
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  function isoToDMY(iso) {
    const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  function parseTime12h(str) {
    if (!str) return null;
    const m = str.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { h, m: min };
  }

  // ---------- update the map filter form to match the table row
  function setFormDateTime(dateIso, startStr, endStr) {
    const dmy = isoToDMY(dateIso);
    const dateFromInput = $('#bh-date-from');
    const dateToInput   = $('#bh-date-to');
    if (dateFromInput) dateFromInput.value = dmy;
    if (dateToInput)   dateToInput.value   = dmy;

    const start = parseTime12h(startStr);
    const end   = parseTime12h(endStr);

    if (start) {
      const h = $('#bh-time-from-hour'), m = $('#bh-time-from-min');
      if (h) h.value = pad2(start.h);
      if (m) m.value = pad2(start.m);
    }
    if (end) {
      const h = $('#bh-time-to-hour'), m = $('#bh-time-to-min');
      if (h) h.value = pad2(end.h);
      if (m) m.value = pad2(end.m);
    }
  }

  function extractDateIsoFromRow(tr) {
    const firstCell = tr && tr.cells && tr.cells[0];
    return firstCell ? (firstCell.getAttribute('data-sort-value') || '') : '';
  }

  function extractTimeRangeFromRow(tr) {
    const timeCell = tr && tr.cells && tr.cells[3];
    if (!timeCell) return [null, null];
    const text = timeCell.textContent.replace(/\s+/g, ' ').trim();
    const m = text.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*to\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
    return m ? [m[1], m[2]] : [null, null];
  }

  // ---------- smooth scroll to the MAP, then focus it (without re-scrolling)
  function smoothScrollToMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    if (!mapEl.hasAttribute('tabindex')) mapEl.setAttribute('tabindex', '-1');
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { try { mapEl.focus({ preventScroll: true }); } catch (_) {} }, 350);
  }

  // ---------- small scroll freeze used during popup close
  function freezeScrollFor(ms = 200) {
    const x = window.scrollX, y = window.scrollY;
    const restore = () => window.scrollTo(x, y);
    let t1, t2;
    const onScroll = () => restore();
    window.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(restore);
    t1 = setTimeout(restore, 0);
    t2 = setTimeout(() => window.removeEventListener('scroll', onScroll), ms);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('scroll', onScroll); };
  }

  // Direct plot helper (passes highlight row through if supported)
  function plotTraceDirect(traceKey, highlightRowEl) {
    if (typeof window.plotTrace === 'function') {
      log('Direct plot via window.plotTrace(traceKey, {highlightRowEl})');
      window.plotTrace(traceKey, {
        scrollToMap: false,      // we already scrolled
        highlightRowEl           // helps gps-map label/date logic
        // leave dataUrl undefined to use gps-map's defaults/CFG
      });
      return true;
    }
    if (window.gpsMap && typeof window.gpsMap.plotTrace === 'function') {
      log('Direct plot via window.gpsMap.plotTrace(traceKey)');
      window.gpsMap.plotTrace(traceKey);
      return true;
    }
    log('No direct plotter available; dispatching bh:plot-trace');
    document.dispatchEvent(new CustomEvent('bh:plot-trace', { detail: { trace: traceKey } }));
    return true;
  }

  // ---------- focus behaviour around the MAP & popup close
  function attachMapFocusHandlers() {
    const map = window.map;
    if (!map) return;

    const mapEl = document.getElementById('map');
    if (mapEl && !mapEl.hasAttribute('tabindex')) mapEl.setAttribute('tabindex', '-1');

    // Replace Leaflet’s close <a> with a <button>, keep focus stable
    map.on('popupopen', function (e) {
      const popup = e && e.popup;
      const container = popup && popup._container;
      if (container && !container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      try { container && container.focus({ preventScroll: true }); } catch (_) {}

      const a = popup && popup._closeButton;
      if (a && a.tagName === 'A') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = a.className;
        btn.setAttribute('aria-label', 'Close popup');
        btn.innerHTML = a.innerHTML;
        a.parentNode.replaceChild(btn, a);

        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const unfreeze = freezeScrollFor(250);
          try { map.closePopup(); } finally {
            requestAnimationFrame(() => {
              unfreeze();
              try { mapEl && mapEl.focus({ preventScroll: true }); } catch (_) {}
            });
          }
        }, { capture: true });
      }
    });

    // ESC to close without scroll/jump
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!map || !map._popup) return;
      ev.preventDefault();
      ev.stopPropagation();
      const unfreeze = freezeScrollFor(250);
      try { map.closePopup(); } finally {
        requestAnimationFrame(() => {
          unfreeze();
          try { mapEl && mapEl.focus({ preventScroll: true }); } catch (_) {}
        });
      }
    }, true);

    // Defensive: restore focus even if something else closes the popup
    map.on('popupclose', function () {
      requestAnimationFrame(() => {
        try { mapEl && mapEl.focus({ preventScroll: true }); } catch (_) {}
      });
    });
  }

  // ---------- click handler on “View” links
  function onViewClick(ev) {
    const a = ev.currentTarget;
    const traceKey = a.getAttribute('data-trace');
    if (!traceKey) return;

    ev.preventDefault();        // avoid “#” navigation
    ev.stopPropagation();       // stop gps-map.js’s document handler from double-firing
    a.blur();                   // don’t keep focus in the table

    const tr = a.closest('tr');
    const iso = extractDateIsoFromRow(tr);
    const [startStr, endStr] = extractTimeRangeFromRow(tr);

    // Safe to set inputs and scroll immediately
    setFormDateTime(iso, startStr, endStr);
    smoothScrollToMap();

    // Only the map-dependent bits wait for readiness
    runWhenMapReady(() => {
      // Next frame ensures inputs are committed before plotting
      requestAnimationFrame(() => {
        plotTraceDirect(traceKey, tr);
      });
    });
  }

  // ---------- init
  function init() {
    log('Initialising bh-loi-to-map-sync');

    // Neutralise any naked href="#" EXCEPT inside the Leaflet map (we replace that ourselves)
    document.addEventListener('click', function (e) {
      if (e.target.closest('.leaflet-container')) return;
      const jumpy = e.target.closest('a[href="#"]');
      if (jumpy) e.preventDefault();
    });

    // Bind “View” links
    const links = $$('.plot-link[data-trace]');
    links.forEach(a => a.addEventListener('click', onViewClick));
    log('Bound plot links:', links.length);

    // Rebind if table re-renders
    document.addEventListener('bh:loi:table-updated', () => {
      const again = $$('.plot-link[data-trace]');
      again.forEach(a => {
        a.removeEventListener('click', onViewClick);
        a.addEventListener('click', onViewClick);
      });
      log('Rebound after table update:', again.length);
    });

    // Map focus behaviour
    if (mapSeemsUsable()) {
      log('Map already available → attaching focus handlers');
      attachMapFocusHandlers();
    } else {
      const attachOnce = () => { log('Map ready event for focus handlers'); attachMapFocusHandlers(); };
      document.addEventListener('bh:map-ready', attachOnce, { once: true });
      document.addEventListener('bh:map:ready', attachOnce, { once: true });
    }

    // Ensure the map itself is focusable
    const mapEl = document.getElementById('map');
    if (mapEl && !mapEl.hasAttribute('tabindex')) mapEl.setAttribute('tabindex', '-1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
