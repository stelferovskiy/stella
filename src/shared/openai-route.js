/* A conservative task picker for the shared OpenAI entry point. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StellaOpenAiRoute = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function choosePurpose(input) {
    const text = String(input || '').trim().toLowerCase();
    if (!text) return null;
    const imageAction = /\b(draw|illustrate|render|generate|create|edit)\b|нарисуй|изобрази|сгенерируй|создай|создать|измени|отредактируй/i;
    const imageObject = /\b(image|picture|photo|illustration|portrait|poster)\b|картинк|изображени|рисунок|фото|портрет|постер/i;
    const codeAction = /\b(fix|debug|refactor|implement|patch|build|run tests|write code)\b|исправь|почини|отладь|рефактор|реализуй|напиши код|запусти тесты|собери проект/i;
    const codeObject = /\b(code|file|repository|repo|project|app|test|script)\b|код|файл|репозитор|проект|скрипт|тест|\.[a-z]{1,5}\b/i;
    const image = imageAction.test(text) && imageObject.test(text) || /^(?:нарисуй|изобрази|draw|illustrate)(?:\s|$)/i.test(text);
    const code = codeAction.test(text) && codeObject.test(text);
    if (image && code) return null;
    if (image) return 'gpt-images';
    if (code) return 'codex';
    if (/^(?:что|кто|где|когда|почему|зачем|как|расскажи|объясни|what|who|where|when|why|how|tell me|explain)(?:\s|[?!,.]|$)/i.test(text)) return 'chatgpt';
    return null;
  }
  return { choosePurpose };
});
