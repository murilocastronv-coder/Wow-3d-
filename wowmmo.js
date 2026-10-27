'use strict';
/* Reinos de Valdor — economia AUTORITATIVA do servidor (WOW 3D).
   DropManager · GoldRewardService · DropTableService · GroundItemManager · ItemExpirationService · ItemPickupService ·
   LootOwnershipService · InventoryService · BankService · ShopService · MountService · ForgeService (Ferreiro) · SubclassService.
   Regras fixas:
   - Ouro do drop vai DIRETO para a bolsa do jogador (nunca aparece no chão).
   - Itens do drop aparecem no chão, onde o monstro morreu, por EXATAMENTE 60 s (relógio do servidor), cada um com o próprio prazo.
   - Coleta: o servidor confere existência, prazo, mapa, distância, permissão e espaço na mochila; retirar do chão e entregar
     acontecem no mesmo passo síncrono (o Node executa um handler por vez), então dois jogadores nunca levam o mesmo item.
   - Enquanto o herói está conectado, ouro/mochila/equipamento/banco vivem aqui (p.eco) e são gravados no banco de dados por este
     módulo. O /api/wow/save NÃO grava mais esses campos vindos do navegador. */
const WI = require('./wowitems'), WD = require('./wowdata');

module.exports = function ({ DB, log, lock, send, sys, players, byChar, now }) {
  const INV_MAX = 40, BANK_MAX = 60, NPC_RANGE = 14, TOWN_R = 50;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
  let CFG = { drop: WI.DROP, recipes: WI.RECIPES, sub: WI.SUB, fail: { keepMats: 0 } };
  let useq = 0, gseq = 0, kseq = 0;
  const uid = () => 'u' + Date.now().toString(36) + (++useq).toString(36) + Math.random().toString(36).slice(2, 5);
  const iid = () => 'g' + Date.now().toString(36) + (++gseq).toString(36) + Math.random().toString(36).slice(2, 6);
  const audit = (k, o) => { try { DB.log(k, o); } catch (e) {} };

  /* ---------- configuração editável pelo ADM (kv wowcfg) ---------- */
  async function loadCfg() {
    try {
      const o = (await DB.kvGet('wowcfg')) || {};
      CFG = { drop: WI.mergeCfg(WI.DROP, o.drop), recipes: Array.isArray(o.recipes) && o.recipes.length ? o.recipes.map(cleanRecipe).filter(Boolean) : WI.RECIPES,
        sub: Object.assign({}, WI.SUB, { fees: WI.mergeCfg(WI.SUB.fees, o.sub && o.sub.fees), need: WI.mergeCfg(WI.SUB.need, o.sub && o.sub.need), combat: WI.mergeCfg(WI.SUB.combat, o.sub && o.sub.combat), minLvl: o.sub && +o.sub.minLvl > 0 ? +o.sub.minLvl | 0 : WI.SUB.minLvl, off: (o.sub && Array.isArray(o.sub.off)) ? o.sub.off.filter(x => WI.SUB.defs[x]) : [] }),
        fail: { keepMats: o.fail && +o.fail.keepMats >= 0 && +o.fail.keepMats <= 1 ? +o.fail.keepMats : 0 } };
    } catch (e) { console.error('[mmo cfg]', e.message); }
  }
  function cleanRecipe(r) {
    if (!r || typeof r !== 'object' || !WI.SLOTS[r.slot]) return null;
    const mats = {}; for (const k in r.mats || {}) if (WI.MATS[k] && !WI.MATS[k].quest) mats[k] = Math.max(1, Math.min(999, r.mats[k] | 0));
    return { id: clean(r.id, 24) || 'r' + Math.random().toString(36).slice(2, 7), n: clean(r.n, 48) || 'Item Mítico', slot: r.slot, lvl: Math.max(1, Math.min(WD.LV_CAP, r.lvl | 0)),
      gold: Math.max(0, Math.min(1e10, Math.floor(+r.gold || 0))), chance: Math.max(.01, Math.min(1, +r.chance || 1)), rar: Math.max(4, Math.min(6, (r.rar | 0) || 6)), mats, off: !!r.off };
  }
  async function saveCfg(patch) {
    const o = (await DB.kvGet('wowcfg')) || {};
    if (patch.drop) o.drop = WI.mergeCfg(WI.DROP, Object.assign({}, o.drop || {}, patch.drop));
    if (patch.recipes) o.recipes = patch.recipes.map(cleanRecipe).filter(Boolean);
    if (patch.sub) o.sub = Object.assign({}, o.sub || {}, patch.sub);
    if (patch.fail) o.fail = patch.fail;
    await DB.kvSet('wowcfg', o); await loadCfg(); return CFG;
  }
  const whenDb = async fn => { for (let i = 0; i < 400; i++) { try { await DB.kvGet('wowcfg'); return fn(); } catch (e) { await new Promise(r => setTimeout(r, 250)); } } };   // o banco termina de abrir depois deste módulo
  whenDb(loadCfg);

  /* =============================== ECONOMIA DO HERÓI =============================== */
  const ECO_KEYS = ['gold', 'inv', 'eq', 'bank', 'mounts', 'mnt', 'sub', 'qk', 'qa', 'qd', 'achs', 'ttl'];
  function normItem(it) {   // garante a "alça" única (u) usada nas mensagens; não altera atributos
    if (!it || typeof it !== 'object') return null;
    if (!it.u) it.u = uid(); if (it.stack) it.n = Math.max(1, Math.min(WI.STACK_MAX, it.n | 0));
    return it;
  }
  function ecoFrom(sv) {
    const e = { gold: Math.max(0, Math.floor(+sv.gold || 0)), inv: (Array.isArray(sv.inv) ? sv.inv : []).map(normItem).filter(Boolean).slice(0, INV_MAX),
      eq: {}, bank: (Array.isArray(sv.bank) ? sv.bank : []).map(normItem).filter(Boolean).slice(0, BANK_MAX),
      mounts: Array.isArray(sv.mounts) ? sv.mounts.filter(x => WI.MOUNT_BY[x]) : [], mnt: WI.MOUNT_BY[sv.mnt] ? sv.mnt : null,
      sub: sv.sub && typeof sv.sub === 'object' ? sv.sub : {}, qk: sv.qk && typeof sv.qk === 'object' ? sv.qk : {}, qa: sv.qa && typeof sv.qa === 'object' ? sv.qa : {}, qd: sv.qd && typeof sv.qd === 'object' ? sv.qd : {},
      achs: Array.isArray(sv.achs) ? sv.achs.filter(x => WI.ACH_BY[x]) : [], ttl: WI.ACH_BY[sv.ttl] ? sv.ttl : null };
    for (const k in sv.eq || {}) if (WI.SLOTS[k] && sv.eq[k]) e.eq[k] = normItem(sv.eq[k]);
    if (!e.mounts.includes('cavalo')) e.mounts.unshift('cavalo');
    // missões antigas (antes do servidor contar): concluídas ficam concluídas; ativas guardam o progresso já feito
    const q = sv.q && typeof sv.q === 'object' ? sv.q : {};
    for (const id in WD.QUESTS) { const st = q[id]; if (!st) continue; if (st.s === 'done') e.qd[id] = 1; else if (e.qa[id] == null && WD.QUESTS[id].kill) e.qa[id] = (e.qk[WD.QUESTS[id].kill] | 0) - Math.min(WD.QUESTS[id].need, st.n | 0); else if (e.qa[id] == null) e.qa[id] = 0; }
    const s = e.sub; s.step = s.step | 0; s.lvl = s.lvl | 0; s.xp = Math.max(0, +s.xp || 0); s.pts = s.pts | 0; s.tree = s.tree && typeof s.tree === 'object' ? s.tree : {}; s.c = s.c && typeof s.c === 'object' ? s.c : { el: 0, gd: 0, bs: 0 };
    return e;
  }
  const snap = p => { const e = p.eco; return { t: 'eco', g: e.gold, inv: e.inv, eq: e.eq, bank: p.bankOpen ? e.bank : undefined, mounts: e.mounts, mnt: e.mnt, sub: subView(e), qd: e.qd, qp: questProg(e), max: INV_MAX, ach: achView(e), ttl: e.ttl || null }; };
  function achView(e) { const o = {}; for (const a of WI.ACH) { const [v, n] = a.p(e); o[a.id] = [Math.min(v, n), n]; } return o; }
  function achCheck(p) {   // avisa conquistas novas uma única vez
    const e = p.eco; e.achs = e.achs || []; for (const id of WI.achDone(e)) if (!e.achs.includes(id)) { e.achs.push(id); const a = WI.ACH_BY[id]; send(p, { t: 'ach', id, n: a.n, tt: a.t }); audit('ach', { c: p.charId, id }); } }
  function push(p, extra) { if (p.eco) send(p, Object.assign(snap(p), extra || {})); }
  const timers = new Map();
  function persist(p, now_) {
    if (!p.eco || p.ecoFrozen) return; p.eco.dirty = true;
    clearTimeout(timers.get(p.charId)); if (now_) return flush(p);
    timers.set(p.charId, setTimeout(() => flush(p).catch(e => console.error('[mmo flush]', e.message)), 1200));
  }
  function flush(p) {
    clearTimeout(timers.get(p.charId)); timers.delete(p.charId);
    const e = p.eco; if (!e || !e.dirty || p.ecoFrozen) return Promise.resolve();
    e.dirty = false; const copy = JSON.parse(JSON.stringify({ gold: e.gold, inv: e.inv, eq: e.eq, bank: e.bank, mounts: e.mounts, mnt: e.mnt, sub: e.sub, qk: e.qk, qa: e.qa, qd: e.qd, achs: e.achs || [], ttl: e.ttl || null }));
    rankUpd(p);
    return lock('wow:' + p.charId, async () => {
      const sv = await DB.kvGet('wow:' + p.charId); if (!sv) return;
      Object.assign(sv, copy); delete sv.fresh; sv.tv = (sv.tv | 0) + 1; sv.t = Date.now(); await DB.kvSet('wow:' + p.charId, sv);
    }).catch(err => { e.dirty = true; throw err; });
  }
  async function onHi(p) {
    const sv = await DB.kvGet('wow:' + p.charId); if (!sv) return;
    p.eco = ecoFrom(sv); p.ecoFrozen = false;
    if (sv.fresh && !p.eco.inv.length && !Object.keys(p.eco.eq).length) {   // herói novo: kit inicial gerado pelo servidor
      addTo(p.eco.inv, WI.mkStack('pot', 3), INV_MAX); const w = WI.gen(1, 1, 'arma', p.cls, Math.random, iid); w.name = w.name.split(' ')[0] + ' de Treino'; p.eco.eq.arma = normItem(w);
    }
    persist(p);   // grava as alças (u) novas e o kit
    push(p, { first: 1, rcp: CFG.recipes }); sendGround(p);
  }
  async function onLeave(p) { try { await flush(p); } catch (e) { console.error('[mmo leave]', e.message); } }
  function freeze(charId) { const p = byChar.get(charId); if (p) { p.ecoFrozen = true; clearTimeout(timers.get(charId)); timers.delete(charId); } }
  async function flushChar(charId) { const p = byChar.get(charId); if (p && p.eco) await flush(p); }

  /* ---------- mochila (InventoryService) ---------- */
  const isStack = it => !!it.stack;
  function roomFor(inv, it, cap) {   // quantas entradas novas este item ocupa
    if (!isStack(it)) return inv.length < cap;
    let left = it.n | 0; for (const s of inv) if (s.stack && s.id === it.id) left -= WI.STACK_MAX - (s.n | 0);
    return left <= 0 || inv.length < cap;
  }
  function addTo(inv, it, cap) {
    if (!roomFor(inv, it, cap)) return false;
    if (isStack(it)) { let left = it.n | 0; for (const s of inv) { if (!left) break; if (s.stack && s.id === it.id && s.n < WI.STACK_MAX) { const k = Math.min(left, WI.STACK_MAX - s.n); s.n += k; left -= k; } }
      while (left > 0) { const k = Math.min(left, WI.STACK_MAX); inv.push(normItem(Object.assign({}, it, { n: k, u: uid() }))); left -= k; } return true; }
    inv.push(normItem(it)); return true;
  }
  const count = (inv, id) => inv.reduce((a, s) => a + (s.id === id ? (s.n | 0) || 1 : 0), 0);
  function take(inv, id, n) { for (let i = inv.length - 1; i >= 0 && n > 0; i--) { const s = inv[i]; if (s.id !== id) continue; const k = Math.min(n, s.stack ? s.n | 0 : 1); n -= k; if (s.stack) { s.n -= k; if (s.n <= 0) inv.splice(i, 1); } else inv.splice(i, 1); } return n <= 0; }
  const byU = (inv, u) => inv.findIndex(x => x.u === u);
  const nearNpc = (p, k) => { const c = WD.NPCPOS[k]; return c && !p.inst && Math.hypot(p.x - c[0], p.z - c[1]) <= NPC_RANGE; };
  const fail = (p, x, rq) => { send(p, { t: 'ie', x, rq }); return false; };
  const ok = (p, rq, extra) => { achCheck(p); persist(p); push(p, Object.assign({ rq }, extra || {})); return true; };

  /* =============================== ITENS NO CHÃO (GroundItemManager + ItemExpirationService) =============================== */
  const ground = new Map();   // id -> {id, it, x, z, inst, t0, exp, own:Set|null, ex:charId|null, party:Set|null, by}
  let gDirty = false;
  const gPub = (g, p) => ({ id: g.id, x: Math.round(g.x * 10) / 10, z: Math.round(g.z * 10) / 10, ms: Math.max(0, g.exp - now()), it: { name: g.it.name, ic: g.it.ic, rar: g.it.rar | 0, n: g.it.n, slot: g.it.slot, lvl: g.it.lvl }, mine: g.own ? 1 : 0 });
  const canSee = (g, p) => p.inst === g.inst && (!g.own || g.own.has(p.charId));
  const canTake = (g, p) => canSee(g, p) && (!g.party || g.party.has(p.charId) || (p.party && [...g.party].some(c => { const o = byChar.get(c); return o && o.party === p.party; })));
  function spawnGround(it, x, z, inst, own, i, n, kid) {
    const a = (n > 1 ? i / n * 6.283 : 0) + Math.random() * .5, r = n > 1 ? .9 + Math.random() * .8 : .3;
    let gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r;
    const T = require('./terrain'); if (!inst && !T.walkable(gx, gz)) { gx = x; gz = z; }
    const t = now(), g = { id: iid(), it: normItem(it), x: gx, z: gz, inst: inst || null, t0: t, exp: t + CFG.drop.itemTtlMs, own: own || null, kid: kid || 0 };
    ground.set(g.id, g); if (!inst) gDirty = true;
    const pub = { t: 'gi', g: null };
    for (const p of players.values()) if (p.ready && canSee(g, p) && dist(p, g) < 140) { pub.g = gPub(g, p); send(p, pub); }
    return g;
  }
  function removeGround(g, why, by) {
    if (!ground.delete(g.id)) return false; if (!g.inst) gDirty = true;
    for (const p of players.values()) if (canSee(g, p)) send(p, { t: 'gr', id: g.id, w: why, by: by || undefined });
    return true;
  }
  function sendGround(p) { const l = []; for (const g of ground.values()) if (canSee(g, p)) l.push(gPub(g, p)); send(p, { t: 'gl', l }); }
  // limpeza: roda sempre, mesmo sem ninguém por perto
  setInterval(() => { const t = now(); for (const g of [...ground.values()]) if (t >= g.exp) { removeGround(g, 'x'); audit('loot_expire', { id: g.id, item: g.it.id, k: g.kid }); } }, 250);
  // persistência dos itens do mundo aberto (masmorras somem com a instância). Ao reiniciar, quem já venceu não volta.
  setInterval(async () => { if (!gDirty) return; gDirty = false; try { await DB.kvSet('wow:ground', [...ground.values()].filter(g => !g.inst).map(g => ({ id: g.id, it: g.it, x: g.x, z: g.z, t0: g.t0, exp: g.exp, own: g.own ? [...g.own] : null, party: g.party ? [...g.party] : null, kid: g.kid }))); } catch (e) { gDirty = true; } }, 3000);
  whenDb(async () => { try { const l = (await DB.kvGet('wow:ground')) || [], t = now(); let n = 0; for (const o of l) { if (!o || !o.it || o.exp <= t) continue; ground.set(o.id, { id: o.id, it: o.it, x: o.x, z: o.z, inst: null, t0: o.t0, exp: o.exp, own: o.own ? new Set(o.own) : null, party: o.party ? new Set(o.party) : null, kid: o.kid }); n++; } gDirty = true; if (l.length) log('[mmo] itens no chão restaurados:', n, 'de', l.length); for (const p of players.values()) sendGround(p); } catch (e) { console.error('[mmo ground]', e.message); } });

  /* =============================== DROP (DropManager / GoldRewardService / LootOwnershipService) =============================== */
  const rewarded = new Set();   // ids de morte já premiados (nunca premia a mesma morte duas vezes)
  function onKill(m, recips, killer, extra) {
    const kid = ++kseq; if (rewarded.has(kid)) return; rewarded.add(kid); if (rewarded.size > 50000) rewarded.clear();
    const d = m.d || WD.MT[m.type] || {}, cat = WI.catOf({ world: d.world, boss: m.boss || d.boss, elite: m.elite || d.elite }), mode = (CFG.drop.mode && CFG.drop.mode[cat]) || 'individual';
    const list = [...recips].filter(p => p.eco && !p.ecoFrozen);
    const goldB = p => ((WD.RACES[p.race] || {}).b || {}).gold || 0;
    const evx = extra && extra.rare;   // item raro de evento (já sorteado por jogador)
    const progress = p => {
      const e = p.eco; e.qk[m.type] = (e.qk[m.type] | 0) + 1;
      const s = e.sub; if (s.step === 3) { if (m.elite || d.elite) s.c.el = (s.c.el | 0) + 1; if (d.guard) s.c.gd = (s.c.gd | 0) + 1; if (m.type === 'ancestral') s.c.bs = (s.c.bs | 0) + 1; subCheck(p); }
      if (s.id) subXp(p, m.lvl, cat);
    };
    const give = (p, gold, items, own) => {
      p.eco.gold += gold; send(p, { t: 'gold', g: gold, tot: p.eco.gold, k: kid });
      items.forEach((it, i) => spawnGround(it, m.x, m.z, m.inst, own, i, items.length, kid));
      audit('loot_kill', { k: kid, c: p.charId, mob: m.type, l: m.lvl, gold, items: items.map(x => x.id + (x.n > 1 ? 'x' + x.n : '')) });
    };
    const extras = (p, items) => {
      if (evx && evx.get(p.id)) { const r = evx.get(p.id), it = WI.gen(m.lvl, r.r, r.s, p.cls, Math.random, iid); it.name = r.n[0]; it.ev = 1; for (const k of ['atk', 'arm', 'hp']) if (it[k]) { it[k] = Math.round(it[k] * 1.12); it.b[k] = it[k]; } it.price = WI.priceOf(it); items.push(it); send(p, { t: 'rare', n: it.name }); }
      if (m.type === 'morvak') items.push(WI.gen(m.lvl, 5, null, p.cls, Math.random, iid));
      if (m.type === 'dragao' && Math.random() < .08) send(p, { t: 'mnt', id: 'dracofogo' }), p.eco.mounts.includes('dracofogo') || p.eco.mounts.push('dracofogo');
    };
    if (mode === 'individual' || list.length <= 1) {
      for (const p of list) { const r = WI.roll(CFG.drop, cat, m.lvl, p.cls, Math.random, iid, { goldB: goldB(p), quest: d.drop }); extras(p, r.items); give(p, r.gold, r.items, new Set([p.charId])); progress(p); achCheck(p); persist(p); push(p); }
    } else {
      // um sorteio só; o ouro é dividido entre os elegíveis (direto na bolsa de cada um)
      const lead = killer && list.includes(killer) ? killer : list[0];
      const r = WI.roll(CFG.drop, cat, m.lvl, lead.cls, Math.random, iid, { quest: d.drop }), share = Math.max(1, Math.round(r.gold / list.length));
      const own = mode === 'exclusive' ? new Set([lead.charId]) : new Set(list.map(p => p.charId));
      extras(lead, r.items);
      list.forEach((p, i) => { give(p, share, i === 0 ? r.items : [], own); progress(p); achCheck(p); persist(p); push(p); });
    }
  }
  /* ---------- coleta (ItemPickupService) ---------- */
  function pickup(p, id, rq) {
    const g = ground.get(String(id || ''));
    if (!g) return fail(p, 'Este item já foi coletado ou desapareceu.', rq);
    if (now() >= g.exp) { removeGround(g, 'x'); return fail(p, 'Este item expirou.', rq); }
    if (p.inst !== g.inst || !canSee(g, p)) return fail(p, 'Você não pode coletar este item.', rq);
    if (!canTake(g, p)) return fail(p, 'Este item pertence a outro jogador.', rq);
    if (dist(p, g) > CFG.drop.pickRange + 1.5) return fail(p, 'Chegue mais perto do item.', rq);
    if (!roomFor(p.eco.inv, g.it, INV_MAX)) return fail(p, 'Inventário cheio! Libere espaço para coletar este item.', rq);
    removeGround(g, 'c', p.id);   // sai do chão e entra na mochila no MESMO passo
    addTo(p.eco.inv, g.it, INV_MAX);
    audit('loot_pick', { id: g.id, c: p.charId, item: g.it.id, n: g.it.n || 1, k: g.kid });
    return ok(p, rq, { got: { name: g.it.name, rar: g.it.rar | 0, n: g.it.n } });
  }

  /* =============================== AÇÕES DA MOCHILA =============================== */
  const QUEST_NPC = id => { const q = WD.QUESTS[id]; return q && (q.turn || q.npc); };
  const NPC_AT = { elric: [12, 9], mira: [-13, 12], brant: [2, -17], selene: [-21, -5] };
  function shopStock(p) {
    const L = [Object.assign(WI.mkStack('pot', 1), { buy: 10 }), Object.assign(WI.mkStack('potm', 1), { buy: 10 })];
    for (let i = 0; i < 6; i++) { const it = WI.gen(Math.max(1, p.lvl), i < 4 ? 1 : 2, ['arma', 'cabeca', 'peito', 'luvas', 'pernas', 'botas', 'anel', 'colar'][Math.floor(Math.random() * 8)], p.cls, Math.random, iid); it.buy = it.price * 3; L.push(it); }
    return L;
  }
  function act(p, m) {
    const e = p.eco, rq = m.rq | 0; if (!e || p.ecoFrozen) return fail(p, 'Aguarde: sincronizando o inventário…', rq);
    if (p.dead && !['shop'].includes(m.a)) return fail(p, 'Você está morto.', rq);
    if (p.trade && ['eq', 'uq', 'dr', 'sl', 'dl', 'bk', 'wd', 'sp'].includes(m.a)) return fail(p, 'Termine a troca primeiro.', rq);
    switch (m.a) {
      case 'pk': return pickup(p, m.id, rq);
      case 'eq': {   // equipar
        const i = byU(e.inv, m.u); if (i < 0) return fail(p, 'Item não encontrado.', rq); const it = e.inv[i];
        const why = WI.canEquip(it, p.cls, p.lvl); if (why) return fail(p, why, rq);
        const out = [];
        if (it.slot === 'escudo' && e.eq.arma && e.eq.arma.hand === 2) return fail(p, 'Arma de duas mãos não permite escudo.', rq);
        if (it.slot === 'arma' && it.hand === 2 && e.eq.escudo) out.push('escudo');
        if (e.eq[it.slot]) out.push(it.slot);
        if (e.inv.length - 1 + out.length > INV_MAX) return fail(p, 'Mochila cheia.', rq);
        e.inv.splice(i, 1); for (const s of out) { e.inv.push(e.eq[s]); e.eq[s] = null; } e.eq[it.slot] = it;
        return ok(p, rq, { fx: 'eq', slot: it.slot });
      }
      case 'uq': { const s = String(m.s || ''); const it = e.eq[s]; if (!it) return fail(p, 'Nada equipado aí.', rq); if (e.inv.length >= INV_MAX) return fail(p, 'Mochila cheia.', rq); e.eq[s] = null; e.inv.push(it); return ok(p, rq); }
      case 'dr': {   // dropar no chão (fica 60 s; qualquer um pode pegar)
        const i = byU(e.inv, m.u); if (i < 0) return fail(p, 'Item não encontrado.', rq); const it = e.inv[i];
        if (WI.MATS[it.id] && WI.MATS[it.id].bound) return fail(p, 'Este item é vinculado e não pode ser largado.', rq);
        let out = it; const n = Math.max(1, m.n | 0);
        if (it.stack && n < it.n) { it.n -= n; out = Object.assign({}, it, { n, u: uid() }); } else e.inv.splice(i, 1);
        const a = Math.random() * 6.28; spawnGround(out, p.x + Math.cos(a) * 1.4, p.z + Math.sin(a) * 1.4, p.inst, null, 0, 1, 0);
        audit('item_drop', { c: p.charId, item: out.id, n: out.n || 1 }); return ok(p, rq);
      }
      case 'dl': { const i = byU(e.inv, m.u); if (i < 0) return fail(p, 'Item não encontrado.', rq); const it = e.inv[i]; if (WI.MATS[it.id] && WI.MATS[it.id].bound) return fail(p, 'Item vinculado da especialização não pode ser destruído.', rq); e.inv.splice(i, 1); audit('item_destroy', { c: p.charId, item: it.id, n: it.n || 1 }); return ok(p, rq); }
      case 'sp': {   // dividir pilha
        const i = byU(e.inv, m.u); if (i < 0) return fail(p, 'Item não encontrado.', rq); const it = e.inv[i], n = m.n | 0;
        if (!it.stack || n < 1 || n >= it.n) return fail(p, 'Quantidade inválida.', rq); if (e.inv.length >= INV_MAX) return fail(p, 'Mochila cheia.', rq);
        it.n -= n; e.inv.splice(i + 1, 0, normItem(Object.assign({}, it, { n, u: uid() }))); return ok(p, rq);
      }
      case 'mg': {   // juntar pilhas iguais
        const st = {}; const keep = []; for (const it of e.inv) { if (!it.stack) { keep.push(it); continue; } const s = st[it.id]; if (s && s.n < WI.STACK_MAX) { const k = Math.min(it.n, WI.STACK_MAX - s.n); s.n += k; it.n -= k; if (it.n > 0) { keep.push(it); st[it.id] = it; } } else { keep.push(it); st[it.id] = it; } }
        e.inv = keep; return ok(p, rq);
      }
      case 'use': {
        const i = byU(e.inv, m.u); const it = i >= 0 ? e.inv[i] : e.inv.find(x => x.id === m.id); if (!it || !WI.MATS[it.id] || !WI.MATS[it.id].use) return fail(p, 'Você não tem esse item.', rq);
        const k = WI.MATS[it.id].use, t = now(); e.cd = e.cd || {}; if ((e.cd[k] || 0) > t) return fail(p, 'Poção em recarga.', rq);
        e.cd[k] = t + 11500; take(e.inv, it.id, 1); return ok(p, rq, { use: k });
      }
      case 'sl': {   // vender ao Torvin
        if (!nearNpc(p, 'torvin')) return fail(p, 'Fale com o mercador Torvin para vender.', rq);
        const us = (Array.isArray(m.us) ? m.us : [m.u]).slice(0, 40).map(x => String(x)); let g = 0, n = 0;
        for (const u of us) { const i = byU(e.inv, u); if (i < 0) continue; const it = e.inv[i]; if (it.quest || (WI.MATS[it.id] && WI.MATS[it.id].quest)) continue; const pr = it.slot ? WI.priceOf(it) : ((WI.MATS[it.id] || {}).price || 1) * (it.n || 1); g += pr; n++; e.inv.splice(i, 1); }
        if (!n) return fail(p, 'Nada para vender.', rq); e.gold += g; audit('shop_sell', { c: p.charId, n, g }); return ok(p, rq, { sold: g });
      }
      case 'shop': { if (!nearNpc(p, 'torvin')) return fail(p, 'Chegue perto do mercador Torvin.', rq); p.shop = shopStock(p); send(p, { t: 'shop', l: p.shop, rq }); return true; }
      case 'buy': {
        if (!nearNpc(p, 'torvin') || !p.shop) return fail(p, 'Chegue perto do mercador Torvin.', rq);
        const it = p.shop[m.i | 0]; if (!it) return fail(p, 'Item indisponível.', rq); const q = it.stack ? Math.max(1, Math.min(99, m.n | 0 || 1)) : 1, cost = it.buy * q;
        if (e.gold < cost) return fail(p, 'Ouro insuficiente.', rq);
        const c = Object.assign({}, it, it.stack ? { n: q } : {}); delete c.buy; if (!it.stack) c.id = iid(); delete c.u;
        if (!addTo(e.inv, c, INV_MAX)) return fail(p, 'Mochila cheia.', rq);
        e.gold -= cost; if (!it.stack) p.shop.splice(m.i | 0, 1); audit('shop_buy', { c: p.charId, item: c.id, cost }); send(p, { t: 'shop', l: p.shop }); return ok(p, rq);
      }
      case 'bank': { if (!nearNpc(p, 'banco')) return fail(p, 'Fale com a Banqueira Odila.', rq); p.bankOpen = true; return ok(p, rq); }
      case 'bk': case 'wd': {   // depositar / sacar (itens ou ouro)
        if (!nearNpc(p, 'banco')) return fail(p, 'Fale com a Banqueira Odila.', rq); p.bankOpen = true;
        const from = m.a === 'bk' ? e.inv : e.bank, to = m.a === 'bk' ? e.bank : e.inv, cap = m.a === 'bk' ? BANK_MAX : INV_MAX;
        const i = byU(from, m.u); if (i < 0) return fail(p, 'Item não encontrado.', rq); const it = from[i];
        if (m.a === 'bk' && WI.MATS[it.id] && WI.MATS[it.id].bound) return fail(p, 'Item vinculado fica na mochila.', rq);
        if (!roomFor(to, it, cap)) return fail(p, m.a === 'bk' ? 'Banco cheio.' : 'Mochila cheia.', rq);
        from.splice(i, 1); addTo(to, it, cap); audit(m.a === 'bk' ? 'bank_in' : 'bank_out', { c: p.charId, item: it.id, n: it.n || 1 }); return ok(p, rq);
      }
      case 'qa': {   // aceitar missão
        const q = WD.QUESTS[m.id]; if (!q) return fail(p, 'Missão inválida.', rq); if (e.qd[m.id]) return fail(p, 'Missão já concluída.', rq);
        if (p.lvl < q.lv - 1) return fail(p, 'Nível insuficiente.', rq); if (q.pre && !e.qd[q.pre]) return fail(p, 'Conclua a missão anterior.', rq);
        const at = NPC_AT[q.npc]; if (at && Math.hypot(p.x - at[0], p.z - at[1]) > NPC_RANGE) return fail(p, 'Fale com o NPC da missão.', rq);
        if (e.qa[m.id] == null) e.qa[m.id] = q.kill ? (e.qk[q.kill] | 0) : 0; return ok(p, rq, { qacc: m.id });
      }
      case 'qt': {   // entregar missão: o servidor confere os abates que ele mesmo registrou
        const id = String(m.id || ''), q = WD.QUESTS[id]; if (!q) return fail(p, 'Missão inválida.', rq); if (e.qd[id]) return fail(p, 'Missão já concluída.', rq);
        if (e.qa[id] == null) return fail(p, 'Aceite a missão primeiro.', rq);
        const at = NPC_AT[QUEST_NPC(id)]; if (at && Math.hypot(p.x - at[0], p.z - at[1]) > NPC_RANGE) return fail(p, 'Fale com o NPC da missão.', rq);
        if (q.kill && (e.qk[q.kill] | 0) - e.qa[id] < q.need) return fail(p, 'A missão ainda não está completa.', rq);
        if (q.item && count(e.inv, q.item) < q.need) return fail(p, 'Faltam itens da missão.', rq);
        let rw = null; if (q.reward) { rw = WI.gen(Math.max(p.lvl, q.lv), q.reward.rar, q.reward.slot, p.cls, Math.random, iid); if (!roomFor(e.inv, rw, INV_MAX - (q.item ? 1 : 0))) return fail(p, 'Mochila cheia: libere espaço para a recompensa.', rq); }
        if (q.item) take(e.inv, q.item, q.need); if (rw) addTo(e.inv, rw, INV_MAX);
        e.qd[id] = 1; delete e.qa[id]; e.gold += q.gold; audit('quest_done', { c: p.charId, q: id, gold: q.gold });
        return ok(p, rq, { qdone: id, xp: q.xp, rw: rw ? rw.name : undefined });
      }
      case 'mbuy': {
        const mt = WI.MOUNT_BY[m.id]; if (!mt || mt.drop) return fail(p, 'Montaria indisponível.', rq); if (!nearNpc(p, 'estabulo')) return fail(p, 'Fale com o cavalariço Bruno no estábulo.', rq);
        if (e.mounts.includes(mt.id)) return fail(p, 'Você já tem esta montaria.', rq); if (p.lvl < mt.lv) return fail(p, 'Requer nível ' + mt.lv + '.', rq);
        if (e.gold < mt.gold) return fail(p, 'Ouro insuficiente.', rq); e.gold -= mt.gold; e.mounts.push(mt.id); e.mnt = mt.id; audit('mount_buy', { c: p.charId, m: mt.id, g: mt.gold }); mountChanged(p); return ok(p, rq, { mnt: mt.id });
      }
      case 'msel': { if (m.id && !e.mounts.includes(m.id)) return fail(p, 'Você não tem esta montaria.', rq); e.mnt = m.id || null; mountChanged(p); return ok(p, rq); }
      case 'craft': return craft(p, m, rq);
      case 'ttl': { const id = m.id ? String(m.id) : null; if (id && !(e.achs || []).includes(id)) return fail(p, 'Conquiste esse título primeiro.', rq); e.ttl = id; mountChanged(p); return ok(p, rq); }
      case 'up': return upgrade(p, m, rq);
      case 'sub': return subAct(p, m, rq);
    }
    return fail(p, 'Ação desconhecida.', rq);
  }
  let mountHook = () => {};
  function mountChanged(p) { mountHook(p); }

  /* =============================== FERREIRO (ForgeService) =============================== */
  function craft(p, m, rq) {
    const e = p.eco; if (!nearNpc(p, 'ferreiro')) return fail(p, 'Fale com o Ferreiro Durgan.', rq);
    const r = CFG.recipes.find(x => x.id === m.id && !x.off); if (!r) return fail(p, 'Receita inexistente.', rq);
    if (p.lvl < r.lvl) return fail(p, 'Requer nível ' + r.lvl + '.', rq);
    for (const k in r.mats) if (count(e.inv, k) < r.mats[k]) return fail(p, 'Faltam materiais: ' + (WI.MATS[k] || { name: k }).name + '.', rq);
    if (e.gold < r.gold) return fail(p, 'Ouro insuficiente.', rq);
    const it = WI.gen(Math.max(r.lvl, p.lvl), r.rar || 6, r.slot, p.cls, Math.random, iid); it.name = r.n; it.myth = 1; it.price = WI.priceOf(it);
    // espaço: se a receita libera pilhas inteiras, sobra espaço; simula
    const sim = e.inv.map(x => Object.assign({}, x)); for (const k in r.mats) take(sim, k, r.mats[k]);
    if (!roomFor(sim, it, INV_MAX)) return fail(p, 'Mochila cheia: libere espaço antes de forjar.', rq);
    const success = Math.random() < r.chance;
    e.gold -= r.gold;
    if (success) { for (const k in r.mats) take(e.inv, k, r.mats[k]); addTo(e.inv, it, INV_MAX); }
    else { const keep = CFG.fail.keepMats; for (const k in r.mats) take(e.inv, k, Math.ceil(r.mats[k] * (1 - keep))); }
    audit('forge', { c: p.charId, r: r.id, ok: success ? 1 : 0, g: r.gold, item: success ? it.id : null });
    return ok(p, rq, { forge: success ? 1 : 0, name: success ? it.name : r.n });
  }
  function upgrade(p, m, rq) {
    const e = p.eco; if (!nearNpc(p, 'ferreiro')) return fail(p, 'Fale com o Ferreiro Durgan.', rq);
    let it = null, i = byU(e.inv, m.u); if (i >= 0) it = e.inv[i]; else for (const s in e.eq) if (e.eq[s] && e.eq[s].u === m.u) it = e.eq[s];
    if (!it || !it.slot) return fail(p, 'Escolha um equipamento.', rq); if ((it.up | 0) >= WI.UPMAX) return fail(p, 'Já está no máximo (+' + WI.UPMAX + ').', rq);
    const c = WI.upCost(it); if (e.gold < c.gold) return fail(p, 'Ouro insuficiente.', rq); if (count(e.inv, c.joia) < c.n) return fail(p, 'Falta ' + WI.MATS[c.joia].name + '.', rq);
    e.gold -= c.gold; take(e.inv, c.joia, c.n); const okk = Math.random() < c.chance;
    if (okk) { it.up = (it.up | 0) + 1; WI.applyUp(it); it.name = it.name.replace(/ \+\d+$/, '') + ' +' + it.up; }
    audit('upgrade', { c: p.charId, item: it.id, up: it.up | 0, ok: okk ? 1 : 0 }); return ok(p, rq, { upg: okk ? 1 : 0, up: it.up | 0 });
  }

  /* =============================== SUBCLASSES (SubclassService) =============================== */
  const S = () => CFG.sub;
  function subView(e) { const s = e.sub; return { step: s.step | 0, id: s.id || null, lvl: s.lvl | 0, xp: Math.floor(s.xp || 0), need: s.id ? WI.SUB.xpNeed(Math.max(1, s.lvl)) : 0, pts: s.pts | 0, tree: s.tree || {}, c: s.c, cfg: { minLvl: S().minLvl, fees: S().fees, need: S().need, combat: S().combat, off: S().off || [] } }; }
  function questProg(e) { const o = {}; for (const id in e.qa) { const q = WD.QUESTS[id]; if (q && q.kill) o[id] = Math.max(0, Math.min(q.need, (e.qk[q.kill] | 0) - e.qa[id])); } return o; }
  function subCheck(p) {
    const s = p.eco.sub, c = S().combat;
    if (s.step === 3 && s.c.el >= c.elites && s.c.gd >= c.guards && s.c.bs >= c.boss) {
      const selo = WI.mkStack('sub_selo', 1); if (!roomFor(p.eco.inv, selo, INV_MAX)) { sys(p, 'Provação de Combate completa! Libere 1 espaço na mochila para receber o Selo.'); return; }
      addTo(p.eco.inv, selo, INV_MAX); s.step = 4; audit('sub_step', { c: p.charId, step: 4 }); send(p, { t: 'subn', x: 'Provação de Combate concluída! Você recebeu o Selo de Aprovação do Mestre.' });
    }
  }
  function subXp(p, mlvl, cat) {
    const s = p.eco.sub; if (!s.id || s.lvl >= S().maxLvl) return;
    s.xp += Math.max(1, Math.round((10 + mlvl * .4) * ({ common: 1, elite: 6, boss: 25, world: 80 }[cat] || 1)));
    while (s.lvl < S().maxLvl && s.xp >= WI.SUB.xpNeed(s.lvl)) { s.xp -= WI.SUB.xpNeed(s.lvl); s.lvl++; s.pts += WI.SUB.ptsAt(s.lvl); send(p, { t: 'subn', x: 'Subclasse nível ' + s.lvl + '! +' + WI.SUB.ptsAt(s.lvl) + ' ponto(s) de habilidade.' }); audit('sub_lvl', { c: p.charId, l: s.lvl }); }
  }
  function pay(p, g) { if (p.eco.gold < g) return false; p.eco.gold -= g; return true; }
  function subAct(p, m, rq) {
    const e = p.eco, s = e.sub, C = S(), k = String(m.k || '');
    if (k === 'learn') {   // aprender/evoluir um nó da árvore
      if (!s.id) return fail(p, 'Desperte uma subclasse primeiro.', rq);
      const n = WI.SUB.tree.find(x => x.id === m.n); if (!n) return fail(p, 'Habilidade inválida.', rq);
      const r = s.tree[n.id] | 0; if (r >= n.max) return fail(p, 'Já no máximo.', rq); if (s.lvl < n.req) return fail(p, 'Requer subclasse nível ' + n.req + '.', rq);
      if (n.pre && !(s.tree[n.pre] | 0)) return fail(p, 'Aprenda o pré-requisito primeiro.', rq); if ((s.pts | 0) < 1) return fail(p, 'Sem pontos de habilidade.', rq);
      s.pts--; s.tree[n.id] = r + 1; audit('sub_learn', { c: p.charId, n: n.id, r: r + 1 }); return ok(p, rq);
    }
    if (!nearNpc(p, 'mestre')) return fail(p, 'Fale com o Mestre das Subclasses.', rq);
    if (k === 'start') {
      if (s.id || s.step >= 1) return fail(p, 'Você já iniciou a especialização.', rq);
      if (p.lvl < C.minLvl) return fail(p, 'Requer nível ' + C.minLvl + ' (você está no ' + p.lvl + ').', rq);
      if (!pay(p, C.fees.start)) return fail(p, 'Faltam ' + (C.fees.start - e.gold) + ' de ouro.', rq);
      s.step = 2; audit('sub_step', { c: p.charId, step: 2, g: C.fees.start }); return ok(p, rq, { subok: 'Provação do Mestre concluída! Próxima etapa: coletar os recursos.' });
    }
    if (k === 'deliver') {
      if (s.step !== 2) return fail(p, 'Esta etapa não está ativa.', rq);
      const miss = Object.keys(C.need).filter(x => count(e.inv, x) < C.need[x]);
      if (miss.length) return fail(p, 'Faltam: ' + miss.map(x => WI.MATS[x].name + ' (' + count(e.inv, x) + '/' + C.need[x] + ')').join(', '), rq);
      for (const x in C.need) take(e.inv, x, C.need[x]); s.step = 3; s.c = { el: 0, gd: 0, bs: 0 }; audit('sub_step', { c: p.charId, step: 3, mats: C.need });
      return ok(p, rq, { subok: 'Recursos entregues! Próxima etapa: Provação de Combate.' });
    }
    if (k === 'core') {   // troca o Selo pelo Núcleo de Especialização
      if (s.step !== 4) return fail(p, 'Esta etapa não está ativa.', rq);
      if (count(e.inv, 'sub_selo') < 1) return fail(p, 'Você precisa do Selo de Aprovação do Mestre.', rq);
      take(e.inv, 'sub_selo', 1); addTo(e.inv, WI.mkStack('sub_nucleo', 1), INV_MAX); s.step = 5; audit('sub_step', { c: p.charId, step: 5 });
      return ok(p, rq, { subok: 'Você recebeu o Núcleo de Especialização. Ative a forja.' });
    }
    if (k === 'forge') {
      if (s.step !== 5) return fail(p, 'Esta etapa não está ativa.', rq);
      if (count(e.inv, 'sub_nucleo') < 1) return fail(p, 'Você precisa do Núcleo de Especialização.', rq);
      if (e.gold < C.fees.forge) return fail(p, 'Faltam ' + (C.fees.forge - e.gold) + ' de ouro.', rq);
      take(e.inv, 'sub_nucleo', 1); e.gold -= C.fees.forge; addTo(e.inv, WI.mkStack('sub_insig', 1), INV_MAX); s.step = 6; audit('sub_step', { c: p.charId, step: 6, g: C.fees.forge });
      return ok(p, rq, { subok: 'A forja ardeu! Você recebeu a Insígnia da Subclasse.' });
    }
    if (k === 'awaken') {
      if (s.step !== 6 || s.id) return fail(p, 'Esta etapa não está ativa.', rq);
      const id = String(m.id || ''); if (!WI.subOk(id, p.cls) || (C.off || []).includes(id)) return fail(p, 'Subclasse incompatível com sua classe.', rq);
      if (count(e.inv, 'sub_insig') < 1) return fail(p, 'Você precisa da Insígnia da Subclasse.', rq);
      if (e.gold < C.fees.awaken) return fail(p, 'Faltam ' + (C.fees.awaken - e.gold) + ' de ouro.', rq);
      take(e.inv, 'sub_insig', 1); e.gold -= C.fees.awaken; s.id = id; s.lvl = 1; s.xp = 0; s.pts = 1; s.tree = { a1: 1 }; s.step = 7;
      audit('sub_awaken', { c: p.charId, id, g: C.fees.awaken }); return ok(p, rq, { subok: 'Subclasse despertada: ' + WI.SUB.defs[id].n + '!', subfx: 1 });
    }
    return fail(p, 'Ação inválida.', rq);
  }

  /* ---------- ranking (nível, subclasse, abates): atualizado quando o herói é salvo ---------- */
  let RANK = null, rankDirty = false;
  async function rankLoad() { if (!RANK) { try { RANK = (await DB.kvGet('wow:rank')) || []; } catch (e) { RANK = []; } } return RANK; }
  function rankUpd(p) { if (!RANK) { rankLoad(); return; } const e = p.eco, kills = Object.keys(e.qk || {}).reduce((a, k) => a + (e.qk[k] | 0), 0);
    const row = { c: p.charId, n: p.name, cls: p.cls, l: p.lvl, s: e.sub && e.sub.id ? e.sub.id : '', sl: e.sub && e.sub.lvl | 0, k: kills, a: (e.achs || []).length, g: p.guild ? p.guild.n : '' };
    const i = RANK.findIndex(x => x.c === p.charId); if (i >= 0) RANK[i] = row; else RANK.push(row);
    RANK.sort((a, b) => b.l - a.l || b.sl - a.sl || b.k - a.k); if (RANK.length > 100) RANK.length = 100; rankDirty = true; }
  setInterval(async () => { if (!rankDirty) return; rankDirty = false; try { await DB.kvSet('wow:rank', RANK); } catch (e) { rankDirty = true; } }, 10000);
  whenDb(rankLoad);
  async function ranking() { const L = (await rankLoad()).slice(); for (const p of players.values()) { const r = L.find(x => x.c === p.charId); if (r) { r.l = p.lvl; r.on = 1; } } return L.sort((a, b) => b.l - a.l || b.sl - a.sl || b.k - a.k).slice(0, 50); }

  /* ---------- poder de ataque calculado pelo SERVIDOR (equipamento real + bônus) ---------- */
  function srvAtk(p) {
    const c = WD.CLASSES[p.cls] || WD.CLASSES.guerreiro, e = p.eco;
    if (!e) return WD.atkCap(p.cls, p.lvl);
    const g = WI.gearSum(e.eq), sb = WI.setBonus(e.eq), su = WI.subBonus(e.sub), rb = ((WD.RACES[p.race] || {}).b || {}).atk || 0;
    return (c.atk[0] + c.atk[1] * (p.lvl - 1) + g.atk) * (1 + sb.atk + su.atk) * (1 + rb) * 1.45 + 3;
  }
  const mountSpd = p => { const m = p.eco && p.eco.mnt && WI.MOUNT_BY[p.eco.mnt]; return Math.min(WI.MOUNT_MAX_SPD, m ? m.spd : 1); };
  const subSk = p => p.eco && p.eco.sub && p.eco.sub.id ? WI.subSkill(p.eco.sub) : null;

  return { onHi, onLeave, onKill, act, flush, flushChar, freeze, srvAtk, mountSpd, subSk, sendGround, push, persist, ecoFrom, addTo, roomFor, take, count, byU,
    cfg: () => CFG, saveCfg, ranking, loadCfg, setMountHook: f => { mountHook = f; }, _ground: ground, INV_MAX, BANK_MAX };
};
