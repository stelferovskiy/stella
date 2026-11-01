// Main-process translations. Language: settings.language, else the system locale. Strings live in src/locales.
const { createTranslator } = require('../shared/i18n-core');
const dicts = { ru: require('../locales/ru.json'), en: require('../locales/en.json') };

let getSettings = null, systemLocale = 'ru';
function configure(opts) { getSettings = opts.getSettings || getSettings; systemLocale = opts.systemLocale || systemLocale; }
function lang() {
  const l = getSettings && getSettings().language;
  if (l === 'ru' || l === 'en') return l;
  return String(systemLocale || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
const L = createTranslator(dicts, lang);

module.exports = { configure, lang, L, dicts };
