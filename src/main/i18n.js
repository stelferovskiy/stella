// Строки главного процесса (меню трея, уведомления, системные диалоги). Исходный язык — русский.
// Язык берётся из настроек (settings.language), иначе — по языку системы.
const EN = {
  'Открыть Stella': 'Open Stella', 'Новый чат': 'New chat', 'Выход': 'Quit',
  'Папка проекта': 'Project folder', 'Прикрепить файлы': 'Attach files',
  'Stella работает в фоне': 'Stella is running in the background',
  'Окно свёрнуто в трей. Выйти можно через значок в трее.': 'The window is minimized to the tray. Quit via the tray icon.',
  'Stella ждёт подтверждения': 'Stella is waiting for approval', 'Stella · ошибка': 'Stella · error',
  'Stella запускает задачу': 'Stella is running a task', 'Готово': 'Done',
  'Шифрование недоступно в этой системе': 'Encryption is not available on this system',
  'Это не файл': 'Not a file', 'Файл не найден или недоступен': 'File not found or inaccessible'
};

function createI18n({ getSettings, systemLocale }) {
  const lang = () => {
    const l = getSettings && getSettings().language;
    if (l === 'ru' || l === 'en') return l;
    return String(systemLocale || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  };
  const tr = (s) => (lang() === 'en' && EN[s] ? EN[s] : s);
  return { lang, tr };
}

module.exports = { createI18n };
