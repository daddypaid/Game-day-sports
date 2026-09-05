(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    });
  }

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  document.documentElement.dataset.gamedayApp = standalone ? 'standalone' : 'browser';
})();
