/* Генерация изображений через Cloudflare Workers AI (FLUX). Бесплатный лимит — 10 000 нейронов в сутки. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { L } = require('./i18n');

const MODELS = {
  schnell: { id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 schnell' },
  klein: { id: '@cf/black-forest-labs/flux-2-klein-4b', label: 'FLUX.2 klein' }
};
const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DAILY_FREE = 10000;

// оценка расхода нейронов по ценам Cloudflare
function estimateNeurons(model, w, h, steps) {
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  if (model === 'klein') return Math.round(tiles * 26.05);
  return Math.round(4 * 4.8 + (steps || 4) * 9.6); // schnell: 1024×1024 = 4 плитки
}

function createImages({ store, getCreds }) {
  const dir = path.join(store.dir, 'images');
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  const usageFile = path.join(dir, 'usage.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const write = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };
  let index = read(indexFile, []);

  function today() { return new Date().toISOString().slice(0, 10); } // сброс лимита — 00:00 UTC
  function stats() {
    const u = read(usageFile, { day: today(), neurons: 0, images: 0 });
    if (u.day !== today()) return { day: today(), neurons: 0, images: 0, limit: DAILY_FREE };
    return Object.assign(u, { limit: DAILY_FREE });
  }
  function addUsage(n) {
    const u = stats();
    u.neurons += n; u.images += 1;
    write(usageFile, { day: u.day, neurons: u.neurons, images: u.images });
  }

  async function cf(modelId, init) {
    const { accountId, token } = getCreds();
    if (!accountId || !token) { const e = new Error(L('studio.error.noCreds')); e.code = 'nocreds'; throw e; }
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/ai/run/' + modelId;
    const headers = Object.assign({ Authorization: 'Bearer ' + token }, init.headers || {});
    let res;
    try { res = await fetch(url, Object.assign({}, init, { method: 'POST', headers })); }
    catch (e) { throw new Error(L('studio.error.network', { message: e.message })); }
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      let msg = L('studio.error.status', { status: res.status });
      try { const j = await res.json(); const er = j.errors && j.errors[0]; if (er) msg += ': ' + (er.message || JSON.stringify(er)); } catch (e) {}
      if (res.status === 401 || res.status === 403) msg += L('studio.error.checkToken');
      if (res.status === 429) msg = L('studio.error.rateLimit');
      throw new Error(msg);
    }
    if (ct.startsWith('image/')) return { buffer: Buffer.from(await res.arrayBuffer()) };
    const j = await res.json();
    if (j && j.success === false) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || L('studio.error.generic'));
    return { json: j };
  }

  async function enhancePrompt(prompt) {
    if (!/[а-яё]/i.test(prompt)) return prompt;
    try {
      const r = await cf(TEXT_MODEL, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You translate image prompts into fluent English for an image generation model. Keep every detail, add nothing. Output only the translated prompt, no quotes, no comments.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 300
        })
      });
      const t = r.json && r.json.result && r.json.result.response;
      return t && t.trim() ? t.trim().replace(/^["']|["']$/g, '') : prompt;
    } catch (e) { return prompt; }
  }

  function extFor(buf) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
    if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
    return '.png';
  }

  async function generate({ prompt, model, width, height, steps, seed, enhance }) {
    prompt = String(prompt || '').trim();
    if (!prompt) throw new Error(L('studio.error.emptyPrompt'));
    model = MODELS[model] ? model : 'schnell';
    width = Math.max(256, Math.min(1920, parseInt(width, 10) || 1024));
    height = Math.max(256, Math.min(1920, parseInt(height, 10) || 1024));
    steps = Math.max(1, Math.min(8, parseInt(steps, 10) || 4));
    seed = seed ? parseInt(seed, 10) : Math.floor(Math.random() * 2147483647);
    const used = enhance === false ? prompt : await enhancePrompt(prompt);

    let r;
    if (model === 'klein') {
      const fd = new FormData();
      fd.append('prompt', used);
      fd.append('width', String(width));
      fd.append('height', String(height));
      fd.append('seed', String(seed));
      r = await cf(MODELS.klein.id, { body: fd });
    } else {
      width = 1024; height = 1024;
      r = await cf(MODELS.schnell.id, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: used, steps, seed }) });
    }
    let buf = r.buffer;
    if (!buf && r.json) {
      const res = r.json.result != null ? r.json.result : r.json;
      const b64 = typeof res === 'string' ? res : (res.image || res.images && res.images[0]);
      if (!b64) throw new Error(L('studio.error.noImage'));
      buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
    }
    const id = crypto.randomUUID();
    const file = path.join(dir, id + extFor(buf));
    fs.writeFileSync(file, buf);
    const neurons = estimateNeurons(model, width, height, steps);
    addUsage(neurons);
    const item = { id, file, prompt, usedPrompt: used, model, width, height, steps: model === 'klein' ? 4 : steps, seed, time: Date.now(), neurons };
    index.unshift(item);
    write(indexFile, index);
    return item;
  }

  function list() { return index.filter((x) => fs.existsSync(x.file)); }
  function remove(id) {
    const it = index.find((x) => x.id === id);
    if (it) { try { fs.unlinkSync(it.file); } catch (e) {} }
    index = index.filter((x) => x.id !== id);
    write(indexFile, index);
    return list();
  }

  return { generate, list, remove, stats, MODELS, estimateNeurons };
}

module.exports = { createImages, MODELS };
