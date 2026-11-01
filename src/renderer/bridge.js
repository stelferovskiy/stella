/* «Мостик»: живая визуализация работы всех агентов */
(function () {
  const A = window.StellaApp;
  const api = A.api;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const MAX_LANES = 4;
  const lanes = new Map(); // id -> lane
  let open = false;

  /* ---------- подсветка кода ---------- */
  const KW = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|from|export|default|async|await|new|this|super|try|catch|finally|throw|typeof|instanceof|def|elif|except|lambda|with|as|pass|yield|in|of|not|and|or|is|public|private|protected|static|void|int|float|bool|string|struct|fn|pub|use|mod|impl|match|true|false|null|undefined|None|True|False|self)\b/;
  function hl(src, ext) {
    const hash = /^(py|sh|ps1|yml|yaml|toml|rb|r|conf|ini)$/.test(ext);
    const re = new RegExp(
      '(' + (hash ? '#[^\\n]*|' : '') + '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)|<!--[\\s\\S]*?(?:-->|$))' +
      '|("(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\.|[^`\\\\])*`?)' +
      '|(</?[A-Za-z][\\w-]*|/?>)' +
      '|\\b(\\d+(?:\\.\\d+)?)\\b' +
      '|([A-Za-z_$][\\w$]*)', 'g');
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += '<span class="hl-c">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="hl-s">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="hl-t">' + esc(m[3]) + '</span>';
      else if (m[4]) out += '<span class="hl-n">' + esc(m[4]) + '</span>';
      else if (m[5]) out += KW.test(m[5]) && m[5].length > 1 ? '<span class="hl-k">' + m[5] + '</span>' : esc(m[5]);
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }
  function extOf(p) { const m = String(p || '').match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ''; }

  /* ---------- дорожки ---------- */
  function agentOf(lane) { return A.AGENTS[lane.agent] || A.AGENTS.claude; }
  function makeLane(id, agent, title, kind) {
    if (lanes.has(id)) return lanes.get(id);
    // освобождаем место: убираем самые старые завершённые
    while (lanes.size >= MAX_LANES) {
      const done = [...lanes.values()].filter((l) => l.ended).sort((a, b) => a.ended - b.ended)[0];
      if (!done) break;
      removeLane(done.id);
    }
    const lane = { id, agent, title: title || 'Задача', kind: kind || 'chat', state: 'thinking', started: Date.now(), ended: 0,
      view: 'live', stage: { mode: 'idle' }, text: '', thinking: '', steps: [], preview: null, previewNonce: 0, previewFresh: false, pinned: null, dirty: true };
    lane.el = buildLaneEl(lane);
    $('lanes').append(lane.el);
    lane.orb = new StellaOrb(lane.el.querySelector('.lane-orb'), { count: 46, links: false, ring: false, color: agentOf(lane).color });
    lane.orb.setState('thinking');
    lanes.set(id, lane);
    layout();
    return lane;
  }
  function removeLane(id) {
    const l = lanes.get(id);
    if (!l) return;
    l.orb.destroy();
    if (l.stageOrb) l.stageOrb.destroy();
    l.el.remove();
    lanes.delete(id);
    layout();
  }
  function layout() {
    const n = lanes.size;
    $('lanes').style.setProperty('--cols', n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 2);
    $('bridgeEmpty').hidden = n > 0;
  }

  function buildLaneEl(lane) {
    const a = agentOf(lane);
    const el = document.createElement('section');
    el.className = 'lane';
    el.style.setProperty('--accent', a.color);
    el.style.setProperty('--accent-rgb', a.rgb);
    el.innerHTML =
      '<div class="lane-head"><canvas class="lane-orb" aria-hidden="true"></canvas>' +
      '<div class="lane-id"><div class="lane-name"></div><div class="lane-sub"><span class="lane-state"></span><span class="lane-time"></span></div><div class="lane-title"></div></div>' +
      '<div class="lane-acts">' +
      (lane.kind === 'chat' ? '<button type="button" class="icon-btn ghost lane-x" data-a="stop" aria-label="Остановить агента" title="Остановить"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg></button><button type="button" class="icon-btn ghost lane-x" data-a="open" aria-label="Открыть чат" title="Открыть чат"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg></button>' : '') +
      '<button type="button" class="icon-btn ghost lane-x" data-a="close" aria-label="Убрать дорожку">×</button></div></div>' +
      '<div class="lane-tabs" role="tablist"><button type="button" role="tab" data-v="live" class="on">Живое</button><button type="button" role="tab" data-v="preview" hidden>Превью</button></div>' +
      '<div class="lane-stage"></div>' +
      '<svg class="lane-stars" aria-label="Шаги агента"></svg>';
    el.querySelector('.lane-name').textContent = a.name;
    el.querySelector('.lane-title').textContent = lane.title;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) {
        if (b.dataset.a === 'stop') api.stop(lane.id);
        if (b.dataset.a === 'open') A.openChat(lane.id);
        if (b.dataset.a === 'close') removeLane(lane.id);
        return;
      }
      const t = e.target.closest('[data-v]');
      if (t) { lane.view = t.dataset.v; if (lane.view === 'preview') lane.previewFresh = false; lane.dirty = true; return; }
      const back = e.target.closest('[data-back]');
      if (back) { lane.pinned = null; lane.dirty = true; return; }
      const star = e.target.closest('[data-step]');
      if (star) { lane.pinned = lane.steps[+star.dataset.step] || null; lane.view = 'live'; lane.dirty = true; return; }
      const sc = e.target.closest('[data-studio]');
      if (sc) A.openStudio();
    });
    return el;
  }

  /* ---------- рендер ---------- */
  const STATE = { thinking: 'ДУМАЕТ', streaming: 'ПИШЕТ ОТВЕТ', tool: 'РАБОТАЕТ', waiting: 'ЖДЁТ ПОДТВЕРЖДЕНИЯ', error: 'ОШИБКА', idle: 'ГОТОВО', done: 'ГОТОВО', generating: 'СИНТЕЗ', stopped: 'ОСТАНОВЛЕН' };
  function fmtTime(ms) { const s = Math.max(0, Math.round(ms / 1000)); return (s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : s + ' с'); }

  function renderHead(lane) {
    const h = lane.el;
    const st = h.querySelector('.lane-state');
    st.textContent = STATE[lane.state] || '';
    st.className = 'lane-state ' + lane.state;
    h.querySelector('.lane-title').textContent = lane.title;
    h.querySelector('.lane-time').textContent = fmtTime((lane.ended || Date.now()) - lane.started);
    const stop = h.querySelector('[data-a="stop"]');
    if (stop) stop.hidden = !!lane.ended;
    const pv = h.querySelector('[data-v="preview"]');
    pv.hidden = !lane.preview;
    pv.classList.toggle('fresh', !!lane.previewFresh);
    h.querySelectorAll('[data-v]').forEach((b) => { b.classList.toggle('on', b.dataset.v === lane.view); b.setAttribute('aria-selected', b.dataset.v === lane.view); });
    lane.orb.setState(lane.ended ? (lane.state === 'error' ? 'error' : 'idle') : (lane.state === 'generating' ? 'thinking' : lane.state));
  }

  function renderStars(lane) {
    const svg = lane.el.querySelector('.lane-stars');
    const W = svg.clientWidth || 300, H = 46;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const all = lane.steps;
    const shown = all.slice(-18);
    const off = all.length - shown.length;
    if (!shown.length) { svg.innerHTML = '<text x="12" y="27" class="st-empty">шаги агента появятся здесь</text>'; return; }
    const pts = shown.map((s, i) => [14 + (shown.length === 1 ? 0 : i * (W - 28) / Math.max(shown.length - 1, 1)), 23 + Math.sin((i + off) * 1.7) * 11]);
    let html = '';
    for (let i = 1; i < pts.length; i++) html += '<line x1="' + pts[i - 1][0] + '" y1="' + pts[i - 1][1] + '" x2="' + pts[i][0] + '" y2="' + pts[i][1] + '" class="st-line"/>';
    shown.forEach((s, i) => {
      const cls = 'st-star ' + s.status + (lane.pinned === s ? ' pinned' : '');
      html += '<g data-step="' + (i + off) + '" class="st-g" tabindex="0" role="button" aria-label="' + esc(s.title) + '"><title>' + esc(s.title) + '</title><circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="12" class="st-hit"/><circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + (s.status === 'running' ? 5.5 : 4) + '" class="' + cls + '"/></g>';
    });
    svg.innerHTML = html;
  }

  function codeHtml(st, lane) {
    const ext = extOf(st.path);
    const kind = st.tool === 'Write' ? 'СОЗДАЁТ' : st.tool === 'Edit' ? 'ПРАВИТ' : 'ИЗМЕНИЛ';
    const name = st.path ? A.base(st.path) : '…';
    let body = '';
    let text = st.text || '';
    if (st.replay) {
      const t = st.text, o = st.old || '';
      if (st.pre == null) {
        let p = 0; while (p < t.length && p < o.length && t[p] === o[p]) p++;
        let s = 0; while (s < t.length - p && s < o.length - p && t[t.length - 1 - s] === o[o.length - 1 - s]) s++;
        st.pre = p; st.post = s; st.k = 0;
        st.midLen = t.length - p - s;
        st.speed = Math.max(3, Math.ceil(st.midLen / 150)); // ~2.5 с на анимацию
      }
      const mid = t.slice(st.pre, st.pre + Math.min(st.k, st.midLen));
      const done = st.k >= st.midLen;
      const pre = t.slice(0, st.pre);
      body = hl(pre, ext) + '<span class="ins">' + hl(mid, ext) + '</span>' + (done ? hl(t.slice(t.length - st.post), ext) : '<span class="caret"></span>');
      text = pre + mid + (done ? t.slice(t.length - st.post) : '');
    } else if (st.tool === 'Edit') {
      const oldLines = (st.old || '').split('\n');
      const oldShown = oldLines.slice(0, 14).join('\n') + (oldLines.length > 14 ? '\n…' : '');
      body = '<span class="del">' + esc(oldShown) + '</span>\n<span class="ins">' + hl(text, ext) + '</span>' + (st.done ? '' : '<span class="caret"></span>');
    } else {
      body = hl(text, ext) + (st.done ? '' : '<span class="caret"></span>');
    }
    const lines = (st.tool === 'Edit' ? (st.old || '').split('\n').slice(0, 15).length + text.split('\n').length : text.split('\n').length);
    let ln = '';
    for (let i = 1; i <= lines; i++) ln += i + '\n';
    const count = text.length;
    return '<div class="code-tab"><span class="ct-kind">' + kind + '</span><b>' + esc(name) + '</b><small>' + esc(st.path || '') + '</small><span class="ct-count">' + count + ' симв.</span></div>' +
      '<div class="code-view"><pre class="ln" aria-hidden="true">' + ln + '</pre><pre class="src">' + body + '</pre></div>';
  }

  function renderStage(lane) {
    const box = lane.el.querySelector('.lane-stage');
    const keepScroll = box.querySelector('.code-view, .tv-out, .think');
    const wasBottom = !keepScroll || keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 60;

    if (lane.view === 'preview' && lane.preview) {
      let fr = box.querySelector('iframe, img.pv-img');
      const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(lane.preview);
      const want = A.fileUrl(lane.preview) + '?v=' + lane.previewNonce;
      if (!fr || fr.dataset.src !== want) {
        box.innerHTML = '';
        if (isImg) { fr = document.createElement('img'); fr.className = 'pv-img'; }
        else { fr = document.createElement('iframe'); fr.setAttribute('sandbox', 'allow-scripts allow-forms'); fr.title = 'Превью'; }
        fr.dataset.src = want;
        fr.src = want;
        box.append(fr);
      }
      return;
    }
    if (lane.stageOrb && lane.stage.mode !== 'image-pending') { lane.stageOrb.destroy(); lane.stageOrb = null; }

    let html = '';
    if (lane.pinned) {
      const s = lane.pinned;
      html = '<div class="step-view"><div class="sv-head"><span class="sv-st ' + s.status + '"></span><b>' + esc(s.title) + '</b><button type="button" class="mini-btn" data-back>Вернуться к живому</button></div>' +
        (s.detail ? '<pre>' + esc(s.detail) + '</pre>' : '') + (s.output ? '<pre class="sv-out">' + esc(s.output) + '</pre>' : '') + (!s.detail && !s.output ? '<div class="muted-note">Подробностей нет.</div>' : '') + '</div>';
    } else {
      const st = lane.stage;
      if (st.mode === 'code') html = codeHtml(st, lane);
      else if (st.mode === 'cmd') {
        html = '<div class="term-view"><div class="tv-cmd"><span>❯</span>' + esc(st.command) + (st.done ? '' : '<span class="caret"></span>') + '</div><pre class="tv-out">' + esc(st.output || (st.done ? '' : '…')) + '</pre>' +
          (st.done && st.exitCode != null ? '<div class="tv-exit ' + (st.exitCode === 0 ? 'ok' : 'bad') + '">код выхода ' + st.exitCode + '</div>' : '') + '</div>';
      } else if (st.mode === 'image-pending') {
        if (!box.querySelector('.img-pending')) {
          box.innerHTML = '<div class="img-pending"><canvas aria-hidden="true"></canvas><div class="ip-t"></div><div class="ip-p"></div></div>';
          lane.stageOrb = new StellaOrb(box.querySelector('canvas'), { count: 140, color: agentOf(lane).color });
          lane.stageOrb.setState('thinking');
          box.querySelector('.ip-p').textContent = lane.title;
        }
        box.querySelector('.ip-t').textContent = 'СИНТЕЗ ИЗОБРАЖЕНИЯ · ' + fmtTime(Date.now() - lane.started);
        return;
      } else if (st.mode === 'image') {
        if (!box.querySelector('.img-done')) box.innerHTML = '<div class="img-done"><img alt="" src="' + esc(A.fileUrl(st.file)) + '"></div>';
        return;
      } else if (st.mode === 'image-error') {
        html = '<div class="stage-note err">' + esc(st.error) + (st.setup ? '<div><button type="button" class="btn accent" data-studio>Открыть студию</button></div>' : '') + '</div>';
      } else {
        const t = lane.text || '';
        const th = lane.thinking || '';
        if (t) html = '<div class="think' + (lane.state === 'error' ? ' err' : '') + '"><div class="th-label">' + (lane.state === 'error' ? 'ОШИБКА' : 'ОТВЕТ') + '</div><div class="th-text">' + esc(t.slice(-2500)) + (lane.ended ? '' : '<span class="caret"></span>') + '</div></div>';
        else if (th) html = '<div class="think dim"><div class="th-label">РАЗМЫШЛЯЕТ</div><div class="th-text">' + esc(th.slice(-2000)) + '<span class="caret"></span></div></div>';
        else html = '<div class="stage-note">' + (lane.ended ? 'Готово.' : 'Агент собирается с мыслями…') + '</div>';
      }
    }
    box.innerHTML = html;
    const sc = box.querySelector('.code-view, .tv-out, .think');
    if (sc && wasBottom) {
      const caret = box.querySelector('.caret');
      if (caret && sc.classList.contains('code-view')) sc.scrollTop = Math.max(0, caret.offsetTop - sc.clientHeight * 0.6);
      else sc.scrollTop = sc.scrollHeight;
    }
  }

  function tick() {
    if (open) {
      for (const lane of lanes.values()) {
        const st = lane.stage;
        if (st.mode === 'code' && st.replay && st.pre != null && st.k < st.midLen) { st.k += st.speed; lane.dirty = true; }
        if (!lane.ended || lane.dirty) {
          renderHead(lane);
          if (lane.dirty) { renderStage(lane); renderStars(lane); lane.dirty = false; }
          else if (st.mode === 'image-pending') renderStage(lane);
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  setInterval(() => { if (open) for (const l of lanes.values()) if (!l.ended) renderHead(l); }, 1000);

  /* ---------- события ---------- */
  function chatInfo(id) { return A.S.chats.find((c) => c.id === id); }
  function laneFor(chatId, create) {
    let l = lanes.get(chatId);
    if (!l && create) {
      const c = chatInfo(chatId);
      if (!c) return null;
      l = makeLane(chatId, c.agent, c.title, 'chat');
    }
    return l;
  }

  api.onAgentState(({ chatId, state }) => {
    const running = state !== 'idle' && state !== 'error';
    const l = laneFor(chatId, running);
    if (!l) return;
    if (running) {
      if (l.ended) { l.ended = 0; l.started = Date.now(); l.text = ''; l.thinking = ''; l.stage = { mode: 'idle' }; l.steps = []; l.pinned = null; }
      l.state = state;
    } else { l.state = state === 'error' ? 'error' : 'done'; l.ended = Date.now(); }
    l.dirty = true;
  });
  api.onChatsChanged((c) => { const l = lanes.get(c.id); if (l && l.title !== c.title) { l.title = c.title; l.dirty = true; } });

  api.onChatEvent(({ chatId, ev }) => {
    const l = lanes.get(chatId);
    if (!l) return;
    const live = Date.now() - (l.stageAt || 0) < 1500 && (l.stage.mode === 'code' || l.stage.mode === 'cmd');
    switch (ev.t) {
      case 'text': l.text += ev.text; if (!live) l.stage = { mode: 'think' }; break;
      case 'text-set': l.text = ev.text; if (!live) l.stage = { mode: 'think' }; break;
      case 'thinking': l.thinking += ev.text; if (!live && l.stage.mode === 'idle') l.stage = { mode: 'think' }; break;
      case 'thinking-set': l.thinking = ev.text; break;
      case 'tool': {
        const s = l.steps.find((x) => x.key === ev.id);
        if (s) { s.title = ev.title || s.title; s.detail = ev.detail || s.detail; s.name = ev.name; }
        else l.steps.push({ key: ev.id, name: ev.name, title: ev.title || ev.name, detail: ev.detail || '', output: '', status: 'running' });
        break;
      }
      case 'tool-result': {
        const s = l.steps.find((x) => x.key === ev.id);
        if (s) { s.status = ev.isError ? 'error' : 'done'; s.output = ev.output || ''; }
        break;
      }
      case 'approval': l.steps.push({ key: ev.reqId, name: 'approval', title: 'Ждёт подтверждения: ' + ev.title, detail: ev.detail, output: '', status: 'running' }); break;
      case 'approval-resolved': { const s = l.steps.find((x) => x.key === ev.reqId); if (s) s.status = ev.status === 'denied' ? 'error' : 'done'; break; }
      case 'user-input': l.steps.push({ key: ev.reqId, name: 'question', title: 'Вопрос пользователю', detail: (ev.questions || []).map((q) => q.question).join('\n'), output: '', status: 'running' }); break;
      case 'user-input-resolved': { const s = l.steps.find((x) => x.key === ev.reqId); if (s) s.status = ev.status === 'expired' ? 'error' : 'done'; break; }
      case 'error': l.steps.push({ key: 'err' + Date.now(), name: 'error', title: 'Ошибка', detail: ev.text, output: '', status: 'error' }); l.stage = { mode: 'think' }; if (!l.text) l.text = ev.text; break;
      case 'done': for (const s of l.steps) if (s.status === 'running') s.status = ev.status === 'done' ? 'done' : 'error'; break;
      default: break;
    }
    l.dirty = true;
  });

  api.onLive(({ chatId, ev }) => {
    const l = laneFor(chatId, true);
    if (!l) return;
    if (ev.t === 'tool-start') {
      if (!l.steps.some((x) => x.key === ev.id)) l.steps.push({ key: ev.id, name: ev.name, title: ev.name, detail: '', output: '', status: 'running' });
    } else if (ev.t === 'code') {
      if (ev.replay) {
        // правки Codex проигрываем по очереди
        if (l.stage.mode === 'code' && l.stage.replay && l.stage.k < l.stage.midLen) { (l.queue = l.queue || []).push(ev); }
        else { l.stage = Object.assign({ mode: 'code' }, ev); l.stageAt = Date.now(); }
      } else {
        l.stage = Object.assign({ mode: 'code' }, ev);
        l.stageAt = Date.now();
      }
      if (ev.path && /\.html?$/i.test(ev.path) && ev.done) { l.preview = ev.path; l.previewNonce++; l.previewFresh = l.view !== 'preview'; }
    } else if (ev.t === 'cmd') {
      if (l.stage.mode !== 'cmd' || l.stage.id !== ev.id || ev.output || ev.done) l.stage = Object.assign({ mode: 'cmd' }, l.stage.id === ev.id ? l.stage : {}, ev);
      l.stageAt = Date.now();
    } else if (ev.t === 'result') {
      if (l.stage.mode === 'cmd' && l.stage.id === ev.id) { l.stage.output = ev.output; l.stage.done = true; l.stageAt = Date.now(); }
      else if (l.stage.mode === 'code' && l.stage.id === ev.id) l.stage.done = true;
    } else if (ev.t === 'fs') {
      if (/\.html?$/i.test(ev.path)) { l.preview = ev.path; l.previewNonce++; l.previewFresh = l.view !== 'preview'; }
      else if (/\.(css|js|svg|png|jpe?g|gif|webp)$/i.test(ev.path)) {
        if (l.preview) { l.previewNonce++; l.previewFresh = l.view !== 'preview'; }
        else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(ev.path)) { l.preview = ev.path; l.previewNonce++; l.previewFresh = true; }
      }
    }
    l.dirty = true;
  });

  // очередь проигрывания правок
  setInterval(() => {
    for (const l of lanes.values()) {
      if (l.queue && l.queue.length && !(l.stage.mode === 'code' && l.stage.replay && l.stage.k < l.stage.midLen)) {
        l.stage = Object.assign({ mode: 'code' }, l.queue.shift());
        l.stageAt = Date.now();
        l.dirty = true;
      }
    }
  }, 300);

  /* ---------- запуск задач с мостика ---------- */
  async function launch(text, targets) {
    const settings = A.S.settings;
    for (const agent of targets) {
      if (agent === 'images') { launchStudio(text); continue; }
      const c = await api.createChat({ agent, cwd: settings.currentProject });
      if (!A.S.chats.some((x) => x.id === c.id)) A.S.chats.push({ id: c.id, title: c.title, agent: c.agent, cwd: c.cwd, updated: Date.now() });
      const l = makeLane(c.id, agent, text.length > 60 ? text.slice(0, 58) + '…' : text, 'chat');
      l.dirty = true;
      const mode = agent === 'claude' ? settings.claude.permissionMode : agent === 'codex' ? settings.codex.sandbox : undefined;
      api.send(c.id, { text, attachments: [], mode });
    }
  }
  async function launchStudio(prompt) {
    const id = 'studio-' + Date.now();
    const l = makeLane(id, 'images', prompt, 'studio');
    l.state = 'generating';
    if (!A.cfReady()) {
      l.stage = { mode: 'image-error', error: 'Студия не подключена: нужен бесплатный аккаунт Cloudflare.', setup: true };
      l.state = 'error'; l.ended = Date.now(); l.dirty = true;
      return;
    }
    l.stage = { mode: 'image-pending' };
    l.steps.push({ key: 'g', name: 'gen', title: 'Генерация FLUX', detail: prompt, output: '', status: 'running' });
    l.dirty = true;
    const r = await api.imagesGenerate({ prompt, model: 'schnell', width: 1024, height: 1024, steps: 4, enhance: true });
    l.steps[0].status = r.ok ? 'done' : 'error';
    if (r.ok) { l.stage = { mode: 'image', file: r.item.file }; l.state = 'done'; if (r.item.usedPrompt !== prompt) l.steps[0].output = 'Запрос для модели: ' + r.item.usedPrompt; }
    else { l.stage = { mode: 'image-error', error: r.error, setup: r.code === 'nocreds' }; l.state = 'error'; }
    l.ended = Date.now();
    l.dirty = true;
  }

  const chips = () => [...document.querySelectorAll('#bridgeAgents input:checked')].map((i) => i.value);
  $('bridgeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('bridgeInput').value.trim();
    const targets = chips();
    if (!t) { $('bridgeInput').focus(); return; }
    if (!targets.length) { A.toast('Отметьте хотя бы одного агента.'); return; }
    $('bridgeInput').value = '';
    $('bridgeInput').style.height = '';
    launch(t, targets);
  });
  $('bridgeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('bridgeForm').requestSubmit(); } });
  $('bridgeInput').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; });

  /* ---------- открытие ---------- */
  function openBridge() {
    open = true;
    A.hideViews();
    $('bridge').hidden = false;
    $('bridgeToggle').classList.add('on');
    // подтягиваем уже работающих агентов
    for (const [id, st] of Object.entries(A.S.states)) if (st && st !== 'idle' && st !== 'error') laneFor(id, true);
    for (const l of lanes.values()) l.dirty = true;
    layout();
    $('bridgeInput').focus();
  }
  function closeBridge() { open = false; $('bridgeToggle').classList.remove('on'); }
  A.onViewChange(() => { if (open) closeBridge(); });
  $('bridgeToggle').addEventListener('click', () => { if (open) A.openDraft(); else openBridge(); });
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && !e.shiftKey && e.code === 'KeyB') { e.preventDefault(); if (open) A.openDraft(); else openBridge(); } });
  window.StellaBridge = { open: openBridge, lanes };
})();
