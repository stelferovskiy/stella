/* Главная: система Stella. Агенты — планеты вокруг звезды; светящийся хвост за планетой — остаток
   её лимита (полная орбита — свободна, короткий хвост — почти исчерпана). Справа — список агентов
   с лимитами и совет, с кем начать. Данные о лимитах берутся из app.js (A.limitsFor). */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const ORDER = ['claude', 'codex', 'chatgpt', 'deepseek', 'gemini', 'openrouter'];
  const C = 300, TILT = 0.54, RADII = [112, 145, 178, 211, 244, 277];
  const STAR = '#FFD58A';
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (id) => document.getElementById(id);
  let A = null, svg = null, orb = null, open = false, hot = null, last = 0;
  const bodies = new Map(); // agent -> { g, tail, planet, R, w, a0, rem }
  const start = performance.now();

  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  };

  function init() {
    if (A || !window.StellaApp) return !!A;
    A = window.StellaApp;
    svg = $('orrerySvg');
    // Inner planets move faster (Kepler: period grows as R^1.5); the innermost circles in ~2.5 minutes.
    ORDER.forEach((agent, i) => {
      const R = RADII[i];
      const g = el('g', { class: 'o-agent', 'data-agent': agent }, svg);
      el('ellipse', { class: 'o-track', cx: C, cy: C, rx: R, ry: R * TILT }, g);
      const flat = el('g', { transform: 'translate(' + C + ' ' + C + ') scale(1 ' + TILT + ')' }, g);
      const tail = el('circle', { class: 'o-tail', r: R, pathLength: 100, 'vector-effect': 'non-scaling-stroke', stroke: A.AGENTS[agent].color }, flat);
      const planet = el('g', { class: 'o-planet' }, g);
      el('circle', { class: 'o-halo', r: 17, fill: A.AGENTS[agent].color }, planet);
      el('circle', { class: 'o-body', r: 6.5, fill: A.AGENTS[agent].color, stroke: A.AGENTS[agent].color }, planet);
      const label = el('text', { class: 'o-label', x: 13, y: 5 }, planet);
      label.textContent = A.AGENTS[agent].label;
      g.addEventListener('click', () => choose(agent));
      g.addEventListener('pointerenter', () => setHot(agent));
      g.addEventListener('pointerleave', () => setHot(null));
      bodies.set(agent, { g, tail, planet, R, w: 2.25 * Math.pow(RADII[0] / R, 1.5), a0: 200 + i * 61, rem: 0 });
    });
    orb = new StellaOrb($('orreryStar'), { count: 170, color: STAR, ring: false });
    requestAnimationFrame(loop);
    return true;
  }

  // Planet position and the tail that trails it: the tail ends at the planet and reaches back rem% of the orbit.
  function place(now) {
    const t = still.matches ? 0 : (now - start) / 1000;
    for (const b of bodies.values()) {
      const deg = (b.a0 + b.w * t) % 360, rad = deg * Math.PI / 180;
      b.planet.setAttribute('transform', 'translate(' + (C + b.R * Math.cos(rad)).toFixed(2) + ' ' + (C + b.R * TILT * Math.sin(rad)).toFixed(2) + ')');
      b.tail.setAttribute('transform', 'rotate(' + (deg - b.rem * 3.6).toFixed(2) + ')');
    }
  }
  function loop(now) {
    requestAnimationFrame(loop);
    if (!open || document.hidden || now - last < 33) return;
    if (still.matches && last) return;
    last = now;
    place(now);
  }

  function setHot(agent) {
    hot = agent;
    for (const [a, b] of bodies) b.g.classList.toggle('hot', a === agent);
    document.querySelectorAll('#homeAgents .ha-row').forEach((r) => r.classList.toggle('hot', r.dataset.agent === agent));
  }

  // Not ready: send the user to set it up instead of opening a chat that can only fail.
  function choose(agent) {
    const info = A.limitsFor(agent);
    if (info.kind === 'missing') return A.runAction(agent === 'claude' ? 'install-claude' : 'install-codex');
    if (info.kind === 'nokey') return A.runAction('settings');
    A.chooseAgent(agent);
  }

  const lowest = (info) => (info.windows.length ? Math.min(...info.windows.map((w) => w.remaining)) : null);
  const when = (ms) => (ms ? new Date(ms).toLocaleString(I18N.locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  // Which agent to suggest: the subscription with the most room left; if every subscription is spent,
  // a key-based one (OpenRouter first, it has free models); if limits are not known yet, the usual agent.
  function recommend(infos) {
    const quota = ORDER.filter((a) => infos[a].kind === 'quota' && lowest(infos[a]) > 5);
    if (quota.length) {
      const best = quota.sort((a, b) => lowest(infos[b]) - lowest(infos[a]))[0];
      const w = infos[best].windows.reduce((m, x) => (x.remaining < m.remaining ? x : m));
      return { agent: best, text: L('home.pick.best', { agent: A.AGENTS[best].label, n: Math.round(w.remaining), window: w.label.toLowerCase() }) };
    }
    const usual = A.S.settings.agent;
    const pending = ORDER.filter((a) => infos[a].kind === 'pending');
    if (pending.length) {
      const a = pending.includes(usual) ? usual : pending[0];
      return { agent: a, text: L('home.pick.unknown', { agent: A.AGENTS[a].label }) };
    }
    const keyed = ['openrouter', 'deepseek', 'gemini', 'chatgpt'].filter((a) => infos[a].kind === 'key');
    if (keyed.length) return { agent: keyed[0], text: L(ORDER.some((a) => infos[a].kind === 'quota') ? 'home.pick.spent' : 'home.pick.keyOnly', { agent: A.AGENTS[keyed[0]].label }) };
    return { agent: null, text: L('home.pick.setup') };
  }

  function statusText(agent, info) {
    switch (info.kind) {
      case 'quota': {
        const low = lowest(info);
        if (low <= 3) { const w = info.windows.find((x) => x.remaining <= 3); return L('home.status.spent', { when: when(w && w.resetsAt) || '—' }); }
        return L('home.status.left', { n: Math.round(low) });
      }
      case 'pending': return L('home.status.pending');
      case 'key': return agent === 'openrouter' ? L('home.status.free') : L('home.status.key');
      case 'nokey': return L('home.status.nokey');
      default: return L('home.status.missing');
    }
  }

  function render() {
    if (!init()) return;
    const h = new Date().getHours();
    const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : 'evening';
    $('homeGreeting').textContent = L('home.heading', { greeting: L('home.greet.' + part) });

    const infos = {};
    for (const a of ORDER) infos[a] = A.limitsFor(a);

    // Orbits
    for (const [a, b] of bodies) {
      const info = infos[a];
      const low = lowest(info);
      b.rem = info.kind === 'quota' ? Math.max(0, Math.min(100, low)) : info.kind === 'key' ? 100 : 0;
      b.tail.setAttribute('stroke-dasharray', b.rem.toFixed(1) + ' ' + (100 - b.rem).toFixed(1));
      b.g.setAttribute('class', 'o-agent k-' + info.kind + (info.kind === 'quota' && low <= 3 ? ' spent' : '') + (a === hot ? ' hot' : ''));
    }

    // Suggestion
    const pick = recommend(infos);
    const box = $('homePick');
    box.textContent = '';
    for (const [a, b] of bodies) b.g.classList.toggle('picked', a === pick.agent);
    const p = document.createElement('p'); p.textContent = pick.text; box.append(p);
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'btn accent';
    go.textContent = pick.agent ? L('home.pick.start', { agent: A.AGENTS[pick.agent].label }) : L('home.pick.configure');
    go.addEventListener('click', () => (pick.agent ? choose(pick.agent) : A.runAction('settings')));
    box.append(go);
    if (pick.agent) box.style.setProperty('--pick', A.AGENTS[pick.agent].color);

    // Agent list
    const list = $('homeAgents');
    list.textContent = '';
    for (const a of ORDER) {
      const info = infos[a], ag = A.AGENTS[a];
      const li = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'ha-row k-' + info.kind + (a === hot ? ' hot' : '');
      row.dataset.agent = a;
      row.style.setProperty('--c', ag.color);
      row.innerHTML = '<span class="ha-dot" aria-hidden="true"></span><span class="ha-main"><b></b><small></small></span><span class="ha-gauges"></span>';
      row.querySelector('b').textContent = ag.label;
      const week = info.week && info.week.runs ? ' · ' + L('home.week', { tokens: fmt(info.week.input + info.week.output) }) : '';
      row.querySelector('small').textContent = statusText(a, info) + week;
      const gauges = row.querySelector('.ha-gauges');
      for (const w of info.windows) {
        const g = document.createElement('span');
        g.className = 'ha-gauge' + (w.remaining <= 10 ? ' low' : '');
        g.innerHTML = '<span class="ha-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></span><em></em>';
        g.querySelector('.ha-bar').setAttribute('aria-valuenow', String(Math.round(w.remaining)));
        g.querySelector('.ha-bar').setAttribute('aria-label', ag.label + ' · ' + w.label);
        g.querySelector('i').style.width = w.remaining + '%';
        g.querySelector('em').textContent = plain(w.label) + ' · ' + Math.round(w.remaining) + '%';
        if (w.resetsAt) g.title = L('limits.resets', { when: when(w.resetsAt) });
        gauges.append(g);
      }
      row.addEventListener('click', () => choose(a));
      row.addEventListener('pointerenter', () => setHot(a));
      row.addEventListener('pointerleave', () => setHot(null));
      row.addEventListener('focus', () => setHot(a));
      row.addEventListener('blur', () => setHot(null));
      li.append(row);
      list.append(li);
    }
    place(performance.now());
  }
  // Window names are stored in capitals for the side panel; here they read as plain text.
  const plain = (t) => { t = String(t || '').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
  function fmt(n) { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); }

  window.StellaHome = {
    open() { open = true; last = 0; render(); },
    close() { open = false; },
    refresh() { if (open) render(); }
  };
  // app.js may finish starting before or after this file loads; either way the home screen gets drawn.
  if (window.StellaApp && !$('home').hidden) window.StellaHome.open();
})();
