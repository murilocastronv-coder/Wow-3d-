'use strict';
// Eternal Realms: servidor multiplayer autoritativo.
// Sem dependências obrigatórias: HTTP e WebSocket são implementados aqui.
// Usa PostgreSQL quando DATABASE_URL existe (Render); senão grava em data.json (desenvolvimento).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Funciona com os arquivos dentro de public/ ou todos soltos na raiz do repositório.
const FLAT = !fs.existsSync(path.join(__dirname, 'public', 'index.html'));
// Procura um arquivo pelo nome exato; se não existir, usa o mais novo que comece igual (o celular renomeia downloads repetidos, ex.: "shared (1).js")
function pickFile(dir, base, ext) {
  const exact = path.join(dir, base + ext); if (fs.existsSync(exact)) return exact;
  let best = null, bt = -1;
  try { for (const f of fs.readdirSync(dir)) { const l = f.toLowerCase(); if (l.startsWith(base) && l.endsWith(ext)) { const m = fs.statSync(path.join(dir, f)).mtimeMs; if (m > bt) { bt = m; best = path.join(dir, f); } } } } catch (e) {}
  return best;
}
const SHARED_FILE = pickFile(FLAT ? __dirname : path.join(__dirname, 'public'), 'shared', '.js');
if (!SHARED_FILE) {
  let ls = []; try { ls = fs.readdirSync(__dirname); } catch (e) {}
  console.error('[ERRO FATAL] Não achei o arquivo shared.js. Ele precisa estar na raiz do repositório com esse nome exato (minúsculas, sem "(1)").');
  console.error('Arquivos que existem aqui:', ls.join(', '));
  process.exit(1);
}
if (path.basename(SHARED_FILE) !== 'shared.js') console.error('[aviso] usando', path.basename(SHARED_FILE), 'no lugar de shared.js; renomeie o arquivo no GitHub para shared.js.');
const S = require(SHARED_FILE);

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'dev-secret-troque-em-producao';
if (!process.env.SECRET) console.warn('[aviso] Defina a variável SECRET em produção.');
const PUB = FLAT ? __dirname : path.join(__dirname, 'public');
const INDEX_FILE = pickFile(PUB, 'index', '.html') || path.join(PUB, 'index.html');
const PIXEL_FILE = path.join(PUB, 'pixel.html');
const WOW_FILE = path.join(PUB, 'wow.html');
const HOME_FILE = fs.existsSync(WOW_FILE) ? WOW_FILE : fs.existsSync(PIXEL_FILE) ? PIXEL_FILE : INDEX_FILE; // a página inicial é o Reinos de Valdor (3D); o jogo 2D fica em /pixel e o antigo em /classic // a página inicial agora é a versão pixel; o jogo antigo fica em /classic
const PUBLIC_FILES = new Set(['shared.js', 'favicon.ico', 'MuonlineClaude.apk', 'manifest.json', 'icon-192.png', 'icon-512.png', 'wow.html', 'status.html', 'guerreiro.glb']); // no modo raiz, só estes arquivos são públicos
const now = () => Date.now();
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = S.clamp;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* =============================== BANCO DE DADOS =============================== */
const DB = (() => {
  let pool = null, mem = null, timer = null;
  const FILE = path.join(__dirname, 'data.json');
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(mem), e => e && console.error(e)), 400); };
  return {
    kind: () => pool ? 'postgres' : 'arquivo',
    async init() {
      if (process.env.DATABASE_URL) {
        const { Pool } = require('pg');
        pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false, max: 8 });
        await pool.query(`CREATE TABLE IF NOT EXISTS accounts(id SERIAL PRIMARY KEY, username TEXT NOT NULL, ulow TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, created TIMESTAMPTZ DEFAULT now());
          CREATE TABLE IF NOT EXISTS chars(id SERIAL PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL, lname TEXT UNIQUE NOT NULL, data JSONB NOT NULL, lvl INT DEFAULT 1, pvp INT DEFAULT 0, updated TIMESTAMPTZ DEFAULT now());
          CREATE INDEX IF NOT EXISTS chars_acc ON chars(account_id);
          CREATE TABLE IF NOT EXISTS guilds(lname TEXT PRIMARY KEY, data JSONB NOT NULL);
          CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, data JSONB NOT NULL);
          CREATE TABLE IF NOT EXISTS logs(id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), kind TEXT, data JSONB);`);
      } else {
        try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { mem = { seqA: 0, seqC: 0, accounts: [], chars: [], guilds: {} }; }
        if (!mem.kv) mem.kv = {};
      }
    },
    async accountByLogin(q) {
      q = q.toLowerCase();
      if (pool) return (await pool.query('SELECT * FROM accounts WHERE ulow=$1 OR email=$1 LIMIT 1', [q])).rows[0] || null;
      return mem.accounts.find(a => a.ulow === q || a.email === q) || null;
    },
    async accountById(id) {
      if (pool) return (await pool.query('SELECT * FROM accounts WHERE id=$1', [id])).rows[0] || null;
      return mem.accounts.find(a => a.id === id) || null;
    },
    async accountExists(ulow, email) {
      if (pool) { const r = await pool.query('SELECT ulow,email FROM accounts WHERE ulow=$1 OR email=$2', [ulow, email]); return r.rows; }
      return mem.accounts.filter(a => a.ulow === ulow || a.email === email);
    },
    async createAccount(username, email, pass) {
      if (pool) return (await pool.query('INSERT INTO accounts(username,ulow,email,pass) VALUES($1,$2,$3,$4) RETURNING *', [username, username.toLowerCase(), email, pass])).rows[0];
      const a = { id: ++mem.seqA, username, ulow: username.toLowerCase(), email, pass }; mem.accounts.push(a); persist(); return a;
    },
    async setPass(id, pass) {
      if (pool) { await pool.query('UPDATE accounts SET pass=$2 WHERE id=$1', [id, pass]); return; }
      const a = mem.accounts.find(x => x.id === id); if (a) { a.pass = pass; persist(); }
    },
    async countAccounts() {
      if (pool) return +(await pool.query('SELECT count(*) FROM accounts')).rows[0].count;
      return mem.accounts.length;
    },
    async countChars() {
      if (pool) return +(await pool.query('SELECT count(*) FROM chars')).rows[0].count;
      return mem.chars.length;
    },
    async charsOf(accId) {
      if (pool) return (await pool.query('SELECT id,data FROM chars WHERE account_id=$1 ORDER BY id', [accId])).rows;
      return mem.chars.filter(c => c.account_id === accId).map(c => ({ id: c.id, data: c.data }));
    },
    async charById(id) {
      if (pool) return (await pool.query('SELECT * FROM chars WHERE id=$1', [id])).rows[0] || null;
      return mem.chars.find(c => c.id === id) || null;
    },
    async nameTaken(name) {
      if (pool) return (await pool.query('SELECT 1 FROM chars WHERE lname=$1', [name.toLowerCase()])).rowCount > 0;
      return mem.chars.some(c => c.lname === name.toLowerCase());
    },
    async createChar(accId, name, data) {
      if (pool) return (await pool.query('INSERT INTO chars(account_id,name,lname,data) VALUES($1,$2,$3,$4) RETURNING id', [accId, name, name.toLowerCase(), JSON.stringify(data)])).rows[0].id;
      const c = { id: ++mem.seqC, account_id: accId, name, lname: name.toLowerCase(), data, lvl: 1, pvp: 0 }; mem.chars.push(c); persist(); return c.id;
    },
    async saveChar(id, data) {
      if (pool) return pool.query('UPDATE chars SET data=$1,lvl=$2,pvp=$3,updated=now() WHERE id=$4', [JSON.stringify(data), data.lvl, data.pvpKills || 0, id]);
      const c = mem.chars.find(x => x.id === id); if (c) { c.data = JSON.parse(JSON.stringify(data)); c.lvl = data.lvl; c.pvp = data.pvpKills || 0; persist(); }
    },
    async top(col, n) {
      if (pool) return (await pool.query(`SELECT name,data->>'cls' AS cls,lvl,pvp,COALESCE((data->>'resets')::int,0) AS resets,data->>'map' AS map,data->>'guild' AS guild FROM chars ORDER BY ${col === 'pvp' ? 'pvp DESC' : col === 'resets' ? "COALESCE((data->>'resets')::int,0) DESC, lvl DESC" : 'lvl DESC'}, id LIMIT $1`, [n])).rows;
      return mem.chars.map(c => ({ name: c.name, cls: c.data.cls, lvl: c.data.lvl, pvp: c.data.pvpKills || 0, resets: c.data.resets || 0, map: c.data.map, guild: c.data.guild }))
        .sort((a, b) => col === 'pvp' ? b.pvp - a.pvp : col === 'resets' ? (b.resets - a.resets) || (b.lvl - a.lvl) : b.lvl - a.lvl).slice(0, n);
    },
    async loadGuilds() {
      if (pool) return (await pool.query('SELECT data FROM guilds')).rows.map(r => r.data);
      return Object.values(mem.guilds);
    },
    async saveGuild(g) {
      if (pool) return pool.query('INSERT INTO guilds(lname,data) VALUES($1,$2) ON CONFLICT(lname) DO UPDATE SET data=$2', [g.name.toLowerCase(), JSON.stringify(g)]);
      mem.guilds[g.name.toLowerCase()] = g; persist();
    },
    async deleteGuild(name) {
      if (pool) return pool.query('DELETE FROM guilds WHERE lname=$1', [name.toLowerCase()]);
      delete mem.guilds[name.toLowerCase()]; persist();
    },
    async kvGet(key) {
      if (pool) { const r = await pool.query('SELECT data FROM kv WHERE key=$1', [key]); return r.rows[0] ? r.rows[0].data : null; }
      return mem.kv[key] || null;
    },
    async kvSet(key, data) {
      if (pool) return pool.query('INSERT INTO kv(key,data) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET data=$2', [key, JSON.stringify(data)]);
      mem.kv[key] = data; persist();
    },
    async allChars() {   // [{id,name,data}] (ranking semanal; poucos milhares de personagens: ok)
      if (pool) return (await pool.query('SELECT id,name,data,account_id FROM chars')).rows;
      return mem.chars.map(c => ({ id: c.id, name: c.name, data: c.data, account_id: c.account_id }));
    },
    async allAccounts() {   // [{id,username,ulow,email}] (painel de administração)
      if (pool) return (await pool.query('SELECT id,username,ulow,email FROM accounts')).rows;
      return mem.accounts.map(a => ({ id: a.id, username: a.username, ulow: a.ulow, email: a.email }));
    },
    async log(kind, data) {
      log('[log]', kind, JSON.stringify(data));
      if (pool) pool.query('INSERT INTO logs(kind,data) VALUES($1,$2)', [kind, JSON.stringify(data)]).catch(() => {});
    },
  };
})();

/* =============================== AUTENTICAÇÃO =============================== */
function hashPass(p) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); }
function checkPass(p, stored) {
  try { const [salt, h] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(p, salt, 64)); } catch (e) { return false; }
}
function sign(obj) { const b = Buffer.from(JSON.stringify(obj)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); }
function verify(tok) {
  if (typeof tok !== 'string' || tok.length > 600) return null;
  const [b, s] = tok.split('.'); if (!b || !s) return null;
  const s2 = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== s2.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(s2))) return null;
  try { const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.exp > now() ? o : null; } catch (e) { return null; }
}
const makeToken = accId => sign({ a: accId, exp: now() + 30 * 864e5 });
const hits = new Map();
function limited(ip, max = 25) { const t = now(); let h = hits.get(ip); if (!h || t - h.t > 60000) { h = { t, n: 0 }; hits.set(ip, h); } return ++h.n > max; }

/* =============================== HTTP =============================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.apk': 'application/vnd.android.package-archive', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
function sendJson(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(b); }
function readBody(req) {
  return new Promise((ok, bad) => { let n = 0; const ch = []; req.on('data', d => { n += d.length; if (n > 10240) { bad(new Error('grande')); req.destroy(); } else ch.push(d); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch (e) { bad(e); } }); req.on('error', bad); });
}
async function sendMail(to, subject, text) {   // e-mail pelo Resend (precisa de RESEND_API_KEY; sem ela o pedido só aparece no log)
  const key = process.env.RESEND_API_KEY || '';
  if (!key) { console.warn('[email] RESEND_API_KEY não configurada: e-mail "' + subject + '" NÃO foi enviado'); return false; }
  try { const r = await fetch((process.env.RESEND_API || 'https://api.resend.com') + '/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Eternal Realms <onboarding@resend.dev>', to: [to], subject, text }) });
    if (!r.ok) console.error('[email] falhou', r.status, (await r.text()).slice(0, 200)); return r.ok; } catch (e) { console.error('[email] falhou:', e.message); return false; }
}
const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
let statsCache = { t: 0, accounts: 0, chars: 0 };
const wowSeen = new Map();   // presença no jogo 3D: sid -> último ping (conta quem pingou nos últimos 75 s)
const wowOnline = () => { const t = Date.now(); let n = 0, pl = 0; for (const [k, v] of wowSeen) { if (t - v.t > 45000) wowSeen.delete(k); else { n++; if (v.play) pl++; } } return { n, pl }; };
/* recorde diário de jogadores no 3D (dia pelo horário de Brasília), guardado no banco: sobrevive a deploys */
let PEAK = { days: {}, u: {} }, peakLoaded = false, peakDirty = 0;
const dayKey = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
async function peakTick() {
  try {
    if (!peakLoaded) { const o = await DB.kvGet('peak:wow'); if (o && o.days) PEAK = { u: {}, ...o }; peakLoaded = true; }
    const w = wowOnline(), n = Math.max(w.n, RT.count()), k = dayKey();
    const U = PEAK.u[k] || (PEAK.u[k] = []); if (U.length < 20000) for (const [sid, v] of wowSeen) if (v.play && !U.includes(sid)) { U.push(sid); peakDirty = 1; }
    if (n > (PEAK.days[k] || 0)) { PEAK.days[k] = n; peakDirty = 1; }
    if (!PEAK.days[k]) { PEAK.days[k] = 0; peakDirty = 1; }
    if (peakDirty) { peakDirty = 0; const ks = Object.keys(PEAK.days).sort(); while (ks.length > 120) { const d0 = ks.shift(); delete PEAK.days[d0]; delete PEAK.u[d0]; } await DB.kvSet('peak:wow', PEAK); }
  } catch (e) { console.error('peak', e.message); }
}
setInterval(peakTick, 20000); setTimeout(peakTick, 3000);
function peakInfo() {
  const ks = Object.keys(PEAK.days).sort(), k = dayKey(); let all = 0, allDay = '', week = 0, weekDay = '';
  for (const d of ks.slice(-7)) if (PEAK.days[d] > week) { week = PEAK.days[d]; weekDay = d; }
  for (const d of ks) if (PEAK.days[d] > all) { all = PEAK.days[d]; allDay = d; }
  return { today: PEAK.days[k] || 0, week, weekDay, all, allDay, uniq: (PEAK.u[k] || []).length, days: ks.slice(-14).map(d => [d, PEAK.days[d], (PEAK.u[d] || []).length]) };
}
async function getStats() {
  if (now() - statsCache.t > 15000) { statsCache = { t: now(), accounts: await DB.countAccounts(), chars: await DB.countChars() }; }
  return { accounts: statsCache.accounts, characters: statsCache.chars, ver: BUILD };   // público: só contas e heróis
}
async function getPrivStats() {   // só o administrador: online agora + picos
  const s = await getStats();
  let online = 0; for (const p of byChar.values()) if (p.ws) online++;
  const w = wowOnline();
  return { ...s, online, wow: Math.max(w.n, RT.count()), wowPlaying: Math.max(w.pl, RT.count()), channels: rooms.size, peak: peakInfo() };
}

