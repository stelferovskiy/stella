(function () {
  const ru = window.stellaSiteRu;
  const nodes = document.querySelectorAll('[data-i18n], [data-i18n-aria], [data-i18n-alt]');
  const english = new Map();
  nodes.forEach((node) => english.set(node, {
    text: node.textContent, aria: node.getAttribute('aria-label'), alt: node.getAttribute('alt')
  }));
  const metaDescription = document.querySelector('meta[name="description"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const initialMeta = metaDescription.content;
  const initialOg = ogDescription.content;
  const initialOgTitle = ogTitle.content;
  const initialTitle = document.title;
  function setLanguage(lang) {
    const isRu = lang === 'ru';
    document.documentElement.lang = isRu ? 'ru' : 'en';
    nodes.forEach((node) => {
      const original = english.get(node);
      if (node.dataset.i18n) node.textContent = isRu ? ru[node.dataset.i18n] : original.text;
      if (node.dataset.i18nAria) node.setAttribute('aria-label', isRu ? ru[node.dataset.i18nAria] : original.aria);
      if (node.dataset.i18nAlt) node.setAttribute('alt', isRu ? ru[node.dataset.i18nAlt] : original.alt);
    });
    document.title = isRu ? ru.title : initialTitle;
    metaDescription.content = isRu ? ru.description : initialMeta;
    ogDescription.content = isRu ? ru.ogDescription : initialOg;
    ogTitle.content = isRu ? ru.ogTitle : initialOgTitle;
    document.querySelectorAll('[data-lang]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.lang === lang)));
    try { localStorage.setItem('stella-site-language', lang); } catch (_) {}
  }
  let preferred;
  try { preferred = localStorage.getItem('stella-site-language'); } catch (_) {}
  if (preferred !== 'ru' && preferred !== 'en') preferred = (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  setLanguage(preferred);
  document.querySelectorAll('[data-lang]').forEach((button) => button.addEventListener('click', () => setLanguage(button.dataset.lang)));

  const colors = { '#E0875F': '224,135,95', '#5FB8C9': '95,184,201', '#6FD3A0': '111,211,160', '#6B86FF': '107,134,255', '#E58AC0': '229,138,192', '#C9A86A': '201,168,106' };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const orb = new StellaOrb(document.getElementById('orb'), { count: reduce ? 90 : 210 });
  if (reduce) orb.setState('idle');
  else {
    const states = ['idle', 'thinking', 'streaming', 'tool'];
    let state = 0;
    setInterval(() => { state = (state + 1) % states.length; orb.setState(states[state]); }, 3400);
  }
  document.querySelectorAll('.agent').forEach((button) => {
    button.style.setProperty('--agent-color', button.dataset.color);
    button.addEventListener('click', () => {
      document.querySelectorAll('.agent').forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      const color = button.dataset.color;
      document.documentElement.style.setProperty('--accent', color);
      document.documentElement.style.setProperty('--accent-rgb', colors[color]);
      orb.setColor(color);
    });
  });
})();
