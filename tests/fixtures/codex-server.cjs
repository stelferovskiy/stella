const readline = require('node:readline');
let writes = Promise.resolve();
const send = (x) => { writes = writes.then(() => { process.stdout.write(JSON.stringify(x) + '\n'); }); };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fixture' } });
  else if (m.method === 'echo') {
    const raw = Buffer.from(JSON.stringify({ id: m.id, result: m.params }) + '\n');
    const i = raw.indexOf(Buffer.from('Привет'));
    if (i >= 0) writes = writes.then(() => new Promise((resolve) => { process.stdout.write(raw.subarray(0, i + 1)); setTimeout(() => { process.stdout.write(raw.subarray(i + 1)); resolve(); }, 5); }));
    else send({ id: m.id, result: m.params });
  } else if (m.method === 'ask') {
    send({ method: 'item/tool/requestUserInput', id: 'server-1', params: { questions: [] } });
    send({ id: m.id, result: {} });
  } else if (m.id === 'server-1') send({ method: 'answered', params: m.result });
  else if (m.method === 'crash') process.exit(7);
  else if (m.method === 'rpcError') send({ id: m.id, error: { code: -32602, message: 'Invalid model' } });
});
