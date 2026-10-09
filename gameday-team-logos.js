/* Team identities are an optional presentation layer. The committed catalog of
   ESPN artwork and SportsDB team crests is loaded once; odds, scores and betting
   requests never wait for logo artwork. */
const CATALOG_URL = new URL('./assets/sportsbook/team-logos.json', import.meta.url);
const LOGO_HOSTS = new Set(['a.espncdn.com', 'a1.espncdn.com', 'a2.espncdn.com', 'a3.espncdn.com', 'a4.espncdn.com']);
let catalogPromise;
let sportIndexes;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function normalizeName(value) {
  return String(value ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o')
    .replace(/&/g, ' and ').replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sportKey(value) {
  return String(value ?? '').toLowerCase().trim();
}

function approvedLogo(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const approvedHost = LOGO_HOSTS.has(url.hostname) ||
      (url.hostname === 'r2.thesportsdb.com' && url.pathname.startsWith('/images/media/team/badge/'));
    return url.protocol === 'https:' && approvedHost &&
      !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null;
  } catch {
    return null;
  }
}

function addAlias(index, alias, team) {
  const name = normalizeName(alias);
  if (!name) return;
  if (!index.has(name)) index.set(name, new Set());
  index.get(name).add(team);
}

function makeIndexes(catalog) {
  const indexes = new Map();
  for (const [leagueKey, league] of Object.entries(catalog?.leagues || {})) {
    if (!Array.isArray(league?.teams)) continue;
    const primary = new Map();
    const football = new Map();
    const sports = [...new Set([leagueKey, ...(Array.isArray(league.sports) ? league.sports : [])].map(sportKey).filter(Boolean))];
    const isSoccer = sports.some(key => key.startsWith('soccer_') || ['mls', 'epl', 'ucl'].includes(key));
    for (const record of league.teams) {
      if (!record || typeof record.name !== 'string') continue;
      const team = { id: String(record.id ?? ''), name: record.name, logo: approvedLogo(record.logo) };
      const names = [record.name, ...(Array.isArray(record.names) ? record.names : [])];
      for (const alias of names) {
        if (typeof alias !== 'string') continue;
        addAlias(primary, alias, team);
        if (isSoccer) addAlias(football, normalizeName(alias).replace(/\b(fc|cf|sc|afc|football club)\b/g, ' ').replace(/\s+/g, ' ').trim(), team);
      }
    }
    const index = { primary, football, isSoccer };
    for (const key of sports) {
      if (!indexes.has(key)) indexes.set(key, []);
      indexes.get(key).push(index);
    }
  }
  return indexes;
}

function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL, { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then(catalog => { sportIndexes = makeIndexes(catalog); return sportIndexes; })
      .catch(() => { sportIndexes = new Map(); return sportIndexes; });
  }
  return catalogPromise;
}

function indexesForSport(sport) {
  if (!sportIndexes) return [];
  const key = sportKey(sport);
  if (sportIndexes.has(key)) return sportIndexes.get(key);
  // Only explicitly recognized futures suffixes can inherit a league's teams.
  // Unknown sports never search another league for a similarly named team.
  const base = key.replace(/_(?:super_bowl_winner|championship_winner|world_series_winner|stanley_cup_winner|winner|outrights)$/, '');
  return base !== key ? sportIndexes.get(base) || [] : [];
}

function uniqueTeam(matches) {
  if (!matches.size) return null;
  const teams = [...matches];
  // The same soccer club can occur in a national league and Champions League.
  // The same provider ID and artwork are safe; shared nicknames or a shared
  // placeholder image alone are insufficient to identify a club.
  const identities = new Set(teams.map(team => `${team.id || normalizeName(team.name)}|${team.logo || normalizeName(team.name)}`));
  return identities.size === 1 ? teams[0] : null;
}

function resolveTeam(name, sport) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const indexes = indexesForSport(sport);
  const exact = new Set();
  for (const index of indexes) for (const team of index.primary.get(normalized) || []) exact.add(team);
  if (exact.size) return uniqueTeam(exact);
  const footballName = normalized.replace(/\b(fc|cf|sc|afc|football club)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const football = new Set();
  for (const index of indexes) if (index.isSoccer) for (const team of index.football.get(footballName) || []) football.add(team);
  return uniqueTeam(football);
}

function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  if (words.length === 1) return [...words[0]].slice(0, 3).join('').toUpperCase();
  return words.slice(0, 3).map(word => [...word][0]).join('').toUpperCase();
}

function badgeMarkup(name) {
  return `<span class="gd-team-logo" aria-hidden="true"><span class="gd-team-monogram">${escapeHtml(initials(name))}</span></span>`;
}

/** Render a name immediately, with artwork enhanced separately by hydration.
    fallback:false is useful for totals, player props and other uncertain names. */
export function teamLabel(name, sport, options = {}) {
  const text = String(name ?? '');
  if (!text) return '';
  const fallback = options.fallback !== false;
  const known = resolveTeam(text, sport);
  return `<span class="gd-team-identity" data-gd-team-name="${escapeHtml(text)}" data-gd-team-sport="${escapeHtml(sport)}" data-gd-team-fallback="${fallback ? 'yes' : 'no'}">${fallback || known ? badgeMarkup(text) : ''}<span class="gd-team-text">${escapeHtml(text)}</span></span>`;
}

function ensureBadge(identity, name) {
  let badge = identity.querySelector('.gd-team-logo');
  if (!badge) {
    badge = identity.ownerDocument.createElement('span');
    badge.className = 'gd-team-logo';
    badge.setAttribute('aria-hidden', 'true');
    const monogram = identity.ownerDocument.createElement('span');
    monogram.className = 'gd-team-monogram';
    monogram.textContent = initials(name);
    badge.appendChild(monogram);
    identity.prepend(badge);
  }
  return badge;
}

/** Safe to call after each sportsbook render. Detached, replaced nodes are ignored. */
export async function hydrateTeamLogos(root = document) {
  const selector = '.gd-team-identity[data-gd-team-name]';
  const identities = [
    ...(root.matches?.(selector) ? [root] : []),
    ...(root.querySelectorAll?.(selector) || [])
  ];
  if (!identities.length) return;
  await loadCatalog();
  for (const identity of identities) {
    if (!identity.isConnected) continue;
    const name = identity.dataset.gdTeamName;
    const team = resolveTeam(name, identity.dataset.gdTeamSport);
    if (!team && identity.dataset.gdTeamFallback === 'no') {
      identity.querySelector('.gd-team-logo')?.remove();
      continue;
    }
    const badge = ensureBadge(identity, name);
    if (!team?.logo || badge.dataset.gdLogo === team.logo) continue;
    badge.querySelector('img')?.remove();
    badge.classList.remove('gd-team-logo--loaded');
    badge.dataset.gdLogo = team.logo;
    const image = identity.ownerDocument.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 32;
    image.height = 32;
    image.addEventListener('load', () => {
      if (image.naturalWidth) badge.classList.add('gd-team-logo--loaded');
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      badge.classList.remove('gd-team-logo--loaded');
    });
    badge.appendChild(image);
    image.src = team.logo;
  }
}
