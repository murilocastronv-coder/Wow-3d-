/* Itens, drops, montarias, receitas e subclasses do Reinos de Valdor (WOW 3D).
   Arquivo COMPARTILHADO: o navegador usa para mostrar e o servidor usa para gerar e validar (os mesmos números nos dois lados).
   O servidor é a autoridade: ele gera os drops, credita o ouro e confere cada ação. Tudo que é "regra de balanceamento"
   fica nas tabelas abaixo (DROP, MOUNTS, RECIPES, SUB) e o administrador pode sobrescrever parte delas sem mexer no código. */
(function (root) {
'use strict';

/* ---------- raridades (0..6) ---------- */
const RAR = {
  n: ['Gasto', 'Comum', 'Incomum', 'Raro', 'Épico', 'Lendário', 'Mítico'],
  hex: ['#c4c9cf', '#f2eee4', '#5ae07a', '#5aa8ff', '#c68aff', '#ffb04a', '#ff4a6e'],
  rgb: [[.62, .64, .66], [.92, .9, .86], [.31, .82, .42], [.29, .61, 1], [.71, .42, 1], [1, .6, .18], [1, .29, .43]],
  f: r => 1 + r * .4   // multiplicador de atributos por raridade
};

/* ---------- espaços de equipamento ---------- */
const SLOTS = { arma: 'Arma', escudo: 'Escudo', cabeca: 'Elmo', peito: 'Peitoral', luvas: 'Luvas', pernas: 'Calças', botas: 'Botas', colar: 'Colar', anel: 'Anel', brinco: 'Brincos', asa: 'Asas' };
const SLOT_KEYS = Object.keys(SLOTS);
const SIC = { arma: '🗡️', escudo: '🛡️', cabeca: '⛑️', peito: '🥋', luvas: '🧤', pernas: '👖', botas: '🥾', colar: '📿', anel: '💍', brinco: '✨', asa: '🪽' };
const ARMN = { escudo: ['Escudo', 'Broquel', 'Pavês'], cabeca: ['Elmo', 'Capuz', 'Coroa', 'Capacete'], peito: ['Peitoral', 'Túnica', 'Gibão', 'Couraça'], luvas: ['Luvas', 'Manoplas', 'Braçadeiras'],
  pernas: ['Calças', 'Grevas', 'Perneiras'], botas: ['Botas', 'Sabatons', 'Sandálias'], colar: ['Colar', 'Amuleto', 'Pingente'], anel: ['Anel', 'Sinete', 'Aliança'], brinco: ['Brincos', 'Argolas'], asa: ['Asas', 'Asas Etéreas'] };
const SUF = ['do Urso', 'da Águia', 'do Lobo', 'da Alvorada', 'do Rei', 'da Lua', 'do Dragão', 'da Tempestade', 'do Crepúsculo', 'da Fênix'];

/* ---------- armas: tipo, mãos e quais classes usam ---------- */
const WT = {
  espada: { n: ['Espada', 'Gládio', 'Lâmina'], hand: 1, ic: '🗡️' }, espada2: { n: ['Montante', 'Espadão', 'Claymore'], hand: 2, ic: '⚔️' },
  machado: { n: ['Machado', 'Machadinha'], hand: 1, ic: '🪓' }, machado2: { n: ['Machado de Guerra', 'Grande Machado'], hand: 2, ic: '🪓' },
  martelo: { n: ['Martelo', 'Maça'], hand: 1, ic: '🔨' }, martelo2: { n: ['Martelo de Guerra', 'Malho'], hand: 2, ic: '🔨' },
  lanca: { n: ['Lança', 'Alabarda', 'Pique'], hand: 2, ic: '🔱' }, adaga: { n: ['Adaga', 'Punhal', 'Lâmina Curva'], hand: 1, ic: '🗡️' },
  arco: { n: ['Arco', 'Arco Longo'], hand: 2, ic: '🏹' }, besta: { n: ['Besta', 'Balestra'], hand: 2, ic: '🏹' },
  cajado: { n: ['Cajado', 'Báculo'], hand: 2, ic: '🪄' }, varinha: { n: ['Varinha', 'Cetro'], hand: 1, ic: '🪄' },
  glaive: { n: ['Glaive', 'Lâmina Gêmea'], hand: 2, ic: '⚔️' }, bastao: { n: ['Bastão', 'Bastão de Bambu'], hand: 2, ic: '🥢' },
  grimorio: { n: ['Grimório', 'Tomo Proibido'], hand: 1, ic: '📕' }
};
const CW = {
  guerreiro: ['espada', 'machado', 'espada2', 'machado2', 'martelo2'], paladino: ['martelo', 'martelo2', 'espada'], cavaleiro: ['lanca', 'espada', 'espada2'],
  ladino: ['adaga'], cacador: ['arco', 'besta'], mago: ['cajado', 'varinha'], bruxo: ['cajado', 'grimorio'], sacerdote: ['varinha', 'cajado'],
  druida: ['cajado', 'bastao'], xama: ['machado', 'martelo'], monge: ['bastao'], demonio: ['glaive', 'adaga'], invocador: ['grimorio', 'cajado'], gladiador: ['espada', 'espada2', 'varinha']
};
const SHIELD_CLS = ['guerreiro', 'paladino', 'cavaleiro', 'xama', 'sacerdote', 'gladiador'];
const WT_CLS = {}; for (const c in CW) for (const w of CW[c]) (WT_CLS[w] = WT_CLS[w] || []).push(c);

/* ---------- materiais, joias e consumíveis (empilháveis: o id é o tipo) ---------- */
const MATS = {
  pot: { name: 'Poção de Cura', ic: '🧪', rar: 1, price: 6, use: 'hp', d: 'Restaura vida. Usável (tecla 5).' },
  potm: { name: 'Poção de Mana', ic: '🫙', rar: 1, price: 6, use: 'mp', d: 'Restaura mana, energia ou fúria.' },
  tusk: { name: 'Presa de Javali', ic: '🦷', rar: 0, price: 2, quest: 1, d: 'Item de missão.' },
  mat_ferro: { name: 'Minério de Ferro', ic: '⛏️', rar: 1, price: 4, d: 'Material de forja comum.' },
  mat_couro: { name: 'Couro Curtido', ic: '🟫', rar: 1, price: 4, d: 'Material de forja comum.' },
  mat_cristal: { name: 'Cristal Arcano', ic: '💎', rar: 3, price: 60, d: 'Cai de monstros de elite. Usado na especialização e na forja mítica.' },
  mat_nucleo: { name: 'Núcleo de Monstro', ic: '🔮', rar: 3, price: 60, d: 'Cai de monstros de elite e chefes.' },
  mat_frag: { name: 'Fragmento Antigo', ic: '🗿', rar: 4, price: 150, d: 'Relíquia rara de elites e chefes.' },
  mat_escama: { name: 'Escama de Dragão', ic: '🐉', rar: 4, price: 300, d: 'Cai de dragões e chefes mundiais.' },
  mat_alma: { name: 'Essência de Alma', ic: '👻', rar: 4, price: 200, d: 'Cai de mortos-vivos de elite e chefes.' },
  mat_chama: { name: 'Coração de Chamas', ic: '❤️‍🔥', rar: 5, price: 900, d: 'Cai de chefes de fogo e do Dragão Ancestral.' },
  joia_bencao: { name: 'Joia da Bênção', ic: '💠', rar: 4, price: 250, d: 'Melhora equipamentos de +0 até +6 no Ferreiro.' },
  joia_alma: { name: 'Joia da Alma', ic: '🟣', rar: 5, price: 600, d: 'Melhora equipamentos de +6 até +9 no Ferreiro.' },
  sub_selo: { name: 'Selo de Aprovação do Mestre', ic: '📜', rar: 4, price: 0, quest: 1, bound: 1, d: 'Prova da Provação de Combate.' },
  sub_nucleo: { name: 'Núcleo de Especialização', ic: '💠', rar: 5, price: 0, quest: 1, bound: 1, d: 'Forjado com materiais da especialização.' },
  sub_insig: { name: 'Insígnia da Subclasse', ic: '🎖️', rar: 5, price: 0, quest: 1, bound: 1, d: 'Entregue ao Mestre das Subclasses para despertar a subclasse.' }
};
const STACK_MAX = 999;
const mkStack = (id, n) => { const m = MATS[id]; if (!m) return null; const o = { id, name: m.name, ic: m.ic, n: Math.max(1, n | 0), stack: 1, price: m.price, rar: m.rar }; if (m.quest) o.quest = 1; return o; };

/* ---------- conjuntos (bônus por peças equipadas) ---------- */
const SETS = {
  dragao: { n: 'Conjunto do Dragão', b: { 2: { atk: .05 }, 4: { hp: .08, crit: .03 }, 5: { atk: .08 } } },
  guardiao: { n: 'Conjunto do Guardião', b: { 2: { arm: .08 }, 4: { hp: .12 }, 5: { arm: .1, hp: .05 } } },
  sombra: { n: 'Conjunto da Sombra', b: { 2: { crit: .03 }, 4: { atk: .07 }, 5: { crit: .05 } } },
  arcano: { n: 'Conjunto Arcano', b: { 2: { atk: .04 }, 4: { atk: .06, hp: .05 }, 5: { crit: .04 } } }
};
const SET_SLOTS = ['cabeca', 'peito', 'luvas', 'pernas', 'botas'];
function setBonus(eq) {
  const cnt = {}, o = { atk: 0, hp: 0, arm: 0, crit: 0 }, act = [];
  for (const k in eq || {}) { const it = eq[k]; if (it && it.set && SETS[it.set]) cnt[it.set] = (cnt[it.set] || 0) + 1; }
  for (const s in cnt) { const B = SETS[s].b; for (const n in B) if (cnt[s] >= +n) { for (const k in B[n]) o[k] += B[n][k]; act.push(s + ':' + n); } }
  o.act = act; o.cnt = cnt; return o;
}

/* ---------- geração de itens ---------- */
let idSeq = 0;
const defId = () => 'i' + Date.now().toString(36) + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 6);
const pickR = (a, r) => a[Math.floor(r() * a.length)];
function baseStats(slot, hand, lvl, rar, wt) {
  const f = RAR.f(rar), s = {};
  if (slot === 'arma') { s.atk = Math.round((2 + lvl * 1.5 * f) * (hand === 2 ? 1.35 : 1)); if (wt === 'adaga' && rar >= 2) s.crit = +(.004 * rar).toFixed(3); }
  else if (slot === 'escudo') { s.arm = Math.round(2 + lvl * 1.1 * f); s.hp = Math.round(lvl * 1.4 * f); }
  else if (slot === 'peito') { s.arm = Math.round(3 + lvl * 1.5 * f); s.hp = Math.round(lvl * 2.6 * f); }
  else if (slot === 'cabeca' || slot === 'pernas') { s.arm = Math.round(2 + lvl * 1.3 * f); s.hp = Math.round(lvl * 2.2 * f); }
  else if (slot === 'luvas') { s.arm = Math.round(1 + lvl * .7 * f); s.atk = Math.round(lvl * .35 * f); if (rar >= 3) s.crit = +(.003 * rar).toFixed(3); }
  else if (slot === 'botas') { s.arm = Math.round(1 + lvl * .8 * f); s.hp = Math.round(lvl * 1.2 * f); if (rar >= 3) s.spd = +(.008 * (rar - 2)).toFixed(3); }
  else if (slot === 'colar') { s.hp = Math.round(lvl * 1.8 * f); if (rar >= 2) s.crit = +(.004 * rar).toFixed(3); }
  else if (slot === 'anel') { s.atk = Math.round(1 + lvl * .7 * f); s.crit = rar >= 2 ? +(.005 * rar).toFixed(3) : 0; }
  else if (slot === 'brinco') { s.atk = Math.round(lvl * .4 * f); s.hp = Math.round(lvl * .9 * f); }
  else if (slot === 'asa') { s.atk = Math.round(lvl * .6 * f); s.arm = Math.round(lvl * .6 * f); s.hp = Math.round(lvl * 1.2 * f); }
  return s;
}
/* aplica a melhoria (+N): cada nível dá +7% nos atributos principais (crítico e velocidade não sobem) */
function applyUp(it) {
  if (!it.b) it.b = { atk: it.atk || 0, arm: it.arm || 0, hp: it.hp || 0 };
  const k = 1 + .07 * (it.up | 0);
  for (const s of ['atk', 'arm', 'hp']) { if (it.b[s]) it[s] = Math.round(it.b[s] * k); else delete it[s]; }
  it.price = priceOf(it); return it;
}
function priceOf(it) { return Math.round(((it.atk || 0) * 4 + (it.arm || 0) * 3 + (it.hp || 0) + (it.crit || 0) * 900) * 1.1 * (1 + .15 * (it.up | 0))) + 3; }
/* gera um equipamento. cls: classe para a qual a arma é feita. rng: gerador (0..1). id: função que cria o id */
function gen(lvl, rar, slot, cls, rng, id) {
  rng = rng || Math.random; lvl = Math.max(1, lvl | 0);
  if (rar == null) { const r = rng(); rar = r < .03 ? 4 : r < .12 ? 3 : r < .35 ? 2 : r < .7 ? 1 : 0; }
  if (!slot) slot = pickR(['arma', 'arma', 'cabeca', 'peito', 'peito', 'luvas', 'pernas', 'botas', 'anel', 'colar', 'brinco', 'escudo'], rng);
  if (slot === 'escudo' && cls && SHIELD_CLS.indexOf(cls) < 0) slot = 'peito';
  const it = { id: (id || defId)(), slot, rar, lvl, ic: SIC[slot] };
  let base;
  if (slot === 'arma') {
    const wts = CW[cls] || CW.guerreiro, wt = pickR(wts, rng), w = WT[wt];
    it.wt = wt; it.hand = w.hand; it.ic = w.ic; it.cl = WT_CLS[wt].slice(); base = pickR(w.n, rng);
  } else base = pickR(ARMN[slot], rng);
  it.name = base + (rar >= 2 ? ' ' + pickR(SUF, rng) : '');
  if (rar >= 6) it.name = base + ' Mítico ' + pickR(SUF, rng);
  Object.assign(it, baseStats(slot, it.hand, lvl, rar, it.wt));
  if (rar >= 4 && SET_SLOTS.indexOf(slot) >= 0 && rng() < .45) { const sk = pickR(Object.keys(SETS), rng); it.set = sk; it.name = base + ' ' + SETS[sk].n.replace('Conjunto ', ''); }
  it.b = { atk: it.atk || 0, arm: it.arm || 0, hp: it.hp || 0 };
  it.price = priceOf(it);
  return it;
}
function score(it) { return it ? (it.atk || 0) * 3 + (it.arm || 0) * 2 + (it.hp || 0) * .5 + (it.crit || 0) * 400 + (it.spd || 0) * 300 : 0; }
/* pode equipar? devolve null (pode) ou o motivo */
function canEquip(it, cls, lvl) {
  if (!it || !it.slot || !SLOTS[it.slot]) return 'Este item não é equipável.';
  if ((it.lvl | 0) > lvl) return 'Requer nível ' + it.lvl + '.';
  if (it.slot === 'arma' && Array.isArray(it.cl) && it.cl.indexOf(cls) < 0) return 'Sua classe não usa ' + (WT[it.wt] ? WT[it.wt].n[0].toLowerCase() : 'esta arma') + '.';
  if (it.slot === 'escudo' && SHIELD_CLS.indexOf(cls) < 0) return 'Sua classe não usa escudo.';
  return null;
}
/* soma de atributos do equipamento (já com bônus de conjunto em %) */
function gearSum(eq) {
  const o = { atk: 0, arm: 0, hp: 0, crit: 0, spd: 0 };
  for (const k in eq || {}) { const it = eq[k]; if (!it) continue; for (const s in o) if (it[s]) o[s] += +it[s] || 0; }
  return o;
}
/* teto de ataque de equipamento no nível (todas as peças míticas +9): o servidor usa como limite máximo */
function maxGearAtk(lvl) { const f = RAR.f(6) * 1.63; return (2 + lvl * 1.5 * f) * 1.35 + lvl * (.35 + .7 + .4 + .6) * f + 8; }

/* ---------- drops: configuração (o ADM pode sobrescrever pelo painel) ---------- */
const DROP = {
  itemTtlMs: 60000,                 // tempo de vida de um item no chão: exatamente 60 s
  pickRange: 5,                     // distância máxima para coletar (m)
  mode: { common: 'individual', elite: 'individual', boss: 'individual', world: 'individual' },   // individual | shared | exclusive | party
  cat: {
    common: { gold: [1.5, 3.5], goldMul: 1, gear: .28, gearN: 1, pot: .2, potm: .08, w: [35, 35, 20, 8, 1.6, .4, 0], mats: { mat_ferro: .1, mat_couro: .08, joia_bencao: .004 } },
    elite: { gold: [1.5, 3.5], goldMul: 4, gear: .9, gearN: 1, pot: .5, potm: .3, w: [0, 20, 35, 28, 12, 4.5, .5], mats: { mat_cristal: .35, mat_nucleo: .3, mat_frag: .12, joia_bencao: .05, joia_alma: .02, mat_alma: .05 } },
    boss: { gold: [2, 4], goldMul: 8, gear: 1, gearN: 2, pot: 1, potm: .5, w: [0, 0, 10, 35, 35, 17, 3], mats: { mat_frag: [1, 3], mat_cristal: [2, 5], mat_nucleo: [2, 4], joia_bencao: .4, joia_alma: .15, mat_escama: .3, mat_alma: .3 } },
    world: { gold: [3, 5], goldMul: 20, gear: 1, gearN: 4, pot: 1, potm: 1, w: [0, 0, 0, 20, 40, 32, 8], mats: { mat_escama: [2, 4], mat_chama: [1, 2], mat_frag: [3, 6], joia_bencao: [1, 3], joia_alma: [1, 2] } }
  }
};
function mergeCfg(base, over) {   // mescla raso/profundo apenas em chaves conhecidas
  if (!over || typeof over !== 'object') return base;
  const o = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k in over) { if (!(k in base)) continue; const b = base[k], v = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) o[k] = mergeCfg(b, v);
    else if (Array.isArray(b) && Array.isArray(v) && v.length === b.length && v.every(x => typeof x === 'number' && isFinite(x) && x >= 0)) o[k] = v.slice();
    else if (typeof b === 'number' && typeof v === 'number' && isFinite(v) && v >= 0) o[k] = v;
    else if (typeof b === 'string' && typeof v === 'string') o[k] = v; }
  return o;
}
const wPick = (w, r) => { let t = 0; for (const x of w) t += x; let k = r() * t; for (let i = 0; i < w.length; i++) { k -= w[i]; if (k < 0) return i; } return w.length - 1; };
/* categoria de um monstro (servidor) */
const catOf = m => m.world ? 'world' : m.boss ? 'boss' : m.elite ? 'elite' : 'common';
/* sorteia ouro + itens de UMA morte para UM jogador. Retorna {gold, items}. O ouro NUNCA vira item. */
function roll(cfg, cat, mlvl, cls, rng, id, extra) {
  rng = rng || Math.random; const C = (cfg.cat || DROP.cat)[cat] || DROP.cat.common, items = [];
  const gold = Math.max(1, Math.round((mlvl * (C.gold[0] + rng() * (C.gold[1] - C.gold[0])) + 2) * C.goldMul * (1 + ((extra && extra.goldB) || 0))));
  for (let i = 0; i < C.gearN; i++) if (rng() < C.gear) items.push(gen(mlvl, wPick(C.w, rng), null, cls, rng, id));
  if (rng() < C.pot) items.push(mkStack('pot', 1)); if (rng() < C.potm) items.push(mkStack('potm', 1));
  for (const k in C.mats) { const v = C.mats[k]; if (Array.isArray(v)) items.push(mkStack(k, v[0] + Math.floor(rng() * (v[1] - v[0] + 1)))); else if (rng() < v) items.push(mkStack(k, 1)); }
  if (extra && extra.quest && rng() < .75) items.push(mkStack(extra.quest, 1));
  return { gold, items: items.filter(Boolean) };
}