/* =============================== LOJA (Stripe) ===============================
   Pagamento com dinheiro de verdade (EUR) -> cristais 💎, ingressos 🎟️ da roleta e itens premium entregues na hora.
   Os preços e o catálogo ficam no shared.js (PREM_PACKS, TICKET_PACKS, PREM). Variáveis no Render (nunca no código):
     STRIPE_SECRET_KEY      chave secreta do Stripe (sk_live_... / rk_live_... ou sk_test_... para testar)
     STRIPE_WEBHOOK_SECRET  segredo do webhook (whsec_...)
     PUBLIC_URL             endereço do site (padrão https://muonlineclaude.com)
     NOTIFY_EMAIL           e-mail que recebe aviso de cada pagamento (padrão murilocastronv@gmail.com)
     RESEND_API_KEY         (opcional) chave do resend.com para mandar esse aviso por e-mail
   Sem as duas primeiras chaves a loja fica desligada e o jogo funciona normal. */

/* =============================== PAINEL DE ADMINISTRAÇÃO (3D) ===============================
   SÓ a conta do dono: o servidor confere usuário E e-mail da conta em TODA ação (o botão escondido no jogo não é segurança).
   Variáveis opcionais no Render: ADMIN_USER (padrão murilonv) e ADMIN_EMAIL (padrão murilocastronv@gmail.com). */
const ADM_USER = (process.env.ADMIN_USER || 'murilonv').toLowerCase(), ADM_MAIL = (process.env.ADMIN_EMAIL || 'murilocastronv@gmail.com').toLowerCase();
const ADM_SIC = { arma: '🗡️', cabeca: '⛑️', peito: '🥋', pernas: '👖', anel: '💍' }, ADM_SLOTS = Object.keys(ADM_SIC);
function admItem(slot, rar, lvl, name) {   // mesma fórmula do jogo (genItem)
  lvl = Math.max(1, lvl | 0); const f = 1 + rar * .4, it = { id: 'a' + crypto.randomBytes(5).toString('hex'), slot, rar, lvl, ic: ADM_SIC[slot], name };
  if (slot === 'arma') it.atk = Math.round(2 + lvl * 1.5 * f);
  else if (slot === 'anel') { it.atk = Math.round(1 + lvl * .7 * f); it.crit = rar >= 2 ? +(.005 * rar).toFixed(3) : 0; }
  else { it.arm = Math.round(2 + lvl * 1.3 * f); it.hp = Math.round(lvl * 2.2 * f); }
  it.price = Math.round(((it.atk || 0) * 4 + (it.arm || 0) * 3 + (it.hp || 0)) * 1.1) + 3; return it;
}
async function admAuth(b, req) {
  if (limited(ipOf(req), 90)) return [null, [429, { error: 'rate' }]];
  const t = verify(b.token); if (!t) return [null, [401, { error: 'auth' }]];
  const a = await DB.accountById(t.a);
  if (!a || String(a.ulow || a.username || '').toLowerCase() !== ADM_USER || String(a.email || '').toLowerCase() !== ADM_MAIL) return [null, [403, { error: 'forbidden' }]];
  return [a, null];
}
async function admChar(name) {   // personagem pelo nome (sem diferenciar maiúsculas)
  const q = String(name || '').trim().toLowerCase(); if (!q) return null;
  const all = await DB.allChars(); const c = all.find(x => String((x.data && x.data.name) || x.name || '').toLowerCase() === q);
  return c ? await DB.charById(c.id) : null;
}
async function admEdit(row, fn) {   // altera o salvamento do personagem direto no servidor (vale também com o jogador offline)
  return RT.lock('wow:' + row.id, async () => {
    const sv = (await DB.kvGet('wow:' + row.id)) || WOW.convert(row.data); sv.inv = Array.isArray(sv.inv) ? sv.inv : []; sv.eq = sv.eq && typeof sv.eq === 'object' ? sv.eq : {};
    const r = fn(sv); sv.tv = (sv.tv | 0) + 1; sv.t = Date.now();
    await DB.kvSet('wow:' + row.id, sv); RT.setLevel(row.id, sv.lvl); RT.admReload(row.id); return r;
  });
}
const admClean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
async function admApi(b, req) {
  const [adm, err] = await admAuth(b, req); if (err) return err;
  const act = String(b.a || '');
  if (act === 'me') {   // o botão do painel só aparece se isto responder ok; o dono também vira Game Master (selo [GM])
    if (!(await DB.kvGet('gm:' + adm.id))) { await DB.kvSet('gm:' + adm.id, 1); RT.setGm(adm.id, true); }
    return { ok: true, user: adm.username };
  }
  if (act === 'max') {   // meu personagem: nível máximo + equipamento lendário no nível máximo + ouro e poções
    const row = await DB.charById(+b.char); if (!row || row.account_id !== adm.id) return [400, { error: 'char' }];
    await admEdit(row, sv => {
      sv.lvl = WD.LV_CAP; sv.xp = 0; sv.rest = 0; sv.gold = 999999999;
      const nm = { arma: 'Lâmina do Administrador', cabeca: 'Coroa do Administrador', peito: 'Armadura do Administrador', pernas: 'Grevas do Administrador', anel: 'Anel do Administrador' };
      for (const sl of ADM_SLOTS) sv.eq[sl] = admItem(sl, 5, WD.LV_CAP, nm[sl]);
      const p = sv.inv.find(x => x.id === 'pot'); if (p) p.n = 99; else sv.inv.push({ id: 'pot', name: 'Poção de Cura', ic: '🧪', n: 99, stack: 1, price: 6, rar: 1 });
    });
    DB.log('adm_max', { id: row.id }); return { ok: true };
  }
  if (act === 'stats') return await getPrivStats();
  if (act === 'gms') { return { list: (await DB.kvGet('gm:list')) || [] }; }
  if (act === 'announce') { const x = admClean(b.text, 120); if (!x) return [400, { error: 'empty' }]; RT.announce(x); return { ok: true }; }
  // daqui para baixo: ações em outro jogador, pelo nome do personagem
  const row = await admChar(b.name); if (!row) return [404, { error: 'noChar' }];
  const online = RT.isOnline(row.id), nm = (row.data && row.data.name) || '?';
  if (act === 'inv') {
    const sv = (await DB.kvGet('wow:' + row.id)) || WOW.convert(row.data), gm = !!(await DB.kvGet('gm:' + row.account_id));
    const sm = it => it && { id: it.id, name: it.name, rar: it.rar | 0, slot: it.slot, n: it.n | 0, lvl: it.lvl | 0, ic: it.ic };
    return { name: nm, cls: sv.cls, lvl: sv.lvl, gold: sv.gold, gm, online, inv: sv.inv.map(sm), eq: Object.fromEntries(ADM_SLOTS.map(k => [k, sm(sv.eq && sv.eq[k])])) };
  }
  if (act === 'gm') {
    const on = !!b.on; if (row.account_id === adm.id) return [400, { error: 'self' }];
    await DB.kvSet('gm:' + row.account_id, on ? 1 : null);
    const L = ((await DB.kvGet('gm:list')) || []).filter(x => x.a !== row.account_id); if (on) L.push({ a: row.account_id, n: nm });
    await DB.kvSet('gm:list', L); RT.setGm(row.account_id, on); DB.log('adm_gm', { acc: row.account_id, on }); return { ok: true };
  }
  if (act === 'give') {
    const slot = String(b.slot || ''), rar = Math.max(0, Math.min(5, b.rar | 0)), lvl = Math.max(1, Math.min(WD.LV_CAP, b.lvl | 0 || 1)), qty = Math.max(1, Math.min(10, b.qty | 0 || 1));
    if (!ADM_SLOTS.includes(slot)) return [400, { error: 'slot' }];
    const rn = ['Gasto', 'Comum', 'Incomum', 'Raro', 'Épico', 'Lendário'], base = { arma: 'Arma', cabeca: 'Elmo', peito: 'Peitoral', pernas: 'Grevas', anel: 'Anel' };
    const name = admClean(b.itemName, 30) || (base[slot] + ' ' + rn[rar] + ' de Game Master');
    let full = false; await admEdit(row, sv => { for (let i = 0; i < qty; i++) { if (sv.inv.length >= 40) { full = true; break; } sv.inv.push(admItem(slot, rar, lvl, name)); } });
    DB.log('adm_give', { to: row.id, slot, rar, lvl, qty }); return { ok: true, full };
  }
  if (act === 'pot') { const n = Math.max(1, Math.min(99, b.n | 0 || 1)); await admEdit(row, sv => { const p = sv.inv.find(x => x.id === 'pot'); if (p) p.n = Math.min(999, (p.n | 0) + n); else sv.inv.push({ id: 'pot', name: 'Poção de Cura', ic: '🧪', n, stack: 1, price: 6, rar: 1 }); }); return { ok: true }; }
  if (act === 'gold') { const d = Math.max(-1e9, Math.min(1e9, Math.floor(+b.n || 0))); await admEdit(row, sv => { sv.gold = Math.max(0, Math.min(1e12, (sv.gold | 0) + d)); }); DB.log('adm_gold', { to: row.id, d }); return { ok: true }; }
  if (act === 'level') { const l = Math.max(1, Math.min(WD.LV_CAP, b.lvl | 0)); await admEdit(row, sv => { sv.lvl = l; sv.xp = 0; }); DB.log('adm_level', { to: row.id, l }); return { ok: true }; }
  if (act === 'take') {   // remove item da mochila (id) ou do equipamento (slot)
    let removed = false;
    await admEdit(row, sv => {
      if (b.slot && ADM_SLOTS.includes(String(b.slot))) { if (sv.eq[b.slot]) { sv.eq[b.slot] = null; removed = true; } }
      else { const i = sv.inv.findIndex(x => x && x.id === String(b.id)); if (i >= 0) { sv.inv.splice(i, 1); removed = true; } }
    });
    DB.log('adm_take', { to: row.id }); return { ok: removed };
  }
  if (act === 'kick') return { ok: RT.kick(nm) };
  if (act === 'mute') return { ok: RT.mute(nm, b.min) };
  return [400, { error: 'act' }];
}

