/* Звёздное небо за всем интерфейсом: три слоя глубины, тихое мерцание и изредка падающая звезда.
   Рисует ~20 кадров в секунду, замирает в свёрнутом окне и при «уменьшении движения» в системе. */
(function () {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Star tints: mostly white-blue, a few warm ones, as on a real night sky.
  const TINTS = [[233, 236, 255], [210, 222, 255], [255, 240, 214], [196, 206, 255], [255, 226, 196]];
  let stars = [], w = 0, h = 0, dpr = 1, last = 0, meteor = null, nextMeteor = 0;

  function seed() {
    w = window.innerWidth; h = window.innerHeight; dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const count = Math.round((w * h) / 4200);
    stars = [];
    for (let i = 0; i < count; i++) {
      const depth = Math.random(); // 0 far, 1 near
      stars.push({
        x: Math.random() * w, y: Math.random() * h,
        r: depth > 0.97 ? 1.5 + Math.random() * 0.8 : 0.35 + depth * 0.9,
        a: 0.18 + depth * 0.62,
        tw: 0.3 + Math.random() * 1.4, ph: Math.random() * 6.283,
        drift: 0.6 + depth * 2.4, // px per minute of slow sky rotation; near stars move more
        tint: TINTS[Math.random() < 0.82 ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3)]
      });
    }
    draw(performance.now());
  }

  function draw(now) {
    const t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const moving = !still.matches;
    for (const s of stars) {
      const x = moving ? (s.x + (t / 60) * s.drift) % w : s.x;
      const twinkle = moving ? 0.72 + 0.28 * Math.sin(t * s.tw + s.ph) : 1;
      ctx.fillStyle = 'rgba(' + s.tint[0] + ',' + s.tint[1] + ',' + s.tint[2] + ',' + (s.a * twinkle).toFixed(3) + ')';
      if (s.r < 0.9) ctx.fillRect(x, s.y, s.r * 1.6, s.r * 1.6);
      else {
        ctx.beginPath(); ctx.arc(x, s.y, s.r, 0, 6.283); ctx.fill();
        if (s.r > 1.4) { // the few bright ones get a soft halo
          const g = ctx.createRadialGradient(x, s.y, 0, x, s.y, s.r * 5);
          g.addColorStop(0, 'rgba(' + s.tint.join(',') + ',' + (0.22 * twinkle).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(' + s.tint.join(',') + ',0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, s.y, s.r * 5, 0, 6.283); ctx.fill();
        }
      }
    }
    if (moving) drawMeteor(now);
  }

  // One shooting star every 25-60 seconds, crossing the upper part of the sky.
  function drawMeteor(now) {
    if (!meteor && now > nextMeteor) {
      if (nextMeteor) meteor = { x: w * (0.2 + Math.random() * 0.7), y: h * Math.random() * 0.35, born: now, len: 120 + Math.random() * 90, ang: 2.55 + Math.random() * 0.35 };
      nextMeteor = now + 25000 + Math.random() * 35000;
    }
    if (!meteor) return;
    const k = (now - meteor.born) / 900;
    if (k >= 1) { meteor = null; return; }
    const dx = Math.cos(meteor.ang), dy = Math.abs(Math.sin(meteor.ang)); // down and to the left
    const hx = meteor.x + dx * k * 260, hy = meteor.y + dy * k * 260;
    const g = ctx.createLinearGradient(hx, hy, hx - dx * meteor.len, hy - dy * meteor.len);
    const a = Math.sin(k * Math.PI);
    g.addColorStop(0, 'rgba(255,246,226,' + (0.85 * a).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,246,226,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - dx * meteor.len, hy - dy * meteor.len); ctx.stroke();
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (still.matches || document.hidden || now - last < 50) return;
    last = now;
    draw(now);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(seed, 120); });
  still.addEventListener('change', () => draw(performance.now()));
  seed();
  requestAnimationFrame(loop);
})();
