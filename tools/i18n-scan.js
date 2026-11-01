// Localization check. Fails (exit 1) when:
//  - JS sources or index.html contain hard-coded Cyrillic text (comments and regexes are ignored;
//    a line ending with "// i18n-ignore: <reason>" is allowed);
//  - L('key') or data-i18n*="key" refers to a key missing from src/locales/ru.json or en.json;
//  - ru.json and en.json have different keys, different {placeholders} or different plural shapes;
//  - a locale key is never used.
// Usage: node tools/i18n-scan.js [--json]   (also run by `npm test` through tests/i18n.test.js)
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..');
const CYR = /[А-Яа-яЁё]/;
const IGNORE = [/^src[\\/]locales[\\/]/, /^tools[\\/]/];
// Keys built at runtime from a prefix: L('effort.' + level), L('skill.' + id + '.label') and so on.
const DYNAMIC = [/^skill\./, /^directive\.(signIn|addFolder|customizeSkills)$/, /^effort\./, /^day\.\d$/, /^gptImages\.aspect\./];
const ATTR_RE = /data-i18n(?:-title|-placeholder|-aria)?="([\w.]+)"/g;

const loc = { ru: readJson('src/locales/ru.json'), en: readJson('src/locales/en.json') };
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

function listFiles() {
  const out = ['main.js', 'preload.js'];
  (function rec(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) rec(rel);
      else if (e.name.endsWith('.js')) out.push(rel);
    }
  })('src');
  return out.filter((f) => !IGNORE.some((re) => re.test(f)));
}

const problems = [];
const used = new Set();
const allKeys = new Set([...Object.keys(loc.ru), ...Object.keys(loc.en)]);
function useKey(key, where) {
  used.add(key);
  if (loc.ru[key] == null || loc.en[key] == null) problems.push({ where, kind: 'missing-key', value: key });
}

function scanJs(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = code.split(/\r?\n/);
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true, locations: true });
  const ignored = (node) => /\/\/\s*i18n-ignore\b/.test(lines[node.loc.start.line - 1] || '');
  walk.full(ast, (node) => {
    const where = rel + ':' + (node.loc && node.loc.start.line);
    if (node.type === 'CallExpression') {
      const c = node.callee;
      const isL = (c.type === 'Identifier' && c.name === 'L') || (c.type === 'MemberExpression' && !c.computed && c.property.name === 'L');
      const arg = node.arguments[0];
      if (isL && arg && arg.type === 'Literal' && typeof arg.value === 'string') useKey(arg.value, where);
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && !node.regex) {
      if (allKeys.has(node.value)) used.add(node.value);
      for (const m of node.value.matchAll(ATTR_RE)) useKey(m[1], where);
      if (CYR.test(node.value) && !ignored(node)) problems.push({ where, kind: 'hard-coded', value: node.value });
    } else if (node.type === 'TemplateLiteral') {
      for (const q of node.quasis) for (const m of (q.value.cooked || '').matchAll(ATTR_RE)) useKey(m[1], where);
      if (node.quasis.some((q) => CYR.test(q.value.cooked || '')) && !ignored(node)) problems.push({ where, kind: 'hard-coded', value: code.slice(node.start, node.end) });
    }
  });
}

function scanHtml(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  html.split(/\r?\n/).forEach((line, i) => {
    const where = rel + ':' + (i + 1);
    for (const m of line.matchAll(ATTR_RE)) useKey(m[1], where);
    if (CYR.test(line.replace(/<!--.*?-->/g, ''))) problems.push({ where, kind: 'hard-coded', value: line.trim() });
  });
}

function checkLocales() {
  const placeholders = (v) => JSON.stringify([...new Set((typeof v === 'string' ? v : Object.values(v).join(' ')).match(/\{\w+\}/g) || [])].sort());
  for (const key of allKeys) {
    const ru = loc.ru[key], en = loc.en[key];
    const where = 'src/locales:' + key;
    if (ru == null || en == null) { problems.push({ where, kind: 'only-in-' + (ru == null ? 'en' : 'ru'), value: key }); continue; }
    if (typeof ru !== typeof en) problems.push({ where, kind: 'plural-mismatch', value: key });
    if (typeof ru === 'object' && (ru.other == null || en.other == null)) problems.push({ where, kind: 'plural-without-other', value: key });
    if (placeholders(ru) !== placeholders(en)) problems.push({ where, kind: 'placeholder-mismatch', value: key + ' ' + placeholders(ru) + ' / ' + placeholders(en) });
    if (!String(typeof en === 'string' ? en : en.other).trim()) problems.push({ where, kind: 'empty', value: key });
  }
}

listFiles().forEach(scanJs);
scanHtml('src/renderer/index.html');
checkLocales();
for (const key of allKeys) if (!used.has(key) && !DYNAMIC.some((re) => re.test(key))) problems.push({ where: 'src/locales:' + key, kind: 'unused-key', value: key });

if (require.main === module) {
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(problems, null, 1));
  else {
    for (const p of problems) console.log(`${p.where}  [${p.kind}]  ${String(p.value).slice(0, 100).replace(/\n/g, '\\n')}`);
    console.log(problems.length ? `\n${problems.length} localization problem(s). Strings belong in src/locales/*.json and are used via L('key').` : `OK: ${allKeys.size} keys, no hard-coded strings.`);
  }
  process.exitCode = problems.length ? 1 : 0;
}
module.exports = { problems };
