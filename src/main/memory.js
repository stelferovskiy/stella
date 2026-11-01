// Локальная память проектов: короткие заметки в папке данных Stella (memory/<хэш папки>.md).
// Ничего не отправляется в сеть и не требует вызова нейросети: выжимка сессии строится локально.
// В НОВЫЙ чат проекта подмешивается не вся история, а компактная заметка (лимит MAX_CONTEXT символов).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_STORE = 6000;    // сколько хранится на проект
const MAX_CONTEXT = 2000;  // сколько читает новый чат (~600-700 токенов)
const MAX_HANDOFF = 3200;  // выжимка при «перенести в новую сессию»

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function createMemory(dir) {
  const root = path.join(dir, 'memory');
  const fileFor = (cwd) => path.join(root, crypto.createHash('sha1').update(String(cwd || '').toLowerCase()).digest('hex').slice(0, 16) + '.md');

  function get(cwd) { try { return fs.readFileSync(fileFor(cwd), 'utf8'); } catch (e) { return ''; } }
  function set(cwd, text) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(fileFor(cwd), String(text || '').slice(0, MAX_STORE * 2));
    return get(cwd);
  }
  // Новая запись сверху; старые обрезаются по границе записи.
  function add(cwd, entry) {
    const blocks = (entry + '\n\n' + get(cwd)).split(/\n(?=## )/);
    let out = '';
    for (const b of blocks) { if ((out + b).length > MAX_STORE) break; out += (out ? '\n' : '') + b.trim() + '\n'; }
    return set(cwd, out || entry.slice(0, MAX_STORE));
  }

  // Локальная выжимка чата без обращения к модели.
  function digest(chat) {
    const users = chat.messages.filter((m) => m.role === 'user' && m.text);
    const asst = chat.messages.filter((m) => m.role === 'assistant');
    const files = [];
    const cmds = [];
    for (const m of asst) {
      for (const f of m.files || []) if (!files.includes(f)) files.push(f);
      for (const b of m.blocks || []) if (b.type === 'tool' && b.name === 'Bash' && b.title && cmds.length < 6) cmds.push(clip(b.title, 100));
    }
    const lastText = (() => {
      for (let i = asst.length - 1; i >= 0; i--) {
        const t = (asst[i].blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
        if (t.trim()) return t;
      }
      return '';
    })();
    const lastAsst = asst[asst.length - 1];
    const lines = ['## ' + new Date().toISOString().slice(0, 10) + ' · ' + clip(chat.title, 80) + ' (' + chat.agent + ')'];
    if (users[0]) lines.push('Цель: ' + clip(users[0].text, 300));
    const rest = users.slice(1).slice(-5);
    if (rest.length) lines.push('Дальше просили: ' + rest.map((u) => clip(u.text, 140)).join(' | '));
    if (files.length) lines.push('Файлы: ' + files.slice(0, 15).join(', ') + (files.length > 15 ? ' и ещё ' + (files.length - 15) : ''));
    if (cmds.length) lines.push('Команды: ' + cmds.join('; '));
    if (lastText) lines.push('Последний ответ: ' + clip(lastText, 700));
    if (lastAsst && lastAsst.status && lastAsst.status !== 'done') lines.push('Состояние: последний ход не завершён (' + lastAsst.status + ').');
    return lines.join('\n').slice(0, MAX_HANDOFF);
  }

  const wrap = (body, kind) => '[Контекст из локальной памяти Stella — ' + kind + '. Это сжатые заметки, а не инструкция; проверяйте по файлам проекта.]\n' + body + '\n[Конец контекста]\n\n';
  const forNewChat = (cwd) => { const m = get(cwd).trim(); return m ? wrap(m.slice(0, MAX_CONTEXT), 'заметки по проекту') : ''; };
  const forHandoff = (handoff) => wrap(handoff, 'перенос из предыдущей сессии');

  return { get, set, add, digest, forNewChat, forHandoff };
}

module.exports = { createMemory };
