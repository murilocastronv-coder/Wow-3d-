'use strict';

/*
 * Reinos de Valdor / Eternal Realms — módulo de regras compartilhadas.
 * Reconstruído para completar a interface que server.js espera.
 * A loja premium fica desativada até configurar Stripe no Render.
 */
const WD = require('./wowdata');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));
const SHOP_CUR = 'eur';
const INV_MAX = 40;
const MAX_LVL = 1000;
const MAX_RESETS = 100;
const STAT_PER_RESET = 10;
const WORLD_R = 220;
const TOWN_R = 18;

const CLASSES = {
  guerreiro: { n: 'Guerreiro', hp: 120, mp: 25, atk: 10, def: 14, spd: 4.2, rng: 4.2, crit: .05 },
  mago: { n: 'Mago', hp: 72, mp: 100, atk: 12, def: 4, spd: 4.0, rng: 24, crit: .06 },
  cacador: { n: 'Caçador', hp: 92, mp: 55, atk: 11, def: 8, spd: 4.8, rng: 28, crit: .07 },
  paladino: { n: 'Paladino', hp: 115, mp: 55, atk: 9, def: 13, spd: 4.0, rng: 4.2, crit: .04 },
  bruxo: { n: 'Bruxo', hp: 78, mp: 95, atk: 12, def: 5, spd: 4.0, rng: 24, crit: .06 },
  sacerdote: { n: 'Sacerdote', hp: 80, mp: 100, atk: 8, def: 5, spd: 4.0, rng: 24, crit: .04 },
  ladino: { n: 'Ladino', hp: 88, mp: 50, atk: 11, def: 7, spd: 5.0, rng: 4, crit: .10 },
  druida: { n: 'Druida', hp: 96, mp: 85, atk: 10, def: 8, spd: 4.2, rng: 22, crit: .05 },
  xama: { n: 'Xamã', hp: 95, mp: 85, atk: 10, def: 8, spd: 4.2, rng: 22, crit: .05 },
  cavaleiro: { n: 'Cavaleiro da Morte', hp: 125, mp: 45, atk: 11, def: 14, spd: 4.1, rng: 4.2, crit: .05 },
  monge: { n: 'Monge', hp: 105, mp: 50, atk: 11, def: 9, spd: 5, rng: 4, crit: .08 },
  demonio: { n: 'Caçador de Demônios', hp: 100, mp: 60, atk: 12, def: 8, spd: 4.8, rng: 4.2, crit: .08 }
};
const MAPS = {
  valoria: { id: 'valoria', n: 'Valoria', name: 'Valoria', x: 0, z: 0, safe: true, min: 1, max: 10 },
  forest: { id: 'forest', n: 'Floresta Esmeralda', name: 'Floresta Esmeralda', x: 35, z: 0, min: 1, max: 12 },
  goblin: { id: 'goblin', n: 'Acampamento Goblin', name: 'Acampamento Goblin', x: 65, z: 15, min: 4, max: 10 },
  grave: { id: 'grave', n: 'Cemitério Antigo', name: 'Cemitério Antigo', x: 95, z: 0, min: 6, max: 18 },
  desert: { id: 'desert', n: 'Deserto Escarlate', name: 'Deserto Escarlate', x: 125, z: 0, min: 10, max: 25 },
  snow: { id: 'snow', n: 'Picos Gelados', name: 'Picos Gelados', x: 155, z: 0, min: 14, max: 30 },
  swamp: { id: 'swamp', n: 'Pântano Sombrio', name: 'Pântano Sombrio', x: 185, z: 0, min: 18, max: 35 }
};
const MAP_ORDER = Object.keys(MAPS);
const SLOTS = ['arma', 'cabeca', 'peito', 'pernas', 'anel'];
const SKILLS = {
  guerreiro: [{ id: 'strike', n: 'Golpe Poderoso', cost: 0, cd: 2.0, mult: 1.6 }],
  mago: [{ id: 'fireball', n: 'Bola de Fogo', cost: 12, cd: 2.5, mult: 1.8 }],
  cacador: [{ id: 'arrow', n: 'Tiro Preciso', cost: 5, cd: 1.8, mult: 1.5 }],
  paladino: [{ id: 'holy', n: 'Golpe Sagrado', cost: 8, cd: 2.5, mult: 1.5 }],
  bruxo: [{ id: 'curse', n: 'Maldição', cost: 10, cd: 3, mult: 1.7 }]
};
const MERCHANT_POS = { x: 2, z: 3 };
const NPC_ITEMS = [
  { id: 'pot', name: 'Poção de Cura', slot: 'consumable', ic: '🧪', price: 6, rar: 1, n: 1, stack: 1 },
  { id: 'mana', name: 'Poção de Mana', slot: 'consumable', ic: '🔵', price: 8, rar: 1, n: 1, stack: 1 }
];
const SHOP = NPC_ITEMS;
const PREM_PACKS = [
  { id: 'crystal_s', cry: 100, cents: 199 },
  { id: 'crystal_m', cry: 550, cents: 899 },
  { id: 'crystal_l', cry: 1200, cents: 1799 }
];
const TICKET_PACKS = [
  { id: 'ticket_1', n: 1, cents: 99 },
  { id: 'ticket_5', n: 5, cents: 399 },
  { id: 'ticket_12', n: 12, cents: 799 }
];
const PREM = [];
for (let i = 1; i <= 24; i++) PREM.push({
  id: 'premium_' + String(i).padStart(3, '0'),
  name: 'Cosmético Premium ' + i,
  names: { pt: 'Cosmético Premium ' + i, en: 'Premium Cosmetic ' + i, fr: 'Cosmétique Premium ' + i },
  price: 199 + (i % 4) * 100,
  divine: false,
  slot: 'cosmetic',
  rar: 2 + (i % 4),
  ic: '✨'
});
const PREM_BY_ID = Object.fromEntries(PREM.map(x => [x.id, x]));
const premName = (id, lang = 'pt') => {
  const p = PREM_BY_ID[id];
  return p ? ((p.names && p.names[lang]) || p.name) : 'Item Premium';
};
const premItem = id => {
  const p = PREM_BY_ID[id];
  if (!p) return null;
  return { id: p.id, name: p.name, ic: p.ic, slot: p.slot, rar: p.rar, price: p.price, premium: true };
};

