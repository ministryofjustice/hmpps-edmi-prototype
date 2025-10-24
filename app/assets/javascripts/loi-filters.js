// /public/javascripts/loi-filters.js
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function initLoiFilters() {
    console.log('[loi-filters] loaded');

    // Scope strictly to the LOI form + LOI table
    const form = document.getElementById('loi-filters');
    const $table = $('#bh-loi-table'); // ← key change: target LOI table by ID
    if (!form || !$table.length) {
      console.warn('[loi-filters] required elements not found; aborting.');
      return;
    }

    const $tbody = $table.find('tbody');
    const statusEl = document.getElementById('loi-filter-status');

    // Use the first pagination block on the page (same as before).
    // If you later want it nearer the LOI table, scope this more tightly.
    const $pagination = $('.govuk-pagination').first();

    // ---- cache rows (same logic as before)
    const rows = $tbody.find('tr').map(function () {
      const $tr = $(this);
      const $tds = $tr.find('td');

      // Date (prefer the machine-sort value in the first cell)
      const $dateCell = $tds.eq(0);
      const rawDate = $dateCell.find('[data-sort-value]').attr('data-sort-value') || $dateCell.text().trim();
      const date = parseUkDate(rawDate);

      // Location type: prefer machine-readable key from data attrs
      const $typeCell = $tds.eq(1);
      const typeKey = (
        $typeCell.attr('data-loi-type') ||
        $typeCell.attr('data-sort-value') ||
        $typeCell.text() ||
        ''
      ).trim().toLowerCase();

      return { $tr, date, typeKey };
    }).get();

    if (!rows.length) {
      console.warn('[loi-filters] no LOI table rows found; aborting.');
      return;
    }

    // Latest date present in the LOI table (as before)
    const latestDate = new Date(Math.max.apply(null, rows.map(r => r.date?.getTime() || 0)));

    // (Read but not used directly; kept in case your template logic depends on it)
    const fittedStr = form.dataset.tagFitted; // e.g. "2025-06-08"
    const tagFittedDate = fittedStr ? new Date(fittedStr) : null; // eslint-disable-line no-unused-vars

    // ---- events (same behaviour)
    $('#loi-filters').on('submit', applyFilters);
    $('#clear-loi-filters').on('click', clearFilters);

    function parseUkDate(str) {
      // Handles ISO (YYYY-MM-DD) or English strings (“24 July 2025”)
      const d = new Date(str);
      return isNaN(d) ? null : d;
    }

    function applyFilters(ev) {
      if (ev) ev.preventDefault();

      const typeFilterRaw = ($('#filter-type').val() || '').trim().toLowerCase();
      const dateFilter = $('#filter-date').val(); // '', 'last7', 'last30'

      let shown = 0;

      rows.forEach(r => {
        let match = true;

        // ---- type filtering (kept your special 'non-home' rule)
        if (typeFilterRaw) {
          if (typeFilterRaw === 'non-home') {
            // show everything EXCEPT exact 'home'
            if (r.typeKey === 'home') match = false;
          } else {
            // exact match first, then contains for loose matching
            if (!(r.typeKey === typeFilterRaw || r.typeKey.includes(typeFilterRaw))) {
              match = false;
            }
          }
        }

        // ---- date range (anchor to latest date in table, as before)
        if (match && r.date instanceof Date && !isNaN(r.date)) {
          if (dateFilter === 'last7' || dateFilter === 'last30') {
            const days = (dateFilter === 'last7') ? 7 : 30;
            const diffDays = Math.floor((latestDate - r.date) / (1000 * 60 * 60 * 24));
            if (diffDays > days) match = false;
          }
        }

        r.$tr.toggle(match);
        if (match) shown++;
      });

      if (statusEl) {
        statusEl.textContent = `Showing ${shown} of ${rows.length} records.`;
      }

      // ---- pagination visibility (unchanged logic)
      if ($pagination.length) {
        const hasTypeFilter = document.getElementById('filter-type')?.selectedIndex > 0;
        if (hasTypeFilter) {
          $pagination.attr('hidden', 'hidden')
                     .attr('aria-hidden', 'true')
                     .hide();
        } else {
          $pagination.removeAttr('hidden')
                     .attr('aria-hidden', 'false')
                     .show();
        }
      }
    }

    function clearFilters(ev) {
      if (ev) ev.preventDefault();
      $('#filter-type').val('');
      $('#filter-date').val('');
      applyFilters(); // re-show rows + pagination
    }
  });
})();
