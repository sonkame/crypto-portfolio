/* Market view: global stats bar, sortable/searchable top-100 table, SVG sparklines. */
const Market = (() => {
  const PCT_KEYS = {
    p1h: 'price_change_percentage_1h_in_currency',
    p24h: 'price_change_percentage_24h_in_currency',
    p7d: 'price_change_percentage_7d_in_currency',
  };
  let sortKey = 'market_cap_rank';
  let sortDir = 1;
  let query = '';

  function sortValue(coin, key) {
    if (PCT_KEYS[key]) return coin[PCT_KEYS[key]];
    if (key === 'name') return (coin.name || '').toLowerCase();
    return coin[key];
  }

  function sorted(list) {
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
      return (va - vb) * sortDir;
    });
  }

  function sparklineSVG(coin) {
    const prices = coin.sparkline_in_7d && coin.sparkline_in_7d.price;
    if (!prices || prices.length < 2) return '';
    const pts = [];
    const step = Math.max(1, Math.floor(prices.length / 40));
    for (let i = 0; i < prices.length; i += step) pts.push(prices[i]);
    pts.push(prices[prices.length - 1]);
    const W = 120, H = 36, pad = 2;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const coords = pts.map((p, i) =>
      ((i / (pts.length - 1)) * W).toFixed(1) + ',' +
      (H - pad - ((p - min) / span) * (H - pad * 2)).toFixed(1)
    ).join(' ');
    const up = (coin.price_change_percentage_7d_in_currency ?? 0) >= 0;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="spark ' + (up ? 'up' : 'down')
      + '" preserveAspectRatio="none"><polyline points="' + coords + '"/></svg>';
  }

  function pctCell(v, extraClass) {
    const cls = v == null ? '' : (v >= 0 ? 'up' : 'down');
    return '<td class="num ' + cls + (extraClass ? ' ' + extraClass : '') + '">' + fmtPct(v) + '</td>';
  }

  function rowHTML(c) {
    return '<tr data-id="' + esc(c.id) + '">'
      + '<td class="num muted">' + (c.market_cap_rank ?? '—') + '</td>'
      + '<td><div class="coin-cell"><img src="' + esc(c.image) + '" alt="" loading="lazy" width="24" height="24">'
      + '<span class="coin-name">' + esc(c.name) + '</span>'
      + '<span class="coin-sym">' + esc((c.symbol || '').toUpperCase()) + '</span></div></td>'
      + '<td class="num">' + fmtUSD(c.current_price) + '</td>'
      + pctCell(c.price_change_percentage_1h_in_currency, 'col-1h')
      + pctCell(c.price_change_percentage_24h_in_currency)
      + pctCell(c.price_change_percentage_7d_in_currency, 'col-7d')
      + '<td class="num col-mcap">' + fmtCompact(c.market_cap) + '</td>'
      + '<td class="num col-vol">' + fmtCompact(c.total_volume) + '</td>'
      + '<td class="col-spark">' + sparklineSVG(c) + '</td>'
      + '</tr>';
  }

  function renderStats() {
    const g = state.global;
    if (!g) return;
    document.getElementById('gs-mcap').textContent = fmtCompact(g.total_market_cap && g.total_market_cap.usd);
    document.getElementById('gs-volume').textContent = fmtCompact(g.total_volume && g.total_volume.usd);
    const btc = g.market_cap_percentage && g.market_cap_percentage.btc;
    document.getElementById('gs-btc').textContent = btc != null ? btc.toFixed(1) + '%' : '—';
    const chg = g.market_cap_change_percentage_24h_usd;
    const chgEl = document.getElementById('gs-change');
    chgEl.textContent = fmtPct(chg);
    chgEl.className = 'stat-value ' + (chg == null ? '' : chg >= 0 ? 'up' : 'down');
  }

  function render() {
    if (!state.markets || !state.markets.length) return;
    renderStats();
    const body = document.getElementById('market-body');
    let list = state.markets;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q));
    }
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="9" class="loading-cell">No coins match your search.</td></tr>';
      return;
    }
    body.innerHTML = sorted(list).map(rowHTML).join('');
  }

  function onHeaderClick(th) {
    const key = th.dataset.key;
    if (!key) return;
    if (key === sortKey) {
      sortDir = -sortDir;
    } else {
      sortKey = key;
      sortDir = (key === 'name' || key === 'market_cap_rank') ? 1 : -1;
    }
    document.querySelectorAll('#market-table th').forEach(h =>
      h.classList.remove('sorted-asc', 'sorted-desc'));
    th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    render();
  }

  function init() {
    document.querySelector('#market-table thead').addEventListener('click', e => {
      const th = e.target.closest('th.sortable');
      if (th) onHeaderClick(th);
    });
    document.getElementById('market-search').addEventListener('input', e => {
      query = e.target.value.trim();
      render();
    });
    document.getElementById('market-body').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const coin = state.markets.find(c => c.id === tr.dataset.id);
      if (coin) showCoinModal(coin);
    });
  }

  return { init, render };
})();
