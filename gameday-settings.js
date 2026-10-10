(() => {
  const preferences = {
    midnight: { storage: 'localStorage', key: 'gameday-mm-muted', off: '1', on: '0' },
    galactic: { storage: 'localStorage', key: 'gameday-gr-muted', off: '1', on: '0' },
    lucky: { storage: 'localStorage', key: 'gameday-l7-muted', off: '1', on: '0' },
    cards: { storage: 'sessionStorage', key: 'gameday:deal-sound', off: 'off', on: 'on' },
    roulette: { storage: 'sessionStorage', key: 'gameday:roulette-sound', off: 'off', on: 'on' },
  };
  const status = document.getElementById('settings-status');
  const controls = [...document.querySelectorAll('[data-sound]')];
  let storageFailed = false;
  const announce = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  for (const control of controls) {
    const preference = preferences[control.dataset.sound];
    try { control.checked = window[preference.storage].getItem(preference.key) !== preference.off; }
    catch { control.checked = true; storageFailed = true; }
    control.addEventListener('change', () => {
      try {
        window[preference.storage].setItem(preference.key, control.checked ? preference.on : preference.off);
        announce('Sound preference saved. Open or reload the game to apply it.');
      } catch {
        control.checked = !control.checked;
        announce('This browser cannot save sound preferences. Allow site storage, or use the sound button inside the game.', true);
      }
    });
  }
  window.addEventListener('storage', event => {
    for (const control of controls) {
      const preference = preferences[control.dataset.sound];
      if (preference.storage === 'localStorage' && (event.key === null || event.key === preference.key)) {
        try { control.checked = localStorage.getItem(preference.key) !== preference.off; } catch { /* Keep the current preference visible. */ }
      }
    }
  });
  announce(storageFailed ? 'Some preferences cannot be read in this browser. You can still use each game’s sound button.' : 'Sound preferences are ready.', storageFailed);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const showMotion = () => { document.getElementById('motion-status').textContent = reducedMotion.matches ? 'Reduced motion is on in your device settings. GameDay uses reduced game animations.' : 'Reduced motion is off in your device settings. GameDay uses its standard game animations.'; };
  reducedMotion.addEventListener('change', showMotion);
  showMotion();
})();
