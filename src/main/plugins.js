// Управление плагинами: Claude Code (claude plugin ...) и MCP-серверы Codex (codex mcp ...).
// Команды выполняются через execFile без оболочки, аргументы проверяются. Установленные плагины
// Claude подхватываются агентом сами: Stella запускает его с настройками пользователя (~/.claude).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const claudeProvider = require('./providers/claude');
const codexProvider = require('./providers/codex');

const ID_RE = /^[\w.@\-]+$/;                 // plugin или plugin@marketplace
const SRC_RE = /^[\w.@:\/\\-~+%?=&#]+$/;     // owner/repo, URL или путь
const NAME_RE = /^[\w.\-]+$/;

function run(file, args, { env, timeout = 240000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { env: Object.assign({}, process.env, env || {}), timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim(), er = String(stderr || '').trim();
      resolve({ ok: !err, out, err: er || (err ? String(err.message || err) : '') });
    });
  });
}

function createPlugins({ store }) {
  const claudeExe = () => claudeProvider.findClaudeExe(store.getSettings());
  const codexJs = () => codexProvider.findCodexJs(store.getSettings());
  const claude = (args, opt) => {
    const exe = claudeExe();
    if (!exe) return Promise.resolve({ ok: false, out: '', err: 'Claude Code не найден. Установите его в панели «Системы».' });
    return run(exe, ['plugin'].concat(args), opt);
  };
  const codex = (args, opt) => {
    const js = codexJs();
    if (!js) return Promise.resolve({ ok: false, out: '', err: 'Codex не найден. Установите его в панели «Системы».' });
    return run(process.execPath, [js].concat(args), Object.assign({ env: { ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' } }, opt));
  };
  const parse = (r, fallback) => { try { return JSON.parse(r.out); } catch (e) { return fallback; } };

  // Каталог: плагины из всех подключённых маркетплейсов (читаем marketplace.json на диске).
  function readCatalog(markets) {
    const items = [];
    for (const m of markets) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(m.installLocation, '.claude-plugin', 'marketplace.json'), 'utf8'));
        for (const p of j.plugins || []) {
          items.push({ id: p.name + '@' + m.name, name: p.name, market: m.name, description: String(p.description || '').slice(0, 280), category: p.category || '', homepage: p.homepage || '' });
        }
      } catch (e) { /* маркетплейс ещё не скачан */ }
    }
    return items;
  }

  async function claudeState() {
    const [pl, mk] = await Promise.all([claude(['list', '--json']), claude(['marketplace', 'list', '--json'])]);
    const installed = parse(pl, []).map((p) => ({ id: p.id, version: p.version, enabled: !!p.enabled, scope: p.scope, notes: p.notes || [] }));
    const markets = parse(mk, []);
    const ids = new Set(installed.map((p) => p.id));
    const catalog = readCatalog(markets).map((c) => Object.assign(c, { installed: ids.has(c.id) }));
    return { ok: pl.ok || mk.ok, error: pl.ok || mk.ok ? '' : (pl.err || mk.err), installed, markets: markets.map((m) => ({ name: m.name, source: m.repo || m.url || m.path || m.source })), catalog };
  }

  async function claudeAction(action, arg) {
    arg = String(arg || '').trim();
    switch (action) {
      case 'install': case 'uninstall': case 'enable': case 'disable': case 'update':
        if (!ID_RE.test(arg)) return { ok: false, err: 'Недопустимое имя плагина.' };
        return claude([action, arg]);
      case 'market-add':
        if (!SRC_RE.test(arg) || arg.startsWith('-')) return { ok: false, err: 'Укажите владельца/репозиторий GitHub, URL или путь.' };
        return claude(['marketplace', 'add', arg]);
      case 'market-remove':
        if (!NAME_RE.test(arg)) return { ok: false, err: 'Недопустимое имя маркетплейса.' };
        return claude(['marketplace', 'remove', arg]);
      case 'market-update':
        return claude(['marketplace', 'update'].concat(NAME_RE.test(arg) ? [arg] : []));
      default: return { ok: false, err: 'Неизвестное действие.' };
    }
  }

  async function codexState() {
    const r = await codex(['mcp', 'list', '--json'], { timeout: 30000 });
    const list = parse(r, []);
    return { ok: r.ok, error: r.ok ? '' : r.err, servers: (Array.isArray(list) ? list : []).map((s) => ({ name: s.name, enabled: s.enabled !== false, transport: s.transport && (s.transport.type || s.transport.url || s.transport.command) || '', detail: s.transport && (s.transport.url || [s.transport.command].concat(s.transport.args || []).join(' ')) || '' })) };
  }

  async function codexAction(action, { name, command, url } = {}) {
    if (!NAME_RE.test(String(name || ''))) return { ok: false, err: 'Имя: латиница, цифры, точка, дефис.' };
    if (action === 'remove') return codex(['mcp', 'remove', name]);
    if (action === 'add') {
      if (url) { if (!/^https?:\/\//i.test(url)) return { ok: false, err: 'Нужен адрес http(s)://…' }; return codex(['mcp', 'add', name, '--url', url]); }
      const parts = String(command || '').trim().match(/"[^"]*"|\S+/g);
      if (!parts) return { ok: false, err: 'Укажите команду запуска или адрес.' };
      return codex(['mcp', 'add', name, '--'].concat(parts.map((p) => p.replace(/^"|"$/g, ''))));
    }
    return { ok: false, err: 'Неизвестное действие.' };
  }

  return { claudeState, claudeAction, codexState, codexAction };
}

module.exports = { createPlugins };
