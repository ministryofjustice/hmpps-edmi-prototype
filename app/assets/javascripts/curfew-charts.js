// /public/javascripts/curfew-charts.js
// One source of truth for chart + table from /public/data/violations-bh.json
// First visit defaults: Line • 7 days • All durations
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad2  = (n) => String(n).padStart(2, '0');

  // ---------- storage (v3) ----------
  const STORAGE_VERSION = 'v3';
  const LS  = window.localStorage || null;
  const key = (s) => `curfew:${STORAGE_VERSION}:${s}`;
  const getPref = (k, d) => { try { const v = LS && LS.getItem(k); return (v === null || v === undefined) ? d : v; } catch { return d; } };
  const setPref = (k, v) => { try { LS && LS.setItem(k, v); } catch { } };

  // seed defaults only if v3 keys don’t exist
  function seedDefaultsOnce() {
    if (getPref(key('seeded'), null) != null) return;
    setPref(key('rangeDays'),   '7');     // last 7 days
    setPref(key('durationMin'), '0');     // all durations
    setPref(key('mode'),        'line');  // line chart
    setPref('curfew:v3:view',   'chart'); // belt & braces if view-toggle hasn’t run yet
    setPref(key('seeded'),      '1');
  }

  // ---------- time helpers ----------
  const to12h = (h) => ({ h: ((h + 11) % 12) + 1, suf: h < 12 ? 'am' : 'pm' });
  function fmtTime(hh, mm) { const { h, suf } = to12h(hh); return `${h}.${pad2(mm)}${suf}`; } // dots will be normalised by your normaliser
  function addMinutes(hh, mm, mins) { const t = hh * 60 + mm + mins; return { hh: Math.floor((t / 60) % 24), mm: t % 60 }; }

  // ---------- fallback dataset (only if fetch fails) ----------
  function skewedMinutes() { const u = Math.random(); const m = Math.round(-Math.log(1 - u) * 8); return clamp(m, 1, 217); }
  function pickType() { const u = Math.random(); if (u < 0.55) return 'pending'; if (u < 0.80) return 'unacceptable'; return 'acceptable'; }
  function buildSyntheticDataset(totalDays = 43) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const busy = Math.random() < 0.35;
      const targetMax = busy ? 360 : 120;
      const count = clamp(Math.round((busy ? 12 : 8) + Math.random() * (busy ? 10 : 6)), 5, 20);
      const events = []; let sum = 0;
      for (let e = 0; e < count; e++) {
        const type = pickType(); const mins = skewedMinutes();
        if (sum + mins > targetMax) break;
        const windowMins = 12 * 60; // 19:00–07:00
        const startInWin = Math.floor(Math.random() * (windowMins - Math.min(mins, windowMins)));
        const startTotal = 19 * 60 + startInWin;
        const stHH = Math.floor((startTotal) % 1440 / 60);
        const stMM = (startTotal) % 60;
        events.push({ minutes: mins, type, startHH: stHH, startMM: stMM });
        sum += mins;
      }
      days.push({ date: iso, events });
    }
    return { totalDays, days };
  }

  // ---------- data load ----------
  async function loadDataset() {
    const URL = '/public/data/violations-bh.json';
    try {
      const res = await fetch(`${URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      try {
        const all = (json.days || []).map(d => d.date).sort();
        if (all.length) console.info('[curfew] loaded', URL, 'range:', all[0], '→', all[all.length - 1], 'days:', all.length);
      } catch {}
      window.VIOLATION_SERIES = json;
      return json;
    } catch (err) {
      console.warn('[curfew] Using synthetic dataset (fetch failed):', err);
      const fb = buildSyntheticDataset(43);
      window.VIOLATION_SERIES = fb;
      return fb;
    }
  }

  // ---------- aggregations for chart ----------
  function aggregateDayByType(day, minMinutes) {
    const o = { acceptable: 0, unacceptable: 0, pending: 0, total: 0 };
    for (const ev of (day.events || [])) {
      const m = Number(ev.minutes);
      if (!Number.isFinite(m)) continue;
      if (m >= (Number(minMinutes) || 0)) {
        const t = (ev.type === 'acceptable' || ev.type === 'unacceptable' || ev.type === 'pending') ? ev.type : 'pending';
        o[t] += m; o.total += m;
      }
    }
    return o;
  }
  function buildSeries(dataset, rangeDays, minDuration) {
    const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
    const slice = (dataset.days || []).slice(-rangeDays);
    const labels = [], acc = [], unacc = [], pend = [], tot = [];
    for (const d of slice) {
      const [y, m, dd] = (d.date || '').split('-').map(Number);
      labels.push(fmt.format(new Date(y || 1970, (m || 1) - 1, dd || 1)));
      const t = aggregateDayByType(d, Number(minDuration) || 0);
      acc.push(+t.acceptable || 0); unacc.push(+t.unacceptable || 0); pend.push(+t.pending || 0); tot.push(+t.total || 0);
    }
    return { labels, acc, unacc, pend, tot };
  }

  // ---------- heading + a11y ----------
  function ensureLiveRegion(){
    let el = document.getElementById('curfew-status');
    if(!el){
      el = document.createElement('div');
      el.id = 'curfew-status';
      el.className = 'govuk-visually-hidden';
      el.setAttribute('aria-live','polite');
      document.body.appendChild(el);
    }
    return el;
  }
  function announce(msg){
    ensureLiveRegion().textContent = msg || '';
  }
  function setHeading(el, view, rangeDays, total, min) {
    if (!el) return;
    const rangePhrase =
      (rangeDays === 7)  ? 'for the last 7 days' :
      (rangeDays === 30) ? 'for the last 30 days' :
                           `since tag was fitted (${total} days)`;
    const durPhrase =
      (Number(min) === 0) ? '(All durations)' :
      (Number(min) === 1) ? '(Over 1 min)'   :
      (Number(min) === 5) ? '(Over 5 mins)'  : '(Over 15 mins)';
    const viewWord = (view === 'table') ? 'Table' : 'Graph';
    el.textContent = `${viewWord} showing curfew data ${rangePhrase} ${durPhrase}`;
  }
  function setDurationUI(links, min) {
    links.forEach(a => {
      if (a.dataset.min === String(min)) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  // ---------- table generation + pagination ----------
  const PAGE_SIZE = 20;

  // Build array of row HTML strings, newest day first; within each day, latest time first
function buildEventRows(dataset, rangeDays, minDuration) {
  const pad2 = (n)=>String(n).padStart(2,'0');
  const df = new Intl.DateTimeFormat('en-GB', {
    weekday:'long', day:'2-digit', month:'long', year:'numeric'
  });

  const rows = [];
  const slice = (dataset.days || []).slice(-rangeDays); // oldest → newest

  const tMin = (H, M) => (Number(H) || 0) * 60 + (Number(M) || 0);

  // 🔁 reverse loop → newest day first
  for (let i = slice.length - 1; i >= 0; i--) {
    const d = slice[i];
    const [y,m,dd] = (d.date || '').split('-').map(Number);
    const pretty = df.format(new Date(y || 1970, (m || 1) - 1, dd || 1));

    // Filter by duration, **drop zero-minute events**, sort by time (latest first)
    const dayEvents = (d.events || [])
      .filter(ev => {
        const mins = Number(ev.minutes) || 0;
        if (mins <= 0) return false;                 // hide zero-minute rows
        return mins >= (Number(minDuration) || 0);
      })
      .slice()
      .sort((a, b) => tMin(b.startHH, b.startMM) - tMin(a.startHH, a.startMM));

    for (const ev of dayEvents) {
      const mins = Number(ev.minutes);
      const end  = addMinutes(ev.startHH, ev.startMM, mins);
      const startStr = fmtTime(ev.startHH, ev.startMM);
      const endStr   = fmtTime(end.hh, end.mm);
      const durStr   = mins === 1 ? '1 min' : `${mins} mins`;
      const typeText = ev.type === 'unacceptable' ? 'Out past curfew'
                   : ev.type === 'acceptable'   ? 'Return home late'
                   : 'Pending classification';
      const statusText = ev.type ? (ev.type.charAt(0).toUpperCase() + ev.type.slice(1)) : 'Pending';

      rows.push(`
        <tr class="govuk-table__row" data-status="${ev.type || 'pending'}">
          <td class="govuk-table__cell" data-sort-value="${d.date || ''}">${pretty}</td>
          <td class="govuk-table__cell" data-sort-value="${pad2(ev.startHH)}${pad2(ev.startMM)}">${startStr} to ${endStr}</td>
          <td class="govuk-table__cell" data-sort-value="${mins}">${durStr}</td>
          <td class="govuk-table__cell">${typeText}</td>
          <td class="govuk-table__cell" data-sort-value="${ev.type || 'pending'}">${statusText}</td>
        </tr>
      `);
    }
  }
  return rows;
}


  function renderPager(pagerEl, totalPages, currentPage) {
    if (!pagerEl) return;
    const item = (n, label = n, opts = {}) => {
      const cls = ['moj-pagination__item'];
      if (opts.prev) cls.push('moj-pagination__item--prev');
      if (opts.next) cls.push('moj-pagination__item--next');
      if (opts.ellipses) cls.push('moj-pagination__item--ellipses');

      if (opts.disabled) {
        return `<li class="${cls.join(' ')}"><span class="moj-pagination__link" aria-disabled="true">${label}</span></li>`;
      }
      if (opts.ellipses) return `<li class="${cls.join(' ')}" aria-hidden="true">…</li>`;
      const aria = (opts.current) ? ' aria-current="page"' : '';
      const rel  = opts.prev ? ' rel="prev"' : opts.next ? ' rel="next"' : '';
      return `<li class="${cls.join(' ')}"><a class="moj-pagination__link" href="#" data-page="${n}"${aria}${rel}
        aria-label="${opts.prev ? 'Previous page' : opts.next ? 'Next page' : 'Page ' + n}">${label}</a></li>`;
    };

    const current = currentPage;
    const last    = totalPages;
    const win     = 2;
    const start   = Math.max(1, current - win);
    const end     = Math.min(last, current + win);

    const parts = [];
    parts.push(item(current-1, '<span class="moj-pagination__link-title">Previous</span>', {prev:true, disabled: current===1}));
    if (start > 1) parts.push(item(1, 1));
    if (start > 2) parts.push(item(null, '…', {ellipses:true}));
    for (let n=start; n<=end; n++) parts.push(item(n, n, {current: n===current}));
    if (end < last-1) parts.push(item(null, '…', {ellipses:true}));
    if (end < last)   parts.push(item(last, last));
    parts.push(item(current+1, '<span class="moj-pagination__link-title">Next</span>', {next:true, disabled: current===last}));

    pagerEl.innerHTML = `<ul class="moj-pagination__list">${parts.join('')}</ul>`;
  }

  function renderEventTablePage(tbody, captionEl, pagerEl, rows, page, dataset, rangeDays, minDuration) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page || 1), totalPages);
    const start = (current - 1) * PAGE_SIZE;
    const end   = start + PAGE_SIZE;

    tbody.innerHTML = rows.slice(start, end).join('');

    if (captionEl) {
      const label = (rangeDays === 7) ? 'Last 7 days' :
                    (rangeDays === 30) ? 'Last 30 days' :
                    `Since tag was fitted (${dataset.totalDays} days)`;
      const dur = (minDuration === 0) ? 'All durations' :
                  (minDuration === 1) ? 'Over 1 min' :
                  (minDuration === 5) ? 'Over 5 mins' : 'Over 15 mins';
      captionEl.textContent = `Violation events – ${label} (${dur}) • ${rows.length} results`;
    }

    renderPager(pagerEl, totalPages, current);
  }

  // ---------- Chart.js setup ----------
  function ensureChart(canvas) {
    if (!canvas || typeof Chart === 'undefined') return null;
    const existing = Chart.getChart ? Chart.getChart(canvas) : null;
    if (existing) return existing;
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Acceptable',   data: [], tension: 0.25, pointRadius: 2, borderWidth: 4, borderColor: '#008b76' },
          { label: 'Unacceptable', data: [], tension: 0.25, pointRadius: 2, borderWidth: 4, borderColor: '#d4351c' },
          { label: 'Pending',      data: [], tension: 0.25, pointRadius: 2, borderWidth: 4, borderColor: '#b1b4b6' },
          { label: 'Total',        data: [], tension: 0.25, pointRadius: 0, borderWidth: 3, borderColor: '#505a5f', borderDash: [6, 4] }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { 
          x: { ticks: { maxTicksLimit: 10, autoSkip: true } },
          y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } 
        },
        plugins: { legend: { position: 'top' } }
      }
    });
  }

  // ---------- main ----------
  onReady(async function () {
    // DOM
    const headingEl  = document.getElementById('violation-heading');
    const chooserEl  = document.getElementById('range-chooser');
    const canvas     = document.getElementById('violationsChart');
    const eventsBody = document.getElementById('bh-events-body');
    const captionEl  = document.getElementById('bh-table-caption');
    if (captionEl) captionEl.classList.add('govuk-visually-hidden');
    const pagerEl    = document.getElementById('bh-pager');
    const typeBtn    = document.getElementById('curfew-btn-stacked');

    // ONE declaration (no duplicate const errors)
    const durationLinks = Array.from(document.querySelectorAll('.bh-duration-link')).map((a,i)=>{
      if(!a.hasAttribute('data-min')) a.setAttribute('data-min', String([0,1,5,15][i] ?? 0));
      return a;
    });

    // seed defaults for first visit
    seedDefaultsOnce();

    // Chart instance
    const chart = ensureChart(canvas);
    if (!chart) { console.warn('[curfew] Chart not available'); return; }
    window.curfewChart = chart;

    // Load data
    const DATA = window.VIOLATION_SERIES || await loadDataset();

    // read prefs (clamped + sanitised)
    let rangeDays   = Math.min(Number(getPref(key('rangeDays'), 7)) || 7, DATA.totalDays || 7);
    let minDuration = Number(getPref(key('durationMin'), 0)) || 0;
    let chartMode   = getPref(key('mode'), 'line');
    let currentView = 'chart'; // updated via bh:curfew:view-changed

    // --- renderers ---
    function renderChartAndUI() {
      const s = buildSeries(DATA, rangeDays, minDuration);
      chart.data.labels = s.labels;
      chart.data.datasets[0].data = s.acc;
      chart.data.datasets[1].data = s.unacc;
      chart.data.datasets[2].data = s.pend;
      chart.data.datasets[3].data = s.tot;
      chart.update('none');

      setHeading(headingEl, currentView, rangeDays, DATA.totalDays, minDuration);
      setDurationUI(durationLinks, minDuration);

      const durText = (minDuration===0) ? 'All durations' :
                      (minDuration===1) ? 'Over 1 min' :
                      (minDuration===5) ? 'Over 5 mins' : 'Over 15 mins';
      announce(`${currentView === 'table' ? 'Table' : 'Graph'} updated ${rangeDays===7?'for the last 7 days':rangeDays===30?'for the last 30 days':`since tag was fitted (${DATA.totalDays} days)`} (${durText}).`);
    }

    function setChartMode(mode) {
      chartMode = mode;
      setPref(key('mode'), mode);

      const x = (chart.options.scales.x ||= {});
      const y = (chart.options.scales.y ||= { beginAtZero:true, title:{display:true, text:'Minutes'} });

      if (mode === 'line') {
        chart.config.type = 'line';
        x.stacked = false; y.stacked = false;
        chart.data.datasets.forEach((ds, i) => {
          ds.type = 'line';
          ds.borderWidth = (i === 3 ? 3 : 4);
          ds.pointRadius = 2;
          if (i < 3) ds.backgroundColor = 'transparent';
        });
        chart.data.datasets[3].hidden = false; // show Total
      } else {
        chart.config.type = 'bar';
        const stacked = (mode === 'bar-stacked');
        x.stacked = stacked; y.stacked = stacked;
        const fills = ['#008b76', '#d4351c', '#b1b4b6'];
        chart.data.datasets.forEach((ds, i) => {
          ds.type = 'bar';
          ds.borderWidth = 0; ds.pointRadius = 0;
          if (i < 3) ds.backgroundColor = fills[i];
        });
        chart.data.datasets[3].hidden = true; // hide Total in bar modes
      }

      if (typeBtn) {
        const nextText =
          (mode === 'line')        ? 'Switch to stacked bars' :
          (mode === 'bar-stacked') ? 'Switch to grouped bars' :
                                     'Switch to line chart';
        typeBtn.textContent = nextText;
      }

      chart.update();
      requestAnimationFrame(() => chart.resize());
    }

    function buildRows() { return buildEventRows(DATA, rangeDays, minDuration); }

    function renderCurfewTableFromCurrent(page = 1) {
      if (!eventsBody || !captionEl || !pagerEl) return;
      const rows = buildRows();
      renderEventTablePage(eventsBody, captionEl, pagerEl, rows, page, DATA, rangeDays, minDuration);
      if (window.TimeFormat?.normaliseCurfewTimesNow) window.TimeFormat.normaliseCurfewTimesNow();

      const durText = (minDuration===0) ? 'All durations' :
                      (minDuration===1) ? 'Over 1 min' :
                      (minDuration===5) ? 'Over 5 mins' : 'Over 15 mins';
      announce(`Table updated ${rangeDays===7?'for the last 7 days':rangeDays===30?'for the last 30 days':`since tag was fitted (${DATA.totalDays} days)`} (${durText}).`);
    }

    // --- events ---
    document.addEventListener('bh:curfew:view-changed', (e) => {
      currentView = (e?.detail?.view === 'table') ? 'table' : 'chart';
      setHeading(headingEl, currentView, rangeDays, DATA.totalDays, minDuration);
      if (currentView === 'table') renderCurfewTableFromCurrent(1);
    });
    document.addEventListener('bh:curfew:request-table', () => renderCurfewTableFromCurrent(1));

    if (pagerEl) {
      pagerEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-page]'); if (!a) return;
        e.preventDefault();
        const page = Number(a.dataset.page) || 1;
        const rows = buildRows();
        renderEventTablePage(eventsBody, captionEl, pagerEl, rows, page, DATA, rangeDays, minDuration);
        document.getElementById('curfew-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (chooserEl) {
      chooserEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-range]'); if (!a) return;
        e.preventDefault();
        rangeDays = Number(a.dataset.range) || DATA.totalDays;
        setPref(key('rangeDays'), String(rangeDays));
        const rowsOpen = !document.getElementById('curfew-table-wrap')?.hasAttribute('hidden');
        renderChartAndUI();
        if (rowsOpen) renderCurfewTableFromCurrent(1);
        // no auto scroll on range change
      });
    }

    durationLinks.forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        minDuration = Number(a.dataset.min) || 0;
        setPref(key('durationMin'), String(minDuration));
        const rowsOpen = !document.getElementById('curfew-table-wrap')?.hasAttribute('hidden');
        renderChartAndUI();
        if (rowsOpen) renderCurfewTableFromCurrent(1);
      });
    });

    if (typeBtn) {
      typeBtn.addEventListener('click', () => {
        const mode = chartMode;
        const next = (mode === 'line') ? 'bar-stacked'
                  : (mode === 'bar-stacked') ? 'bar-grouped'
                  : 'line';
        chartMode = next;
        setChartMode(next);
      });
    }

    // ---- first paint (guaranteed non-blank) ----
    setChartMode(chartMode || 'line');           // apply saved mode or line
    renderChartAndUI();                          // paints Line • 7 days • All durations on first visit
    window.addEventListener('load', () => chart.resize());
    document.dispatchEvent(new CustomEvent('bh:curfew:data-ready'));
  });
})();
