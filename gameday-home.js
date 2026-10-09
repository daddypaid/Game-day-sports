// Homepage controls are initialized before optional account services load.
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const menuBackdrop = document.getElementById('menuBackdrop');
const mainContent = document.getElementById('mainContent');
const mobileMenu = window.matchMedia('(max-width: 760px)');
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let menuOpen = false;

function sidebarControls() {
  return sidebar ? [...sidebar.querySelectorAll(focusableSelector)].filter(element => element.getClientRects().length && !element.closest('[hidden]')) : [];
}

function setMenu(open, restoreFocus = true) {
  if (!sidebar || !menuToggle) return;
  menuOpen = Boolean(open && mobileMenu.matches);
  document.body.classList.toggle('menu-open', menuOpen);
  menuToggle.setAttribute('aria-expanded', String(menuOpen));
  menuToggle.setAttribute('aria-label', menuOpen ? 'Close navigation' : 'Open navigation');
  if (menuBackdrop) menuBackdrop.hidden = !menuOpen;
  if (mainContent) mainContent.inert = menuOpen;
  sidebar.inert = mobileMenu.matches && !menuOpen;
  if (mobileMenu.matches) sidebar.setAttribute('aria-hidden', String(!menuOpen));
  else sidebar.removeAttribute('aria-hidden');
  if (menuOpen) {
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    (sidebarControls()[0] || sidebar).focus();
  } else {
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    if (restoreFocus && mobileMenu.matches) menuToggle.focus();
  }
}

menuToggle?.addEventListener('click', () => setMenu(!menuOpen));
menuBackdrop?.addEventListener('click', () => setMenu(false));
sidebar?.addEventListener('click', event => {
  if (event.target.closest('a[href]')) setMenu(false, false);
});
document.addEventListener('keydown', event => {
  if (!menuOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    setMenu(false);
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = sidebarControls();
  if (!controls.length) {
    event.preventDefault();
    sidebar.focus();
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});
mobileMenu.addEventListener('change', () => setMenu(false, false));
setMenu(false, false);

const searchForm = document.getElementById('homeSearch');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
let results = [];
let selectedResult = -1;
const searchDestinations = new Map();
for (const link of document.querySelectorAll('a[data-search]')) {
  const url = new URL(link.getAttribute('href'), window.location.href);
  if (url.origin !== window.location.origin) continue;
  const label = link.dataset.searchLabel || link.getAttribute('aria-label') || link.textContent.replace(/\s+/g, ' ').trim();
  if (!label) continue;
  const keywords = `${link.dataset.search || ''} ${label}`.toLocaleLowerCase();
  const existing = searchDestinations.get(url.href);
  if (existing) existing.keywords += ` ${keywords}`;
  else searchDestinations.set(url.href, { href: url.href, label, keywords });
}

function closeSearch() {
  if (searchResults) searchResults.hidden = true;
  searchInput?.setAttribute('aria-expanded', 'false');
  searchInput?.removeAttribute('aria-activedescendant');
  selectedResult = -1;
}

function highlightResult(index) {
  selectedResult = index;
  const links = searchResults.querySelectorAll('.search-result');
  links.forEach((link, itemIndex) => {
    const selected = itemIndex === index;
    link.classList.toggle('is-active', selected);
    link.setAttribute('aria-selected', String(selected));
  });
  if (links[index]) {
    searchInput.setAttribute('aria-activedescendant', links[index].id);
    links[index].scrollIntoView({ block: 'nearest' });
  } else searchInput.removeAttribute('aria-activedescendant');
}

function showSearch() {
  if (!searchInput || !searchResults) return;
  const terms = searchInput.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  searchResults.replaceChildren();
  results = terms.length ? [...searchDestinations.values()].filter(destination => terms.every(term => destination.keywords.includes(term))).slice(0, 6) : [];
  if (!terms.length) {
    closeSearch();
    return;
  }
  selectedResult = -1;
  searchInput.removeAttribute('aria-activedescendant');
  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = 'No sports or games found. Try NFL, blackjack, or slots.';
    empty.setAttribute('role', 'status');
    searchResults.append(empty);
  }
  results.forEach((destination, index) => {
    const link = document.createElement('a');
    link.href = destination.href;
    link.className = 'search-result';
    link.id = `home-search-result-${index}`;
    link.setAttribute('role', 'option');
    link.setAttribute('aria-selected', 'false');
    link.tabIndex = -1;
    link.textContent = destination.label;
    link.addEventListener('pointerdown', event => event.preventDefault());
    link.addEventListener('pointermove', () => highlightResult(index));
    searchResults.append(link);
  });
  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

if (searchInput && searchResults) {
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', searchResults.id);
  searchInput.setAttribute('aria-expanded', 'false');
  searchResults.setAttribute('role', 'listbox');
  searchResults.setAttribute('aria-label', 'Sports and games');
  searchInput.addEventListener('input', showSearch);
  searchInput.addEventListener('focus', showSearch);
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (searchResults.hidden) showSearch();
      if (!results.length) return;
      const next = event.key === 'ArrowDown' ? (selectedResult + 1) % results.length : (selectedResult < 0 ? results.length - 1 : (selectedResult - 1 + results.length) % results.length);
      highlightResult(next);
    } else if (event.key === 'Tab') closeSearch();
  });
  searchInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!searchForm?.contains(document.activeElement)) closeSearch();
    }, 0);
  });
  searchForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (searchResults.hidden) showSearch();
    const destination = results[selectedResult < 0 ? 0 : selectedResult];
    if (destination) window.location.assign(destination.href);
  });
  document.addEventListener('click', event => {
    if (!searchForm?.contains(event.target)) closeSearch();
  });
}

