/* Chat models over OpenAI-compatible APIs with the user's own key: ChatGPT (OpenAI), DeepSeek and
   Gemini (Google's OpenAI compatibility layer). These are conversations only: no tools, no files. */
const fs = require('fs');
const path = require('path');
const { L } = require('../i18n');

const TEXT_EXT = new Set(['.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv', '.xml', '.yml', '.yaml', '.ini', '.log', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.php', '.rb', '.sh', '.bat', '.ps1', '.sql', '.tsx', '.jsx', '.kt', '.toml']);

// efforts: reasoning_effort values the API accepts; [] = the parameter is not sent.
// prefer: picks a default when the user left the model on "auto" (ids change too often to hard-code one).
const PROVIDERS = {
  chatgpt: {
    name: 'ChatGPT', vendor: 'OpenAI', base: 'https://api.openai.com/v1', vision: true,
    efforts: ['minimal', 'low', 'medium', 'high'],
    keep: (id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id),
    prefer: [/^gpt-5$/, /^gpt-5/, /^gpt-4/]
  },
  deepseek: {
    name: 'DeepSeek', vendor: 'DeepSeek', base: 'https://api.deepseek.com', vision: false,
    efforts: [],
    keep: () => true,
    prefer: [/pro/, /chat/, /./]
  },
  gemini: {
    name: 'Gemini', vendor: 'Google', base: 'https://generativelanguage.googleapis.com/v1beta/openai', vision: true,
    efforts: ['low', 'medium', 'high'],
    keep: (id) => /^gemini/.test(id) && !/(embedding|tts|image|audio|live|veo|imagen|aqa)/.test(id),
    prefer: [/^gemini-[\d.]+-flash$/, /flash(?!.*lite)/, /pro/, /./]
  },
  // One key for hundreds of models; ids ending in ":free" cost nothing (with a daily request cap).
  openrouter: {
    name: 'OpenRouter', vendor: 'OpenRouter', base: 'https://openrouter.ai/api/v1', vision: true,
    efforts: ['low', 'medium', 'high'], effortParam: 'reasoning',
    headers: { 'HTTP-Referer': 'https://github.com/stelferovskiy/stella', 'X-Title': 'Stella' },
    // Text-out models only (no image or audio generators).
    keep: (id, m) => { const out = m && m.architecture && (m.architecture.output_modalities || String(m.architecture.modality || '').split('->')[1]); return !out || String(out).includes('text'); },
    free: (id, m) => /:free$/.test(id) || !!(m && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0),
    prefer: [/^deepseek\/.*:free$/, /:free$/, /^deepseek\//, /./]
  }
};
const API_AGENTS = Object.keys(PROVIDERS);
const providerOf = (id) => PROVIDERS[id] || PROVIDERS.chatgpt;
// Model setting: ChatGPT keeps its API model apart from the account-mode model.
function modelSetting(settings, id) {
  const cfg = (settings && settings[id]) || {};
  return String((id === 'chatgpt' ? cfg.apiModel : cfg.model) || '').trim();
}

function historyMessages(chat, upToIndex, name) {
  const out = [{ role: 'system', content: 'You are ' + name + ' inside the Stella desktop app. Reply in the user’s language and use Markdown.' }];
  for (let i = 0; i < upToIndex; i++) {
    const m = chat.messages[i];
    if (m.role === 'user') { if (m.text) out.push({ role: 'user', content: m.text }); }
    else {
      const t = (m.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (t) out.push({ role: 'assistant', content: t });
    }
  }
  return out;
}

// Gemini lists ids as "models/gemini-…"; the chat endpoint wants the bare id.
const bareId = (id) => String(id || '').replace(/^models\//, '');

const listCache = new Map(); // provider|key -> { at, list }
async function listModels(apiKey, id = 'chatgpt') {
  const p = providerOf(id);
  if (!apiKey) throw new Error(L('api.noKey', { name: p.name }));
  const r = await fetch(p.base + '/models', { headers: Object.assign({ Authorization: 'Bearer ' + apiKey }, p.headers), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error(L('api.status', { name: p.vendor, status: r.status })), { status: r.status });
  const j = await r.json();
  const models = (j.data || []).filter((m) => m && m.id && p.keep(bareId(m.id), m));
  // Free models first where the provider has them, then alphabetical.
  const isFree = (m) => (p.free ? p.free(bareId(m.id), m) : false);
  models.sort((a, b) => Number(isFree(b)) - Number(isFree(a)) || bareId(a.id).localeCompare(bareId(b.id)));
  const list = [...new Set(models.map((m) => bareId(m.id)))];
  listCache.set(id + '|' + apiKey, { at: Date.now(), list });
  return list;
}

async function defaultModel(apiKey, id) {
  const p = providerOf(id);
  const hit = listCache.get(id + '|' + apiKey);
  const list = hit && Date.now() - hit.at < 3600000 ? hit.list : await listModels(apiKey, id);
  for (const re of p.prefer) { const m = list.find((x) => re.test(x)); if (m) return m; }
  throw new Error(L('api.noModels', { name: p.name }));
}

async function run({ chat, text, attachments, settings, apiKey, emit, abortController, historyIndex, provider = 'chatgpt' }) {
  const p = providerOf(provider);
  if (!apiKey) {
    emit({ t: 'error', text: L('api.noKey', { name: p.name }), action: 'settings' });
    return { status: 'error' };
  }
  const messages = historyMessages(chat, historyIndex, p.name);
  const parts = [];
  let body = text || '';
  for (const a of attachments || []) {
    if (a.kind === 'image' && p.vision) {
      try { parts.push({ type: 'image_url', image_url: { url: 'data:' + (a.mime || 'image/png') + ';base64,' + fs.readFileSync(a.path).toString('base64') } }); } catch (e) {}
    } else if (TEXT_EXT.has(path.extname(a.path).toLowerCase())) {
      try {
        const st = fs.statSync(a.path);
        if (st.size < 200000) body += '\n\nFile ' + a.name + ':\n```\n' + fs.readFileSync(a.path, 'utf8') + '\n```';
        else body += '\n\n(File ' + a.name + ' is too large to attach in full.)';
      } catch (e) {}
    } else body += '\n\n(Attached file ' + a.name + ' cannot be sent as text.)';
  }
  messages.push({ role: 'user', content: parts.length ? [{ type: 'text', text: body || L('prompt.seeAttachments') }].concat(parts) : body });

  let model = modelSetting(settings, provider);
  const effort = settings && settings[provider] && settings[provider].effort;
  if (!model && provider === 'chatgpt') model = 'gpt-5';
  if (!model) {
    // "Auto": ask the provider which models this key has. A refusal here is about the key, not the network.
    try { model = await defaultModel(apiKey, provider); }
    catch (err) {
      if (abortController.signal.aborted) return { status: 'stopped' };
      const auth = err.status === 401 || err.status === 403;
      emit({ t: 'error', text: err.status ? err.message : L('api.network', { name: p.vendor, message: err.message }), action: auth ? 'settings' : null });
      return { status: 'error', limitHit: err.status === 402 || err.status === 429 };
    }
  }
  let res;
  try {
    res = await fetch(p.base + '/chat/completions', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, p.headers),
      body: JSON.stringify({ model, ...(p.efforts.includes(effort) ? (p.effortParam === 'reasoning' ? { reasoning: { effort } } : { reasoning_effort: effort }) : {}), messages, stream: true, stream_options: { include_usage: true } }),
      signal: abortController.signal
    });
  } catch (err) {
    if (abortController.signal.aborted) return { status: 'stopped' };
    emit({ t: 'error', text: L('api.network', { name: p.vendor, message: err.message }) });
    return { status: 'error' };
  }
  if (!res.ok) {
    let t = '';
    try { const j = await res.json(); const e = Array.isArray(j) ? j[0] && j[0].error : j.error; t = e && e.message; } catch (e) {}
    const auth = res.status === 401 || res.status === 403;
    // 402: DeepSeek balance is empty; 429: out of quota or rate limited. Either way another agent can take over.
    emit({ t: 'error', text: L('api.error', { name: p.vendor, status: res.status }) + (t ? ': ' + t : ''), action: auth ? 'settings' : null });
    return { status: 'error', limitHit: res.status === 402 || res.status === 429 };
  }
  emit({ t: 'state', s: 'streaming' });
  let usage = null, streamError = null;
  let buf = '';
  try {
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta;
          // DeepSeek reasoning models stream their thinking separately from the answer.
          // Reasoning comes apart from the answer: DeepSeek calls it reasoning_content, OpenRouter reasoning.
          const thought = d && (d.reasoning_content || (typeof d.reasoning === 'string' ? d.reasoning : ''));
          if (thought) { emit({ t: 'thinking', text: thought }); emit({ t: 'state', s: 'thinking' }); }
          // OpenRouter reports a failure that happens mid-stream inside the stream itself.
          if (j.error && j.error.message && !streamError) { streamError = j.error; emit({ t: 'error', text: L('api.error', { name: p.vendor, status: j.error.code || '' }) + ': ' + j.error.message }); }
          if (d && d.content) { emit({ t: 'text', text: d.content }); emit({ t: 'state', s: 'streaming' }); }
          if (j.usage) usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0, cost: 0 };
        } catch (e) {}
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) return { status: 'stopped', usage };
    emit({ t: 'error', text: L('api.streamBroken', { message: err.message }) });
    return { status: 'error', usage };
  }
  if (streamError) return { status: 'error', usage, limitHit: streamError.code === 429 || streamError.code === 402 };
  return { status: 'done', usage };
}

module.exports = { run, listModels, PROVIDERS, API_AGENTS, bareId };