/* ---------- montarias do jogo (compradas com ouro no Estábulo; ficam no herói) ---------- */
const MOUNTS = [
  { id: 'cavalo', n: 'Cavalo de Guerra', lv: 5, gold: 0, spd: 1, a: ['horse', 0x7a4a28, null], ic: '🐴', d: 'O fiel corcel de todo aventureiro.' },
  { id: 'blindado', n: 'Cavalo Blindado', lv: 20, gold: 4000, spd: 1.06, a: ['horse', 0x5a5f6a, 'armor'], ic: '🐎', d: 'Barda de aço sobre o corcel de guerra.' },
  { id: 'lobo', n: 'Lobo Gigante', lv: 30, gold: 12000, spd: 1.08, a: ['wolf', 0x7a808a, null], ic: '🐺', d: 'Um lobo das montanhas domado.' },
  { id: 'tigre', n: 'Tigre de Guerra', lv: 45, gold: 30000, spd: 1.1, a: ['cat', 0xd8862a, 'stripe'], ic: '🐅', d: 'Felino veloz das selvas do sul.' },
  { id: 'pantera', n: 'Pantera Sombria', lv: 60, gold: 60000, spd: 1.12, a: ['cat', 0x1c1c24, null], ic: '🐆', d: 'Silenciosa como a noite.' },
  { id: 'leao', n: 'Leão Dourado', lv: 80, gold: 120000, spd: 1.13, a: ['cat', 0xd8a84a, 'mane'], ic: '🦁', d: 'O rei das planícies.' },
  { id: 'draco', n: 'Dragão Terrestre', lv: 120, gold: 300000, spd: 1.16, a: ['drake', 0x3a7a3a, null], ic: '🦎', d: 'Dragão sem asas, de escamas duras.' },
  { id: 'unicornio', n: 'Unicórnio Arcano', lv: 160, gold: 600000, spd: 1.18, a: ['horse', 0xe8e8f8, 'horn'], ic: '🦄', d: 'Criatura mágica de pura luz.' },
  { id: 'dracofogo', n: 'Dragão das Chamas', lv: 250, gold: 0, spd: 1.22, a: ['drake', 0xb8301c, 'flame'], ic: '🐲', d: 'Lendária: só cai do Dragão Ancestral.', drop: 1 }
];
const MOUNT_BY = {}; for (const m of MOUNTS) MOUNT_BY[m.id] = m;
const MOUNT_MAX_SPD = 1.25;

