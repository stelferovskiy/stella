// DNS только для Stella: локальный HTTP/CONNECT-прокси на 127.0.0.1 со своим резолвером.
// Системный DNS Windows не меняется. Через прокси идут окно (session.setProxy), fetch основного
// процесса (net.fetch) и дочерние процессы Claude/Codex (HTTPS_PROXY в окружении).
// Поддерживаются DNS-over-HTTPS (RFC 8484, wire-формат) и обычный DNS по IP.
const http = require('http');
const https = require('https');
const http2 = require('http2');
const tls = require('tls');
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');

const BUILTIN = [
  { id: 'system', name: 'System', builtin: true },
  { id: 'webshift', name: 'WebShift DoH', doh: 'https://d.webshiftvpn.ru/dns-query', bootstrap: '31.31.207.68', builtin: true }
];

/* ---------- записи DNS ---------- */
function isIp(s) { return net.isIP(String(s || '').trim()) !== 0; }

// Пользовательская запись: { name, address, bootstrap? }, address = DoH-URL или IP через запятую.
function normalizeEntry(e) {
  if (!e || typeof e !== 'object') throw new Error('invalid');
  const name = String(e.name || '').trim().slice(0, 60);
  const address = String(e.address || e.doh || (e.servers || []).join(',') || '').trim();
  const bootstrap = String(e.bootstrap || '').trim();
  if (!name) throw new Error('name');
  const out = { id: String(e.id || 'u' + crypto.randomBytes(4).toString('hex')).replace(/[^\w-]/g, ''), name };
  if (/^https:\/\//i.test(address)) {
    let u; try { u = new URL(address); } catch (_) { throw new Error('address'); }
    if (u.protocol !== 'https:') throw new Error('address');
    out.doh = u.toString();
    if (bootstrap) { if (!isIp(bootstrap)) throw new Error('bootstrap'); out.bootstrap = bootstrap; }
  } else {
    const servers = address.split(/[\s,;]+/).filter(Boolean);
    if (!servers.length || !servers.every((s) => isIp(s) || isIpPort(s))) throw new Error('address');
    out.servers = servers;
  }
  return out;
}
function isIpPort(s) { const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(s); return !!m && isIp(m[1]) && +m[2] > 0 && +m[2] < 65536; }

function listEntries(settings) {
  const custom = ((settings && settings.dns && settings.dns.custom) || []).filter((e) => e && e.id && (e.doh || e.servers));
  return BUILTIN.concat(custom.map((e) => Object.assign({}, e, { builtin: false })));
}
function findEntry(settings, id) { return listEntries(settings).find((e) => e.id === id) || BUILTIN[0]; }

/* ---------- wire-формат DNS ---------- */
function encodeQuery(name, type) {
  const labels = String(name).replace(/\.$/, '').split('.');
  const parts = [Buffer.from([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0])]; // id=0 (RFC 8484 §4.1), RD, 1 вопрос
  for (const l of labels) {
    const b = Buffer.from(l, 'ascii');
    if (!b.length || b.length > 63) throw new Error('bad name');
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0, 0, type, 0, 1]));
  return Buffer.concat(parts);
}

function skipName(buf, off) {
  for (let guard = 0; guard < 128; guard++) {
    if (off >= buf.length) throw new Error('truncated');
    const len = buf[off];
    if (len === 0) return off + 1;
    if ((len & 0xc0) === 0xc0) return off + 2;
    off += len + 1;
  }
  throw new Error('bad name');
}

// -> { rcode, answers: [{ type, ttl, address }] } (только A/AAAA)
function parseResponse(buf) {
  if (buf.length < 12) throw new Error('truncated');
  const rcode = buf[3] & 0x0f;
  const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6);
  let off = 12;
  for (let i = 0; i < qd; i++) off = skipName(buf, off) + 4;
  const answers = [];
  for (let i = 0; i < an; i++) {
    off = skipName(buf, off);
    if (off + 10 > buf.length) throw new Error('truncated');
    const type = buf.readUInt16BE(off), ttl = buf.readUInt32BE(off + 4), len = buf.readUInt16BE(off + 8);
    off += 10;
    if (off + len > buf.length) throw new Error('truncated');
    if (type === 1 && len === 4) answers.push({ type: 4, ttl, address: Array.from(buf.subarray(off, off + 4)).join('.') });
    if (type === 28 && len === 16) {
      const g = []; for (let j = 0; j < 16; j += 2) g.push(buf.readUInt16BE(off + j).toString(16));
      answers.push({ type: 6, ttl, address: net.isIPv6(g.join(':')) ? normalizeV6(g.join(':')) : g.join(':') });
    }
    off += len;
  }
  return { rcode, answers };
}
function normalizeV6(s) { try { return new URL('http://[' + s + ']/').hostname.slice(1, -1); } catch (_) { return s; } }

