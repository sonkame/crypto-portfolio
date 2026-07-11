/* CoinGecko free public API client with localStorage caching and 429 backoff.
   Endpoints verified against docs.coingecko.com (July 2026). */
const API = (() => {
  const BASE = 'https://api.coingecko.com/api/v3';
  const MARKETS_URL = BASE + '/coins/markets?vs_currency=usd&order=market_cap_desc'
    + '&per_page=100&page=1&sparkline=true&price_change_percentage=1h%2C24h%2C7d';
  const GLOBAL_URL = BASE + '/global';
  const CACHE_MARKETS = 'cryptofolio.cache.markets';
  const CACHE_GLOBAL = 'cryptofolio.cache.global';
  const MAX_BACKOFF = 10 * 60 * 1000;

  let backoffUntil = 0;
  let failures = 0;

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function readCache(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
  }

  function fromCacheResult() {
    const m = readCache(CACHE_MARKETS);
    if (!m) return null;
    const g = readCache(CACHE_GLOBAL);
    return { markets: m.data, global: g ? g.data : null, fromCache: true, updatedAt: m.t };
  }

  /* Returns { markets, global, fromCache, updatedAt } or null when nothing
     is available at all (first load + network down). Never throws. */
  async function fetchAll() {
    if (Date.now() < backoffUntil) return fromCacheResult();
    try {
      const [markets, globalRes] = await Promise.all([
        getJSON(MARKETS_URL),
        getJSON(GLOBAL_URL),
      ]);
      failures = 0;
      backoffUntil = 0;
      writeCache(CACHE_MARKETS, markets);
      writeCache(CACHE_GLOBAL, globalRes.data);
      return { markets, global: globalRes.data, fromCache: false, updatedAt: Date.now() };
    } catch (e) {
      failures++;
      const wait = Math.min(MAX_BACKOFF, 60 * 1000 * Math.pow(2, failures - 1));
      backoffUntil = Date.now() + wait;
      console.warn('CoinGecko fetch failed (' + e.message + '), backing off ' + Math.round(wait / 1000) + 's');
      return fromCacheResult();
    }
  }

  /* ----- per-coin history & metadata (used by the Analytics tab) ----- */

  const CHART_TTL_1D = 5 * 60 * 1000;
  const CHART_TTL = 30 * 60 * 1000;
  const CATS_TTL = 7 * 24 * 60 * 60 * 1000;
  const QUEUE_GAP = 400;

  function readTimed(key, ttl) {
    const c = readCache(key);
    return c && Date.now() - c.t < ttl ? c.data : null;
  }

  /* All per-coin requests go through one serial queue so parallel analytics
     widgets can't burst past the free-tier rate limit. */
  let queue = Promise.resolve();
  function enqueue(task) {
    const run = () => task();
    const p = queue.then(run, run);
    queue = p.catch(() => {}).then(() => new Promise(r => setTimeout(r, QUEUE_GAP)));
    return p;
  }

  /* [[ms, price], ...] for a coin. Serves stale cache when the API fails. */
  async function fetchMarketChart(id, days) {
    const key = 'cryptofolio.cache.chart.' + id + '.' + days;
    const fresh = readTimed(key, days <= 1 ? CHART_TTL_1D : CHART_TTL);
    if (fresh) return fresh;
    try {
      const data = await enqueue(() => getJSON(BASE + '/coins/' + encodeURIComponent(id)
        + '/market_chart?vs_currency=usd&days=' + days));
      const prices = data.prices || [];
      writeCache(key, prices);
      return prices;
    } catch (e) {
      const stale = readCache(key);
      if (stale) return stale.data;
      throw e;
    }
  }

  /* Category names for a coin (cached a week — they rarely change). */
  async function fetchCategories(id) {
    const key = 'cryptofolio.cache.cats.' + id;
    const fresh = readTimed(key, CATS_TTL);
    if (fresh) return fresh;
    try {
      const data = await enqueue(() => getJSON(BASE + '/coins/' + encodeURIComponent(id)
        + '?localization=false&tickers=false&market_data=false'
        + '&community_data=false&developer_data=false&sparkline=false'));
      const cats = (data.categories || []).filter(Boolean);
      writeCache(key, cats);
      return cats;
    } catch (e) {
      const stale = readCache(key);
      if (stale) return stale.data;
      throw e;
    }
  }

  return { fetchAll, fromCacheResult, fetchMarketChart, fetchCategories };
})();
