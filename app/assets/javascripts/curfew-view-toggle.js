// /public/javascripts/curfew-view-toggle.js  (fixed init order + safe first-visit seeding)
(function(){
  'use strict';

  function onReady(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function(){
    const chartWrap  = document.getElementById('curfew-chart-wrap');
    const tableWrap  = document.getElementById('curfew-table-wrap');
    const toggleBtn  = document.getElementById('curfew-btn-toggle-view');
    const stackedBtn = document.getElementById('curfew-btn-stacked');

    if (!chartWrap || !tableWrap || !toggleBtn) return;

    // --- storage helpers (define BEFORE use) ---
    const STORAGE_VERSION = 'v2';
    const LS  = window.localStorage || null;
    const key = (s) => `curfew:${STORAGE_VERSION}:${s}`;
    const getPref = (k, d) => { try { const v = LS && LS.getItem(k); return (v === null || v === undefined) ? d : v; } catch { return d; } };
    const setPref = (k, v) => { try { LS && LS.setItem(k, v); } catch { /* ignore */ } };

    // Only set a default on true first visit (no v2 'view' stored yet)
    function seedCurfewViewOnce(){
      const existing = getPref(key('view'), null);
      if (existing === null || existing === undefined) {
        setPref(key('view'), 'chart'); // default to chart view
      }
    }

    function applyView(view){
      const showChart = (view !== 'table');

      if (showChart) {
        // Show chart, hide table
        tableWrap.setAttribute('hidden', '');
        chartWrap.removeAttribute('hidden');
        toggleBtn.textContent = 'Change to accessible table view';
        toggleBtn.setAttribute('data-view', 'chart');
        toggleBtn.setAttribute('aria-controls', 'curfew-chart-wrap');
        stackedBtn && stackedBtn.classList.remove('bh-hide');
      } else {
        // Show table, hide chart
        chartWrap.setAttribute('hidden', '');
        tableWrap.removeAttribute('hidden');
        toggleBtn.textContent = 'Change to chart view';
        toggleBtn.setAttribute('data-view', 'table');
        toggleBtn.setAttribute('aria-controls', 'curfew-table-wrap');
        stackedBtn && stackedBtn.classList.add('bh-hide');

        // Ask the charts controller to (re)build the table now
        document.dispatchEvent(new CustomEvent('bh:curfew:request-table'));
      }

      // Announce view change and persist it
      document.dispatchEvent(new CustomEvent('bh:curfew:view-changed', {
        detail: { view: showChart ? 'chart' : 'table' }
      }));
      setPref(key('view'), showChart ? 'chart' : 'table');
    }

    // Seed first-visit default, then apply stored (or default) view
    seedCurfewViewOnce();
    applyView(getPref(key('view'), 'chart'));

    // Toggle handler
    toggleBtn.addEventListener('click', function(){
      const goingTo = (toggleBtn.getAttribute('data-view') === 'chart') ? 'table' : 'chart';
      applyView(goingTo);
    });
  });
})();