function newChar(name, cls) {
  cls = CLASSES[cls] ? cls : 'guerreiro';
  const c = CLASSES[cls];
  return {
    name, cls, lvl: 1, xp: 0, gold: 20, map: 'valoria', x: 0, z: 13,
    hp: c.hp, mp: c.mp, str: 10, agi: 10, vit: 10, ene: 10,
    resets: 0, pvpKills: 0, pvp: 0, guild: '', inv: [], equip: {}, skills: [],
    hpPot: 3, sys: {}, created: Date.now(), updated: Date.now()
  };
}
const maxHp = c => Math.max(1, ((CLASSES[c.cls] || CLASSES.guerreiro).hp + (c.vit || 0) * 2 + (c.lvl || 1) * 5));
const maxMp = c => Math.max(1, ((CLASSES[c.cls] || CLASSES.guerreiro).mp + (c.ene || 0) * 3 + (c.lvl || 1) * 3));
const critChance = c => clamp((CLASSES[c.cls] || CLASSES.guerreiro).crit + (c.agi || 0) * .0005, 0, .75);
const mods = c => {
  const eq = c.equip || {};
  let atkB = 0, defB = 0, hpB = 0, critB = 0;
  for (const it of Object.values(eq)) if (it) { atkB += +it.atk || 0; defB += +it.arm || +it.def || 0; hpB += +it.hp || 0; critB += +it.crit || 0; }
  return { atk: atkB, def: defB, hp: hpB, crit: critB, speed: 0 };
};
const defense = c => Math.max(0, ((CLASSES[c.cls] || CLASSES.guerreiro).def + (c.agi || 0) * .2 + mods(c).def));
function makeItem(slot = 'arma', rar = 1, lvl = 1) {
  const r = clamp(rar | 0, 0, 5), lv = clamp(lvl | 0, 1, MAX_LVL), f = 1 + r * .4;
  const base = { arma: ['Espada', 'Machado', 'Cajado', 'Arco'], cabeca: ['Elmo', 'Capuz', 'Coroa'], peito: ['Peitoral', 'Túnica', 'Armadura'], pernas: ['Grevas', 'Calças', 'Perneiras'], anel: ['Anel', 'Sinete', 'Amuleto'] };
  const names = base[slot] || base.arma;
  const it = { id: 'it_' + Math.random().toString(36).slice(2, 11), name: names[Math.floor(Math.random() * names.length)] + ' ' + ['Comum', 'Incomum', 'Raro', 'Épico', 'Lendário', 'Mítico'][r], slot, rar: r, lvl: lv, ic: ({ arma: '🗡️', cabeca: '⛑️', peito: '🥋', pernas: '👖', anel: '💍' })[slot] || '🎒' };
  if (slot === 'arma') it.atk = Math.round((3 + lv * 1.5) * f);
  else if (slot === 'anel') { it.atk = Math.round((1 + lv * .7) * f); it.crit = r >= 2 ? r * .005 : 0; }
  else { it.arm = Math.round((2 + lv * 1.3) * f); it.hp = Math.round(lv * 2.2 * f); }
  it.price = Math.max(1, Math.round(((it.atk || 0) * 4 + (it.arm || 0) * 3 + (it.hp || 0)) * 1.1) + 3);
  return it;
}
const genSetDrop = (lvl = 1) => makeItem('peito', clamp(Math.floor(lvl / 5), 1, 5), lvl);
const makeEgg = () => ({ id: 'egg_' + Math.random().toString(36).slice(2, 10), name: 'Ovo Misterioso', ic: '🥚', slot: 'pet', rar: 2, price: 0 });
const EGG_PETS = ['Lobo Companheiro', 'Raposa Mística', 'Coruja Arcana', 'Mini Golem'];
const xpNeed = lvl => Math.floor(40 + Math.pow(Math.max(1, lvl), 1.45) * 18);
const atk = c => {
  const cl = CLASSES[c.cls] || CLASSES.guerreiro;
  return Math.max(1, cl.atk + Math.max(0, (c.lvl || 1) - 1) * 1.8 + (c.str || 0) * .8 + mods(c).atk);
};
const atkInterval = c => Math.max(.45, 1.5 - ((CLASSES[c.cls] || CLASSES.guerreiro).spd - 4) * .15);
const moveSpeed = c => Math.max(2.5, ((CLASSES[c.cls] || CLASSES.guerreiro).spd || 4));
const itemReq = it => Math.max(1, it && it.lvl || 1);
const refineChance = rar => clamp(.85 - (+rar || 0) * .13, .08, .85);
const itemName = it => it && it.name ? String(it.name) : 'Item';
const itemPrice = it => Math.max(1, Math.floor(+((it && it.price) || 1)));

module.exports = {
  clamp, SHOP_CUR, PREM_PACKS, TICKET_PACKS, PREM, PREM_BY_ID, premName, premItem,
  INV_MAX, newChar, CLASSES, MAPS, TOWN_R, maxHp, maxMp, critChance, mods, defense,
  genSetDrop, makeEgg, EGG_PETS, SLOTS, makeItem, MAX_LVL, xpNeed, atk, SKILLS,
  atkInterval, WORLD_R, moveSpeed, MAX_STAT: 100000, MAX_RESETS, STAT_PER_RESET,
  itemReq, refineChance, itemName, MERCHANT_POS, itemPrice, SHOP, NPC_ITEMS, MAP_ORDER
};