const SHOP = (() => {
  const KEY = process.env.STRIPE_SECRET_KEY || '', WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
  const URLBASE = (process.env.PUBLIC_URL || 'https://muonlineclaude.com').replace(/\/+$/, '');
  const CUR = S.SHOP_CUR;
  const NOTIFY = process.env.NOTIFY_EMAIL || 'murilocastronv@gmail.com', RESEND = process.env.RESEND_API_KEY || '';
  const enabled = () => !!(KEY && WHSEC);
  const inflight = new Set();

  function product(kind, id) {   // preço SEMPRE vem do servidor (shared.js), nunca do navegador
    if (kind === 'cry') { const p = S.PREM_PACKS.find(x => x.id === id); return p && { kind, id, cents: p.cents, label: p.cry + ' cristais' }; }
    if (kind === 'tk') { const p = S.TICKET_PACKS.find(x => x.id === id); return p && { kind, id, cents: p.cents, label: p.n + ' ingresso(s) da Roleta' }; }
    if (kind === 'wow') { const p = WSHOP.BY_ID[id]; return p && { kind, id, cents: p.cents, label: 'Reinos de Valdor — ' + p.n[0] }; }
    if (kind === 'item') { const p = S.PREM_BY_ID[id]; return p && !p.divine && p.price > 0 ? { kind, id, cents: p.price, label: S.premName(id, 'pt') } : null; }
    return null;
  }
  function verifySig(raw, header) {   // formato do Stripe: t=...,v1=hmac_sha256(segredo, t + "." + corpo)
    if (!WHSEC || typeof header !== 'string') return false;
    const parts = header.split(',').map(x => x.trim().split('='));
    const t = (parts.find(p => p[0] === 't') || [])[1], v1 = parts.filter(p => p[0] === 'v1').map(p => p[1]);
    if (!t || !v1.length || Math.abs(Date.now() / 1000 - +t) > 300) return false;
    const exp = crypto.createHmac('sha256', WHSEC).update(Buffer.concat([Buffer.from(t + '.'), raw])).digest('hex');
    return v1.some(x => x.length === exp.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(exp)));
  }
  async function grant(charId, kind, id) {   // entrega no personagem (online: na hora; offline: direto no banco)
    if (kind === 'wow') {   // item do jogo 3D: vale para a CONTA inteira (todos os heróis dela)
      const row = await DB.charById(charId); if (!row) throw new Error('personagem não existe');
      const k = 'wowshop:' + row.account_id, st = (await DB.kvGet(k)) || { own: [], eq: {} };
      if (!st.own.includes(id)) st.own.push(id);
      await DB.kvSet(k, st); return;
    }
    const p = byChar.get(charId), H = SYS && SYS.helpers;
    const apply = (c, online) => {
      if (kind === 'cry') { c.crystals = (c.crystals || 0) + S.PREM_PACKS.find(x => x.id === id).cry; return null; }
      if (kind === 'tk') { const s = H ? H.ensure(c) : (c.sys = c.sys || {}); s.tk = (s.tk || 0) + S.TICKET_PACKS.find(x => x.id === id).n; return null; }
      const it = S.premItem(id); if (c.inv.length < S.INV_MAX) { c.inv.push(it); return null; }
      return it;   // inventário cheio: vai para o Correio
    };
    if (p) {
      const mail = apply(p.c, true);
      if (mail) { if (H) H.addMailTo(p, { kind: 'shop', item: mail }); else p.c.inv.push(mail); }
      markDirty(p); await saveNow(p);
      if (p.ws) {
        p.ws.send({ t: 'me', c: p.c });
        if (kind === 'cry') msgTo(p, 'shop_ok', { n: S.PREM_PACKS.find(x => x.id === id).cry });
        else if (kind === 'tk') msgTo(p, 'shop_tk', { n: S.TICKET_PACKS.find(x => x.id === id).n });
        else msgTo(p, mail ? 'shop_mail' : 'shop_item', { it: S.premItem(id) });
      }
      return;
    }
    const row = await DB.charById(charId); if (!row) throw new Error('personagem não existe');
    const c = row.data, mail = apply(c, false);
    if (mail && H) { await DB.saveChar(charId, c); await H.addMail(charId, { kind: 'shop', item: mail }); } else { if (mail) c.inv.push(mail); await DB.saveChar(charId, c); }
  }
  async function notify(subject, text) {   // aviso por e-mail ao dono a cada pagamento (precisa de RESEND_API_KEY; sem ela só vai para o log)
    log('[loja] ' + subject + ' | ' + text.replace(/\n/g, ' · '));
    if (!RESEND) return;
    try { await fetch((process.env.RESEND_API || 'https://api.resend.com') + '/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Eternal Realms <onboarding@resend.dev>', to: [NOTIFY], subject, text }) }); } catch (e) { console.error('[loja] e-mail falhou:', e.message); }
  }
  async function deliver(s) {   // idempotente: cada pagamento (sessão) só entrega uma vez
    const md = s.metadata || {}, pr = product(md.kind, md.id), charId = +md.char;
    if (!pr || !charId) { DB.log('shop_bad', { id: s.id }); return 'ignorado'; }
    if (String(s.currency).toLowerCase() !== CUR || s.amount_total !== pr.cents) { DB.log('shop_valor_diferente', { id: s.id, total: s.amount_total, cur: s.currency }); await notify('⚠️ Pagamento com valor diferente', 'Sessão ' + s.id + ' recebeu ' + s.amount_total + ' ' + s.currency + ' mas o produto custa ' + pr.cents + '. Nada foi entregue; confira no Stripe.'); return 'ignorado'; }
    const key = 'order:' + s.id; if (inflight.has(key)) return 'em andamento'; inflight.add(key);
    try {
      const o = await DB.kvGet(key); if (o && o.st === 'done') return 'já entregue';
      const rec = { char: charId, kind: pr.kind, id: pr.id, cents: pr.cents, at: now() };
      await DB.kvSet(key, { ...rec, st: 'delivering' });
      await grant(charId, pr.kind, pr.id);
      await DB.kvSet(key, { ...rec, st: 'done', done: now() });
      DB.log('shop', { id: s.id, char: charId, kind: pr.kind, prod: pr.id, cents: pr.cents });
      const row = await DB.charById(charId), who = row && row.data ? row.data.name : '#' + charId;
      await notify('💰 Pagamento recebido: ' + (pr.cents / 100).toFixed(2) + ' ' + CUR.toUpperCase(),
        'Produto: ' + pr.label + '\nValor: ' + (pr.cents / 100).toFixed(2) + ' ' + CUR.toUpperCase() + '\nPersonagem: ' + who + ' (id ' + charId + ')\nComprador: ' + ((s.customer_details && s.customer_details.email) || s.customer_email || '?') + '\nPedido Stripe: ' + s.id + '\nStatus: entregue ao personagem.');
      return 'entregue';
    } finally { inflight.delete(key); }
  }
  function readRaw(req) {
    return new Promise((ok, bad) => { let n = 0; const ch = []; req.on('data', d => { n += d.length; if (n > 256 * 1024) { bad(new Error('grande')); req.destroy(); } else ch.push(d); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', bad); });
  }
  async function webhook(req, res) {
    try {
      const raw = await readRaw(req);
      if (!verifySig(raw, req.headers['stripe-signature'])) { sendJson(res, 400, { error: 'assinatura' }); return; }
      const ev = JSON.parse(raw.toString());
      if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && ev.data && ev.data.object && ev.data.object.payment_status === 'paid') {
        const r = await deliver(ev.data.object); log('[loja]', ev.type, ev.data.object.id, r);
      }
      sendJson(res, 200, { received: true });
    } catch (e) { console.error('[loja] webhook', e.message); sendJson(res, 500, { error: 'server' }); }   // 500 = o Stripe tenta de novo
  }
  async function checkout(b, req) {
    if (!enabled()) return [503, { error: 'shop_off' }];
    if (limited(ipOf(req), 12)) return [429, { error: 'rate' }];
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const pr = product(String(b.kind || 'cry'), String(b.id || b.pack || '')); if (!pr) return [400, { error: 'pack' }];
    const row = await DB.charById(+b.char); if (!row || row.account_id !== t.a) return [400, { error: 'char' }];
    const acc = await DB.accountById(t.a); if (!acc) return [401, { error: 'auth' }];
    if (pr.kind === 'wow') { const st = await DB.kvGet('wowshop:' + t.a); if (st && st.own.includes(pr.id)) return [409, { error: 'owned' }]; }
    const name = (row.data && row.data.name) || row.name || '?';
    const f = new URLSearchParams();
    f.set('mode', 'payment'); f.set('success_url', URLBASE + '/?pago=ok'); f.set('cancel_url', URLBASE + '/?pago=cancelado');
    f.set('client_reference_id', String(row.id)); f.set('customer_email', acc.email);
    for (const pre of ['metadata', 'payment_intent_data[metadata]']) { f.set(pre + '[char]', String(row.id)); f.set(pre + '[kind]', pr.kind); f.set(pre + '[id]', pr.id); f.set(pre + '[acc]', String(t.a)); }
    f.set('line_items[0][quantity]', '1'); f.set('line_items[0][price_data][currency]', CUR); f.set('line_items[0][price_data][unit_amount]', String(pr.cents));
    f.set('line_items[0][price_data][product_data][name]', pr.label + ' — ' + name); f.set('line_items[0][price_data][product_data][description]', 'Eternal Realms');
    let r, j; try { r = await fetch((process.env.STRIPE_API || 'https://api.stripe.com') + '/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f }); j = await r.json(); } catch (e) { return [502, { error: 'net_err' }]; }
    if (!r.ok || !j.url) { console.error('[loja] stripe', r.status, j && j.error && j.error.message); return [502, { error: 'shop_err' }]; }
    DB.log('shop_checkout', { id: j.id, char: row.id, kind: pr.kind, prod: pr.id });
    return { url: j.url };
  }
  return { enabled, cur: CUR, webhook, checkout, deliver, verifySig };
})();

const WOW = require('./wow'), WD = WOW.WD;
const WSHOP = require('./wowshop');
const RT = require('./wowrt')({ verify, DB, WSHOP, log, CLS_MAP: WOW.CLS_MAP });   // multiplayer em tempo real do 3D (WebSocket /ws3d)
async function wowAuth(b) {
  const t = verify(b.token); if (!t) return [null, [401, { error: 'auth' }]];
  const row = await DB.charById(+b.char); if (!row || row.account_id !== t.a) return [null, [400, { error: 'char' }]];
  return [row, null];
}
/* chat do mundo do 3D: guarda só as últimas mensagens na memória (elas somem da tela em 15 s, então não precisa de banco) */
const wowMsgs = []; let wowMsgId = 0; const wowLastSay = new Map();
const API = {
  'POST /api/wow/ping': async (b, req) => {
    const sid = String(b.sid || '').slice(0, 40); if (!/^[a-z0-9]{8,40}$/i.test(sid)) return [400, { error: 'sid' }];
    if (b.leave) wowSeen.delete(sid); else if (wowSeen.size < 20000) wowSeen.set(sid, { t: Date.now(), play: b.play ? 1 : 0 });
    return { ok: true };
  },
  'POST /api/wow/chars': async b => {
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const rows = await DB.charsOf(t.a);
    return { chars: await Promise.all(rows.map(async r => { const sv = await DB.kvGet('wow:' + r.id); return { id: r.id, name: r.data.name, oldCls: r.data.cls, oldLvl: r.data.lvl, cls: (sv && sv.cls) || WOW.CLS_MAP[r.data.cls] || 'guerreiro', race: (sv && sv.race) || '', lvl: sv ? sv.lvl : WOW.newLevel(r.data.lvl), converted: !!sv }; })) };
  },
  'POST /api/wow/load': async b => {
    const [row, err] = await wowAuth(b); if (err) return err;
    let sv = await DB.kvGet('wow:' + row.id);
    if (!sv) { sv = WOW.convert(row.data); await DB.kvSet('wow:' + row.id, sv); DB.log('wow_convert', { id: row.id }); }
    return { sv };
  },
  'POST /api/wow/create': async b => {   // herói novo direto no 3D: 12 classes × 11 raças
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const name = String(b.name || '').trim(), cls = String(b.cls || ''), race = String(b.race || '');
    if (!/^[A-Za-zÀ-ÿ0-9]{3,12}$/.test(name)) return [400, { error: 'err_name' }];
    if (!WOW.WD.CLASSES[cls]) return [400, { error: 'bad_class' }];
    if (!WOW.WD.RACES[race]) return [400, { error: 'bad_race' }];
    if ((await DB.charsOf(t.a)).length >= 5) return [400, { error: 'max_chars' }];
    if (await DB.nameTaken(name)) return [409, { error: 'nameTaken' }];
    const data = S.newChar(name, WOW.OLD_CLS(cls)); const id = await DB.createChar(t.a, name, data); statsCache.t = 0;
    await DB.kvSet('wow:' + id, WOW.fresh(name, cls, race, b.look)); DB.log('wow_create', { id, cls, race });
    return { id, name, cls, race };
  },
  'POST /api/wow/race': async b => {   // herói convertido do 2D escolhe raça e aparência (uma única vez)
    const [row, err] = await wowAuth(b); if (err) return err;
    const race = String(b.race || ''); if (!WOW.WD.RACES[race]) return [400, { error: 'bad_race' }];
    const sv = await DB.kvGet('wow:' + row.id) || WOW.convert(row.data);
    if (sv.race) return [409, { error: 'already' }];
    sv.race = race; sv.look = WOW.cleanLook(b.look); await DB.kvSet('wow:' + row.id, sv); return { ok: true };
  },
  'POST /api/wow/save': async b => {
    const [row, err] = await wowAuth(b); if (err) return err;
    return RT.lock('wow:' + row.id, async () => {
      const prev = await DB.kvGet('wow:' + row.id) || WOW.convert(row.data);
      if (b.sv && (b.sv.tv | 0) < (prev.tv | 0)) return [409, { error: 'stale', sv: prev }];   // um salvamento antigo não pode desfazer uma troca
      const sv = WOW.sanitize(b.sv, prev); if (!sv) return [400, { error: 'bad_save' }];
      await DB.kvSet('wow:' + row.id, sv); RT.setLevel(row.id, sv.lvl); return { ok: true };
    });
  },
  'POST /api/wow/say': async (b, req) => {   // manda uma mensagem para todos que estão no 3D
    const [row, err] = await wowAuth(b); if (err) return err;
    let text = String(b.text || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!text) return [400, { error: 'empty' }];
    const t = Date.now(), last = wowLastSay.get(row.account_id) || { t: 0, x: '' };
    if (t - last.t < 1200) return [429, { error: 'slow' }];
    if (text === last.x && t - last.t < 10000) return [429, { error: 'dup' }];
    wowLastSay.set(row.account_id, { t, x: text }); if (wowLastSay.size > 5000) wowLastSay.clear();
    const m = { id: ++wowMsgId, t, n: (row.data && row.data.name) || row.name || '?', x: text };
    wowMsgs.push(m); while (wowMsgs.length > 60) wowMsgs.shift();
    return { ok: true, id: m.id };
  },
  'GET /api/wow/chat': async (b, req) => {   // mensagens novas (as de mais de 30 s nem vale a pena mandar)
    const since = +new URL(req.url, 'http://x').searchParams.get('since') || 0, t = Date.now();
    return { last: wowMsgId, msgs: wowMsgs.filter(m => m.id > since && t - m.t < 30000).map(m => ({ id: m.id, n: m.n, x: m.x, age: t - m.t })) };
  },
  'GET /api/wow/catalog': async () => ({ cur: SHOP.cur, on: SHOP.enabled(), items: WSHOP.ITEMS }),
  'POST /api/wow/shop': async b => {   // o que a conta já comprou e o que está equipado
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const st = (await DB.kvGet('wowshop:' + t.a)) || { own: [], eq: {} };
    return { own: st.own, eq: st.eq || {} };
  },
  'POST /api/wow/equip': async (b, req) => {   // equipa/desequipa (1 item por categoria); só vale para o que a conta comprou
    if (limited(ipOf(req), 60)) return [429, { error: 'rate' }];
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const cat = String(b.cat || ''); if (!WSHOP.CATS.includes(cat)) return [400, { error: 'cat' }];
    const k = 'wowshop:' + t.a, st = (await DB.kvGet(k)) || { own: [], eq: {} }; st.eq = st.eq || {};
    if (!b.id) delete st.eq[cat];
    else { const it = WSHOP.BY_ID[String(b.id)]; if (!it || it.cat !== cat || !st.own.includes(it.id)) return [403, { error: 'not_owned' }]; st.eq[cat] = it.id; }
    await DB.kvSet(k, st); return { ok: true, eq: st.eq };
  },
  'GET /api/stats': async () => getStats(),
  'POST /api/wow/evtest': async b => process.env.WOW_EV_DEBUG ? { ok: RT._evStart(+b.id | 0), n: RT._evCount() } : [404, { error: 'x' }],   // só existe com WOW_EV_DEBUG (testes locais)
  'GET /api/shop': async () => ({ on: SHOP.enabled(), cur: SHOP.cur }),
  'POST /api/checkout': async (b, req) => SHOP.checkout(b, req),
  'GET /api/ranking': async () => {
    const lvl = await DB.top('lvl', 20), pvp = await DB.top('pvp', 20), rst = await DB.top('resets', 20);
    for (const p of byChar.values()) { for (const row of lvl) if (row.name === p.c.name) { row.lvl = p.c.lvl; row.resets = p.c.resets || 0; } for (const row of pvp) if (row.name === p.c.name) row.pvp = p.c.pvpKills; for (const row of rst) if (row.name === p.c.name) { row.lvl = p.c.lvl; row.resets = p.c.resets || 0; } }
    lvl.sort((a, b) => b.lvl - a.lvl); pvp.sort((a, b) => b.pvp - a.pvp); rst.sort((a, b) => ((b.resets || 0) - (a.resets || 0)) || (b.lvl - a.lvl));
    const gl = [...guilds.values()].map(g => ({ name: g.name, members: g.members.length, power: g.members.reduce((s, m) => s + (m.lvl || 1), 0) })).sort((a, b) => b.power - a.power).slice(0, 20);
    return { level: lvl, resets: rst.filter(r => r.resets > 0), pvp: pvp.filter(r => r.pvp > 0), guilds: gl };
  },
  'POST /api/register': async (b, req) => {
    if (limited(ipOf(req), 10)) return [429, { error: 'rate' }];
    const user = String(b.username || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (!/^[A-Za-z0-9_]{3,16}$/.test(user)) return [400, { error: 'err_user' }];
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return [400, { error: 'err_email' }];
    if (pw.length < 6 || pw.length > 100) return [400, { error: 'err_pw' }];
    const ex = await DB.accountExists(user.toLowerCase(), email);
    if (ex.some(a => a.ulow === user.toLowerCase())) return [409, { error: 'userTaken' }];
    if (ex.length) return [409, { error: 'emailTaken' }];
    const a = await DB.createAccount(user, email, hashPass(pw)); statsCache.t = 0;
    DB.log('register', { id: a.id, user });
    return { token: makeToken(a.id), user: a.username };
  },
  /* recuperar senha por e-mail: o link vale 1 hora e só pode ser usado uma vez. A resposta é sempre a mesma (não revela se o e-mail existe).
     Para o e-mail sair de verdade: RESEND_API_KEY + domínio verificado no resend.com + MAIL_FROM (ex.: Eternal Realms <no-reply@muonlineclaude.com>) no Render. */
  'POST /api/forgot': async (b, req) => {
    if (limited(ipOf(req), 5)) return [429, { error: 'rate' }];
    const q = String(b.email || '').trim().toLowerCase().slice(0, 200); if (!q) return [400, { error: 'err_email' }];
    try {
      const a = await DB.accountByLogin(q);
      if (a && a.email) {
        const last = await DB.kvGet('pwreset:last:' + a.id);
        if (!last || now() - last > 60000) {
          await DB.kvSet('pwreset:last:' + a.id, now());
          const tokn = crypto.randomBytes(24).toString('hex');
          await DB.kvSet('pwreset:' + crypto.createHash('sha256').update(tokn).digest('hex'), { a: a.id, exp: now() + 3600e3 });
          const base = (process.env.PUBLIC_URL || 'https://muonlineclaude.com').replace(/\/+$/, ''), link = base + '/?reset=' + tokn;
          await sendMail(a.email, 'Redefinir senha · Reset your password', 'Olá, ' + a.username + '!\n\nPara criar uma nova senha, abra este link (vale por 1 hora):\n' + link + '\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.\n\n---\nHi ' + a.username + '! To set a new password open this link (valid for 1 hour):\n' + link + '\nIf you did not ask for this, just ignore this e-mail.');
        }
      }
    } catch (e) { console.error('[senha]', e.message); }
    return { ok: true };
  },
  'POST /api/reset': async (b, req) => {
    if (limited(ipOf(req), 10)) return [429, { error: 'rate' }];
    const tokn = String(b.token || '').slice(0, 100), pw = String(b.password || '');
    if (pw.length < 6 || pw.length > 100) return [400, { error: 'err_pw' }];
    const key = 'pwreset:' + crypto.createHash('sha256').update(tokn).digest('hex'), r = await DB.kvGet(key);
    if (!r || !r.a || r.exp < now()) return [400, { error: 'badReset' }];
    const a = await DB.accountById(r.a); if (!a) return [400, { error: 'badReset' }];
    await DB.setPass(a.id, hashPass(pw)); await DB.kvSet(key, null); DB.log('pw_reset', { id: a.id });
    return { token: makeToken(a.id), user: a.username };
  },
  'POST /api/login': async (b, req) => {
    if (limited(ipOf(req), 20)) return [429, { error: 'rate' }];
    const a = await DB.accountByLogin(String(b.id || '').trim());
    if (!a || !checkPass(String(b.password || ''), a.pass)) return [401, { error: 'badLogin' }];
    return { token: makeToken(a.id), user: a.username };
  },
  'POST /api/me': async b => {
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const a = await DB.accountById(t.a); if (!a) return [401, { error: 'auth' }];
    const rows = await DB.charsOf(a.id);
    return { user: a.username, chars: rows.map(r => { const live = byChar.get(r.id); const d = live ? live.c : r.data; return { id: r.id, name: d.name, cls: d.cls, lvl: d.lvl, map: d.map, online: !!(live && live.ws) }; }) };
  },
  'POST /api/char': async b => {
    const t = verify(b.token); if (!t) return [401, { error: 'auth' }];
    const name = String(b.name || '').trim(), cls = String(b.cls || '');
    if (!/^[A-Za-zÀ-ÿ0-9]{3,12}$/.test(name)) return [400, { error: 'err_name' }];
    if (!S.CLASSES[cls]) return [400, { error: 'pick_class' }];
    if ((await DB.charsOf(t.a)).length >= 5) return [400, { error: 'max_chars' }];
    if (await DB.nameTaken(name)) return [409, { error: 'nameTaken' }];
    const data = S.newChar(name, cls); const id = await DB.createChar(t.a, name, data); statsCache.t = 0;
    return { id, name, cls, lvl: 1, map: 'valoria' };
  },
};
API['POST /api/adm'] = admApi;
let HEROES_GZ = null;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const key = req.method + ' ' + url.pathname;
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }
    if (url.pathname === '/health') { res.end('ok'); return; }
    if (key === 'POST /api/stripe-webhook') { await SHOP.webhook(req, res); return; }
    if (API[key]) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const r = await API[key](body, req);
      if (Array.isArray(r)) sendJson(res, r[0], r[1]); else sendJson(res, 200, r);
      return;
    }
    if (url.pathname.startsWith('/api/')) { sendJson(res, 404, { error: 'not_found' }); return; }
    if (['/pixel', '/classic', '/pixel.html', '/index.html', '/heroes.js'].includes(url.pathname)) { res.writeHead(302, { Location: '/' }); res.end(); return; }   // versão 2D removida: tudo vai para o 3D
    if (url.pathname === '/status') url.pathname = '/status.html';
    if (url.pathname === '/wow') url.pathname = '/wow.html';
    let file = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
    if (FLAT && !(PUBLIC_FILES.has(path.basename(file))||/^(cls|mob|npc|mount)_[a-z]+\.glb$/.test(path.basename(file)))) file = HOME_FILE;
    if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = HOME_FILE;
    const hdr = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300' };
    if (file.endsWith('.apk')) { hdr['Content-Disposition'] = 'attachment; filename="MuonlineClaude.apk"'; hdr['Content-Length'] = fs.statSync(file).size; hdr['X-Content-Type-Options'] = 'nosniff'; hdr['Cache-Control'] = 'public, max-age=60'; }
    if (file.endsWith('.glb')) hdr['Cache-Control'] = 'public, max-age=604800';
    if (path.basename(file) === 'heroes.js') {   // modelos 3D dos heróis: grande, então vai comprimido e fica em cache por 1 dia (a URL muda a cada versão)
      hdr['Cache-Control'] = 'public, max-age=86400';
      const ae = String(req.headers['accept-encoding'] || '');
      if (!HEROES_GZ || HEROES_GZ.m !== fs.statSync(file).mtimeMs) HEROES_GZ = { m: fs.statSync(file).mtimeMs, z: require('zlib').gzipSync(fs.readFileSync(file), { level: 9 }) };
      if (/gzip/.test(ae)) { hdr['Content-Encoding'] = 'gzip'; hdr['Content-Length'] = HEROES_GZ.z.length; res.writeHead(200, hdr); res.end(req.method === 'HEAD' ? undefined : HEROES_GZ.z); return; }
    }
    res.writeHead(200, hdr);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: 'server' }); else res.end(); }
});

