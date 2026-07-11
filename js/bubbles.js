/* Bubbles view: CryptoBubbles-style physics simulation on canvas.
   Size = market cap, color = % change for the selected timeframe. */
const Bubbles = (() => {
  const TF_KEYS = {
    '1h': 'price_change_percentage_1h_in_currency',
    '24h': 'price_change_percentage_24h_in_currency',
    '7d': 'price_change_percentage_7d_in_currency',
  };

  let canvas, ctx, wrap, tip;
  let bubbles = [];
  let timeframe = '24h';
  let running = false;
  let raf = null;
  let W = 0, H = 0;
  let dragging = null, hovered = null, dragMoved = 0;
  const images = {};

  function resize() {
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const oldW = W, oldH = H;
    W = rect.width;
    H = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (oldW && oldH) {
      for (const b of bubbles) { b.x *= W / oldW; b.y *= H / oldH; }
    }
    assignRadii();
  }

  function assignRadii() {
    if (!bubbles.length || !W) return;
    const maxCap = Math.max(...bubbles.map(b => b.coin.market_cap || 0)) || 1;
    // Relative radius from market cap (sqrt), compressed to 0.45..1.0 so even
    // small coins stay sizeable — CryptoBubbles keeps a fairly tight size range.
    let sumSq = 0;
    for (const b of bubbles) {
      const t = Math.sqrt((b.coin.market_cap || 0) / maxCap);
      b._raw = 0.45 + 0.55 * t;
      sumSq += b._raw * b._raw;
    }
    // Uniformly scale every bubble so their combined area fills a target
    // fraction of the canvas. This makes the pack span the whole frame like
    // CryptoBubbles instead of huddling in a small centre blob.
    const fill = 0.5;
    const scale = Math.sqrt((fill * W * H) / (Math.PI * sumSq));
    for (const b of bubbles) b.r = b._raw * scale;
  }

  function loadImage(coin) {
    if (images[coin.id] || !coin.image) return;
    const img = new Image();
    img.src = coin.image;
    images[coin.id] = img;
  }

  function update(markets) {
    const prev = new Map(bubbles.map(b => [b.coin.id, b]));
    bubbles = (markets || []).map(c => {
      const old = prev.get(c.id);
      if (old) { old.coin = c; return old; }
      return {
        coin: c,
        x: Math.random() * (W || 800),
        y: Math.random() * (H || 500),
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        wander: Math.random() * Math.PI * 2,
        r: 20,
      };
    });
    assignRadii();
    for (const b of bubbles) loadImage(b.coin);
  }

  /* ----- simulation ----- */

  function step() {
    const cx = W / 2, cy = H / 2;
    for (const b of bubbles) {
      if (b === dragging) continue;
      // Smooth wandering drift: each bubble's heading turns slowly (small random
      // step) so it floats along gentle curves instead of jittering. Kept very
      // slow and heavily damped for a calm, gently-floating CryptoBubbles feel.
      b.wander += (Math.random() - 0.5) * 0.09;
      b.vx += Math.cos(b.wander) * 0.014;
      b.vy += Math.sin(b.wander) * 0.014;
      // Barely-there center bias — just enough to stop the whole field slowly
      // drifting off to one side. NOT a clumping force: the spacing gap below
      // spreads the bubbles out evenly so they float apart instead of packing
      // into a solid mass.
      b.vx += (cx - b.x) * 0.00002;
      b.vy += (cy - b.y) * 0.00002;
      b.vx *= 0.92;
      b.vy *= 0.92;
      b.x += b.vx;
      b.y += b.vy;
    }
    // Soft spacing: keep a gap between bubbles so they float apart with breathing
    // room (like CryptoBubbles) instead of jamming into a solid touching mass.
    // The gap-distance packing also spreads them evenly across the frame. Only a
    // fraction of the separation is applied per frame, with the closing velocity
    // damped, so the field eases into place smoothly rather than vibrating.
    const GAP = 1.18; // desired center spacing as a multiple of (rA + rB)
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i], c = bubbles[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const minD = (a.r + c.r) * GAP;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0) { c.x += 0.5; continue; }
        if (d2 < minD * minD) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const corr = (minD - d) * 0.2; // gentle nudge, not a full separation
          if (a !== dragging) { a.x -= nx * corr; a.y -= ny * corr; }
          if (c !== dragging) { c.x += nx * corr; c.y += ny * corr; }
          // Damp only the approaching component so resting contacts stay calm.
          const rvn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rvn < 0) {
            const imp = rvn * 0.5;
            if (a !== dragging) { a.vx += nx * imp; a.vy += ny * imp; }
            if (c !== dragging) { c.vx -= nx * imp; c.vy -= ny * imp; }
          }
        }
      }
    }
    // Soft walls: clamp inside and only reverse velocity when the bubble is
    // actually heading INTO the edge. (Flipping it unconditionally made bubbles
    // resting against a wall oscillate every frame — a jitter source.)
    for (const b of bubbles) {
      if (b === dragging) continue;
      const r = Math.min(b.r, Math.min(W, H) / 2);
      if (b.x < r) { b.x = r; if (b.vx < 0) b.vx *= -0.3; }
      if (b.x > W - r) { b.x = W - r; if (b.vx > 0) b.vx *= -0.3; }
      if (b.y < r) { b.y = r; if (b.vy < 0) b.vy *= -0.3; }
      if (b.y > H - r) { b.y = H - r; if (b.vy > 0) b.vy *= -0.3; }
    }
  }

  /* ----- drawing ----- */

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const b of bubbles) {
      const pct = b.coin[TF_KEYS[timeframe]];
      const up = (pct ?? 0) >= 0;
      const rgb = up ? '22,199,132' : '234,57,67';
      const t = Math.min(1, Math.abs(pct ?? 0) / 10);
      const glow = 0.16 + t * 0.5;

      // Dark fill with a subtle tint that intensifies toward the rim.
      const grad = ctx.createRadialGradient(b.x, b.y, b.r * 0.55, b.x, b.y, b.r);
      grad.addColorStop(0, 'rgba(' + rgb + ',0.015)');
      grad.addColorStop(0.72, 'rgba(' + rgb + ',0.05)');
      grad.addColorStop(1, 'rgba(' + rgb + ',' + glow.toFixed(3) + ')');
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // Bright colored ring with a soft glow — the defining CryptoBubbles look.
      // A wide translucent outer pass fakes the glow far more cheaply than
      // canvas shadowBlur would on 100 bubbles every frame (keeps it smooth).
      ctx.lineWidth = Math.max(3, b.r * 0.12);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.14 + t * 0.16).toFixed(3) + ')';
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, b.r * 0.05) + (b === hovered ? 1.5 : 0);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.75 + t * 0.25).toFixed(3) + ')';
      ctx.stroke();

      if (typeof Portfolio !== 'undefined' && Portfolio.has(b.coin.id)) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(79,140,255,0.9)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      if (b.r >= 13) {
        const sym = (b.coin.symbol || '').toUpperCase();
        const img = images[b.coin.id];
        const showLogo = b.r >= 26 && img && img.complete && img.naturalWidth;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Size the symbol to the bubble, then shrink to fit long tickers.
        let symFs = b.r * (showLogo ? 0.46 : 0.54);
        ctx.font = '800 ' + symFs + 'px system-ui, sans-serif';
        const maxW = b.r * 1.6;
        const w = ctx.measureText(sym).width;
        if (w > maxW) symFs *= maxW / w;
        symFs = Math.max(7, symFs);
        const pctFs = Math.max(7, symFs * 0.66);

        if (showLogo) {
          const iw = b.r * 0.5;
          ctx.drawImage(img, b.x - iw / 2, b.y - b.r * 0.6, iw, iw);
          ctx.fillStyle = '#fff';
          ctx.font = '800 ' + symFs + 'px system-ui, sans-serif';
          ctx.fillText(sym, b.x, b.y + b.r * 0.2);
          ctx.fillStyle = up ? '#16c784' : '#ea3943';
          ctx.font = '700 ' + pctFs + 'px system-ui, sans-serif';
          ctx.fillText(fmtPct(pct), b.x, b.y + b.r * 0.56);
        } else if (b.r >= 18) {
          ctx.fillStyle = '#fff';
          ctx.font = '800 ' + symFs + 'px system-ui, sans-serif';
          ctx.fillText(sym, b.x, b.y - symFs * 0.42);
          ctx.fillStyle = up ? '#16c784' : '#ea3943';
          ctx.font = '700 ' + pctFs + 'px system-ui, sans-serif';
          ctx.fillText(fmtPct(pct), b.x, b.y + symFs * 0.6);
        } else {
          ctx.fillStyle = '#fff';
          ctx.font = '800 ' + symFs + 'px system-ui, sans-serif';
          ctx.fillText(sym, b.x, b.y);
        }
      }
    }
  }

  function loop() {
    if (!running) return;
    step();
    draw();
    raf = requestAnimationFrame(loop);
  }

  /* ----- interaction ----- */

  function bubbleAt(x, y) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const dx = x - b.x, dy = y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) return b;
    }
    return null;
  }

  function showTip(b, x, y) {
    const pct = b.coin[TF_KEYS[timeframe]];
    tip.innerHTML = '<span class="tip-name">' + esc(b.coin.name) + ' ('
      + esc((b.coin.symbol || '').toUpperCase()) + ')</span><br>'
      + fmtUSD(b.coin.current_price)
      + ' · <span class="' + ((pct ?? 0) >= 0 ? 'up' : 'down') + '">' + fmtPct(pct) + ' (' + timeframe + ')</span><br>'
      + '<span class="muted">Mkt cap ' + fmtCompact(b.coin.market_cap) + '</span>';
    tip.classList.remove('hidden');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = x + 14, ty = y + 14;
    if (tx + tw > W - 8) tx = x - tw - 14;
    if (ty + th > H - 8) ty = y - th - 14;
    tip.style.left = Math.max(4, tx) + 'px';
    tip.style.top = Math.max(4, ty) + 'px';
  }

  function onPointerDown(e) {
    const b = bubbleAt(e.offsetX, e.offsetY);
    if (!b) return;
    dragging = b;
    dragMoved = 0;
    b.vx = 0;
    b.vy = 0;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const x = e.offsetX, y = e.offsetY;
    if (dragging) {
      // Clamp to the canvas bounds so dragging past an edge can't pull the
      // bubble partly or fully out of frame.
      const r = Math.min(dragging.r, Math.min(W, H) / 2);
      const cx = Math.min(Math.max(x, r), W - r);
      const cy = Math.min(Math.max(y, r), H - r);
      dragMoved += Math.abs(cx - dragging.x) + Math.abs(cy - dragging.y);
      dragging.vx = (cx - dragging.x) * 0.3;
      dragging.vy = (cy - dragging.y) * 0.3;
      dragging.x = cx;
      dragging.y = cy;
      showTip(dragging, cx, cy);
      return;
    }
    hovered = bubbleAt(x, y);
    canvas.style.cursor = hovered ? 'pointer' : 'default';
    if (hovered) showTip(hovered, x, y);
    else tip.classList.add('hidden');
  }

  function onPointerUp(e) {
    if (dragging && dragMoved < 6) showCoinModal(dragging.coin);
    dragging = null;
  }

  function setTimeframe(tf) {
    timeframe = tf;
    document.querySelectorAll('#tf-toggle button').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tf === tf));
    if (!running) draw();
  }

  function start() {
    resize();
    if (running) return;
    running = true;
    loop();
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    hovered = null;
    dragging = null;
    if (tip) tip.classList.add('hidden');
  }

  function init() {
    wrap = document.getElementById('bubbles-wrap');
    canvas = document.getElementById('bubbles-canvas');
    tip = document.getElementById('bubble-tip');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      hovered = null;
      tip.classList.add('hidden');
    });
    document.getElementById('tf-toggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-tf]');
      if (btn) setTimeframe(btn.dataset.tf);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); }
      else if (running) loop();
    });
  }

  return { init, update, start, stop };
})();
