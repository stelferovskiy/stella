/* Shared translation core for the main process, preload and renderer.
   Dictionaries are flat maps: key -> string | { one, few, many, other }.
   Placeholders: {name}. Plural forms are picked by params.n via Intl.PluralRules. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StellaI18nCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FALLBACK = 'ru';
  function format(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
  }
  function createTranslator(dicts, getLang) {
    const rules = {};
    const has = (key) => (dicts[getLang()] && dicts[getLang()][key] != null) || (dicts[FALLBACK] && dicts[FALLBACK][key] != null);
    function L(key, params) {
      const lang = getLang();
      let v = dicts[lang] && dicts[lang][key];
      if (v == null && dicts[FALLBACK]) v = dicts[FALLBACK][key];
      if (v == null) return key;
      if (typeof v === 'object') {
        const pr = rules[lang] || (rules[lang] = new Intl.PluralRules(lang));
        v = v[pr.select(Number(params && params.n) || 0)] ?? v.other ?? v.many ?? '';
      }
      return format(v, params);
    }
    L.has = has;
    return L;
  }
  return { createTranslator, format };
});