/* ---------- резолверы ---------- */
// Одно TLS-соединение с ALPN: HTTP/2 (требуется RFC 8484 §5.2, некоторые серверы без него отвечают 400),
// иначе HTTP/1.1. GET ?dns=<base64url> — часть серверов не принимает POST.
function dohQuery(entry, name, type, timeout) {
  const url = new URL(entry.doh);
  url.searchParams.set('dns', encodeQuery(name, type).toString('base64url'));
  const path = url.pathname + url.search;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, buf, status) => {
      if (done) return; done = true; clearTimeout(timer);
      try { sock.destroy(); } catch (_) {}
      if (err) return reject(err);
      if (status !== 200) return reject(new Error('DoH HTTP ' + status));
      try { resolve(parseResponse(buf)); } catch (e) { reject(e); }
    };
    const timer = setTimeout(() => finish(new Error('DoH timeout')), timeout);
    const sock = tls.connect({ host: entry.bootstrap || url.hostname, port: +(url.port || 443), servername: url.hostname, ALPNProtocols: ['h2', 'http/1.1'] });
    sock.once('error', (e) => finish(e));
    sock.once('secureConnect', () => {
      const chunks = [];
      if (sock.alpnProtocol === 'h2') {
        const session = http2.connect(url.origin, { createConnection: () => sock });
        session.on('error', (e) => finish(e));
        const req = session.request({ ':method': 'GET', ':path': path, accept: 'application/dns-message' });
        let status = 0;
        req.on('response', (h) => { status = h[':status']; });
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => { finish(null, Buffer.concat(chunks), status); session.close(); });
        req.on('error', (e) => finish(e));
        req.end();
      } else {
        const req = https.request({ method: 'GET', host: url.hostname, path, headers: { accept: 'application/dns-message', connection: 'close' }, createConnection: () => sock }, (res) => {
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => finish(null, Buffer.concat(chunks), res.statusCode));
        });
        req.on('error', (e) => finish(e));
        req.end();
      }
    });
  });
}

function makeResolver(entry, { timeout = 8000 } = {}) {
  if (!entry || (!entry.doh && !entry.servers)) {
    return { entry: entry || BUILTIN[0], async lookup(host) { const r = await dns.promises.lookup(host, { all: true }); return r.map((x) => x.address); } };
  }
  const cache = new Map();
  let udp = null;
  if (entry.servers) { udp = new dns.promises.Resolver({ timeout, tries: 2 }); udp.setServers(entry.servers); }
  async function query(host, type) {
    if (udp) {
      try { return (await (type === 1 ? udp.resolve4(host, { ttl: true }) : udp.resolve6(host, { ttl: true }))).map((r) => ({ address: r.address, ttl: r.ttl })); }
      catch (e) { if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') return []; throw e; }
    }
    const r = await dohQuery(entry, host, type, timeout);
    if (r.rcode === 3) return [];
    if (r.rcode !== 0) throw new Error('DNS rcode ' + r.rcode);
    return r.answers;
  }
  return {
    entry,
    async lookup(host) {
      host = String(host).toLowerCase().replace(/\.$/, '');
      if (isIp(host)) return [host];
      if (host === 'localhost') return ['127.0.0.1'];
      const hit = cache.get(host);
      if (hit && hit.until > Date.now()) return hit.list;
      let ans = await query(host, 1);
      if (!ans.length) ans = await query(host, 28);
      if (!ans.length) { const e = new Error('ENOTFOUND ' + host); e.code = 'ENOTFOUND'; throw e; }
      const ttl = Math.min(3600, Math.max(30, Math.min(...ans.map((a) => a.ttl || 60))));
      const list = [...new Set(ans.map((a) => a.address))];
      cache.set(host, { list, until: Date.now() + ttl * 1000 });
      return list;
    }
  };
}

/* ---------- прокси ---------- */
function splitHostPort(s, defPort) {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(s) || /^([^:]+)(?::(\d+))?$/.exec(s);
  if (!m) return null;
  return { host: m[1], port: +(m[2] || defPort) };
}

async function connectAny(addresses, port) {
  let last;
  for (const address of addresses.slice(0, 4)) {
    try {
      return await new Promise((resolve, reject) => {
        const s = net.connect({ host: address, port });
        s.setTimeout(10000, () => s.destroy(new Error('connect timeout')));
        s.once('connect', () => { s.setTimeout(0); s.removeAllListeners('error'); resolve(s); });
        s.once('error', reject);
      });
    } catch (e) { last = e; }
  }
  throw last || new Error('no address');
}

// getResolver() вызывается на каждое соединение, поэтому DNS можно сменить без перезапуска прокси.
function startProxy(getResolver) {
  const server = http.createServer(async (req, res) => {
    // обычный HTTP через прокси (абсолютный URI)
    let u; try { u = new URL(req.url); } catch (_) { res.writeHead(400); return res.end(); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end(); }
    try {
      const host = u.hostname.replace(/^\[|\]$/g, '');
      const addrs = await getResolver().lookup(host);
      const headers = Object.assign({}, req.headers); delete headers['proxy-connection']; delete headers['proxy-authorization'];
      const up = http.request({ host: addrs[0], port: u.port || 80, method: req.method, path: u.pathname + u.search, headers, setHost: false }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
  });
  server.on('connect', async (req, client, head) => {
    client.on('error', () => {});
    const hp = splitHostPort(req.url, 443);
    if (!hp) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    try {
      const addrs = await getResolver().lookup(hp.host);
      const up = await connectAny(addrs, hp.port);
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(client); client.pipe(up);
    } catch (e) {
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  });
  server.on('clientError', (_e, s) => { try { s.destroy(); } catch (_) {} });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

/* ---------- окружение дочерних процессов ---------- */
const PROXY_VARS = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy'];
function proxyEnv(port) {
  const p = 'http://127.0.0.1:' + port;
  const no = 'localhost,127.0.0.1,::1';
  return { HTTPS_PROXY: p, HTTP_PROXY: p, https_proxy: p, http_proxy: p, NO_PROXY: no, no_proxy: no };
}

module.exports = { BUILTIN, normalizeEntry, listEntries, findEntry, encodeQuery, parseResponse, makeResolver, startProxy, proxyEnv, PROXY_VARS };
