/* A chat as a Markdown document: what was asked, what each agent answered, which tools ran. */
const { L } = require('./i18n');

const AGENT_NAMES = { claude: 'Claude', codex: 'Codex', chatgpt: 'ChatGPT', deepseek: 'DeepSeek', gemini: 'Gemini', openrouter: 'OpenRouter' };
const agentName = (a) => AGENT_NAMES[a] || String(a || '');
const quote = (s) => String(s || '').split('\n').map((l) => '> ' + l).join('\n');
const fence = (s) => { const t = String(s || ''); const ticks = (t.match(/`{3,}/g) || []).reduce((n, m) => Math.max(n, m.length + 1), 3); return '`'.repeat(ticks) + '\n' + t + '\n' + '`'.repeat(ticks); };

function toMarkdown(chat, { locale } = {}) {
  const when = (t) => new Date(t).toLocaleString(locale || L('locale'));
  const out = ['# ' + (chat.title || L('chat.new')), ''];
  out.push('- ' + L('export.agent', { agent: agentName(chat.agent) }));
  if (chat.cwd) out.push('- ' + L('export.folder', { path: chat.cwd }));
  out.push('- ' + L('export.created', { when: when(chat.created) }), '');
  for (const m of chat.messages || []) {
    if (m.role === 'user') {
      out.push('## ' + L('export.you') + ' · ' + when(m.time), '');
      if (m.text) out.push(quote(m.text), '');
      for (const a of m.attachments || []) out.push('- 📎 ' + (a.path || a.name));
      if ((m.attachments || []).length) out.push('');
      continue;
    }
    out.push('## ' + agentName(m.agent || chat.agent) + ' · ' + when(m.time), '');
    for (const b of m.blocks || []) {
      if (b.type === 'text' && b.text.trim()) out.push(b.text.trim(), '');
      else if (b.type === 'tool') out.push('- 🔧 ' + (b.title || b.name) + (b.status === 'error' ? ' — ' + L('state.error') : ''));
      else if (b.type === 'error') out.push('', '**' + L('common.error') + ':**', fence(b.text), '');
      else if (b.type === 'steer') out.push('', quote(b.text), '');
    }
    if (m.status === 'stopped') out.push('', '_' + L('msg.stopped') + '_');
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// A file name made from the title: no characters Windows refuses, no trailing dots or spaces.
function fileName(chat) {
  const base = String(chat.title || 'chat').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/^[\s↪]+|[\s.]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);
  return (base || 'chat') + '.md';
}

module.exports = { toMarkdown, fileName, agentName };
