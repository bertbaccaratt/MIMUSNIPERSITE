/* Snail Mail — the slowest race on Ape. Lanes across a garden path; snails crawl, burst, nap.
   Uses the float-race trajectories (same odds, same photo-finish pinning) run through a per-snail
   time warp so the motion reads as crawl → dash → nap. First to the mailbox delivers the letter. */
window.SnailRender = (() => {
  const K = window.GameKit, INK = K.INK, E = () => window.FloatzEngine;
  const images = {}; let ready = false;
  const loadSprites = ids => K.loadSprites(ids, images).then(() => { ready = true; });

  function buildScript(p) {
    // Snails only ever move forward. The float engine gives us the (ticket-weighted) finishing order;
    // each snail then gets its own crawl / burst / nap timeline that lands it on that finishing spot.
    const base = E().buildRace({ ...p, start: 0.04, touch: 0.985 });
    const rng = K.rngFor(p.seed, 0x5a11);
    const steps = base.trajectories[0].length - 1, last = steps, start = 0.04, touch = 0.985;
    const order = base.trajectories.map((tr, i) => ({ i, v: i === p.winnerIndex ? 9 : tr[last] })).sort((a, b) => b.v - a.v).map(o => o.i);
    const finals = []; order.forEach((i, rank) => { finals[i] = rank === 0 ? touch : touch - (0.045 + rank * 0.012 + rng.next() * 0.01); });
    const warped = base.trajectories.map((_, i) => {
      const segs = []; let total = 0; const count = 18 + Math.floor(rng.next() * 12);
      for (let k = 0; k < count; k++) { const r = rng.next(); const kind = r < 0.42 ? "nap" : r < 0.88 ? "crawl" : "burst"; const len = 0.5 + rng.next() * 1.2; const slope = kind === "nap" ? 0.0 : kind === "crawl" ? 0.55 : 1.9; segs.push({ len, slope, kind }); total += len; }
      segs[segs.length - 1].slope = 0.55;                          // always crawling at the line, never napping there
      const gain = segs.reduce((a, q) => a + q.len * q.slope, 0);
      const warp = u => { let acc = 0, x = u * total; for (const q of segs) { if (x <= q.len) return (acc + x * q.slope) / gain; x -= q.len; acc += q.len * q.slope; } return 1; };
      return Array.from({ length: steps + 1 }, (_, s) => start + (finals[i] - start) * warp(s / steps));
    });
    const naps = warped.map(t => t.map((v, s) => s > 0 && Math.abs(v - t[s - 1]) < 1e-5));
    return { ...base, trajectories: warped, naps, steps, order };
  }
  const placings = (l, sc) => sc.order;

  function layout(w, laneCount) {
    const padX = w * 0.06, spriteW = Math.max(26, Math.min(laneCount <= 6 ? 96 : laneCount <= 12 ? 74 : 56, (w * 0.7) / 9));
    const spacing = Math.max(spriteW * 0.55, Math.min(70, 520 / laneCount));
    const h = Math.max(420, Math.min(760, 150 + spacing * laneCount + 40));
    return { w, h, spriteW, spacing, padX, top: 120, startX: padX + spriteW * 0.6, finishX: w - padX - 70 };
  }
  function makeScene(canvas, roster, script, laneCount) {
    const rect = canvas.parentElement.getBoundingClientRect(), w = Math.max(320, Math.floor(rect.width));
    const L = layout(w, laneCount), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = L.w * dpr; canvas.height = L.h * dpr; canvas.style.width = L.w + "px"; canvas.style.height = L.h + "px";
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const trackLen = L.finishX - L.startX;
    const racers = roster.map((r, i) => ({ ...r, i, laneY: L.top + L.spacing * ((script ? script.laneOrder[i] : i) + 0.6), progress: script ? script.start : 0.04, display: script ? script.start : 0.04, bob: script ? script.bob[i] : Math.random() * 6.28, napping: false, speedV: 0, trail: [], zz: 0 }));
    const flowers = Array.from({ length: 26 }, (_, i) => ({ x: (i * 97) % w, y: 20 + (i * 53) % 70, c: ["#e83cc8", "#ffd23f", "#ff8a1f", "#2fa8ff"][i % 4] }));
    return { ctx, ...L, trackLen, racers, script, laneCount, time: 0, last: performance.now(), over: false, flowers, letter: null, delivered: false };
  }
  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    S.racers.forEach(r => {
      if (tRace == null || !S.script) { r.bob += dt * 2; return; }
      const target = E().sample(S.script.trajectories, r.i, tRace);
      const diff = target - r.display; r.display += diff * (1 - Math.exp(-dt * 10)); r.progress = r.display;
      const sp = E().speed(S.script.trajectories, r.i, tRace); r.speedV = sp; r.napping = Math.abs(sp) < 0.01 && !S.over;
      r.bob += dt * (1.2 + Math.abs(sp) * 3);
      if (!r.napping && Math.random() < 0.3) r.trail.push({ x: S.startX + r.display * S.trackLen, life: 1 });
      r.trail.forEach(t => { t.life -= dt * 0.08; }); r.trail = r.trail.filter(t => t.life > 0).slice(-120);
      if (r.napping && Math.random() < 0.02) r.zz = 1; if (r.zz > 0) r.zz -= dt * 0.6;
    });
    if (S.letter) { S.letter.u = Math.min(1, S.letter.u + dt * 1.4); if (S.letter.u >= 1 && !S.delivered) { S.delivered = true; K.sfx.ding(); } }
    K.stepParticles(S, dt); K.stepConfetti(S);
  }
  function snapToEnd(S) { const last = S.script.trajectories[0].length - 1; S.racers.forEach(r => { r.display = r.progress = S.script.trajectories[r.i][last]; r.napping = false; }); S.over = true; S.letter = { from: winnerOf(S), u: 0 }; }
  const winnerOf = S => S.racers.reduce((a, b) => (b.progress > a.progress ? b : a)).i;
  function rewind(S, t) { S.letter = null; S.delivered = false; S.racers.forEach(r => { r.display = r.progress = E().sample(S.script.trajectories, r.i, t); r.trail = []; }); }
  const confetti = (S, epic) => K.confetti(S, epic);

  function draw(S, hudInfo) {
    const { ctx, w, h } = S; ctx.clearRect(0, 0, w, h);
    // garden: grass band, flowers, dirt path with lane grooves
    ctx.fillStyle = "#7bc05a"; ctx.fillRect(0, 0, w, h);
    S.flowers.forEach(f => { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y + Math.sin(S.time + f.x) * 2, 5, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(f.x, f.y + Math.sin(S.time + f.x) * 2, 1.8, 0, 6.29); ctx.fill(); });
    ctx.fillStyle = "#c8a070"; ctx.fillRect(0, S.top - 34, w, S.spacing * S.laneCount + 60); ctx.fillStyle = INK; ctx.fillRect(0, S.top - 36, w, 3); ctx.fillRect(0, S.top + S.spacing * S.laneCount + 24, w, 3);
    K.halftone(S, 0.07, 1.1, 8);
    ctx.strokeStyle = "rgba(90,60,30,0.25)"; ctx.lineWidth = 2; ctx.setLineDash([12, 10]); S.racers.forEach(r => { ctx.beginPath(); ctx.moveTo(S.startX - 30, r.laneY + S.spriteW * 0.32); ctx.lineTo(S.finishX + 30, r.laneY + S.spriteW * 0.32); ctx.stroke(); }); ctx.setLineDash([]);
    // start line + mailbox at the finish
    ctx.fillStyle = "#fff"; ctx.fillRect(S.startX - 26, S.top - 30, 4, S.spacing * S.laneCount + 54); ctx.strokeStyle = INK; ctx.strokeRect(S.startX - 26, S.top - 30, 4, S.spacing * S.laneCount + 54);
    const mbY = S.top + S.spacing * S.laneCount / 2;
    ctx.fillStyle = INK; ctx.fillRect(S.finishX + 22, S.top - 30, 4, S.spacing * S.laneCount + 54);
    ctx.fillStyle = "#2f64dc"; ctx.fillRect(S.finishX + 6, mbY - 40, 46, 52); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(S.finishX + 6, mbY - 40, 46, 52); ctx.beginPath(); ctx.arc(S.finishX + 29, mbY - 40, 23, Math.PI, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#111"; ctx.fillRect(S.finishX + 12, mbY - 30, 34, 6); ctx.fillStyle = "#888"; ctx.fillRect(S.finishX + 26, mbY + 12, 6, 36); ctx.strokeRect(S.finishX + 26, mbY + 12, 6, 36);
    const flag = S.delivered ? -1 : 0.3; ctx.fillStyle = "#e83c3c"; ctx.beginPath(); ctx.moveTo(S.finishX + 52, mbY - 36); ctx.lineTo(S.finishX + 52 + 26 * Math.cos(flag), mbY - 36 + 26 * Math.sin(flag)); ctx.lineTo(S.finishX + 52 + 10 * Math.cos(flag + 0.6), mbY - 36 + 10 * Math.sin(flag + 0.6)); ctx.closePath(); ctx.fill(); ctx.stroke();
    // slime trails
    S.racers.forEach(r => { r.trail.forEach(t => { ctx.fillStyle = `rgba(190,240,200,${t.life * 0.6})`; ctx.beginPath(); ctx.ellipse(t.x, r.laneY + S.spriteW * 0.32, 8, 3, 0, 0, 6.29); ctx.fill(); }); });
    // snails
    [...S.racers].sort((a, b) => a.laneY - b.laneY).forEach(r => {
      const x = S.startX + r.display * S.trackLen, img = images[r.spriteId]; const squash = r.napping ? 0 : Math.sin(r.bob) * 2;
      const stretch = r.napping ? 1 : 1 + Math.sin(r.bob * 2) * 0.05;
      ctx.save(); ctx.translate(x, r.laneY + squash); ctx.scale(stretch, 1 / stretch); K.drawSprite(ctx, img, 0, 0, S.spriteW); ctx.restore();
      if (r.zz > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, r.zz); ctx.font = "700 16px Bangers, Impact, sans-serif"; ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 3; const zx = x + S.spriteW * 0.3, zy = r.laneY - S.spriteW * 0.5 - (1 - r.zz) * 20; ctx.strokeText("z z", zx, zy); ctx.fillText("z z", zx, zy); ctx.restore(); }
      if (r.speedV > 0.05 && !S.over) { ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - S.spriteW * 0.45 - i * 6, r.laneY - 6 + i * 6); ctx.lineTo(x - S.spriteW * 0.7 - i * 8, r.laneY - 6 + i * 6); ctx.stroke(); } }
      if (!S.over && r.display > 0.86) { K.sfxText(ctx, x, r.laneY - S.spriteW * 0.6, "SO CLOSE", { size: 14, color: "#fff" }); }
    });
    // letter flying into the mailbox
    if (S.letter) { const from = S.racers[S.letter.from], u = S.letter.u; const x0 = S.startX + from.display * S.trackLen, y0 = from.laneY, x1 = S.finishX + 29, y1 = mbY - 26; const x = K.lerp(x0, x1, u), y = K.lerp(y0, y1, u) - Math.sin(u * Math.PI) * 60;
      if (u < 1) { ctx.save(); ctx.translate(x, y); ctx.rotate(u * 6); ctx.fillStyle = "#fff"; ctx.fillRect(-12, -8, 24, 16); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(-12, -8, 24, 16); ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(0, 2); ctx.lineTo(12, -8); ctx.stroke(); ctx.restore(); }
      else K.sfxText(ctx, S.finishX - 30, mbY - 70, "DELIVERED!", { size: 30, color: "#ffd23f", rot: -0.15 }); }
    K.drawParticles(S);
    const ranked = [...S.racers].sort((a, b) => b.progress - a.progress), tagAll = S.laneCount <= 12;
    ranked.forEach((r, rank) => { if (tagAll || rank < 3 || r.mine) K.tag(ctx, S.startX + r.display * S.trackLen, r.laneY - S.spriteW * 0.55, `#${rank + 1} ${K.short(r.name, 12)}`, { mine: r.mine, size: S.laneCount > 24 ? 10 : 12 }); });
    K.drawConfetti(S);
    K.hud(S, hudInfo, ranked);
  }
  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, buildScript, placings, rewind, get ready() { return ready; } };
})();
