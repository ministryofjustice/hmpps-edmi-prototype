// /public/javascripts/loi-filters.js
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(function initLoiFilters() {
    console.log('[loi-filters] loaded');

    // Elements
    const form = document.getElementById('loi-filters');
    if (!form) {
      console.warn('[loi-filters] #loi-filters not found; aborting.');
      return;
    }

    const $table = $('[data-module="moj-sortable-table"]').first();
    if (!$table.length) {
      console.warn('[loi-filters] table not found; aborting.');
      return;
    }
    const $tbody = $table.find('tbody');
    const $pagination = $('.govuk-pagination').first();
    const statusEl = document.getElementById('loi-filter-status');

    // Cache rows
 const rows = $tbody.find('tr').map(function () {
  const $tr = $(this);
  const $tds = $tr.find('td');

  // Date (unchanged)
  const $dateCell = $tds.eq(0);
  const rawDate = $dateCell.find('[data-sort-value]').attr('data-sort-value') || $dateCell.text().trim();
  const date = parseUkDate(rawDate);

  // Location type: prefer machine-readable key from data attributes (e.g. data-loi-type="custom")
  const $typeCell = $tds.eq(1);
  const typeKey =
    ($typeCell.attr('data-loi-type') || $typeCell.attr('data-sort-value') || $typeCell.text() || '')
      .trim().toLowerCase();

  return { $tr, date, typeKey };
}).get();


    if (!rows.length) {
      console.warn('[loi-filters] no table rows found; aborting.');
      return;
    }

    // Latest date in table
    const latestDate = new Date(Math.max.apply(null, rows.map(r => r.date?.getTime() || 0)));

    // Tag fitted label
    const fittedStr = form.dataset.tagFitted; // e.g. "2025-06-08"
    const tagFittedDate = fittedStr ? new Date(fittedStr) : null;


    // Wire up
    $('#loi-filters').on('submit', applyFilters);
    $('#clear-loi-filters').on('click', clearFilters);

    // ---- functions

    function parseUkDate(str) {
      const d = new Date(str); // e.g. "24 July 2025"
      return isNaN(d) ? null : d;
    }


    function applyFilters(ev) {
      if (ev) ev.preventDefault();

      const typeFilterRaw = ($('#filter-type').val() || '').trim().toLowerCase();
      const dateFilter = $('#filter-date').val(); // '', 'last7', 'last30'

      let shown = 0;

      rows.forEach(r => {
        let match = true;

// Location type filtering (includes special "non-home")
if (typeFilterRaw) {
  if (typeFilterRaw === 'non-home') {
    // show everything EXCEPT exact 'home'
    if (r.typeKey === 'home') match = false;
  } else {
    // Prefer exact key match first (so "custom" finds renamed rows),
    // then fall back to contains to keep your loose matching behaviour.
    if (!(r.typeKey === typeFilterRaw || r.typeKey.includes(typeFilterRaw))) {
      match = false;
    }
  }
}


        // Date range
        if (match && r.date instanceof Date && !isNaN(r.date)) {
          if (dateFilter === 'last7' || dateFilter === 'last30') {
            const days = dateFilter === 'last7' ? 7 : 30;
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

      // Hide pagination when Location filter is not "All location types"
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
      applyFilters(); // also re-shows pagination
    }
  });
})();
