(() => {
  const timers = new WeakMap();
  const clockPattern = /(\d{1,2}):(\d{2})(?!.*\d)/;

  function initialize(el) {
    if (!(el instanceof HTMLElement)) return;
    const text = el.textContent || '';
    if (/Cached/i.test(text)) {
      timers.delete(el);
      return;
    }
    const match = text.match(clockPattern);
    if (!match) {
      timers.delete(el);
      return;
    }
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) return;
    timers.set(el, {
      prefix: text.slice(0, match.index),
      suffix: text.slice((match.index || 0) + match[0].length),
      baseSeconds: minutes * 60 + seconds,
      startedAt: Date.now(),
      original: match[0]
    });
  }

  function scan(root = document) {
    root.querySelectorAll?.('.game-state strong').forEach(initialize);
  }

  function tick() {
    if (document.hidden) return;
    document.querySelectorAll('.game-state strong').forEach(el => {
      let state = timers.get(el);
      if (!state) {
        initialize(el);
        state = timers.get(el);
      }
      if (!state) return;
      const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      const remaining = Math.max(0, state.baseSeconds - elapsed);
      const mm = Math.floor(remaining / 60);
      const ss = String(remaining % 60).padStart(2, '0');
      const next = `${state.prefix}${mm}:${ss}${state.suffix}`;
      if (el.textContent !== next) el.textContent = next;
    });
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) scan(node);
      }
    }
  });

  function start() {
    scan(document);
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
