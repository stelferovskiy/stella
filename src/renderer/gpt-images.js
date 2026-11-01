/* GPT Images uses the signed-in ChatGPT account through the dedicated preload API. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const label = (ru, en) => window.I18N?.lang === 'en' ? en : ru;
  let A, api, items = [], active = false, stage = '', requestId = null, revision = 0;
  let initialized = false, pending = false;
  const terminal = new Set(['done', 'error', 'stopped']);
  const stages = () => ({ thinking: label('Обдумываю запрос…', 'Thinking…'), generating: label('Создаю изображение…', 'Generating image…'), saving: label('Сохраняю…', 'Saving…'), done: label('Изображение готово', 'Image ready'), stopped: label('Генерация остановлена', 'Generation stopped'), error: label('Не удалось создать изображение', 'Generation failed') });
  function error(message) { $('gptImagesError').textContent = String(message || ''); $('gptImagesError').hidden = !message; }
  function updateState(message) {
    $('gptImagesGenerate').disabled = active || pending;
    $('gptImagesStop').hidden = !active;
    $('gptImagesStatus').classList.toggle('busy', active);
    $('gptImagesStatus').textContent = message || stages()[stage] || '';
    $('gptImagesForm').setAttribute('aria-busy', String(active));
  }
  function merge(item) { if (item?.id) items = [item, ...items.filter((x) => x.id !== item.id)]; }
  function button(text, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn'; b.textContent = text;
    b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (e) { error(e.message); } finally { b.disabled = false; } });
    return b;
  }
  function renderGallery() {
    const gallery = $('gptImagesGallery'); gallery.replaceChildren();
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'gallery-empty'; empty.textContent = label('Здесь появятся ваши изображения. Опишите идею и нажмите «Создать».', 'Your images will appear here. Describe an idea and select Generate.'); gallery.append(empty); }
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'gpt-image-card';
      const img = document.createElement('img'); img.src = A.fileUrl(item.file || item.path); img.alt = item.prompt || ''; img.loading = 'lazy';
      const file = item.file || item.path;
      const preview = button(label('Открыть', 'Open'), () => api.openFile(file)); preview.classList.add('gpt-image-preview'); preview.replaceChildren(img);
      preview.setAttribute('aria-label', label('Открыть изображение', 'Open image'));
      const caption = document.createElement('div'); caption.className = 'gpt-image-caption';
      const prompt = document.createElement('p'); prompt.textContent = item.prompt || ''; prompt.title = item.prompt || '';
      const date = document.createElement('time'); const when = new Date(item.time || item.createdAt || item.created || item.date); date.textContent = Number.isNaN(when.getTime()) ? '' : when.toLocaleString(window.I18N?.lang === 'en' ? 'en-US' : 'ru-RU');
      const actions = document.createElement('div'); actions.className = 'acts';
      const remove = button(label('Удалить', 'Delete'), async () => { ++revision; const r = await api.gptImagesDelete(item.id); ++revision; items = r.items || []; renderGallery(); });
      remove.disabled = pending;
      actions.append(button(label('Открыть', 'Open'), () => api.openFile(file)), button(label('В папке', 'Reveal'), () => api.revealFile(file)), button(label('Сохранить как…', 'Save as…'), async () => { const r = await api.gptImagesSave(item.id); if (!r?.ok && !r?.canceled) throw new Error(r?.error || label('Не удалось сохранить', 'Save failed')); }), remove);
      caption.append(prompt, date, actions); card.append(preview, caption); gallery.append(card);
    }
  }
  function setup(data = {}) {
    const box = $('gptImagesSetup'); box.replaceChildren();
    const capabilities = data.capabilities;
    const missingCli = data.code === 'install-codex' || capabilities?.cliAvailable === false || (!A.S.env?.codexJs && !A.S.env?.codexExe);
    const missingLogin = data.account === null || data.account?.loggedIn === false || data.account?.requiresOpenaiAuth === true || (data.account && 'account' in data.account && !data.account.account);
    const unavailable = data.supported === false || data.code === 'unavailable' || capabilities === false || capabilities?.available === false || capabilities?.imageGeneration === false || capabilities?.image_generation === false;
    if (!missingCli && !missingLogin && !unavailable) { box.hidden = true; return; }
    box.hidden = false;
    const p = document.createElement('p'); p.textContent = missingCli ? label('Для GPT Images нужен установленный Codex CLI.', 'GPT Images requires Codex CLI.') : missingLogin ? label('Войдите в ChatGPT через Codex, чтобы создавать изображения.', 'Sign in to ChatGPT through Codex to generate images.') : label('Генерация изображений недоступна в этой версии Codex или для этого аккаунта.', 'Image generation is unavailable in this Codex version or for this account.'); box.append(p);
    if (missingCli) box.append(button(label('Установить Codex', 'Install Codex'), () => A.runAction('install-codex')));
    if (missingLogin || !missingCli) box.append(button(label('Войти в ChatGPT', 'Sign in to ChatGPT'), () => A.runAction('login-codex')));
    box.append(button(label('Проверить снова', 'Check again'), refresh));
  }
  async function refresh() {
    const before = revision;
    if (typeof api.gptImagesList !== 'function') { setup({ capabilities: false }); error(label('GPT Images пока недоступен. Обновите Stella и Codex CLI.', 'GPT Images is unavailable. Update Stella and Codex CLI.')); return; }
    try {
      const data = await api.gptImagesList();
      if (before !== revision) return;
      items = data.items || []; setup(data); if (data.error) error(data.error);
      const status = typeof api.gptImagesStatus === 'function' ? await api.gptImagesStatus() : data.active;
      if (before !== revision) return;
      if (status !== undefined) { active = typeof status === 'boolean' ? status : !!status?.active; stage = status?.stage || (active ? 'generating' : stage); requestId = status?.requestId || null; }
      renderGallery(); updateState();
    } catch (e) { error(e.message); }
  }
  function progress(payload) {
    if (!payload || (requestId && payload.requestId && requestId !== payload.requestId)) return;
    revision++; requestId = payload.requestId || requestId; stage = payload.stage; active = !terminal.has(stage);
    merge(payload.item); if (stage === 'error') error(payload.message || stages().error);
    if (terminal.has(stage)) requestId = null;
    updateState(payload.message); renderGallery();
  }
  async function generate(event) {
    event.preventDefault(); if (active || pending) return;
    const prompt = $('gptImagesPrompt').value.trim(); if (!prompt) return $('gptImagesPrompt').focus();
    if (typeof api.gptImagesGenerate !== 'function') return error(label('Генерация недоступна. Обновите Stella.', 'Generation unavailable. Update Stella.'));
    ++revision; pending = true; active = true; stage = 'thinking'; requestId = null; error(''); updateState(); renderGallery();
    try {
      const r = await api.gptImagesGenerate({ prompt, size: $('gptImagesSize').value, transparent: $('gptImagesTransparent').checked });
      if (r?.ok) { merge(r.item); if (stage !== 'stopped') stage = 'done'; }
      else if (r?.code === 'stopped' || stage === 'stopped') stage = 'stopped';
      else { stage = 'error'; error(r?.error || stages().error); if (r?.code === 'login-codex') setup({ account: { loggedIn: false } }); else if (r?.code === 'unsupported' || r?.code === 'install-codex') setup({ supported: false, code: r.code }); }
    } catch (e) { stage = 'error'; error(e.message); }
    finally { pending = false; active = false; requestId = null; ++revision; updateState(); renderGallery(); }
  }
  function init() {
    if (initialized || !window.StellaApp) return false;
    initialized = true; A = window.StellaApp; api = A.api;
    $('gptImagesDescription').textContent = label('Создавайте изображения через свой аккаунт ChatGPT — без API-ключа. Используется включённый лимит Codex, общий с чатами и задачами. Генерация изображений расходует его быстрее, чем обычный текст.', 'Create images with your ChatGPT account — no API key. Uses your included Codex allowance, shared with chats and tasks. Image generation consumes more usage than ordinary text.');
    $('gptImagesPromptLabel').textContent = label('Описание изображения', 'Image description');
    $('gptImagesPrompt').placeholder = label('Опишите сюжет, стиль, освещение и детали…', 'Describe the scene, style, lighting and details…');
    $('gptImagesSizeLabel').textContent = label('Формат', 'Aspect');
    for (const [v, ru, en] of [['auto', 'Авто', 'Auto'], ['square', 'Квадрат', 'Square'], ['landscape', 'Альбомный', 'Landscape'], ['portrait', 'Портретный', 'Portrait']]) { const o = document.createElement('option'); o.value = v; o.textContent = label(ru, en); $('gptImagesSize').append(o); }
    $('gptImagesTransparentLabel').textContent = label('Прозрачный фон', 'Transparent background');
    $('gptImagesHint').textContent = label('Формат и прозрачность передаются как пожелания в запросе. Точные размеры и прозрачность результата не гарантированы. Ctrl+Enter — создать.', 'Aspect and transparency are prompt instructions. Exact dimensions and transparency are not guaranteed. Ctrl+Enter to generate.');
    $('gptImagesGenerate').textContent = label('Создать', 'Generate'); $('gptImagesStop').textContent = label('Остановить', 'Stop');
    $('gptImagesForm').addEventListener('submit', generate);
    $('gptImagesPrompt').addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('gptImagesForm').requestSubmit(); } });
    $('gptImagesStop').addEventListener('click', async () => { const b = $('gptImagesStop'); b.disabled = true; try { if (await api.gptImagesStop()) { stage = 'stopped'; active = false; updateState(); } } catch (e) { error(e.message); } finally { b.disabled = false; } });
    if (typeof api.onGptImagesProgress === 'function') api.onGptImagesProgress(progress);
    return true;
  }
  window.StellaGptImages = { open() { if (!init() && !initialized) return; A.openGptImages(); refresh(); $('gptImagesPrompt').focus(); } };
  // app.js awaits IPC initialization; bind once when its exported lifecycle is ready.
  let attempts = 0;
  function wait() { if (!init() && ++attempts < 200) setTimeout(wait, 100); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wait, { once: true }); else wait();
})();
