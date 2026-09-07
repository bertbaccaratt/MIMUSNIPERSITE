/* MIMU Derby — top-down demolition derby. Cars circle a dirt oval, ram each other, take damage
   (smoke → fire → wreck). Wreck order = placings, last car running wins.
   The whole run is simulated once from the seed (buildScript), so every screen sees the same crashes. */
window.DerbyRender = (() => {
  const K = window.GameKit, INK = K.INK;
  const images = {}; let ready = false;
  const STEP = 0.05;                       // seconds per sim step
  const loadSprites = ids => K.loadSprites(ids, images).then(() => { ready = true; });

  function buildScript(p) {
    const el = K.elimScript({ ...p, first: 0.06, last: 0.95, salt: 0x1d3b9c7 });
    const rng = el.rng, n = p.count, dur = p.durationMs / 1000, steps = Math.ceil(dur / STEP);
    // arena in unit space: ellipse rx=1, ry=0.62
    const hp0 = i => 3 + Math.floor(rng.next() * 3);           // 3..5 hits to wreck
    const cars = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2, r = 0.55 + (i % 3) * 0.12;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62, ang: a + Math.PI / 2, v: 0, hp: hp0(i), maxHp: 0, dir: rng.next() < 0.5 ? 1 : -1, wob: rng.next() * 6.28, out: false };
    });
    cars.forEach(c => { c.maxHp = c.hp; });
    // schedule hits so each car's hp reaches 0 exactly at its elimAt
    const hits = [];   // {t, victim}
    el.elimAt.forEach((e, i) => { if (e > 1) return; const c = cars[i]; for (let k = 0; k < c.hp; k++) { const t = e - (c.hp - 1 - k) * Math.min(0.06, e / (c.hp + 1)) * (0.7 + rng.next() * 0.6); hits.push({ t: Math.max(0.02, t), victim: i, final: k === c.hp - 1 }); } });
    hits.sort((a, b) => a.t - b.t);
    // extra cosmetic bumps (no damage) for the winner and survivors so they look busy
    const frames = []; let hi = 0; const events = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // waypoint driving: follow the oval, drift toward random target radius
      cars.forEach((c, i) => {
        if (c.out) { c.v *= 0.9; c.x += Math.cos(c.ang) * c.v * STEP; c.y += Math.sin(c.ang) * c.v * STEP; return; }
        c.wob += STEP * 1.7;
        const targetR = 0.45 + Math.sin(c.wob * 0.6 + i) * 0.25;
        const a = Math.atan2(c.y / 0.62, c.x), rNow = Math.hypot(c.x, c.y / 0.62);
        const tangent = a + c.dir * Math.PI / 2, radial = (targetR - rNow) * 1.6;
        const want = Math.atan2(Math.sin(tangent) * 0.62 + Math.sin(a) * radial * 0.62, Math.cos(tangent) + Math.cos(a) * radial);
        let da = ((want - c.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI; c.ang += K.clamp(da, -2.2 * STEP, 2.2 * STEP);
        c.v = K.lerp(c.v, 0.42 + Math.sin(c.wob) * 0.08, 0.1);
        c.x += Math.cos(c.ang) * c.v * STEP; c.y += Math.sin(c.ang) * c.v * STEP;
        const rr = Math.hypot(c.x, c.y / 0.62); if (rr > 0.92) { c.x *= 0.92 / rr; c.y *= 0.92 / rr; c.ang += 0.6 * c.dir; }
        if (rng.next() < 0.004) c.dir *= -1;
      });
      // scripted hits: hitter = nearest running car, victim gets shoved
      while (hi < hits.length && hits[hi].t <= t) {
        const h = hits[hi++], v = cars[h.victim]; if (v.out) continue;
        let best = -1, bd = 9; cars.forEach((o, j) => { if (j === h.victim || o.out) return; const d = Math.hypot(o.x - v.x, o.y - v.y); if (d < bd) { bd = d; best = j; } });
        const hitter = best >= 0 ? cars[best] : null;
        if (hitter) { const dx = v.x - hitter.x, dy = v.y - hitter.y, d = Math.hypot(dx, dy) || 1; hitter.x = v.x - dx / d * 0.09; hitter.y = v.y - dy / d * 0.09; hitter.ang = Math.atan2(dy, dx); v.x += dx / d * 0.05; v.y += dy / d * 0.05; v.ang += (rng.next() - 0.5) * 1.2; v.v = 0.1; }
        v.hp -= 1; if (h.final || v.hp <= 0) { v.hp = 0; v.out = true; v.v = 0.25; }
        events.push({ s, victim: h.victim, hitter: best, x: v.x, y: v.y, wreck: v.out });
      }
      // gentle separation between running cars
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const a = cars[i], b = cars[j]; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < 0.07 && d > 0) { const push = (0.07 - d) / 2; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; } }
      frames.push(cars.map(c => [c.x, c.y, c.ang, c.hp, c.out ? 1 : 0]));
    }
    return { ...el, frames, steps, events, maxHp: cars.map(c => c.maxHp) };
  }
  const placings = (l, sc) => K.elimPlacings(l, sc);

  function makeScene(canvas, roster, script, laneCount) {
    const { ctx, w, h } = K.fitCanvas(canvas, 0.62, 420, 720);
    const rx = w * 0.44, ry = h * 0.4, cx = w / 2, cy = h / 2 + 8;
    const carW = laneCount <= 8 ? 62 : laneCount <= 20 ? 50 : laneCount <= 40 ? 38 : 30;
    const racers = roster.map((r, i) => ({ ...r, i, x: 0, y: 0, ang: 0, hp: 0, out: false, display: 0, progress: 0 }));
    const crowd = Array.from({ length: 160 }, (_, i) => { const a = (i / 160) * 6.283; return { a, r: 1.06 + (i % 3) * 0.035, c: ["#2fa8ff", "#ff8a1f", "#e83cc8", "#ffd23f", "#6b3fb5", "#28c8a0"][i % 6] }; });
    const tires = Array.from({ length: 44 }, (_, i) => (i / 44) * 6.283);
    return { ctx, w, h, rx, ry, cx, cy, carW, racers, script, laneCount, crowd, tires, t: 0, over: false, lastEvent: 0, time: 0, last: performance.now(), marks: [], flash: null };
  }
  const toPx = (S, x, y) => [S.cx + x * S.rx, S.cy + y * S.ry / 0.62];

  function apply(S, t) {
    const sc = S.script; if (!sc) return;
    const pos = K.clamp(t, 0, 1) * sc.steps, s0 = Math.floor(pos), f = pos - s0, a = sc.frames[s0], b = sc.frames[Math.min(s0 + 1, sc.steps)];
    S.racers.forEach(r => { const p = a[r.i], q = b[r.i]; r.x = K.lerp(p[0], q[0], f); r.y = K.lerp(p[1], q[1], f); let da = q[2] - p[2]; da = ((da + Math.PI * 3) % (Math.PI * 2)) - Math.PI; r.ang = p[2] + da * f; r.hp = p[3]; r.out = !!p[4]; r.progress = r.out ? sc.elimAt[r.i] : 1 + r.hp / 10; });
    S.t = t;
  }
  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    if (tRace == null || !S.script) { if (S.script) apply(S, 0); else S.racers.forEach((r, i) => { const a = (i / S.racers.length) * 6.283; r.x = Math.cos(a) * 0.6; r.y = Math.sin(a) * 0.6 * 0.62; r.ang = a + Math.PI / 2; }); K.stepParticles(S, dt); K.stepConfetti(S); return; }
    const prevStep = Math.floor(S.t * S.script.steps);
    apply(S, tRace);
    const step = Math.floor(tRace * S.script.steps);
    // fire events that happened between the last drawn step and now (skip when jumping far, e.g. rewind)
    if (step > prevStep && step - prevStep < 40) S.script.events.forEach(e => { if (e.s > prevStep && e.s <= step) onHit(S, e); });
    // smoke from damaged cars, tire marks
    S.racers.forEach(r => { const [x, y] = toPx(S, r.x, r.y); const dmg = 1 - r.hp / (S.script.maxHp[r.i] || 3);
      if (!r.out && dmg >= 0.5 && Math.random() < 0.35) K.puff(S, x - Math.cos(r.ang) * S.carW * 0.4, y - Math.sin(r.ang) * S.carW * 0.4, { color: dmg >= 0.99 ? "rgba(60,60,60," : "rgba(120,120,120,", size: 2 + dmg * 4 });
      if (r.out && Math.random() < 0.5) K.puff(S, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, { color: Math.random() < 0.5 ? "rgba(255,120,20," : "rgba(70,70,70,", vy: -1 - Math.random(), size: 3 + Math.random() * 4 });
      if (!r.out && Math.random() < 0.25) S.marks.push({ x, y, a: r.ang });
    });
    if (S.marks.length > 900) S.marks.splice(0, S.marks.length - 900);
    K.stepParticles(S, dt); K.stepConfetti(S);
    if (S.flash && now - S.flash.at > 900) S.flash = null;
  }
  function onHit(S, e) {
    const [x, y] = toPx(S, e.x, e.y);
    for (let i = 0; i < 14; i++) K.puff(S, x, y, { spark: true, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, color: "rgba(255,210,63," });
    if (e.wreck) { for (let i = 0; i < 20; i++) K.puff(S, x, y, { color: "rgba(255,120,20,", vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3, size: 4 + Math.random() * 6 }); K.sfx.boom(); S.flash = { at: performance.now(), text: `${K.short(S.racers[e.victim].name, 14)} WRECKED!`, x, y }; }
    else K.sfx.crash();
  }
  function rewind(S, t) { S.particles = []; S.marks = []; S.flash = null; apply(S, t); }
  function snapToEnd(S) { apply(S, 1); S.over = true; }
  const confetti = (S, epic) => K.confetti(S, epic);

  function draw(S, hudInfo) {
    const { ctx, w, h, cx, cy, rx, ry } = S; ctx.clearRect(0, 0, w, h);
    // grandstand background
    ctx.fillStyle = "#3a2f2a"; ctx.fillRect(0, 0, w, h);
    K.halftone(S, 0.08, 1.3, 9);
    // crowd
    S.crowd.forEach(p => { const x = cx + Math.cos(p.a) * rx * p.r, y = cy + Math.sin(p.a) * ry * p.r; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(x, y + Math.sin(S.time * 4 + p.a * 7) * 1.5, 4, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke(); });
    // dirt oval
    ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.29); ctx.fillStyle = "#b8773a"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.35, ry * 0.35, 0, 0, 6.29); ctx.fill();
    ctx.strokeStyle = "rgba(40,20,10,0.35)"; ctx.lineWidth = 2; S.marks.forEach(m => { ctx.beginPath(); ctx.moveTo(m.x - Math.cos(m.a) * 5, m.y - Math.sin(m.a) * 5); ctx.lineTo(m.x + Math.cos(m.a) * 5, m.y + Math.sin(m.a) * 5); ctx.stroke(); });
    ctx.restore();
    // tire barriers
    S.tires.forEach(a => { const x = cx + Math.cos(a) * rx * 1.0, y = cy + Math.sin(a) * ry * 1.0; ctx.fillStyle = "#1c1c1c"; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.29); ctx.fill(); ctx.strokeStyle = "#444"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.29); ctx.stroke(); });
    // cars: wrecks first, then running, leader-ish last
    const order = [...S.racers].sort((a, b) => (a.out === b.out ? a.y - b.y : a.out ? -1 : 1));
    order.forEach(r => { const [x, y] = toPx(S, r.x, r.y); const img = images[r.spriteId]; const dmg = S.script ? 1 - r.hp / (S.script.maxHp[r.i] || 3) : 0;
      ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(x + 3, y + 4, S.carW * 0.55, S.carW * 0.4, r.ang, 0, 6.29); ctx.fill(); ctx.restore();
      K.drawSprite(ctx, img, x, y, S.carW, { angle: r.ang + Math.PI / 2, gray: r.out, alpha: r.out ? 0.85 : 1 });
      if (!r.out && S.script && dmg > 0) { ctx.fillStyle = "#fff"; ctx.fillRect(x - 14, y - S.carW * 0.75, 28, 5); ctx.fillStyle = dmg < 0.5 ? "#28c8a0" : dmg < 0.99 ? "#ff8a1f" : "#c8102e"; ctx.fillRect(x - 14, y - S.carW * 0.75, 28 * (1 - dmg), 5); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(x - 14, y - S.carW * 0.75, 28, 5); }
    });
    K.drawParticles(S);
    // tags: running cars (all when few), wrecked get OUT
    const tagAll = S.laneCount <= 16;
    S.racers.forEach(r => { const [x, y] = toPx(S, r.x, r.y); if (r.out) { if (tagAll || r.mine) K.tag(ctx, x, y + S.carW * 0.6, "OUT", { size: 10, above: false }); } else if (tagAll || r.mine || S.laneCount - S.racers.filter(q => q.out).length <= 8) K.tag(ctx, x, y - S.carW * 0.8, K.short(r.name, 12), { mine: r.mine, size: S.laneCount > 16 ? 10 : 12 }); });
    if (S.flash) K.sfxText(ctx, K.clamp(S.flash.x, 120, w - 120), K.clamp(S.flash.y - 40, 40, h - 30), S.flash.text, { size: 30, color: "#ff8a1f" });
    K.drawConfetti(S);
    const running = S.racers.filter(r => !r.out).length;
    const standing = [...S.racers].sort((a, b) => b.progress - a.progress);
    K.hud(S, hudInfo, standing, { badge: S.script ? `${running} / ${S.racers.length} STILL RUNNING` : null });
  }
  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, buildScript, placings, rewind, get ready() { return ready; } };
})();
