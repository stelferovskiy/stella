// Finds user-facing string literals with Cyrillic text in JS sources (comments and regexes are ignored).
// Usage: node tools/i18n-scan.js [--json]   — exits 1 if any are found (used by `npm run i18n:check`).
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..');
const CYR = /[А-Яа-яЁё]/;
// Files whose Cyrillic is intentional: locale dictionaries and the language-name endonym list.
const IGNORE = [/^src[\\/]locales[\\/]/, /^tools[\\/]/];

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

function scanFile(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true, locations: true });
  const hits = [];
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    const parent = ancestors[ancestors.length - 2];
    if (node.type === 'Literal' && typeof node.value === 'string' && !node.regex && CYR.test(node.value)) {
      // allow: I18N.t('…') style calls never contain Cyrillic keys, so anything here is a hit
      const concat = parent && parent.type === 'BinaryExpression' && parent.operator === '+';
      const kind = /[<>]/.test(node.value) ? 'html' : concat ? 'concat' : 'plain';
      hits.push({ file: rel, line: node.loc.start.line, start: node.start, end: node.end, kind, quote: code[node.start], value: node.value });
    } else if (node.type === 'TemplateLiteral' && node.quasis.some((q) => CYR.test(q.value.cooked || ''))) {
      hits.push({ file: rel, line: node.loc.start.line, start: node.start, end: node.end, kind: 'template', value: code.slice(node.start, node.end) });
    }
  });
  return hits;
}

const all = listFiles().flatMap(scanFile);
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(all, null, 1));
} else {
  for (const h of all) console.log(`${h.file}:${h.line}  [${h.kind}]  ${h.value.slice(0, 100).replace(/\n/g, '\\n')}`);
  console.log(all.length ? `\n${all.length} untranslated string(s). Move them to src/locales and use t('key').` : 'OK: no hard-coded Russian strings.');
}
process.exitCode = all.length ? 1 : 0;
