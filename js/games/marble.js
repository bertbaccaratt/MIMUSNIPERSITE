/* MIMU Marble Run — a winding downhill track with funnels and bumpers. Progress along the track
   comes from the float-race engine (same odds + photo finish); the camera follows the leaders and a
   minimap strip shows the whole pack. */
window.MarbleRender = (() => {
  const K = window.GameKit, INK = K.INK, E = () => window.FloatzEngine;
  const images = {}; let ready = false;
  const loadSprites = ids => K.loadSprites(ids, images).then(() => { ready = true; });

  function buildScript(p) {
    const base = E().buildRace({ ...p, start: 0.02, touch: 0.99 });
    const rng = K.rngFor(p.seed, 0x3a5b1e);
    // lateral wobble per marble (bumper hits), phases fixed by seed
    const wobble = Array.from({ length: p.count }, () => ({ a: rng.next() * 6.283, f: 6 + rng.next() * 6, amp: 0.25 + rng.next() * 0.5 }));
    return { ...base, wobble };
  }

  // track: zig-zag polyline down a tall world, in units of viewport width (x) / height (y)
  function buildTrack(w, worldH) {
    const rows = 7, pts = [], margin = w * 0.14;
    for (let r = 0; r <= rows; r++) { const y = 70 + (worldH - 160) * (r / rows); const x = r % 2 === 0 ? margin : w - margin; pts.push({ x, y }); }
    pts.push({ x: w / 2, y: worldH - 40 });
    // arc length table
    const seg = []; let len = 0;
    for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push({ a: pts[i], b: pts[i + 1], d, at: len }); len += d; }
    const at = u => { const s = u * len; const sg = seg.find(q => s <= q.at + q.d) || seg[seg.length - 1]; const f = K.clamp((s - sg.at) / sg.d, 0, 1); return { x: K.lerp(sg.a.x, sg.b.x, f), y: K.lerp(sg.a.y, sg.b.y, f), nx: -(sg.b.y - sg.a.y) / sg.d, ny: (sg.b.x - sg.a.x) / sg.d }; };
    const pegs = []; for (let u = 0.06; u < 0.96; u += 0.045) { const q = at(u); pegs.push({ x: q.x + q.nx * ((pegs.length % 3) - 1) * 18, y: q.y + q.ny * ((pegs.length % 3) - 1) * 18 }); }
    return { pts, seg, len, at, pegs, worldH };
  }
  function makeScene(canvas, roster, script, laneCount) {
    const { ctx, w, h } = K.fitCanvas(canvas, 0.7, 460, 720);
    const worldH = h * 3.4, track = buildTrack(w - 70, worldH);   // right 70px reserved for the minimap
    const R = laneCount <= 8 ? 24 : laneCount <= 20 ? 19 : laneCount <= 40 ? 15 : 12;
    const racers = roster.map((r, i) => ({ ...r, i, progress: script ? script.start : 0.02, display: script ? script.start : 0.02, spin: 0, x: 0, y: 0 }));
    return { ctx, w, h, worldH, track, R, racers, script, laneCount, cam: 0, time: 0, last: performance.now(), over: false, sparks: [] };
  }
  function place(S, r) {
    const q = S.track.at(K.clamp(r.display, 0, 1)); const wob = S.script ? S.script.wobble[r.i] : { a: 0, f: 0, amp: 0 };
    const off = Math.sin(r.display * 70 * wob.f / 6 + wob.a) * wob.amp * 22 + ((r.i % 5) - 2) * 4;
    r.x = q.x + q.nx * off; r.y = q.y + q.ny * off;
  }
  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    S.racers.forEach(r => {
      if (tRace != null && S.script) { const target = E().sample(S.script.trajectories, r.i, tRace); const diff = target - r.display; r.display += diff * (1 - Math.exp(-dt * 12)); r.progress = r.display; r.spin += diff * S.track.len / S.R; }
      place(S, r);
    });
    const lead = S.racers.reduce((a, b) => (b.display > a.display ? b : a));
    const targetCam = K.clamp(lead.y - S.h * 0.45, 0, S.worldH - S.h);
    S.cam += (targetCam - S.cam) * (1 - Math.exp(-dt * 4));
    if (tRace != null && Math.random() < 0.4) { const r = S.racers[Math.floor(Math.random() * S.racers.length)]; if (Math.abs(E().speed(S.script.trajectories, r.i, tRace)) > 0.02) K.puff(S, r.x, r.y - S.cam, { spark: true, color: "rgba(255,210,63,", vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2 }); }
    K.stepParticles(S, dt); K.stepConfetti(S);
  }
  function snapToEnd(S) { const last = S.script.trajectories[0].length - 1; S.racers.forEach(r => { r.display = r.progress = S.script.trajectories[r.i][last]; place(S, r); }); S.over = true; S.cam = S.worldH - S.h; }
  function rewind(S, t) { S.racers.forEach(r => { r.display = r.progress = E().sample(S.script.trajectories, r.i, t); place(S, r); }); const lead = S.racers.reduce((a, b) => (b.display > a.display ? b : a)); S.cam = K.clamp(lead.y - S.h * 0.45, 0, S.worldH - S.h); }
  const confetti = (S, epic) => K.confetti(S, epic);

  function draw(S, hudInfo) {
    const { ctx, w, h, track } = S; ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#6b3fb5"; ctx.fillRect(0, 0, w, h);
    K.halftone(S, 0.1, 1.2, 8);
    ctx.save(); ctx.translate(0, -S.cam);
    // track tube
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath(); track.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = INK; ctx.lineWidth = S.R * 2 + 34; ctx.stroke();
    ctx.strokeStyle = "#efeee8"; ctx.lineWidth = S.R * 2 + 24; ctx.stroke();
    ctx.strokeStyle = "#d8d5cc"; ctx.lineWidth = S.R * 2 + 6; ctx.stroke();
    // funnels at each turn (narrowing marks) + pegs
    track.pts.slice(1, -1).forEach(p => { ctx.fillStyle = "#ff8a1f"; ctx.beginPath(); ctx.arc(p.x, p.y, S.R + 18, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = "#efeee8"; ctx.beginPath(); ctx.arc(p.x, p.y, S.R + 8, 0, 6.29); ctx.fill(); });
    track.pegs.forEach(p => { ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(); });
    // start gate + cup at the bottom
    const s0 = track.pts[0], e0 = track.pts[track.pts.length - 1];
    ctx.fillStyle = "#2fa8ff"; ctx.fillRect(s0.x - 40, s0.y - S.R - 30, 80, 10); ctx.strokeStyle = INK; ctx.strokeRect(s0.x - 40, s0.y - S.R - 30, 80, 10);
    ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(e0.x - 50, e0.y - 10); ctx.lineTo(e0.x + 50, e0.y - 10); ctx.lineTo(e0.x + 34, e0.y + 40); ctx.lineTo(e0.x - 34, e0.y + 40); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke();
    K.sfxText(ctx, e0.x, e0.y + 62, "FINISH CUP", { size: 18, color: "#fff", rot: 0 });
    // marbles (back → front by progress)
    [...S.racers].sort((a, b) => a.display - b.display).forEach(r => { const img = images[r.spriteId]; ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(r.x + 3, r.y + 5, S.R * 0.9, S.R * 0.5, 0, 0, 6.29); ctx.fill(); K.drawSprite(ctx, img, r.x, r.y, S.R * 2, { angle: r.spin }); });
    ctx.restore();
    K.drawParticles(S);
    // tags in screen space
    const ranked = [...S.racers].sort((a, b) => b.progress - a.progress), tagAll = S.laneCount <= 12;
    ranked.forEach((r, rank) => { const sy = r.y - S.cam; if (sy < -20 || sy > h + 20) return; if (tagAll || rank < 3 || r.mine) K.tag(ctx, r.x, sy - S.R - 4, `#${rank + 1} ${K.short(r.name, 10)}`, { mine: r.mine, size: 11 }); });
    // minimap strip
    const mx = w - 56, my = 14, mh = h - 28;
    ctx.fillStyle = "#3d2377"; ctx.fillRect(mx, my, 44, mh); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(mx, my, 44, mh);
    ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(mx, my + (S.cam / S.worldH) * mh, 44, (h / S.worldH) * mh);
    S.racers.forEach(r => { const y = my + K.clamp(r.display, 0, 1) * (mh - 6) + 3; ctx.fillStyle = r.mine ? "#2fa8ff" : "#fff"; ctx.beginPath(); ctx.arc(mx + 8 + (r.i % 5) * 7, y, 3, 0, 6.29); ctx.fill(); });
    ctx.fillStyle = "#ffd23f"; ctx.fillRect(mx, my + mh - 3, 44, 3);
    K.drawConfetti(S);
    K.hud(S, hudInfo, ranked, { top: 10, rightPad: 60 });
  }
  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, buildScript, rewind, get ready() { return ready; } };
})();
