/* Stella — интерфейс */
(async function () {
  const api = window.stella;
  const R = window.StellaReducer;
  const MD = window.StellaMD;
  const $ = (id) => document.getElementById(id);
  const esc = MD.esc;

  const AGENTS = {
    claude: { name: 'CLAUDE', label: 'Claude', sub: L('agent.claude.sub'), color: '#E0875F', rgb: '224,135,95', glow: '#2A1620' },
    codex: { name: 'CODEX', label: 'Codex', sub: L('agent.codex.sub'), color: '#5FB8C9', rgb: '95,184,201', glow: '#0E2329' },
    chatgpt: { name: 'CHATGPT', label: 'ChatGPT', sub: L('agent.chatgpt.sub'), color: '#6FD3A0', rgb: '111,211,160', glow: '#0F241A' },
    images: { name: L('studio.title'), label: L('studio.tab'), sub: 'FLUX · CLOUDFLARE', color: '#A98BFF', rgb: '169,139,255', glow: '#1A1430' }
  };
  const MODES = {
    claude: [['default', L('mode.claude.default')], ['acceptEdits', L('mode.claude.acceptEdits')], ['plan', L('mode.claude.plan')], ['bypassPermissions', L('mode.fullAccess')]],
    codex: [['read-only', L('mode.codex.readOnly')], ['workspace-write', L('mode.codex.workspaceWrite')], ['danger-full-access', L('mode.fullAccess')]]
  };
  const STATE_LABEL = { thinking: L('state.thinking'), streaming: L('state.streaming'), tool: L('state.tool'), waiting: L('state.waiting'), error: L('state.error'), idle: '' };

  const init = await api.init();
  // Язык интерфейса: из настроек; при смене — запоминаем и перезагружаем окно, чтобы перевести всё сразу.
  if (window.I18N && init.settings.language && init.settings.language !== I18N.lang) { I18N.set(init.settings.language); location.reload(); return; }
  const S = {
    settings: init.settings,
    chats: init.chats,
    states: init.states || {},
    usage: init.usage,
    tasks: init.tasks || [],
    env: init.env,
    agent: init.settings.agent || 'claude',
    chat: null,
    attachments: [],
    open: new Set(),
    search: '',
    studio: false,
    gptImages: false
  };
  if (init.env && init.env.version) $('appVersion').textContent = '/ v' + init.env.version;

  /* ---------- утилиты ---------- */
  function toast(text, ms) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    $('toasts').append(d);
    setTimeout(() => d.remove(), ms || 3500);
  }
  function fileUrl(p) {
    const parts = String(p).replace(/\\/g, '/').split('/');
    return 'file:///' + parts.map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/').replace(/^file:\/\/\/\//, 'file:///');
  }
  function base(p) { return String(p).split(/[\\/]/).pop(); }
  function hhmm(t) { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtNum(n) { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); }
  function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  async function saveSettings(patch) {
    const r = await api.saveSettings(patch);
    S.settings = r.settings;
    renderModelSelects();
    return r;
  }

  /* ---------- часы ---------- */
  function tickClock() {
    const d = new Date();
    $('clock').textContent = hhmm(d);
    $('date').textContent = d.toLocaleDateString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'long' });
  }
  setInterval(tickClock, 1000); tickClock();

  /* ---------- ядра ---------- */
  const orbBig = new StellaOrb($('orbBig'), { count: 240 });
  const orbMini = new StellaOrb($('orbMini'), { count: 46, links: false, ring: false });

  function currentState() {
    if (S.chat) return S.states[S.chat.id] || 'idle';
    return 'idle';
  }
  function updateOrbs() {
    const st = currentState();
    orbBig.setState(st); orbMini.setState(st);
    const el = $('chatState');
    el.textContent = STATE_LABEL[st] || '';
    el.className = 'chat-state ' + st;
    const running = S.chat && S.states[S.chat.id] && S.states[S.chat.id] !== 'idle' && S.states[S.chat.id] !== 'error';
    // While the agent works, Send stays: a new message joins the running task.
    $('sendBtn').hidden = false;
    $('sendBtn').setAttribute('aria-label', running ? L('composer.steer') : L('composer.send'));
    $('sendBtn').title = running ? L('composer.steer') : '';
    $('stopBtn').hidden = !running;
    $('input').placeholder = running ? L('composer.placeholderSteer') : isApiChat(viewAgent()) ? L('composer.placeholderChat') : L('composer.placeholderProject');
  }

  /* ---------- тема агента ---------- */
  function viewAgent() { return S.chat ? S.chat.agent : S.agent; }
  function applyTheme() {
    const a = S.gptImages ? { ...AGENTS.chatgpt, name: "GPT IMAGES", sub: "CHATGPT · CODEX" } : S.studio ? AGENTS.images : AGENTS[viewAgent()];
    const root = document.documentElement.style;
    root.setProperty('--accent', a.color);
    root.setProperty('--accent-rgb', a.rgb);
    root.setProperty('--glow', a.glow);
    orbBig.setColor(a.color); orbMini.setColor(a.color);
    document.querySelectorAll('.tab[data-agent]').forEach((b) => b.classList.toggle('on', S.gptImages ? b.dataset.agent === 'gpt-images' : S.studio ? b.dataset.agent === 'images' : b.dataset.agent === viewAgent()));
    if (orbStudio) orbStudio.setColor(AGENTS.images.color);
    $('heroName').textContent = a.name;
    $('heroSub').textContent = a.sub;
    $('input').placeholder = isApiChat(viewAgent()) ? L('composer.placeholderChat') : L('composer.placeholderProject');
    renderModeSelect();
    renderModelSelects();
    renderLimits();
  }
  function renderModeSelect() {
    const agent = viewAgent();
    const sel = $('modeSelect');
    sel.textContent = '';
    if (agent === 'chatgpt' && S.settings.chatgpt.backend === 'api') {
      const o = document.createElement('option');
      o.textContent = S.settings.chatgpt.backend === 'api' ? L('mode.viaApiKey') : L('mode.viaAccount');
      sel.append(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    const cur = agent === 'claude' ? S.settings.claude.permissionMode : (S.settings[agent].sandbox || 'workspace-write');
    for (const [v, l] of MODES[agent === 'chatgpt' ? 'codex' : agent]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l; if (v === cur) o.selected = true;
      sel.append(o);
    }
  }
  $('modeSelect').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (viewAgent() === 'claude') await saveSettings({ claude: Object.assign({}, S.settings.claude, { permissionMode: v }) });
    else { const a = viewAgent(); await saveSettings({ [a]: Object.assign({}, S.settings[a], { sandbox: v }) }); }
    if (v === 'bypassPermissions' || v === 'danger-full-access') toast(L('mode.fullAccessWarning'), 5000);
  });

  /* ---------- модель и уровень размышлений ---------- */
  const EFFORT_OFF = ['', L('effort.auto')];
  const MODEL_AUTO = ['', L('model.auto')];
  const effort = (v) => [v, L('effort.' + v)];
  const MODEL_LISTS = {
    claude: { models: [MODEL_AUTO, ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['opusplan', L('model.opusplan')]],
      efforts: [EFFORT_OFF, effort('low'), effort('medium'), effort('high'), effort('xhigh'), effort('max')] },
    codex: { models: [MODEL_AUTO, ['gpt-5-codex', 'GPT-5 Codex'], ['gpt-5', 'GPT-5'], ['gpt-5-mini', 'GPT-5 mini']],
      efforts: [EFFORT_OFF, effort('minimal'), effort('low'), effort('medium'), effort('high')] },
    chatgpt: { models: [MODEL_AUTO, ['gpt-5', 'GPT-5'], ['gpt-5-mini', 'GPT-5 mini'], ['gpt-4.1', 'GPT-4.1']],
      efforts: [EFFORT_OFF, effort('minimal'), effort('low'), effort('medium'), effort('high')] }
  };
  function modelKey(agent) { return agent === 'chatgpt' && S.settings.chatgpt.backend === 'api' ? 'apiModel' : 'model'; }
  function fillSelect(sel, list, cur) {
    sel.textContent = '';
    const vals = list.map((x) => x[0]);
    const all = cur && !vals.includes(cur) ? list.concat([[cur, cur]]) : list;
    for (const [v, l] of all) { const o = document.createElement('option'); o.value = v; o.textContent = l; if (v === (cur || '')) o.selected = true; sel.append(o); }
  }
  let codexCatalog = null;
  let catalogError = '';
  let codexAccount = null;
  let catalogRequest = 0;
  function isApiChat(agent) { return agent === 'chatgpt' && S.settings.chatgpt.backend === 'api'; }
  function usesCodex(agent) { return agent === 'codex' || (agent === 'chatgpt' && S.settings.chatgpt.backend !== 'api'); }
  async function refreshCodex() {
    const request = ++catalogRequest;
    const results = await Promise.allSettled([api.codexModels(), api.codexAccount()]);
    if (request !== catalogRequest) return;
    if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) {
      codexCatalog = results[0].value; catalogError = '';
    } else { codexCatalog = null; catalogError = L('model.catalogUnavailable'); }
    codexAccount = results[1].status === 'fulfilled' ? Object.assign({ at: Date.now() }, results[1].value) : null;
    renderModelSelects(); renderSys(); renderLimits();
  }
  function renderModelSelects() {
    const agent = viewAgent();
    const ML = MODEL_LISTS[agent];
    if (!ML) return;
    const cfg = S.settings[agent] || {};
    const selected = cfg[modelKey(agent)] || '';
    const dynamic = usesCodex(agent);
    const catalog = codexCatalog || [];
    const models = dynamic ? [MODEL_AUTO].concat(catalog.map((m) => [m.model || m.id, m.displayName || m.model || m.id])) : ML.models;
    const model = selected ? catalog.find((m) => (m.model || m.id) === selected) : catalog.find((m) => m.isDefault) || catalog[0];
    const efforts = dynamic ? [EFFORT_OFF].concat((model && model.supportedReasoningEfforts || []).map((e) => [e.reasoningEffort, L.has('effort.' + e.reasoningEffort) ? L('effort.' + e.reasoningEffort) : e.reasoningEffort])) : ML.efforts;
    fillSelect($('modelSelect'), models, selected);
    fillSelect($('effortSelect'), efforts, cfg.effort || '');
    $('effortSelect').title = model && model.defaultReasoningEffort ? L('effort.autoDefault', { effort: model.defaultReasoningEffort }) : '';
    let warning = $('codexModelWarning');
    if (!warning) {
      warning = document.createElement('div'); warning.id = 'codexModelWarning'; warning.className = 'catalog-warning'; warning.setAttribute('role', 'status');
      $('modelSelect').parentElement.after(warning);
    }
    warning.textContent = '';
    const unsupported = dynamic && codexCatalog !== null && selected && !model;
    const unsupportedEffort = dynamic && codexCatalog !== null && cfg.effort && !efforts.some((e) => e[0] === cfg.effort);
    warning.hidden = !dynamic || (!unsupported && !unsupportedEffort && !catalogError);
    if (!warning.hidden) {
      const note = document.createElement('span');
      note.textContent = catalogError || (unsupported ? L('model.unavailable') : L('effort.unsupported'));
      warning.append(note);
      const auto = document.createElement('button'); auto.type = 'button'; auto.className = 'mini-btn'; auto.textContent = L('common.auto');
      auto.onclick = async () => { await saveSettings({ [agent]: Object.assign({}, S.settings[agent], unsupportedEffort && !unsupported ? { effort: '' } : { [modelKey(agent)]: '', effort: '' }) }); };
      warning.append(auto);
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'mini-btn'; retry.textContent = L('common.refresh'); retry.onclick = refreshCodex; warning.append(retry);
    }
  }
  $('modelSelect').addEventListener('change', async (e) => { const a = viewAgent(); await saveSettings({ [a]: Object.assign({}, S.settings[a], { [modelKey(a)]: e.target.value }) }); });
  $('effortSelect').addEventListener('change', (e) => { const a = viewAgent(); saveSettings({ [a]: Object.assign({}, S.settings[a], { effort: e.target.value }) }); });

  /* ---------- плагины ---------- */
  let plugAgent = 'claude';
  async function openPlugins() {
    const wrap = document.createElement('div');
    wrap.className = 'modal plug-modal';
    wrap.innerHTML = '<div class="modal-box plug-box"><div class="modal-head"><h2 data-i18n="plugins.title"></h2><button type="button" class="icon-btn ghost" id="plugClose" data-i18n-aria="common.close">✕</button></div>' +
      '<div class="plug-tabs"><button type="button" class="tab on" data-pa="claude">Claude Code</button><button type="button" class="tab" data-pa="codex" data-i18n="plugins.codexTab"></button></div>' +
      '<div class="modal-body plug-body"></div></div>';
    I18N.apply(wrap);
    const body = wrap.querySelector('.plug-body');
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#plugClose').addEventListener('click', close);
    document.body.append(wrap);
    let busy = false;
    const act = async (btn, label, fn) => {
      if (busy) return; busy = true;
      btn.textContent = label; btn.disabled = true;
      let r; try { r = await fn(); } catch (e) { r = { ok: false, err: String(e.message || e) }; }
      busy = false;
      if (!r.ok) showAlert({ kind: 'error', title: L('plugins.failed'), text: (r.err || r.out || '').slice(0, 800) });
      else toast(plugAgent === 'claude' ? L('plugins.doneClaude') : L('plugins.done'), 3500);
      await draw();
    };
    async function draw() {
      body.innerHTML = '<div class="muted-note" data-i18n="common.loading"></div>'; I18N.apply(body);
      const st = await api.pluginsState(plugAgent);
      body.textContent = '';
      if (st.error && !(st.installed || st.servers || []).length && !(st.catalog || []).length) {
        const n = document.createElement('div'); n.className = 'err-card'; n.textContent = st.error; body.append(n); return;
      }
      plugAgent === 'claude' ? drawClaude(st) : drawCodex(st);
    }
    function row(title, sub, tag) {
      const r = document.createElement('div'); r.className = 'plug-row';
      r.innerHTML = '<div class="plug-info"><div class="plug-name"></div><div class="plug-desc"></div></div><div class="plug-act"></div>';
      r.querySelector('.plug-name').textContent = title;
      if (tag) { const t = document.createElement('span'); t.className = 'plug-tag'; t.textContent = tag; r.querySelector('.plug-name').append(t); }
      r.querySelector('.plug-desc').textContent = sub || '';
      return r;
    }
    function mkBtn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (cls || ''); b.textContent = text; b.addEventListener('click', () => fn(b)); return b; }
    function drawClaude(st) {
      const bar = document.createElement('div'); bar.className = 'plug-bar';
      bar.innerHTML = '<input class="input" id="plugSearch" autocomplete="off"><div class="plug-filter"><button type="button" class="btn on" data-f="all" data-i18n="plugins.filterAll"></button><button type="button" class="btn" data-f="inst" data-i18n="plugins.filterInstalled"></button></div>';
      I18N.apply(bar);
      bar.querySelector('#plugSearch').placeholder = L('plugins.searchPlaceholder', { n: st.catalog.length });
      body.append(bar);
      const list = document.createElement('div'); list.className = 'plug-list'; body.append(list);
      let filter = 'all';
      const instMap = new Map(st.installed.map((p) => [p.id, p]));
      const render = () => {
        const q = bar.querySelector('#plugSearch').value.trim().toLowerCase();
        list.textContent = '';
        let items = st.catalog.filter((c) => (filter === 'all' || c.installed) && (!q || (c.name + ' ' + c.description + ' ' + c.category + ' ' + c.market).toLowerCase().includes(q)));
        if (filter === 'inst') for (const p of st.installed) if (!st.catalog.some((c) => c.id === p.id) && (!q || p.id.toLowerCase().includes(q))) items.push({ id: p.id, name: p.id.split('@')[0], market: p.id.split('@')[1] || '', description: '', installed: true });
        items.sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name));
        const total = items.length; items = items.slice(0, 60);
        if (!items.length) { const n = document.createElement('div'); n.className = 'muted-note'; n.textContent = L('common.nothingFound'); list.append(n); }
        for (const c of items) {
          const inst = instMap.get(c.id);
          const r = row(c.name, c.description, c.installed ? (inst && !inst.enabled ? L('plugins.tagDisabled') : L('plugins.tagInstalled')) : c.market);
          const a = r.querySelector('.plug-act');
          if (!c.installed) a.append(mkBtn(L('plugins.install'), 'accent', (b) => act(b, L('plugins.installing'), () => api.pluginsAction('claude', 'install', c.id))));
          else {
            a.append(mkBtn(inst && inst.enabled ? L('plugins.disable') : L('plugins.enable'), '', (b) => act(b, '…', () => api.pluginsAction('claude', inst && inst.enabled ? 'disable' : 'enable', c.id))));
            a.append(mkBtn(L('plugins.update'), '', (b) => act(b, L('plugins.updating'), () => api.pluginsAction('claude', 'update', c.id))));
            a.append(mkBtn(L('plugins.remove'), 'danger', (b) => act(b, L('plugins.removing'), () => api.pluginsAction('claude', 'uninstall', c.id))));
          }
          list.append(r);
        }
        if (total > items.length) { const n = document.createElement('div'); n.className = 'muted-note'; n.textContent = L('plugins.showingFirst', { shown: 60, total }); list.append(n); }
      };
      bar.querySelector('#plugSearch').addEventListener('input', render);
      bar.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; bar.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); render(); }));
      render();
      const src = document.createElement('div'); src.className = 'plug-src';
      src.innerHTML = '<h3 data-i18n="plugins.sources"></h3><div class="plug-srcs plug-list"></div><div class="row"><input class="input" id="mkAdd" data-i18n-placeholder="plugins.sourcePlaceholder" autocomplete="off"></div>';
      I18N.apply(src);
      const sl = src.querySelector('.plug-srcs');
      for (const m of st.markets) {
        const r = row(m.name, m.source);
        r.querySelector('.plug-act').append(mkBtn(L('plugins.remove'), 'danger', (b) => act(b, '…', () => api.pluginsAction('claude', 'market-remove', m.name))));
        sl.append(r);
      }
      src.querySelector('.row').append(mkBtn(L('plugins.addSource'), 'accent', (b) => { const v = src.querySelector('#mkAdd').value.trim(); if (v) act(b, L('plugins.adding'), () => api.pluginsAction('claude', 'market-add', v)); }));
      src.querySelector('.row').append(mkBtn(L('plugins.refreshCatalogs'), '', (b) => act(b, L('plugins.refreshing'), () => api.pluginsAction('claude', 'market-update', ''))));
      body.append(src);
    }
    function drawCodex(st) {
      const hint = document.createElement('div'); hint.className = 'muted-note';
      hint.textContent = L('plugins.codexHint');
      body.append(hint);
      const list = document.createElement('div'); list.className = 'plug-list'; body.append(list);
      if (!st.servers.length) { const n = document.createElement('div'); n.className = 'muted-note'; n.textContent = L('plugins.noMcp'); list.append(n); }
      for (const s of st.servers) {
        const r = row(s.name, s.detail || s.transport, s.enabled ? '' : L('plugins.tagDisabled'));
        r.querySelector('.plug-act').append(mkBtn(L('plugins.remove'), 'danger', (b) => act(b, '…', () => api.pluginsAction('codex', 'remove', { name: s.name }))));
        list.append(r);
      }
      const f = document.createElement('div'); f.className = 'plug-src';
      f.innerHTML = '<h3 data-i18n="plugins.addMcp"></h3><div class="row"><input class="input" id="mcpName" data-i18n-placeholder="plugins.mcpName" autocomplete="off" style="max-width:160px"><input class="input" id="mcpCmd" data-i18n-placeholder="plugins.mcpCommand" autocomplete="off"></div>';
      I18N.apply(f);
      f.querySelector('.row').append(mkBtn(L('common.add'), 'accent', (b) => {
        const name = f.querySelector('#mcpName').value.trim(), v = f.querySelector('#mcpCmd').value.trim();
        if (!name || !v) { toast(L('plugins.mcpRequired')); return; }
        act(b, L('plugins.adding'), () => api.pluginsAction('codex', 'add', /^https?:\/\//i.test(v) ? { name, url: v } : { name, command: v }));
      }));
      body.append(f);
    }
    wrap.querySelectorAll('[data-pa]').forEach((b) => b.addEventListener('click', () => { plugAgent = b.dataset.pa; wrap.querySelectorAll('[data-pa]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    plugAgent = viewAgent() === 'codex' ? 'codex' : 'claude';
    wrap.querySelectorAll('[data-pa]').forEach((x) => x.classList.toggle('on', x.dataset.pa === plugAgent));
    draw();
  }
  $('openPlugins').addEventListener('click', openPlugins);

  document.querySelectorAll('.tab[data-agent]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.agent === 'gpt-images') { window.StellaGptImages?.open(); return; }
    if (b.dataset.agent === 'images') { openStudio(); return; }
    if (S.studio || S.gptImages) { S.studio = false; S.gptImages = false; S.agent = b.dataset.agent; saveSettings({ agent: S.agent }); openDraft(); return; }
    S.agent = b.dataset.agent;
    saveSettings({ agent: S.agent });
    if (S.chat && S.chat.agent !== S.agent) openDraft();
    else applyTheme();
    $('input').focus();
  }));

  /* ---------- проекты ---------- */
  function renderProject() {
    const p = S.settings.currentProject;
    $('projName').textContent = base(p) || p;
    $('projPath').textContent = p;
  }
  function closeProjMenu() { $('projMenu').hidden = true; $('projBtn').setAttribute('aria-expanded', 'false'); }
  $('projBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = $('projMenu');
    if (!m.hidden) return closeProjMenu();
    m.textContent = '';
    for (const p of S.settings.projects) {
      const b = document.createElement('button');
      b.type = 'button';
      if (p === S.settings.currentProject) b.className = 'on';
      b.innerHTML = '<span></span><small></small>';
      b.firstChild.textContent = base(p) || p;
      b.lastChild.textContent = p;
      b.addEventListener('click', async () => { await saveSettings({ currentProject: p }); renderProject(); renderChatList(); closeProjMenu(); if (!S.chat || !S.chat.messages.length) openDraft(); });
      m.append(b);
    }
    const sep = document.createElement('div'); sep.className = 'sep'; m.append(sep);
    const add = document.createElement('button');
    add.type = 'button';
    add.innerHTML = '<span data-i18n="project.add"></span>'; I18N.apply(add);
    add.addEventListener('click', async () => { closeProjMenu(); const s = await api.pickProject(); if (s) { S.settings = s; renderProject(); renderChatList(); openDraft(); } });
    m.append(add);
    if (S.settings.projects.length > 1) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.innerHTML = '<span data-i18n="project.remove"></span>'; I18N.apply(rm);
      rm.addEventListener('click', async () => {
        const projects = S.settings.projects.filter((x) => x !== S.settings.currentProject);
        await saveSettings({ projects, currentProject: projects[0] });
        renderProject(); renderChatList(); closeProjMenu(); openDraft();
      });
      m.append(rm);
    }
    const lab = document.createElement('label');
    lab.innerHTML = '<input type="checkbox"> <span data-i18n="project.showAll"></span>'; I18N.apply(lab);
    lab.firstChild.checked = !!S.settings.showAllProjects;
    lab.firstChild.addEventListener('change', async (ev) => { await saveSettings({ showAllProjects: ev.target.checked }); renderChatList(); });
    m.append(lab);
    m.hidden = false;
    $('projBtn').setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', (e) => { if (!$('projMenu').hidden && !e.target.closest('.proj')) closeProjMenu(); });

  /* ---------- список чатов ---------- */
  function groupOf(t) {
    const d = new Date(t), now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (t >= start) return L('group.today');
    if (t >= start - 86400000) return L('group.yesterday');
    if (t >= start - 6 * 86400000) return L('group.week');
    return L('group.earlier');
  }
  function renderChatList() {
    const list = $('chatList');
    list.textContent = '';
    const q = S.search.trim().toLowerCase();
    const items = S.chats
      .filter((c) => S.settings.showAllProjects || q || c.cwd === S.settings.currentProject || isApiChat(c.agent))
      .filter((c) => !q || (c.title + ' ' + (c.snippet || '')).toLowerCase().includes(q))
      .sort((a, b) => b.updated - a.updated);
    if (!items.length) {
      const d = document.createElement('div');
      d.className = 'empty-list';
      d.textContent = q ? L('common.nothingFound') : L('side.emptyChats');
      list.append(d);
      return;
    }
    let lastGroup = '';
    for (const c of items) {
      const g = groupOf(c.updated);
      if (g !== lastGroup) {
        const gl = document.createElement('div'); gl.className = 'group-label'; gl.textContent = g; list.append(gl); lastGroup = g;
      }
      const row = document.createElement('div');
      row.className = 'chat-item' + (S.chat && S.chat.id === c.id ? ' on' : '');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const st = S.states[c.id];
      const running = st && st !== 'idle' && st !== 'error';
      row.innerHTML = '<span class="dot' + (running ? ' running' : '') + '"></span><span class="ci-text"><span class="ci-title"></span><span class="ci-sub"></span></span><button type="button" class="ci-del">×</button>';
      row.querySelector('.ci-del').setAttribute('aria-label', L('chat.delete'));
      row.querySelector('.dot').style.background = st === 'waiting' ? 'var(--warn)' : AGENTS[c.agent].color;
      row.querySelector('.ci-title').textContent = c.title;
      row.querySelector('.ci-sub').textContent = AGENTS[c.agent].label + ' · ' + hhmm(c.updated) + (S.settings.showAllProjects && !isApiChat(c.agent) ? ' · ' + base(c.cwd) : '');
      row.addEventListener('click', (e) => { if (!e.target.closest('.ci-del')) openChat(c.id); });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openChat(c.id); });
      const del = row.querySelector('.ci-del');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm'); del.textContent = L('chat.deleteConfirm');
          setTimeout(() => { del.classList.remove('confirm'); del.textContent = '×'; }, 3000);
          return;
        }
        S.chats = await api.deleteChat(c.id);
        if (S.chat && S.chat.id === c.id) openDraft();
        renderChatList();
      });
      list.append(row);
    }
  }
  $('search').addEventListener('input', (e) => { S.search = e.target.value; renderChatList(); });

  /* ---------- открытие чатов ---------- */
  const viewListeners = [];
  function viewChanged() { $('bridge').hidden = true; viewListeners.forEach((f) => f()); }
  function hideViews() { $('hero').hidden = true; $('chatView').hidden = true; $('composer').hidden = true; $('studio').hidden = true; $('gptImages').hidden = true; }
  function showHero(on) {
    viewChanged();
    $('gptImages').hidden = true;
    $('studio').hidden = true;
    $('composer').hidden = false;
    $('hero').hidden = !on;
    $('chatView').hidden = on;
  }
  let chatNavigation = 0;
  function clearInputForms() {
    $('messages').querySelectorAll('[data-input-req]').forEach((form) => form.reset());
  }
  function openDraft() {
    ++chatNavigation;
    clearInputForms();
    $('messages').textContent = '';
    S.studio = false;
    S.gptImages = false;
    S.chat = null;
    S.attachments = [];
    renderAttachments();
    applyTheme();
    showHero(true);
    renderSkills();
    renderChatList();
    renderFiles();
    updateOrbs();
    $('input').focus();
  }
  async function openChat(id) {
    const navigation = ++chatNavigation;
    const c = await api.getChat(id);
    if (!c || navigation !== chatNavigation) return;
    clearInputForms();
    S.studio = false;
    S.gptImages = false;
    S.chat = c;
    S.agent = c.agent;
    applyTheme();
    showHero(false);
    $('chatTitle').textContent = c.title;
    $('chatAgent').textContent = AGENTS[c.agent].label.toUpperCase();
    $('chatCwd').textContent = isApiChat(c.agent) ? '' : c.cwd;
    renderMessages(true);
    renderChatList();
    renderFiles();
    updateOrbs();
    $('input').focus();
  }
  $('newChat').addEventListener('click', openDraft);

  // переименование
  $('chatTitle').addEventListener('click', () => {
    const t = $('chatTitle');
    if (!S.chat || t.isContentEditable) return;
    t.contentEditable = 'true';
    t.focus();
    document.getSelection().selectAllChildren(t);
  });
  $('chatTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.target.textContent = S.chat.title; e.target.blur(); }
  });
  $('chatTitle').addEventListener('blur', async () => {
    const t = $('chatTitle');
    t.contentEditable = 'false';
    const v = t.textContent.trim();
    if (S.chat && v && v !== S.chat.title) { S.chat.title = v; await api.renameChat(S.chat.id, v); }
    else if (S.chat) t.textContent = S.chat.title;
  });

  /* ---------- навыки ---------- */
  // Built-in skills and directives are shown in the interface language until the user edits them.
  function skillText(s) { return s.builtin ? Object.assign({}, s, { label: L('skill.' + s.builtin + '.label'), prompt: L('skill.' + s.builtin + '.prompt') }) : s; }
  function directiveText(d) { return d.builtin ? L('directive.' + d.builtin) : d.text; }
  function renderSkills() {
    const box = $('skills');
    box.textContent = '';
    const skills = isApiChat(viewAgent())
      ? [{ label: L('chatSkill.explain'), prompt: L('chatSkill.explain.prompt') + ' ' }, { label: L('chatSkill.improve'), prompt: L('chatSkill.improve.prompt') + '\n\n' }, { label: L('chatSkill.translate'), prompt: L('chatSkill.translate.prompt') + '\n\n' }, { label: L('chatSkill.ideas'), prompt: L('chatSkill.ideas.prompt') + ' ' }]
      : (S.settings.skills || []).map(skillText);
    for (const s of skills) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'skill'; b.textContent = s.label; b.title = s.prompt;
      b.addEventListener('click', () => {
        const pr = s.prompt;
        if (/[:\s]$/.test(s.prompt)) { $('input').value = pr; autosize(); $('input').focus(); }
        else submit(pr);
      });
      box.append(b);
    }
  }

  /* ---------- сообщения ---------- */
  const TOOL_ICONS = {
    Bash: 'M4 17l6-6-6-6M12 19h8', Shell: 'M4 17l6-6-6-6M12 19h8', PowerShell: 'M4 17l6-6-6-6M12 19h8',
    Read: 'M4 4h12l4 4v12H4zM8 12h8M8 16h6', Write: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    Edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', MultiEdit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', Files: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    Glob: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', Grep: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
    WebSearch: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', WebFetch: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18',
    TodoWrite: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', Plan: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'
  };
  const DEFAULT_ICON = 'M12 3l8 4.5v9L12 21l-8-4.5v-9z';
  const ST_LABEL = { running: L('toolState.running'), done: L('toolState.done'), error: L('state.error') };
  const ACTION_LABEL = { 'install-sdk': L('action.installSdk'), 'login-claude': L('action.loginClaude'), 'login-codex': L('action.loginCodex'), 'install-claude': L('action.installClaude'), 'install-codex': L('action.installCodex'), settings: L('action.openSettings') };

  function renderUser(m) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.dataset.id = m.id;
    if (m.attachments && m.attachments.length) {
      const atts = document.createElement('div');
      atts.className = 'atts';
      for (const a of m.attachments) {
        if (a.kind === 'image') {
          const img = document.createElement('img');
          img.className = 'att-thumb'; img.src = fileUrl(a.path); img.alt = a.name;
          img.addEventListener('click', () => openPreview(a.path));
          atts.append(img);
        } else {
          const ch = document.createElement('button');
          ch.type = 'button'; ch.className = 'att-chip';
          ch.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H6v18h12V7z"/></svg><span></span>';
          ch.lastChild.textContent = a.name;
          ch.addEventListener('click', () => openPreview(a.path));
          atts.append(ch);
        }
      }
      el.append(atts);
    }
    if (m.text) {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = m.text;
      el.append(b);
    }
    return el;
  }

  function blockHtml(b, msg) {
    if (b.type === 'text') return '<div class="md">' + MD.render(b.text) + '</div>';
    if (b.type === 'thinking') {
      const k = msg.id + ':' + (b.key || 'th');
      return '<details class="thinking" data-open="' + esc(k) + '"' + (S.open.has(k) ? ' open' : '') + '><summary>' + L('msg.thinking') + '</summary><div class="th-body">' + esc(b.text) + '</div></details>';
    }
    if (b.type === 'tool') {
      const k = msg.id + ':' + b.key;
      const ico = TOOL_ICONS[b.name] || DEFAULT_ICON;
      return '<details class="tool ' + b.status + '" data-open="' + esc(k) + '"' + (S.open.has(k) ? ' open' : '') + '><summary><span class="t-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="' + ico + '"/></svg></span><span class="t-title">' + esc(b.title || b.name) + '</span><span class="t-st">' + (ST_LABEL[b.status] || '') + '</span></summary><div class="t-body">' +
        (b.detail ? '<pre>' + esc(b.detail) + '</pre>' : '') + (b.output ? '<pre>' + esc(b.output) + '</pre>' : '') + (!b.detail && !b.output ? '<div class="muted-note">' + L('msg.noDetails') + '</div>' : '') + '</div></details>';
    }
    if (b.type === 'user-input') {
      if (b.status !== 'pending' || msg.status !== 'running') return '<div class="approval resolved">' + (b.status === 'resolved' ? L('input.sent') : L('approval.expired')) + '</div>';
      return '<form class="approval input-request" data-input-req="' + esc(b.key) + '" data-input-chat="' + esc(S.chat.id) + '" data-input-msg="' + esc(msg.id) + '">' + (b.questions || []).map((q, i) => {
        const options = q.isSecret ? [] : (q.options || []);
        return '<fieldset data-question="' + i + '"><legend>' + esc(q.header || q.question) + '</legend><p>' + esc(q.question) + '</p>' + options.map((o, j) => '<label class="input-option"><input type="radio" name="q' + i + '" value="' + j + '"><span>' + esc(o.label) + (o.description ? '<small>' + esc(o.description) + '</small>' : '') + '</span></label>').join('') +
          (options.length && q.isOther ? '<label class="input-option"><input type="radio" name="q' + i + '" value="other">' + L('input.other') + '</label>' : '') +
          (!options.length || q.isOther ? '<input class="input" data-free type="' + (q.isSecret ? 'password' : 'text') + '" autocomplete="off" aria-label="' + esc(q.question) + '">' : '') + '</fieldset>';
      }).join('') + '<button class="btn accent" type="submit">' + L('input.submit') + '</button><div class="input-error" role="alert"></div></form>';
    }
    if (b.type === 'approval') {
      const pending = b.status === 'pending';
      const st = { allowed: L('approval.allowed'), always: L('approval.allowedSession'), denied: L('approval.denied'), expired: L('approval.expired') }[b.status] || '';
      return '<div class="approval' + (pending ? '' : ' resolved') + '"><div class="ap-title">' + esc(b.title) + '</div>' + (b.detail ? '<pre>' + esc(b.detail) + '</pre>' : '') +
        (pending ? '<div class="ap-actions"><button type="button" class="btn accent" data-ap="allow" data-req="' + esc(b.key) + '">' + L('approval.allow') + '</button><button type="button" class="btn" data-ap="always" data-req="' + esc(b.key) + '">' + L('approval.always') + '</button><button type="button" class="btn danger" data-ap="deny" data-req="' + esc(b.key) + '">' + L('approval.deny') + '</button></div>' : '<div class="ap-status">' + st + '</div>') + '</div>';
    }
    if (b.type === 'steer') {
      return '<div class="steer-note"><span class="steer-label">' + L('msg.steer') + '</span>' + esc(b.text) + '</div>';
    }
    if (b.type === 'error') {
      return '<div class="err-card">' + esc(b.text) + (b.action && ACTION_LABEL[b.action] ? '<div><button type="button" class="btn accent" data-action="' + esc(b.action) + '">' + ACTION_LABEL[b.action] + '</button></div>' : '') + '</div>';
    }
    return '';
  }

  function renderAi(m) {
    const el = document.createElement('div');
    el.className = 'msg ai';
    el.dataset.id = m.id;
    fillAi(el, m);
    return el;
  }
  function fillAi(el, m) {
    const a = AGENTS[m.agent] || AGENTS.claude;
    let html = '<div class="ai-head"><i style="background:' + a.color + ';color:' + a.color + '"></i>' + a.name + ' <time>' + hhmm(m.time) + '</time></div>';
    html += m.blocks.map((b) => blockHtml(b, m)).join('');
    if (m.status === 'running' && !m.blocks.some((b) => b.type === 'text')) html += '<div class="typing" aria-label="' + esc(L('msg.working')) + '"><i></i><i></i><i></i></div>';
    if (m.status === 'stopped') html += '<div class="stopped-note">' + L('msg.stopped') + '</div>';
    if (m.status !== 'running') {
      const u = m.usage;
      html += '<div class="ai-foot"><button type="button" class="mini-btn" data-copy="1">' + L('common.copy') + '</button>' +
        (u ? '<span class="meta">' + L('msg.usage', { input: fmtNum(u.input), output: fmtNum(u.output) }) + (u.cost ? ' · $' + u.cost.toFixed(3) : '') + '</span>' : '') + '</div>';
    }
    const forms = [...el.querySelectorAll('[data-input-req]')];
    const focused = document.activeElement;
    const selection = focused && focused.tagName === 'INPUT' ? [focused.selectionStart, focused.selectionEnd] : null;
    el.innerHTML = html;
    for (const form of forms) {
      const replacement = [...el.querySelectorAll('[data-input-req]')].find((n) => n.dataset.inputReq === form.dataset.inputReq && n.dataset.inputChat === form.dataset.inputChat && n.dataset.inputMsg === form.dataset.inputMsg);
      if (replacement) { replacement.replaceWith(form); if (form.contains(focused)) { focused.focus(); if (selection && selection[0] != null) focused.setSelectionRange(...selection); } }
      else form.reset();
    }
    el.querySelectorAll('[data-input-req]').forEach((form) => {
      const pending = inputSends.has(JSON.stringify([form.dataset.inputChat, form.dataset.inputMsg, form.dataset.inputReq]));
      form.querySelectorAll('input, button').forEach((n) => { n.disabled = pending; });
    });
  }

  function nearBottom() { const m = $('messages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 140; }
  function toBottom() { const m = $('messages'); m.scrollTop = m.scrollHeight; }

  function renderMessages(scroll) {
    const box = $('messages');
    box.textContent = '';
    if (!S.chat) return;
    for (const m of S.chat.messages) box.append(m.role === 'user' ? renderUser(m) : renderAi(m));
    if (!S.chat.messages.length) showHero(true);
    if (scroll) requestAnimationFrame(toBottom);
  }

  const dirty = new Set();
  let raf = 0;
  function scheduleUpdate(msgId) {
    dirty.add(msgId);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const stick = nearBottom();
      for (const id of dirty) {
        const m = S.chat && S.chat.messages.find((x) => x.id === id);
        const el = $('messages').querySelector('.msg[data-id="' + id + '"]');
        if (m && el) fillAi(el, m);
      }
      dirty.clear();
      if (stick) toBottom();
    });
  }

  // запоминаем раскрытые блоки
  $('messages').addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset && d.dataset.open) { if (d.open) S.open.add(d.dataset.open); else S.open.delete(d.dataset.open); }
  }, true);

  const inputSends = new Set();
  $('messages').addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-input-req]');
    if (!form) return;
    e.preventDefault();
    const chat = S.chat;
    const message = chat && String(chat.id) === form.dataset.inputChat && chat.messages.find((m) => String(m.id) === form.dataset.inputMsg);
    const block = message && message.blocks.find((b) => b.type === 'user-input' && String(b.key) === form.dataset.inputReq);
    const key = chat && JSON.stringify([String(chat.id), String(message && message.id), form.dataset.inputReq]);
    if (!block || block.status !== 'pending' || message.status !== 'running' || inputSends.has(key)) return;
    const answers = Object.create(null);
    for (const [i, q] of block.questions.entries()) {
      const field = form.querySelector('[data-question="' + i + '"]');
      const option = field.querySelector('input[type=radio]:checked');
      const free = field.querySelector('[data-free]');
      const value = option && option.value !== 'other' ? q.options[Number(option.value)].label : free && (!q.options || !q.options.length || q.isSecret || option) ? free.value : '';
      if (!value || !value.trim()) {
        if (q.required === false) continue;
        form.querySelector('.input-error').textContent = L('input.answerAll'); return;
      }
      answers[q.id] = { answers: [value] };
    }
    inputSends.add(key);
    form.querySelectorAll('input, button').forEach((n) => { n.disabled = true; });
    const currentRequest = () => {
      const m = S.chat && S.chat.id === chat.id && S.chat.messages.find((m) => m.id === message.id);
      return m && { message: m, block: m.blocks.find((b) => b.type === 'user-input' && String(b.key) === form.dataset.inputReq) };
    };
    try {
      const result = await api.answerInput(chat.id, block.key, answers);
      if (result === false || result && result.ok === false) throw new Error(result.error || L('input.failed'));
      if (block.status === 'pending') block.status = 'resolved';
      form.reset();
      const active = currentRequest();
      if (active && active.block && active.block.status === 'pending') active.block.status = block.status;
      if (active) scheduleUpdate(message.id);
    } catch (err) {
      inputSends.delete(key);
      if (block.status === 'pending' && message.status === 'running' && form.isConnected) {
        form.querySelectorAll('input, button').forEach((n) => { n.disabled = false; });
        form.querySelector('.input-error').textContent = err.message;
      }
    } finally {
      inputSends.delete(key);
      const active = currentRequest();
      if (active) scheduleUpdate(active.message.id);
    }
  });

  $('messages').addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-ap]');
    if (ap && S.chat) { ap.disabled = true; await api.approve(S.chat.id, ap.dataset.req, ap.dataset.ap); return; }
    const act = e.target.closest('[data-action]');
    if (act) return runAction(act.dataset.action);
    const cb = e.target.closest('.code-btn');
    if (cb) {
      const code = cb.closest('.code').querySelector('code').textContent;
      if (cb.dataset.act === 'copy') { await navigator.clipboard.writeText(code); cb.textContent = L('common.copied'); setTimeout(() => (cb.textContent = L('common.copy')), 1500); }
      else openHtmlPreview(code);
      return;
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const id = cp.closest('.msg').dataset.id;
      const m = S.chat.messages.find((x) => x.id === id);
      const text = (m.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
      await navigator.clipboard.writeText(text);
      cp.textContent = L('common.copied'); setTimeout(() => (cp.textContent = L('common.copy')), 1500);
    }
  });

  /* ---------- действия из ошибок и панели ---------- */
  function runAction(action) {
    if (action === 'settings') return openSettings();
    if (action === 'studio') return openStudio();
    if (action === 'login-claude') return loginAccount('claude', activeSlot('claude'));
    if (action === 'login-codex') return loginAccount('codex', activeSlot('codex'));
    const done = '; Write-Host; Write-Host ' + psQuote(L('term.installDone'));
    if (action === 'install-claude') { openTerminal('npm.cmd install -g @anthropic-ai/claude-code' + done, L('term.installClaude')); waitEnv(); }
    if (action === 'install-sdk') { openTerminal('npm.cmd install -g @anthropic-ai/claude-agent-sdk --omit=optional' + done, L('term.installSdk')); waitEnv(); }
    if (action === 'install-codex') { openTerminal('npm.cmd install -g @openai/codex' + done, L('term.installCodex')); waitEnv(); }
  }
  let envTimer = null;
  function waitEnv() {
    clearInterval(envTimer);
    let n = 0;
    envTimer = setInterval(async () => {
      S.env = await api.checkEnv();
      renderSys();
      if ((S.env.claudeExe && S.env.claudeSdk && S.env.codexJs) || ++n > 60) clearInterval(envTimer);
    }, 5000);
  }

  /* ---------- поле ввода ---------- */
  function autosize() { const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(240, t.scrollHeight) + 'px'; }
  $('input').addEventListener('input', autosize);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('stopBtn').addEventListener('click', () => { if (S.chat) api.stop(S.chat.id); });

  async function submit(textOverride) {
    const text = (textOverride != null ? textOverride : $('input').value).trim();
    if (!text && !S.attachments.length) return;
    if (S.chat && S.states[S.chat.id] && !['idle', 'error'].includes(S.states[S.chat.id])) {
      // The agent is working: hand the text to the running task instead of refusing it.
      if (!text) { toast(L('chat.steerTextOnly')); return; }
      $('input').value = ''; autosize();
      const r = await api.steer(S.chat.id, { text });
      if (r === 'queued') toast(L('chat.steerQueued'));
      else if (!r) { $('input').value = text; autosize(); }
      return;
    }
    const atts = S.attachments.slice();
    if (!S.chat) {
      const c = await api.createChat({ agent: S.agent, cwd: S.settings.currentProject });
      S.chat = c;
      showHero(false);
      $('chatTitle').textContent = c.title;
      $('chatAgent').textContent = AGENTS[c.agent].label.toUpperCase();
      $('chatCwd').textContent = isApiChat(c.agent) ? '' : c.cwd;
      renderMessages(false);
    } else showHero(false);
    $('input').value = ''; autosize();
    S.attachments = []; renderAttachments();
    const mode = S.chat.agent === 'claude' ? S.settings.claude.permissionMode : usesCodex(S.chat.agent) ? (S.settings[S.chat.agent].sandbox || 'workspace-write') : undefined;
    S.states[S.chat.id] = 'thinking';
    updateOrbs();
    await api.send(S.chat.id, { text, attachments: atts.map((a) => ({ name: a.name, path: a.path, data: a.data, mime: a.mime })), mode });
  }

  /* ---------- вложения ---------- */
  function renderAttachments() {
    const row = $('attachRow');
    row.textContent = '';
    row.hidden = !S.attachments.length;
    S.attachments.forEach((a, i) => {
      const ch = document.createElement('span');
      ch.className = 'att-chip';
      if (a.preview) { const img = document.createElement('img'); img.src = a.preview; img.alt = ''; ch.append(img); }
      const s = document.createElement('span'); s.textContent = a.name; ch.append(s);
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', L('composer.removeAttachment', { name: a.name }));
      x.addEventListener('click', () => { S.attachments.splice(i, 1); renderAttachments(); });
      ch.append(x);
      row.append(ch);
    });
  }
  const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i;
  function addPathFile(name, p) {
    if (S.attachments.some((a) => a.path === p)) return;
    S.attachments.push({ name, path: p, preview: IMG_EXT.test(p) ? fileUrl(p) : null });
  }
  async function addBlobFile(file) {
    const buf = await file.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const name = file.name && file.name !== 'image.png' ? file.name : 'pasted-' + Date.now() + '.' + ext;
    S.attachments.push({ name, data: btoa(bin), mime: file.type, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
  }
  $('attachBtn').addEventListener('click', async () => {
    const files = await api.pickFiles();
    for (const f of files) addPathFile(f.name, f.path);
    renderAttachments();
    $('input').focus();
  });
  $('input').addEventListener('paste', async (e) => {
    const items = [...(e.clipboardData && e.clipboardData.items || [])].filter((it) => it.kind === 'file');
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) { const f = it.getAsFile(); if (f) { const p = api.pathForFile(f); if (p) addPathFile(f.name, p); else await addBlobFile(f); } }
    renderAttachments();
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('dropOverlay').hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0; $('dropOverlay').hidden = true;
    for (const f of [...(e.dataTransfer && e.dataTransfer.files || [])]) {
      const p = api.pathForFile(f);
      if (p) addPathFile(f.name, p); else await addBlobFile(f);
    }
    renderAttachments();
    $('input').focus();
  });

  /* ---------- правая панель ---------- */
  // Сворачиваемые блоки правой панели: каждый заголовок управляет блоком до следующего заголовка.
  (function initHudSections() {
    const hud = $('hud');
    const collapsed = new Set(S.settings.hudCollapsed || []);
    // Collapsed sections are stored by locale key; older versions stored the visible (ru/en) label text.
    const legacyName = (lang, key) => String((window.stellaLocales || {})[lang]?.[key] || '').replace('●', '').trim();
    [...hud.querySelectorAll(':scope > .hud-label')].forEach((label) => {
      const key = label.dataset.i18n;
      const legacy = ['ru', 'en'].map((l) => legacyName(l, key));
      if (key === 'hud.limits') legacy.push('ЛИМИТЫ CLAUDE', 'CLAUDE LIMITS'); // i18n-ignore: section names saved by 1.6
      if (legacy.some((x) => collapsed.has(x))) { legacy.forEach((x) => collapsed.delete(x)); collapsed.add(key); }
      const body = document.createElement('div');
      body.className = 'hud-body';
      let n = label.nextElementSibling;
      while (n && !n.classList.contains('hud-label')) { const next = n.nextElementSibling; body.append(n); n = next; }
      label.after(body);
      label.setAttribute('role', 'button'); label.tabIndex = 0;
      const apply = () => { const c = collapsed.has(key); body.hidden = c; label.classList.toggle('collapsed', c); label.setAttribute('aria-expanded', String(!c)); };
      const toggle = async () => { collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key); apply(); await saveSettings({ hudCollapsed: [...collapsed] }); };
      label.addEventListener('click', toggle);
      label.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      apply();
    });
  })();
  function applyHud() { document.getElementById('app').classList.toggle('hud-hidden', S.settings.hudOpen === false); }
  $('hudToggle').addEventListener('click', async () => { await saveSettings({ hudOpen: S.settings.hudOpen === false }); applyHud(); });

  function renderSys() {
    const box = $('sysList');
    let account = $('codexAccountStatus');
    if (!account) { account = document.createElement('div'); account.id = 'codexAccountStatus'; account.className = 'muted-note codex-account'; box.after(account); }
    account.textContent = '';
    if (codexAccount) {
      const a = codexAccount.account;
      const title = document.createElement('div'); title.textContent = a ? 'ChatGPT · ' + (a.email || a.planType || a.type || L('account.connected')) : codexAccount.requiresOpenaiAuth ? 'ChatGPT · ' + L('account.signInRequired') : 'Codex · ' + L('account.noAuthNeeded'); account.append(title);

    }
    box.textContent = '';
    const rows = [
      { key: 'claude', ok: !!(S.env.claudeExe && S.env.claudeSdk), status: !S.env.claudeExe ? L('sys.notFound') : !S.env.claudeSdk ? L('sys.sdkNeeded') : L('sys.installed'), actions: !S.env.claudeExe ? [['install-claude', L('sys.install')]] : !S.env.claudeSdk ? [['install-sdk', L('sys.installSdk')], ['login-claude', L('sys.signIn')]] : [['login-claude', L('sys.switchAccount')]] },
      { key: 'codex', ok: !!S.env.codexJs, status: S.env.codexJs ? L('sys.installed') : L('sys.notFound'), actions: S.env.codexJs ? [['login-codex', L('sys.switchAccount')]] : [['install-codex', L('sys.install')]] },
      { key: 'chatgpt', ok: S.settings.chatgpt.backend === 'api' ? S.settings.hasApiKey : !!S.env.codexJs, status: S.settings.chatgpt.backend === 'api' ? (S.settings.hasApiKey ? L('sys.apiKey') : L('sys.noKey')) : L('sys.chatgptAccount'), actions: [['settings', L('sys.configure')]] },
      { key: 'images', ok: cfReady(), status: cfReady() ? 'CLOUDFLARE' : L('sys.notConfigured'), actions: [['studio', cfReady() ? L('common.open') : L('sys.configure')]] }
    ];
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = 'sys';
      const running = r.key === 'images' ? genActive > 0 : Object.keys(S.states).some((id) => { const c = S.chats.find((x) => x.id === id); return c && c.agent === r.key && S.states[id] !== 'idle' && S.states[id] !== 'error'; });
      d.innerHTML = '<div class="sys-head"><i></i><span></span><span class="st"></span></div><div class="sys-actions"></div>';
      d.querySelector('i').style.background = r.ok ? AGENTS[r.key].color : 'var(--err)';
      if (running) d.querySelector('i').style.animation = 'pulse 1s infinite';
      d.querySelector('span').textContent = AGENTS[r.key].label;
      const st = d.querySelector('.st');
      st.textContent = running ? L('sys.running') : r.status;
      st.style.color = r.ok ? 'var(--muted)' : 'var(--err)';
      for (const [act, label] of r.actions) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mini-btn'; b.textContent = label;
        b.addEventListener('click', () => runAction(act));
        d.querySelector('.sys-actions').append(b);
      }
      box.append(d);
    }
  }

  function accountLimits(agent) {
    if (!usesCodex(agent) && !S.gptImages) return null;
    const limits = S.usage && S.usage.limits || {};
    // Both clients consume the same account quota; either stream can update it.
    const snapshots = [limits[agent] && limits[agent].account, limits[agent === 'codex' ? 'chatgpt' : 'codex']?.account, codexAccount && codexAccount.rateLimits ? codexAccount : null]
      .filter(Boolean)
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    if (snapshots.length) return snapshots[0].rateLimits || snapshots[0];
    return codexAccount && codexAccount.rateLimits;
  }
  function renderAccountLimits(box) {
    const agent = S.gptImages ? 'chatgpt' : viewAgent();
    if (!usesCodex(agent) && !S.gptImages) return;
    const limits = accountLimits(agent) || {};
    for (const key of ['primary', 'secondary']) {
      const info = limits[key];
      if (!info || !Number.isFinite(info.usedPercent)) continue;
      const used = Math.min(100, Math.max(0, info.usedPercent));
      const remaining = 100 - used;
      const mins = info.windowDurationMins;
      const label = mins === 300 ? L('limits.fiveHours') : mins === 10080 ? L('limits.sevenDays') : Number.isFinite(mins) && mins > 0 ? L('limits.minutes', { n: mins }) : key === 'primary' ? L('limits.primary') : L('limits.secondary');
      const row = document.createElement('div'); row.className = 'limit account-limit';
      row.style.setProperty('--limit-accent', agent === 'chatgpt' ? '#6FD3A0' : '#5FB8C9');
      row.innerHTML = '<div class="limit-provider"></div><div class="limit-head"><span></span><b></b></div><div class="bar"><div></div></div><div class="limit-foot"></div>';
      row.querySelector('.limit-provider').textContent = AGENTS[agent].label;
      row.querySelector('.limit-head span').textContent = label;
      row.querySelector('.limit-head b').textContent = Math.round(remaining) + '%';
      const bar = row.querySelector('.bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', AGENTS[agent].label + ' · ' + label + ' · ' + L('limits.remaining'));
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(remaining));
      row.querySelector('.bar div').style.width = remaining + '%';
      const reset = info.resetsAt;
      const date = reset != null ? new Date(typeof reset === 'number' ? reset * (reset < 1e12 ? 1000 : 1) : reset) : null;
      const resets = date && Number.isFinite(date.getTime()) ? date.toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      row.querySelector('.limit-foot').textContent = L('limits.remaining') + (resets ? ' · ' + L('limits.resets', { when: resets }) : '');
      box.append(row);
    }
  }
  function renderMeter() {
    let strip = $('accountLimitStrip');
    const composer = $('composer');
    if (!strip && composer) { strip = document.createElement('div'); strip.id = 'accountLimitStrip'; strip.className = 'account-limit-strip'; composer.after(strip); }
    if (!strip) return;
    strip.textContent = '';
    renderAccountLimits(strip);
    strip.hidden = !strip.children.length || S.studio || S.gptImages;
  }
  function renderLimits() {
    const box = $('limits');
    renderMeter();
    const agent = S.gptImages ? 'chatgpt' : viewAgent();
    if (agent !== 'claude') {
      box.textContent = '';
      renderAccountLimits(box);
      if (!box.children.length) {
        const note = document.createElement('div'); note.className = 'muted-note';
        note.textContent = isApiChat(agent) ? L('limits.noApi') : L('limits.notYet');
        box.append(note);
      }
      return;
    }
    const CL = (S.usage.limits && S.usage.limits.claude) || {};
    const show = [['seven_day', L('limits.sevenDays')], ['five_hour', L('limits.fiveHours')], ['seven_day_opus', L('limits.sevenDaysOpus')], ['seven_day_sonnet', L('limits.sevenDaysSonnet')]].filter(([k]) => CL[k]);
    if (!show.length) {
      box.innerHTML = '<div class="muted-note"></div>'; box.firstChild.textContent = L('limits.claudeAfterReply');
      renderAccountLimits(box);
      return;
    }
    box.textContent = '';
    for (const [k, label] of show) {
      const info = CL[k];
      let pct = info.utilization;
      if (pct == null) pct = info.status === 'rejected' ? 100 : null;
      else if (pct <= 1) pct = pct * 100;
      const d = document.createElement('div');
      d.className = 'limit';
      d.style.setProperty('--limit-accent', AGENTS.claude.color);
      const v = pct == null ? '—' : Math.round(pct) + '%';
      const resets = info.resetsAt ? new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1)).toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      d.innerHTML = '<div class="limit-head"><span></span><b></b></div><div class="bar"><div></div></div><div class="limit-foot"></div>';
      d.querySelector('.limit-head span').textContent = label;
      d.querySelector('.limit-head b').textContent = v;
      d.querySelector('.bar div').style.width = (pct || 0) + '%';
      if (pct >= 90) d.querySelector('.bar').classList.add('full'); else if (pct >= 70) d.querySelector('.bar').classList.add('hot');
      d.querySelector('.limit-foot').textContent = [info.status === 'rejected' ? L('limits.reached') : '', resets ? L('limits.resets', { when: resets }) : ''].filter(Boolean).join(' ');
      box.append(d);
    }
    renderAccountLimits(box);
  }

  function renderUsage() {
    const box = $('weekUsage');
    box.textContent = '';
    const w = S.usage.week || {};
    for (const k of ['claude', 'codex', 'chatgpt']) {
      const u = w[k] || { input: 0, output: 0, runs: 0, cost: 0 };
      const d = document.createElement('div');
      d.className = 'u-cell';
      d.innerHTML = '<span></span><b></b><small></small>';
      d.querySelector('span').textContent = AGENTS[k].label.toUpperCase();
      d.querySelector('b').textContent = fmtNum(u.input + u.output);
      d.querySelector('b').style.color = AGENTS[k].color;
      d.querySelector('small').textContent = L('usage.runs', { n: u.runs });
      d.title = L('usage.tokens', { input: u.input, output: u.output }) + (u.cost ? ' ' + L('usage.cost', { cost: u.cost.toFixed(2) }) : '');
      box.append(d);
    }
  }

  function renderDirectives() {
    const ul = $('directives');
    ul.textContent = '';
    const list = S.settings.directives || [];
    list.forEach((d, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dir' + (d.done ? ' done' : '');
      b.innerHTML = '<span class="box"></span><span></span>';
      b.lastChild.textContent = directiveText(d);
      b.addEventListener('click', async () => { list[i] = Object.assign({}, d, { done: !d.done }); await saveSettings({ directives: list }); renderDirectives(); });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'del'; del.textContent = '×'; del.setAttribute('aria-label', L('directive.delete'));
      del.addEventListener('click', async () => { list.splice(i, 1); await saveSettings({ directives: list }); renderDirectives(); });
      li.append(b, del);
      ul.append(li);
    });
  }
  $('dirForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('dirInput').value.trim();
    if (!v) return;
    await saveSettings({ directives: (S.settings.directives || []).concat([{ text: v, done: false }]) });
    $('dirInput').value = '';
    renderDirectives();
  });

  function renderFiles() {
    const box = $('chatFiles');
    box.textContent = '';
    const files = [];
    if (S.chat) for (const m of S.chat.messages) {
      for (const f of m.files || []) if (!files.includes(f)) files.push(f);
      for (const a of m.attachments || []) if (!files.includes(a.path)) files.push(a.path);
    }
    if (!files.length) { box.innerHTML = '<div class="muted-note"></div>'; box.firstChild.textContent = L('files.empty'); return; }
    for (const f of files.slice().reverse()) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'file-item';
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3H6v18h12V7z M14 3v4h4"/></svg><span><b></b><small></small></span>';
      b.querySelector('b').textContent = base(f);
      b.querySelector('small').textContent = f;
      b.addEventListener('click', () => openPreview(f));
      box.append(b);
    }
  }

  /* ---------- предпросмотр ---------- */
  let drawerPath = null;
  function openDrawer(name, p) {
    drawerPath = p;
    $('drawerName').textContent = name;
    $('drawerPath').textContent = p || '';
    $('drawerOpen').hidden = !p; $('drawerReveal').hidden = !p;
    $('drawer').hidden = false;
  }
  function closeDrawer() { $('drawer').hidden = true; $('drawerBody').textContent = ''; drawerPath = null; }
  async function openPreview(p) {
    openDrawer(base(p), p);
    const body = $('drawerBody');
    body.textContent = '';
    if (IMG_EXT.test(p) || /\.svg$/i.test(p)) { const img = document.createElement('img'); img.src = fileUrl(p); img.alt = base(p); body.append(img); return; }
    if (/\.html?$/i.test(p)) {
      const fr = document.createElement('iframe');
      fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
      fr.src = fileUrl(p);
      fr.title = base(p);
      body.append(fr);
      return;
    }
    const r = await api.readFile(p);
    if (!r.ok) { body.innerHTML = '<div class="drawer-note"></div>'; body.firstChild.textContent = r.error; return; }
    if (r.text == null) { body.innerHTML = '<div class="drawer-note"></div>'; body.firstChild.textContent = L('preview.unsupported'); return; }
    if (/\.md$/i.test(p)) { const d = document.createElement('div'); d.className = 'md'; d.innerHTML = MD.render(r.text); body.append(d); return; }
    const pre = document.createElement('pre');
    pre.textContent = r.text;
    body.append(pre);
  }
  function openHtmlPreview(code) {
    openDrawer(L('preview.html'), null);
    const body = $('drawerBody');
    body.textContent = '';
    const fr = document.createElement('iframe');
    fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    fr.srcdoc = code;
    fr.title = L('preview.html');
    body.append(fr);
  }
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerOpen').addEventListener('click', () => drawerPath && api.openFile(drawerPath));
  $('drawerReveal').addEventListener('click', () => drawerPath && api.revealFile(drawerPath));

  /* ---------- терминалы ---------- */
  const terms = new Map();
  let termSeq = 0, activeTerm = null;
  function showDock(on) {
    $('dock').hidden = !on;
    if (on && activeTerm) setTimeout(() => fitTerm(terms.get(activeTerm)), 30);
  }
  function fitTerm(t) { if (!t) return; try { t.fit.fit(); if (!t.dead) api.termResize(t.id, t.xterm.cols, t.xterm.rows); } catch (e) {} }
  function renderTermTabs() {
    const host = $('termTabs');
    host.textContent = '';
    for (const [id, t] of terms) {
      const w = document.createElement('div');
      w.className = 'ttab' + (id === activeTerm ? ' on' : '') + (t.dead ? ' dead' : '');
      const n = document.createElement('button'); n.type = 'button'; n.className = 'name'; n.textContent = t.name;
      n.addEventListener('click', () => focusTerm(id));
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', L('term.close', { name: t.name }));
      x.addEventListener('click', () => closeTerm(id));
      w.append(n, x); host.append(w);
    }
    $('termEmpty').style.display = terms.size ? 'none' : 'flex';
  }
  function focusTerm(id) {
    activeTerm = id;
    for (const [tid, t] of terms) t.pane.classList.toggle('on', tid === id);
    const t = terms.get(id);
    if (t) requestAnimationFrame(() => { fitTerm(t); t.xterm.focus(); });
    renderTermTabs();
  }
  async function openTerminal(command, title) {
    showDock(true);
    const id = 't' + (++termSeq);
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    $('termHost').append(pane);
    const xterm = new Terminal({ fontFamily: "'Cascadia Mono', Consolas, monospace", fontSize: 13, cursorBlink: true, theme: { background: '#0A0A0F', foreground: '#ECEAE4', cursor: AGENTS[viewAgent()].color, selectionBackground: '#33334A' } });
    const fit = new FitAddon.FitAddon();
    xterm.loadAddon(fit);
    xterm.open(pane);
    const t = { id, name: title || ('powershell-' + termSeq), pane, xterm, fit, dead: false };
    terms.set(id, t);
    focusTerm(id);
    fitTerm(t);
    xterm.onData((d) => api.termWrite(id, d));
    xterm.attachCustomKeyEventHandler((e) => {
      if (!e.ctrlKey || e.altKey) return true;
      if (e.code === 'KeyV') { if (e.type === 'keydown') navigator.clipboard.readText().then((s) => s && xterm.paste(s)); e.preventDefault(); return false; }
      if (e.code === 'KeyC' && (e.shiftKey || xterm.hasSelection())) { if (e.type === 'keydown') { navigator.clipboard.writeText(xterm.getSelection()); xterm.clearSelection(); } return false; }
      return true;
    });
    pane.addEventListener('contextmenu', (e) => { e.preventDefault(); navigator.clipboard.readText().then((s) => s && xterm.paste(s)); });
    const r = await api.termSpawn({ id, command: command || '', cwd: S.settings.currentProject, cols: xterm.cols, rows: xterm.rows });
    if (!r.ok) { xterm.writeln('\x1b[31m' + L('term.openFailed', { message: r.error }) + '\x1b[0m'); t.dead = true; }
    renderTermTabs();
  }
  function closeTerm(id) {
    const t = terms.get(id);
    if (!t) return;
    if (!t.dead) api.termKill(id);
    t.xterm.dispose(); t.pane.remove(); terms.delete(id);
    if (activeTerm === id) { const last = [...terms.keys()].pop(); if (last) focusTerm(last); else activeTerm = null; }
    renderTermTabs();
  }
  api.onTermData(({ id, data }) => { const t = terms.get(id); if (t) t.xterm.write(data); });
  api.onTermExit(({ id, exitCode }) => {
    const t = terms.get(id);
    if (!t) return;
    t.dead = true;
    t.xterm.writeln('\r\n\x1b[90m' + L('term.exited', { code: exitCode }) + '\x1b[0m');
    renderTermTabs();
    api.checkEnv().then((env) => { S.env = env; renderSys(); refreshCodex(); });
  });
  $('openDock').addEventListener('click', () => { if ($('dock').hidden) { showDock(true); if (!terms.size) openTerminal('', null); } else showDock(false); });
  $('closeDock').addEventListener('click', () => showDock(false));
  $('newShell').addEventListener('click', () => openTerminal('', null));
  new ResizeObserver(() => { const t = terms.get(activeTerm); if (t && !$('dock').hidden) fitTerm(t); }).observe($('termHost'));

  /* ---------- студия изображений ---------- */
  let orbStudio = null;
  let genActive = 0;
  let gallery = [];
  let budget = null;
  const SIZES = [['1024x1024', L('studio.size.square')], ['1344x768', L('studio.size.wide')], ['768x1344', L('studio.size.vertical')], ['1152x896', L('studio.size.landscape')], ['896x1152', L('studio.size.portrait')], ['1536x1536', L('studio.size.large')]];
  function cfReady() { return !!(S.settings.hasCfToken && (S.settings.cfAccountId || '').trim()); }
  function estimate(model, w, h, steps) {
    const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
    return model === 'klein' ? Math.round(tiles * 26.05) : Math.round(4 * 4.8 + steps * 9.6);
  }
  function genParams() {
    const model = $('genModel').value;
    const [w, h] = $('genSize').value.split('x').map(Number);
    const steps = Number($('genSteps').value);
    return { model, width: model === 'klein' ? w : 1024, height: model === 'klein' ? h : 1024, steps };
  }
  function syncGenForm() {
    const klein = $('genModel').value === 'klein';
    $('genSize').disabled = !klein;
    if (!klein) $('genSize').value = '1024x1024';
    $('genSteps').hidden = klein;
    const p = genParams();
    const n = Number($('genCount').value);
    const cost = estimate(p.model, p.width, p.height, p.steps) * n;
    const left = budget ? Math.max(0, budget.limit - budget.neurons) : null;
    $('genCost').textContent = L('studio.cost', { n: cost }) + (left != null ? ' · ' + L('studio.enoughFor', { n: Math.floor(left / Math.max(1, cost / n)) }) : '');
  }
  for (const [v, l] of SIZES) { const o = document.createElement('option'); o.value = v; o.textContent = l; $('genSize').append(o); }
  ['genModel', 'genSize', 'genSteps', 'genCount'].forEach((id) => $(id).addEventListener('change', syncGenForm));

  function renderBudget() {
    if (!budget) return;
    const pct = Math.min(100, budget.neurons / budget.limit * 100);
    $('budgetVal').textContent = Math.round(pct) + '%';
    $('budgetBar').style.width = pct + '%';
    $('budgetBar').parentElement.className = 'bar' + (pct >= 90 ? ' full' : pct >= 70 ? ' hot' : '');
    $('budgetFoot').textContent = L('studio.budget', { used: budget.neurons, limit: budget.limit, images: budget.images });
    syncGenForm();
  }

  function renderCfSetup() {
    const box = $('cfSetup');
    box.hidden = cfReady();
    if (cfReady()) { box.textContent = ''; return; }
    // Step texts are trusted locale strings with inline <b> markup.
    box.innerHTML = '<h3 data-i18n="cf.title"></h3><ol>' +
      '<li>' + L('cf.step1') + '</li>' +
      '<li>' + L('cf.step2') + '</li>' +
      '<li>' + L('cf.step3') + '</li>' +
      '<li>' + L('cf.step4') + '</li></ol>' +
      '<div><button type="button" class="btn" id="cfOpenDash" data-i18n="cf.openDashboard"></button></div>' +
      '<div class="grid2"><div class="field"><label for="cfAcc">Account ID</label><input id="cfAcc" class="input" data-i18n-placeholder="cf.accountPlaceholder"></div>' +
      '<div class="field"><label for="cfTok" data-i18n="cf.token"></label><input id="cfTok" class="input" type="password" data-i18n-placeholder="cf.tokenPlaceholder"></div></div>' +
      '<div><button type="button" class="btn accent" id="cfSave" data-i18n="cf.save"></button></div>';
    I18N.apply(box);
    box.querySelector('#cfAcc').value = S.settings.cfAccountId || '';
    box.querySelector('#cfOpenDash').addEventListener('click', () => api.openUrl('https://dash.cloudflare.com/?to=/:account/ai/workers-ai'));
    box.querySelector('#cfSave').addEventListener('click', async () => {
      const acc = box.querySelector('#cfAcc').value.trim();
      const tok = box.querySelector('#cfTok').value.trim();
      if (!acc || (!tok && !S.settings.hasCfToken)) { toast(L('cf.bothRequired')); return; }
      await saveSettings({ cfAccountId: acc });
      if (tok) S.settings = await api.setCfToken(tok);
      renderCfSetup(); renderSys();
      toast(L('cf.connected'));
      $('genPrompt').focus();
    });
  }

  function pendingCard(w, h) {
    const card = document.createElement('div');
    card.className = 'gen-card pending';
    card.style.setProperty('--ar', w + ' / ' + h);
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    const t = document.createElement('div'); t.className = 'ptxt'; t.textContent = L('studio.synth', { s: 0 });
    card.append(cv, t);
    const orb = new StellaOrb(cv, { count: 70, ring: false, color: AGENTS.images.color });
    orb.setState('thinking');
    const started = Date.now();
    const timer = setInterval(() => { t.textContent = L('studio.synth', { s: Math.round((Date.now() - started) / 1000) }); }, 250);
    card._done = () => { clearInterval(timer); orb.destroy(); };
    return card;
  }

  function imageCard(it) {
    const card = document.createElement('div');
    card.className = 'gen-card';
    card.style.setProperty('--ar', it.width + ' / ' + it.height);
    card.dataset.id = it.id;
    const img = document.createElement('img');
    img.src = fileUrl(it.file);
    img.alt = it.prompt;
    img.loading = 'lazy';
    img.addEventListener('click', () => openPreview(it.file));
    const cap = document.createElement('div');
    cap.className = 'cap';
    const p = document.createElement('p'); p.textContent = it.prompt; p.title = it.usedPrompt || it.prompt;
    const acts = document.createElement('div'); acts.className = 'acts';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn'; b.textContent = label; b.addEventListener('click', fn); acts.append(b); return b; };
    mk(L('studio.another'), () => generate({ prompt: it.prompt, model: it.model, width: it.width, height: it.height, steps: it.steps }, 1));
    mk(L('studio.prompt'), () => { $('genPrompt').value = it.prompt; $('genModel').value = it.model; syncGenForm(); $('genPrompt').focus(); });
    mk(L('common.inFolder'), () => api.revealFile(it.file));
    const del = mk(L('common.delete'), async () => {
      if (!del.dataset.c) { del.dataset.c = '1'; del.textContent = L('common.sure'); setTimeout(() => { delete del.dataset.c; del.textContent = L('common.delete'); }, 3000); return; }
      const r = await api.imagesDelete(it.id);
      gallery = r.items; budget = r.stats; renderGallery(); renderBudget();
    });
    cap.append(p, acts);
    card.append(img, cap);
    return card;
  }

  function renderGallery() {
    const g = $('gallery');
    [...g.querySelectorAll('.gen-card:not(.pending), .gallery-empty')].forEach((x) => x.remove());
    if (!gallery.length && !g.querySelector('.pending')) {
      const e = document.createElement('div'); e.className = 'gallery-empty';
      e.textContent = L('studio.empty');
      g.append(e);
    }
    for (const it of gallery) g.append(imageCard(it));
  }

  function updateStudioOrb() { if (orbStudio) orbStudio.setState(genActive ? 'thinking' : 'idle'); renderSys(); }

  async function generate(params, count) {
    if (!cfReady()) { renderCfSetup(); toast(L('cf.connectFirst')); return; }
    const prompt = params.prompt;
    const enhance = $('genEnhance').checked;
    const g = $('gallery');
    const empty = g.querySelector('.gallery-empty'); if (empty) empty.remove();
    const jobs = [];
    for (let i = 0; i < count; i++) {
      const card = pendingCard(params.width, params.height);
      g.prepend(card);
      genActive++;
      jobs.push((async () => {
        const seed = count === 1 && params.seed ? params.seed : undefined;
        const r = await api.imagesGenerate(Object.assign({}, params, { seed, enhance }));
        card._done();
        genActive--;
        if (r.ok) {
          gallery.unshift(r.item); budget = r.stats;
          const fresh = imageCard(r.item);
          card.replaceWith(fresh);
          renderBudget();
        } else {
          card.className = 'gen-card failed';
          card.textContent = r.error;
          if (r.code === 'nocreds') renderCfSetup();
          setTimeout(() => card.remove(), 12000);
        }
        updateStudioOrb();
      })());
    }
    updateStudioOrb();
    await Promise.all(jobs);
  }

  $('genForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = $('genPrompt').value.trim();
    if (!prompt) { $('genPrompt').focus(); return; }
    const p = genParams();
    const seed = parseInt($('genSeed').value, 10) || undefined;
    generate(Object.assign({ prompt, seed }, p), Number($('genCount').value));
  });
  $('genPrompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey) && !e.isComposing) { e.preventDefault(); $('genForm').requestSubmit(); }
  });

  async function openStudio() {
    ++chatNavigation;
    clearInputForms();
    S.gptImages = false;
    $('gptImages').hidden = true;
    S.studio = true;
    viewChanged();
    $('hero').hidden = true; $('chatView').hidden = true; $('composer').hidden = true;
    $('studio').hidden = false;
    if (!orbStudio) orbStudio = new StellaOrb($('orbStudio'), { count: 120, color: AGENTS.images.color });
    applyTheme();
    renderCfSetup();
    const r = await api.imagesList();
    gallery = r.items; budget = r.stats;
    renderGallery(); renderBudget(); syncGenForm(); updateStudioOrb();
    renderChatList();
    if (cfReady()) $('genPrompt').focus();
  }

  /* ---------- окна ---------- */
  function openModal(id) { $(id).hidden = false; const f = $(id).querySelector('input, select, textarea, button'); if (f) f.focus(); }
  function closeModal(id) { $(id).hidden = true; }
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m.id); });
  });

  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return I18N.apply(t.content.firstChild); }

  /* ---------- аккаунты (до двух на провайдера) ---------- */
  const ACC_LABEL = { claude: 'Claude', codex: 'Codex · ChatGPT' };
  function activeSlot(p) { const a = S.settings.accounts && S.settings.accounts[p]; return a && a.active === 2 ? 2 : 1; }
  async function loginAccount(p, slot) {
    if (p === 'claude' && !S.env.claudeExe) return runAction('install-claude');
    const envName = p === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
    const pre = slot === 2 ? '$env:' + envName + '=' + psQuote(await api.accountsPrepare(p)) + '; ' : '';
    const title = (p === 'claude' ? L('term.claudeLogin') : L('term.codexLogin')) + ' · ' + L('accounts.slot', { n: slot });
    if (p === 'claude') { openTerminal(pre + '& ' + psQuote(S.env.claudeExe), title); toast(L('action.loginClaudeHint'), 7000); }
    else { openTerminal(pre + 'codex.cmd login', title); toast(L('action.loginCodexHint'), 6000); }
  }
  // Modal confirmation. With "check", OK stays disabled until the box is ticked.
  function confirmDialog({ title, text, warning, check, ok, cancel }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal alert-modal';
      wrap.setAttribute('role', 'alertdialog'); wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML = '<div class="modal-box alert-box is-error"><div class="alert-bar"></div><div class="alert-body"><div class="alert-title"></div><div class="alert-text"></div><div class="alert-warn" role="note"></div><label class="check alert-check"><input type="checkbox"> <span></span></label></div><div class="alert-actions"><button type="button" class="btn" data-a="no"></button><button type="button" class="btn accent" data-a="yes"></button></div></div>';
      wrap.querySelector('.alert-title').textContent = title || '';
      wrap.querySelector('.alert-text').textContent = text || '';
      if (!text) wrap.querySelector('.alert-text').remove();
      wrap.querySelector('.alert-warn').textContent = warning || '';
      if (!warning) wrap.querySelector('.alert-warn').remove();
      const yes = wrap.querySelector('[data-a=yes]'), no = wrap.querySelector('[data-a=no]');
      yes.textContent = ok || 'OK'; no.textContent = cancel || L('common.cancel');
      const box = wrap.querySelector('.alert-check');
      if (check) { box.querySelector('span').textContent = check; yes.disabled = true; box.querySelector('input').addEventListener('change', (e) => { yes.disabled = !e.target.checked; }); }
      else box.remove();
      const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      yes.addEventListener('click', () => close(true));
      no.addEventListener('click', () => close(false));
      document.addEventListener('keydown', onKey);
      document.body.append(wrap);
      (check ? box.querySelector('input') : no).focus();
    });
  }
  async function ackAccounts(p) {
    if (S.settings.accounts && S.settings.accounts[p] && S.settings.accounts[p].ack) return true;
    const ok = await confirmDialog({ title: L('accounts.ackTitle'), text: L('accounts.ackText'), warning: L('accounts.warning'), check: L('accounts.ackCheck'), ok: L('accounts.ackOk') });
    if (ok) S.settings = await api.accountsAck(p);
    return ok;
  }
  async function renderAccounts(box) {
    box.textContent = '';
    const note = document.createElement('div'); note.className = 'hint'; note.textContent = L('accounts.loading'); box.append(note);
    let st;
    try { st = await api.accountsState(); } catch (e) { note.textContent = String(e.message || e); return; }
    box.textContent = '';
    for (const p of ['claude', 'codex']) {
      const ps = st[p];
      const grp = el('<div class="acc-group"><div class="acc-name"></div></div>');
      grp.querySelector('.acc-name').textContent = ACC_LABEL[p];
      for (const sl of ps.slots) {
        const row = el('<div class="acc-row"><div class="acc-info"><div class="acc-title"></div><div class="hint acc-sub"></div></div><div class="row acc-actions"></div></div>');
        const isActive = ps.active === sl.slot;
        row.classList.toggle('is-active', isActive);
        row.querySelector('.acc-title').textContent = L('accounts.slot', { n: sl.slot }) + (isActive ? ' · ' + L('accounts.active') : '');
        row.querySelector('.acc-sub').textContent = !sl.signedIn ? L('accounts.notSignedIn') : [sl.email, sl.plan ? sl.plan.toUpperCase() : '', sl.paid ? L('accounts.paid') : L('accounts.free')].filter(Boolean).join(' · ');
        const acts = row.querySelector('.acc-actions');
        const btn = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', fn); acts.append(b); };
        btn(sl.signedIn ? L('accounts.relogin') : L('accounts.signIn'), async () => { if (sl.slot === 2 && !(await ackAccounts(p))) return; loginAccount(p, sl.slot); });
        if (!isActive && sl.signedIn) btn(L('accounts.makeActive'), async () => { if (sl.slot === 2 && !(await ackAccounts(p))) return; S.settings = await api.accountsSetActive(p, sl.slot); renderAccounts(box); refreshCodex(); });
        if (sl.slot === 2 && sl.signedIn) btn(L('common.delete'), async () => { if (!(await confirmDialog({ title: L('accounts.removeTitle'), text: L('accounts.removeText'), ok: L('common.delete') }))) return; S.settings = await api.accountsRemove(p); renderAccounts(box); refreshCodex(); }, 'danger');
        grp.append(row);
      }
      box.append(grp);
    }
    const warn = document.createElement('div'); warn.className = 'alert-warn'; warn.textContent = L('accounts.warning'); box.append(warn);
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'btn'; refresh.textContent = L('accounts.refresh');
    refresh.addEventListener('click', () => renderAccounts(box)); box.append(refresh);
  }
  // A run hit the usage limit and the other account has a paid plan too: ask before switching.
  api.onAccountLimit(async ({ chatId, provider, from, to, fromEmail, toEmail }) => {
    const who = (n, email) => L('accounts.slot', { n }) + (email ? ' (' + email + ')' : '');
    const ok = await confirmDialog({ title: L('accounts.limitTitle'), text: L('accounts.limitText', { provider: ACC_LABEL[provider], from: who(from, fromEmail), to: who(to, toEmail) }), warning: L('accounts.warning'), ok: L('accounts.switchOk') });
    if (!ok) return;
    const r = await api.accountsSwitchContinue(chatId, provider, to);
    if (r) { S.settings = r; refreshCodex(); toast(L('accounts.switched', { n: to })); }
  });
  api.onAccountsChanged(async (cfg) => {
    try { const s = await api.init(); S.settings = s.settings; } catch (e) {}
  });

  function openSettings() {
    const s = S.settings;
    const body = $('settingsBody');
    body.textContent = '';

    // ChatGPT
    const gpt = el('<div class="sect"><h3>CHATGPT</h3>' +
      '<div class="radio-row"><label class="check"><input type="radio" name="gptb" value="codex"> <span data-i18n="settings.gpt.viaAccount"></span></label>' +
      '<label class="check"><input type="radio" name="gptb" value="api"> <span data-i18n="settings.gpt.viaApi"></span></label></div>' +
      '<div class="field" data-g="codex"><label for="gptModel" data-i18n="settings.gpt.model"></label><input id="gptModel" class="input" data-i18n-placeholder="settings.gpt.modelPlaceholder"></div>' +
      '<div class="field" data-g="api"><label for="apiKey" data-i18n="settings.gpt.apiKey"></label><div class="row"><input id="apiKey" class="input" type="password" placeholder="sk-…"><button type="button" class="btn" id="apiKeySave" data-i18n="common.save"></button><button type="button" class="btn danger" id="apiKeyDel" data-i18n="common.delete"></button></div>' +
      '<div class="hint" id="apiKeyState"></div></div>' +
      '<div class="field" data-g="api"><label for="apiModel" data-i18n="settings.gpt.apiModel"></label><div class="row"><input id="apiModel" class="input" list="apiModels"><datalist id="apiModels"></datalist><button type="button" class="btn" id="loadModels" data-i18n="settings.gpt.loadModels"></button></div></div></div>');
    body.append(gpt);
    const syncG = () => { const v = gpt.querySelector('input[name=gptb]:checked').value; gpt.querySelectorAll('[data-g]').forEach((f) => (f.hidden = f.dataset.g !== v)); };
    gpt.querySelector('input[value="' + (s.chatgpt.backend || 'codex') + '"]').checked = true;
    syncG();
    gpt.querySelectorAll('input[name=gptb]').forEach((r) => r.addEventListener('change', async () => { syncG(); await saveSettings({ chatgpt: Object.assign({}, S.settings.chatgpt, { backend: r.value }) }); renderSys(); applyTheme(); renderSkills(); renderChatList(); if (S.chat) $('chatCwd').textContent = isApiChat(S.chat.agent) ? '' : S.chat.cwd; refreshCodex(); }));
    gpt.querySelector('#gptModel').value = s.chatgpt.model || '';
    gpt.querySelector('#gptModel').addEventListener('change', (e) => saveSettings({ chatgpt: Object.assign({}, S.settings.chatgpt, { model: e.target.value.trim() }) }));
    gpt.querySelector('#apiModel').value = s.chatgpt.apiModel || 'gpt-5';
    gpt.querySelector('#apiModel').addEventListener('change', (e) => saveSettings({ chatgpt: Object.assign({}, S.settings.chatgpt, { apiModel: e.target.value.trim() }) }));
    const keyState = () => { gpt.querySelector('#apiKeyState').textContent = S.settings.hasApiKey ? L('settings.gpt.keyStored') : L('settings.gpt.noKey'); };
    keyState();
    gpt.querySelector('#apiKeySave').addEventListener('click', async () => {
      const v = gpt.querySelector('#apiKey').value.trim();
      if (!v) return;
      try { S.settings = await api.setApiKey(v); gpt.querySelector('#apiKey').value = ''; keyState(); renderSys(); toast(L('settings.gpt.keySaved')); } catch (e) { toast(L('settings.gpt.keySaveFailed', { message: e.message })); }
    });
    gpt.querySelector('#apiKeyDel').addEventListener('click', async () => { S.settings = await api.setApiKey(''); keyState(); renderSys(); });
    gpt.querySelector('#loadModels').addEventListener('click', async () => {
      try {
        const list = await api.chatgptModels();
        const dl = gpt.querySelector('#apiModels'); dl.textContent = '';
        for (const m of list) { const o = document.createElement('option'); o.value = m; dl.append(o); }
        toast(L('settings.gpt.modelsFound', { n: list.length }));
      } catch (e) { toast(L('settings.gpt.modelsFailed')); }
    });

    // аккаунты
    const accS = el('<div class="sect"><h3 data-i18n="accounts.title"></h3><div class="hint" data-i18n="accounts.hint"></div><div class="acc-list"></div></div>');
    body.append(accS);
    renderAccounts(accS.querySelector('.acc-list'));

    // Cloudflare
    const cfS = el('<div class="sect"><h3 data-i18n="settings.cf.title"></h3><div class="grid2">' +
      '<div class="field"><label for="setCfAcc">Account ID</label><input id="setCfAcc" class="input"></div>' +
      '<div class="field"><label for="setCfTok" data-i18n="settings.cf.token"></label><div class="row"><input id="setCfTok" class="input" type="password" data-i18n-placeholder="settings.cf.newToken"><button type="button" class="btn" id="setCfSave" data-i18n="common.save"></button></div></div></div>' +
      '<div class="hint" id="setCfState"></div></div>');
    body.append(cfS);
    cfS.querySelector('#setCfAcc').value = s.cfAccountId || '';
    const cfState = () => { cfS.querySelector('#setCfState').textContent = S.settings.hasCfToken ? L('settings.cf.tokenStored') : L('settings.cf.noToken'); };
    cfState();
    cfS.querySelector('#setCfAcc').addEventListener('change', async (e) => { await saveSettings({ cfAccountId: e.target.value.trim() }); renderSys(); });
    cfS.querySelector('#setCfSave').addEventListener('click', async () => {
      const v = cfS.querySelector('#setCfTok').value.trim();
      S.settings = await api.setCfToken(v);
      cfS.querySelector('#setCfTok').value = '';
      cfState(); renderSys(); toast(v ? L('settings.cf.tokenSaved') : L('settings.cf.tokenRemoved'));
    });

    // модели агентов
    const models = el('<div class="sect"><h3 data-i18n="settings.agents"></h3><div class="grid2">' +
      '<div class="field"><label for="claudeModel" data-i18n="settings.claudeModel"></label><input id="claudeModel" class="input" data-i18n-placeholder="settings.claudeModelPlaceholder"></div>' +
      '<div class="field"><label for="codexModel" data-i18n="settings.codexModel"></label><input id="codexModel" class="input"></div></div>' +
      '<div class="grid2"><div class="field"><label for="claudeExe" data-i18n="settings.claudeExe"></label><input id="claudeExe" class="input" data-i18n-placeholder="settings.foundAutomatically"></div>' +
      '<div class="field"><label for="codexJs" data-i18n="settings.codexJs"></label><input id="codexJs" class="input" data-i18n-placeholder="settings.foundAutomatically"></div></div></div>');
    body.append(models);
    models.querySelector('#claudeModel').value = s.claude.model || '';
    models.querySelector('#codexModel').value = s.codex.model || '';
    models.querySelector('#claudeExe').value = s.claude.exePath || '';
    models.querySelector('#codexJs').value = s.codex.jsPath || '';
    models.querySelector('#claudeModel').addEventListener('change', (e) => saveSettings({ claude: Object.assign({}, S.settings.claude, { model: e.target.value.trim() }) }));
    models.querySelector('#codexModel').addEventListener('change', (e) => saveSettings({ codex: Object.assign({}, S.settings.codex, { model: e.target.value.trim() }) }));
    models.querySelector('#claudeExe').addEventListener('change', async (e) => { await saveSettings({ claude: Object.assign({}, S.settings.claude, { exePath: e.target.value.trim() }) }); S.env = await api.checkEnv(); renderSys(); });
    models.querySelector('#codexJs').addEventListener('change', async (e) => { await saveSettings({ codex: Object.assign({}, S.settings.codex, { jsPath: e.target.value.trim() }) }); S.env = await api.checkEnv(); renderSys(); refreshCodex(); });

    // приложение
    const appS = el('<div class="sect"><h3 data-i18n="settings.app"></h3>' +
      '<div class="field"><label for="hotkey" data-i18n="settings.hotkey"></label><input id="hotkey" class="input" readonly><div class="hint" data-i18n="settings.hotkeyHint"></div></div>' +
      '<label class="check"><input type="checkbox" id="optTray"> <span data-i18n="settings.tray"></span></label>' +
      '<label class="check"><input type="checkbox" id="optAuto"> <span data-i18n="settings.autostart"></span></label>' +
      '<label class="check"><input type="checkbox" id="optNotif"> <span data-i18n="settings.notifications"></span></label></div>');
    body.append(appS);
    const hk = appS.querySelector('#hotkey');
    hk.value = s.hotkey || '';
    hk.addEventListener('keydown', async (e) => {
      e.preventDefault();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Backspace' || e.key === 'Delete') { hk.value = ''; await saveSettings({ hotkey: '' }); return; }
      const parts = [];
      if (e.ctrlKey) parts.push('Control'); if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift'); if (e.metaKey) parts.push('Super');
      let k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code === 'Space' ? 'Space' : /^F\d+$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!parts.length) { toast(L('settings.hotkeyModifier')); return; }
      parts.push(k);
      hk.value = parts.join('+');
      const r = await saveSettings({ hotkey: hk.value });
      toast(r.hotkeyOk ? L('settings.hotkeySet', { hotkey: hk.value }) : L('settings.hotkeyTaken'));
    });
    const bind = (id, key) => { const c = appS.querySelector(id); c.checked = !!s[key]; c.addEventListener('change', () => saveSettings({ [key]: c.checked })); };
    bind('#optTray', 'closeToTray'); bind('#optAuto', 'autostart'); bind('#optNotif', 'notifications');

    // DNS только для Stella
    const dnsS = el('<div class="sect"><h3>DNS</h3><div class="hint" data-i18n="dns.hint"></div>' +
      '<div class="field"><label for="dnsActive" data-i18n="dns.active"></label><div class="row"><select id="dnsActive" class="input"></select><button type="button" class="btn" id="dnsTest" data-i18n="dns.test"></button></div><div class="hint" id="dnsState"></div></div>' +
      '<label class="check"><input type="checkbox" id="dnsAsk"> <span data-i18n="dns.askOnStart"></span></label>' +
      '<div id="dnsRows" class="sect"></div>' +
      '<div class="field"><label data-i18n="dns.addTitle"></label><div class="row"><input id="dnsName" class="input" data-i18n-placeholder="dns.name" style="max-width:160px"><input id="dnsAddr" class="input" data-i18n-placeholder="dns.address"><input id="dnsBoot" class="input" data-i18n-placeholder="dns.bootstrap" style="max-width:150px"><button type="button" class="btn" id="dnsAdd" data-i18n="common.add"></button></div><div class="hint" data-i18n="dns.addHint"></div></div></div>');
    body.append(dnsS);
    const dnsSave = async (patch) => { await saveSettings({ dns: Object.assign({}, S.settings.dns || {}, patch) }); await renderDns(); };
    async function renderDns() {
      const st = await api.dnsStatus();
      const sel = dnsS.querySelector('#dnsActive'); sel.textContent = '';
      for (const e of st.entries) { const o = document.createElement('option'); o.value = e.id; o.textContent = e.label; sel.append(o); }
      sel.value = (S.settings.dns && S.settings.dns.active) || 'system';
      dnsS.querySelector('#dnsAsk').checked = st.askOnStart;
      dnsS.querySelector('#dnsState').textContent = st.port ? L('dns.stateOn', { port: st.port }) : L('dns.stateOff');
      const rows = dnsS.querySelector('#dnsRows'); rows.textContent = '';
      for (const e of st.entries.filter((x) => !x.builtin)) {
        const r = el('<div class="row"><span style="flex:1"></span><button type="button" class="btn danger" data-i18n="common.delete"></button></div>');
        r.firstChild.textContent = e.label + (e.bootstrap ? ' (' + e.bootstrap + ')' : '');
        r.lastChild.addEventListener('click', () => dnsSave({ custom: (S.settings.dns.custom || []).filter((c) => c.id !== e.id) }));
        I18N.apply(r); rows.append(r);
      }
    }
    dnsS.querySelector('#dnsActive').addEventListener('change', (e) => dnsSave({ active: e.target.value }).then(() => toast(L('dns.applied'))));
    dnsS.querySelector('#dnsAsk').addEventListener('change', (e) => dnsSave({ askOnStart: e.target.checked }));
    dnsS.querySelector('#dnsTest').addEventListener('click', async () => {
      const r = await api.dnsTest(dnsS.querySelector('#dnsActive').value);
      toast(r.ok ? L('dns.testOk', { addresses: r.addresses.join(', '), ms: r.ms }) : L('dns.testFailed', { message: r.message }));
    });
    dnsS.querySelector('#dnsAdd').addEventListener('click', async () => {
      const q = (id) => dnsS.querySelector(id);
      const r = await api.dnsValidate({ name: q('#dnsName').value, address: q('#dnsAddr').value, bootstrap: q('#dnsBoot').value });
      if (!r.ok) { toast(r.field === 'name' ? L('dns.invalid.name') : r.field === 'bootstrap' ? L('dns.invalid.bootstrap') : L('dns.invalid.address')); return; }
      await dnsSave({ custom: ((S.settings.dns && S.settings.dns.custom) || []).concat([r.entry]) });
      q('#dnsName').value = ''; q('#dnsAddr').value = ''; q('#dnsBoot').value = '';
      toast(L('dns.added'));
    });
    renderDns();

    // навыки
    const sk = el('<div class="sect"><h3 data-i18n="settings.skills"></h3><div id="skillRows" class="sect"></div><div><button type="button" class="btn" id="addSkill" data-i18n="settings.addSkill"></button></div></div>');
    body.append(sk);
    // Built-ins are edited in the current language; editing one turns it into the user's own text.
    const skills = (s.skills || []).map((x) => Object.assign({}, skillText(x)));
    const saveSkills = () => saveSettings({ skills: skills.filter((x) => x.label.trim() && x.prompt.trim()) }).then(renderSkills);
    const drawSkills = () => {
      const rows = sk.querySelector('#skillRows'); rows.textContent = '';
      skills.forEach((x, i) => {
        const r = el('<div class="skill-row"><input class="input" data-i18n-aria="settings.skillName"><textarea class="input" rows="2" data-i18n-aria="settings.skillPrompt"></textarea><button type="button" class="del" data-i18n-aria="settings.skillDelete">×</button></div>');
        r.children[0].value = x.label; r.children[1].value = x.prompt;
        r.children[0].addEventListener('change', (e) => { x.label = e.target.value; delete x.builtin; saveSkills(); });
        r.children[1].addEventListener('change', (e) => { x.prompt = e.target.value; delete x.builtin; saveSkills(); });
        r.children[2].addEventListener('click', () => { skills.splice(i, 1); saveSkills(); drawSkills(); });
        rows.append(r);
      });
    };
    drawSkills();
    sk.querySelector('#addSkill').addEventListener('click', () => { skills.push({ label: L('settings.newSkill'), prompt: '' }); drawSkills(); });

    const langSect = el('<div class="sect"><h3 data-i18n="settings.language"></h3><div class="field"><label for="langSel" data-i18n="settings.languageLabel"></label><select id="langSel"><option value="ru" lang="ru"></option><option value="en" lang="en">English</option></select></div></div>');
    // Language names are endonyms: each is written in its own language.
    langSect.querySelector('option[value=ru]').textContent = window.stellaLocales.ru['language.name'];
    langSect.querySelector('#langSel').value = I18N.lang;
    langSect.querySelector('#langSel').addEventListener('change', async (e) => {
      await saveSettings({ language: e.target.value });
      I18N.set(e.target.value);
      location.reload();
    });
    body.append(langSect);

    const mem = el('<div class="sect"><h3 data-i18n="settings.memory"></h3><div class="muted-note" data-i18n="settings.memoryHint"></div><label><input type="checkbox" id="memOn"> <span data-i18n="settings.memoryOn"></span></label><textarea id="memText" rows="8" spellcheck="false" style="width:100%"></textarea><div><button type="button" class="btn" id="memSave" data-i18n="settings.memorySave"></button></div></div>');
    mem.querySelector('#memOn').checked = S.settings.memoryEnabled !== false;
    mem.querySelector('#memOn').addEventListener('change', (e) => saveSettings({ memoryEnabled: e.target.checked }));
    api.memoryGet(S.settings.currentProject).then((t) => { mem.querySelector('#memText').value = t; });
    mem.querySelector('#memSave').addEventListener('click', async () => { await api.memorySet(S.settings.currentProject, mem.querySelector('#memText').value); toast(L('settings.memorySaved')); });
    body.append(mem);

    const about = el('<div class="sect"><h3 data-i18n="settings.about"></h3><div class="muted-note"></div></div>');
    about.querySelector('.muted-note').textContent = L('settings.aboutText', { version: S.env.version });
    const upd = document.createElement('button'); upd.type = 'button'; upd.className = 'btn'; upd.textContent = L('update.check');
    upd.addEventListener('click', () => api.checkUpdate());
    about.append(upd);
    body.append(about);

    openModal('settingsModal');
  }
  $('openSettings').addEventListener('click', openSettings);

  /* ---------- расписание ---------- */
  const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => [d, L('day.' + d)]);
  function daysText(days) {
    if (!days || !days.length || days.length === 7) return L('tasks.everyDay');
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return L('tasks.weekdays');
    return DAYS.filter(([d]) => days.includes(d)).map(([, l]) => l).join(', ');
  }
  function openTasks(editId) {
    const body = $('tasksBody');
    body.textContent = '';
    body.append(el('<div class="muted-note" data-i18n="tasks.hint"></div>'));
    const list = el('<div class="sect"></div>');
    body.append(list);
    if (!S.tasks.length) list.append(el('<div class="muted-note" data-i18n="tasks.empty"></div>'));
    for (const t of S.tasks) {
      const row = el('<div class="task-item"><label class="check" data-i18n-title="tasks.enabled"><input type="checkbox"></label><div class="ti-text"><b></b><small></small></div><button type="button" class="btn" data-i18n="bridge.run"></button><button type="button" class="btn" data-i18n="tasks.edit"></button><button type="button" class="del" data-i18n-aria="tasks.delete">×</button></div>');
      const cb = row.querySelector('input');
      cb.checked = !!t.enabled;
      cb.setAttribute('aria-label', L('tasks.enabledAria'));
      cb.addEventListener('change', async () => { t.enabled = cb.checked; S.tasks = await api.saveTasks(S.tasks); });
      row.querySelector('b').textContent = t.name;
      row.querySelector('small').textContent = AGENTS[t.agent].label + ' · ' + t.time + ' · ' + daysText(t.days) + (!isApiChat(t.agent) ? ' · ' + base(t.cwd) : '');
      const [runB, editB] = row.querySelectorAll('.btn');
      runB.addEventListener('click', async () => { const id = await api.runTask(t.id); closeModal('tasksModal'); if (id) setTimeout(() => openChat(id), 300); });
      editB.addEventListener('click', () => openTasks(t.id));
      row.querySelector('.del').addEventListener('click', async () => { S.tasks = await api.saveTasks(S.tasks.filter((x) => x.id !== t.id)); openTasks(); });
      list.append(row);
    }

    const editing = S.tasks.find((x) => x.id === editId);
    const t = editing ? Object.assign({}, editing) : { id: 't' + Date.now(), name: '', agent: S.agent, cwd: S.settings.currentProject, time: '09:00', days: [1, 2, 3, 4, 5], prompt: '', enabled: true };
    const form = el('<form class="sect"><h3 data-i18n="' + (editing ? 'tasks.editTitle' : 'tasks.newTitle') + '"></h3>' +
      '<div class="grid2"><div class="field"><label for="tkName" data-i18n="tasks.name"></label><input id="tkName" class="input" required></div>' +
      '<div class="field"><label for="tkAgent" data-i18n="composer.agent"></label><select id="tkAgent"><option value="claude">Claude</option><option value="codex">Codex</option><option value="chatgpt">ChatGPT</option></select></div></div>' +
      '<div class="grid2"><div class="field"><label for="tkTime" data-i18n="tasks.time"></label><input id="tkTime" class="input" type="time" required></div>' +
      '<div class="field"><label for="tkCwd" data-i18n="dialog.projectFolder"></label><select id="tkCwd"></select></div></div>' +
      '<div class="field"><span class="lbl" data-i18n="tasks.days"></span><div class="days" id="tkDays"></div></div>' +
      '<div class="field"><label for="tkPrompt" data-i18n="tasks.prompt"></label><textarea id="tkPrompt" class="input" rows="4" required></textarea><div class="hint" data-i18n="tasks.promptHint"></div></div>' +
      '<div class="row"><button type="submit" class="btn accent" data-i18n="' + (editing ? 'common.save' : 'tasks.add') + '"></button>' + (editing ? '<button type="button" class="btn" id="tkCancel" data-i18n="common.cancel"></button>' : '') + '</div></form>');
    body.append(form);
    form.querySelector('#tkName').value = t.name;
    form.querySelector('#tkAgent').value = t.agent;
    form.querySelector('#tkTime').value = t.time;
    form.querySelector('#tkPrompt').value = t.prompt;
    const cwdSel = form.querySelector('#tkCwd');
    for (const p of S.settings.projects) { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === t.cwd) o.selected = true; cwdSel.append(o); }
    const daysBox = form.querySelector('#tkDays');
    for (const [d, l] of DAYS) {
      const lab = el('<label><input type="checkbox"> <span></span></label>'); lab.lastChild.textContent = l;
      lab.firstChild.checked = t.days.includes(d);
      lab.firstChild.addEventListener('change', (e) => { if (e.target.checked) t.days.push(d); else t.days = t.days.filter((x) => x !== d); });
      daysBox.append(lab);
    }
    if (editing) form.querySelector('#tkCancel').addEventListener('click', () => openTasks());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      t.name = form.querySelector('#tkName').value.trim();
      t.agent = form.querySelector('#tkAgent').value;
      t.time = form.querySelector('#tkTime').value;
      t.cwd = cwdSel.value;
      t.prompt = form.querySelector('#tkPrompt').value.trim();
      if (!t.name || !t.prompt || !t.time) return;
      const next = editing ? S.tasks.map((x) => (x.id === t.id ? t : x)) : S.tasks.concat([t]);
      S.tasks = await api.saveTasks(next);
      toast(editing ? L('tasks.saved') : L('tasks.added'));
      openTasks();
    });
    openModal('tasksModal');
  }
  $('openTasks').addEventListener('click', () => openTasks());

  /* ---------- события из основного процесса ---------- */
  api.onChatsChanged((summary) => {
    const i = S.chats.findIndex((c) => c.id === summary.id);
    if (i >= 0) S.chats[i] = summary; else S.chats.push(summary);
    if (S.chat && S.chat.id === summary.id && S.chat.title !== summary.title) { S.chat.title = summary.title; if (!$('chatTitle').isContentEditable) $('chatTitle').textContent = summary.title; }
    renderChatList();
  });
  api.onChatMessage(({ chatId, message }) => {
    if (!S.chat || S.chat.id !== chatId) return;
    if (S.chat.messages.some((m) => m.id === message.id)) return;
    S.chat.messages.push(message);
    const box = $('messages');
    box.append(message.role === 'user' ? renderUser(message) : renderAi(message));
    showHero(false);
    renderFiles();
    requestAnimationFrame(toBottom);
  });
  api.onChatEvent(({ chatId, msgId, ev }) => {
    if (!S.chat || S.chat.id !== chatId) return;
    const m = S.chat.messages.find((x) => x.id === msgId);
    if (!m) return;
    R.apply(m, ev);
    scheduleUpdate(msgId);
    if (ev.t === 'files' || ev.t === 'done') renderFiles();
  });
  api.onAgentState(({ chatId, state }) => {
    S.states[chatId] = state;
    if (state === 'idle') delete S.states[chatId];
    updateOrbs();
    renderChatList();
    renderSys();
  });
  api.onUsage((u) => { S.usage = u; renderLimits(); renderUsage(); renderSys(); });
  api.onTasks((t) => { S.tasks = t; });
  api.onOpenChat((id) => openChat(id));
  let updReady = null;
  function showUpdateReady(u) {
    if (!u) return;
    updReady = u;
    const b = $('checkUpdateBtn');
    b.lastChild.textContent = L('update.restartTo', { version: u.version });
    b.style.color = 'var(--accent, #7cf)';
  }
  api.onUpdateReady(showUpdateReady);
  api.updateState().then(showUpdateReady);
  $('checkUpdateBtn').addEventListener('click', () => (updReady ? api.installUpdate() : api.checkUpdate()));
  $('transferBtn').addEventListener('click', async () => {
    if (!S.chat) return;
    if (S.states[S.chat.id] && !['idle', 'error'].includes(S.states[S.chat.id])) { toast(L('chat.waitOrStop')); return; }
    const c = await api.transferChat(S.chat.id);
    if (!c) { toast(L('chat.nothingToTransfer')); return; }
    await openChat(c.id);
    toast(L('chat.transferred'));
    $('input').focus();
  });
  api.onNewChat(() => openDraft());
  api.onFocusComposer(() => $('input').focus());
  api.onToast((t) => toast(t, 5000));
  // Окно сообщения в стиле Stella (вместо системных alert/dialog).
  function showAlert({ kind, title, text }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal alert-modal';
    wrap.setAttribute('role', 'alertdialog');
    wrap.innerHTML = '<div class="modal-box alert-box"><div class="alert-bar"></div><div class="alert-body"><div class="alert-title"></div><div class="alert-text"></div></div><div class="alert-actions"><button type="button" class="btn accent">OK</button></div></div>';
    wrap.querySelector('.alert-box').classList.add(kind === 'error' ? 'is-error' : 'is-info');
    wrap.querySelector('.alert-title').textContent = title || '';
    wrap.querySelector('.alert-text').textContent = text || '';
    if (!text) wrap.querySelector('.alert-text').remove();
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('button').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    wrap.querySelector('button').focus();
  }
  api.onAlert(showAlert);

  /* ---------- клавиатура ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyN') { e.preventDefault(); openDraft(); }
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyK') { e.preventDefault(); $('search').focus(); }
    if (e.key === 'Escape') {
      if (!$('settingsModal').hidden) closeModal('settingsModal');
      else if (!$('tasksModal').hidden) closeModal('tasksModal');
      else if (!$('drawer').hidden) closeDrawer();
      else if (!$('projMenu').hidden) closeProjMenu();
    }
  });

  function openGptImages() {
    openDraft();
    hideViews();
    viewChanged();
    S.gptImages = true;
    applyTheme();
    $('gptImages').hidden = false;
  }

  /* ---------- доступ для «Мостика» ---------- */
  window.StellaApp = { api, S, AGENTS, esc, toast, fileUrl, base, openChat, openDraft, openStudio, cfReady, hideViews, openGptImages, runAction, onViewChange: (f) => viewListeners.push(f) };

  /* ---------- старт ---------- */
  applyHud();
  renderProject();
  renderSys();
  renderLimits();
  renderUsage();
  renderDirectives();
  openDraft();
  refreshCodex();
  setInterval(refreshCodex, 120000);
})();
