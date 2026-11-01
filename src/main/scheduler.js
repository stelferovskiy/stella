/* Задачи по расписанию: запускаются, пока Stella открыта (в том числе свёрнутой в трей). */
const { L } = require('./i18n');

function createScheduler({ store, runner, broadcast, notify }) {
  let timer = null;

  function stamp(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes();
  }

  function runTask(task) {
    const settings = store.getSettings();
    const chat = store.createChat({ agent: task.agent || 'claude', cwd: task.cwd || settings.currentProject, title: L('schedule.chatTitle', { name: task.name }), scheduled: true });
    broadcast('chats:changed', store.saveChat(chat));
    notify({ title: L('notify.taskStarting'), body: task.name, chatId: chat.id, onlyIfHidden: true });
    runner.send(chat.id, { text: task.prompt, attachments: [], mode: task.mode || undefined }).catch(() => {});
    // вернуть сохранённое название: send переименовывает пустой чат по первому сообщению
    const c = store.getChat(chat.id);
    if (c) { c.title = L('schedule.chatTitle', { name: task.name }); store.saveChat(c); }
    return chat.id;
  }

  function tick() {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const tasks = store.getTasks();
    let changed = false;
    for (const t of tasks) {
      if (!t.enabled || t.time !== hhmm) continue;
      if (Array.isArray(t.days) && t.days.length && t.days.indexOf(now.getDay()) === -1) continue;
      if (t.lastRun === stamp(now)) continue;
      t.lastRun = stamp(now);
      changed = true;
      try { runTask(t); } catch (e) {}
    }
    if (changed) { store.saveTasks(tasks); broadcast('tasks:changed', tasks); }
  }

  function start() { if (!timer) { timer = setInterval(tick, 20000); tick(); } }
  function stop() { clearInterval(timer); timer = null; }

  return { start, stop, runTask };
}

module.exports = { createScheduler };
