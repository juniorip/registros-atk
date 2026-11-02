(function () {
  if (window.__atkSpeedInsightsInitialized) return;
  window.__atkSpeedInsightsInitialized = true;
  window.si = window.si || function () {
    (window.siq = window.siq || []).push(arguments);
  };
  window.si('beforeSend', function (event) {
    // Keep development and preview traffic out of production measurements.
    if (window.location.hostname !== 'atkportal.app') return null;
    try {
      const url = new URL(event.url, window.location.origin);
      return { ...event, url: url.origin + url.pathname };
    } catch (_) {
      return null;
    }
  });
})();
