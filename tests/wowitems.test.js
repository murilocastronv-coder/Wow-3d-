'use strict';
/* Testes unitários do módulo compartilhado de itens/drops/subclasses (node tests/wowitems.test.js) */
const WI = require('../wowitems'), WD = require('../wowdata'), assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✔', name); };
const seq = s => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

t('gera equipamento com nível, raridade, ícone, preço e id único', () => {
  const ids = new Set(); for (let i = 0; i < 500; i++) { const it = WI.gen(20, i % 7, null, 'guerreiro'); assert(it.slot && WI.SLOTS[it.slot] && it.ic && it.lvl === 20 && it.price > 0); assert(!ids.has(it.id)); ids.add(it.id); }
});
t('armas respeitam a classe (mago não usa machado; guerreiro não usa cajado)', () => {
  for (let i = 0; i < 100; i++) { const w = WI.gen(10, 3, 'arma', 'mago'); assert(w.cl.includes('mago')); assert(WI.canEquip(w, 'mago', 10) === null); }
  const ax = WI.gen(10, 3, 'arma', 'guerreiro'); assert(WI.canEquip(ax, 'mago', 10));
});
t('nível mínimo e escudo por classe', () => {
  const it = WI.gen(50, 2, 'peito', 'mago'); assert(/nível 50/.test(WI.canEquip(it, 'mago', 49))); assert(WI.canEquip(it, 'mago', 50) === null);
  const sh = WI.gen(5, 2, 'escudo', 'guerreiro'); assert(WI.canEquip(sh, 'mago', 50)); assert(WI.canEquip(sh, 'paladino', 50) === null);
});
t('raridade aumenta os atributos e o Mítico é o mais forte', () => {
  const a = WI.gen(100, 1, 'peito', 'guerreiro', seq(1)), m = WI.gen(100, 6, 'peito', 'guerreiro', seq(1)); assert(m.arm > a.arm * 2 && m.hp > a.hp * 2);
});
t('melhoria +N sobe 7% por nível e não acumula erro', () => {
  const it = WI.gen(100, 4, 'arma', 'guerreiro', seq(3)), base = it.atk; it.up = 9; WI.applyUp(it); assert.strictEqual(it.atk, Math.round(it.b.atk * 1.63)); it.up = 0; WI.applyUp(it); assert.strictEqual(it.atk, base);
});
t('drop: ouro sempre como número (nunca item) e pesos de raridade configuráveis', () => {
  for (const cat of ['common', 'elite', 'boss', 'world']) for (let i = 0; i < 200; i++) { const r = WI.roll(WI.DROP, cat, 30, 'mago'); assert(r.gold > 0 && Number.isInteger(r.gold)); assert(r.items.every(x => x.slot || WI.MATS[x.id]), 'item sem tipo'); }
  const cfg = WI.mergeCfg(WI.DROP, { cat: { common: { gear: 1, w: [0, 0, 0, 0, 0, 0, 1] } } }); const r = WI.roll(cfg, 'common', 10, 'mago', seq(9)); assert(r.items.some(x => x.rar === 6));
});
t('drop: itens poderosos são raros no monstro comum (progressão normal continua)', () => {
  let leg = 0, gear = 0; const rng = seq(42); for (let i = 0; i < 20000; i++) { const r = WI.roll(WI.DROP, 'common', 10, 'guerreiro', rng); for (const it of r.items) if (it.slot) { gear++; if (it.rar >= 5) leg++; } }
  assert(gear > 4000 && gear < 7000, 'equipamentos ' + gear); assert(leg / gear < .01, 'lendários ' + leg);
});
t('mergeCfg ignora chaves e valores inválidos', () => { const c = WI.mergeCfg(WI.DROP, { hack: 1, itemTtlMs: -5, cat: { common: { gear: 'x', w: [1, 2] } } }); assert(!('hack' in c)); assert.strictEqual(c.itemTtlMs, 60000); assert.strictEqual(c.cat.common.gear, WI.DROP.cat.common.gear); assert.strictEqual(c.cat.common.w.length, 7); });
t('tempo de vida do item no chão é 60 s', () => assert.strictEqual(WI.DROP.itemTtlMs, 60000));
t('bônus de conjunto por número de peças', () => { const eq = {}; for (const s of ['cabeca', 'peito', 'luvas', 'pernas']) eq[s] = { set: 'dragao', slot: s }; const b = WI.setBonus(eq); assert(b.atk >= .05 && b.hp >= .08 && b.crit >= .03); });
t('subclasses: só classes compatíveis; árvore dá bônus; habilidade evolui', () => {
  assert(WI.subOk('arquimago', 'mago')); assert(!WI.subOk('arquimago', 'guerreiro'));
  for (const c in WD.CLASSES) assert(Object.keys(WI.SUB.defs).some(id => WI.subOk(id, c)), 'classe sem subclasse: ' + c);
  const s = { id: 'berserker', lvl: 30, tree: { a1: 5, p_atk: 5, adv: 1, sup: 1 } }; const b = WI.subBonus(s), k = WI.subSkill(s); assert(b.atk > .18); assert(k.m > WI.SUB.defs.berserker.sk.m * 2); assert(k.cd < WI.SUB.defs.berserker.sk.cd);
});
t('teto de ataque do equipamento cobre o melhor equipamento possível', () => { const lvl = 500, w = WI.gen(lvl, 6, 'arma', 'guerreiro', () => .99); w.up = 9; WI.applyUp(w); assert(WI.maxGearAtk(lvl) >= w.atk); });
t('montarias: velocidade limitada e todas com espécie/nível', () => { for (const m of WI.MOUNTS) { assert(m.spd >= 1 && m.spd <= WI.MOUNT_MAX_SPD); assert(m.a[0] && m.lv >= 5); } });
t('receitas usam só materiais que existem', () => { for (const r of WI.RECIPES) for (const k in r.mats) assert(WI.MATS[k] && !WI.MATS[k].quest, k); });
t('monstros novos têm zona válida e resistências numéricas', () => { const T = require('../terrain'); for (const k in WD.MT) { const d = WD.MT[k]; if (d.cnt) assert(T.ZONES.find(z => z.id === d.zone), k); for (const e in d.res || {}) assert(WD.ELEM[e] && typeof d.res[e] === 'number', k + ':' + e); } assert(WD.resMul('imp', 'gelo') > 1 && WD.resMul('imp', 'fogo') < 1); });
console.log('\n' + n + ' testes ok');