/* =============================== WEBSOCKET (RFC 6455) =============================== */
class WS {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = null; this.open = true; this.alive = true; this.h = {};
    sock.on('data', d => this._data(d)); sock.on('close', () => this._closed()); sock.on('error', () => this._closed());
  }
  on(ev, fn) { this.h[ev] = fn; }
  _emit(ev, a) { const f = this.h[ev]; if (f) try { f(a); } catch (e) { console.error(e); } }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; if (b.readUInt32BE(2)) { this.close(1009); return; } len = b.readUInt32BE(6); off = 10; }
      if (len > 65536) { this.close(1009); return; }
      const ml = masked ? 4 : 0; if (b.length < off + ml + len) return;
      let pl = Buffer.from(b.subarray(off + ml, off + ml + len));
      if (masked) { const m = b.subarray(off, off + 4); for (let i = 0; i < pl.length; i++) pl[i] ^= m[i & 3]; }
      this.buf = b.subarray(off + ml + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this._send(10, pl); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 2) { if (fin) this._emit('message', pl.toString('utf8')); else this.frag = [pl]; }
      else if (op === 0 && this.frag) { this.frag.push(pl); if (fin) { const m = Buffer.concat(this.frag).toString('utf8'); this.frag = null; this._emit('message', m); } }
    }
  }
  _send(op, data) {
    if (!this.open || this.sock.destroyed) return;
    if (this.sock.writableLength > 2e6) { this.close(1008); return; }
    const n = data.length; let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(n, 6); }
    this.sock.write(Buffer.concat([h, data]));
  }
  send(o) { this._send(1, Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))); }
  ping() { this._send(9, Buffer.alloc(0)); }
  close(code = 1000) { if (!this.open) return; const b = Buffer.alloc(2); b.writeUInt16BE(code); try { this._send(8, b); } catch (e) {} this.open = false; try { this.sock.end(); } catch (e) {} setTimeout(() => this._closed(), 200); }
  _closed() { if (this.closed) return; this.closed = true; this.open = false; try { this.sock.destroy(); } catch (e) {} this._emit('close'); }
}
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  const wsPath = new URL(req.url, 'http://x').pathname;
  if ((wsPath !== '/ws' && wsPath !== '/ws3d') || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  if (wsPath === '/ws3d') RT.onSocket(new WS(sock), ipOf(req)); else onSocket(new WS(sock), ipOf(req));
});
setInterval(() => { for (const ws of sockets) { if (!ws.alive) { ws.close(1001); continue; } ws.alive = false; ws.ping(); } }, 20000);

/* =============================== MUNDO =============================== */
let SYS = null;                   // módulo systems.js (criado depois do banco)
const rooms = new Map();          // "mapa:canal" -> Room
const byChar = new Map();         // charId -> jogador (online ou em período de reconexão)
const sockets = new Set();
const parties = new Map();
const guilds = new Map();         // nome minúsculo -> guilda
let partySeq = 1;
const CH_CAP = 40, GRACE = 30000;

class Room {
  constructor(mapId, ch) {
    this.map = mapId; this.ch = ch; this.key = mapId + ':' + ch; this.cfg = S.MAPS[mapId];
    this.players = new Map(); this.mons = []; this.drops = new Map(); this.dropSeq = 1; this.dropsDirty = false; this.emptySince = now();
    this.bossPos = { x: this.cfg.bossPos[0], z: this.cfg.bossPos[1] };
    const dens = (this.cfg.boost && this.cfg.boost.dens) || 1;   // mapas com Fenda: mais monstros
    for (const def of this.cfg.mons) for (let i = 0; i < Math.round(def.count * dens); i++) {
      const p = this.spot(def.r[0], def.r[1]); const t = (p.r - def.r[0]) / (def.r[1] - def.r[0]);
      this.addMon(def, clamp(Math.round(def.lvl[0] + t * (def.lvl[1] - def.lvl[0]) + rand(-1, 1)), def.lvl[0], def.lvl[1]), p);
    }
    this.addMon(this.cfg.boss, this.cfg.boss.lvl[0], { x: this.bossPos.x, z: this.bossPos.z });
  }
  spot(a, b) { for (let i = 0; i < 60; i++) { const ang = rand(0, 6.283), r = rand(a, b), x = Math.cos(ang) * r, z = Math.sin(ang) * r; if (Math.hypot(x - this.bossPos.x, z - this.bossPos.z) > 17) return { x, z, r }; } return { x: a, z: 0, r: a }; }
  addMon(def, lvl, p) {
    const k = lvl - def.lvl[0];
    const m = { id: this.mons.length, def, lvl, sx: p.x, sz: p.z, radius: def.radius, boss: !!def.boss,
      maxHp: Math.round(def.hp * (1 + k * .25)), dmg: def.dmg * (1 + k * .12), defn: def.def * (1 + k * .14), atkN: 0 };
    this.mons.push(m); this.respawn(m);
  }
  respawn(m) {
    Object.assign(m, { alive: true, hp: m.maxHp, x: m.sx, z: m.sz, h: rand(0, 6.28), state: 'idle', target: null, atkCd: 0, slowT: 0, timer: rand(0, 4), wx: null, wz: null, specialT: 6, dmgBy: m.boss ? new Map() : null });
    if (m.boss) { this.broadcast({ t: 'msg', k: 'boss_up', n: m.def.name }); }
  }
  send(o, except) { const s = JSON.stringify(o); for (const p of this.players.values()) if (p.ws && p !== except) p.ws.send(s); }
  broadcast(o) { this.send(o); }
  fx(o) { this.send({ t: 'fx', ...o }); }
}
function getRoom(mapId, prefer) {
  if (prefer && prefer.map === mapId && prefer.players.size < CH_CAP) return prefer;
  for (let ch = 1; ch <= 50; ch++) {
    const key = mapId + ':' + ch; let r = rooms.get(key);
    if (!r) { r = new Room(mapId, ch); rooms.set(key, r); log('[canal]', key, 'criado'); return r; }
    if (r.players.size < CH_CAP) return r;
  }
  return null;
}
const inTown = p => Math.hypot(p.x, p.z) < S.TOWN_R;
// zona de combate segura: um pouco menor que a cidade, para quem luta na borda (corpo a corpo) não ser tratado como 'dentro da cidade'
const inSafe = p => Math.hypot(p.x, p.z) < S.TOWN_R - 3;

/* ---------- jogador ---------- */
function msgTo(p, k, extra) { if (p.ws) p.ws.send({ t: 'msg', k, ...extra }); }
function markDirty(p) { p.dirty = true; }
function joinRoom(p, mapId, pos) {
  if (p.room) leaveRoom(p);
  let prefer = null;
  if (p.party) for (const id of p.party.members) { const q = byChar.get(id); if (q && q !== p && q.room && q.room.map === mapId) { prefer = q.room; break; } }
  const room = getRoom(mapId, prefer);
  p.room = room; p.c.map = mapId; room.players.set(p.id, p);
  if (SYS) SYS.onMap(p, mapId);
  const sp = pos || { x: rand(-2, 2), z: 4 + rand(-1, 1) }; p.x = sp.x; p.z = sp.z; p.h = Math.PI; p.target = null;
  sendInit(p);
  if (SYS && SYS.onRoomJoin) SYS.onRoomJoin(p);
  room.send({ t: 'join', p: playerInfo(p) }, p);
}
function leaveRoom(p) {
  const r = p.room; if (!r) return;
  r.players.delete(p.id); r.send({ t: 'leave', id: p.id });
  for (const m of r.mons) if (m.target === p.id) { m.target = null; m.state = 'return'; }
  if (!r.players.size) r.emptySince = now();
  p.room = null;
}
const wingInfo = c => (c.equip && c.equip.asas) ? { style: (c.sys && c.sys.ap && c.sys.ap.w != null) ? c.sys.ap.w : (c.equip.asas.style || 0) } : null;
const playerInfo = p => ({ id: p.id, name: p.c.name, cls: p.c.cls, lvl: p.c.lvl, guild: p.c.guild || null, asas: wingInfo(p.c), ti: (p.c.sys && p.c.sys.title) || null, ap: (SYS && SYS.apInfo) ? SYS.apInfo(p.c, p) : null });
function sendInit(p) {
  if (!p.ws || !p.room) return;
  const r = p.room;
  p.ws.send({ t: 'init', id: p.id, map: r.map, ch: r.ch, c: p.c, x: p.x, z: p.z, hp: p.hp, mp: p.mp,
    mons: r.mons.map(m => ({ k: m.def.model, tint: m.def.tint || 0, s: m.def.scale || 1, n: m.def.name, lvl: m.lvl, mhp: m.maxHp, r: m.radius, b: m.boss ? 1 : 0 })),
    players: [...r.players.values()].filter(q => q !== p && !q.ghost).map(playerInfo),
    drops: dropList(r), boost: r.cfg.boost || null, ver: BUILD });
  if (p.party) sendParty(p.party);
  if (p.c.guild) sendGuild(guilds.get(p.c.guild.toLowerCase()));
}
function regen(p, dt) {
  if (p.dead) return; const t = inTown(p), mh = S.maxHp(p.c), mm = S.maxMp(p.c);
  p.hp = Math.min(mh, p.hp + mh * (t ? .08 : .006) * dt); p.mp = Math.min(mm, p.mp + mm * (t ? .08 : .025) * dt);
}

