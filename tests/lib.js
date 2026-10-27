'use strict';
/* Utilitários dos testes de integração: sobe o servidor real (banco em arquivo), cliente WebSocket e chamadas da API. */
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), os = require('os');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mk(env) {
  const PORT = 4300 + Math.floor(Math.random() * 600), BASE = 'http://127.0.0.1:' + PORT, DATA = path.join(os.tmpdir(), 'wow3d-test-' + PORT + '.json'); let srv = null, passed = 0, failed = 0;
  const T = {
    BASE, sleep,
    ok(c, msg) { if (c) { passed++; console.log('  ✔', msg); } else { failed++; console.log('  ✘', msg); } },
    async start() {
      srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT, SECRET: 'test', DATABASE_URL: '', DATA_FILE: DATA, ADMIN_USER: 'admtest', ADMIN_EMAIL: 'adm@test.local', WOW_ELITE_CH: '0' }, env || {}), stdio: 'ignore' });
      for (let i = 0; i < 80; i++) { await sleep(150); try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) {} } throw new Error('servidor não subiu'); },
    async stop() { if (!srv) return; const s = srv; srv = null; s.kill('SIGTERM'); await new Promise(r => s.once('exit', r)); },
    async finish() { await T.stop(); try { fs.unlinkSync(DATA); } catch (e) {} console.log('\n' + passed + ' ok, ' + failed + ' falha(s)'); process.exit(failed ? 1 : 0); },
    fail(e) { failed++; console.error('ERRO', e); },
    async api(p, b) { const r = await fetch(BASE + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.1.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); return Object.assign({ status: r.status }, j); },
    async account(name) { const u = name + Math.floor(Math.random() * 1e5); const r = await T.api('register', { username: u, email: u + '@t.local', password: 'segredo1' }); if (!r.token) throw new Error('register ' + JSON.stringify(r)); return r.token; },
    async admin() { const r = await T.api('register', { username: 'admtest', email: 'adm@test.local', password: 'segredo1' }); if (r.token) return r.token; return (await T.api('login', { id: 'admtest', password: 'segredo1' })).token; },
    async hero(token, name, cls) { const r = await T.api('wow/create', { token, name, cls: cls || 'guerreiro', race: 'humano', look: {} }); if (!r.id) throw new Error('create ' + JSON.stringify(r)); return r; },
    client(token, char) { return new Client(BASE, token, char); }
  };
  return T;
}
class Client {
  constructor(base, token, char) { this.base = base; this.msgs = []; this.waiters = []; this.token = token; this.char = char; }
  open() { return new Promise((res, rej) => { const w = this.ws = new WebSocket(this.base.replace('http', 'ws') + '/ws3d'); w.onopen = () => w.send(JSON.stringify({ t: 'hi', token: this.token, char: this.char })); w.onerror = e => rej(e);
    w.onmessage = e => { const m = JSON.parse(e.data); this.msgs.push(m); if (this.msgs.length > 3000) this.msgs.splice(0, 1000); if (m.t === 'eco') this.eco = m; if (m.t === 'hi') res(); for (const f of [...this.waiters]) f(m); }; }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 4000) { return new Promise((res, rej) => { const old = this.msgs.find(pred); if (old) { this.msgs.splice(this.msgs.indexOf(old), 1); return res(old); }
    const f = m => { if (pred(m)) { this.waiters.splice(this.waiters.indexOf(f), 1); const i = this.msgs.indexOf(m); if (i >= 0) this.msgs.splice(i, 1); clearTimeout(t); res(m); } }; this.waiters.push(f); const t = setTimeout(() => { const i = this.waiters.indexOf(f); if (i >= 0) this.waiters.splice(i, 1); rej(new Error('timeout')); }, ms); }); }
  clear() { this.msgs.length = 0; }
  close() { try { this.ws.close(); } catch (e) {} }
  async act(o) { const rq = Math.floor(Math.random() * 1e9); this.send(Object.assign({ t: 'iv', rq }, o)); return this.wait(m => (m.t === 'eco' || m.t === 'ie' || m.t === 'shop') && m.rq === rq); }
  move(x, z, tp) { this.send({ t: 'm', x, z, r: 0, f: 0, tp: tp ? 1 : 0, h: 100 }); }
  async goto(x, z) { this.move(x, z, 1); await sleep(300); for (let i = 0; i < 4; i++) { this.move(x, z, 0); await sleep(80); } }
}
module.exports = { mk, sleep };
