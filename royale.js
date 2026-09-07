/* MIMU Royale — top-down island. The storm circle shrinks in waves; MIMUs scramble toward the safe
   zone and shove each other on the way. Whoever is caught outside when a wave closes gets zapped.
   Positions are simulated once from the seed (buildScript) so every screen agrees. */
window.RoyaleRender = (() => {
  const K = window.GameKit, INK = K.INK;
  const images = {}; let ready = false;
  const STEP = 0.1;
  const loadSprites = ids => K.loadSprites(ids, images).then(() => { ready = true; });

  function buildScript(p) {
    const el = K.elimScript({ ...p, first: 0.10, last: 0.96, salt: 0x77a1c4 });
    const rng = el.rng, n = p.count, dur = p.durationMs / 1000, steps = Math.ceil(dur / STEP);
    const w = i => (p.weights && p.weights[i]) || 1;
    // storm: radius shrinks in waves; a wave closes at each elimination time
    const waves = el.order.map((v, k) => ({ t: el.elimAt[v], victim: v, r: K.lerp(0.95, 0.12, (k + 1) / (el.order.length + 1)) }));
    const radiusAt = t => { let r = 1.0; for (const wv of waves) { if (t >= wv.t) r = wv.r; else { const prev = waves[waves.indexOf(wv) - 1]; const r0 = prev ? prev.r : 1.0, t0 = prev ? prev.t : 0; const u = K.clamp((t - t0) / (wv.t - t0), 0, 1); return K.lerp(r0, wv.r, u < 0.75 ? 0 : (u - 0.75) / 0.25); } } return r; };
    const ps = Array.from({ length: n }, (_, i) => { const a = rng.next() * 6.283, r = 0.35 + rng.next() * 0.5; return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, out: false, tx: 0, ty: 0, wob: rng.next() * 6.283, face: 1 }; });
    ps.forEach(q => { q.tx = q.x; q.ty = q.y; });
    const frames = [], events = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, R = radiusAt(t);
      const nextWave = waves.find(wv => wv.t > t);
      ps.forEach((q, i) => {
        if (q.out) { q.vx *= 0.8; q.vy *= 0.8; q.x += q.vx * STEP; q.y += q.vy * STEP; return; }
        q.wob += STEP * 1.3;
        // new wander target now and then; the doomed one drifts toward the edge as its wave nears
        if (rng.next() < 0.06) { const a = rng.next() * 6.283, rr = rng.next() * Math.max(0.08, (nextWave ? nextWave.r : R) * 0.9); q.tx = Math.cos(a) * rr; q.ty = Math.sin(a) * rr; }
        let tx = q.tx, ty = q.ty;
        if (nextWave && nextWave.victim === i) { const u = K.clamp((nextWave.t - t) / 0.06, 0, 1); const d = Math.hypot(q.x, q.y) || 1; tx = q.x / d * (nextWave.r + 0.14 + u * 0.1); ty = q.y / d * (nextWave.r + 0.14 + u * 0.1); }
        const dx = tx - q.x, dy = ty - q.y, d = Math.hypot(dx, dy) || 1, sp = (0.22 + Math.sin(q.wob) * 0.05) * Math.pow(w(i), 0.35);
        q.vx = K.lerp(q.vx, dx / d * Math.min(sp, d / STEP), 0.25); q.vy = K.lerp(q.vy, dy / d * Math.min(sp, d / STEP), 0.25);
        q.x += q.vx * STEP; q.y += q.vy * STEP; if (Math.abs(q.vx) > 0.01) q.face = q.vx > 0 ? 1 : -1;
        const rr = Math.hypot(q.x, q.y); if (rr > 0.98) { q.x *= 0.98 / rr; q.y *= 0.98 / rr; }
      });
      // scuffles: shove apart when close, occasionally a big shove event
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const a = ps[i], b = ps[j]; if (a.out || b.out) continue; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < 0.09 && d > 0) { const push = (0.09 - d) / 2; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; if (rng.next() < 0.08) { const big = rng.next() < 0.5 ? a : b, k = big === a ? -1 : 1; big.vx += dx / d * 0.5 * k; big.vy += dy / d * 0.5 * k; events.push({ s, kind: "shove", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); } } }
      waves.forEach(wv => { if (!wv.done && t >= wv.t) { wv.done = true; const v = ps[wv.victim]; v.out = true; const d = Math.hypot(v.x, v.y) || 1; v.vx = v.x / d * 0.6; v.vy = v.y / d * 0.6; events.push({ s, kind: "zap", victim: wv.victim, x: v.x, y: v.y }); } });
      frames.push({ R, p: ps.map(q => [q.x, q.y, q.out ? 1 : 0, q.face]) });
    }
    return { ...el, frames, steps, events, waves };
  }
  const placings = (l, sc) => K.elimPlacings(l, sc);

  function makeScene(canvas, roster, script, laneCount) {
    const { ctx, w, h } = K.fitCanvas(canvas, 0.66, 440, 720);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46;
    const spriteW = laneCount <= 8 ? 60 : laneCount <= 16 ? 50 : laneCount <= 30 ? 42 : laneCount <= 50 ? 34 : 28;
    const racers = roster.map((r, i) => ({ ...r, i, x: 0, y: 0, out: false, face: 1, progress: 0 }));
    const palms = Array.from({ length: 7 }, (_, i) => { const a = i / 7 * 6.283 + 0.4; return { x: Math.cos(a) * 0.82, y: Math.sin(a) * 0.82, s: 0.8 + (i % 3) * 0.15 }; });
    const rocks = Array.from({ length: 10 }, (_, i) => ({ x: Math.cos(i * 2.4) * 0.5 * ((i % 4) / 4 + 0.3), y: Math.sin(i * 2.4) * 0.5 * ((i % 3) / 3 + 0.3), s: 6 + (i % 3) * 4 }));
    return { ctx, w, h, cx, cy, R, spriteW, racers, script, laneCount, storm: 1, t: 0, over: false, time: 0, last: performance.now(), flash: null, bolts: [], shake: 0 };
  }
  const toPx = (S, x, y) => [S.cx + x * S.R, S.cy + y * S.R * 0.78];
  function apply(S, t) {
    const sc = S.script; if (!sc) return;
    const pos = K.clamp(t, 0, 1) * sc.steps, s0 = Math.floor(pos), f = pos - s0, a = sc.frames[s0], b = sc.frames[Math.min(s0 + 1, sc.steps)];
    S.storm = K.lerp(a.R, b.R, f);
    S.racers.forEach(r => { const p = a.p[r.i], q = b.p[r.i]; r.x = K.lerp(p[0], q[0], f); r.y = K.lerp(p[1], q[1], f); r.out = !!p[2]; r.face = p[3]; r.progress = r.out ? sc.elimAt[r.i] : 1 + (1 - Math.hypot(r.x, r.y)) * 0.1; });
    S.t = t;
  }
  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    if (tRace == null || !S.script) { if (S.script) apply(S, 0); else S.racers.forEach((r, i) => { const a = i / S.racers.length * 6.283; r.x = Math.cos(a) * 0.6; r.y = Math.sin(a) * 0.6; }); K.stepParticles(S, dt); K.stepConfetti(S); return; }
    const prevStep = Math.floor(S.t * S.script.steps); apply(S, tRace); const step = Math.floor(tRace * S.script.steps);
    if (step > prevStep && step - prevStep < 20) S.script.events.forEach(e => { if (e.s > prevStep && e.s <= step) onEvent(S, e); });
    S.bolts = S.bolts.filter(b => now - b.at < 350);
    if (S.shake > 0) S.shake -= dt * 3; if (S.flash && now - S.flash.at > 1100) S.flash = null;
    K.stepParticles(S, dt); K.stepConfetti(S);
  }
  function onEvent(S, e) {
    const [x, y] = toPx(S, e.x, e.y);
    if (e.kind === "shove") { for (let i = 0; i < 6; i++) K.puff(S, x, y, { color: "rgba(255,255,255,", size: 2, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3 }); K.sfx.bump(); return; }
    S.bolts.push({ x, y, at: performance.now(), seg: Array.from({ length: 6 }, () => (Math.random() - 0.5) * 40) });
    for (let i = 0; i < 24; i++) K.puff(S, x, y, { spark: true, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, color: "rgba(255,245,120," });
    K.sfx.zap(); S.shake = 0.8; S.flash = { at: performance.now(), text: `${K.short(S.racers[e.victim].name, 12)} GOT ZAPPED!`, x, y };
  }
  function rewind(S, t) { S.particles = []; S.bolts = []; S.flash = null; apply(S, t); }
  function snapToEnd(S) { apply(S, 1); S.over = true; }
  const confetti = (S, epic) => K.confetti(S, epic);

  function draw(S, hudInfo) {
    const { ctx, w, h, cx, cy, R } = S; ctx.clearRect(0, 0, w, h);
    ctx.save(); if (S.shake > 0) ctx.translate((Math.random() - 0.5) * 8 * S.shake, (Math.random() - 0.5) * 8 * S.shake);
    // sea
    ctx.fillStyle = "#2fa8ff"; ctx.fillRect(-20, -20, w + 40, h + 40);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 3; for (let y = 10; y < h; y += 26) { ctx.beginPath(); for (let x = -20; x < w + 20; x += 12) ctx.lineTo(x, y + Math.sin((x + S.time * 60) / 30) * 3); ctx.stroke(); }
    // island
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.05, R * 0.82, 0, 0, 6.29); ctx.fillStyle = "#f0d696"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.9, R * 0.68, 0, 0, 6.29); ctx.fillStyle = "#58aa46"; ctx.fill();
    K.halftone(S, 0.07, 1.2, 9);
    // rocks + palms
    for (let i = 0; i < 10; i++) { const [x, y] = toPx(S, Math.cos(i * 2.4) * 0.5 * ((i % 4) / 4 + 0.3), Math.sin(i * 2.4) * 0.5 * ((i % 3) / 3 + 0.3)); ctx.beginPath(); ctx.ellipse(x, y, 7 + (i % 3) * 3, 5 + (i % 3) * 2, 0, 0, 6.29); ctx.fillStyle = "#8a8f7a"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(); }
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + 0.4; const [x, y] = toPx(S, Math.cos(a) * 0.72, Math.sin(a) * 0.72); ctx.fillStyle = "#7a5030"; ctx.fillRect(x - 3, y - 26, 6, 30); for (let k = 0; k < 4; k++) { const b = k / 4 * 6.283 + S.time * 0.5; ctx.fillStyle = "#2f8f3c"; ctx.beginPath(); ctx.ellipse(x + Math.cos(b) * 12, y - 28 + Math.sin(b) * 6, 14, 6, b, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke(); } }
    // storm: purple wash outside the circle, ring edge
    if (S.script) { const sr = S.storm * R; ctx.save(); ctx.beginPath(); ctx.rect(-20, -20, w + 40, h + 40); ctx.ellipse(cx, cy, sr, sr * 0.78, 0, 0, 6.29, true); ctx.fillStyle = "rgba(107,63,181,0.45)"; ctx.fill(); ctx.restore();
      ctx.save(); ctx.strokeStyle = "#e83cc8"; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -S.time * 40; ctx.beginPath(); ctx.ellipse(cx, cy, sr, sr * 0.78, 0, 0, 6.29); ctx.stroke(); ctx.restore(); }
    // MIMUs, back to front
    const order = [...S.racers].sort((a, b) => a.y - b.y);
    order.forEach(r => { const [x, y] = toPx(S, r.x, r.y); const img = images[r.spriteId]; const run = !r.out && !S.over ? Math.abs(Math.sin(S.time * 14 + r.i)) * 5 : 0;
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(x, y + S.spriteW * 0.45, S.spriteW * 0.38, S.spriteW * 0.11, 0, 0, 6.29); ctx.fill();
      K.drawSprite(ctx, img, x, y - run, S.spriteW, { gray: r.out, alpha: r.out ? 0.5 : 1, flip: r.face < 0 });
    });
    // lightning
    S.bolts.forEach(b => { ctx.save(); ctx.strokeStyle = "#fff8b0"; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(b.x + b.seg[0], -10); let yy = -10; b.seg.forEach((sg, k) => { yy += (b.y + 10) / 6; ctx.lineTo(b.x + sg, yy); }); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); });
    K.drawParticles(S);
    const tagAll = S.laneCount <= 16;
    S.racers.forEach(r => { const [x, y] = toPx(S, r.x, r.y); if (r.out) { if (tagAll || r.mine) K.tag(ctx, x, y + S.spriteW * 0.5, "OUT", { size: 10, above: false }); } else if (tagAll || r.mine || S.racers.filter(q => !q.out).length <= 10) K.tag(ctx, x, y - S.spriteW * 0.6, K.short(r.name, 12), { mine: r.mine, size: S.laneCount > 16 ? 10 : 12 }); });
    if (S.over) { const win = S.racers[S.script.winnerIndex]; if (win) { const [x, y] = toPx(S, win.x, win.y); K.sfxText(ctx, x, y - S.spriteW * 0.9, "LAST ONE STANDING!", { size: 26 }); } }
    if (S.flash) K.sfxText(ctx, K.clamp(S.flash.x, 150, w - 150), K.clamp(S.flash.y - 60, 40, h - 30), S.flash.text, { size: 28, color: "#fff8b0" });
    ctx.restore();
    K.drawConfetti(S);
    const alive = S.racers.filter(r => !r.out).length;
    const standing = [...S.racers].sort((a, b) => b.progress - a.progress);
    K.hud(S, hudInfo, standing, { badge: S.script ? `${alive} ALIVE · STORM ${Math.round(S.storm * 100)}%` : null });
  }
  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, buildScript, placings, rewind, get ready() { return ready; } };
})();