/* ---------- combate ---------- */
function canPvp(a, b) {
  if (!a || !b || a === b || a.dead || b.dead || b.ghost || a.room !== b.room) return false;
  if (!a.pvp) return false;
  if (a.c.lvl < 10 || b.c.lvl < 10) return false;
  if (inTown(a) || inTown(b)) return false;
  if (a.party && a.party === b.party) return false;
  if (a.c.guild && a.c.guild === b.c.guild) return false;
  return true;
}
function resolveTarget(p, msg) {
  const r = p.room;
  if (msg.m != null) { const m = r.mons[msg.m | 0]; if (m && m.alive) return { kind: 'm', o: m, x: m.x, z: m.z, radius: m.radius }; }
  if (msg.p != null) { const q = r.players.get(+msg.p); if (q && canPvp(p, q)) return { kind: 'p', o: q, x: q.x, z: q.z, radius: .5 }; }
  return null;
}
function hitTarget(p, tg, base) { if (tg.kind === 'm') hitMonster(p.room, p, tg.o, base); else hitPlayer(p, tg.o, base); }
function hitMonster(room, p, m, base) {
  if (!m.alive || !p || p.room !== room) return;
  m.hurtT = now(); m.hurtBy = p.id;                                  // quem bateu por último: o monstro passa a lutar com ele (e não desiste nem cura)
  if (inSafe(p)) { if (!p.safeT || now() - p.safeT > 1500) { p.safeT = now(); msgTo(p, 'safe_atk'); } return; }   // não se ataca de dentro da zona segura
  const crit = Math.random() < S.critChance(p.c);
  const dmg = Math.max(1, Math.ceil(base * .12), Math.round(base * rand(.88, 1.12) * (crit ? 1.6 : 1) - m.defn * .5));   // piso de 12% do ataque: defesa alta nunca deixa o monstro imortal
  m.hp -= dmg; room.fx({ e: 'dmg', m: m.id, v: dmg, c: crit ? 1 : 0, by: p.id });
  { const ls = S.mods(p.c).ls; if (ls > 0 && !p.dead) p.hp = Math.min(S.maxHp(p.c), p.hp + Math.round(dmg * ls)); }
  if (m.boss && SYS) SYS.onBossDamage(p, Math.min(dmg, m.hp + dmg));
  if (m.state !== 'return') { m.target = p.id; m.state = 'chase'; }
  if (m.dmgBy) m.dmgBy.set(p.charId, (m.dmgBy.get(p.charId) || 0) + Math.min(dmg, m.hp + dmg));
  if (m.hp <= 0) killMonster(room, m, p);
}
function hitPlayer(p, q, base) {
  if (!canPvp(p, q)) return;
  const crit = Math.random() < S.critChance(p.c);
  let dmg = Math.round((base * rand(.88, 1.12) * (crit ? 1.5 : 1) - S.defense(q.c) * .6) * .6);
  dmg = Math.max(1, dmg); q.lastHitBy = p.id; q.lastHitAt = now();
  if (SYS) SYS.onPvpHit(p, q, dmg, p.lastSkillKey);
  hurtPlayer(q, dmg, p, crit);
}
function hurtPlayer(p, raw, src, crit, isMon) {
  if (p.dead || p.ghost) return;
  if (isMon && Math.random() < Math.min(.5, p.c.stats.agi / 900 + S.mods(p.c).dodge)) { p.room.fx({ e: 'dodge', p: p.id }); return; }
  const dmg = isMon ? Math.max(1, Math.round(raw * rand(.88, 1.12) - S.defense(p.c) * .6)) : raw;
  p.hp -= dmg; p.room.fx({ e: 'pdmg', p: p.id, v: dmg, c: crit ? 1 : 0 });
  if (p.hp <= 0) die(p, isMon ? null : src);
}
function die(p, killer) {
  p.dead = true; p.hp = 0; p.target = null; p.actN++; p.act = 'death';
  const lost = killer ? 0 : Math.floor(p.c.gold * .05); p.c.gold -= lost;
  if (!killer && SYS) SYS.helpers.track(p, 'death', 1);
  if (killer) {
    try { eventOnPvpKill(killer); } catch (e) { console.error('eventOnPvpKill', e); }
    killer.c.pvpKills = (killer.c.pvpKills || 0) + 1; p.c.pvpDeaths = (p.c.pvpDeaths || 0) + 1;
    if (SYS) SYS.onPvpKill(killer, p);
    p.room.send({ t: 'msg', k: 'pvp_kill', a: killer.c.name, b: p.c.name }); markDirty(killer); saveSoon(killer);
    DB.log('pvp', { killer: killer.c.name, victim: p.c.name, map: p.room.key });
  }
  for (const m of p.room.mons) if (m.target === p.id) { m.target = null; m.state = 'return'; }
  if (p.ws) p.ws.send({ t: 'dead', lost, by: killer ? killer.c.name : null });
  markDirty(p);
  setTimeout(() => {
    if (!p.room) return;
    p.dead = false; p.hp = S.maxHp(p.c); p.mp = S.maxMp(p.c); p.act = null; p.actN++;
    p.x = rand(-2, 2); p.z = 4; if (p.ws) p.ws.send({ t: 'revive', x: p.x, z: p.z });
  }, 4000);
}
const BUILD = '2026-10-08-visual-v10';   // conferir no log, em /api/stats e no jogo se esta versão está no ar
const SET_DROP = +process.env.SET_DROP || .05, EGG_DROP = +process.env.EGG_DROP || .05;   // chance de uma peça de set (qualquer abate) e de um ovo de pet (chefe, por participante)
function killMonster(room, m, killer) {
  try { eventOnKill(killer, m); } catch (e) { console.error('eventOnKill', e); }
  try { if (SYS) SYS.onKill(killer, m, room); } catch (e) { console.error('sys onKill', e); }
  if (m.invader && !m.boss) { try { killer.c.gold += m.lvl * 6; if (SYS) { SYS.onEvent(killer, 3); SYS.onGold(killer, m.lvl * 6); } if (Math.random() < .08) killer.c.crystals = (killer.c.crystals || 0) + 1; } catch (e) { console.error('invader', e); } }
  m.alive = false; m.respawnT = (!m.boss && room.cfg.boost) ? room.cfg.boost.respawn : (m.def.respawn || 12); m.target = null;
  const base = Math.round(m.lvl * m.lvl * 1.8 + 8);
  if (m.boss) { bossRewards(room, m, killer, base); return; }
  let group = [killer];
  if (killer.party) group = killer.party.members.map(id => byChar.get(id)).filter(q => q && q.room === room && !q.dead && !q.ghost && dist(q, m) < 40);
  if (!group.includes(killer)) group.push(killer);
  const total = base * (1 + .15 * (group.length - 1));
  const bst = room.cfg.boost;
  for (const q of group) { let xp = Math.max(1, Math.round(total / group.length * clamp(1 - (q.c.lvl - m.lvl - 5) * .12, .1, 1))); if (bst) xp = boostXp(q, xp, bst); gainXp(q, xp); }
  const owners = group.map(q => q.id);
  spawnDrop(room, m, 'gold', Math.round(m.lvl * rand(4, 9) + 3), owners);
  if (Math.random() < .22) spawnDrop(room, m, Math.random() < .6 ? 'hpPot' : 'mpPot', 1, owners);
  const km = S.mods(killer.c);   // bônus da árvore (Fortuna): itens raros, item extra
  if (Math.random() < .11 * (SYS ? SYS.dropMul(killer.c) : 1)) {
    spawnDrop(room, m, 'item', genItem(m.lvl, false, killer.c.cls, km.rare), owners);
    if (Math.random() < km.qty) spawnDrop(room, m, 'item', genItem(m.lvl, false, killer.c.cls, km.rare), owners);   // "Mãos Largas": item extra
  }
  if (Math.random() < .035) spawnDrop(room, m, 'crystal', 1, owners);
  if (Math.random() < SET_DROP * (1 + km.rare)) spawnDrop(room, m, 'item', S.genSetDrop(m.lvl, killer.c.cls), owners);   // peça de um dos 300 sets: 5%
}
function bossRewards(room, m, killer, base) {
  const list = [...m.dmgBy.entries()].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, e) => s + e[1], 0) || 1;
  const rank = list.slice(0, 10).map(([cid, d]) => { const q = byChar.get(cid); return { name: q ? q.c.name : '?', dmg: Math.round(d), pct: Math.round(d / total * 100) }; });
  list.forEach(([cid, d], i) => {
    const q = byChar.get(cid); if (!q || q.room !== room) return;
    const share = d / total;
    gainXp(q, Math.round((base * 12 * Math.max(.05, share) + base) * (room.cfg.boost ? room.cfg.boost.xp : 1)));
    { const g = Math.round(2000 * share + 150); q.c.gold += g; if (SYS) SYS.onGold(q, g); } q.c.bossKills = (q.c.bossKills || 0) + 1;
    if (i === 0 || Math.random() < share * 2) { const it = genItem(m.lvl, true, q.c.cls); if (q.c.inv.length < S.INV_MAX) { q.c.inv.push(it); msgTo(q, 'loot_item', { it }); } }
    if (i < 3) { q.c.crystals += 3 - i; }
    if (Math.random() < SET_DROP * (1 + S.mods(q.c).rare) && q.c.inv.length < S.INV_MAX) { const it = S.genSetDrop(m.lvl, q.c.cls); q.c.inv.push(it); msgTo(q, 'loot_item', { it }); }
    if (Math.random() < EGG_DROP * (1 + S.mods(q.c).egg) && q.c.inv.length < S.INV_MAX) { const it = S.makeEgg(S.EGG_PETS[randi(0, S.EGG_PETS.length - 1)]); q.c.inv.push(it); msgTo(q, 'loot_item', { it }); }
    markDirty(q); saveSoon(q);
  });
  for (let i = 0; i < 3; i++) spawnDrop(room, m, 'item', genItem(m.lvl, true, killer.c.cls), null);
  spawnDrop(room, m, 'gold', 3000, null);
  room.send({ t: 'boss', n: m.def.name, rank });
  broadcastAll({ t: 'chat', ch: 'sys', k: 'boss_dead', n: m.def.name, by: rank[0] ? rank[0].name : killer.c.name, map: room.map });
  DB.log('boss', { boss: m.def.name.pt, room: room.key, rank });
}
function genItem(lvl, boss, cls, rareBonus) {
  const slot = S.SLOTS[randi(0, S.SLOTS.length - 1)];
  const tier = boss ? 5 : clamp(1 + Math.floor(lvl / 7) + (Math.random() < .15 ? 1 : 0), 1, 5);
  const r = Math.random(); let plus = r < .6 ? 0 : r < .85 ? 1 : r < .95 ? 2 : 3; if (boss) plus += 3;
  return S.makeItem(slot, tier, plus, boss || Math.random() < .12 * (1 + (rareBonus || 0)), cls);
}
// Fenda do Caos: multiplicador do mapa + frenesi (abates seguidos somam XP) + cura de vida e mana a cada abate
function boostXp(q, xp, b) {
  const t = now(); q.cbN = (q.cbT && t - q.cbT < b.window * 1000) ? Math.min(b.max, (q.cbN || 0) + 1) : 1; q.cbT = t;
  const mul = b.xp * (1 + b.per * (q.cbN - 1));
  q.hp = Math.min(S.maxHp(q.c), q.hp + S.maxHp(q.c) * b.heal); q.mp = Math.min(S.maxMp(q.c), q.mp + S.maxMp(q.c) * b.heal);
  if (q.ws) q.ws.send({ t: 'combo', n: q.cbN, mul: Math.round(mul * 100) / 100, ms: b.window * 1000 });
  return Math.max(1, Math.round(xp * mul));
}
function gainXp(p, n) {
  if (typeof nightActive !== 'undefined' && nightActive && currentEvent && currentEvent.id === 'nightdead') n *= 5;
  if (SYS) n = Math.round(n * SYS.xpMul(p.c));
  if (p.c.lvl >= S.MAX_LVL) { p.c.xp = 0; return; }   // nível máximo: use o Reset
  p.c.xp += n; if (p.ws) p.ws.send({ t: 'fx', e: 'xp', v: n });
  while (p.c.lvl < S.MAX_LVL && p.c.xp >= S.xpNeed(p.c.lvl)) {
    p.c.xp -= S.xpNeed(p.c.lvl); p.c.lvl++; p.c.points += 5; p.hp = S.maxHp(p.c); p.mp = S.maxMp(p.c);
    p.room.fx({ e: 'lvl', p: p.id, l: p.c.lvl }); saveSoon(p); if (SYS) SYS.onLevel(p);
    if (p.c.guild) { const g = guilds.get(p.c.guild.toLowerCase()); const mm = g && g.members.find(x => x.id === p.charId); if (mm) { mm.lvl = p.c.lvl; DB.saveGuild(g); } }
  }
  markDirty(p);
}
function aoe(p, x, z, r, mult, extra, exclude) {
  const room = p.room; if (!room) return; const base = S.atk(p.c) * mult;
  for (const m of room.mons) if (m.alive && m !== exclude && Math.hypot(m.x - x, m.z - z) <= r + m.radius) { hitMonster(room, p, m, base); if (extra) extra(m); }
  if (p.pvp) for (const q of room.players.values()) if (q !== exclude && canPvp(p, q) && Math.hypot(q.x - x, q.z - z) <= r + .5) { hitPlayer(p, q, base); }
}
const later = (p, ms, fn) => setTimeout(() => { try { if (p.room && !p.dead) fn(); } catch (e) { console.error('later', e); } }, ms);
const aoe2 = (dm, p, x, z, r, mult, ...rest) => aoe(p, x, z, r, mult * dm, ...rest);
function useSkill(p, i, msg) {
  const sk = (S.SKILLS[p.c.cls] || [])[i | 0]; if (!sk || p.dead) return;
  const t = now(); if (t < (p.skillCd[i] || 0) - 150) return;
  if (p.mp < sk.mp) { msgTo(p, 'no_mana'); return; }
  let tg = null;
  if (sk.target) {
    tg = resolveTarget(p, msg); if (!tg) { msgTo(p, 'no_target'); return; }
    if (Math.hypot(tg.x - p.x, tg.z - p.z) - tg.radius > sk.range + 2) { msgTo(p, 'out_range'); return; }
    p.h = Math.atan2(tg.x - p.x, tg.z - p.z);
  }
  const tm = S.mods(p.c), dm = 1 + (i | 0 ? tm.s1 : tm.s0);
  p.mp -= sk.mp; p.skillCd[i] = t + sk.cd * 1000 * clamp(1 - tm.cd, .4, 1); p.act = sk.anim; p.actN++; p.lastSkillKey = sk.key; if (SYS) SYS.onSkill(p);
  const room = p.room, A = 1, fx = o => room.fx(o);
  switch (sk.key) {
    case 'spin': later(p, 350, () => { fx({ e: 'ring', x: p.x, z: p.z, r: 4.4, c: 0xff6a1a }); aoe2(dm, p, p.x, p.z, 4.4, 1.9); }); break;
    case 'dash': {
      const dx = tg.x - p.x, dz = tg.z - p.z, len = Math.hypot(dx, dz) || 1, k = Math.max(0, len - (tg.radius + .8)) / len;
      p.x += dx * k; p.z += dz * k; p.lastMove = t; if (p.ws) p.ws.send({ t: 'tp', x: p.x, z: p.z, dash: 1 });
      fx({ e: 'ring', x: p.x, z: p.z, r: 2.6, c: 0xffee88 });
      later(p, 180, () => { hitTarget(p, tg, (S.atk(p.c) * dm) * 2.6); aoe2(dm, p, p.x, p.z, 2.6, 1, null, tg.o); }); break; }
    case 'comet': { const x = tg.x, z = tg.z; fx({ e: 'meteor', x, z, c: 0x6fb8ff }); later(p, 450, () => aoe2(dm, p, x, z, 5, 2.4)); break; }
    case 'nova': later(p, 400, () => { fx({ e: 'ring', x: p.x, z: p.z, r: 6.5, c: 0x88e0ff }); aoe2(dm, p, p.x, p.z, 6.5, 1.5, m => { m.slowT = 3.5; }); }); break;
    case 'triple': case 'orbs': {
      const kind = sk.key === 'triple' ? 'arrow' : 'void', mult = sk.key === 'triple' ? 1.45 : 1.3;
      const list = [tg];
      if (tg.kind === 'm') for (const m of room.mons.filter(m => m.alive && m !== tg.o && Math.hypot(m.x - p.x, m.z - p.z) < 12).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, 2)) list.push({ kind: 'm', o: m });
      while (list.length < 3) list.push(tg);
      list.forEach(x => fx({ e: 'proj', p: p.id, [x.kind === 'm' ? 'm' : 'q']: x.kind === 'm' ? x.o.id : x.o.id, k: kind }));
      later(p, 280, () => list.forEach(x => hitTarget(p, x, (S.atk(p.c) * dm) * mult))); break; }
    case 'rain': { const x = tg.x, z = tg.z; fx({ e: 'ring', x, z, r: 5, c: 0x7aee5a }); later(p, 550, () => { fx({ e: 'col', x, z, c: 0x7aee5a }); aoe2(dm, p, x, z, 5, 1.9); }); break; }
    case 'astral': later(p, 500, () => { fx({ e: 'ring', x: p.x, z: p.z, r: 4.5, c: 0xb98aff }); aoe2(dm, p, p.x, p.z, 4.5, 2); }); break;
    case 'rune': { const x = tg.x, z = tg.z; fx({ e: 'ring', x, z, r: 4, c: 0x7aa8ff }); later(p, 350, () => { fx({ e: 'col', x, z, c: 0xa46bff }); aoe2(dm, p, x, z, 4, 2.3); }); break; }
    case 'quake': later(p, 600, () => { fx({ e: 'ring', x: p.x, z: p.z, r: 5.5, c: 0xff2030 }); fx({ e: 'col', x: p.x, z: p.z, c: 0xff3040 }); aoe2(dm, p, p.x, p.z, 5.5, 2.1, m => { m.slowT = 2; }); }); break;
    case 'blood': later(p, 300, () => {
      if (tg.kind === 'm' && !tg.o.alive) return;
      const before = tg.o.hp; hitTarget(p, tg, (S.atk(p.c) * dm) * 3);
      const h = Math.round(Math.max(0, before - Math.max(0, tg.o.hp)) * .25);
      if (h > 0) { p.hp = Math.min(S.maxHp(p.c), p.hp + h); fx({ e: 'heal', p: p.id, v: h }); } }); break;
    case 'wolf': { const x = tg.x, z = tg.z; later(p, 600, () => { fx({ e: 'ring', x, z, r: 3.5, c: 0xb05aff }); fx({ e: 'col', x, z, c: 0xb05aff }); aoe2(dm, p, x, z, 3.5, 2.4); }); break; }
  }
}
function basicAttack(p, msg) {
  if (p.dead) return; p.lastSkillKey = null; const tg = resolveTarget(p, msg); if (!tg) return;
  const t = now(), cls = S.CLASSES[p.c.cls];
  if (t - p.lastAtk < S.atkInterval(p.c) * 1000 * .78) return;
  if (Math.hypot(tg.x - p.x, tg.z - p.z) > cls.range + tg.radius + 2) return;
  p.lastAtk = t; p.act = 'attack'; p.actN++; p.h = Math.atan2(tg.x - p.x, tg.z - p.z);
  if (cls.proj) p.room.fx({ e: 'proj', p: p.id, [tg.kind === 'm' ? 'm' : 'q']: tg.o.id, k: cls.proj });
  later(p, cls.proj ? 300 : 220, () => hitTarget(p, tg, S.atk(p.c)));
}

