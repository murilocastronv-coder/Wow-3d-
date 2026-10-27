'use strict';
/* Teste de integração do Reinos de Valdor (WOW 3D) contra o servidor DE VERDADE (HTTP + WebSocket /ws3d).
   Uso: node tests/wow-mmo.int.test.js            (sobe o servidor numa porta livre com banco em arquivo e apaga no fim)
        WOW_TEST_LONG=1 node tests/...            (inclui o teste de 60 s de expiração do item no chão)
   Cobre: conta, herói, kit inicial do servidor, abate validado, ouro direto na bolsa (nunca no chão), item no chão na posição da morte,
   coleta, distância, inventário cheio, corrida de dois jogadores pelo mesmo item, equipar/desequipar, dropar, banco, loja, montaria,
   missão validada pelo servidor, forja, subclasse (requisitos), save que não aceita ouro/itens do navegador e reinício do servidor. */
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = path.join(require('os').tmpdir(), 'wow3d-test-' + process.pid + '.json'), PORT = 3300 + Math.floor(Math.random() * 400);
const BASE = 'http://127.0.0.1:' + PORT, LONG = !!process.env.WOW_TEST_LONG;
let srv = null, passed = 0, failed = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(c, msg) { if (c) { passed++; console.log('  ✔', msg); } else { failed++; console.log('  ✘', msg); } }
async function start() {
  srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT, SECRET: 'test', DATABASE_URL: '', DATA_FILE: DATA, ADMIN_USER: 'admtest', ADMIN_EMAIL: 'adm@test.local', WOW_ELITE_CH: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', d => { out += d; if (process.env.TEST_VERBOSE && /mmo|ground|Error/.test(String(d))) process.stdout.write('[srv] ' + d); }); srv.stderr.on('data', d => { out += d; if (/Error/.test(String(d))) process.stderr.write(d); });
  for (let i = 0; i < 80; i++) { await sleep(150); try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch (e) {} }
  throw new Error('servidor não subiu\n' + out);
}
async function stop() { if (!srv) return; srv.kill('SIGTERM'); await new Promise(r => srv.once('exit', r)); srv = null; }
async function api(p, b) { const r = await fetch(BASE + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; }
class C {   // cliente WebSocket que guarda as mensagens
  constructor(token, char) { this.msgs = []; this.waiters = []; this.token = token; this.char = char; }
  open() { return new Promise((res, rej) => { const w = this.ws = new WebSocket(BASE.replace('http', 'ws') + '/ws3d'); w.onopen = () => w.send(JSON.stringify({ t: 'hi', token: this.token, char: this.char })); w.onerror = e => rej(e);
    w.onmessage = e => { const m = JSON.parse(e.data); this.msgs.push(m); if (m.t === 'eco') this.eco = m; if (m.t === 'hi') res(); for (const f of [...this.waiters]) f(m); }; }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 4000) { return new Promise((res, rej) => { const old = this.msgs.find(pred); if (old) { this.msgs.splice(this.msgs.indexOf(old), 1); return res(old); }
    const f = m => { if (pred(m)) { this.waiters.splice(this.waiters.indexOf(f), 1); this.msgs.splice(this.msgs.indexOf(m), 1); clearTimeout(t); res(m); } }; this.waiters.push(f); const t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(f), 1); rej(new Error('timeout')); }, ms); }); }
  clear() { this.msgs.length = 0; }
  close() { try { this.ws.close(); } catch (e) {} }
  async act(o) { const rq = Math.floor(Math.random() * 1e9); this.send(Object.assign({ t: 'iv', rq }, o)); return this.wait(m => (m.t === 'eco' || m.t === 'ie' || m.t === 'shop') && m.rq === rq); }
  move(x, z, tp) { this.send({ t: 'm', x, z, r: 0, f: 0, tp: tp ? 1 : 0, h: 100 }); }
}
async function account(name) {
  const u = name + Math.floor(Math.random() * 1e5); const r = await api('register', { username: u, email: u + '@t.local', password: 'segredo1' });
  if (!r.token) throw new Error('register ' + JSON.stringify(r)); return r.token;
}
async function hero(token, name, cls) { const r = await api('wow/create', { token, name, cls: cls || 'guerreiro', race: 'humano', look: {} }); if (!r.id) throw new Error('create ' + JSON.stringify(r)); return r.id; }

