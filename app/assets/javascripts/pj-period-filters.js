// /public/javascripts/pj-period-filters.js
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  const pad2 = (n) => String(n).padStart(2, '0');

  function parseDMY(dmy) {
    // "dd/mm/yyyy" -> Date at local midnight
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy||'').trim());
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 0, 0, 0, 0);
    return isNaN(d) ? null : d;
  }

  function addHours(date, hours) {
    const d = new Date(date.getTime());
    d.setHours(d.getHours() + hours);
    return d;
  }

  function asDMY(d) {
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const form = $('#bh-map-filters');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      // Compute "to" from "from" + period, then let the normal handler run.
      const dateFromStr = $('#bh-date-from input')?.value || $('#bh-date-from')?.value;
      const hFrom = Number($('#bh-time-from-hour')?.value || 0);
      const mFrom = Number($('#bh-time-from-min')?.value || 0);
      const periodHrs = Number($('#bh-period')?.value || 6);

      const base = parseDMY(dateFromStr);
      if (!base || isNaN(hFrom) || isNaN(mFrom)) {
        // Let the usual validation/error path handle it
        return;
      }

      // Build full "from" Date
      base.setHours(hFrom, mFrom, 0, 0);

      const end = addHours(base, periodHrs);

      // Write hidden "to" fields in the format Billy’s code expects
      const dateToEl = $('#bh-date-to input') || $('#bh-date-to');
      const toHourEl = $('#bh-time-to-hour');
      const toMinEl  = $('#bh-time-to-min');

      if (dateToEl) dateToEl.value = asDMY(end);
      if (toHourEl) toHourEl.value = pad2(end.getHours());
      if (toMinEl)  toMinEl.value  = pad2(end.getMinutes());
    }, /* useCapture */ true); // run before other submit listeners
  });
})();
