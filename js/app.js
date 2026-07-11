/* App shell: shared state + formatters, view switching, refresh loop, coin side panel. */
const state = { markets: [], global: null, updatedAt: 0, stale: false };

const VIEWS = ['market', 'portfolio', 'bubbles'];
const REFRESH_MS = 60 * 1000;

/* ----- shared formatters ----- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

function fmtCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return sign + '$' + (abs / 1e9).toFixed(2)  + 'B';
  if (abs >= 1e6)  return sign + '$' + (abs / 1e6).toFixed(2)  + 'M';
  if (abs >= 1e3)  return sign + '$' + (abs / 1e3).toFixed(2)  + 'K';
  return sign + '$' + abs.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

/* ----- coin detail side panel ----- */

const CoinPanel = (() => {
  const CHART_BASE = 'https://api.coingecko.com/api/v3/coins';
  let activeCoin = null;
  let chartCache = {};

  /* ---- chart data ---- */

  async function fetchChart(id, days) {
    const key = id + '_' + days;
    if (chartCache[key] && Date.now() - chartCache[key].t < 5 * 60 * 1000)
      return chartCache[key].data;
    const res = await fetch(CHART_BASE + '/' + encodeURIComponent(id)
      + '/market_chart?vs_currency=usd&days=' + days);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    chartCache[key] = { t: Date.now(), data };
    return data;
  }

  function downsample(arr, max) {
    if (arr.length <= max) return arr;
    const step = Math.ceil(arr.length / max);
    const out = [];
    for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
    if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
    return out;
  }

  /* ---- chart drawing ---- */

  function drawChart(prices) {
    const canvas = document.getElementById('cp-chart');
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    if (!W || !H || !prices || prices.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const pts = downsample(prices, 200);
    const vals = pts.map(p => p[1]);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const range = maxV - minV || minV * 0.001 || 1;
    const pTop = 20, pBot = 20, pRight = 64;
    const cH = H - pTop - pBot, cW = W - pRight;

    const px = i => (i / (pts.length - 1)) * cW;
    const py = v => pTop + cH - ((v - minV) / range) * cH;

    const refV = vals[0];
    const refY = py(refV);
    const up = vals[vals.length - 1] >= refV;

    const buildArea = () => {
      ctx.beginPath();
      ctx.moveTo(px(0), py(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(px(i), py(vals[i]));
      ctx.lineTo(px(vals.length - 1), H);
      ctx.lineTo(0, H);
      ctx.closePath();
    };

    // Green fill (above open price reference)
    if (refY > pTop) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, refY); ctx.clip();
      buildArea();
      const gG = ctx.createLinearGradient(0, pTop, 0, refY);
      gG.addColorStop(0, 'rgba(22,199,132,0.38)');
      gG.addColorStop(1, 'rgba(22,199,132,0.04)');
      ctx.fillStyle = gG; ctx.fill();
      ctx.restore();
    }

    // Red fill (below open price reference)
    if (refY < H - pBot) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, refY, W, H - refY); ctx.clip();
      buildArea();
      const gR = ctx.createLinearGradient(0, refY, 0, H - pBot);
      gR.addColorStop(0, 'rgba(234,57,67,0.04)');
      gR.addColorStop(1, 'rgba(234,57,67,0.38)');
      ctx.fillStyle = gR; ctx.fill();
      ctx.restore();
    }

    // Dashed reference line at open price
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(0, refY); ctx.lineTo(cW, refY);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // Price line
    ctx.beginPath();
    ctx.moveTo(px(0), py(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(px(i), py(vals[i]));
    ctx.strokeStyle = up ? '#16c784' : '#ea3943';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Endpoint dot
    const ex = px(vals.length - 1), ey = py(vals[vals.length - 1]);
    ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = up ? '#16c784' : '#ea3943'; ctx.fill();

    // Y-axis: high and low labels
    const maxIdx = vals.indexOf(maxV), minIdx = vals.indexOf(minV);
    ctx.fillStyle = '#8b93a7';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const highY = py(maxV), lowY = py(minV);
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtUSD(maxV), cW + 6, Math.max(pTop + 6, Math.min(H - pBot - 6, highY)));
    ctx.fillText(fmtUSD(minV), cW + 6, Math.max(pTop + 6, Math.min(H - pBot - 6, lowY)));
  }

  async function loadChart(days, points) {
    const loadEl = document.getElementById('cp-chart-loading');
    loadEl.textContent = 'Loading chart…';
    loadEl.classList.remove('done');
    try {
      const data = await fetchChart(activeCoin.id, days);
      let prices = data.prices || [];
      if (points) prices = prices.slice(-points);

      if (prices.length >= 2) {
        const first = prices[0][1], last = prices[prices.length - 1][1];
        const pct = ((last - first) / first) * 100;
        const el = document.getElementById('cp-chart-change');
        el.textContent = fmtPct(pct);
        el.className = 'cp-chart-change ' + (pct >= 0 ? 'up' : 'down');
      }

      loadEl.classList.add('done');
      drawChart(prices);
    } catch (e) {
      loadEl.textContent = 'Chart unavailable';
      console.warn('Panel chart fetch failed:', e.message);
    }
  }

  /* ---- open / close ---- */

  function open(coin) {
    activeCoin = coin;

    document.getElementById('cp-logo').src = coin.image || '';
    document.getElementById('cp-name').textContent = coin.name;
    document.getElementById('cp-sym').textContent = (coin.symbol || '').toUpperCase();
    document.getElementById('cp-rank').textContent = 'Rank #' + (coin.market_cap_rank ?? '—');
    document.getElementById('cp-price').textContent = fmtUSD(coin.current_price);

    const p24 = coin.price_change_percentage_24h_in_currency;
    const chEl = document.getElementById('cp-24h');
    chEl.textContent = fmtPct(p24) + ' (24h)';
    chEl.className = 'sp-chg ' + ((p24 ?? 0) >= 0 ? 'up' : 'down');

    // Converter
    const sym = (coin.symbol || '').toUpperCase();
    document.getElementById('cp-conv-sym').textContent = sym;
    document.getElementById('cp-conv-coin').value = 1;
    document.getElementById('cp-conv-usd').value =
      coin.current_price != null ? parseFloat(coin.current_price.toPrecision(8)) : '';

    // Stats rows
    const pctSpan = v =>
      '<span class="' + ((v ?? 0) >= 0 ? 'up' : 'down') + '">' + fmtPct(v) + '</span>';
    const dom = state.global?.market_cap_percentage?.[coin.symbol.toLowerCase()];
    const rows = [
      ['Rank',         '#' + (coin.market_cap_rank ?? '—')],
      ['Market Cap',   fmtCompact(coin.market_cap)],
      ['Volume (24h)', fmtCompact(coin.total_volume)],
      ['1h Change',    pctSpan(coin.price_change_percentage_1h_in_currency)],
      ['7d Change',    pctSpan(coin.price_change_percentage_7d_in_currency)],
      ['24h High',     fmtUSD(coin.high_24h)],
      ['24h Low',      fmtUSD(coin.low_24h)],
      ['All-Time High', fmtUSD(coin.ath)],
      ['From ATH',     pctSpan(coin.ath_change_percentage)],
      ...(dom != null ? [['Dominance', dom.toFixed(2) + '%']] : []),
    ];
    document.getElementById('cp-stats').innerHTML = rows.map(([l, v]) =>
      '<div class="sp-stat-row"><span class="sp-stat-label">' + esc(l) + '</span>'
      + '<span class="sp-stat-val">' + v + '</span></div>'
    ).join('');

    // Reset timeframe to 1D default
    document.querySelectorAll('#panel-tf-tabs button').forEach(b => b.classList.remove('active'));
    document.querySelector('#panel-tf-tabs button[data-default]').classList.add('active');
    document.getElementById('cp-chart-change').textContent = '';

    // Open with animation
    document.getElementById('coin-panel').classList.add('open');
    document.getElementById('panel-backdrop').classList.add('open');
    document.body.style.overflow = 'hidden';

    loadChart(1, null); // 1D default
  }

  function close() {
    document.getElementById('coin-panel').classList.remove('open');
    document.getElementById('panel-backdrop').classList.remove('open');
    document.body.style.overflow = '';
  }

  function init() {
    document.getElementById('panel-close').addEventListener('click', close);
    document.getElementById('panel-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.getElementById('panel-tf-tabs').addEventListener('click', e => {
      const btn = e.target.closest('button[data-days]');
      if (!btn || !activeCoin) return;
      document.querySelectorAll('#panel-tf-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const days = parseFloat(btn.dataset.days);
      const pts  = btn.dataset.points ? parseInt(btn.dataset.points) : null;
      loadChart(days, pts);
    });

    const coinIn = document.getElementById('cp-conv-coin');
    const usdIn  = document.getElementById('cp-conv-usd');
    coinIn.addEventListener('input', () => {
      if (!activeCoin?.current_price) return;
      const v = parseFloat(coinIn.value);
      usdIn.value = isNaN(v) ? '' : (v * activeCoin.current_price).toFixed(2);
    });
    usdIn.addEventListener('input', () => {
      if (!activeCoin?.current_price) return;
      const v = parseFloat(usdIn.value);
      coinIn.value = isNaN(v) ? '' : (v / activeCoin.current_price).toFixed(8);
    });
  }

  return { init, open, close };
})();

