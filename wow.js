'use strict';
// Conversão NÃO destrutiva: lê o personagem do jogo clássico e gera o herói 3D (Reinos de Valdor).
// O personagem original nunca é alterado; o herói novo fica em kv "wow:<charId>".
const CLS_MAP = { vanguard: 'guerreiro', overlord: 'guerreiro', battlemage: 'guerreiro', arcanist: 'mago', summoner: 'mago', ranger: 'cacador' };
const SLOT_MAP = { arma: 'arma', elmo: 'cabeca', armadura: 'peito', botas: 'pernas', luvas: 'anel', asas: 'anel' };
const SIC = { arma: '🗡️', cabeca: '⛑️', peito: '🥋', pernas: '👖', anel: '💍' };
const BASEN = { guerreiro: ['Espada', 'Machado', 'Maça'], mago: ['Cajado', 'Cetro'], cacador: ['Arco', 'Besta'], cabeca: ['Elmo', 'Capuz', 'Coroa'], peito: ['Peitoral', 'Túnica', 'Gibão'], pernas: ['Calças', 'Grevas', 'Perneiras'], anel: ['Anel', 'Sinete'] };
const SUF = ['do Urso', 'da Águia', 'do Lobo', 'da Alvorada', 'do Rei', 'da Lua'];
const WD = require('./wowdata');
const MAXLVL = WD.LV_CAP;   // nível máximo do 3D: 2000 (o clássico vai até 1000; níveis antigos são mantidos 1:1)
const newLevel = l => Math.max(1, Math.min(MAXLVL, l | 0));
function conv(it, lvl, cls) {
  if (!it || !SLOT_MAP[it.slot]) return null;
  const slot = SLOT_MAP[it.slot], rar = Math.max(0, Math.min(5, (it.tier | 0) - 1 + (it.rare ? 1 : 0) + ((it.plus | 0) >= 3 ? 1 : 0)));
  const o = { id: 'c' + Math.random().toString(36).slice(2, 9), slot, rar, lvl, ic: SIC[slot] };
  const b = BASEN[slot === 'arma' ? cls : slot]; o.name = b[Math.floor(Math.random() * b.length)] + (rar >= 2 ? ' ' + SUF[Math.floor(Math.random() * SUF.length)] : '') + ((it.plus | 0) > 0 ? ' +' + (it.plus | 0) : '');
  const f = 1 + rar * .4;
  if (slot === 'arma') o.atk = Math.round(2 + lvl * 1.5 * f);
  else if (slot === 'anel') { o.atk = Math.round(1 + lvl * .7 * f); o.crit = rar >= 2 ? +(.005 * rar).toFixed(3) : 0; }
  else { o.arm = Math.round(2 + lvl * 1.3 * f); o.hp = Math.round(lvl * 2.2 * f); }
  o.price = Math.round(((o.atk || 0) * 4 + (o.arm || 0) * 3 + (o.hp || 0)) * 1.1) + 3;
  return o;
}
function convert(c) {
  const cls = CLS_MAP[c.cls] || 'guerreiro', lvl = newLevel(c.lvl);
  const eq = { arma: null, cabeca: null, peito: null, pernas: null, anel: null };
  const bag = [];
  for (const k of Object.keys(c.equip || {})) { const o = conv(c.equip[k], lvl, cls); if (!o) continue; if (!eq[o.slot]) eq[o.slot] = o; else bag.push(o); }
  for (const it of (c.inv || []).slice(0, 40)) { const o = conv(it, lvl, cls); if (o && bag.length < 20) bag.push(o); }
  const pots = Math.min(20, c.hpPot | 0);
  if (pots > 0) bag.push({ id: 'pot', name: 'Poção de Cura', ic: '🧪', n: pots, stack: 1, price: 6, rar: 1 });
  return { v: 1, from: { cls: c.cls, lvl: c.lvl | 0 }, name: c.name, cls, lvl, xp: 0, gold: Math.min(1e9, Math.max(0, c.gold | 0) + 20), inv: bag, eq, q: {}, x: 0, z: 13, rest: 0, t: Date.now() };
}
// valida o que o cliente manda salvar (o servidor não confia no cliente cegamente)
function sanitize(sv, prev) {
  if (!sv || typeof sv !== 'object') return null;
  const lvl = Math.max(1, Math.min(MAXLVL, sv.lvl | 0, prev ? prev.lvl + 5 : 5));
  const maxGold = Math.max(prev ? prev.gold : 0, 0) + 5000 + lvl * 3000;
  const gold = Math.max(0, Math.min(maxGold, Math.floor(+sv.gold || 0)));
  const inv = Array.isArray(sv.inv) ? sv.inv.slice(0, 40) : [], eq = sv.eq && typeof sv.eq === 'object' ? sv.eq : {};
  const o = { v: 1, from: prev ? prev.from : null, name: prev ? prev.name : String(sv.name || ''), cls: prev ? prev.cls : sv.cls, race: prev ? prev.race : undefined, look: prev ? prev.look : undefined, tv: prev ? (prev.tv | 0) : 0, lvl: prev ? Math.max(prev.lvl, lvl) : lvl, xp: Math.max(0, Math.floor(+sv.xp || 0)), rest: Math.max(0, Math.floor(+sv.rest || 0)), gold, inv, eq, q: sv.q && typeof sv.q === 'object' ? sv.q : {}, x: +sv.x || 0, z: +sv.z || 13, t: Date.now() };
  if (JSON.stringify(o).length > 60000) return null;
  return o;
}
// herói novo criado direto no 3D (classe, raça e aparência escolhidas); o cliente monta o kit inicial quando vê fresh:1
function cleanLook(l) {
  const o = {}; if (!l || typeof l !== 'object') return o;
  for (const k of ['sk', 'hs', 'hc']) { const v = l[k]; if (Number.isInteger(v) && v >= 0 && v < 8) o[k] = v; }
  return o;
}
function fresh(name, cls, race, look) {
  return { v: 1, fresh: 1, from: null, name, cls, race, look: cleanLook(look), lvl: 1, xp: 0, rest: 0, gold: 20, inv: [], eq: {}, q: {}, x: 0, z: 13, tv: 0, t: Date.now() };
}
// arquétipo do jogo clássico usado só para criar o registro do personagem
const OLD_CLS = c => (WD.CLASSES[c].rng > 6 ? (c === 'cacador' ? 'ranger' : 'arcanist') : 'vanguard');
module.exports = { convert, sanitize, newLevel, CLS_MAP, fresh, cleanLook, OLD_CLS, WD };
