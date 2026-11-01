/* Безопасный Markdown → HTML: сначала экранируем всё, потом размечаем. Сырой HTML не пропускается. */
(function (root) {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    const url = u.replace(/&amp;/g, '&').trim();
    return /^(https?:\/\/|mailto:)/i.test(url) ? esc(url) : null;
  }

  function inline(text) {
    // text уже экранирован
    const codes = [];
    let s = text.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => { const url = safeUrl(u); return url ? '<a href="' + url + '" target="_blank" rel="noopener">' + (alt || url) + '</a>' : m; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const url = safeUrl(u); return url ? '<a href="' + url + '" target="_blank" rel="noopener">' + t + '</a>' : m; });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => pre + '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
    return s;
  }

  function splitRow(line) {
    let l = line.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|')) l = l.slice(0, -1);
    return l.split('|').map((c) => c.trim());
  }

  function render(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let codeId = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/);
      if (fence) {
        const mark = fence[1];
        const lang = fence[2] || '';
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(mark)) { body.push(lines[i]); i++; }
        i++;
        const code = body.join('\n');
        out.push('<div class="code" data-lang="' + esc(lang) + '"><div class="code-bar"><span>' + esc(lang || L('md.code')) + '</span><span class="code-actions">' +
          (/^html?$/i.test(lang) ? '<button type="button" class="code-btn" data-act="preview">' + esc(L('preview.title')) + '</button>' : '') +
          '<button type="button" class="code-btn" data-act="copy">' + esc(L('common.copy')) + '</button></span></div><pre><code id="cb' + (codeId++) + '">' + esc(code) + '</code></pre></div>');
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { const n = Math.min(h[1].length + 1, 6); out.push('<h' + n + '>' + inline(esc(h[2])) + '</h' + n + '>'); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => '<th>' + inline(esc(c)) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m) {
            let content = m[3];
            const task = content.match(/^\[([ xX])\]\s+(.*)$/);
            if (task) content = (task[1] === ' ' ? '<span class="task"></span>' : '<span class="task done"></span>') + inline(esc(task[2]));
            else content = inline(esc(content));
            items.push({ indent: m[1].length, html: content });
            i++;
          } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1].html += ' ' + inline(esc(lines[i].trim()));
            i++;
          } else break;
        }
        out.push(buildList(items, ordered));
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])) { para.push(lines[i]); i++; }
      if (!para.length) { para.push(lines[i]); i++; }
      out.push('<p>' + para.map((l) => inline(esc(l))).join('<br>') + '</p>');
    }
    return out.join('');
  }

  function buildList(items, ordered) {
    const tag = ordered ? 'ol' : 'ul';
    let html = '';
    const stack = [];
    for (const it of items) {
      const level = Math.floor(it.indent / 2);
      if (!stack.length) { html += '<' + tag + '>'; stack.push(level); }
      else if (level > stack[stack.length - 1]) { html += '<' + tag + '>'; stack.push(level); }
      else {
        while (stack.length > 1 && level < stack[stack.length - 1]) { html += '</li></' + tag + '>'; stack.pop(); }
        html += '</li>';
      }
      html += '<li>' + it.html;
    }
    while (stack.length) { html += '</li></' + tag + '>'; stack.pop(); }
    return html;
  }

  const api = { render, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StellaMD = api;
})(typeof window !== 'undefined' ? window : this);