/* ---------- Ferreiro: receitas míticas e melhoria +N (o ADM edita as receitas) ---------- */
const RECIPES = [
  { id: 'r_arma', n: 'Arma Mítica do Crepúsculo', slot: 'arma', lvl: 80, gold: 150000, chance: .8, mats: { mat_cristal: 20, mat_nucleo: 15, mat_frag: 8, mat_escama: 3 } },
  { id: 'r_elmo', n: 'Elmo Mítico do Crepúsculo', slot: 'cabeca', lvl: 80, gold: 100000, chance: .85, mats: { mat_cristal: 12, mat_nucleo: 10, mat_frag: 5 } },
  { id: 'r_peito', n: 'Couraça Mítica do Crepúsculo', slot: 'peito', lvl: 90, gold: 140000, chance: .8, mats: { mat_cristal: 16, mat_nucleo: 12, mat_frag: 6, mat_alma: 3 } },
  { id: 'r_luvas', n: 'Manoplas Míticas', slot: 'luvas', lvl: 90, gold: 90000, chance: .85, mats: { mat_cristal: 10, mat_nucleo: 8, mat_frag: 4 } },
  { id: 'r_botas', n: 'Botas Míticas do Vento', slot: 'botas', lvl: 90, gold: 90000, chance: .85, mats: { mat_cristal: 10, mat_nucleo: 8, mat_frag: 4 } },
  { id: 'r_anel', n: 'Anel Mítico das Eras', slot: 'anel', lvl: 100, gold: 120000, chance: .75, mats: { mat_frag: 10, mat_alma: 4, joia_bencao: 2 } },
  { id: 'r_colar', n: 'Colar Mítico das Eras', slot: 'colar', lvl: 100, gold: 120000, chance: .75, mats: { mat_frag: 10, mat_alma: 4, joia_bencao: 2 } },
  { id: 'r_asa', n: 'Asas Míticas do Dragão', slot: 'asa', lvl: 150, gold: 500000, chance: .6, mats: { mat_escama: 10, mat_chama: 3, mat_alma: 10, mat_frag: 10 } }
];
const UPMAX = 9;
const upCost = it => ({ gold: Math.round(Math.max(1, it.lvl | 0) * 40 * ((it.up | 0) + 1) * (1 + (it.rar | 0) * .25)), joia: (it.up | 0) < 6 ? 'joia_bencao' : 'joia_alma', n: 1, chance: [1, 1, .95, .9, .85, .75, .6, .5, .4][it.up | 0] });