/* ---------- drops ---------- */
function spawnDrop(room, at, kind, payload, owners) {
  const id = room.dropSeq++;
  room.drops.set(id, { id, x: at.x + rand(-1, 1), z: at.z + rand(-1, 1), kind, payload, born: now(), owners, until: now() + 10000 });
  room.dropsDirty = true;
}
const dropList = r => [...r.drops.values()].map(d => ({ id: d.id, x: r1(d.x), z: r1(d.z), k: d.kind, r: d.kind === 'item' && d.payload.rare ? 1 : 0 }));
function tryPickup(p, d) {
  const c = p.c;
  if (SYS && SYS.pickOk && !SYS.pickOk(p, d)) return false;   // filtro de coleta do jogador (por tipo ou nome)
  if (d.kind === 'gold') { const g = SYS ? Math.round(d.payload * SYS.goldMul(c)) : d.payload; c.gold += g; if (p.ws) p.ws.send({ t: 'fx', e: 'gold', v: g }); if (SYS) SYS.onGold(p, g); }
  else if (d.kind === 'hpPot') { c.hpPot++; msgTo(p, 'loot_hp'); }
  else if (d.kind === 'mpPot') { c.mpPot++; msgTo(p, 'loot_mp'); }
  else if (d.kind === 'crystal') { c.crystals += d.payload; msgTo(p, 'loot_crystal', { n: d.payload }); }
  else { if (c.inv.length >= S.INV_MAX) { if (!d.warned) d.warned = new Set(); if (!d.warned.has(p.id)) { d.warned.add(p.id); msgTo(p, 'inv_full'); } return false; }
    c.inv.push(d.payload); msgTo(p, 'loot_item', { it: d.payload }); saveSoon(p); }
  markDirty(p); return true;
}

/* ---------- laço do servidor (10 Hz) ---------- */
// destino de passeio: perto do ponto de nascimento, sempre fora da cidade e dentro do mundo
function wanderSpot(m, spread) {
  const sp = spread || 11; let x = m.sx + rand(-sp, sp), z = m.sz + rand(-sp, sp), r = Math.hypot(x, z);
  const lo = S.TOWN_R + 4, hi = S.WORLD_R - 3;
  if (r < lo) { const k = lo / Math.max(r, .1); x *= k; z *= k; if (r < .1) { x = lo; z = 0; } }
  else if (r > hi) { const k = hi / r; x *= k; z *= k; }
  return [x, z];
}
function stepToward(m, tx, tz, sp, dt) {
  const dx = tx - m.x, dz = tz - m.z, len = Math.hypot(dx, dz); if (len < .05) return false;
  const st = Math.min(len, sp * dt), nx = m.x + dx / len * st, nz = m.z + dz / len * st, rr = Math.hypot(nx, nz);
  m.h = Math.atan2(dx, dz); if (rr < S.TOWN_R + 1 || rr > S.WORLD_R) return false; m.x = nx; m.z = nz; return true;
}
function tickRoom(r, dt, t) {
  for (const p of r.players.values()) regen(p, dt);
  for (const m of r.mons) {
    if (!m.alive) { m.respawnT -= dt; if (m.respawnT <= 0) r.respawn(m); continue; }
    m.atkCd -= dt; m.slowT -= dt;
    const sp = m.def.speed * (m.slowT > 0 ? .45 : 1);
    // monstro atacado recentemente reage a quem bateu: não desiste (sem coleira curta) e não cura enquanto apanha
    const hp0 = (m.hurtT && t - m.hurtT < 12000) ? r.players.get(m.hurtBy) : null, hurtOk = !!hp0 && !hp0.dead && !hp0.ghost && !inSafe(hp0) && dist(hp0, m) < 70;
    let tp = m.target != null ? r.players.get(m.target) : null;
    if (tp && (tp.dead || tp.ghost || inSafe(tp))) { tp = null; m.target = null; if (m.state === 'chase') m.state = 'idle'; }   // jogador entrou na zona segura: o monstro só para (antes voltava para casa e curava 50%/s)
    if (!tp && hurtOk) { tp = hp0; m.target = hp0.id; m.state = 'chase'; }
    { const rr = Math.hypot(m.x, m.z); if (rr < S.TOWN_R + 1) { const k = (S.TOWN_R + 2) / Math.max(rr, .1); m.x *= k; m.z *= k; } }   // nunca fica preso dentro da cidade
    if (!tp && (m.def.aggro || m.invader) && m.state !== 'return') {
      let best = null, bd = m.invader ? 13 : 8;
      for (const p of r.players.values()) { if (p.dead || p.ghost || inSafe(p)) continue; const d = dist(p, m); if (d < bd) { bd = d; best = p; } }
      if (best) { tp = best; m.target = best.id; m.state = 'chase'; }
    }
    if (tp && m.state === 'chase') {
      if (Math.hypot(m.x - m.sx, m.z - m.sz) > (hurtOk ? 90 : (m.boss ? 22 : 28))) { m.state = 'return'; m.target = null; }
      else {
        const d = dist(m, tp), reach = m.radius + 1.3;
        if (d > reach) stepToward(m, tp.x, tp.z, sp * 1.15, dt);
        else { m.h = Math.atan2(tp.x - m.x, tp.z - m.z);
          if (m.atkCd <= 0) { const enr = m.boss && m.hp < m.maxHp * .5; m.atkCd = (m.def.atkSpd || 1.5) * (enr ? .75 : 1); m.atkN++; hurtPlayer(tp, m.dmg * (SYS ? SYS.monDmgMul() : 1), null, false, true); } }
        if (m.boss) { m.specialT -= dt; if (m.specialT <= 0) { const enr = m.hp < m.maxHp * .5; m.specialT = enr ? 4.5 : 7; const cx = m.x, cz = m.z;
          r.fx({ e: 'ring', x: cx, z: cz, r: enr ? 7 : 5.5, c: enr ? 0xff3030 : 0x55ff88, d: 1 });
          setTimeout(() => { if (!m.alive) return; for (const p of r.players.values()) if (!p.dead && !p.ghost && Math.hypot(p.x - cx, p.z - cz) < (enr ? 7.3 : 5.8)) hurtPlayer(p, m.dmg * 1.4, null, false, true); }, 900); } }
      }
    } else if (m.state === 'return' || (m.state === 'chase' && !tp)) {
      m.state = 'return'; m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * .08);   // volta para casa curando devagar (antes 50%/s)
      if (Math.hypot(m.x - m.sx, m.z - m.sz) < 1) { m.state = 'idle'; m.hp = m.maxHp; if (m.dmgBy) m.dmgBy.clear(); m.blockT = 0; }
      else if (!stepToward(m, m.sx, m.sz, sp * 1.5, dt)) { m.blockT = (m.blockT || 0) + dt; if (m.blockT > 2) { m.state = 'idle'; m.blockT = 0; } }
      else m.blockT = 0;
    } else {
      if (m.hp < m.maxHp && !(m.hurtT && t - m.hurtT < 10000)) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * .03);   // parado e sem apanhar: recupera aos poucos
      m.timer -= dt; if (m.timer <= 0) { m.timer = rand(2.5, 6); const w = wanderSpot(m); m.wx = w[0]; m.wz = w[1]; }
      if (m.wx != null && (Math.hypot(m.x - m.wx, m.z - m.wz) < .4 || !stepToward(m, m.wx, m.wz, sp * .55, dt))) { if (m.wx != null && Math.hypot(m.x - m.wx, m.z - m.wz) >= .4) m.timer = 0; m.wx = null; }   // bloqueado: escolhe outro destino já no próximo ciclo
    }
    // vigia: monstro que deveria andar (passeio ou perseguição) mas não saiu do lugar por muito tempo
    { const mv = Math.hypot(m.x - (m.lx ?? m.x), m.z - (m.lz ?? m.z)); m.lx = m.x; m.lz = m.z;
      const wants = m.state === 'chase' || m.state === 'return' || m.wx != null;
      if (wants && mv < .002) m.stillT = (m.stillT || 0) + dt; else m.stillT = 0;
      if (m.stillT > 5) { m.stillT = 0; const w = wanderSpot(m, 14); m.sx = w[0]; m.sz = w[1]; if (m.state === 'return' || m.state === 'chase') { m.state = 'idle'; m.target = null; m.hurtT = 0; } m.wx = w[0]; m.wz = w[1]; }
    }
  }
  for (const d of r.drops.values()) {
    if (t - d.born > 120000) { r.drops.delete(d.id); r.dropsDirty = true; continue; }
    if (t - d.born < 350) continue;
    for (const p of r.players.values()) {
      if (p.dead || p.ghost || Math.hypot(p.x - d.x, p.z - d.z) > 1.9) continue;
      if (d.owners && t < d.until && !d.owners.includes(p.id)) continue;
      if (tryPickup(p, d)) { r.drops.delete(d.id); r.dropsDirty = true; break; }
    }
  }
  // fotografia do mundo para cada jogador (só o que está por perto)
  const list = [...r.players.values()].filter(p => !p.ghost);
  for (const p of list) {
    if (!p.ws) continue;
    const ps = [], ms = [];
    for (const q of list) if (q === p || dist(q, p) < 80) ps.push([q.id, r1(q.x), r1(q.z), r2(q.h), Math.ceil(q.hp), S.maxHp(q.c), Math.floor(q.mp), S.maxMp(q.c), q.dead ? 1 : 0, (q.moving && now() - q.lastMove < 600) ? 1 : 0, q.act || '', q.actN, q.party ? q.party.id : 0, q.pvp ? 1 : 0, q.c.lvl]);
    for (const m of r.mons) if (dist(m, p) < 62) ms.push([m.id, r1(m.x), r1(m.z), r2(m.h), Math.max(0, Math.ceil(m.hp)), m.alive ? 1 : 0, m.atkN, m.state === 'return' ? 1 : 0]);
    p.ws.send({ t: 's', p: ps, m: ms });
    if (p.dirty) { p.dirty = false; p.ws.send({ t: 'me', c: p.c }); }
  }
  if (r.dropsDirty) { r.dropsDirty = false; r.send({ t: 'drops', d: dropList(r) }); }
}
let lastTick = now();
setInterval(() => {
  const t = now(), dt = Math.min(.25, (t - lastTick) / 1000); lastTick = t;
  for (const [k, r] of rooms) {
    if (!r.players.size && t - r.emptySince > 300000 && r.ch > 1) { rooms.delete(k); log('[canal]', k, 'fechado'); continue; }
    if (!r.players.size && t - r.emptySince > 60000) continue; // canal vazio fica congelado
    try { tickRoom(r, dt, t); } catch (e) { console.error('tickRoom', k, e); }
  }
  for (const p of byChar.values()) if (p.ghost && t - p.offlineAt > GRACE) removePlayer(p);
}, 100);
setInterval(() => { for (const pt of parties.values()) sendParty(pt); }, 1000);
setInterval(() => { for (const p of byChar.values()) saveNow(p); }, 30000);

/* ---------- persistência ---------- */
function saveNow(p) { p.saveTimer = null; return DB.saveChar(p.charId, p.c).catch(e => console.error('save', e.message)); }
function saveSoon(p) { if (!p.saveTimer) p.saveTimer = setTimeout(() => saveNow(p), 3000); }
function removePlayer(p) {
  saveNow(p); leaveRoom(p); byChar.delete(p.charId);
  if (p.party) partyLeave(p, true);
  if (p.c.guild) sendGuild(guilds.get(p.c.guild.toLowerCase()));
}
function broadcastAll(o) { const s = JSON.stringify(o); for (const p of byChar.values()) if (p.ws) p.ws.send(s); }

/* ---------- grupo (party) ---------- */
function sendParty(pt) {
  if (!pt) return;
  const members = pt.members.map(id => { const q = byChar.get(id); return q ? { id: q.id, cid: id, name: q.c.name, cls: q.c.cls, lvl: q.c.lvl, hp: Math.ceil(q.hp), mhp: S.maxHp(q.c), map: q.room ? q.room.map : null, ch: q.room ? q.room.ch : 0, x: r1(q.x), z: r1(q.z), on: !!q.ws } : null; }).filter(Boolean);
  for (const id of pt.members) { const q = byChar.get(id); if (q && q.ws) q.ws.send({ t: 'party', id: pt.id, leader: pt.leader, members }); }
}
function partyLeave(p, silent) {
  const pt = p.party; if (!pt) return;
  pt.members = pt.members.filter(id => id !== p.charId); p.party = null; if (p.ws) p.ws.send({ t: 'party', id: 0 });
  if (pt.members.length <= 1) { for (const id of pt.members) { const q = byChar.get(id); if (q) { q.party = null; if (q.ws) q.ws.send({ t: 'party', id: 0 }); msgTo(q, 'party_gone'); } } parties.delete(pt.id); return; }
  if (pt.leader === p.charId) pt.leader = pt.members[0];
  sendParty(pt);
}

/* ---------- guildas ---------- */
function sendGuild(g) {
  if (!g) return;
  const info = { t: 'guild', name: g.name, leader: g.leader, members: g.members.map(m => { const q = byChar.get(m.id); return { id: m.id, name: m.name, rank: m.rank, lvl: q ? q.c.lvl : m.lvl, on: !!(q && q.ws) }; }) };
  for (const m of g.members) { const q = byChar.get(m.id); if (q && q.ws) q.ws.send(info); }
}
function guildOf(p) { return p.c.guild ? guilds.get(p.c.guild.toLowerCase()) : null; }
function rankOf(g, cid) { const m = g.members.find(x => x.id === cid); return m ? m.rank : null; }
async function setCharGuild(cid, gname) {
  const q = byChar.get(cid);
  if (q) { q.c.guild = gname; markDirty(q); saveSoon(q); if (q.room) q.room.send({ t: 'join', p: playerInfo(q) }, q); return; }
  const row = await DB.charById(cid); if (row) { row.data.guild = gname; await DB.saveChar(cid, row.data); }
}

/* ---------- chat ---------- */
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
function chat(p, msg) {
  const text = clean(msg.text); if (!text) return;
  const t = now(); if (t - p.lastChat < 600) { msgTo(p, 'slow_chat'); return; } p.lastChat = t;
  const out = { t: 'chat', ch: msg.ch, from: p.c.name, text };
  const deliver = q => { if (q.ws && !(q.c.blocked || []).includes(p.c.name.toLowerCase())) q.ws.send(out); };
  switch (msg.ch) {
    case 'global': for (const q of byChar.values()) deliver(q); break;
    case 'local': if (p.room) for (const q of p.room.players.values()) if (dist(q, p) < 40) deliver(q); break;
    case 'party': if (!p.party) { msgTo(p, 'no_party'); return; } for (const id of p.party.members) { const q = byChar.get(id); if (q) deliver(q); } break;
    case 'guild': { const g = guildOf(p); if (!g) { msgTo(p, 'no_guild'); return; } for (const m of g.members) { const q = byChar.get(m.id); if (q) deliver(q); } break; }
    case 'w': {
      const to = [...byChar.values()].find(q => q.c.name.toLowerCase() === String(msg.to || '').toLowerCase() && q.ws);
      if (!to) { msgTo(p, 'not_online', { n: msg.to }); return; }
      out.to = to.c.name; deliver(to); if (p.ws) p.ws.send(out); break; }
    default: return;
  }
}

