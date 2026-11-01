/* Ядро Stella: сфера из звёзд, реагирует на состояние агента. */
(function (root) {
  const STATES = {
    idle:      { speed: 0.12, energy: 0.0, radius: 1.0,  links: 0.35 },
    thinking:  { speed: 0.85, energy: 0.6, radius: 0.86, links: 0.9 },
    streaming: { speed: 0.45, energy: 1.0, radius: 1.04, links: 0.6 },
    tool:      { speed: 1.25, energy: 0.8, radius: 0.94, links: 0.7 },
    waiting:   { speed: 0.18, energy: 0.3, radius: 1.0,  links: 0.4 },
    error:     { speed: 0.05, energy: 0.2, radius: 1.0,  links: 0.2 }
  };
  const WAIT_COLOR = [242, 181, 68];
  const ERR_COLOR = [240, 106, 106];

  function hex(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  function Orb(canvas, opts) {
    opts = opts || {};
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.n = opts.count || 180;
    this.linksOn = opts.links !== false;
    this.ring = opts.ring !== false;
    this.state = 'idle';
    this.color = hex(opts.color || '#E0875F');
    this.target = this.color.slice();
    this.cur = Object.assign({}, STATES.idle);
    this.angle = Math.random() * 6;
    this.last = performance.now();
    this.pts = [];
    for (let i = 0; i < this.n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.5);
      const s = Math.sqrt(1 - u * u);
      this.pts.push({ x: s * Math.cos(th) * r, y: u * r, z: s * Math.sin(th) * r, size: 0.5 + Math.random() * 1.7, ph: Math.random() * 6.28, tw: 0.5 + Math.random() * 2 });
    }
    this.proj = new Float32Array(this.n * 3);
    this.visible = true;
    const loop = (t) => { if (this.dead) return; this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  Orb.prototype.setColor = function (h) { this.target = hex(h); };
  Orb.prototype.setState = function (s) { this.state = STATES[s] ? s : 'idle'; };
  Orb.prototype.destroy = function () { this.dead = true; };
  Orb.prototype.frame = function (now) {
    const c = this.c, ctx = this.ctx;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) { this.last = now; return; }
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const goal = STATES[this.state];
    const k = Math.min(1, dt * 2.5);
    for (const key of ['speed', 'energy', 'radius', 'links']) this.cur[key] += (goal[key] - this.cur[key]) * k;
    this.color = mix(this.color, this.target, Math.min(1, dt * 3));
    let rgb = this.color;
    const t = now / 1000;
    if (this.state === 'waiting') rgb = mix(rgb, WAIT_COLOR, 0.55 + 0.45 * Math.sin(t * 4));
    if (this.state === 'error') rgb = mix(rgb, ERR_COLOR, 0.85);
    const col = Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]);

    this.angle += this.cur.speed * dt;
    const R = Math.min(w, h) * 0.40 * this.cur.radius;
    const cx = w / 2, cy = h / 2;
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const tilt = 0.38 + Math.sin(t * 0.2) * 0.05, ct = Math.cos(tilt), st = Math.sin(tilt);
    const e = this.cur.energy;

    // свечение ядра
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    g.addColorStop(0, 'rgba(' + col + ',' + (0.16 + e * 0.16) + ')');
    g.addColorStop(0.45, 'rgba(' + col + ',' + (0.05 + e * 0.05) + ')');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // проекция точек
    const P = this.proj;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i];
      const breathe = 1 + Math.sin(t * (1 + e * 3) + p.ph) * (0.012 + e * 0.045);
      let x = p.x * ca - p.z * sa, z = p.x * sa + p.z * ca, y = p.y;
      const y2 = y * ct - z * st; z = y * st + z * ct; y = y2;
      P[i * 3] = cx + x * R * breathe; P[i * 3 + 1] = cy + y * R * breathe; P[i * 3 + 2] = (z + 1) / 2;
    }

    // созвездия
    if (this.linksOn && this.cur.links > 0.05) {
      const maxD = R * 0.28, maxD2 = maxD * maxD;
      ctx.lineWidth = 0.6;
      for (let i = 0; i < this.n; i += 1) {
        const di = P[i * 3 + 2];
        if (di < 0.45) continue;
        for (let j = i + 1; j < this.n; j += 2) {
          const dj = P[j * 3 + 2];
          if (dj < 0.45) continue;
          const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1];
          const d2 = dx * dx + dy * dy;
          if (d2 > maxD2) continue;
          const a = (1 - d2 / maxD2) * 0.22 * this.cur.links * Math.min(di, dj);
          ctx.strokeStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(P[i * 3], P[i * 3 + 1]); ctx.lineTo(P[j * 3], P[j * 3 + 1]); ctx.stroke();
        }
      }
    }

    // звёзды
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i], d = P[i * 3 + 2];
      const twinkle = 0.75 + 0.25 * Math.sin(t * p.tw + p.ph);
      const a = (0.12 + d * 0.88) * twinkle;
      ctx.fillStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(P[i * 3], P[i * 3 + 1], p.size * (0.55 + d * 0.85) * (R > 60 ? 1 : 0.6), 0, 6.283); ctx.fill();
    }

    // орбиты
    if (this.ring) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(' + col + ',0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 7]);
      ctx.beginPath(); ctx.arc(0, 0, R * 1.18, this.angle * 0.25, this.angle * 0.25 + 6.283); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(' + col + ',0.10)';
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.32, R * 0.42, -0.35, 0, 6.283); ctx.stroke();
      // спутники во время работы инструментов и размышлений
      const sat = Math.max(0, Math.min(1, (this.cur.speed - 0.3) / 0.9));
      if (sat > 0.02) {
        for (let s = 0; s < 3; s++) {
          const ang = this.angle * 2.2 + s * 2.094;
          const sx = Math.cos(ang) * R * 1.32, sy = Math.sin(ang) * R * 0.42;
          const rx = sx * Math.cos(-0.35) - sy * Math.sin(-0.35), ry = sx * Math.sin(-0.35) + sy * Math.cos(-0.35);
          ctx.fillStyle = 'rgba(' + col + ',' + (0.9 * sat).toFixed(3) + ')';
          ctx.shadowColor = 'rgba(' + col + ',1)'; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(rx, ry, 2.4, 0, 6.283); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();
    }
  };

  root.StellaOrb = Orb;
})(window);
