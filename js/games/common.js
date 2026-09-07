/* GameKit — shared bits for every MIMU game renderer.
   A renderer implements: loadSprites, makeScene, tick, draw, snapToEnd, confetti
   and may add:        buildScript(params), placings(lobby, script), rewind(scene, t)
   Everything a script produces must be deterministic from the seed so every screen agrees. */
window.GameKit = (() => {
  const INK = "#101010", PAPER = "#f6f5f1", YELLOW = "#ffd23f", BLUE = "#2fa8ff", MAGENTA = "#e83cc8", CRIMSON = "#c8102e";
  const E = () => window.FloatzEngine;

  function loadSprites(ids, images) {
    return Promise.all(ids.map(id => new Promise(res => {
      const img = new Image();
      img.onload = () => { images[id] = img; res(); };
      img.onerror = () => { console.warn("sprite missing", id); res(); };
      img.src = E().spriteUrl(id);
    })));
  }
  const rngFor = (seed, salt) => new (E().Rng)(seed.map(x => (x ^ salt) >>> 0));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const short = (name, n = 12) => (name.length > n ? name.slice(0, n - 1) + "…" : name);

  /* ---------- elimination schedule ----------
     Everyone except the winner drops out one at a time between first..last of the race.
     Racers with more ticket weight tend to survive longer (winner is already fixed by the draw). */
  function elimScript({ count, winnerIndex, durationMs, seed, weights, first = 0.08, last = 0.94, salt = 0x7f4a7c15 }) {
    const rng = rngFor(seed, salt);
    const w = i => (weights && weights[i]) || 1;
    let pool = Array.from({ length: count }, (_, i) => i).filter(i => i !== winnerIndex);
    const order = [];
    while (pool.length) {
      const tot = pool.reduce((a, i) => a + 1 / w(i), 0); let r = rng.next() * tot, pick = pool[pool.length - 1];
      for (const i of pool) { r -= 1 / w(i); if (r <= 0) { pick = i; break; } }
      order.push(pick); pool = pool.filter(i => i !== pick);
    }
    const n = order.length, times = [];
    for (let k = 0; k < n; k++) { const u = (k + 1) / (n + 0.35); times.push(lerp(first, last, u) + (rng.next() - 0.5) * (last - first) / (n + 2) * 0.6); }
    for (let k = 1; k < n; k++) times[k] = Math.max(times[k], times[k - 1] + 0.004);
    const elimAt = Array.from({ length: count }, () => 1.01);
    order.forEach((i, k) => { elimAt[i] = clamp(times[k], first, last); });
    return { order, times, elimAt, count, winnerIndex, durationMs, rng };
  }
  const elimPlacings = (l, script) => [l.winnerIndex, ...script.order.slice().reverse()];
  const aliveAt = (script, t) => script.elimAt.map((e, i) => (t < e ? i : -1)).filter(i => i >= 0);

  /* ---------- confetti ---------- */
  function confetti(S, epic) {
    const colors = epic ? [YELLOW, "#ff8a1f", INK, "#ffffff", MAGENTA] : [BLUE, "#ff8a1f", MAGENTA, CRIMSON, "#ffffff", YELLOW];
    S.confetti ||= [];
    for (let i = 0; i < (epic ? 260 : 120); i++) S.confetti.push({ x: Math.random() * S.w, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, rot: Math.random() * 6.28, rv: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], w: 6 + Math.random() * 8, h: 4 + Math.random() * 6 });
  }
  function stepConfetti(S) { if (!S.confetti) return; S.confetti.forEach(c => { c.x += c.vx; c.y += c.vy; c.vy += 0.05; c.rot += c.rv; }); S.confetti = S.confetti.filter(c => c.y < S.h + 20); }
  function drawConfetti(S) { if (!S.confetti) return; const { ctx } = S; S.confetti.forEach(c => { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore(); }); }

  /* ---------- particles (smoke, sparks, splashes) ---------- */
  function puff(S, x, y, opts = {}) { (S.particles ||= []).push({ x, y, vx: (opts.vx ?? (Math.random() - 0.5) * 1.2), vy: (opts.vy ?? -0.6 - Math.random()), life: 1, size: opts.size ?? 3 + Math.random() * 4, grow: opts.grow ?? 0.12, color: opts.color || "rgba(90,90,90,", spark: !!opts.spark }); }
  function stepParticles(S, dt) { if (!S.particles) return; S.particles.forEach(p => { p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.life -= (p.spark ? 0.06 : 0.025) * dt * 60; p.size += p.grow * dt * 60; }); S.particles = S.particles.filter(p => p.life > 0).slice(-400); }
  function drawParticles(S) { if (!S.particles) return; const { ctx } = S; S.particles.forEach(p => { ctx.fillStyle = p.color + (p.life * 0.7) + ")"; if (p.spark) { ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.29); ctx.fill(); } }); }

  /* ---------- name tags & text ---------- */
  function tag(ctx, x, y, label, { mine = false, rank = 0, size = 12, above = true } = {}) {
    ctx.save(); ctx.font = `600 ${size}px "Space Grotesk", system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 10, th = size + 6, bx = x - tw / 2, by = above ? y - th : y;
    ctx.fillStyle = mine ? BLUE : rank === 1 ? YELLOW : "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.fillRect(bx, by, tw, th); ctx.strokeRect(bx, by, tw, th);
    ctx.fillStyle = mine ? "#fff" : INK; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, by + th / 2 + 1); ctx.restore();
  }
  function sfxText(ctx, x, y, text, { size = 34, color = YELLOW, rot = -0.08 } = {}) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.font = `700 ${size}px Bangers, Impact, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(4, size / 7); ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0); ctx.fillStyle = color; ctx.fillText(text, 0, 0); ctx.restore();
  }
  function hud(S, hudInfo, standing, opts = {}) {
    const { ctx, w } = S; if (!hudInfo) return;
    if (hudInfo.timer) { ctx.save(); ctx.font = "700 20px Bangers, Impact, sans-serif"; const tw = ctx.measureText(hudInfo.timer).width + 26; ctx.fillStyle = hudInfo.replay != null ? CRIMSON : INK; ctx.fillRect(10, 10, tw, 32); ctx.fillStyle = hudInfo.replay != null ? "#fff" : YELLOW; ctx.fillText(hudInfo.timer, 22, 33); ctx.restore(); }
    if (standing && standing.length) {
      const top = opts.top ?? 10, labels = opts.labels || ["1ST", "2ND", "3RD", "4TH", "5TH"], rx = w - 170 - (opts.rightPad || 0);
      ctx.save(); ctx.font = "700 12px Bangers, Impact, sans-serif";
      standing.slice(0, 5).forEach((r, i) => { ctx.fillStyle = i === 0 ? YELLOW : "#fff"; ctx.fillRect(rx, top + i * 24, 160, 20); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(rx, top + i * 24, 160, 20); ctx.fillStyle = INK; ctx.fillText(`${labels[i] || (i + 1)}  ${short(r.name, 12)}`, rx + 8, top + 15 + i * 24); });
      ctx.restore();
    }
    if (opts.badge) { ctx.save(); ctx.font = "700 16px Bangers, Impact, sans-serif"; const tw = ctx.measureText(opts.badge).width + 20; ctx.fillStyle = "#fff"; ctx.fillRect(10, 50, tw, 26); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(10, 50, tw, 26); ctx.fillStyle = INK; ctx.fillText(opts.badge, 20, 69); ctx.restore(); }
    if (hudInfo.replay != null) { const { h } = S; ctx.save(); ctx.fillStyle = "rgba(16,16,16,0.85)"; ctx.fillRect(0, 0, w, 26); ctx.fillRect(0, h - 26, w, 26); ctx.fillStyle = "rgba(255,210,63,0.06)"; ctx.fillRect(0, 0, w, h); const blink = Math.floor(performance.now() / 350) % 2 === 0; ctx.font = "700 34px Bangers, Impact, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.fillStyle = blink ? YELLOW : "#fff"; ctx.strokeText("◀ SLOW-MO REPLAY ▶", w / 2, h - 40); ctx.fillText("◀ SLOW-MO REPLAY ▶", w / 2, h - 40); ctx.fillStyle = CRIMSON; ctx.fillRect(0, h - 4, w * hudInfo.replay, 4); ctx.restore(); }
  }
  function halftone(S, alpha = 0.12, dot = 1.2, step = 8) {
    if (!S.halftone) { const c = document.createElement("canvas"); c.width = S.w; c.height = S.h; const hc = c.getContext("2d"); hc.fillStyle = INK; for (let y = 4; y < S.h; y += step) for (let x = 4; x < S.w; x += step) { hc.beginPath(); hc.arc(x + ((y / step) | 0) % 2 * (step / 2), y, dot, 0, 6.29); hc.fill(); } S.halftone = c; }
    S.ctx.save(); S.ctx.globalAlpha = alpha; S.ctx.drawImage(S.halftone, 0, 0); S.ctx.restore();
  }
  function fitCanvas(canvas, ratio, minH = 420, maxH = 720) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width)), h = Math.max(minH, Math.min(maxH, Math.round(w * ratio)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function drawSprite(ctx, img, x, y, wid, { angle = 0, gray = false, alpha = 1, flip = false, smooth = false } = {}) {
    if (!img) return; const hgt = img.naturalHeight * (wid / img.naturalWidth);
    ctx.save(); ctx.translate(x, y); if (angle) ctx.rotate(angle); if (flip) ctx.scale(-1, 1); ctx.globalAlpha = alpha; if (gray) ctx.filter = "grayscale(1) brightness(0.7)";
    ctx.imageSmoothingEnabled = smooth; if (smooth) ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, -wid / 2, -hgt / 2, wid, hgt); ctx.restore();
  }

  /* ---------- tiny synth for renderer-side sounds ---------- */
  const sfx = (() => {
    let ctx; const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    const tone = (f, t0, dur, type = "square", vol = 0.1, slide = 0) => { try { const c = ac(), o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t0 + dur); g.gain.setValueAtTime(vol, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur); o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.02); } catch {} };
    let noiseBuf; const noise = (dur = 0.3, vol = 0.2, f = 900) => { try { const c = ac(); if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = c.createBufferSource(); s.buffer = noiseBuf; const flt = c.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur); s.connect(flt).connect(g).connect(c.destination); s.start(); } catch {} };
    return {
      tick: (p = 0.5) => tone(1200 + p * 900, 0, 0.05, "square", 0.06),
      crash: () => { noise(0.35, 0.3, 700); tone(90, 0, 0.3, "sawtooth", 0.12, 40); },
      boom: () => { noise(0.8, 0.5, 400); tone(60, 0, 0.9, "sine", 0.3, 30); },
      zap: () => { tone(1800, 0, 0.18, "sawtooth", 0.08, 200); noise(0.2, 0.15, 3000); },
      pop: () => tone(600, 0, 0.09, "square", 0.08, 1400),
      bump: () => tone(200, 0, 0.08, "triangle", 0.1, 120),
      ding: () => { tone(1046, 0, 0.3, "sine", 0.1); tone(1568, 0.12, 0.4, "sine", 0.08); },
      slide: () => tone(400, 0, 0.5, "sine", 0.05, 120),
    };
  })();

  return { INK, PAPER, YELLOW, BLUE, MAGENTA, CRIMSON, loadSprites, rngFor, lerp, clamp, short, elimScript, elimPlacings, aliveAt, confetti, stepConfetti, drawConfetti, puff, stepParticles, drawParticles, tag, sfxText, hud, halftone, fitCanvas, drawSprite, sfx };
})();
