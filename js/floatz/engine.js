/* MIMU Floatz race engine — deterministic. Same seed + same roster + same tickets = same race everywhere.
   Ported from the original game.js and extended with ticket boosts. */
window.FloatzEngine = (() => {
  const SPRITES = [
    "wakanda",
    "stoned",
    "jedi",
    "ninja",
    "spiderman",
    "lego",
    "space",
    "rocket",
    "pineapples",
    "crayon",
    "astro",
    "groov",
    "hawk",
    "hoody",
    "inspector",
    "lava",
    "penguin",
    "punk",
    "purple-wizard",
    "zombie",
    "og",
    "arcade",
    "bot",
    "dinooosaur",
    "explorer",
    "moana",
    "painter",
    "pink",
    "red",
    "saturn",
    "sun",
    "sushi",
    "ape",
    "bean-peng",
    "cool-guy",
    "cosmic",
    "dark-cloud",
    "fishing-peng",
    "flower",
    "froggy",
    "pink-froggo",
    "queen",
    "samutea",
    "sludge",
    "black",
    "butterfly",
    "joubrel",
    "smoking-ape",
    "whale",
    "yeloooow",
    "glitcxh",
    "hot-rocket",
    "jester",
    "king",
    "mr-steel",
    "pirate-3",
    "pixie",
    "shinobi",
    "stam-punk",
    "vikeidin",
    "greenmolt",
    "purple",
    "alien",
    "argggggh",
    "bobby",
    "cyborg",
    "luigi",
    "mama-mia",
    "mushy",
    "pharoe",
    "pirate",
    "samurai",
    "super-eggy",
    "viking",
    "wizard-2",
  ];
  const SPRITE_PATH = window.FLOATZ_SPRITE_PATH || "assets/sprites";
  const MAX_RACERS = 75;
  const BOOST_PER_TICKET = 0.25;   // each ticket adds +25% weight in the winner draw
  const MAX_BOOST = 3;             // a racer's weight can't exceed 3x base

  // ---- seeded RNG (xorshift128 seeded from 4 uint32s) ----
  class Rng {
    constructor(seed) { this.s = Uint32Array.from(seed.slice(0, 4)); if (!this.s.some(Boolean)) this.s[0] = 0x9e3779b9; }
    static newSeed() {
      const a = new Uint32Array(4);
      if (window.crypto?.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < 4; i++) a[i] = (Math.random() * 0x100000000) >>> 0;
      return Array.from(a);
    }
    nextUint32() {
      let [x, y, z, w] = this.s; const t = x ^ (x << 11);
      this.s[0] = y; this.s[1] = z; this.s[2] = w;
      w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8)); this.s[3] = w >>> 0; return this.s[3];
    }
    next() { return this.nextUint32() / 0x100000000; }
    nextInt(max) { return max <= 1 ? 0 : Math.floor(this.next() * max); }
    shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = this.nextInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  }

  /** Weighted winner draw. tickets: {racerIndex: count}. Returns {winnerIndex, weights} — weights are published for transparency. */
  function drawWinner(count, tickets, rng) {
    const weights = Array.from({ length: count }, (_, i) => Math.min(MAX_BOOST, 1 + (tickets?.[i] || 0) * BOOST_PER_TICKET));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    for (let i = 0; i < count; i++) { r -= weights[i]; if (r <= 0) return { winnerIndex: i, weights }; }
    return { winnerIndex: count - 1, weights };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  function sampleKeyframes(kf, t) {
    if (t <= kf[0].t) return kf[0].p;
    if (t >= kf[kf.length - 1].t) return kf[kf.length - 1].p;
    for (let i = 0; i < kf.length - 1; i++) if (t >= kf[i].t && t <= kf[i + 1].t) {
      const l = (t - kf[i].t) / (kf[i + 1].t - kf[i].t); return lerp(kf[i].p, kf[i + 1].p, l * l * (3 - 2 * l));
    }
    return kf[kf.length - 1].p;
  }

  function buildKeyframes(start, touch, durationMs, rng, isWinner) {
    const range = touch - start, nearFinish = touch - (isWinner ? 0.012 : 0.04);
    const low = start + range * 0.05, mid = start + range * 0.45;
    const phase = rng.next() * 6.28, kf = [{ t: 0, p: start }];
    const charges = Math.max(5, Math.floor(durationMs / 2600));
    for (let c = 0; c < charges; c++) {
      const ct = 0.04 + ((c / charges) * 0.92 + rng.next() * 0.06 + phase * 0.006) % 0.94;
      kf.push({ t: ct, p: nearFinish - rng.next() * range * (isWinner ? 0.08 : 0.14) });
      const rt = ct + 0.012 + rng.next() * 0.028;
      kf.push({ t: rt, p: low + range * (0.12 + rng.next() * (isWinner ? 0.42 : 0.52)) });
      if (rng.next() < (isWinner ? 0.62 : 0.5)) kf.push({ t: rt + 0.008 + rng.next() * 0.022, p: mid + range * (0.1 + rng.next() * (isWinner ? 0.45 : 0.35)) });
    }
    const swerves = Math.max(8, Math.floor(durationMs / 1800));
    for (let s = 0; s < swerves; s++) kf.push({ t: 0.04 + rng.next() * 0.94, p: low + rng.next() * range * (isWinner ? 0.82 : 0.72) });
    const late = Math.max(4, Math.floor(durationMs / 5000));
    for (let s = 0; s < late; s++) {
      const t0 = 0.78 + (s / late) * 0.19 + rng.next() * 0.015;
      kf.push({ t: t0, p: nearFinish - rng.next() * range * (isWinner ? 0.06 : 0.12) });
      kf.push({ t: t0 + 0.01 + rng.next() * 0.02, p: mid + rng.next() * range * 0.35 });
    }
    kf.sort((a, b) => a.t - b.t);
    const merged = [kf[0]];
    for (let i = 1; i < kf.length; i++) { if (kf[i].t - merged[merged.length - 1].t < 0.01) merged[merged.length - 1].p = kf[i].p; else merged.push(kf[i]); }
    const cap = isWinner ? touch - 0.006 : nearFinish;
    merged.forEach(k => { k.p = Math.max(start, Math.min(cap, k.p)); });
    merged.push({ t: 0.995, p: isWinner ? nearFinish : mid + range * rng.next() * 0.35 });
    return merged;
  }

  function pinPhotoFinish(history, winner, start, touch, steps) {
    const last = steps, snap = Math.max(1, last - 1);
    let leader = winner, leaderPos = history[winner][snap];
    history.forEach((h, i) => { if (h[snap] > leaderPos) { leaderPos = h[snap]; leader = i; } });
    if (leader !== winner) { const swap = history[winner][snap]; history[winner][snap] = leaderPos + 0.004; history[leader][snap] = swap - 0.006; }
    history[winner][last] = touch;
    const others = history.map((h, i) => ({ i, p: h[snap] })).filter(d => d.i !== winner).sort((a, b) => b.p - a.p);
    others.forEach((o, rank) => {
      const gap = 0.045 + rank * 0.012;
      const natural = history[o.i][snap] + (touch - history[winner][snap]) * 0.35;
      history[o.i][last] = Math.max(start, Math.min(natural, touch - gap));
    });
  }

  /** Build the whole race script. Returns {trajectories, steps, laneOrder} */
  function buildRace({ count, winnerIndex, durationMs, seed, start = 0.06, touch = 0.9 }) {
    const rng = new Rng(seed.map(x => x ^ 0x5bd1e995)); // separate stream from the winner draw
    const laneOrder = rng.shuffle(Array.from({ length: count }, (_, i) => i));
    const steps = Math.max(240, Math.floor(durationMs / 100));
    const kfs = Array.from({ length: count }, (_, i) => buildKeyframes(start, touch, durationMs, rng, i === winnerIndex));
    const trajectories = Array.from({ length: count }, () => []);
    for (let s = 0; s <= steps; s++) { const t = s / steps; for (let i = 0; i < count; i++) trajectories[i].push(sampleKeyframes(kfs[i], t)); }
    pinPhotoFinish(trajectories, winnerIndex, start, touch, steps);
    const bob = Array.from({ length: count }, () => rng.next() * Math.PI * 2);
    return { trajectories, steps, laneOrder, bob, start, touch };
  }

  function sample(traj, i, t) {
    const len = traj[0].length, pos = Math.max(0, Math.min(1, t)) * (len - 1), idx = Math.floor(pos), f = pos - idx;
    return lerp(traj[i][idx], traj[i][Math.min(idx + 1, len - 1)], f);
  }
  function speed(traj, i, t) { const dt = 0.004; return (sample(traj, i, Math.min(1, t + dt)) - sample(traj, i, Math.max(0, t - dt))) / (2 * dt); }

  const assetUrl = p => (window.__SPRITE_DATA && window.__SPRITE_DATA[p]) || p;
  const spriteUrl = id => (window.__SPRITE_DATA && window.__SPRITE_DATA[id]) || `${SPRITE_PATH}/${id}.png`;
  return { assetUrl, spriteUrl, SPRITES, SPRITE_PATH, MAX_RACERS, BOOST_PER_TICKET, MAX_BOOST, Rng, drawWinner, buildRace, sample, speed };
})();