const promotionsButton = document.getElementById('promotionsButton');
const promotionsDialog = document.getElementById('promotionsDialog');
if (promotionsButton && promotionsDialog) {
  promotionsButton.addEventListener('click', () => {
    setMenu(false, false);
    closeSearch();
    if (typeof promotionsDialog.showModal === 'function') promotionsDialog.showModal();
    else promotionsDialog.setAttribute('open', '');
    promotionsDialog.querySelector('[data-dialog-close], button')?.focus();
  });
  const closePromotions = () => {
    if (typeof promotionsDialog.close === 'function') promotionsDialog.close();
    else promotionsDialog.removeAttribute('open');
  };
  promotionsDialog.querySelectorAll('[data-dialog-close]').forEach(button => button.addEventListener('click', closePromotions));
  promotionsDialog.addEventListener('click', event => {
    if (event.target !== promotionsDialog) return;
    const rect = promotionsDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePromotions();
  });
  promotionsDialog.addEventListener('close', () => {
    if (mobileMenu.matches && sidebar?.contains(promotionsButton)) menuToggle?.focus();
    else promotionsButton.focus();
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=76', { scope: './', updateViaCache: 'none' }).catch(() => {});
  });
}

// A saved session only informs the display. Supabase RLS controls wallet access.
async function initializeWallet() {
  const walletBalance = document.getElementById('walletBalance');
  const walletLink = document.getElementById('walletLink');
  const accountLink = document.getElementById('accountLink');
  if (!walletBalance || !walletLink) return;
  let authVersion = 0;
  let currentUserId = null;
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const display = (text, description, signedIn = false) => {
    walletBalance.textContent = text;
    walletLink.setAttribute('aria-label', description);
    walletLink.title = description;
    accountLink?.setAttribute('aria-label', signedIn ? 'View your account' : 'Sign in to your account');
  };
  display('Sign in', 'Sign in to view your test wallet. No real money.');
  try {
    const [{ createClient }, { GAMEDAY_CONFIG }] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm'),
      import('./gameday-config.js'),
    ]);
    const supabase = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
    const applySession = session => {
      const requestVersion = ++authVersion;
      currentUserId = session?.user?.id || null;
      if (!currentUserId) {
        display('Sign in', 'Sign in to view your test wallet. No real money.');
        return;
      }
      display('Loading…', 'Loading your test wallet. No real money.', true);
      const userId = currentUserId;
      // Keep API calls outside onAuthStateChange to avoid the auth callback lock.
      window.setTimeout(async () => {
        if (requestVersion !== authVersion || currentUserId !== userId) return;
        try {
          const { data, error } = await supabase.from('wallets').select('balance').eq('user_id', userId).maybeSingle();
          if (requestVersion !== authVersion || currentUserId !== userId) return;
          const balance = data?.balance === null || data?.balance === undefined ? NaN : Number(data.balance);
          if (error || !Number.isFinite(balance)) {
            display('Test wallet', 'Test wallet balance unavailable. Open your account to refresh. No real money.', true);
            return;
          }
          const formattedBalance = currency.format(balance);
          display(formattedBalance, `Test wallet balance ${formattedBalance}. No real money.`, true);
        } catch {
          if (requestVersion === authVersion && currentUserId === userId) display('Test wallet', 'Test wallet balance unavailable. Open your account to refresh. No real money.', true);
        }
      }, 0);
    };
    supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    const initialVersion = authVersion;
    const { data, error } = await supabase.auth.getSession();
    if (initialVersion !== authVersion) return;
    if (error) display('Sign in', 'Account connection unavailable. Open your account to sign in. No real money.');
    else applySession(data.session);
  } catch {
    if (authVersion === 0) display('Sign in', 'Open your account to sign in and view your test wallet. No real money.');
  }
}

initializeWallet();
