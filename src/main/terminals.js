/* Встроенные терминалы (PowerShell): для входа в аккаунты и ручной работы. */
const fs = require('fs');
const os = require('os');

function createTerminals({ broadcast }) {
  let pty = null;
  function loadPty() { if (!pty) pty = require('@lydell/node-pty'); return pty; }
  const terms = new Map();

  function spawn({ id, command, cwd, cols, rows }) {
    const isWin = process.platform === 'win32';
    const sh = isWin ? 'powershell.exe' : (process.env.SHELL || 'bash');
    const args = isWin
      ? (command ? ['-NoLogo', '-NoExit', '-Command', command] : ['-NoLogo'])
      : (command ? ['-lc', command + '; exec ' + sh] : ['-l']);
    let p;
    try {
      p = loadPty().spawn(sh, args, {
        name: 'xterm-256color',
        cols: cols || 100, rows: rows || 30,
        cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
        env: Object.assign({}, process.env, { FORCE_COLOR: '1' }),
        useConpty: true
      });
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
    terms.set(id, p);
    p.onData((data) => broadcast('term:data', { id, data }));
    p.onExit(({ exitCode }) => { terms.delete(id); broadcast('term:exit', { id, exitCode }); });
    return { ok: true };
  }
  function write(id, data) { const p = terms.get(id); if (p) p.write(data); }
  function resize(id, cols, rows) { const p = terms.get(id); if (p && cols > 0 && rows > 0) { try { p.resize(cols, rows); } catch (e) {} } }
  function kill(id) { const p = terms.get(id); if (p) { try { p.kill(); } catch (e) {} terms.delete(id); } }
  function killAll() { for (const id of [...terms.keys()]) kill(id); }

  return { spawn, write, resize, kill, killAll };
}

module.exports = { createTerminals };
