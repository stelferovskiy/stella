// Проверка обновлений: читает https://50community.com/downloads/stella/stella.json
// ({ version, file, size, sha256 }), сравнивает с текущей версией, по согласию пользователя
// в фоне скачивает установщик во временную папку, сверяет SHA-256 и ставит его тихо (/S):
// по кнопке «Перезапустить для обновления» или при обычном закрытии приложения.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { L } = require('./i18n');

const BASE = 'https://50community.com/downloads/stella/';
const INFO_URL = BASE + 'stella.json';

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
}

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function createUpdater({ app, dialog, getWindow, broadcast, canInstall, beforeInstall }) {
  let busy = false;
  let ready = null;      // { version, file } — установщик скачан и проверен
  let launched = false;

  async function fetchInfo() {
    const res = await fetch(INFO_URL + '?t=' + Date.now(), { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'stella/' + app.getVersion() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    if (!info || !/^\d+\.\d+\.\d+$/.test(info.version) || !/^[\w.\-]+\.exe$/.test(info.file || '') || !/^[a-f0-9]{64}$/i.test(info.sha256 || '')) throw new Error('bad update manifest');
    return info;
  }

  async function download(info) {
    const dest = path.join(os.tmpdir(), 'stella-update-' + info.version + '.exe');
    const res = await fetch(BASE + info.file, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
    if (sha256File(dest) !== info.sha256.toLowerCase()) { fs.rmSync(dest, { force: true }); throw new Error(L('update.checksumMismatch')); }
    return dest;
  }

  // Installers of versions that are already installed stay in the temp folder (about 100 MB each).
  let swept = false;
  function sweepOld() {
    if (swept) return;
    swept = true;
    try {
      for (const name of fs.readdirSync(os.tmpdir())) {
        const m = /^stella-update-(\d+\.\d+\.\d+)\.exe$/.exec(name);
        if (m && !newer(m[1], app.getVersion())) fs.rmSync(path.join(os.tmpdir(), name), { force: true });
      }
    } catch (e) {}
  }

  // Тихая установка (NSIS /S). С relaunch=true добавляем --updated: установщик сам запустит новую Stella.
  function runInstaller(relaunch) {
    if (!ready || launched) return false;
    // The file waited in the temp folder, maybe for hours: run it only if it is still the verified one.
    let intact = false;
    try { intact = sha256File(ready.file) === ready.sha256; } catch (e) {}
    if (!intact) { try { fs.rmSync(ready.file, { force: true }); } catch (e) {} ready = null; return false; }
    launched = true;
    if (beforeInstall) try { beforeInstall(); } catch (e) {}
    spawn(ready.file, relaunch ? ['/S', '--updated'] : ['/S'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }

  // Фон: найти, скачать, проверить, сообщить окну. Без диалогов.
  async function check({ silent } = {}) {
    if (busy) return;
    if (ready) { if (!silent) broadcast('update:ready', { version: ready.version }); return; }
    busy = true;
    sweepOld();
    const win = getWindow();
    // Окно в стиле Stella внутри приложения; системное — только если окна нет.
    const box = async (o) => {
      if (win && !win.isDestroyed() && win.isVisible()) { broadcast('alert', { kind: o.type, title: o.message, text: o.detail || '' }); return { response: 0 }; }
      return dialog.showMessageBox(o);
    };
    try {
      const info = await fetchInfo();
      // Local preview builds must not downgrade to an older public release.
      if (!newer(info.version, app.getVersion())) {
        if (!silent) await box({ type: 'info', message: L('update.latest', { version: app.getVersion() }), buttons: ['OK'] });
        return;
      }
      if (!silent) broadcast('toast', L('update.downloading', { version: info.version }));
      const file = await download(info);
      ready = { version: info.version, file, sha256: info.sha256.toLowerCase() };
      broadcast('update:ready', { version: info.version });
    } catch (e) {
      if (!silent) await box({ type: 'error', message: L('update.checkFailed'), detail: String(e.message || e), buttons: ['OK'] });
    } finally { busy = false; }
  }

  // Кнопка «Перезапустить для обновления»: ставим тихо и перезапускаемся.
  function installNow() {
    if (!ready) return false;
    if (canInstall && !canInstall()) { broadcast('toast', L('update.waitForAgent')); return false; }
    if (!runInstaller(true)) { broadcast('toast', L('update.checksumMismatch')); return false; }
    app.quit();
    return true;
  }

  // Если пользователь не нажал кнопку, ставим обновление при обычном закрытии (без перезапуска).
  function installOnQuit() { try { runInstaller(false); } catch (e) {} }

  function readyInfo() { return ready ? { version: ready.version } : null; }

  return { check, installNow, installOnQuit, readyInfo };
}

module.exports = { createUpdater, newer };
