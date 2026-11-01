/* ChatGPT через OpenAI API (если пользователь указал свой ключ). */
const fs = require('fs');
const path = require('path');
const { L } = require('../i18n');

const TEXT_EXT = new Set(['.txt', '.md', '.json', '.js', '.ts', '.py', '.css', '.html', '.csv', '.xml', '.yml', '.yaml', '.ini', '.log', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.php', '.rb', '.sh', '.bat', '.ps1', '.sql', '.tsx', '.jsx']);

function historyMessages(chat, upToIndex) {
  const out = [{ role: 'system', content: 'You are ChatGPT inside the Stella desktop app. Reply in the user’s language and use Markdown.' }];
  for (let i = 0; i < upToIndex; i++) {
    const m = chat.messages[i];
    if (m.role === 'user') out.push({ role: 'user', content: m.text || '' });
    else {
      const t = (m.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (t) out.push({ role: 'assistant', content: t });
    }
  }
  return out;
}

async function listModels(apiKey) {
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + apiKey } });
  if (!r.ok) throw new Error(L('openai.status', { status: r.status }));
  const j = await r.json();
  return (j.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort();
}

async function run({ chat, text, attachments, settings, apiKey, emit, abortController, historyIndex }) {
  if (!apiKey) {
    emit({ t: 'error', text: L('openai.noKey'), action: 'settings' });
    return { status: 'error' };
  }
  const messages = historyMessages(chat, historyIndex);
  const parts = [];
  let body = text || '';
  for (const a of attachments || []) {
    if (a.kind === 'image') {
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

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model: settings.chatgpt.apiModel || 'gpt-5', ...(['minimal', 'low', 'medium', 'high'].includes(settings.chatgpt.effort) ? { reasoning_effort: settings.chatgpt.effort } : {}), messages, stream: true, stream_options: { include_usage: true } }),
      signal: abortController.signal
    });
  } catch (err) {
    if (abortController.signal.aborted) return { status: 'stopped' };
    emit({ t: 'error', text: L('openai.network', { message: err.message }) });
    return { status: 'error' };
  }
  if (!res.ok) {
    let t = '';
    try { const j = await res.json(); t = j.error && j.error.message; } catch (e) {}
    emit({ t: 'error', text: L('openai.error', { status: res.status }) + (t ? ': ' + t : ''), action: res.status === 401 ? 'settings' : null });
    return { status: 'error' };
  }
  emit({ t: 'state', s: 'streaming' });
  let usage = null;
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
          if (d && d.content) emit({ t: 'text', text: d.content });
          if (j.usage) usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0, cost: 0 };
        } catch (e) {}
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) return { status: 'stopped', usage };
    emit({ t: 'error', text: L('openai.streamBroken', { message: err.message }) });
    return { status: 'error', usage };
  }
  return { status: 'done', usage };
}

module.exports = { run, listModels };