/* ---------- Subclasses (nível 500) ---------- */
const SUB = {
  minLvl: 500,
  fees: { start: 500000, forge: 2000000, awaken: 5000000 },
  need: { mat_cristal: 30, mat_nucleo: 20, mat_frag: 10 },
  combat: { elites: 50, guards: 3, boss: 1 },
  maxLvl: 50,
  defs: {
    berserker: { n: 'Berserker', ic: '🪓', cls: ['guerreiro', 'demonio', 'cavaleiro', 'gladiador'], d: 'Fúria sem limites: dano em área e roubo de vida.', sk: { n: 'Fúria Sangrenta', ic: '🩸', k: 'aoe', r: 7, m: 2.6, cd: 14, cost: 0 }, b: { atk: .04 } },
    guardiao: { n: 'Guardião Sagrado', ic: '🛡️', cls: ['paladino', 'guerreiro', 'sacerdote'], d: 'Defesa e cura sagradas.', sk: { n: 'Égide Divina', ic: '✨', k: 'heal', f: .35, dr: .4, dur: 8, cd: 30, cost: 0 }, b: { hp: .05, arm: .05 } },
    arquimago: { n: 'Arquimago', ic: '☄️', cls: ['mago', 'bruxo', 'invocador'], d: 'Magia elemental devastadora.', sk: { n: 'Meteoro', ic: '☄️', k: 'aoe', r: 9, m: 3.0, cd: 16, cost: 0 }, b: { atk: .05 } },
    sombra: { n: 'Senhor das Sombras', ic: '🌑', cls: ['ladino', 'bruxo', 'demonio'], d: 'Execuções críticas das sombras.', sk: { n: 'Execução Sombria', ic: '🗡️', k: 'single', rng: 6, m: 4.5, cd: 12, cost: 0 }, b: { crit: .03 } },
    arqueiro: { n: 'Mestre Arqueiro', ic: '🏹', cls: ['cacador'], d: 'Chuva de flechas de longo alcance.', sk: { n: 'Chuva de Flechas', ic: '🌧️', k: 'aoe', r: 9, m: 2.4, cd: 12, cost: 0, at: 1 }, b: { atk: .04, crit: .02 } },
    ancestral: { n: 'Invocador Ancestral', ic: '🐲', cls: ['invocador', 'druida', 'xama'], d: 'Espíritos ancestrais que ferem e curam.', sk: { n: 'Espírito Ancestral', ic: '👻', k: 'aoe', r: 8, m: 2.2, heal: .15, cd: 15, cost: 0 }, b: { hp: .04, atk: .03 } },
    marcial: { n: 'Mestre Marcial', ic: '👊', cls: ['monge', 'gladiador'], d: 'Sequências relâmpago de golpes.', sk: { n: 'Mil Punhos', ic: '💥', k: 'single', rng: 5, m: 4.0, cd: 10, cost: 0 }, b: { atk: .04, crit: .02 } },
    dracocav: { n: 'Cavaleiro Dragão', ic: '🐉', cls: ['cavaleiro', 'guerreiro', 'gladiador', 'paladino'], d: 'O fogo dos dragões na ponta da lança.', sk: { n: 'Sopro do Dragão', ic: '🔥', k: 'aoe', r: 8, m: 2.8, cd: 15, cost: 0 }, b: { atk: .03, hp: .03 } },
    oraculo: { n: 'Oráculo', ic: '🔆', cls: ['sacerdote', 'druida', 'xama'], d: 'Luz primordial que cura o grupo.', sk: { n: 'Luz Primordial', ic: '🌟', k: 'heal', f: .5, cd: 20, cost: 0 }, b: { hp: .06 } }
  },
  /* árvore igual para todas (os nomes mudam pela subclasse): id, tipo, nível mínimo, pontos máximos, pré-requisito */
  tree: [
    { id: 'a1', n: 'Domínio da Técnica', t: 'skill', req: 1, max: 5, d: '+12% de poder da habilidade da subclasse por ponto.' },
    { id: 'p_atk', n: 'Força Desperta', t: 'pas', req: 5, max: 5, st: 'atk', v: .03, d: '+3% de ataque por ponto.' },
    { id: 'p_hp', n: 'Vigor Desperto', t: 'pas', req: 5, max: 5, st: 'hp', v: .03, d: '+3% de vida por ponto.' },
    { id: 'a2', n: 'Ímpeto', t: 'buff', req: 10, max: 3, d: 'Habilidade ativa (tecla 8): +20% de dano por 10 s (+5% por ponto).' },
    { id: 'adv', n: 'Técnica Avançada', t: 'mod', req: 20, max: 1, pre: 'a1', d: 'Recarga da habilidade da subclasse 30% menor.' },
    { id: 'p_crit', n: 'Olhar Aguçado', t: 'pas', req: 20, max: 5, st: 'crit', v: .01, d: '+1% de crítico por ponto.' },
    { id: 'sup', n: 'Técnica Suprema', t: 'mod', req: 30, max: 1, pre: 'adv', d: 'Habilidade da subclasse com +50% de poder.' },
    { id: 'max', n: 'Transcendência', t: 'pas', req: 50, max: 1, pre: 'sup', st: 'all', v: .1, d: '+10% de ataque, vida e armadura.' }
  ],
  xpNeed: l => Math.round(3000 + l * l * 160),
  ptsAt: l => 1 + (l % 10 === 0 ? 1 : 0)
};
const subOk = (id, cls) => !!(SUB.defs[id] && SUB.defs[id].cls.indexOf(cls) >= 0 && !SUB.defs[id].off);
/* bônus passivos da subclasse em fração (atk, hp, arm, crit) */
function subBonus(s) {
  const o = { atk: 0, hp: 0, arm: 0, crit: 0 };
  if (!s || !s.id || !SUB.defs[s.id]) return o;
  const d = SUB.defs[s.id], tr = s.tree || {};
  for (const k in d.b) o[k] += d.b[k];
  for (const n of SUB.tree) { const r = tr[n.id] | 0; if (!r || n.t !== 'pas') continue; if (n.st === 'all') { o.atk += n.v; o.hp += n.v; o.arm += n.v; } else o[n.st] += n.v * r; }
  return o;
}
/* poder da habilidade da subclasse (multiplicador e recarga) */
function subSkill(s) {
  if (!s || !s.id || !SUB.defs[s.id]) return null; const d = SUB.defs[s.id].sk, tr = s.tree || {};
  const m = (d.m || 0) * (1 + .12 * (tr.a1 | 0)) * (tr.sup ? 1.5 : 1), cd = d.cd * (tr.adv ? .7 : 1);
  return Object.assign({}, d, { m: +m.toFixed(2), cd: +cd.toFixed(1), heal: d.heal, f: d.f });
}

