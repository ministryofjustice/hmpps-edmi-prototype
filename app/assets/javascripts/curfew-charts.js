(function () {
  'use strict';

  function onReady(fn){document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();}
  const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  const pad2=(n)=>String(n).padStart(2,'0');

  // --- helpers for time formatting (e.g. "9.45pm to 9.46pm")
  const to12h=(h)=>({h:((h+11)%12)+1,suf:h<12?'am':'pm'});
  function fmtTime(hh,mm){
    const {h,suf}=to12h(hh);
    return `${h}.${mm.toString().padStart(2,'0')}${suf}`;
  }
  function addMinutes(hh,mm,mins){
    const total=hh*60+mm+mins;
    return { hh:Math.floor((total/60)%24), mm: total%60 };
  }

  // Skew short durations; cap 3h37m (217)
  function skewedMinutes(){
    const u=Math.random();
    const m=Math.round(-Math.log(1-u)*8);
    return clamp(m,1,217);
  }
  function pickType(){
    const u=Math.random();
    if (u<0.55) return 'pending';
    if (u<0.80) return 'unacceptable';
    return 'acceptable';
  }

  // Build events WITH start time inside curfew window (19:00–07:00)
  function buildSyntheticDataset(totalDays=43){
    const today=new Date(); today.setHours(0,0,0,0);
    const days=[];
    for(let i=totalDays-1;i>=0;i--){
      const d=new Date(today); d.setDate(today.getDate()-i);
      const iso=`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
      const busy=Math.random()<0.35;
      const targetMax=busy?360:120; // cap per day (mins)
      const count=clamp(Math.round((busy?12:8)+Math.random()*(busy?10:6)),5,20);

      const events=[]; let sum=0;
      for(let e=0;e<count;e++){
        const type=pickType(); const mins=skewedMinutes();
        if (sum+mins>targetMax) break;

        // pick a start minute within the 12h window so end stays in-window
        const windowMins=12*60; // 19:00 -> 07:00
        const startInWin = Math.floor(Math.random()*(windowMins - Math.min(mins, windowMins)));
        // map to clock time: 0..720 -> 19:00..07:00(+1)
        const startTotal = 19*60 + startInWin;         // minutes from day 00:00
        const stHH = Math.floor((startTotal)%1440/60);
        const stMM = (startTotal)%60;

        events.push({ minutes: mins, type, startHH: stHH, startMM: stMM });
        sum+=mins;
      }

      while(sum>360 && events.length){ sum-=events.pop().minutes; }
      days.push({date:iso,events});
    }
    return { totalDays, days };
  }

  // Aggregate for the chart
  function aggregateDayByType(day, minMinutes){
    const o={ acceptable:0, unacceptable:0, pending:0, total:0 };
    for(const ev of day.events){
      if (ev.minutes>=minMinutes){ o[ev.type]+=ev.minutes; o.total+=ev.minutes; }
    }
    return o;
  }

  function buildSeries(dataset, rangeDays, minDuration){
    const fmtLbl=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'});
    const slice=dataset.days.slice(-rangeDays);
    const labels=[], acc=[], unacc=[], pend=[], tot=[];
    for(const d of slice){
      const [y,m,dd]=d.date.split('-').map(Number);
      labels.push(fmtLbl.format(new Date(y,m-1,dd)));
      const t=aggregateDayByType(d,minDuration);
      acc.push(t.acceptable); unacc.push(t.unacceptable); pend.push(t.pending); tot.push(t.total);
    }
    return { labels, acc, unacc, pend, tot };
  }

  function setHeading(el,n,total){ if(!el) return;
    el.textContent = (n===7)?'Last 7 days' : (n===30)?'Last 30 days' : `Since tag was fitted (${total} days)`;
  }

  // --- NEW: populate the event-level table
  function populateEventTable(tbody, captionEl, dataset, rangeDays, minDuration){
    if(!tbody) return;
    const df=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});

    const slice=dataset.days.slice(-rangeDays);
    const rows=[];
    for(const d of slice){
      const [y,m,dd]=d.date.split('-').map(Number);
      const pretty=df.format(new Date(y,m-1,dd));

      for(const ev of d.events){
        if (ev.minutes < minDuration) continue;

        const end = addMinutes(ev.startHH, ev.startMM, ev.minutes);
        const startStr = fmtTime(ev.startHH, ev.startMM);
        const endStr   = fmtTime(end.hh, end.mm);
        const durStr   = ev.minutes===1 ? '1 min' : `${ev.minutes} mins`;
        const typeText = ev.type==='unacceptable' ? 'Out past curfew' : ev.type==='acceptable' ? 'Return home late' : 'Pending classification';
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
    tbody.innerHTML=rows.join('');

    if(captionEl){
      const label=(rangeDays===7)?'Last 7 days':(rangeDays===30)?'Last 30 days':`Since tag was fitted (${dataset.totalDays} days)`;
      const dur = (minDuration===0)?'All durations' : (minDuration===1)?'≥1 min' : (minDuration===5)?'≥5 mins' : '≥15 mins';
      captionEl.textContent=`Violation events – ${label} (${dur})`;
    }
  }

  function ensureChart(canvas){
    if(!canvas || typeof Chart==='undefined') return null;
    const existing=Chart.getChart?Chart.getChart(canvas):null;
    if(existing) return existing;
    return new Chart(canvas.getContext('2d'),{
      type:'line',
      data:{ labels:[], datasets:[
        {
            label:'Acceptable',
            data:[],
            tension:0.25, pointRadius:2, borderWidth:2,
            borderColor:'#008b76',
            backgroundColor:'#008b76'   // GOV.UK green 300
        },
        {
            label:'Unacceptable',
            data:[],
            tension:0.25, pointRadius:2, borderWidth:2,
            borderColor:'#d4351c',
            backgroundColor:'#d4351c'   // GOV.UK red
        },
        {
            label:'Pending',
            data:[],
            tension:0.25, pointRadius:2, borderWidth:2,
            borderColor:'#b1b4b6',
            backgroundColor:'#b1b4b6'   // GOV.UK grey 400
        },
        {
            label:'Total',
            data:[],
            tension:0.25, pointRadius:0, borderWidth:1.5,
            borderColor:'#505a5f',
            borderDash:[6,4],
            backgroundColor:'#505a5f'   // GOV.UK grey 500
        }
        ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ position:'top' } },
        scales:{ y:{ beginAtZero:true, title:{display:true,text:'Minutes'} } }
      }
    });
  }

  function setDurationUI(links, min) {
  links.forEach(a => {
    if (a.dataset.min == String(min)) {
      a.setAttribute('aria-current', 'true');
    } else {
      a.removeAttribute('aria-current');
    }
  });
}


  onReady(function(){
    const headingEl=document.getElementById('violation-heading');
    const chooserEl=document.getElementById('range-chooser');
    const canvas=document.getElementById('violationsChart');
    const chartWrap=document.getElementById('bh-chart');
    const tableWrap=document.getElementById('bh-table');
    const eventsBody=document.getElementById('bh-events-body');
    const captionEl=document.getElementById('bh-table-caption');
    const toggleBtn=document.getElementById('bh-toggle-view');
    const durationLinks=Array.from(document.querySelectorAll('.bh-duration-link')).map((a,i)=>{
      if(!a.hasAttribute('data-min')) a.setAttribute('data-min', String([0,1,5,15][i] ?? 0));
      return a;
    });

    const DATA=window.VIOLATION_SERIES || buildSyntheticDataset(43);
    window.VIOLATION_SERIES=DATA;

    let rangeDays=DATA.totalDays;
    let minDuration=0;

    const chart=ensureChart(canvas);
    if(!chart){ console.warn('[curfew] Chart not available'); return; }

    // === Chart type switcher (line ↔ grouped bars ↔ stacked bars) ===
const typeBtn = document.getElementById('bh-chart-type');

// Track mode and cycle order
let chartMode = 'line'; // 'line' | 'bar-grouped' | 'bar-stacked'

function setChartMode(mode) {
  chartMode = mode;

  if (mode === 'line') {
    chart.config.type = 'line';
    chart.options.scales.x.stacked = false;
    chart.options.scales.y.stacked = false;
    // show the Total line in line mode
    chart.data.datasets[3].hidden = false;

    typeBtn.textContent = 'Switch to stacked bars';
    canvas.setAttribute('aria-label',
      'Line chart showing acceptable, unacceptable, pending and total violation minutes per day.');
  }

  else if (mode === 'bar-grouped') {
    chart.config.type = 'bar';
    chart.options.scales.x.stacked = false;
    chart.options.scales.y.stacked = false;
    // hide Total in bar modes (it duplicates the stack/columns)
    chart.data.datasets[3].hidden = true;

    typeBtn.textContent = 'Switch to line chart';
    canvas.setAttribute('aria-label',
      'Grouped bar chart showing acceptable, unacceptable and pending violation minutes per day.');
  }

  else if (mode === 'bar-stacked') {
    chart.config.type = 'bar';
    chart.options.scales.x.stacked = true;
    chart.options.scales.y.stacked = true;
    chart.data.datasets[3].hidden = true;

    typeBtn.textContent = 'Switch to grouped bars';
    canvas.setAttribute('aria-label',
      'Stacked bar chart showing total violation minutes split by acceptable, unacceptable and pending per day.');
  }

  chart.update('none');
}

// Click → cycle through modes
if (typeBtn) {
  typeBtn.addEventListener('click', () => {
    const next = chartMode === 'line' ? 'bar-stacked'
               : chartMode === 'bar-stacked' ? 'bar-grouped'
               : 'line';
    setChartMode(next);
  });
}

// Initialise to line (matches your current default)
setChartMode('line');


    function render(){
      // chart (daily aggregates)
      const s=buildSeries(DATA, rangeDays, minDuration);
      chart.data.labels=s.labels;
      chart.data.datasets[0].data=s.acc;
      chart.data.datasets[1].data=s.unacc;
      chart.data.datasets[2].data=s.pend;
      chart.data.datasets[3].data=s.tot;
      chart.update('none');

      // event table
      populateEventTable(eventsBody, captionEl, DATA, rangeDays, minDuration);

      setHeading(headingEl, rangeDays, DATA.totalDays);
      setDurationUI(durationLinks, minDuration);
    }

    chooserEl.addEventListener('click', (e)=>{
      const a=e.target.closest('a[data-range]'); if(!a) return;
      e.preventDefault();
      rangeDays=Number(a.dataset.range)||DATA.totalDays;
      render();
      const anchor=document.querySelector('h3.govuk-heading-m');
      if(anchor) anchor.scrollIntoView({behavior:'smooth',block:'start'});
    });

    durationLinks.forEach(a=>{
      a.addEventListener('click',(e)=>{
        e.preventDefault();
        minDuration=Number(a.dataset.min)||0;
        render();
      });
    });

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

    render();
  });
})();
