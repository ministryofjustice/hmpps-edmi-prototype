// /public/javascripts/curfew-view-toggle.js
(function(){
  'use strict';

  function onReady(fn){
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', fn, {once:true});
    } else { fn(); }
  }

  onReady(function(){
    const chartWrap  = document.getElementById('curfew-chart-wrap');
    const tableWrap  = document.getElementById('curfew-table-wrap');
    const toggleBtn  = document.getElementById('curfew-btn-toggle-view');
    const stackedBtn = document.getElementById('curfew-btn-stacked');

    if(!chartWrap || !tableWrap || !toggleBtn) return;

    const LS = window.localStorage || null;
    const getPref = (k,d)=>{ try{ return (LS && LS.getItem(k)) || d; }catch(_){ return d; } };
    const setPref = (k,v)=>{ try{ LS && LS.setItem(k, v); }catch(_){ } };

    // Apply initial view from localStorage (default: chart)
    function applyView(view){
      const showChart = (view !== 'table');
      if(showChart){
        tableWrap.setAttribute('hidden','');
        chartWrap.removeAttribute('hidden');
        toggleBtn.textContent = 'Change to accessible table view';
        toggleBtn.setAttribute('data-view','chart');
        toggleBtn.setAttribute('aria-controls','curfew-chart-wrap');
        stackedBtn && stackedBtn.classList.remove('bh-hide');
      } else {
        chartWrap.setAttribute('hidden','');
        tableWrap.removeAttribute('hidden');
        toggleBtn.textContent = 'Change to chart view';
        toggleBtn.setAttribute('data-view','table');
        toggleBtn.setAttribute('aria-controls','curfew-table-wrap');
        stackedBtn && stackedBtn.classList.add('bh-hide');
        // Ask the charts controller to (re)render the table if needed
        document.dispatchEvent(new CustomEvent('bh:curfew:request-table'));
      }
      // Announce to other scripts (e.g., to nudge chart resize on return)
      document.dispatchEvent(new CustomEvent('bh:curfew:view-changed', { detail:{ view: showChart ? 'chart' : 'table' } }));
      setPref('curfew.view', showChart ? 'chart' : 'table');
    }

    applyView(getPref('curfew.view', 'chart'));

    toggleBtn.addEventListener('click', function(){
      const goingTo = (toggleBtn.getAttribute('data-view') === 'chart') ? 'table' : 'chart';
      applyView(goingTo);
    });
  });
})();