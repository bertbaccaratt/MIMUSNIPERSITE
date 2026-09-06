/* 3D depth scene — background layers span hero + games and separate on scroll;
   the hero content tilts toward the mouse and recedes as you scroll. */
(function () {
  const scene = document.getElementById("scene");
  const hero = document.getElementById("hero");
  const content = document.getElementById("heroContent");
  if (!scene || !hero || !content) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layers = [...scene.querySelectorAll(".hero__layer")].map(el => ({ el, depth: parseFloat(el.dataset.depth) || 0.2 }));
  let scrollY = 0, mx = 0, my = 0, tx = 0, ty = 0, raf = null;

  function frame() {
    raf = null;
    const h = (hero.dataset.scroll ? +hero.dataset.scroll : hero.offsetHeight) || 1;
    const p = Math.min(scrollY / h, 1);          // 0 → 1 while the hero scrolls out
    tx += (mx - tx) * 0.08;
    ty += (my - ty) * 0.08;

    layers.forEach(({ el, depth }) => {
      const y = scrollY * depth * 0.55;           // slower than the page = depth
      const x = tx * depth * 40;
      const yy = ty * depth * 30;
      el.style.transform = `translate3d(${x}px, ${y + yy}px, 0)`;
    });

    // hero content: tilts with the mouse, drifts back into the page on scroll
    const rx = (-ty * 10 + p * 22).toFixed(2);
    const ry = (tx * 14).toFixed(2);
    const z = (p * -300).toFixed(1);
    const yShift = (scrollY * 0.25).toFixed(1);
    content.style.transform = `translate3d(0, ${yShift}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    content.style.opacity = String(1 - p * (hero.classList.contains("hero--fz") ? 0.2 : 0.55));
  }
  function tick() { if (!raf) raf = requestAnimationFrame(frame); }

  window.addEventListener("scroll", () => { scrollY = window.scrollY; tick(); }, { passive: true });
  scene.addEventListener("pointermove", e => {
    const r = hero.getBoundingClientRect();
    mx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    my = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    tick();
  });
  scene.addEventListener("pointerleave", () => { mx = 0; my = 0; tick(); });

  (function loop() { if (Math.abs(mx - tx) > 0.001 || Math.abs(my - ty) > 0.001) frame(); requestAnimationFrame(loop); })();
  frame();
})();
