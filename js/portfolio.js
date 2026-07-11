/* Portfolio view: multiple portfolios persisted in localStorage (CoinGecko-style),
   summary cards, Coins/Analytics sub-tabs, add/edit/remove modals, New Portfolio flow. */
const Portfolio = (() => {
  const KEY = 'cryptofolio.portfolios.v1';
  const LEGACY_KEY = 'cryptofolio.holdings.v1';
  const OVERVIEW_ID = '__overview';
  const ICONS = ['⭐', '🚀', '💎', '🐸', '🦄', '🔥', '🌙', '🐳'];

  let store = load(); // { activeId, portfolios: [{ id, name, icon, holdings: [{coinId, amount, buyPrice}] }] }
  let selectedCoin = null;
  let editingId = null;     // coinId being edited in the tx modal (null = adding)
  let subTab = 'coins';
  let rowMenuCoin = null;
  let npMode = 'create';    // 'create' | 'rename' for the portfolio modal
  let npIcon = ICONS[0];

  /* ----- storage ----- */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.portfolios) && s.portfolios.length) return s;
      }
    } catch {}
    // first run: migrate the old single-portfolio key if present
    let legacy = [];
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) legacy = list;
    } catch {}
    return {
      activeId: 'default',
      portfolios: [{ id: 'default', name: 'My Portfolio', icon: '⭐', holdings: legacy }],
    };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {}
  }

  function isOverview() { return store.activeId === OVERVIEW_ID; }

  function activePortfolio() {
    return store.portfolios.find(p => p.id === store.activeId) || null;
  }

  /* Holdings of the active portfolio, or all portfolios merged for Overview. */
  function currentHoldings() {
    if (!isOverview()) {
      const p = activePortfolio();
      return p ? p.holdings : [];
    }
    const map = new Map();
    for (const p of store.portfolios) {
      for (const h of p.holdings) {
        const m = map.get(h.coinId);
        if (m) {
          const cost = m.amount * m.buyPrice + h.amount * h.buyPrice;
          m.amount += h.amount;
          m.buyPrice = m.amount > 0 ? cost / m.amount : 0;
        } else {
          map.set(h.coinId, { coinId: h.coinId, amount: h.amount, buyPrice: h.buyPrice });
        }
      }
    }
    return [...map.values()];
  }

  function coinById(id) {
    return (state.markets || []).find(c => c.id === id) || null;
  }

  /* ----- modal helpers ----- */

  function openModal(id) {
    closeModals();
    document.getElementById(id).classList.add('open');
    document.getElementById('modal-backdrop').classList.add('open');
  }

  function closeModals() {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('modal-backdrop').classList.remove('open');
    hideRowMenu();
  }

  /* ----- coin picker (combo box over the loaded top-100 list) ----- */

  function renderComboList() {
    const input = document.getElementById('pf-coin');
    const list = document.getElementById('pf-coin-list');
    const q = input.value.trim().toLowerCase();
    const coins = (state.markets || []).filter(c =>
      !q || (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q)
    ).slice(0, 8);
    if (!state.markets || !state.markets.length) {
      list.innerHTML = '<div class="combo-empty">Market data still loading…</div>';
    } else if (!coins.length) {
      list.innerHTML = '<div class="combo-empty">No match in the top 100 coins.</div>';
    } else {
      list.innerHTML = coins.map(c =>
        '<button type="button" class="combo-opt" data-id="' + esc(c.id) + '">'
        + '<img src="' + esc(c.image) + '" alt="">'
        + '<span>' + esc(c.name) + '</span>'
        + '<span class="sym">' + esc((c.symbol || '').toUpperCase()) + '</span></button>'
      ).join('');
    }
    list.classList.remove('hidden');
  }

  function closeComboList() {
    document.getElementById('pf-coin-list').classList.add('hidden');
  }

  function selectCoin(id) {
    const c = coinById(id);
    selectedCoin = id;
    document.getElementById('pf-coin').value = c ? c.name + ' (' + c.symbol.toUpperCase() + ')' : id;
    closeComboList();
  }

  /* ----- add / edit transaction modal ----- */

  function openTxModal(coinId, edit) {
    const p = activePortfolio();
    if (!p) return;
    selectedCoin = null;
    editingId = null;
    const coinInput = document.getElementById('pf-coin');
    coinInput.disabled = false;
    coinInput.value = '';
    document.getElementById('pf-amount').value = '';
    document.getElementById('pf-buyprice').value = '';
    document.getElementById('tx-title').textContent = edit ? 'Edit Holding' : 'Add Coin';
    document.getElementById('pf-submit').textContent = edit ? 'Update' : 'Add';

    if (coinId) {
      selectCoin(coinId);
      coinInput.disabled = true;
      if (edit) {
        editingId = coinId;
        const h = p.holdings.find(x => x.coinId === coinId);
        if (h) {
          document.getElementById('pf-amount').value = h.amount;
          document.getElementById('pf-buyprice').value = h.buyPrice;
        }
      }
    }
    openModal('tx-modal');
    (coinId ? document.getElementById('pf-amount') : coinInput).focus();
  }

  function onSubmit(e) {
    e.preventDefault();
    const p = activePortfolio();
    if (!p) return;
    const amount = parseFloat(document.getElementById('pf-amount').value);
    const buyPrice = parseFloat(document.getElementById('pf-buyprice').value);
    if (!selectedCoin || !(amount > 0) || !(buyPrice >= 0)) return;

    if (editingId) {
      const h = p.holdings.find(x => x.coinId === editingId);
      if (h) { h.amount = amount; h.buyPrice = buyPrice; }
    } else {
      const existing = p.holdings.find(x => x.coinId === selectedCoin);
      if (existing) {
        // merging a repeat buy: weighted-average the cost basis
        const total = existing.amount + amount;
        existing.buyPrice = (existing.amount * existing.buyPrice + amount * buyPrice) / total;
        existing.amount = total;
      } else {
        p.holdings.push({ coinId: selectedCoin, amount, buyPrice });
      }
    }
    save();
    closeModals();
    render();
  }

  /* ----- remove coin modal ----- */

  function openRemoveModal() {
    const p = activePortfolio();
    if (!p || !p.holdings.length) return;
    renderRemoveList();
    openModal('rm-modal');
  }

  function renderRemoveList() {
    const p = activePortfolio();
    const list = document.getElementById('rm-list');
    if (!p || !p.holdings.length) { closeModals(); return; }
    list.innerHTML = p.holdings.map(h => {
      const c = coinById(h.coinId);
      return '<div class="rm-row">'
        + (c ? '<img src="' + esc(c.image) + '" alt="" width="24" height="24">' : '')
        + '<span class="coin-name">' + esc(c ? c.name : h.coinId) + '</span>'
        + '<span class="coin-sym">' + h.amount.toLocaleString('en-US', { maximumFractionDigits: 8 })
        + ' ' + esc(c ? c.symbol.toUpperCase() : '') + '</span>'
        + '<button class="btn small danger" data-id="' + esc(h.coinId) + '">Remove</button>'
        + '</div>';
    }).join('');
  }

  function removeCoin(id) {
    const p = activePortfolio();
    if (!p) return;
    p.holdings = p.holdings.filter(h => h.coinId !== id);
    save();
    render();
  }

  /* ----- new / rename portfolio modal ----- */

  function openNewPortfolio() {
    npMode = 'create';
    npIcon = ICONS[0];
    document.getElementById('np-icon').textContent = npIcon;
    document.getElementById('np-name').value = '';
    document.getElementById('np-step2-title').textContent = 'New Portfolio';
    document.getElementById('np-create').textContent = 'Create';
    document.getElementById('np-step1').classList.remove('hidden');
    document.getElementById('np-step2').classList.add('hidden');
    openModal('np-modal');
  }

  function openRenamePortfolio() {
    const p = activePortfolio();
    if (!p) return;
    npMode = 'rename';
    npIcon = p.icon || ICONS[0];
    document.getElementById('np-icon').textContent = npIcon;
    document.getElementById('np-name').value = p.name;
    document.getElementById('np-step2-title').textContent = 'Edit Portfolio';
    document.getElementById('np-create').textContent = 'Save';
    document.getElementById('np-step1').classList.add('hidden');
    document.getElementById('np-step2').classList.remove('hidden');
    openModal('np-modal');
    document.getElementById('np-name').focus();
  }

  function submitPortfolioModal() {
    const name = document.getElementById('np-name').value.trim() || 'My Portfolio';
    if (npMode === 'rename') {
      const p = activePortfolio();
      if (p) { p.name = name; p.icon = npIcon; }
    } else {
      const id = 'p_' + Date.now().toString(36);
      store.portfolios.push({ id, name, icon: npIcon, holdings: [] });
      store.activeId = id;
    }
    save();
    closeModals();
    render();
  }

  function deletePortfolio() {
    const p = activePortfolio();
    if (!p || p.id === 'default') return;
    if (!confirm('Delete portfolio "' + p.name + '" and its holdings?')) return;
    store.portfolios = store.portfolios.filter(x => x.id !== p.id);
    store.activeId = 'default';
    save();
    render();
  }

  /* ----- per-row actions menu ----- */

  function showRowMenu(btn, coinId) {
    rowMenuCoin = coinId;
    const menu = document.getElementById('row-menu');
    menu.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
  }

  function hideRowMenu() {
    document.getElementById('row-menu').classList.add('hidden');
    rowMenuCoin = null;
  }

  /* ----- rendering ----- */

  function signedCls(v) { return v == null ? '' : v >= 0 ? 'up' : 'down'; }
  function signedUSD(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + fmtCompactPrecise(v); }
  function fmtCompactPrecise(v) {
    return Math.abs(v) >= 1e5 ? fmtCompact(v)
      : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pctSpan(v) {
    return '<span class="' + signedCls(v) + '">' + fmtPct(v) + '</span>';
  }

  function sparklineSVG(coin) {
    const prices = coin && coin.sparkline_in_7d && coin.sparkline_in_7d.price;
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

  function rowHTML(h) {
    const c = coinById(h.coinId);
    const price = c ? c.current_price : null;
    const value = price != null ? h.amount * price : null;
    const cost = h.amount * h.buyPrice;
    const pl = value != null ? value - cost : null;
    const plPct = pl != null && cost > 0 ? (pl / cost) * 100 : null;
    const sym = c ? c.symbol.toUpperCase() : '';
    const actions = isOverview() ? ''
      : '<button class="btn small" data-act="add" data-id="' + esc(h.coinId) + '" title="Add to holding">＋</button> '
      + '<button class="btn small" data-act="menu" data-id="' + esc(h.coinId) + '" title="More">⋮</button>';
    return '<tr data-id="' + esc(h.coinId) + '">'
      + '<td class="num muted">' + (c ? (c.market_cap_rank ?? '—') : '—') + '</td>'
      + '<td><div class="coin-cell">'
      + (c ? '<img src="' + esc(c.image) + '" alt="" width="24" height="24">' : '')
      + '<span class="coin-name">' + esc(c ? c.name : h.coinId) + '</span>'
      + '<span class="coin-sym">' + esc(sym) + '</span>'
      + (c ? '' : ' <span class="muted">(outside top 100 — no live price)</span>')
      + '</div></td>'
      + '<td class="num">' + fmtUSD(price) + '</td>'
      + '<td class="num col-1h">' + pctSpan(c ? c.price_change_percentage_1h_in_currency : null) + '</td>'
      + '<td class="num">' + pctSpan(c ? c.price_change_percentage_24h_in_currency : null) + '</td>'
      + '<td class="num col-7d">' + pctSpan(c ? c.price_change_percentage_7d_in_currency : null) + '</td>'
      + '<td class="num col-vol">' + fmtCompact(c ? c.total_volume : null) + '</td>'
      + '<td class="num col-mcap">' + fmtCompact(c ? c.market_cap : null) + '</td>'
      + '<td class="col-spark">' + sparklineSVG(c) + '</td>'
      + '<td class="num"><div class="cell-main">' + (value != null ? fmtCompactPrecise(value) : '—') + '</div>'
      + '<div class="cell-sub">' + h.amount.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' ' + esc(sym) + '</div></td>'
      + '<td class="num"><div class="cell-main ' + signedCls(pl) + '">' + signedUSD(pl) + '</div>'
      + '<div class="cell-sub ' + signedCls(plPct) + '">' + fmtPct(plPct) + '</div></td>'
      + '<td class="num actions-cell">' + actions + '</td>'
      + '</tr>';
  }

  function renderTabs() {
    const wrap = document.getElementById('pf-tabs');
    const tabs = ['<button class="pf-tab' + (isOverview() ? ' active' : '') + '" data-pid="' + OVERVIEW_ID + '">Overview</button>'];
    for (const p of store.portfolios) {
      tabs.push('<button class="pf-tab' + (p.id === store.activeId ? ' active' : '') + '" data-pid="' + esc(p.id) + '">'
        + '<span class="pf-tab-icon">' + esc(p.icon || '⭐') + '</span>' + esc(p.name) + '</button>');
    }
    wrap.innerHTML = tabs.join('');
  }

  function renderHead() {
    const p = activePortfolio();
    document.getElementById('pf-title-icon').textContent = isOverview() ? '📊' : (p ? p.icon || '⭐' : '');
    document.getElementById('pf-title-name').textContent = isOverview() ? 'Overview' : (p ? p.name : '');
    document.getElementById('pf-default-badge').classList.toggle('hidden', isOverview() || !p || p.id !== 'default');
    document.getElementById('pf-actions').classList.toggle('hidden', isOverview());
    const delBtn = document.querySelector('#pf-menu button[data-act="delete"]');
    if (delBtn) delBtn.classList.toggle('hidden', !p || p.id === 'default');
  }

  function renderSummary(holdings) {
    let totalValue = 0, totalCost = 0, totalChg24 = 0;
    let top = null;
    for (const h of holdings) {
      const c = coinById(h.coinId);
      if (!c || c.current_price == null) continue;
      const value = h.amount * c.current_price;
      const chg = h.amount * (c.price_change_24h || 0);
      totalValue += value;
      totalCost += h.amount * h.buyPrice;
      totalChg24 += chg;
      if (!top || chg > top.chg) top = { coin: c, chg };
    }

    document.getElementById('pf-total').textContent = fmtCompactPrecise(totalValue);

    const chgEl = document.getElementById('pf-24h');
    const prev = totalValue - totalChg24;
    const chgPct = prev > 0 ? (totalChg24 / prev) * 100 : null;
    chgEl.textContent = holdings.length ? signedUSD(totalChg24) : '—';
    chgEl.className = 'card-value ' + signedCls(totalChg24);
    const chgPctEl = document.getElementById('pf-24h-pct');
    chgPctEl.innerHTML = holdings.length && chgPct != null ? pctSpan(chgPct) : '';

    const plEl = document.getElementById('pf-pl');
    const pl = totalValue - totalCost;
    const plPct = totalCost > 0 ? (pl / totalCost) * 100 : null;
    plEl.textContent = holdings.length ? signedUSD(pl) : '—';
    plEl.className = 'card-value ' + signedCls(pl);
    document.getElementById('pf-pl-pct').innerHTML = holdings.length && plPct != null ? pctSpan(plPct) : '';

    const topEl = document.getElementById('pf-top-coin');
    const topChgEl = document.getElementById('pf-top-chg');
    if (top) {
      topEl.innerHTML = '<img src="' + esc(top.coin.image) + '" alt="" width="22" height="22"> '
        + esc(top.coin.name) + ' <span class="coin-sym">' + esc(top.coin.symbol.toUpperCase()) + '</span>';
      topChgEl.innerHTML = '<span class="' + signedCls(top.chg) + '">' + signedUSD(top.chg) + '</span>';
    } else {
      topEl.textContent = '—';
      topChgEl.textContent = '';
    }
  }

  function render() {
    renderTabs();
    renderHead();
    const holdings = currentHoldings();
    renderSummary(holdings);

    const empty = document.getElementById('pf-empty');
    const table = document.getElementById('pf-table');
    if (!holdings.length) {
      empty.classList.remove('hidden');
      table.classList.add('hidden');
    } else {
      empty.classList.add('hidden');
      table.classList.remove('hidden');
      const sorted = [...holdings].sort((a, b) => {
        const ca = coinById(a.coinId), cb = coinById(b.coinId);
        const va = ca && ca.current_price != null ? a.amount * ca.current_price : -1;
        const vb = cb && cb.current_price != null ? b.amount * cb.current_price : -1;
        return vb - va;
      });
      document.getElementById('pf-body').innerHTML = sorted.map(rowHTML).join('');
    }

    if (typeof Analytics !== 'undefined') {
      Analytics.notify(holdings, store.activeId, subTab === 'analytics');
    }
  }

  function switchSubTab(name) {
    subTab = name;
    document.querySelectorAll('.pf-subtab').forEach(b =>
      b.classList.toggle('active', b.dataset.sub === name));
    document.getElementById('pf-panel-coins').classList.toggle('active', name === 'coins');
    document.getElementById('pf-panel-analytics').classList.toggle('active', name === 'analytics');
    if (name === 'analytics' && typeof Analytics !== 'undefined') {
      Analytics.notify(currentHoldings(), store.activeId, true);
    }
  }

  /* ----- init ----- */

  function init() {
    // portfolio tabs
    document.getElementById('pf-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.pf-tab[data-pid]');
      if (!btn) return;
      store.activeId = btn.dataset.pid;
      save();
      render();
    });
    document.getElementById('pf-new-btn').addEventListener('click', openNewPortfolio);

    // head actions
    document.getElementById('pf-add-btn').addEventListener('click', () => openTxModal(null, false));
    document.getElementById('pf-remove-btn').addEventListener('click', openRemoveModal);
    document.getElementById('pf-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('pf-menu').classList.toggle('hidden');
    });
    document.getElementById('pf-menu').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      document.getElementById('pf-menu').classList.add('hidden');
      if (btn.dataset.act === 'rename') openRenamePortfolio();
      else if (btn.dataset.act === 'delete') deletePortfolio();
    });

    // sub tabs
    document.querySelectorAll('.pf-subtab').forEach(b =>
      b.addEventListener('click', () => switchSubTab(b.dataset.sub)));

    // tx modal form + combo
    const coinInput = document.getElementById('pf-coin');
    coinInput.addEventListener('input', () => { selectedCoin = null; renderComboList(); });
    coinInput.addEventListener('focus', () => { if (!coinInput.disabled) renderComboList(); });
    document.addEventListener('click', e => {
      if (!e.target.closest('.combo')) closeComboList();
      if (!e.target.closest('#pf-menu-btn')) document.getElementById('pf-menu').classList.add('hidden');
      if (!e.target.closest('#row-menu') && !e.target.closest('button[data-act="menu"]')) hideRowMenu();
    });
    document.getElementById('pf-coin-list').addEventListener('click', e => {
      const opt = e.target.closest('.combo-opt');
      if (opt) selectCoin(opt.dataset.id);
    });
    document.getElementById('pf-form').addEventListener('submit', onSubmit);

    // coins table row actions
    document.getElementById('pf-body').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (btn) {
        e.stopPropagation();
        if (btn.dataset.act === 'add') openTxModal(btn.dataset.id, false);
        else if (btn.dataset.act === 'menu') showRowMenu(btn, btn.dataset.id);
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const coin = coinById(tr.dataset.id);
      if (coin) showCoinModal(coin);
    });
    document.getElementById('row-menu').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !rowMenuCoin) return;
      const id = rowMenuCoin;
      hideRowMenu();
      if (btn.dataset.act === 'edit') openTxModal(id, true);
      else if (btn.dataset.act === 'remove') {
        const c = coinById(id);
        if (confirm('Remove ' + (c ? c.name : id) + ' from this portfolio?')) removeCoin(id);
      }
    });

    // remove modal
    document.getElementById('rm-list').addEventListener('click', e => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      removeCoin(btn.dataset.id);
      renderRemoveList();
    });

    // new portfolio modal
    document.getElementById('np-next').addEventListener('click', () => {
      document.getElementById('np-step1').classList.add('hidden');
      document.getElementById('np-step2').classList.remove('hidden');
      document.getElementById('np-name').focus();
    });
    document.getElementById('np-icon').addEventListener('click', () => {
      npIcon = ICONS[(ICONS.indexOf(npIcon) + 1) % ICONS.length];
      document.getElementById('np-icon').textContent = npIcon;
    });
    document.getElementById('np-create').addEventListener('click', submitPortfolioModal);
    document.getElementById('np-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') submitPortfolioModal();
    });

    // shared modal close
    document.getElementById('modal-backdrop').addEventListener('click', closeModals);
    document.querySelectorAll('.modal .modal-close').forEach(b =>
      b.addEventListener('click', closeModals));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

    render();
  }

  function has(coinId) {
    if (isOverview()) return store.portfolios.some(p => p.holdings.some(h => h.coinId === coinId));
    const p = activePortfolio();
    return !!p && p.holdings.some(h => h.coinId === coinId);
  }

  return { init, render, has };
})();
