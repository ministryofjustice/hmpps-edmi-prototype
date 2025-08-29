// /public/javascripts/bh-location-init.js
// Initialise Leaflet with Street as default, and provide Satellite as an option.
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function () {
    // 1) Create the map (same as before)
    window.map = L.map('map').setView([51.889, 0.903], 13);

    // 2) Define base layers
    const streetLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }
    );

    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      }
    );

    // 3) Make STREET the default
    streetLayer.addTo(window.map);

    // 4) Register base layers with your overlay control
    if (typeof window.setupMapOverlays === 'function') {
      window.setupMapOverlays({
        baseLayers: {
          'Street': streetLayer,
          'Satellite': satelliteLayer
        }
      });
    } else {
      // Fallback: still expose a layers control so user can switch
      L.control.layers(
        { 'Street': streetLayer, 'Satellite': satelliteLayer },
        {},
        { position: 'topright', collapsed: true }
      ).addTo(window.map);
    }

    // 5) Safety: ensure sizing if container was hidden initially
    setTimeout(function () {
      if (window.map && typeof window.map.invalidateSize === 'function') {
        window.map.invalidateSize();
      }
    }, 0);
  });
})();
