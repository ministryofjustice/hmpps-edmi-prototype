// /public/javascripts/curfew-charts.js
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad2 = (n) => String(n).padStart(2, '0');

  // time formatting (table generator uses dots; UI normaliser fixes display)
  const to12h = (h) => ({ h: ((h + 11) % 12) + 1, suf: h < 12 ? 'am' : 'pm' });
  function fmtTime(hh, mm) { const { h, suf } = to12h(hh); return `${h}.${pad2(mm)}${suf}`; }
  function addMinutes(hh, mm, mins) { const t = hh * 60 + mm + mins; return { hh: Math.floor((t / 60) % 24), mm: t % 60 }; }

  // ---------- synthetic fallback (only if JSON not found) ----------
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

  // ---------- data loading ----------
  async function loadDataset() {
    try {
      const res = await fetch('/public/data/violations-bh.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      window.VIOLATION_SERIES = json; // freeze for this session
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
        o[t]  += m; o.total += m;
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

  // ---------- UI helpers ----------
  function setHeading(el, n, total) {
    if (!el) return;
    el.textContent = (n === 7) ? 'Last 7 days'
      : (n === 30) ? 'Last 30 days'
        : `Since tag was fitted (${total} days)`;
  }
  function setDurationUI(links, min) {
    links.forEach(a => {
      if (a.dataset.min === String(min)) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  // announcements
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
    const live = ensureLiveRegion();
    live.textContent = msg || '';
  }

  // ---------- table generation + pagination ----------
  const PAGE_SIZE = 20;

  function buildEventRows(dataset, rangeDays, minDuration) {
    const df = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

    const rows = [];
    const slice = (dataset.days || []).slice(-rangeDays);

    for (const d of slice) {
      const [y, m, dd] = (d.date || '').split('-').map(Number);
      const pretty = df.format(new Date(y || 1970, (m || 1) - 1, dd || 1));

      for (const ev of (d.events || [])) {
        const mins = Number(ev.minutes);
        if (!Number.isFinite(mins) || mins < (Number(minDuration) || 0)) continue;

        const end = addMinutes(ev.startHH, ev.startMM, mins);
        const startStr = fmtTime(ev.startHH, ev.startMM);
        const endStr = fmtTime(end.hh, end.mm);
        const durStr = mins === 1 ? '1 min' : `${mins} mins`;
        const typeText = ev.type === 'unacceptable' ? 'Out past curfew'
          : ev.type === 'acceptable' ? 'Return home late'
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
      if (opts.ellipses) {
        return `<li class="${cls.join(' ')}" aria-hidden="true">…</li>`;
      }
      const aria = (opts.current) ? ' aria-current="page"' : '';
      const rel = opts.prev ? ' rel="prev"' : opts.next ? ' rel="next"' : '';
      return `<li class="${cls.join(' ')}">
        <a class="moj-pagination__link" href="#" data-page="${n}"${aria}${rel}
           aria-label="${opts.prev ? 'Previous page' : opts.next ? 'Next page' : 'Page ' + n}">${label}</a>
      </li>`;
    };

    const current = currentPage;
    const last = totalPages;

    const win = 2;
    const start = Math.max(1, current - win);
    const end = Math.min(last, current + win);

    const parts = [];
    parts.push(item(current - 1, '<span class="moj-pagination__link-title">Previous</span>', { prev: true, disabled: current === 1 }));

    if (start > 1) parts.push(item(1, 1));
    if (start > 2) parts.push(item(null, '…', { ellipses: true }));

    for (let n = start; n <= end; n++) parts.push(item(n, n, { current: n === current }));

    if (end < last - 1) parts.push(item(null, '…', { ellipses: true }));
    if (end < last) parts.push(item(last, last));

    parts.push(item(current + 1, '<span class="moj-pagination__link-title">Next</span>', { next: true, disabled: current === last }));

    pagerEl.innerHTML = `<ul class="moj-pagination__list">${parts.join('')}</ul>`;
  }

  function renderEventTablePage(tbody, captionEl, pagerEl, rows, page, dataset, rangeDays, minDuration) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page || 1), totalPages);
    const start = (current - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    tbody.innerHTML = rows.slice(start, end).join('');

    if (captionEl) {
      const label = (rangeDays === 7) ? 'Last 7 days' :
        (rangeDays === 30) ? 'Last 30 days' :
          `Since tag was fitted (${dataset.totalDays} days)`;
      const dur = (minDuration === 0) ? 'All durations' :
        (minDuration === 1) ? '≥1 min' :
          (minDuration === 5) ? '≥5 mins' : '≥15 mins';
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
          { label: 'Acceptable', data: [], tension: 0.25, pointRadius: 2, borderWidth: 2, borderColor: '#008b76' },
          { label: 'Unacceptable', data: [], tension: 0.25, pointRadius: 2, borderWidth: 2, borderColor: '#d4351c' },
          { label: 'Pending', data: [], tension: 0.25, pointRadius: 2, borderWidth: 2, borderColor: '#b1b4b6' },
          { label: 'Total', data: [], tension: 0.25, pointRadius: 0, borderWidth: 2, borderColor: '#505a5f', borderDash: [6, 4] }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { 
          x: { ticks: { maxTicksLimit: 10, autoSkip: true } },
          y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } 
        },
        plugins: {
          legend: { position: 'top' }
        }
      }
    });
  }

  // ---------- main ----------
  onReady(async function () {
    const headingEl = document.getElementById('violation-heading');
    const chooserEl = document.getElementById('range-chooser');
    const canvas = document.getElementById('violationsChart');
    const eventsBody = document.getElementById('bh-events-body');
    const captionEl = document.getElementById('bh-table-caption');
    const pagerEl = document.getElementById('bh-pager');
    const typeBtn = document.getElementById('curfew-btn-stacked');
    const durationLinks = Array.from(document.querySelectorAll('.bh-duration-link')).map((a, i) => {
      if (!a.hasAttribute('data-min')) a.setAttribute('data-min', String([0, 1, 5, 15][i] ?? 0));
      return a;
    });

    const LS = window.localStorage || null;
    const getPref = (k,d)=>{ try{ return (LS && LS.getItem(k)) || d; }catch(_){ return d; } };
    const setPref = (k,v)=>{ try{ LS && LS.setItem(k, v); }catch(_){ } };

    const chart = ensureChart(canvas);
    if (!chart) { console.warn('[curfew] Chart not available'); return; }
    window.curfewChart = chart;

    const DATA = window.VIOLATION_SERIES || await loadDataset();

    let rangeDays   = Number(getPref('curfew.rangeDays', DATA.totalDays || 43));
    let minDuration = Number(getPref('curfew.durationMin', 0));
    let currentPage = 1;
    let lastRows    = [];
    let chartMode   = getPref('curfew.mode','line');

    function renderChartAndUI() {
      const s = buildSeries(DATA, rangeDays, minDuration);
      chart.data.labels = s.labels;
      chart.data.datasets[0].data = s.acc;
      chart.data.datasets[1].data = s.unacc;
      chart.data.datasets[2].data = s.pend;
      chart.data.datasets[3].data = s.tot;
      chart.update('none');

      setHeading(headingEl, rangeDays, DATA.totalDays);
      setDurationUI(durationLinks, minDuration);
      announce(`Chart updated for ${headingEl.textContent.toLowerCase()}, ${minDuration===0?'all durations':`≥${minDuration} mins`}.`);
    }

    // Replace the existing setChartMode(...) with this:
function setChartMode(mode) {
  chartMode = mode;
  setPref('curfew.mode', mode);

  const x = (chart.options.scales.x ||= {});
  const y = (chart.options.scales.y ||= { beginAtZero: true, title: { display: true, text: 'Minutes' } });

  if (mode === 'line') {
    chart.config.type = 'line';
    x.stacked = false; y.stacked = false;

    chart.data.datasets.forEach((ds, i) => {
      ds.borderWidth = 2;
      ds.pointRadius = 2;
      if (i < 3) ds.backgroundColor = 'transparent'; // clear bar fills
    });

    chart.data.datasets[3].hidden = false; // show "Total" line
  } else {
    chart.config.type = 'bar';
    const stacked = (mode === 'bar-stacked');
    x.stacked = stacked; y.stacked = stacked;

    // Solid fills per category
    const fills = ['#008b76', '#d4351c', '#b1b4b6']; // Acceptable, Unacceptable, Pending
    chart.data.datasets.forEach((ds, i) => {
      ds.borderWidth = 0;
      ds.pointRadius = 0;
      if (i < 3) ds.backgroundColor = fills[i];
    });

    chart.data.datasets[3].hidden = true; // hide "Total" in bar modes
  }

  // 🔁 Update the button text to describe the NEXT mode
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


    function buildRows() {
      lastRows = buildEventRows(DATA, rangeDays, minDuration);
      return lastRows;
    }

    function renderCurfewTableFromCurrent() {
      if (!eventsBody || !captionEl || !pagerEl) return;
      const rows = buildRows();
      currentPage = 1;
      renderEventTablePage(eventsBody, captionEl, pagerEl, rows, currentPage, DATA, rangeDays, minDuration);
      if (window.TimeFormat?.normaliseCurfewTimesNow) window.TimeFormat.normaliseCurfewTimesNow();
      announce(`Table updated for ${headingEl.textContent.toLowerCase()}, ${minDuration===0?'all durations':`≥${minDuration} mins`}.`);
    }
    window.renderCurfewTableFromCurrent = renderCurfewTableFromCurrent;
    document.addEventListener('bh:curfew:request-table', renderCurfewTableFromCurrent);

    if (pagerEl) {
      pagerEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-page]'); if (!a) return;
        e.preventDefault();
        currentPage = Number(a.dataset.page) || 1;
        const rows = lastRows.length ? lastRows : buildRows();
        renderEventTablePage(eventsBody, captionEl, pagerEl, rows, currentPage, DATA, rangeDays, minDuration);
        document.getElementById('curfew-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (chooserEl) {
      chooserEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-range]'); if (!a) return;
        e.preventDefault();
        rangeDays = Number(a.dataset.range) || DATA.totalDays;
        setPref('curfew.rangeDays', String(rangeDays));
        currentPage = 1;
        renderChartAndUI();
        if (!document.getElementById('curfew-table-wrap')?.hidden) {
          renderCurfewTableFromCurrent();
        }
        const anchor = document.querySelector('h3.govuk-heading-m');
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    durationLinks.forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        minDuration = Number(a.dataset.min) || 0;
        setPref('curfew.durationMin', String(minDuration));
        currentPage = 1;
        renderChartAndUI();
        if (!document.getElementById('curfew-table-wrap')?.hidden) {
          renderCurfewTableFromCurrent();
        }
      });
    });

    if (typeBtn) {
      typeBtn.addEventListener('click', () => {
        const next = chartMode === 'line' ? 'bar-stacked'
          : chartMode === 'bar-stacked' ? 'bar-grouped'
          : 'line';
        setChartMode(next);
      });
      setChartMode(chartMode); // apply saved mode on load
    }

    renderChartAndUI();
    window.addEventListener('load', () => { chart.resize(); });
    document.addEventListener('bh:curfew:view-changed', (e) => {
      if (e?.detail?.view === 'chart') requestAnimationFrame(() => chart.resize());
    });
    document.dispatchEvent(new CustomEvent('bh:curfew:data-ready'));
  });
})();