/* ---------- conquistas e títulos (o servidor calcula com os abates que ELE registrou) ---------- */
const K = (e, ...t) => t.reduce((a, x) => a + ((e.qk && e.qk[x]) | 0), 0);
const ACH = [
  { id: 'lobos', n: 'Caçador de Lobos', d: 'Derrote 50 lobos.', t: 'Caçador', p: e => [K(e, 'wolf', 'frostwolf'), 50] },
  { id: 'goblins', n: 'Flagelo dos Goblins', d: 'Derrote 100 goblins.', t: 'Flagelo Goblin', p: e => [K(e, 'goblin'), 100] },
  { id: 'rei', n: 'O Rei Caiu', d: 'Derrote o Rei Grumsh.', t: 'Regicida', p: e => [K(e, 'boss'), 1] },
  { id: 'mortos', n: 'Purificador', d: 'Derrote 200 mortos-vivos.', t: 'Purificador', p: e => [K(e, 'skeleton', 'mummy', 'necro', 'cguard', 'espectro', 'cavsombrio'), 200] },
  { id: 'lich', n: 'Fim do Lich', d: 'Derrote Morvak na Cripta.', t: 'Matador de Lich', p: e => [K(e, 'morvak'), 1] },
  { id: 'ignar', n: 'Apaga-Chamas', d: 'Derrote Ignar, o Senhor das Chamas.', t: 'Apaga-Chamas', p: e => [K(e, 'ignar'), 1] },
  { id: 'guardiao', n: 'Digno do Santuário', d: 'Derrote o Guardião Ancestral.', t: 'Digno', p: e => [K(e, 'ancestral'), 1] },
  { id: 'dragao', n: 'Matador de Dragões', d: 'Derrote o Dragão Ancestral.', t: 'Matador de Dragões', p: e => [K(e, 'dragao'), 1] },
  { id: 'mil', n: 'Exterminador', d: 'Derrote 1.000 monstros.', t: 'Exterminador', p: e => [Object.keys(e.qk || {}).reduce((a, k) => a + (e.qk[k] | 0), 0), 1000] },
  { id: 'missoes', n: 'Herói de Valdor', d: 'Conclua todas as missões.', t: 'Herói de Valdor', p: e => [Object.keys(e.qd || {}).length, 9] },
  { id: 'montarias', n: 'Mestre do Estábulo', d: 'Tenha 5 montarias.', t: 'Cavaleiro Errante', p: e => [(e.mounts || []).length, 5] },
  { id: 'rico', n: 'Milionário', d: 'Junte 1.000.000 de ouro.', t: 'Magnata', p: e => [Math.floor(e.gold || 0), 1000000] },
  { id: 'sub', n: 'Especialista', d: 'Desperte uma subclasse.', t: 'Desperto', p: e => [e.sub && e.sub.id ? 1 : 0, 1] }
];
const ACH_BY = {}; for (const a of ACH) ACH_BY[a.id] = a;
const achDone = e => ACH.filter(a => { const [v, n] = a.p(e); return v >= n; }).map(a => a.id);

const API = { ACH, ACH_BY, achDone, RAR, SLOTS, SLOT_KEYS, SIC, ARMN, WT, CW, WT_CLS, SHIELD_CLS, MATS, STACK_MAX, mkStack, SETS, setBonus, gen, applyUp, priceOf, score, canEquip, gearSum, maxGearAtk,
  DROP, mergeCfg, roll, catOf, wPick, MOUNTS, MOUNT_BY, MOUNT_MAX_SPD, RECIPES, UPMAX, upCost, SUB, subOk, subBonus, subSkill };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.WI = API;
})(typeof window !== 'undefined' ? window : globalThis);