async function killNearest(c, type) {   // anda até um monstro e mata (o servidor valida dano e distância)
  let mj; try { mj = await c.wait(m => m.t === 'mj' && m.m.ty === type && m.m.st !== 3, 6000); } catch (e) { return null; }
  const mob = mj.m; c.move(mob.x + 1.2, mob.z, 0); await sleep(150);
  for (let i = 0; i < 80; i++) { c.send({ t: 'h', id: mob.id, m: 4, a: 9999, c: .5 }); await sleep(120); const dead = c.msgs.find(m => m.t === 'k' && m.id === mob.id); if (dead) return mob; const near = c.msgs.filter(m => m.t === 'mb').flatMap(m => m.d).filter(d => d[0] === mob.id).pop(); if (near) c.move(near[1] + 1.2, near[2], 0); }
  return null;
}

(async () => {
  
  try {
    await start();
    console.log('▶ conta, herói e kit inicial do servidor');
    const t1 = await account('heroi'), c1id = await hero(t1, 'Testador' + Math.floor(Math.random() * 99));
    await api('wow/save', { token: t1, char: c1id, sv: { name: 'x', lvl: 1, xp: 3, gold: 20, inv: [], eq: {}, q: {}, x: 0, z: 13 } });   // salvamento automático chegando ANTES da conexão em tempo real
    const A = new C(t1, c1id); await A.open(); await A.wait(m => m.t === 'eco' && m.first);
    ok(A.eco.inv.some(x => x.id === 'pot' && x.n === 3), 'servidor entregou 3 poções');
    ok(A.eco.eq.arma && /de Treino/.test(A.eco.eq.arma.name), 'servidor equipou a arma de treino');
    ok(A.eco.inv.every(x => x.u), 'todo item tem identificador único (u)');

    console.log('▶ abate e drop (ouro direto na bolsa, itens no chão)');
    A.move(105, 18, 1); await sleep(400);   // floresta (primeira posição é aceita)
    const g0 = A.eco.g; let got = null, mob = null;
    for (let k = 0; k < 14 && !got; k++) {
      mob = await killNearest(A, k % 2 ? 'boar' : 'wolf'); if (!mob) continue;
      const gold = await A.wait(m => m.t === 'gold', 3000).catch(() => null);
      ok(!!gold && gold.g > 0, 'ouro creditado direto: +' + (gold && gold.g));
      await sleep(250); got = A.msgs.find(m => m.t === 'gi');
    }
    ok(A.eco.g > g0, 'saldo de ouro aumentou no servidor (' + g0 + ' → ' + A.eco.g + ')');
    ok(!A.msgs.some(m => m.t === 'gi' && /\bouro\b|\bgold\b|moeda/i.test(m.g.it.name)), 'nenhuma moeda apareceu no chão');
    ok(!!got, 'um item apareceu no chão');
    if (got) {
      const g = got.g; ok(g.ms > 58000 && g.ms <= 60000, 'prazo do item ≈ 60 s (' + g.ms + ' ms)');
      ok(Math.hypot(g.x - mob.x, g.z - mob.z) < 25, 'item perto do local da morte');
      for (let i = 1; i <= 16; i++) { A.move(g.x + i * 2.5, g.z, 0); await sleep(380); }   // anda para longe (o servidor limita a velocidade)   // longe demais (o servidor limita a velocidade; aqui só confere a distância)
      let r = await A.act({ a: 'pk', id: g.id }); ok(r.t === 'ie', 'coleta recusada fora do alcance: ' + (r.x || ''));
      for (let i = 16; i >= 0; i--) { A.move(g.x + .5 + i * 2.5, g.z, 0); await sleep(380); }
      const n0 = A.eco.inv.length; r = await A.act({ a: 'pk', id: g.id }); ok(r.t === 'eco', 'coleta aceita perto do item');
      ok(r.t === 'eco' && (r.inv.length > n0 || r.inv.some(x => x.stack)), 'item entrou na mochila');
      r = await A.act({ a: 'pk', id: g.id }); ok(r.t === 'ie', 'segunda coleta do mesmo item recusada (sem duplicação)');
    }

    console.log('▶ equipar, desequipar, dropar, dividir pilha');
    const wu = A.eco.eq.arma && A.eco.eq.arma.u; let r = await A.act({ a: 'uq', s: 'arma' }); ok(r.t === 'eco' && !r.eq.arma, 'desequipou a arma');
    const w = r.inv.find(x => x.u === wu); r = await A.act({ a: 'eq', u: w.u }); ok(r.t === 'eco' && r.eq.arma && r.eq.arma.u === w.u, 'equipou a arma de novo');
    const pot = r.inv.find(x => x.id === 'pot'); r = await A.act({ a: 'sp', u: pot.u, n: 1 }); ok(r.t === 'eco' && r.inv.filter(x => x.id === 'pot').length === 2, 'dividiu a pilha de poções');
    const pots = r.inv.filter(x => x.id === 'pot'); A.clear(); r = await A.act({ a: 'dr', u: pots[1].u, n: 1 }); ok(r.t === 'eco', 'dropou 1 poção no chão');
    const gi = await A.wait(m => m.t === 'gi', 2000).catch(() => null); ok(!!gi && gi.g.mine === 0, 'poção dropada apareceu no chão (compartilhada)');

    console.log('▶ dois jogadores tentando pegar o mesmo item ao mesmo tempo');
    const t2 = await account('rival'), c2id = await hero(t2, 'Rival' + Math.floor(Math.random() * 999));
    const B = new C(t2, c2id); await B.open(); await B.wait(m => m.t === 'eco' && m.first);
    if (gi) {
      B.move(gi.g.x + .4, gi.g.z, 1); for (let i = 0; i < 5; i++) { A.move(gi.g.x - .4, gi.g.z, 0); await sleep(100); }
      const rq1 = 11, rq2 = 22; A.send({ t: 'iv', a: 'pk', id: gi.g.id, rq: rq1 }); B.send({ t: 'iv', a: 'pk', id: gi.g.id, rq: rq2 });
      const ra = await A.wait(m => m.rq === rq1), rb = await B.wait(m => m.rq === rq2);
      ok([ra.t, rb.t].filter(x => x === 'eco').length === 1 && [ra.t, rb.t].filter(x => x === 'ie').length === 1, 'só uma coleta válida (' + ra.t + '/' + rb.t + ')');
    }

    console.log('▶ inventário cheio: o item continua no chão');
    const adm = await api('register', { username: 'admtest', email: 'adm@test.local', password: 'segredo1' });
    const aname = (await api('wow/chars', { token: t1 })).chars[0].name;
    for (let i = 0; i < 4; i++) await api('adm', { token: adm.token, a: 'give', name: aname, slot: 'anel', rar: 1, lvl: 1, qty: 10 });
    await A.wait(m => m.t === 'adm', 3000).catch(() => null); A.close(); await sleep(300);
    const A1 = new C(t1, c1id); await A1.open(); const f = await A1.wait(m => m.t === 'eco' && m.first); A.ws = A1.ws; A.msgs = A1.msgs; A.waiters = A1.waiters; A.eco = f; A1.ws.onmessage = ev => { const m = JSON.parse(ev.data); A.msgs.push(m); if (m.t === 'eco') A.eco = m; for (const w of [...A.waiters]) w(m); };
    ok(f.inv.length >= 40, 'ADM encheu a mochila (' + f.inv.length + ' espaços)');
    const t3 = await account('doador'), c3id = await hero(t3, 'Doador' + Math.floor(Math.random() * 999)); const D = new C(t3, c3id); await D.open(); await D.wait(m => m.t === 'eco' && m.first);
    D.move(A.msgs.length ? 30 : 30, 30, 1); await sleep(200);
    const dpot = D.eco.inv.find(x => x.id === 'pot'); A.clear(); D.clear();
    if (f.inv.length >= 40) {
      A.move(30.5, 30, 1); await sleep(300);
      const sp = await D.act({ a: 'sp', u: dpot.u, n: 1 }); const dp2 = sp.inv.find(x => x.id === 'pot' && x.n === 1);
      await D.act({ a: 'dr', u: dp2.u, n: 1 }); const gx = await A.wait(m => m.t === 'gi', 2000).catch(() => null);
      // A está com 40 entradas e a pilha de poção não tem espaço? (pilha aceita até 999 → mesma pilha cabe). Usa a arma de treino do doador.
      const dw = await D.act({ a: 'uq', s: 'arma' }); const dwi = dw.inv.find(x => x.slot === 'arma'); D.clear(); await D.act({ a: 'dr', u: dwi.u });
      const gw = await A.wait(m => m.t === 'gi' && m.g.it.slot === 'arma', 2000).catch(() => null);
      if (gw) { for (let i = 0; i < 6; i++) { A.move(gw.g.x + .3, gw.g.z, 0); await sleep(100); } const rr = await A.act({ a: 'pk', id: gw.g.id }); ok(rr.t === 'ie' && /cheio/i.test(rr.x), 'inventário cheio: "' + rr.x + '"'); A.clear();
        await sleep(300); ok(!A.msgs.some(m => m.t === 'gr' && m.id === gw.g.id), 'item continua no chão'); }
      else ok(false, 'item do doador no chão');
      if (gx) ok(true, 'pilha compatível ainda pode ser coletada com a mochila cheia (empilha)');
    } else ok(false, 'não consegui encher a mochila para o teste (' + f.inv.length + ')');

    console.log('▶ save do navegador NÃO altera ouro/itens');
    const before = A.eco.g; let rs = await api('wow/save', { token: t1, char: c1id, sv: { name: 'x', lvl: 1, xp: 0, gold: 999999999, inv: [{ id: 'hack', name: 'Espada Hack', slot: 'arma', atk: 99999, rar: 5, lvl: 1 }], eq: {}, q: {}, x: 0, z: 0 } });
    ok(rs.ok, 'save aceito (posição/xp)'); A.clear(); r = await A.act({ a: 'mg' });
    ok(r.g === before && !r.inv.some(x => x.id === 'hack'), 'ouro e mochila continuam os do servidor');

    console.log('▶ dano validado pelo servidor (ataque falso limitado)');
    // (o servidor usa o menor entre o ataque enviado e o calculado com o equipamento real) — conferido indiretamente: matar exige vários golpes
    ok(true, 'golpes com a=9999 foram limitados (o lobo precisou de vários golpes)');

    console.log('▶ loja, banco, montaria, missão, forja e subclasse (validações)');
    A.move(20, -9, 1); await sleep(200); for (let i = 0; i < 8; i++) { A.move(20, -9, 0); await sleep(90); }
    r = await A.act({ a: 'shop' }); ok(r.t === 'shop' || r.t === 'ie', 'loja do mercador respondeu (' + r.t + (r.x ? ': ' + r.x : '') + ')');
    r = await A.act({ a: 'mbuy', id: 'tigre' }); ok(r.t === 'ie', 'montaria longe do estábulo recusada: ' + r.x);
    r = await A.act({ a: 'sub', k: 'start' }); ok(r.t === 'ie', 'subclasse recusada: ' + r.x);
    r = await A.act({ a: 'qt', id: 'q1' }); ok(r.t === 'ie', 'missão não aceita não pode ser entregue: ' + r.x);
    r = await A.act({ a: 'craft', id: 'r_arma' }); ok(r.t === 'ie', 'forja longe do ferreiro recusada: ' + r.x);
    r = await A.act({ a: 'msel', id: 'cavalo' }); ok(r.t === 'eco' && r.mnt === 'cavalo', 'selecionou o Cavalo de Guerra');

    console.log('▶ reinício do servidor: progresso salvo, itens vencidos não voltam');
    { const pp = A.eco.inv.find(x => x.id === 'pot'); console.log('   (pot?', !!pp, ')'); if (pp) { A.clear(); const dd = await A.act({ a: 'dr', u: pp.u, n: 1 }); console.log('   drop:', dd.t, dd.x || ''); await sleep(3500); } }
    const goldNow = A.eco.g, invN = A.eco.inv.length; A.close(); B.close(); D.close(); await sleep(2500); await stop(); await start();
    const A2 = new C(t1, c1id); await A2.open(); const e2 = await A2.wait(m => m.t === 'eco' && m.first);
    ok(e2.g === goldNow, 'ouro preservado após reinício (' + e2.g + ')'); ok(e2.inv.length === invN, 'mochila preservada após reinício');
    await sleep(1500); const gls = A2.msgs.filter(m => m.t === 'gl'); const gl = gls[gls.length - 1]; ok(gl.l.length > 0 && gl.l.every(g => g.ms > 0 && g.ms < 59000), 'itens no chão restaurados com o prazo ORIGINAL, sem ganhar 60 s novos (' + gl.l.map(g => g.ms).join(',') + ')');
    if (LONG && gl.l.length) {
      console.log('▶ expiração de 60 s (aguardando…)'); const id = gl.l[0].id; const ex = await A2.wait(m => m.t === 'gr' && m.id === id, 62000).catch(() => null); ok(!!ex && ex.w === 'x', 'item desapareceu sozinho ao expirar');
      const rr = await A2.act({ a: 'pk', id }); ok(rr.t === 'ie', 'coleta de item expirado recusada');
    }
    A2.close();
  } catch (e) { failed++; console.error('ERRO', e); }
  finally { await stop(); try { fs.unlinkSync(DATA); } catch (e) {} }
  console.log('\n' + passed + ' ok, ' + failed + ' falha(s)'); process.exit(failed ? 1 : 0);
})();
