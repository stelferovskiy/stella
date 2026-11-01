/* Bidirectional JSON-RPC over app-server stdio. Never parse console output as events. */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

class CodexClient extends EventEmitter {
  constructor({ command, args, cwd, env, timeout = 30000 }) {
    super();
    Object.assign(this, { command, args, cwd, env, timeout });
    this.pending = new Map(); this.nextId = 0; this.closed = false; this.stderr = '';
  }
  async start() {
    this.child = spawn(this.command, this.args, { cwd: this.cwd, env: this.env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8'); let buffer = '';
    const parse = (line) => {
      if (!line.trim()) return;
      let m; try { m = JSON.parse(line); } catch (_) { this.emit('warning', 'Некорректное сообщение app-server'); return; }
      if (m.method) this.emit(m.id != null ? 'request' : 'notification', m);
      else if (m.id != null) {
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) { const err = new Error(m.error.message || 'Ошибка Codex RPC'); err.code = m.error.code; err.data = m.error.data; p.reject(err); }
        else p.resolve(m.result);
      }
    };
    this.child.stdout.on('data', (data) => { buffer += decoder.write(data); let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); parse(line); } });
    this.child.stdout.on('end', () => { buffer += decoder.end(); if (buffer.trim()) parse(buffer); });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (data) => { this.stderr = (this.stderr + data).slice(-6000); });
    this.child.stdin.on('error', (err) => this.fail(err));
    this.child.on('error', (err) => this.fail(err));
    this.child.on('close', (code, signal) => {
      const err = new Error('Codex app-server завершился: ' + (signal || code) + (this.stderr ? '\n' + this.stderr : ''));
      this.fail(err); this.closed = true; this.emit('closed', err);
    });
    const result = await this.request('initialize', { clientInfo: { name: 'stella', title: 'Stella', version: require('../../../package.json').version }, capabilities: { experimentalApi: true } });
    this.notify('initialized', {}); return result;
  }
  fail(err) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); }
  write(m) {
    if (this.closed || !this.child || this.child.stdin.destroyed) throw new Error('Codex app-server отключён');
    this.child.stdin.write(JSON.stringify(m) + '\n');
  }
  request(method, params, timeout = this.timeout) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Истекло время ожидания Codex: ' + method)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }
  notify(method, params) { this.write({ method, params }); }
  respond(id, result) { this.write({ id, result }); }
  reject(id, code, message) { this.write({ id, error: { code, message } }); }
  async close() {
    if (this.closePromise) return this.closePromise;
    if (!this.child || this.closed) return;
    this.closed = true; this.fail(new Error('Codex app-server отключён'));
    const child = this.child;
    this.closePromise = new Promise((resolve) => {
      let timer, fallback;
      child.once('close', () => { clearTimeout(timer); clearTimeout(fallback); resolve(); });
      child.stdin.end();
      timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); killer.on('error', () => child.kill());
        } else child.kill('SIGKILL');
        fallback = setTimeout(resolve, 1500);
      }, 1500);
    });
    return this.closePromise;
  }
}
module.exports = { CodexClient };
