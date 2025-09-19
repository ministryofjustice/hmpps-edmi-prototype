(function () {
  function getParam(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }
  function parseDateStr(str) {
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split("-");
      return { day: d, month: m, year: y };
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
      const [d, m, y] = str.split("/");
      return { day: d, month: m, year: y };
    }
    return null;
  }

  function setIf(el, val) { if (el && val != null) el.value = String(val); }

  document.addEventListener('DOMContentLoaded', function () {
    const trace   = getParam('trace');
    const qpDate  = parseDateStr(getParam('date'));
    const base    = (trace && window.LOI_LOOKUP && window.LOI_LOOKUP[trace]) ? window.LOI_LOOKUP[trace] : {};

    const address  = base.address || [];
    const type     = base.type || "";
    const duration = base.duration || "";
    const time     = base.time || null;

    // 1) Prefill Notes
    const notesEl = document.getElementById('notes');
    if (notesEl) {
      const lines = []
        .concat(address)
        .concat(["", `Location type: ${type}`, "", `Duration: ${duration}`]);
      notesEl.value = lines.join("\n");
    }

    // 2) Prefill Date (govukDateInput ids: breach-date-day/month/year)
    setIf(document.getElementById('breach-date-day'),   qpDate ? String(qpDate.day).padStart(2,'0') : null);
    setIf(document.getElementById('breach-date-month'), qpDate ? String(qpDate.month).padStart(2,'0') : null);
    setIf(document.getElementById('breach-date-year'),  qpDate ? String(qpDate.year) : null);

    // 3) Prefill Time
    setIf(document.getElementById('breach-hour'), time ? String(time.hour).padStart(2,'0') : null);
    setIf(document.getElementById('breach-min'),  time ? String(time.min).padStart(2,'0')  : null);

    // 4) Make the confirmation button carry all current selections + existing trace/date
    const btn = document.getElementById('send-to-ndelius-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        // Read current form values
        const contactType    = (document.getElementById('contact-type') || {}).value || "";
        const licenceBreach  = (document.getElementById('licence-breach') || {}).value || "";
        const contactOutcome = (document.getElementById('contact-outcome') || {}).value || "";

        const alertVal = (document.querySelector('input[name="alert"]:checked') || {}).value || "";
        const visorVal = (document.querySelector('input[name="visor"]:checked') || {}).value || "";
        const sensVal  = (document.querySelector('input[name="sensitive"]:checked') || {}).value || "";

        // Keep the original trace/date from the page URL
        const url = new URL(window.location.origin + '/ndelius-confirmation');
        const src = new URL(window.location.href);

        ['trace','date'].forEach(p => {
          const v = src.searchParams.get(p);
          if (v) url.searchParams.set(p, v);
        });

        // Add current selections
        if (contactType)    url.searchParams.set('contactType', contactType);
        if (licenceBreach)  url.searchParams.set('licenceBreach', licenceBreach);
        if (contactOutcome) url.searchParams.set('contactOutcome', contactOutcome);
        if (alertVal)       url.searchParams.set('alert', alertVal);
        if (visorVal)       url.searchParams.set('visor', visorVal);
        if (sensVal)        url.searchParams.set('sensitive', sensVal);

        // Navigate
        e.preventDefault();
        window.location.href = url.toString();
      });
    }
  });
})();