/* ---------- mensagens do cliente ---------- */
const HANDLERS = {
  m(p, a) { // movimento [x,z,h,andando]
    if (p.dead || !Array.isArray(a)) return;
    let [x, z, h, mv] = a; x = +x; z = +z; h = +h; if (![x, z, h].every(Number.isFinite)) return;
    const t = now(), dt = Math.max(.05, (t - p.lastMove) / 1000); p.lastMove = t;
    const maxd = S.moveSpeed(p.c) * dt * 1.5 + .8, d = Math.hypot(x - p.x, z - p.z);
    if (d > maxd) { p.strikes = (p.strikes || 0) + 1; if (p.strikes > 20) { DB.log('speed', { name: p.c.name, d }); p.strikes = 0; } p.moving = false; if (p.ws) p.ws.send({ t: 'tp', x: p.x, z: p.z }); return; }
    const rr = Math.hypot(x, z); if (rr > S.WORLD_R) { x *= S.WORLD_R / rr; z *= S.WORLD_R / rr; }
    p.x = x; p.z = z; p.h = h; p.moving = !!mv;
  },
  a(p, msg) { basicAttack(p, msg || {}); },
  k(p, msg) { if (msg) useSkill(p, msg.i, msg); },
  pot(p, k) {
    if (p.dead || now() - p.lastPot < 550) return; p.lastPot = now(); const c = p.c;
    if (k === 'hp') { if (c.hpPot <= 0) { msgTo(p, 'no_hp_pot'); return; } c.hpPot--; const h = Math.round(S.maxHp(c) * .4); p.hp = Math.min(S.maxHp(c), p.hp + h); p.room.fx({ e: 'heal', p: p.id, v: h }); }
    else { if (c.mpPot <= 0) { msgTo(p, 'no_mp_pot'); return; } c.mpPot--; p.mp = Math.min(S.maxMp(c), p.mp + Math.round(S.maxMp(c) * .5)); }
    markDirty(p);
  },
  stat(p, m) {
    const k = m && m.k; if (!['str', 'agi', 'vit', 'ene'].includes(k)) return;
    if (p.c.stats[k] >= S.MAX_STAT) { msgTo(p, 'stat_max'); return; }
    const n = Math.min(+m.n | 0, p.c.points, S.MAX_STAT - p.c.stats[k]); if (n <= 0) return;
    p.c.stats[k] += n; p.c.points -= n; markDirty(p); saveSoon(p);
  },
  reset(p) {   // nível 1000 -> volta ao 1 ganhando pontos; mantém atributos, itens e equipamentos
    const c = p.c;
    if (c.lvl < S.MAX_LVL) { msgTo(p, 'need_max_lvl'); return; }
    if ((c.resets || 0) >= S.MAX_RESETS) { msgTo(p, 'max_resets'); return; }
    c.resets = (c.resets || 0) + 1; c.lvl = 1; c.xp = 0; c.points += S.STAT_PER_RESET;
    p.hp = S.maxHp(c); p.mp = S.maxMp(c); markDirty(p); saveNow(p);
    if (SYS) SYS.onReset(p);
    msgTo(p, 'reset_ok', { n: c.resets }); if (p.ws) p.ws.send({ t: 'me', c });
    DB.log('reset', { name: c.name, resets: c.resets });
  },
  equip(p, id) {
    const c = p.c, i = c.inv.findIndex(x => x.id === id); if (i < 0) return; const it = c.inv[i];
    if (it.slot === 'egg') { if (SYS && SYS.hatch) SYS.hatch(p, id); return; }   // 'equipar' um ovo choca o pet
    if (S.itemReq(it) > c.lvl) { msgTo(p, 'need_lvl_item'); return; }
    if (it.slot === 'arma' && it.cls && it.cls !== c.cls) { msgTo(p, 'wrong_class'); return; }
    const old = c.equip[it.slot]; c.equip[it.slot] = it; c.inv.splice(i, 1); if (old) c.inv.push(old);
    p.hp = Math.min(p.hp, S.maxHp(c)); markDirty(p); saveNow(p);
    if (it.slot === 'asas' && p.room) p.room.send({ t: 'wings', id: p.id, asas: wingInfo(c) }, p);
    if (SYS && SYS.sendAp) SYS.sendAp(p);
  },
  unequip(p, slot) { const c = p.c; if (!c.equip[slot]) return; if (c.inv.length >= S.INV_MAX) { msgTo(p, 'inv_full'); return; } c.inv.push(c.equip[slot]); c.equip[slot] = null; markDirty(p); saveNow(p);
    if (slot === 'asas' && p.room) p.room.send({ t: 'wings', id: p.id, asas: null }, p);
    if (SYS && SYS.sendAp) SYS.sendAp(p); },
  refine(p, id) {
    const c = p.c; const it = c.inv.find(x => x.id === id) || Object.values(c.equip).find(x => x && x.id === id); if (!it) return;
    if (c.crystals < 1 || it.plus >= 12) return; c.crystals--;
    if (Math.random() < S.refineChance(it)) { it.plus++; msgTo(p, 'refine_ok', { it }); if (it.plus >= 9) DB.log('refine', { name: c.name, item: S.itemName(it) }); }
    else if (it.plus >= 6) { it.plus--; msgTo(p, 'refine_down', { it }); } else msgTo(p, 'refine_fail');
    markDirty(p); saveSoon(p);
  },
  sell(p, id) {
    if (Math.hypot(p.x - S.MERCHANT_POS.x, p.z - S.MERCHANT_POS.z) > 6) { msgTo(p, 'far_merchant'); return; }
    const c = p.c, i = c.inv.findIndex(x => x.id === id); if (i < 0) return; const it = c.inv[i];
    if (it.bound) { msgTo(p, 'bound'); return; }   // item sagrado/administrativo: não vende
    c.gold += S.itemPrice(it); c.inv.splice(i, 1); msgTo(p, 'sold', { it, g: S.itemPrice(it) }); markDirty(p); saveSoon(p);
  },
  discard(p, id) { const c = p.c, i = c.inv.findIndex(x => x.id === id); if (i >= 0) { c.inv.splice(i, 1); markDirty(p); saveSoon(p); } },
  buy(p, m) {
    // Compatibilidade: algumas versões antigas do cliente enviavam o equipamento
    // pelo mesmo comando `buy`, usando `id` em vez de `k`.
    if (m && m.id) return HANDLERS.buynpc(p, m);
    if (Math.hypot(p.x - S.MERCHANT_POS.x, p.z - S.MERCHANT_POS.z) > 6) { msgTo(p, 'far_merchant'); return; }
    const row = S.SHOP.find(s => s[0] === (m && m.k)); const n = clamp(+m.n | 0, 1, 50); if (!row) return;
    const cost = Math.round(row[3] * n * eventDiscount()); if (p.c.gold < cost) { msgTo(p, 'no_gold'); return; }
    p.c.gold -= cost; if (row[0] === 'hp') p.c.hpPot += n; else if (row[0] === 'mp') p.c.mpPot += n; else p.c.crystals += n;
    markDirty(p); saveSoon(p);
  },
  async buynpc(p, m) {
    // Compra AUTORITATIVA de equipamento. O servidor altera o personagem,
    // salva no PostgreSQL e envia o estado novo ao cliente.
    const id = String(m && m.id || '').trim();
    if (!id) { msgTo(p, 'buy_error'); return; }

    const src = S.NPC_ITEMS.find(it => String(it.id) === id);
    if (!src) { msgTo(p, 'buy_error'); console.warn('[SHOP] item inexistente:', id); return; }

    const c = p.c;
    const price = Math.round(Math.max(0, Number(src.price) || 0) * eventDiscount());
    const reqLvl = Math.max(1, Number(src.reqLvl) || 1);

    // A loja só pode ser aberta normalmente perto do mercador. Usamos uma
    // margem maior no servidor para evitar rejeitar a compra por pequena
    // diferença de posição entre cliente e servidor.
    const merchantDistance = Math.hypot(p.x - S.MERCHANT_POS.x, p.z - S.MERCHANT_POS.z);
    if (merchantDistance > 12) { msgTo(p, 'far_merchant'); return; }
    if (c.lvl < reqLvl) { msgTo(p, 'need_lvl', { n: reqLvl }); return; }
    if (Number(c.gold) < price) { msgTo(p, 'no_gold'); return; }
    if (!Array.isArray(c.inv)) c.inv = [];
    if (c.inv.length >= S.INV_MAX) { msgTo(p, 'inv_full'); return; }

    // Item comprado é uma cópia independente do catálogo.
    const it = Object.assign({}, src, {
      id: 'it_' + Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex'),
    });
    delete it.price;
    delete it.reqLvl;
    delete it.cls_req;

    c.gold = Math.max(0, Number(c.gold) - price);
    c.inv.push(it);
    markDirty(p);

    // Persiste imediatamente para a compra não desaparecer ao relogar.
    try {
      await DB.saveChar(p.charId, c);
    } catch (e) {
      // Se o banco falhar, desfaz a operação para não cobrar o jogador sem item.
      c.inv.pop();
      c.gold += price;
      p.dirty = true;
      console.error('[SHOP] falha ao salvar compra:', e);
      msgTo(p, 'buy_error');
      return;
    }

    console.log('[SHOP] compra', c.name, id, 'preco=', price, 'ouro_restante=', c.gold, 'inv=', c.inv.length);

    // Confirmação da compra + estado autoritativo completo.
    msgTo(p, 'bought', { it, g: price });
    if (p.ws) p.ws.send({ t: 'me', c: p.c });
    p.dirty = false;
  },
  travel(p, map) {
    const cfg = S.MAPS[map]; if (!cfg || p.dead) return;
    if (p.c.lvl < cfg.minLvl) { msgTo(p, 'need_lvl', { n: cfg.minLvl }); return; }
    if (p.c.gold < cfg.cost) { msgTo(p, 'no_gold'); return; }
    p.c.gold -= cfg.cost; joinRoom(p, map); markDirty(p); saveSoon(p);
  },
  pvp(p, on) { if (p.c.lvl < 10) { msgTo(p, 'pvp_lvl'); return; } p.pvp = !!on; msgTo(p, on ? 'pvp_on' : 'pvp_off'); },
  chat(p, m) { if (m) chat(p, m); },
  block(p, name) {
    name = clean(name).toLowerCase(); if (!name) return; const b = p.c.blocked || (p.c.blocked = []);
    const i = b.indexOf(name); if (i >= 0) { b.splice(i, 1); msgTo(p, 'unblocked', { n: name }); } else if (b.length < 100) { b.push(name); msgTo(p, 'blocked', { n: name }); }
    markDirty(p); saveSoon(p);
  },
  // grupo
  pinv(p, m) {
    const q = m.id != null ? p.room && p.room.players.get(+m.id) : [...byChar.values()].find(x => x.ws && x.c.name.toLowerCase() === String(m.name || '').toLowerCase());
    if (!q || q === p) { msgTo(p, 'not_online', { n: m.name || '' }); return; }
    if (q.party) { msgTo(p, 'has_party', { n: q.c.name }); return; }
    if (p.party && p.party.members.length >= 5) { msgTo(p, 'party_full'); return; }
    if (p.party && p.party.leader !== p.charId) { msgTo(p, 'not_leader'); return; }
    q.invites.set('p' + p.charId, now()); if (q.ws) q.ws.send({ t: 'invite', kind: 'party', from: p.charId, name: p.c.name });
    msgTo(p, 'invite_sent', { n: q.c.name });
  },
  pans(p, m) {
    const key = 'p' + m.from; if (!p.invites.has(key)) return; p.invites.delete(key);
    const q = byChar.get(+m.from); if (!q) return;
    if (!m.ok) { msgTo(q, 'invite_no', { n: p.c.name }); return; }
    if (p.party) partyLeave(p, true);
    let pt = q.party; if (!pt) { pt = { id: partySeq++, leader: q.charId, members: [q.charId] }; parties.set(pt.id, pt); q.party = pt; }
    if (pt.members.length >= 5) { msgTo(p, 'party_full'); return; }
    pt.members.push(p.charId); p.party = pt; sendParty(pt);
    for (const id of pt.members) { const x = byChar.get(id); if (x) msgTo(x, 'party_join', { n: p.c.name }); }
  },
  pleave(p) { partyLeave(p); },
  pkick(p, cid) { const pt = p.party; if (!pt || pt.leader !== p.charId || cid === p.charId) return; const q = byChar.get(cid); if (q) { partyLeave(q); msgTo(q, 'kicked'); } },
  // guilda
  async gcreate(p, name) {
    name = clean(name); if (!/^[A-Za-zÀ-ÿ0-9 ]{3,16}$/.test(name)) { msgTo(p, 'guild_name'); return; }
    if (p.c.guild) { msgTo(p, 'has_guild'); return; } if (p.c.lvl < 10) { msgTo(p, 'guild_lvl'); return; }
    if (p.c.gold < 1000) { msgTo(p, 'no_gold'); return; } if (guilds.has(name.toLowerCase())) { msgTo(p, 'guild_taken'); return; }
    p.c.gold -= 1000; const g = { name, leader: p.charId, created: now(), members: [{ id: p.charId, name: p.c.name, rank: 'leader', lvl: p.c.lvl }] };
    guilds.set(name.toLowerCase(), g); await DB.saveGuild(g); await setCharGuild(p.charId, name); sendGuild(g); msgTo(p, 'guild_created', { n: name });
    DB.log('guild_create', { guild: name, by: p.c.name });
  },
  ginv(p, name) {
    const g = guildOf(p); if (!g) { msgTo(p, 'no_guild'); return; }
    if (!['leader', 'officer'].includes(rankOf(g, p.charId))) { msgTo(p, 'not_officer'); return; }
    if (g.members.length >= 30) { msgTo(p, 'guild_full'); return; }
    const q = [...byChar.values()].find(x => x.ws && x.c.name.toLowerCase() === String(name || '').toLowerCase());
    if (!q) { msgTo(p, 'not_online', { n: name }); return; } if (q.c.guild) { msgTo(p, 'has_guild_other', { n: q.c.name }); return; }
    q.invites.set('g' + g.name.toLowerCase(), now()); if (q.ws) q.ws.send({ t: 'invite', kind: 'guild', from: g.name, name: p.c.name });
    msgTo(p, 'invite_sent', { n: q.c.name });
  },
  async gans(p, m) {
    const key = 'g' + String(m.guild || '').toLowerCase(); if (!p.invites.has(key)) return; p.invites.delete(key);
    const g = guilds.get(String(m.guild).toLowerCase()); if (!g || !m.ok || p.c.guild) return;
    if (g.members.length >= 30) { msgTo(p, 'guild_full'); return; }
    g.members.push({ id: p.charId, name: p.c.name, rank: 'member', lvl: p.c.lvl }); await DB.saveGuild(g); await setCharGuild(p.charId, g.name); sendGuild(g);
    for (const mm of g.members) { const q = byChar.get(mm.id); if (q) msgTo(q, 'guild_join', { n: p.c.name }); }
  },
  async gleave(p) {
    const g = guildOf(p); if (!g) return;
    g.members = g.members.filter(m => m.id !== p.charId); await setCharGuild(p.charId, null); if (p.ws) p.ws.send({ t: 'guild', name: null });
    if (!g.members.length) { guilds.delete(g.name.toLowerCase()); await DB.deleteGuild(g.name); return; }
    if (g.leader === p.charId) { const nx = g.members.find(m => m.rank === 'officer') || g.members[0]; nx.rank = 'leader'; g.leader = nx.id; }
    await DB.saveGuild(g); sendGuild(g);
  },
  async gkick(p, cid) {
    const g = guildOf(p); if (!g) return; const me = rankOf(g, p.charId), them = rankOf(g, cid);
    if (!them || cid === p.charId || !(me === 'leader' || (me === 'officer' && them === 'member'))) { msgTo(p, 'not_officer'); return; }
    g.members = g.members.filter(m => m.id !== cid); await setCharGuild(cid, null); await DB.saveGuild(g); sendGuild(g);
    const q = byChar.get(cid); if (q) { msgTo(q, 'kicked_guild'); if (q.ws) q.ws.send({ t: 'guild', name: null }); }
  },
  async grank(p, m) {
    const g = guildOf(p); if (!g || g.leader !== p.charId) { msgTo(p, 'not_leader'); return; }
    const mm = g.members.find(x => x.id === m.id); if (!mm || mm.id === p.charId || !['officer', 'member'].includes(m.rank)) return;
    mm.rank = m.rank; await DB.saveGuild(g); sendGuild(g);
  },
};

