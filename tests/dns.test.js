const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const http = require('http');
const dns = require('../src/main/dns');

function answer(query, records) {
  // ответ = заголовок запроса с флагами ответа + вопрос + записи (имя через указатель 0xc00c)
  const head = Buffer.from(query.subarray(0, 12));
  head[2] = 0x81; head[3] = 0x80; head.writeUInt16BE(records.length, 6);
  const parts = [head, query.subarray(12)];
  for (const r of records) {
    const rr = Buffer.alloc(12);
    rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(r.type, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(r.ttl || 120, 6); rr.writeUInt16BE(r.data.length, 10);
    parts.push(rr, r.data);
  }
  return Buffer.concat(parts);
}

test('encodeQuery / parseResponse roundtrip with A and AAAA', () => {
  const q = dns.encodeQuery('api.anthropic.com', 1);
  assert.strictEqual(q.readUInt16BE(4), 1);
  const v6 = Buffer.alloc(16); v6[0] = 0x2a; v6[1] = 0x00; v6[15] = 1;
  const r = dns.parseResponse(answer(q, [{ type: 5, data: Buffer.from([0]) }, { type: 1, data: Buffer.from([1, 2, 3, 4]) }, { type: 28, data: v6 }]));
  assert.strictEqual(r.rcode, 0);
  assert.deepStrictEqual(r.answers.map((a) => a.address), ['1.2.3.4', '2a00::1']);
});

test('parseResponse rejects truncated data', () => {
  assert.throws(() => dns.parseResponse(Buffer.alloc(5)));
});

test('normalizeEntry accepts DoH and plain IPs, rejects garbage', () => {
  const d = dns.normalizeEntry({ name: 'My', address: 'https://dns.example/dns-query', bootstrap: '9.9.9.9' });
  assert.strictEqual(d.doh, 'https://dns.example/dns-query');
  assert.strictEqual(d.bootstrap, '9.9.9.9');
  assert.match(d.id, /^u[0-9a-f]{8}$/);
  assert.deepStrictEqual(dns.normalizeEntry({ name: 'CF', address: '1.1.1.1, 8.8.8.8' }).servers, ['1.1.1.1', '8.8.8.8']);
  assert.throws(() => dns.normalizeEntry({ name: '', address: '1.1.1.1' }), /name/);
  assert.throws(() => dns.normalizeEntry({ name: 'x', address: 'http://plain' }), /address/);
  assert.throws(() => dns.normalizeEntry({ name: 'x', address: 'dns.google' }), /address/);
  assert.throws(() => dns.normalizeEntry({ name: 'x', address: 'https://a/b', bootstrap: 'host' }), /bootstrap/);
});

test('findEntry falls back to system for unknown ids', () => {
  const s = { dns: { custom: [{ id: 'u1', name: 'A', servers: ['1.1.1.1'] }] } };
  assert.strictEqual(dns.findEntry(s, 'u1').name, 'A');
  assert.strictEqual(dns.findEntry(s, 'nope').id, 'system');
  assert.strictEqual(dns.listEntries(s).length, dns.BUILTIN.length + 1);
});

test('proxy tunnels CONNECT using the custom resolver', async (t) => {
  const target = net.createServer((s) => s.end('hello'));
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const lookups = [];
  const proxy = await dns.startProxy(() => ({ lookup: async (h) => { lookups.push(h); return ['127.0.0.1']; } }));
  t.after(() => { target.close(); proxy.close(); });
  const data = await new Promise((resolve, reject) => {
    const s = net.connect(proxy.port, '127.0.0.1', () => s.write('CONNECT only-stella.test:' + target.address().port + ' HTTP/1.1\r\nHost: x\r\n\r\n'));
    let buf = ''; s.on('data', (c) => (buf += c)); s.on('end', () => resolve(buf)); s.on('error', reject);
  });
  assert.match(data, /^HTTP\/1\.1 200/);
  assert.match(data, /hello$/);
  assert.deepStrictEqual(lookups, ['only-stella.test']);
});

test('proxy answers 502 when the name does not resolve', async (t) => {
  const proxy = await dns.startProxy(() => ({ lookup: async () => { throw new Error('ENOTFOUND'); } }));
  t.after(() => proxy.close());
  const data = await new Promise((resolve) => {
    const s = net.connect(proxy.port, '127.0.0.1', () => s.write('CONNECT bad.test:443 HTTP/1.1\r\n\r\n'));
    let buf = ''; s.on('data', (c) => (buf += c)); s.on('close', () => resolve(buf));
  });
  assert.match(data, /^HTTP\/1\.1 502/);
});

test('proxy forwards plain HTTP requests', async (t) => {
  const target = http.createServer((req, res) => res.end('path=' + req.url + ' host=' + req.headers.host));
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const proxy = await dns.startProxy(() => ({ lookup: async () => ['127.0.0.1'] }));
  t.after(() => { target.close(); proxy.close(); });
  const port = target.address().port;
  const body = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: proxy.port, path: 'http://site.test:' + port + '/a?b=1', headers: { host: 'site.test:' + port } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b));
    }).on('error', reject);
  });
  assert.strictEqual(body, 'path=/a?b=1 host=site.test:' + port);
});

test('proxyEnv points children at the local proxy and bypasses loopback', () => {
  const e = dns.proxyEnv(1234);
  assert.strictEqual(e.HTTPS_PROXY, 'http://127.0.0.1:1234');
  assert.match(e.NO_PROXY, /127\.0\.0\.1/);
  assert.deepStrictEqual(Object.keys(e).sort(), [...dns.PROXY_VARS].sort());
});
