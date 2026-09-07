/* MIMU Marble Run — a tall plinko board. Marbles drop under gravity, ping off pegs and bumpers,
   get squeezed through funnels, and the first one into the cup wins.
   The physics is a seeded, fixed-step simulation so every screen sees the exact same run; the
   ticket odds come from the float engine's draw (the winner is the marble that lands first). */
window.MarbleRender = (() => {
  const K = window.GameKit, INK = K.INK, E = () => window.FloatzEngine;
  const images = {}; let ready = false;
  const loadSprites = ids => K.loadSprites(ids, images).then(() => { ready = true; });

  const BOARD_W = 520;                 // world width in px (scaled to fit the canvas)
  const FPS = 30; let STEP = 1 / 90;      // stored frame rate / physics step
  const G = 1500, DRAG = 0.0022, REST = 0.62, WALL_REST = 0.55, FRICTION = 0.995;

  function radiusFor(n) { return n <= 8 ? 20 : n <= 20 ? 16 : n <= 40 ? 13 : 11; }

  function buildBoard(worldH, rng, R, count) {
    const pegs = [], funnels = [], rowGap = 64, x0 = 40, x1 = BOARD_W - 40;
    let y = 140, row = 0, sinceFunnel = 0;
    while (y < worldH - 220) {
      if (sinceFunnel >= 5 && rng.next() < 0.6) {   // funnel: two angled bars narrowing to a gap
        const gap = R * 2.6 + rng.next() * R * 1.5 + (count > 30 ? R * 4 : count > 12 ? R * 1.5 : 0), cx = BOARD_W / 2 + (rng.next() - 0.5) * 120;
        funnels.push({ x1: 0, y1: y - 10, x2: cx - gap / 2, y2: y + 64 }, { x1: BOARD_W, y1: y - 10, x2: cx + gap / 2, y2: y + 64 });
        y += 130; sinceFunnel = 0; continue;
      }
      const off = (row % 2) * 30, step = 60;
      for (let x = x0 + off; x <= x1; x += step) {
        if (rng.next() < 0.12) continue;                         // a few missing pegs = lanes open up
        const bump = rng.next() < 0.1;
        pegs.push({ x: x + (rng.next() - 0.5) * 8, y: y + (rng.next() - 0.5) * 6, r: bump ? 15 : 6, bump });
      }
      y += rowGap; row++; sinceFunnel++;
    }
    return { pegs, funnels, worldH };
  }

  function simulate(count, worldH, seed, R, minLen) {
    STEP = count > 30 ? 1 / 60 : 1 / 90;
    const rng = K.rngFor(seed, 0x9a7b1e), board = buildBoard(worldH, rng, R, count);
    // spatial hash for pegs
    const cell = 64, grid = new Map(); const key = (cx, cy) => cx * 10007 + cy;
    board.pegs.forEach((p, i) => { const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = key(cx + dx, cy + dy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
    const m = Array.from({ length: count }, (_, i) => ({ x: 60 + (i / Math.max(1, count - 1)) * (BOARD_W - 120) + (rng.next() - 0.5) * 10, y: 40 + (rng.next() - 0.5) * 20, vx: (rng.next() - 0.5) * 40, vy: 0, release: rng.next() * 1.2, landed: -1, hits: 0, bestY: -1e9, bestT: 0 }));
    const frames = []; const capT = minLen * 1.3 + 25; let t = 0, nextFrame = 0, landedCount = 0;
    const hits = [];   // [frame, marble, x, y] for spark effects
    while (t < capT && (landedCount < count || t < minLen)) {
      // integrate
      for (let i = 0; i < count; i++) { const b = m[i]; if (b.landed >= 0 || t < b.release) continue;
        b.vy += G * STEP; const sp = Math.hypot(b.vx, b.vy); const drag = 1 - DRAG * sp * STEP; b.vx *= drag; b.vy *= drag;
        if (b.y > b.bestY + 30) { b.bestY = b.y; b.bestT = t; } else if (t - b.bestT > 1.1) { const dir = rng.next() < 0.5 ? -1 : 1; b.vx = dir * (180 + rng.next() * 160); b.vy = -(120 + rng.next() * 120); b.bestT = t; }
        b.x += b.vx * STEP; b.y += b.vy * STEP;
        // walls
        if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * WALL_REST; } else if (b.x > BOARD_W - R) { b.x = BOARD_W - R; b.vx = -Math.abs(b.vx) * WALL_REST; }
        // pegs
        const cx = Math.floor(b.x / cell), cy = Math.floor(b.y / cell), list = grid.get(key(cx, cy));
        if (list) for (const pi of list) { const p = board.pegs[pi]; const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), min = R + p.r;
          if (d < min && d > 0.0001) { const nx = dx / d, ny = dy / d; b.x = p.x + nx * min; b.y = p.y + ny * min; const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { const rest = p.bump ? 1.15 : REST; b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; b.vx += (rng.next() - 0.5) * 40; if (Math.abs(vn) > 120) hits.push([frames.length, i, b.x, b.y, p.bump]); b.hits++; } } }
        // funnels (line segments)
        for (const f of board.funnels) { const ex = f.x2 - f.x1, ey = f.y2 - f.y1, len2 = ex * ex + ey * ey; const u = K.clamp(((b.x - f.x1) * ex + (b.y - f.y1) * ey) / len2, 0, 1); const px = f.x1 + ex * u, py = f.y1 + ey * u; const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy), min = R + 6;
          if (d < min && d > 0.0001) { const nx = dx / d, ny = dy / d; b.x = px + nx * min; b.y = py + ny * min; const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= (1 + 0.3) * vn * nx; b.vy -= (1 + 0.3) * vn * ny; } } }
        if (b.y >= worldH - 70) { b.y = worldH - 70; b.landed = t; landedCount++; }
      }
      // marble-marble (cheap, only nearby)
      for (let i = 0; i < count; i++) { const a = m[i]; if (a.landed >= 0 || t < a.release) continue; for (let j = i + 1; j < count; j++) { const c = m[j]; if (c.landed >= 0 || t < c.release) continue; const dx = c.x - a.x, dy = c.y - a.y; if (Math.abs(dx) > R * 2 || Math.abs(dy) > R * 2) continue; const d = Math.hypot(dx, dy); if (d < R * 2 && d > 0.0001) { const nx = dx / d, ny = dy / d, push = (R * 2 - d) / 2; a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push; const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny; if (vn > 0) { a.vx -= vn * nx * 0.7; a.vy -= vn * ny * 0.7; c.vx += vn * nx * 0.7; c.vy += vn * ny * 0.7; } } } }
      t += STEP;
      if (t >= nextFrame) { const fr = new Float32Array(count * 3); for (let i = 0; i < count; i++) { fr[i * 3] = m[i].x; fr[i * 3 + 1] = t < m[i].release ? -40 : m[i].y; fr[i * 3 + 2] = m[i].vx; } frames.push(fr); nextFrame += 1 / FPS; }
    }
    return { board, frames, landed: m.map(b => b.landed), hits, simLen: t };
  }

  function buildScript(p) {
    // desired placings from the float engine (ticket-weighted draw, winner pinned)
    const base = E().buildRace(p); const last = base.trajectories[0].length - 1;
    const want = base.trajectories.map((tr, i) => ({ i, v: i === p.winnerIndex ? 9 : tr[last] })).sort((a, b) => b.v - a.v).map(o => o.i);   // winner first
    const dur = p.durationMs / 1000, R = radiusFor(p.count), count = p.count;
    // size the board so the first landing happens at ~93% of the race; refine twice
    let worldH = 900 + dur * 55, sim = null;
    for (let k = 0; k < 4; k++) {
      sim = simulate(p.count, worldH, p.seed, R, dur);
      const first = Math.min(...sim.landed.filter(v => v >= 0)); if (!isFinite(first)) { worldH *= 0.7; continue; }
      const ratio = (dur * 0.93) / first; if (Math.abs(ratio - 1) < 0.06) break; worldH = Math.max(700, worldH * K.clamp(ratio, 0.5, 2));
    }
    // assign simulated marbles (sorted by landing time / depth) to racers in the wanted order
    const lastFr = sim.frames[sim.frames.length - 1];
    const simOrder = sim.landed.map((t, j) => ({ j, k: t >= 0 ? t : 10000 - lastFr[j * 3 + 1] })).sort((a, b) => a.k - b.k).map(o => o.j);
    const slot = new Array(p.count);            // racer i rides simulated marble slot[i]
    want.forEach((racer, rank) => { slot[racer] = simOrder[rank]; });
    const firstLand = Math.min(...sim.landed.filter(v => v >= 0));
    const timeScale = isFinite(firstLand) ? K.clamp(firstLand / (dur * 0.93), 0.6, 1.6) : 1;   // small playback stretch so the winner drops in at ~93%
    return { ...base, plinko: true, frames: sim.frames, board: sim.board, landed: sim.landed, hits: sim.hits, slot, order: want, dur, timeScale, R, worldH };
  }
  const placings = (l, sc) => sc.order;

  function frameAt(sc, tRace) { const fi = K.clamp(tRace * sc.dur * sc.timeScale * FPS, 0, sc.frames.length - 1); const a = Math.floor(fi), b = Math.min(sc.frames.length - 1, a + 1), u = fi - a; return { a: sc.frames[a], b: sc.frames[b], u, fi }; }
  function posOf(sc, i, tRace) { const { a, b, u } = frameAt(sc, tRace); const j = sc.slot[i]; return { x: K.lerp(a[j * 3], b[j * 3], u), y: K.lerp(a[j * 3 + 1], b[j * 3 + 1], u), vx: a[j * 3 + 2] }; }

  function makeScene(canvas, roster, script, laneCount) {
    const { ctx, w, h } = K.fitCanvas(canvas, 0.72, 460, 720);
    const boardPx = w - 64, scale = boardPx / BOARD_W;
    const worldH = script ? script.worldH : 1200, R = script ? script.R : radiusFor(laneCount);
    const racers = roster.map((r, i) => ({ ...r, i, x: 60 + (i / Math.max(1, laneCount - 1)) * (BOARD_W - 120), y: 40, spin: 0, progress: 0, landed: false }));
    return { ctx, w, h, scale, worldH, R, racers, script, laneCount, cam: 0, time: 0, last: performance.now(), over: false, hitIdx: 0, sparks: [] };
  }
  function apply(S, t) {
    const sc = S.script; if (!sc) return;
    S.racers.forEach(r => { const p = posOf(sc, r.i, t); r.spin += (p.x - r.x) / S.R; r.x = p.x; r.y = p.y; r.progress = p.y / S.worldH; r.landed = sc.landed[sc.slot[r.i]] >= 0 && t * sc.dur * sc.timeScale >= sc.landed[sc.slot[r.i]]; });
  }
  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    if (tRace != null && S.script) {
      const prevFi = S.lastFi ?? 0; apply(S, tRace); const fi = frameAt(S.script, tRace).fi;
      // spark effects for peg hits that happened between the last frame and now
      if (fi > prevFi && fi - prevFi < FPS) { S.script.hits.forEach(([hf, j, x, y, bump]) => { if (hf > prevFi && hf <= fi) { const sx = x * S.scale, sy = y * S.scale - S.cam; for (let k = 0; k < (bump ? 8 : 3); k++) K.puff(S, sx, sy, { spark: true, color: bump ? "rgba(255,138,31," : "rgba(255,210,63,", vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5 }); if (bump && Math.random() < 0.5) K.sfx.bump(); } }); }
      S.lastFi = fi;
    }
    const lead = S.racers.reduce((a, b) => (b.y > a.y ? b : a));
    const targetCam = K.clamp(lead.y * S.scale - S.h * 0.42, 0, S.worldH * S.scale - S.h);
    S.cam += (targetCam - S.cam) * (1 - Math.exp(-dt * 4));
    K.stepParticles(S, dt); K.stepConfetti(S);
  }
  function snapToEnd(S) { apply(S, 1); S.over = true; S.cam = S.worldH * S.scale - S.h; S.lastFi = S.script.frames.length; }
  function rewind(S, t) { apply(S, t); S.lastFi = frameAt(S.script, t).fi; const lead = S.racers.reduce((a, b) => (b.y > a.y ? b : a)); S.cam = K.clamp(lead.y * S.scale - S.h * 0.42, 0, S.worldH * S.scale - S.h); S.particles = []; }
  const confetti = (S, epic) => K.confetti(S, epic);

  function draw(S, hudInfo) {
    const { ctx, w, h, scale } = S; ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#4a2a86"; ctx.fillRect(0, 0, w, h);
    K.halftone(S, 0.08, 1.2, 8);
    const bw = BOARD_W * scale, worldPx = S.worldH * scale;
    ctx.save(); ctx.translate(0, -S.cam);
    // board face + side rails
    ctx.fillStyle = "#6b3fb5"; ctx.fillRect(0, 0, bw, worldPx);
    ctx.fillStyle = "rgba(255,255,255,0.05)"; for (let y = 0; y < worldPx; y += 40) ctx.fillRect(0, y, bw, 2);
    ctx.fillStyle = "#efeee8"; ctx.fillRect(0, 0, 8, worldPx); ctx.fillRect(bw - 8, 0, 8, worldPx); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(0, 0, 8, worldPx); ctx.strokeRect(bw - 8, 0, 8, worldPx);
    // drop zone + cup
    ctx.fillStyle = "#2fa8ff"; ctx.fillRect(8, 0, bw - 16, 24 * scale + 60); ctx.strokeRect(8, 0, bw - 16, 24 * scale + 60);
    K.sfxText(ctx, bw / 2, 42, "DROP ZONE", { size: 22, color: "#fff", rot: 0 });
    const cupY = (S.worldH - 70) * scale;
    ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(8, cupY - 30); ctx.lineTo(bw - 8, cupY - 30); ctx.lineTo(bw - 40, cupY + 60); ctx.lineTo(40, cupY + 60); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff8a1f"; ctx.fillRect(8, cupY + S.R * scale, bw - 16, 16); ctx.strokeRect(8, cupY + S.R * scale, bw - 16, 16);
    K.sfxText(ctx, bw / 2, cupY + 44, "FINISH CUP", { size: 20, color: INK, rot: 0 });
    if (S.script) {
      // funnels
      S.script.board.funnels.forEach(f => { ctx.strokeStyle = INK; ctx.lineWidth = 16 * scale; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(f.x1 * scale, f.y1 * scale); ctx.lineTo(f.x2 * scale, f.y2 * scale); ctx.stroke(); ctx.strokeStyle = "#efeee8"; ctx.lineWidth = 10 * scale; ctx.stroke(); });
      // pegs (only the visible band)
      const y0 = S.cam / scale - 40, y1 = (S.cam + h) / scale + 40;
      S.script.board.pegs.forEach(p => { if (p.y < y0 || p.y > y1) return; const px = p.x * scale, py = p.y * scale, pr = p.r * scale;
        ctx.fillStyle = p.bump ? "#ff8a1f" : "#ffd23f"; ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
        if (p.bump) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, pr * 0.4, 0, 6.29); ctx.fill(); ctx.stroke(); } });
    }
    // marbles, deepest last (front)
    [...S.racers].sort((a, b) => a.y - b.y).forEach(r => { if (r.y < -20) return; const img = images[r.spriteId], x = r.x * scale, y = r.y * scale, R = S.R * scale;
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(x + 3, y + 5, R * 0.95, R * 0.6, 0, 0, 6.29); ctx.fill();
      K.drawSprite(ctx, img, x, y, R * 2, { angle: r.spin, gray: false });
      if (r.mine) { ctx.strokeStyle = "#2fa8ff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, R + 4, 0, 6.29); ctx.stroke(); } });
    ctx.restore();
    K.drawParticles(S);
    // tags in screen space
    const ranked = [...S.racers].sort((a, b) => (S.script ? (S.script.order.indexOf(a.i) - S.script.order.indexOf(b.i)) : 0) || (b.y - a.y)), tagAll = S.laneCount <= 12;
    const liveRank = [...S.racers].sort((a, b) => b.progress - a.progress);
    liveRank.forEach((r, rank) => { const sy = r.y * scale - S.cam; if (sy < -20 || sy > h + 20) return; if (tagAll || rank < 3 || r.mine) K.tag(ctx, r.x * scale, sy - S.R * scale - 4, `#${rank + 1} ${K.short(r.name, 10)}`, { mine: r.mine, size: 11 }); });
    // minimap strip
    const mx = w - 52, my = 14, mh = h - 28;
    ctx.fillStyle = "#3d2377"; ctx.fillRect(mx, my, 40, mh); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(mx, my, 40, mh);
    ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(mx, my + (S.cam / worldPx) * mh, 40, (h / worldPx) * mh);
    S.racers.forEach(r => { const y = my + K.clamp(r.y / S.worldH, 0, 1) * (mh - 6) + 3; ctx.fillStyle = r.mine ? "#2fa8ff" : "#fff"; ctx.beginPath(); ctx.arc(mx + 6 + K.clamp(r.x / BOARD_W, 0, 1) * 28, y, 2.5, 0, 6.29); ctx.fill(); });
    ctx.fillStyle = "#ffd23f"; ctx.fillRect(mx, my + mh - 3, 40, 3);
    K.drawConfetti(S);
    K.hud(S, hudInfo, S.over ? ranked : liveRank, { top: 10, rightPad: 56 });
  }
  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, buildScript, placings, rewind, get ready() { return ready; } };
})();
