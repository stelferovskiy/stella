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

const BASE = 'https://50community.com/downloads/stella/';
const INFO_URL = BASE + 'stella.json';

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
}

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
    const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    if (hash.toLowerCase() !== info.sha256.toLowerCase()) { fs.rmSync(dest, { force: true }); throw new Error('Контрольная сумма не совпала'); }
    return dest;
  }

  // Тихая установка (NSIS /S). С relaunch=true добавляем --updated: установщик сам запустит новую Stella.
  function runInstaller(relaunch) {
    if (!ready || launched) return false;
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
    const win = getWindow();
    // Окно в стиле Stella внутри приложения; системное — только если окна нет.
    const box = async (o) => {
      if (win && !win.isDestroyed() && win.isVisible()) { broadcast('alert', { kind: o.type, title: o.message, text: o.detail || '' }); return { response: 0 }; }
      return dialog.showMessageBox(o);
    };
    try {
      const info = await fetchInfo();
      // «Отличается», а не «больше»: нумерация версий могла быть пересмотрена (2.5.0 -> 1.5.0).
      if (info.version === app.getVersion()) {
        if (!silent) await box({ type: 'info', message: 'Установлена последняя версия (' + app.getVersion() + ').', buttons: ['OK'] });
        return;
      }
      if (!silent) broadcast('toast', 'Найдена версия ' + info.version + ', скачиваю в фоне…');
      const file = await download(info);
      ready = { version: info.version, file };
      broadcast('update:ready', { version: info.version });
    } catch (e) {
      if (!silent) await box({ type: 'error', message: 'Не удалось проверить обновления', detail: String(e.message || e), buttons: ['OK'] });
    } finally { busy = false; }
  }

  // Кнопка «Перезапустить для обновления»: ставим тихо и перезапускаемся.
  function installNow() {
    if (!ready) return false;
    if (canInstall && !canInstall()) { broadcast('toast', 'Дождитесь ответа агента: при перезапуске он остановится.'); return false; }
    if (runInstaller(true)) app.quit();
    return true;
  }

  // Если пользователь не нажал кнопку, ставим обновление при обычном закрытии (без перезапуска).
  function installOnQuit() { try { runInstaller(false); } catch (e) {} }

  function readyInfo() { return ready ? { version: ready.version } : null; }

  return { check, installNow, installOnQuit, readyInfo };
}

module.exports = { createUpdater, newer };