/* Global wrapper so market.js and bubbles.js keep working unchanged */
function showCoinModal(coin) { CoinPanel.open(coin); }

/* ----- views ----- */

function switchView(name) {
  if (!VIEWS.includes(name)) name = 'market';
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name));
  if (name === 'bubbles') Bubbles.start();
  else Bubbles.stop();
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}

/* ----- data refresh ----- */

function updateStatus() {
  const el = document.getElementById('status');
  if (!state.updatedAt) { el.textContent = ''; return; }
  const time = new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.textContent = (state.stale ? '⚠ stale · ' : '') + 'Updated ' + time;
  el.classList.toggle('stale', state.stale);
}

function renderAll() {
  Market.render();
  Portfolio.render();
  Bubbles.update(state.markets);
}

function applyResult(r) {
  state.markets = r.markets || [];
  state.global = r.global;
  state.updatedAt = r.updatedAt;
  state.stale = r.fromCache;
  updateStatus();
  renderAll();
}

async function refresh() {
  const r = await API.fetchAll();
  const banner = document.getElementById('banner');
  if (!r) {
    banner.textContent = 'Could not load market data from CoinGecko — will keep retrying automatically.';
    banner.classList.remove('hidden');
    return;
  }
  banner.classList.add('hidden');
  applyResult(r);
}

/* ----- init ----- */

document.addEventListener('DOMContentLoaded', () => {
  Market.init();
  Portfolio.init();
  Analytics.init();
  Bubbles.init();
  CoinPanel.init();

  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchView(t.dataset.view)));
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));

  switchView(location.hash.slice(1) || 'market');

  const cached = API.fromCacheResult();
  if (cached) applyResult(cached);
  refresh();

  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.updatedAt > REFRESH_MS) refresh();
  });
});
