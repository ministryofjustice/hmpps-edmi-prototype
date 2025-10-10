// /public/javascripts/curfew-view-toggle.js  (versioned keys; default 'chart')
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

    const STORAGE_VERSION = 'v2';
    const LS = window.localStorage || null;
    const key = (s)=>`curfew:${STORAGE_VERSION}:${s}`;
    const getPref = (k,d)=>{ try{ const v = LS && LS.getItem(k); return (v===null||v===undefined)?d:v; }catch(_){ return d; } };
    const setPref = (k,v)=>{ try{ LS && LS.setItem(k,v); }catch(_){ } };

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
        document.dispatchEvent(new CustomEvent('bh:curfew:request-table'));
      }
      document.dispatchEvent(new CustomEvent('bh:curfew:view-changed', { detail:{ view: showChart ? 'chart' : 'table' } }));
      setPref(key('view'), showChart ? 'chart' : 'table');
    }

    // default to 'chart' on first load for v2 keys
    applyView(getPref(key('view'), 'chart'));

    toggleBtn.addEventListener('click', function(){
      const goingTo = (toggleBtn.getAttribute('data-view') === 'chart') ? 'table' : 'chart';
      applyView(goingTo);
    });
  });
})();