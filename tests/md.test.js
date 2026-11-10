const test = require('node:test');
const assert = require('node:assert/strict');

global.L = (k) => k;
const MD = require('../src/renderer/md.js');

// Every tag the renderer may produce for a link, exactly as written: anything else means text got into a tag.
const LINK = /^<a href="[^"<>\s]*" target="_blank" rel="noopener">$/;
function assertCleanTags(html) {
  for (const tag of html.match(/<[^>]*>/g) || []) {
    if (tag.startsWith('<a')) assert.match(tag, LINK, 'unexpected link tag: ' + tag);
    else assert.match(tag, /^<\/?(a|p|br|strong|em|del|code|h[2-6]|ul|ol|li|blockquote|hr)>$/, 'unexpected tag: ' + tag);
  }
}

test('an address inside a link target cannot add attributes to the link', () => {
  for (const src of [
    '[click](https://x.test/(https://e.test/style=position:fixed;inset:0/data-action=install-codex/)',
    '[t](https://x.test/![a](https://y.test/onmouseover=1/style=x))',
    '[t](https://x.test/`c`/(https://e.test/data-ap=allow)',
    '![a](https://x.test/(https://e.test/data-ap=allow)',
    '\u00000\u0000 [a](https://x.test) \u00001\u0000'
  ]) {
    const html = MD.render(src);
    assertCleanTags(html);
    assert.ok(!html.includes('\u0000'), 'placeholder left in output');
  }
});

test('links, auto-links and code still render', () => {
  assert.equal(MD.render('see [docs](https://ok.test/a_b?x=1&y=2) now'), '<p>see <a href="https://ok.test/a_b?x=1&amp;y=2" target="_blank" rel="noopener">docs</a> now</p>');
  assert.equal(MD.render('open https://ok.test/page.'), '<p>open <a href="https://ok.test/page" target="_blank" rel="noopener">https://ok.test/page</a>.</p>');
  assert.equal(MD.render('**b** and `x < y`'), '<p><strong>b</strong> and <code>x &lt; y</code></p>');
  assert.equal(MD.render('[**bold** link](https://ok.test)'), '<p><a href="https://ok.test" target="_blank" rel="noopener"><strong>bold</strong> link</a></p>');
});

test('emphasis markers inside an address do not rewrite it', () => {
  const html = MD.render('https://ok.test/a**b**c and [x](https://ok.test/__init__)');
  assertCleanTags(html);
  assert.ok(html.includes('href="https://ok.test/a**b**c"'));
  assert.ok(html.includes('href="https://ok.test/__init__"'));
});

test('raw HTML and script addresses stay text', () => {
  const html = MD.render('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assertCleanTags(html);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript'));
});
