/* Interface translations (ru / en). Strings live in src/locales/*.json and are exposed by preload.
   Code calls L('key', { param }); static HTML uses data-i18n, data-i18n-title, data-i18n-placeholder
   and data-i18n-aria (aria-label). Chat content and user text are never translated. Switching the
   language reloads the window. */
(function () {
  const KEY = 'stella.lang';
  const sys = (navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  let lang = (function () { try { return localStorage.getItem(KEY) || sys; } catch (e) { return sys; } })();
  if (lang !== 'ru' && lang !== 'en') lang = sys;

  const dicts = window.stellaLocales || { ru: {}, en: {} };
  const L = window.StellaI18nCore.createTranslator(dicts, () => lang);
  const ATTRS = [['i18nTitle', 'title'], ['i18nPlaceholder', 'placeholder'], ['i18nAria', 'aria-label']];

  // Translates every element under root that carries data-i18n* attributes.
  function apply(root) {
    root = root || document;
    const nodes = root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria]');
    const all = root.nodeType === 1 && root.matches('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria]') ? [root, ...nodes] : nodes;
    for (const el of all) {
      if (el.dataset.i18n) el.textContent = L(el.dataset.i18n);
      for (const [data, attr] of ATTRS) if (el.dataset[data]) el.setAttribute(attr, L(el.dataset[data]));
    }
    return root;
  }

  window.L = L;
  window.I18N = {
    get lang() { return lang; },
    get locale() { return L('locale'); },
    L,
    apply,
    // Remember the language synchronously so the next start does not flash the old one.
    set(next) { try { localStorage.setItem(KEY, next); } catch (e) {} return next !== lang; }
  };
  document.documentElement.lang = lang;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply()); else apply();
})();
