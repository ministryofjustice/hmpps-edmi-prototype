// /public/javascripts/curfew-charts.js
(function () {
  'use strict';

  // ---------- small helpers ----------
  function onReady(fn){document.readyState==='loading'
    ? document.addEventListener('DOMContentLoaded',fn,{once:true})
    : fn();}
  const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  const pad2=(n)=>String(n).padStart(2,'0');

  // time formatting (e.g. "9.45pm to 9.46pm")
  const to12h=(h)=>({h:((h+11)%12)+1,suf:h<12?'am':'pm'});
  function fmtTime(hh,mm){const {h,suf}=to12h(hh);return `${h}.${pad2(mm)}${suf}`;}
  function addMinutes(hh,mm,mins){const t=hh*60+mm+mins;return {hh:Math.floor((t/60)%24),mm:t%60};}

  // ---------- synthetic fallback (only if JSON not found) ----------
  function skewedMinutes(){const u=Math.random();const m=Math.round(-Math.log(1-u)*8);return clamp(m,1,217);}
  function pickType(){const u=Math.random(); if(u<0.55) return 'pending'; if(u<0.80) return 'unacceptable'; return 'acceptable';}
  function buildSyntheticDataset(totalDays=43){
    const today=new Date(); today.setHours(0,0,0,0);
    const days=[];
    for(let i=totalDays-1;i>=0;i--){
      const d=new Date(today); d.setDate(today.getDate()-i);
      const iso=`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
      const busy=Math.random()<0.35;
      const targetMax=busy?360:120;
      const count=clamp(Math.round((busy?12:8)+Math.random()*(busy?10:6)),5,20);
      const events=[]; let sum=0;

      for(let e=0;e<count;e++){
        const type=pickType(); const mins=skewedMinutes();
        if(sum+mins>targetMax) break;
        const windowMins=12*60; // 19:00–07:00
        const startInWin=Math.floor(Math.random()*(windowMins - Math.min(mins,windowMins)));
        const startTotal=19*60+startInWin;
        const stHH=Math.floor((startTotal)%1440/60);
        const stMM=(startTotal)%60;
        events.push({ minutes:mins, type, startHH:stHH, startMM:stMM });
        sum+=mins;
      }
      days.push({ date:iso, events });
    }
    return { totalDays, days };
  }

  // ---------- data loading ----------
  async function loadDataset(){
    try{
      const res=await fetch('/public/data/violations-bh.json',{cache:'no-store'});
      if(!res.ok) throw new Error(res.statusText);
      const json=await res.json();
      window.VIOLATION_SERIES=json; // freeze for this session
      return json;
    }catch(err){
      console.warn('[curfew] Using synthetic dataset (fetch failed):',err);
      const fb=buildSyntheticDataset(43);
      window.VIOLATION_SERIES=fb;
      return fb;
    }
  }

  // ---------- aggregations for chart ----------
  function aggregateDayByType(day,minMinutes){
    const o={ acceptable:0, unacceptable:0, pending:0, total:0 };
    for(const ev of day.events){
      if(ev.minutes>=minMinutes){ o[ev.type]+=ev.minutes; o.total+=ev.minutes; }
    }
    return o;
  }
  function buildSeries(dataset,rangeDays,minDuration){
    const fmt=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'});
    const slice=dataset.days.slice(-rangeDays);
    const labels=[], acc=[], unacc=[], pend=[], tot=[];
    for(const d of slice){
      const [y,m,dd]=d.date.split('-').map(Number);
      labels.push(fmt.format(new Date(y,m-1,dd)));
      const t=aggregateDayByType(d,minDuration);
      acc.push(t.acceptable); unacc.push(t.unacceptable); pend.push(t.pending); tot.push(t.total);
    }
    return { labels, acc, unacc, pend, tot };
  }

  // ---------- UI helpers ----------
  function setHeading(el,n,total){
    if(!el) return;
    el.textContent = (n===7)?'Last 7 days' : (n===30)?'Last 30 days' : `Since tag was fitted (${total} days)`;
  }
  function setDurationUI(links,min){
    links.forEach(a=>{
      if(a.dataset.min===String(min)) a.setAttribute('aria-current','true');
      else a.removeAttribute('aria-current');
    });
  }

  // build event-level table
  // ---- Pagination config
const PAGE_SIZE = 20;

// Build array of row HTML strings (no DOM writes here)
function buildEventRows(dataset, rangeDays, minDuration) {
  const pad2 = (n)=>String(n).padStart(2,'0');
  const df = new Intl.DateTimeFormat('en-GB', {
    weekday:'long', day:'2-digit', month:'long', year:'numeric'
  });

  const to12h = (h)=>({h:((h+11)%12)+1,suf:h<12?'am':'pm'});
  const fmtTime = (hh,mm)=>`${to12h(hh).h}.${pad2(mm)}${to12h(hh).suf}`;
  const addMinutes = (hh,mm,mins)=>{
    const t = hh*60+mm+mins; return { hh:Math.floor((t/60)%24), mm:t%60 };
  };

  const rows = [];
  const slice = dataset.days.slice(-rangeDays);

  for (const d of slice) {
    const [y,m,dd] = d.date.split('-').map(Number);
    const pretty = df.format(new Date(y, m-1, dd));

    for (const ev of d.events) {
      if (ev.minutes < minDuration) continue;

      const end = addMinutes(ev.startHH, ev.startMM, ev.minutes);
      const startStr = fmtTime(ev.startHH, ev.startMM);
      const endStr   = fmtTime(end.hh, end.mm);
      const durStr   = ev.minutes===1 ? '1 min' : `${ev.minutes} mins`;
      const typeText = ev.type==='unacceptable' ? 'Out past curfew'
                      : ev.type==='acceptable' ? 'Return home late'
                      : 'Pending classification';
      const statusText = ev.type.charAt(0).toUpperCase()+ev.type.slice(1);

      rows.push(`
        <tr class="govuk-table__row" data-status="${ev.type}">
          <td class="govuk-table__cell" data-sort-value="${d.date}">${pretty}</td>
          <td class="govuk-table__cell" data-sort-value="${pad2(ev.startHH)}${pad2(ev.startMM)}">${startStr} to ${endStr}</td>
          <td class="govuk-table__cell" data-sort-value="${ev.minutes}">${durStr}</td>
          <td class="govuk-table__cell">${typeText}</td>
          <td class="govuk-table__cell" data-sort-value="${ev.type}">${statusText}</td>
        </tr>
      `);
    }
  }
  return rows;
}

// Render pager markup (MoJ style)
function renderPager(pagerEl, totalPages, currentPage) {
  if (!pagerEl) return;
  const item = (n, label=n, opts={}) => {
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
    const rel  = opts.prev ? ' rel="prev"' : opts.next ? ' rel="next"' : '';
    return `<li class="${cls.join(' ')}">
      <a class="moj-pagination__link" href="#" data-page="${n}"${aria}${rel}
         aria-label="${opts.prev?'Previous page':opts.next?'Next page':'Page '+n}">${label}</a>
    </li>`;
  };

  const current = currentPage;
  const last    = totalPages;

  // window of pages around current
  const win = 2;
  const start = Math.max(1, current - win);
  const end   = Math.min(last, current + win);

  const parts = [];
  // prev
  parts.push(item(current-1, '<span class="moj-pagination__link-title">Previous</span>', {prev:true, disabled: current===1}));

  // first + ellipses
  if (start > 1) parts.push(item(1, 1));
  if (start > 2) parts.push(item(null, '…', {ellipses:true}));

  // middle
  for (let n=start; n<=end; n++) parts.push(item(n, n, {current: n===current}));

  // ellipses + last
  if (end < last-1) parts.push(item(null, '…', {ellipses:true}));
  if (end < last)   parts.push(item(last, last));

  // next
  parts.push(item(current+1, '<span class="moj-pagination__link-title">Next</span>', {next:true, disabled: current===last}));

  pagerEl.innerHTML = `<ul class="moj-pagination__list">${parts.join('')}</ul>`;
}

// Write the visible page rows + caption + pager
function renderEventTablePage(tbody, captionEl, pagerEl, rows, page, dataset, rangeDays, minDuration) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page || 1), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const end   = start + PAGE_SIZE;

  tbody.innerHTML = rows.slice(start, end).join('');

  if (captionEl) {
    const label = (rangeDays===7) ? 'Last 7 days' :
                  (rangeDays===30) ? 'Last 30 days' :
                  `Since tag was fitted (${dataset.totalDays} days)`;
    const dur = (minDuration===0) ? 'All durations' :
                (minDuration===1) ? '≥1 min' :
                (minDuration===5) ? '≥5 mins' : '≥15 mins';
    captionEl.textContent = `Violation events – ${label} (${dur}) • ${rows.length} results`;
  }

  renderPager(pagerEl, totalPages, current);
}


  // build/get the Chart.js instance
  function ensureChart(canvas){
    if(!canvas || typeof Chart==='undefined') return null;
    const existing = Chart.getChart ? Chart.getChart(canvas) : null;
    if(existing) return existing;
    return new Chart(canvas.getContext('2d'), {
  type: 'line',
  data: { labels: [], datasets: [
    // Acceptable
    { label:'Acceptable',   data:[], tension:0.25, pointRadius:2, borderWidth:2,
      borderColor:'#008b76', pointBackgroundColor:'#008b76', _baseColor:'#008b76' },
    // Unacceptable
    { label:'Unacceptable', data:[], tension:0.25, pointRadius:2, borderWidth:2,
      borderColor:'#d4351c', pointBackgroundColor:'#d4351c', _baseColor:'#d4351c' },
    // Pending
    { label:'Pending',      data:[], tension:0.25, pointRadius:2, borderWidth:2,
      borderColor:'#b1b4b6', pointBackgroundColor:'#b1b4b6', _baseColor:'#b1b4b6' },
    // Total (dashed grey)
    { label:'Total',        data:[], tension:0.25, pointRadius:0, borderWidth:2,
      borderColor:'#505a5f', borderDash:[6,4], _baseColor:'#505a5f' }
  ]},
  options: {
    responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    scales:{ y:{ beginAtZero:true, title:{display:true,text:'Minutes'} } }
  }
});


  }

  // ---------- main ----------
  onReady(async function(){
    // DOM
    const headingEl   = document.getElementById('violation-heading');
    const chooserEl   = document.getElementById('range-chooser');
    const canvas      = document.getElementById('violationsChart');
    const chartWrap   = document.getElementById('bh-chart');
    const tableWrap   = document.getElementById('bh-table');
    const eventsBody  = document.getElementById('bh-events-body');
    const captionEl   = document.getElementById('bh-table-caption');
    const toggleBtn   = document.getElementById('bh-toggle-view');
    const typeBtn     = document.getElementById('bh-chart-type'); // optional
    const durationLinks = Array.from(document.querySelectorAll('.bh-duration-link')).map((a,i)=>{
      if(!a.hasAttribute('data-min')) a.setAttribute('data-min', String([0,1,5,15][i] ?? 0));
      return a;
    });

    // Chart instance (must exist before rendering)
    const chart=ensureChart(canvas);
    if(!chart){ console.warn('[curfew] Chart not available'); return; }

    // Load data (JSON or fallback)
    const DATA = window.VIOLATION_SERIES || await loadDataset();

    let rangeDays   = DATA.totalDays || 43;
    let minDuration = 0;

    function render(){
      // chart data
      const s=buildSeries(DATA, rangeDays, minDuration);
      chart.data.labels            = s.labels;
      chart.data.datasets[0].data  = s.acc;
      chart.data.datasets[1].data  = s.unacc;
      chart.data.datasets[2].data  = s.pend;
      chart.data.datasets[3].data  = s.tot;
      chart.update('none');

      // table data
      const pagerEl = document.getElementById('bh-pager');
let currentPage = 1; // reset on range/duration change

function render() {
  // ... your existing chart code ...

  // Build once, then page it
  const rows = buildEventRows(DATA, rangeDays, minDuration);
  renderEventTablePage(eventsBody, captionEl, pagerEl, rows, currentPage, DATA, rangeDays, minDuration);

  setHeading(headingEl, rangeDays, DATA.totalDays);
  setDurationUI(durationLinks, minDuration);
}

// Handle page clicks with event delegation
pagerEl.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-page]');
  if (!a) return;
  e.preventDefault();
  currentPage = Number(a.dataset.page) || 1;
  // Re-use the last-built rows to avoid recomputing? Simple route: rebuild.
  const rows = buildEventRows(DATA, rangeDays, minDuration);
  renderEventTablePage(eventsBody, captionEl, pagerEl, rows, currentPage, DATA, rangeDays, minDuration);
  // keep keyboard focus in view
  document.getElementById('bh-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// When range or duration changes, reset to page 1 then render()
chooserEl.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-range]'); if (!a) return;
  e.preventDefault();
  rangeDays   = Number(a.dataset.range) || DATA.totalDays;
  currentPage = 1;
  render();
});

durationLinks.forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  minDuration = Number(a.dataset.min) || 0;
  currentPage = 1;
  render();
}));


      // heading + duration UI
      setHeading(headingEl, rangeDays, DATA.totalDays);
      setDurationUI(durationLinks, minDuration);
    }

    // Range chooser
    if(chooserEl){
      chooserEl.addEventListener('click',(e)=>{
        const a=e.target.closest('a[data-range]'); if(!a) return;
        e.preventDefault();
        rangeDays = Number(a.dataset.range) || DATA.totalDays;
        render();
        const anchor=document.querySelector('h3.govuk-heading-m');
        if(anchor) anchor.scrollIntoView({behavior:'smooth',block:'start'});
      });
    }

    // Duration filter (All must be clickable => minDuration=0)
    durationLinks.forEach(a=>{
      a.addEventListener('click',(e)=>{
        e.preventDefault();
        minDuration = Number(a.dataset.min) || 0;
        render();
      });
    });

    // Chart/Table toggle
    if(toggleBtn && chartWrap && tableWrap){
      toggleBtn.addEventListener('click',()=>{
        const showingChart=!chartWrap.hasAttribute('hidden');
        if(showingChart){
          chartWrap.setAttribute('hidden','');
          tableWrap.removeAttribute('hidden');
          toggleBtn.textContent='Change to chart view';
          toggleBtn.setAttribute('data-view','table');
          toggleBtn.setAttribute('aria-controls','bh-table');
        } else {
          tableWrap.setAttribute('hidden','');
          chartWrap.removeAttribute('hidden');
          toggleBtn.textContent='Change to accessible table view';
          toggleBtn.setAttribute('data-view','chart');
          toggleBtn.setAttribute('aria-controls','bh-chart');
        }
      });
    }

    // Chart type switcher (optional button)
    let chartMode='line';
    function setChartMode(mode) {
  chartMode = mode;

  if (mode === 'line') {
    chart.config.type = 'line';
    chart.options.scales.x.stacked = false;
    chart.options.scales.y.stacked = false;
    chart.data.datasets.forEach((ds, i) => {
      ds.type = 'line';
      ds.fill = false;           // don’t fill under the line
      ds.borderWidth = 2;
      ds.pointRadius = 2;
      ds.backgroundColor = 'transparent';
    });
    chart.data.datasets[3].hidden = false; // show Total line
    typeBtn.textContent = 'Switch to stacked bars';
  }

  else if (mode === 'bar-stacked') {
    chart.config.type = 'bar';
    chart.options.scales.x.stacked = true;
    chart.options.scales.y.stacked = true;
    chart.data.datasets.forEach((ds, i) => {
      ds.type = 'bar';
      ds.fill = true;
      ds.borderWidth = 0;
      ds.pointRadius = 0;
      ds.backgroundColor = ds.borderColor; // use the same colour for fill
    });
    chart.data.datasets[3].hidden = true; // hide Total
    typeBtn.textContent = 'Switch to grouped bars';
  }

  else if (mode === 'bar-grouped') {
    chart.config.type = 'bar';
    chart.options.scales.x.stacked = false;
    chart.options.scales.y.stacked = false;
    chart.data.datasets.forEach((ds, i) => {
      ds.type = 'bar';
      ds.fill = true;
      ds.borderWidth = 0;
      ds.pointRadius = 0;
      ds.backgroundColor = ds.borderColor;
    });
    chart.data.datasets[3].hidden = true;
    typeBtn.textContent = 'Switch to line chart';
  }

  chart.update('none');
}

    if(typeBtn){
      typeBtn.addEventListener('click',()=>{
        const next = chartMode==='line' ? 'bar-stacked'
                   : chartMode==='bar-stacked' ? 'bar-grouped'
                   : 'line';
        setChartMode(next);
      });
      setChartMode('line');
    }

    // First paint
    render();
  });
})();
