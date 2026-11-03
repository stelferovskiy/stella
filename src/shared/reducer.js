/* Общая логика сообщений: одна и та же в основном процессе и в интерфейсе. */
(function (root) {
  function lastBlock(msg) { return msg.blocks[msg.blocks.length - 1]; }

  function findByKey(msg, key) {
    if (key == null || key === '') return null;
    for (let i = msg.blocks.length - 1; i >= 0; i--) if (msg.blocks[i].key === key) return msg.blocks[i];
    return null;
  }

  function apply(msg, ev) {
    if (!msg.blocks) msg.blocks = [];
    switch (ev.t) {
      case 'text': {
        // поток текста: дописываем в последний текстовый блок
        const b = lastBlock(msg);
        if (b && b.type === 'text' && !b.key) b.text += ev.text;
        else msg.blocks.push({ type: 'text', text: ev.text });
        break;
      }
      case 'text-set': {
        const b = findByKey(msg, ev.key);
        if (b) b.text = ev.text; else msg.blocks.push({ type: 'text', key: ev.key, text: ev.text });
        break;
      }
      case 'thinking': {
        const b = lastBlock(msg);
        if (b && b.type === 'thinking' && !b.key) b.text += ev.text;
        else msg.blocks.push({ type: 'thinking', text: ev.text });
        break;
      }
      case 'thinking-set': {
        const b = findByKey(msg, ev.key);
        if (b) b.text = ev.text; else msg.blocks.push({ type: 'thinking', key: ev.key, text: ev.text });
        break;
      }
      case 'tool': {
        const b = findByKey(msg, ev.id);
        if (b) { b.title = ev.title || b.title; b.detail = ev.detail != null ? ev.detail : b.detail; }
        else msg.blocks.push({ type: 'tool', key: ev.id, name: ev.name, title: ev.title, detail: ev.detail || '', output: '', status: 'running' });
        break;
      }
      case 'tool-result': {
        const b = findByKey(msg, ev.id);
        if (b) { b.output = ev.output || ''; b.status = ev.isError ? 'error' : 'done'; }
        break;
      }
      case 'user-input': {
        if (!findByKey(msg, ev.reqId)) msg.blocks.push({ type: 'user-input', key: ev.reqId, questions: ev.questions || [], status: msg.status && msg.status !== 'running' ? 'expired' : 'pending' });
        break;
      }
      case 'user-input-resolved': {
        const b = findByKey(msg, ev.reqId);
        if (b && b.type === 'user-input') b.status = ev.status === 'expired' ? 'expired' : 'resolved';
        else if (!b) msg.blocks.push({ type: 'user-input', key: ev.reqId, questions: [], status: ev.status === 'expired' ? 'expired' : 'resolved' });
        break;
      }
      case 'approval':
        msg.blocks.push({ type: 'approval', key: ev.reqId, title: ev.title, detail: ev.detail || '', status: 'pending' });
        break;
      case 'approval-resolved': {
        const b = findByKey(msg, ev.reqId);
        if (b) b.status = ev.status;
        break;
      }
      case 'error':
        msg.blocks.push({ type: 'error', text: ev.text, action: ev.action || null });
        break;
      case 'steer':
        // a message the user typed while the agent was working; it joined the running turn
        msg.blocks.push({ type: 'steer', text: ev.text || '', time: ev.time || Date.now() });
        break;
      case 'files': {
        msg.files = msg.files || [];
        for (const p of ev.paths || []) if (p && msg.files.indexOf(p) === -1) msg.files.push(p);
        break;
      }
      case 'done':
        msg.status = ev.status || 'done';
        if (ev.usage) msg.usage = ev.usage;
        // незавершённые инструменты и запросы закрываем
        for (const b of msg.blocks) {
          if (b.type === 'tool' && b.status === 'running') b.status = msg.status === 'done' ? 'done' : 'error';
          if ((b.type === 'approval' || b.type === 'user-input') && b.status === 'pending') b.status = 'expired';
        }
        break;
      default:
        break;
    }
    return msg;
  }

  const api = { apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StellaReducer = api;
})(typeof window !== 'undefined' ? window : this);