/* ---------- conexão ---------- */
function onSocket(ws, ip) {
  sockets.add(ws); let p = null;
  const authTimer = setTimeout(() => { if (!p) ws.close(4001); }, 10000);
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!p) {
      if (msg.t !== 'auth') return;
      const tok = verify(msg.token); if (!tok) { ws.send({ t: 'authfail', k: 'auth' }); ws.close(4001); return; }
      const cid = +msg.char; const row = byChar.get(cid) ? null : await DB.charById(cid);
      const live = byChar.get(cid);
      if (live) {
        if (live.accId !== tok.a) { ws.close(4003); return; }
        if (live.ws && live.ws !== ws) { live.ws.send({ t: 'kick', k: 'other_device' }); const old = live.ws; live.ws = null; old.close(4002); }
        p = live; p.ws = ws; p.ghost = false; p.offlineAt = null; clearTimeout(authTimer);
        if (SYS) SYS.onEnter(p);
        if (!p.room) joinRoom(p, p.c.map); else { sendInit(p); p.room.send({ t: 'join', p: playerInfo(p) }, p); }
        return;
      }
      if (!row || row.account_id !== tok.a) { ws.send({ t: 'authfail', k: 'no_char' }); ws.close(4003); return; }
      clearTimeout(authTimer);
      const c = row.data;
      for (const s of S.SLOTS) if (c.equip[s] === undefined) c.equip[s] = null;
      if (!Object.prototype.hasOwnProperty.call(c.equip,'asas')) c.equip.asas = null;
      if (c.resets === undefined) c.resets = 0;
      Object.assign(c, { pvpKills: c.pvpKills || 0, pvpDeaths: c.pvpDeaths || 0, bossKills: c.bossKills || 0, blocked: c.blocked || [] });
      if (c.guild && !guilds.has(c.guild.toLowerCase())) c.guild = null;
      let accRow = null; try { accRow = await DB.accountById(tok.a); } catch (e) {}
      p = { id: row.id, charId: row.id, accId: tok.a, role: (SYS && SYS.roleOf) ? SYS.roleOf(accRow) : null, ws, c, x: 0, z: 4, h: Math.PI, hp: S.maxHp(c), mp: S.maxMp(c), dead: false, moving: false,
        lastAtk: 0, lastMove: now(), lastPot: 0, lastChat: 0, skillCd: [0, 0], act: null, actN: 0, party: null, pvp: false, invites: new Map(), dirty: false, ghost: false };
      byChar.set(row.id, p);
      if (SYS) SYS.onEnter(p);
      const cfg = S.MAPS[c.map]; joinRoom(p, cfg && c.lvl >= cfg.minLvl ? c.map : 'valoria');
      broadcastAll({ t: 'chat', ch: 'sys', k: 'online', n: c.name });
      return;
    }
    if (p.ws !== ws) return;
    const h = HANDLERS[msg.t];
    if (h && p.room) { try { await h(p, msg.d); } catch (e) { console.error('handler', msg.t, e); } }
  });
  ws.on('close', () => {
    sockets.delete(ws); clearTimeout(authTimer);
    if (p && p.ws === ws) { p.ws = null; p.ghost = true; p.offlineAt = now(); p.moving = false; if (p.room) p.room.send({ t: 'leave', id: p.id }); saveNow(p); }
  });
}

/* =============================== INÍCIO =============================== */
(async () => {
  await DB.init();
  try { const SYSF = pickFile(__dirname, 'systems', '.js'); if (!SYSF) throw new Error('systems.js não encontrado na raiz'); SYS = require(SYSF)({ S, DB, byChar, rooms, HANDLERS, markDirty, saveNow, saveSoon, broadcastAll, now, log, genItem, hurtPlayer }); }
  catch (e) { console.error('[aviso] systems.js indisponível; o jogo roda sem os sistemas novos:', e.message); SYS = null; }
  for (const g of await DB.loadGuilds()) guilds.set(g.name.toLowerCase(), g);
  for (const m of S.MAP_ORDER) getRoom(m);
  server.listen(PORT, () => log(`Eternal Realms ouvindo na porta ${PORT} (banco: ${DB.kind()}) · versão ${BUILD}`));
})().catch(e => { console.error('Falha ao iniciar', e); process.exit(1); });
async function shutdown() { log('salvando antes de desligar…'); await Promise.all([...byChar.values()].map(saveNow)); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('uncaughtException', e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

// ═══════════════════════════════════════════════════════════
// SISTEMA DE EVENTOS AUTOMÁTICOS — MuonlineClaude
// Cada evento tem uma mecânica real: pontos por abates, coleta de objetos, XP em dobro, desconto na loja.
// ═══════════════════════════════════════════════════════════
const EVENTS = {
  arena:         { name: 'Arena das Almas',    icon: '⚔️', duration: 8 * 60e3,  minPlayers: 1, cooldown: 90 * 60e3,  lastRun: 0, desc: 'Derrote o máximo de monstros! Quem somar mais pontos ganha prêmios.' },
  invasion:      { name: 'Invasão do Caos',    icon: '🌑', duration: 10 * 60e3, minPlayers: 1, cooldown: 60 * 60e3,  lastRun: 0, desc: 'Hordas das trevas invadem o mundo! Cada abate vale pontos em dobro.' },
  treasure:      { name: 'Caça ao Tesouro',    icon: '💰', duration: 6 * 60e3,  minPlayers: 1, cooldown: 45 * 60e3,  lastRun: 0, desc: 'Baús de tesouro surgiram pelo mapa. Toque neles antes dos outros!' },
  worldboss:     { name: 'Caçada aos Chefes',  icon: '🐉', duration: 15 * 60e3, minPlayers: 1, cooldown: 120 * 60e3, lastRun: 0, desc: 'Cada chefe derrotado vale 100 pontos! Una forças com outros jogadores.' },
  pvptournament: { name: 'Torneio PvP',        icon: '🏆', duration: 12 * 60e3, minPlayers: 2, cooldown: 100 * 60e3, lastRun: 0, desc: 'Ative o PvP e vença duelos: cada vitória vale 20 pontos!' },
  nightdead:     { name: 'Noite da Sabedoria', icon: '💀', duration: 7 * 60e3,  minPlayers: 1, cooldown: 75 * 60e3,  lastRun: 0, desc: 'Experiência 5× por tempo limitado! Aproveite para subir de nível.' },
  crystalrain:   { name: 'Chuva de Cristais',  icon: '💎', duration: 5 * 60e3,  minPlayers: 1, cooldown: 40 * 60e3,  lastRun: 0, desc: 'Cristais caíram do céu! Toque neles para coletar.' },
  merchant:      { name: 'Festa do Mercador',  icon: '🎪', duration: 10 * 60e3, minPlayers: 1, cooldown: 80 * 60e3,  lastRun: 0, desc: 'Todos os itens das lojas com 50% de desconto!' },
};
let currentEvent = null;   // { id, ev, endAt, scores: Map(playerId -> pts), names, objs: Map(objId -> {type,x,z}) }
let eventTimer = null;
let nightActive = false;

const onlinePlayers = () => [...byChar.values()].filter(p => p.ws && !p.ghost);
const eventDiscount = () => (currentEvent && currentEvent.id === 'merchant') ? .5 : 1;
function sysChat(msg, extra) { broadcastAll(Object.assign({ t: 'chat', ch: 'sys', msg }, extra || {})); }   // 'extra' deixa o cliente traduzir

function startEvent(id) {
  const ev = EVENTS[id]; if (!ev || currentEvent) return;
  if (onlinePlayers().length < ev.minPlayers) return;
  ev.lastRun = Date.now();
  currentEvent = { id, ev, endAt: Date.now() + ev.duration, scores: new Map(), names: new Map(), objs: new Map() };
  broadcastAll({ t: 'event_start', id, name: ev.name, icon: ev.icon, desc: ev.desc, duration: ev.duration });
  sysChat(`${ev.icon} EVENTO: ${ev.name} começou! ${ev.desc}`, { ev: 'start', id, icon: ev.icon });
  if (id === 'nightdead') { nightActive = true; broadcastAll({ t: 'night_start' }); }
  if (id === 'crystalrain') {
    const list = Array.from({ length: 20 }, (_, i) => ({ id: 'cr_' + i, x: Math.round((Math.random() - .5) * 200), z: Math.round((Math.random() - .5) * 200) }));
    list.forEach(o => currentEvent.objs.set(o.id, { type: 'crystal', x: o.x, z: o.z }));
    broadcastAll({ t: 'crystal_rain', crystals: list });
  }
  if (id === 'treasure') {
    const list = Array.from({ length: 8 }, (_, i) => ({ id: 'ch_' + i, x: Math.round((Math.random() - .5) * 180), z: Math.round((Math.random() - .5) * 180) }));
    list.forEach(o => currentEvent.objs.set(o.id, { type: 'chest', x: o.x, z: o.z }));
    broadcastAll({ t: 'treasure_spawn', chests: list });
  }
  eventTimer = setTimeout(() => { try { endEvent(); } catch (e) { console.error('endEvent', e); currentEvent = null; nightActive = false; } }, ev.duration);
}

function endEvent() {
  if (!currentEvent) return;
  const { id, ev, scores, names } = currentEvent;
  clearTimeout(eventTimer);
  const ranking = [...scores.entries()].filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const goldPrize = [5000, 2500, 1000], crystalPrize = [6, 4, 2];
  ranking.forEach(([pid, sc], i) => {
    const p = byChar.get(pid); if (!p) return;
    p.c.gold += goldPrize[i]; p.c.crystals = (p.c.crystals || 0) + crystalPrize[i];
    markDirty(p); saveNow(p);
    if (p.ws) p.ws.send({ t: 'event_prize', gold: goldPrize[i], crystals: crystalPrize[i], rank: i + 1 });
  });
  if (id === 'nightdead') { nightActive = false; broadcastAll({ t: 'night_end' }); }
  const top = ranking[0];
  const winnerName = top ? (names.get(top[0]) || '?') : null;
  broadcastAll({ t: 'event_end', id, name: ev.name, icon: ev.icon, winner: winnerName, topScore: top ? top[1] : 0 });
  sysChat(`${ev.icon} EVENTO ENCERRADO: ${ev.name}` + (winnerName ? ` — Campeão: ${winnerName} (${top[1]} pts)!` : ''), { ev: 'end', id, icon: ev.icon, w: winnerName, p: top ? top[1] : 0 });
  currentEvent = null;
}

function addEventScore(p, pts) {
  if (!currentEvent || !p || !(pts > 0)) return;
  const sc = (currentEvent.scores.get(p.id) || 0) + pts;
  currentEvent.scores.set(p.id, sc); currentEvent.names.set(p.id, p.c.name);
  if (SYS) SYS.onEvent(p, pts);
  broadcastAll({ t: 'event_score', pid: p.id, name: p.c.name, score: sc });
}
function eventOnKill(p, m) {
  if (!currentEvent || !p) return;
  const id = currentEvent.id, base = Math.max(1, Math.round(m.lvl / 5));
  if (id === 'arena' || id === 'nightdead') addEventScore(p, base);
  else if (id === 'invasion') addEventScore(p, base * 2);
  else if (id === 'worldboss') addEventScore(p, m.boss ? 100 : base);
}
function eventOnPvpKill(p) { if (currentEvent && currentEvent.id === 'pvptournament') addEventScore(p, 20); }

// Coleta de cristais e baús: o servidor valida se o objeto existe, se ainda não foi pego e se o jogador está perto
function handleEventCollect(p, m) {
  if (!currentEvent || !m || typeof m.id !== 'string') return;
  const o = currentEvent.objs.get(m.id); if (!o) return;
  if (Math.hypot(o.x - p.x, o.z - p.z) > 14) return;
  currentEvent.objs.delete(m.id);
  if (o.type === 'crystal') {
    const n = 1 + Math.floor(Math.random() * 3);
    p.c.crystals = (p.c.crystals || 0) + n; markDirty(p); saveNow(p);
    msgTo(p, 'loot_crystal', { n }); addEventScore(p, n * 5);
    broadcastAll({ t: 'crystal_collected', id: m.id, by: p.c.name });
  } else if (o.type === 'chest') {
    const gold = 500 + Math.floor(Math.random() * 2000), crystals = Math.floor(Math.random() * 5);
    p.c.gold += gold; p.c.crystals = (p.c.crystals || 0) + crystals; markDirty(p); saveNow(p);
    if (p.ws) p.ws.send({ t: 'fx', e: 'gold', v: gold });
    if (crystals) msgTo(p, 'loot_crystal', { n: crystals });
    addEventScore(p, Math.round(gold / 100));
    broadcastAll({ t: 'chest_opened', id: m.id, by: p.c.name });
  }
}

// ── Agenda (ciclo de 3 horas) ──
const EVENT_SCHEDULE = [[5, 'invasion'], [20, 'arena'], [35, 'treasure'], [50, 'crystalrain'], [65, 'nightdead'], [80, 'worldboss'],
  [100, 'pvptournament'], [120, 'merchant'], [140, 'invasion'], [155, 'arena'], [165, 'crystalrain']];
function checkEventSchedule() {
  if (currentEvent || !onlinePlayers().length) return;
  const nowMs = Date.now(), pos = nowMs % (180 * 60e3);
  for (const [min, id] of EVENT_SCHEDULE) {
    const ev = EVENTS[id], w = min * 60e3;
    if (ev && pos >= w && pos < w + 60e3 && nowMs - ev.lastRun > ev.cooldown) { console.log('[EVENT] iniciando', id); startEvent(id); return; }
  }
}
function checkEventWarnings() {
  if (currentEvent || !onlinePlayers().length) return;
  const nowMs = Date.now(), pos = nowMs % (180 * 60e3);
  for (const [min, id] of EVENT_SCHEDULE) {
    const ev = EVENTS[id], w = (min - 3) * 60e3;
    if (ev && w > 0 && pos >= w && pos < w + 60e3 && nowMs - ev.lastRun > ev.cooldown) sysChat(`${ev.icon} AVISO: ${ev.name} começa em 3 minutos!`, { ev: 'warn', id, icon: ev.icon });
  }
}
setInterval(() => { try { checkEventSchedule(); } catch (e) { console.error('schedule', e); } }, 60000);
setInterval(() => { try { checkEventWarnings(); } catch (e) { console.error('warnings', e); } }, 60000);

HANDLERS.event_collect = (p, m) => handleEventCollect(p, m);
HANDLERS.event_status = p => {
  if (currentEvent && p.ws) p.ws.send({ t: 'event_info', id: currentEvent.id, name: currentEvent.ev.name, icon: currentEvent.ev.icon,
    timeLeft: Math.max(0, currentEvent.endAt - Date.now()), score: currentEvent.scores.get(p.id) || 0 });
};
console.log('[EVENTS] sistema carregado:', Object.keys(EVENTS).join(', '));
