/* Analytics tab: portfolio performance & P/L charts (from CoinGecko market_chart),
   coins allocation donut and value-weighted category allocation. */
const Analytics = (() => {
  const TIMEFRAMES = [
    { label: '24H', days: 1 },
    { label: '7D', days: 7 },
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '1Y', days: 365 },
  ];
  const GRID_POINTS = 180;
  const PALETTE = ['#f3a712', '#4f8cff', '#16c784', '#ea3943', '#9b5de5',
    '#00bbf9', '#f15bb5', '#fee440', '#38b000', '#ff7b00'];

  let holdings = [];
  let portfolioId = null;
  let visible = false;
  let perfDays = 1;
  let pnlDays = 30;
  const tokens = { perf: 0, pnl: 0, cats: 0 }; // cancel stale async renders per widget
  const seriesCache = {}; // key -> { t, grid, values, cost }

  /* ----- data pipeline ----- */

  function holdingsKey() {
    return portfolioId + '|' + holdings.map(h => h.coinId + ':' + h.amount + ':' + h.buyPrice).join(',');
  }

  /* Linear-interpolate [[ms, price], ...] onto a uniform time grid. */
  function resample(prices, grid) {
    const out = new Array(grid.length);
    let j = 0;
    for (let i = 0; i < grid.length; i++) {
      const t = grid[i];
      if (t <= prices[0][0]) { out[i] = prices[0][1]; continue; }
      if (t >= prices[prices.length - 1][0]) { out[i] = prices[prices.length - 1][1]; continue; }
      while (j < prices.length - 1 && prices[j + 1][0] < t) j++;
      const t0 = prices[j][0], v0 = prices[j][1];
      const t1 = prices[j + 1][0], v1 = prices[j + 1][1];
      out[i] = t1 === t0 ? v0 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
    }
    return out;
  }

  /* Total portfolio value over `days`: Σ amount × price(t), summed on a shared grid. */
  async function buildSeries(days) {
    const key = holdingsKey() + '|' + days;
    const cached = seriesCache[key];
    if (cached && Date.now() - cached.t < 5 * 60 * 1000) return cached;

    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;
    const grid = [];
    for (let i = 0; i < GRID_POINTS; i++) {
      grid.push(start + (i / (GRID_POINTS - 1)) * (now - start));
    }
    const values = new Array(GRID_POINTS).fill(0);
    let cost = 0;

    for (const h of holdings) {
      const prices = await API.fetchMarketChart(h.coinId, days); // paced by the API queue
      if (!prices || prices.length < 2) continue;
      const sampled = resample(prices, grid);
      for (let i = 0; i < GRID_POINTS; i++) values[i] += h.amount * sampled[i];
      cost += h.amount * h.buyPrice;
    }

    const result = { t: Date.now(), grid, values, cost };
    seriesCache[key] = result;
    return result;
  }

  /* ----- chart drawing ----- */

  function fmtTimeLabel(ms, days) {
    const d = new Date(ms);
    if (days <= 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days <= 90) return d.getDate() + '. ' + d.toLocaleDateString([], { month: 'short' });
    return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
  }

  function drawLineChart(canvas, grid, values, days, fmtY) {
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    if (!W || !H || values.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const minV = Math.min(...values), maxV = Math.max(...values);
    const range = maxV - minV || Math.abs(minV) * 0.01 || 1;
    const pTop = 12, pBot = 22, pRight = 56;
    const cH = H - pTop - pBot, cW = W - pRight;
    const px = i => (i / (values.length - 1)) * cW;
    const py = v => pTop + cH - ((v - minV) / range) * cH;

    const up = values[values.length - 1] >= values[0];
    const line = up ? '#16c784' : '#ea3943';

    // horizontal gridlines + y labels
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i) / 4;
      const y = py(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cW, y); ctx.stroke();
      ctx.fillStyle = '#8b93a7';
      ctx.textAlign = 'left';
      ctx.fillText(fmtY(v), cW + 6, y);
    }

    // x labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i <= 4; i++) {
      const idx = Math.round((values.length - 1) * i / 4);
      const x = Math.min(Math.max(px(idx), 20), cW - 20);
      ctx.fillText(fmtTimeLabel(grid[idx], days), x, H - 6);
    }

    // area fill
    ctx.beginPath();
    ctx.moveTo(px(0), py(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(px(i), py(values[i]));
    ctx.lineTo(px(values.length - 1), pTop + cH);
    ctx.lineTo(0, pTop + cH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, pTop, 0, pTop + cH);
    g.addColorStop(0, up ? 'rgba(22,199,132,0.35)' : 'rgba(234,57,67,0.35)');
    g.addColorStop(1, up ? 'rgba(22,199,132,0.02)' : 'rgba(234,57,67,0.02)');
    ctx.fillStyle = g;
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(px(0), py(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(px(i), py(values[i]));
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  async function renderChart(kind, days) {
    const token = ++tokens[kind];
    const canvas = document.getElementById(kind === 'perf' ? 'an-perf-chart' : 'an-pnl-chart');
    const loading = document.getElementById(kind === 'perf' ? 'an-perf-loading' : 'an-pnl-loading');
    loading.textContent = 'Loading…';
    loading.classList.remove('hidden');
    try {
      const s = await buildSeries(days);
      if (token !== tokens[kind]) return; // superseded by a newer render
      loading.classList.add('hidden');
      if (kind === 'perf') {
        drawLineChart(canvas, s.grid, s.values, days, fmtCompact);
      } else {
        if (!(s.cost > 0)) { loading.textContent = 'No cost basis yet.'; loading.classList.remove('hidden'); return; }
        const pnl = s.values.map(v => ((v - s.cost) / s.cost) * 100);
        drawLineChart(canvas, s.grid, pnl, days, v => v.toFixed(1) + '%');
      }
    } catch (e) {
      if (token !== tokens[kind]) return;
      loading.textContent = 'Couldn’t load chart data — CoinGecko may be rate limiting. It will retry when you switch timeframes or reopen this tab.';
      console.warn('Analytics chart failed:', e.message);
    }
  }

  /* ----- coins allocation donut ----- */

  function renderDonut(entries, total) {
    const sorted = [...entries].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    if (rest.length) top.push({ label: 'Others', value: rest.reduce((s, e) => s + e.value, 0) });

    const canvas = document.getElementById('an-donut');
    const size = 240;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2, rOuter = 108, rInner = 70;
    let a = -Math.PI / 2;
    top.forEach((e, i) => {
      const a2 = a + (e.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, a, a2);
      ctx.arc(cx, cy, rInner, a2, a, true);
      ctx.closePath();
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fill();
      a = a2;
    });
    ctx.fillStyle = '#e6e9f0';
    ctx.font = '700 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtCompact(total), cx, cy - 9);
    ctx.fillStyle = '#8b93a7';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Total value', cx, cy + 13);

    document.getElementById('an-donut-legend').innerHTML = top.map((e, i) =>
      '<li><span class="dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>'
      + esc(e.label)
      + '<span class="pct">' + ((e.value / total) * 100).toFixed(1) + '%</span></li>'
    ).join('');
  }

  /* ----- category allocation ----- */

  async function renderCategories(entries, total) {
    const token = ++tokens.cats;
    const bar = document.getElementById('an-cat-bar');
    const legend = document.getElementById('an-cat-legend');
    const note = document.getElementById('an-cat-note');
    note.textContent = 'Loading categories…';

    const catValue = {};
    try {
      for (const e of entries) {
        const cats = await API.fetchCategories(e.coinId); // cached a week per coin
        if (token !== tokens.cats) return;
        for (const cat of cats) catValue[cat] = (catValue[cat] || 0) + e.value;
      }
    } catch (err) {
      if (token !== tokens.cats) return;
      note.textContent = 'Couldn’t load categories (rate limit?) — they’ll load next time you open this tab.';
      return;
    }

    const cats = Object.entries(catValue)
      .map(([label, value]) => ({ label, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    if (!cats.length) { note.textContent = 'No category data.'; return; }

    const sum = cats.reduce((s, c) => s + c.value, 0);
    bar.innerHTML = cats.map((c, i) =>
      '<span style="width:' + ((c.value / sum) * 100).toFixed(2) + '%;background:'
      + PALETTE[i % PALETTE.length] + '" title="' + esc(c.label) + '"></span>'
    ).join('');
    legend.innerHTML = cats.map((c, i) =>
      '<li><span class="dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>'
      + esc(c.label)
      + '<span class="pct">' + c.pct.toFixed(2) + '%</span></li>'
    ).join('');
    note.textContent = 'Coins can belong to several categories, so percentages may exceed 100% combined.';
  }

  /* ----- orchestration ----- */

  function refresh() {
    if (!visible) return;

    const empty = document.getElementById('an-empty');
    const grid = document.getElementById('an-grid');
    const entries = [];
    let total = 0;
    for (const h of holdings) {
      const c = (state.markets || []).find(x => x.id === h.coinId);
      if (!c || c.current_price == null) continue;
      const value = h.amount * c.current_price;
      total += value;
      entries.push({ coinId: h.coinId, label: c.name, value });
    }

    if (!holdings.length || !entries.length || total <= 0) {
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.classList.remove('hidden');

    renderDonut(entries, total);
    renderChart('perf', perfDays);
    renderChart('pnl', pnlDays);
    renderCategories(entries, total);
  }

  /* Called by Portfolio whenever holdings/active portfolio change or the tab is shown.
     Charts only refetch when the portfolio actually changed (series are cached). */
  function notify(newHoldings, newPortfolioId, isVisible) {
    const changed = newPortfolioId !== portfolioId
      || JSON.stringify(newHoldings) !== JSON.stringify(holdings);
    holdings = newHoldings.map(h => ({ ...h }));
    portfolioId = newPortfolioId;
    const becameVisible = isVisible && !visible;
    visible = isVisible;
    if (visible && (changed || becameVisible)) refresh();
  }

  function tfButtons(el, current, onPick) {
    el.innerHTML = TIMEFRAMES.map(tf =>
      '<button data-days="' + tf.days + '"' + (tf.days === current ? ' class="active"' : '') + '>'
      + tf.label + '</button>').join('');
    el.addEventListener('click', e => {
      const btn = e.target.closest('button[data-days]');
      if (!btn) return;
      el.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(parseInt(btn.dataset.days, 10));
    });
  }

  function init() {
    tfButtons(document.getElementById('an-perf-tf'), perfDays, days => {
      perfDays = days;
      renderChart('perf', days);
    });
    tfButtons(document.getElementById('an-pnl-tf'), pnlDays, days => {
      pnlDays = days;
      renderChart('pnl', days);
    });
  }

  return { init, notify };
})();
