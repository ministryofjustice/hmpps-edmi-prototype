// /public/javascripts/penny-home.js
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // Parse "9:33pm" -> minutes since 00:00 (0..1439)
  function parseClockToMinutes(s) {
    if (!s || typeof s !== 'string') return NaN;
    const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if (!m) return NaN;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3].toLowerCase();
    if (hh === 12) hh = 0;
    let mins = hh * 60 + mm;
    if (ap === 'pm') mins += 12 * 60;
    return mins;
  }

  // Does "9:33pm to 10:42pm" intersect the overnight window 19:00–07:00 (wraps midnight)?
  function intersectsOvernightWindow(timeText) {
    if (!timeText) return false;
    const m = String(timeText).match(/(\d{1,2}:\d{2}\s*[ap]m)\s*to\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
    if (!m) return false;
    const start = parseClockToMinutes(m[1]);
    const end   = parseClockToMinutes(m[2]);
    if (isNaN(start) || isNaN(end)) return false;

    const WIN_START = 19 * 60; // 19:00
    const WIN_END   = 7 * 60;  // 07:00 (next day)

    function expand(start, end) {
      return (end >= start) ? [[start, end]] : [[start, 1440], [0, end]];
    }
    const A = expand(start, end);
    const B = expand(WIN_START, WIN_END);
    for (const [xs, xe] of A) for (const [ys, ye] of B) {
      if (xs < ye && ys < xe) return true;
    }
    return false;
  }

  // "Wednesday 3 September<br/>2025" -> "2025-09-03"
  function dateCellToIsoKey(cell) {
    if (!cell) return null;
    const txt = cell.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[^>]+>/g, '').trim();
    const m = txt.match(/^\w+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return null;
    const day = String(parseInt(m[1], 10)).padStart(2, '0');
    const monthName = m[2].toLowerCase();
    const year = m[3];
    const months = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const mm = months[monthName];
    if (!mm) return null;
    return `${year}-${mm}-${day}`;
  }

  // Build a map { isoDate: boolean } indicating home-present overnight
  function computeOvernightComplianceFromTable() {
    const table = $('#bh-loi-table');
    if (!table) return new Map();
    const rows = $all('tbody tr', table);
    const map = new Map(); // isoDate -> boolean

    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) return;
      const dateIso = dateCellToIsoKey(tds[0]);
      if (!dateIso) return;

      const locType = tds[1]?.textContent?.toLowerCase().trim() || '';
      const isHome  = locType === 'home';

      const timeHTML = tds[3]?.innerHTML || '';
      const timeText = timeHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[^>]+>/g, '').trim();

      if (!map.has(dateIso)) map.set(dateIso, false);
      if (isHome && intersectsOvernightWindow(timeText)) {
        map.set(dateIso, true);
      }
    });

    return map;
  }

// Render a simple 7-day bar (yesterday back 6 more). Latest (yesterday) on the RIGHT.
function renderSevenDayStreak(container, complianceMap) {
  if (!container) return;

  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setDate(base.getDate() - 1); // yesterday

  // Build items right -> left: [yesterday-6, ..., yesterday-1, yesterday]
  const items = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const ok = !!complianceMap.get(iso);
    items.push({ iso, ok, d });
  }

  const wrap = document.createElement('div');
  wrap.className = 'app-streak';

  items.forEach(({ ok, d }) => {
    const item = document.createElement('div');
    item.className = 'app-streak__item';

    const bar = document.createElement('div');
    bar.className = `app-streak__bar ${ok ? 'app-streak__bar--yes' : 'app-streak__bar--no'}`;
    bar.setAttribute('title',
      `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} — ${ok ? 'at home' : 'not at home'}`
    );
    bar.setAttribute('aria-label',
      `${d.toLocaleDateString('en-GB')} — ${ok ? 'at home overnight' : 'not at home overnight'}`
    );

    const label = document.createElement('div');
    label.className = 'app-streak__label';
    label.textContent = d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    item.appendChild(bar);
    item.appendChild(label);
    wrap.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(wrap);
}



  // Count consecutive yeses starting from yesterday backwards
  function countConsecutiveYes(complianceMap) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    base.setDate(base.getDate() - 1);

    let count = 0;
    for (let i = 0; i < 120; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (complianceMap.get(iso)) count++;
      else break;
    }
    return count;
  }

  function findMostRecentNo(complianceMap) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    base.setDate(base.getDate() - 1);

    for (let i = 0; i < 365; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (complianceMap.has(iso) && !complianceMap.get(iso)) {
        return d;
      }
    }
    return null;
  }

  onReady(function () {
    // Build compliance from the current LOI table
    const complianceMap = computeOvernightComplianceFromTable();

    // Render 7-day streak graph
    renderSevenDayStreak($('#home-overnight-streak'), complianceMap);

    // Render summary sentence
    const summary = $('#home-overnight-summary');
    if (summary) {
      const consec = countConsecutiveYes(complianceMap);
      const lastNo = findMostRecentNo(complianceMap);
      const dateStr = lastNo
        ? lastNo.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—';
      summary.innerHTML =
        `Penny ${consec > 0 ? `<strong>remained at home overnight</strong> for the last <strong>${consec}</strong> consecutive night${consec === 1 ? '' : 's'}` : 'has not remained at home overnight recently'}. ` +
        (lastNo ? `The last time she was <strong>not</strong> at home during those times was <strong>${dateStr}</strong>.` : '');
    }
  });
})();
