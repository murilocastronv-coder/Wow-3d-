'use strict';
/* Servidor do mundo 3D (Reinos de Valdor): jogadores, monstros compartilhados, combate, masmorra, grupo, guilda e troca.
   Tudo passa pelo WebSocket /ws3d. O servidor decide: movimento válido (anti-velocidade), dano (limitado por classe/nível),
   vida e comportamento dos monstros, quem recebe o abate e as trocas. Limites honestos: a vida do jogador e o inventário
   ainda são guardados pelo navegador (a troca é validada contra o último save no banco). */
const T = require('./terrain'), WD = require('./wowdata'), WI = require('./wowitems');
const HALF = T.HALF - 5, NEAR = 150, NEAR2 = NEAR * NEAR, MAXN = 40;
const SPEED = { walk: 7.4, mount: 15 }, REFILL = 1.55, BURST = 45;
const TICK = 100, MNEAR2 = 120 * 120, SLEEP2 = 230 * 230;
const ARENA = { x: 215, z: 175, r: 26 }, GATE = { x: 215, z: 140 }, SPAWN_IN = { x: 215, z: 192 };
const INV_MAX = 40;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = (a, b) => a + Math.random() * (b - a);
const q1 = v => Math.round(v * 10) / 10, q2 = v => Math.round(v * 100) / 100;
const cleanText = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);

module.exports = function ({ verify, DB, WSHOP, log, CLS_MAP }) {
  const players = new Map(), byChar = new Map(), byName = new Map();
  let seq = 1, mseq = 1, iseq = 1, invSeq = 1, tseq = 1;
  const now = () => Date.now();

  /* ---------- trava simples por chave (evita dois salvamentos do mesmo herói se atropelarem) ---------- */
  const locks = new Map();
  function lock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {}); locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
  }

  async function cosOf(accId) {
    const st = (await DB.kvGet('wowshop:' + accId)) || { eq: {} }, out = {};
    for (const cat of ['mount', 'wing', 'aura', 'xmog', 'title']) { const id = st.eq && st.eq[cat]; if (id && WSHOP.BY_ID[id] && st.own.includes(id)) out[cat] = id; }
    return out;
  }
  const pub = p => ({ id: p.id, n: p.name, c: p.cls, ra: p.race, lk: p.look, l: p.lvl, x: q1(p.x), z: q1(p.z), r: q2(p.ry), f: p.f, cos: p.cos, g: p.guild ? p.guild.n : undefined, pv: p.pvp ? 1 : 0, gm: p.gm ? 1 : undefined, mt: p.eco && p.eco.mnt || undefined, sb: p.eco && p.eco.sub && p.eco.sub.id || undefined, at: p.eco && p.eco.ttl && WI.ACH_BY[p.eco.ttl] ? WI.ACH_BY[p.eco.ttl].t : undefined });
  const sendRaw = (p, s) => { if (p.ws && p.ws.open) p.ws.send(s); };
  const send = (p, o) => sendRaw(p, JSON.stringify(o));
  const bc = (list, o) => { const s = JSON.stringify(o); for (const p of list) sendRaw(p, s); };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const sys = (p, x) => send(p, { t: 'ch', k: 's', x });
  /* economia autoritativa: ouro, mochila, equipamento, banco, drops no chão, forja e subclasses (wowmmo.js) */
  const MMO = require('./wowmmo')({ DB, log, lock, send, sys, players, byChar, now });
  MMO.setMountHook(p => { const o = { t: 'u', id: p.id, mt: p.eco && p.eco.mnt || '', at: p.eco && p.eco.ttl && WI.ACH_BY[p.eco.ttl] ? WI.ACH_BY[p.eco.ttl].t : '' }; send(p, o); for (const q of players.values()) if (q.known.has(p.id)) send(q, o); });

  /* =============================== MONSTROS =============================== */
  const worldMobs = new Map();   // monstros do mundo aberto
  function rngSeed(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function mkMob(type, x, z, inst, lvl) {
    const d = WD.MT[type];
    const m = { id: mseq++, type, d, base: lvl || d.lv[0], lvl: lvl || d.lv[0], x, z, hx: x, hz: z, ry: Math.random() * 6.28, state: 'idle', threat: new Map(), contrib: new Set(),
      atkT: 0, respT: 0, stunT: 0, rootT: 0, slowT: 0, dots: [], wt: rnd(1, 5), wx: x, wz: z, agroT: 0, locked: false, boss: !!d.boss, sc: d.sc, rng: d.rng || 2.3 * d.sc, inst: inst || null, lt: 0, lvT: 0 };
    m.mhp = WD.mobHp(d, m.lvl); m.hp = m.mhp; m.dmg = WD.mobDmg(d, m.lvl);
    if (d.elite) m.elite = true;
    if (inst) inst.mobs.set(m.id, m); else worldMobs.set(m.id, m);
    return m;
  }
  /* monstros de elite no mundo aberto: ao (re)nascer, 4% dos monstros comuns viram elite (mais vida, mais dano, loot melhor) */
  const ELITE_CH = +process.env.WOW_ELITE_CH || .04;
  function rollElite(m) {
    if (m.inst || m.boss || m.evx || m.d.elite || m.d.dun) return;
    const was = !!m.wElite; m.wElite = Math.random() < ELITE_CH;
    if (m.wElite) { m.elite = true; m.hpMul = 5; m.dmgMul = 1.3; m.sc = m.d.sc * 1.35; m.nm = [m.d.n + ' de Elite']; }
    else if (was) { m.elite = false; m.hpMul = 1; m.dmgMul = 1; m.sc = m.d.sc; m.nm = undefined; }
  }
  function setLevel(m, lvl, hpMul) {
    m.lvl = lvl; m.mhp = Math.round(WD.mobHp(m.d, lvl) * (hpMul || m.hpMul || 1)); m.hp = m.mhp; m.dmg = WD.mobDmg(m.d, lvl) * (m.dmgMul || 1);
  }
  (function spawnWorld() {
    const R = rngSeed(4242);
    for (const type in WD.MT) {
      const d = WD.MT[type]; if (d.dun || !d.cnt) continue;
      const zn = T.ZONES.find(z => z.id === d.zone); if (!zn) continue;
      for (let i = 0, tries = 0; i < d.cnt && tries < 600; tries++) {
        const a = R() * 6.283, r = Math.sqrt(R()) * (zn.r - 8), x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        if (!T.walkable(x, z) || T.roadDist(x, z) < 2.5) continue;
        mkMob(type, x, z, null, d.lv[0] + Math.floor(R() * (d.lv[1] - d.lv[0] + 1))); i++;
      }
    }
    const gz = T.ZONES.find(z => z.id === 'goblin'); let bx = gz.x, bz = gz.z - 6; for (let k = 0; k < 30 && !T.walkable(bx, bz); k++) { bx += 2; bz -= 1; }
    mkMob('boss', bx, bz, null, 8);
    for (const m of worldMobs.values()) { rollElite(m); if (m.wElite) setLevel(m, m.lvl); }
    // chefes de zona e chefe mundial (nascem no centro da zona, num ponto andável)
    for (const [type, zid, dx, dz, resp] of [['ignar', 'volcano', 0, 6, 600], ['ancestral', 'sanct', 0, 0, 300], ['dragao', 'volcano', 14, -16, 1800]]) {
      const zn = T.ZONES.find(z => z.id === zid); if (!zn) continue; let x = zn.x + dx, z = zn.z + dz;
      for (let k = 0; k < 40 && !T.walkable(x, z); k++) { x += 1.5; z -= 1; }
      const m = mkMob(type, x, z, null, WD.MT[type].lv[0]); m.respS = resp; if (WD.MT[type].world) m.world = true;
    }
  })();

  function bcastMob(m, o) { const s = JSON.stringify(o); const src = m.inst ? m.inst.players : players.values(); for (const p of src) if (p.mk && p.mk.has(m.id)) sendRaw(p, s); }
  const ST = { idle: 0, chase: 1, evade: 2, dead: 3 };
  const mobPub = m => ({ id: m.id, ty: m.type, x: q1(m.x), z: q1(m.z), r: q2(m.ry), l: m.lvl, mh: m.mhp, h: Math.ceil(m.hp), st: ST[m.state], b: m.boss ? 1 : undefined, el: m.elite ? 1 : undefined, nm: m.nm, sc: m.elite ? +m.sc.toFixed(2) : undefined, w: m.world ? 1 : undefined });

  const validTarget = (m, p) => p && p.ready && !p.dead && p.inst === m.inst && p.ws && p.ws.open;
  function nearestPlayer(m, maxD) {
    let best = null, bd = maxD * maxD;
    for (const p of players.values()) { if (!validTarget(m, p)) continue; const dx = p.x - m.x, dz = p.z - m.z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = p; } }
    return best;
  }
  function engage(m, p, th) {
    if (m.state === 'dead') return;
    if (m.state !== 'chase') { m.state = 'chase'; m.locked = true; }
    m.threat.set(p.id, (m.threat.get(p.id) || 0) + (th || 1)); m.agroT = now() / 1000;
  }
  function hurtPlayer(p, m, d) {   // quem decide o dano que o monstro causa é o servidor; o navegador só aplica a armadura dele
    send(p, { t: 'pd', d: Math.max(1, Math.round(d)), id: m.id });
  }
  function killMob(m, t) {
    m.state = 'dead'; m.hp = 0; m.dots.length = 0;
    if (!m.inst) m.respT = t + (m.evx ? 8 : m.respS || (m.boss ? 120 : 38));
    const rec = new Set();
    for (const id of m.contrib) { const p = players.get(id); if (p && p.inst === m.inst) rec.add(p); }
    for (const p of [...rec]) if (p.party) for (const mid of p.party.members) { const o = players.get(mid); if (o && o.inst === m.inst && dist(o, m) < 120) rec.add(o); }
    const rare = new Map(); let killer = null, kt = -1;
    for (const p of rec) { const r = rollRare(m, p); if (r) rare.set(p.id, r); const th = m.threat.get(p.id) || 0; if (th > kt) { kt = th; killer = p; } }
    for (const p of rec) send(p, { t: 'k', id: m.id, ty: m.type, l: m.lvl, b: m.boss ? 1 : 0, el: m.elite ? 1 : 0, pb: Math.min(.7, (p.party ? Math.min(.4, .1 * (p.party.members.length - 1)) : 0) + evXp(m)), dun: m.inst ? 1 : 0, srv: 1 });
    try { MMO.onKill(m, rec, killer, { rare }); } catch (e) { console.error('[mmo kill]', e && e.stack || e); }
    m.contrib.clear(); m.threat.clear();
    bcastMob(m, { t: 'mb', d: [[m.id, q1(m.x), q1(m.z), q2(m.ry), 0, 3]] });
    if (m.evx) evKilled(m);
    if (m.inst) instMobDied(m.inst, m, t);
  }
  function damageMob(m, d, p, crit, rm) {
    if (m.state === 'dead') return;
    m.hp -= d; const t = now() / 1000;
    if (p) { m.threat.set(p.id, (m.threat.get(p.id) || 0) + d); m.contrib.add(p.id); if (m.state !== 'chase') { m.state = 'chase'; m.locked = true; } m.agroT = t; }
    bcastMob(m, { t: 'dm', id: m.id, d, c: crit ? 1 : 0, by: p ? p.id : 0, h: Math.max(0, Math.ceil(m.hp)), rs: rm && rm !== 1 ? (rm < 1 ? 1 : 2) : undefined });
    if (m.hp <= 0) killMob(m, t);
  }
  function respawnMob(m) {
    m.state = 'idle'; m.x = m.hx; m.z = m.hz; m.locked = false; m.threat.clear(); m.contrib.clear(); m.dots.length = 0;
    const p = nearestPlayer(m, 140); m.lvl = WD.mobLvl(m.base, p ? p.lvl : m.base); const wasE = !!m.elite; rollElite(m); setLevel(m, m.lvl);
    if (wasE !== !!m.elite) { for (const q of players.values()) if (q.mk && q.mk.has(m.id)) { q.mk.delete(m.id); send(q, { t: 'ml', id: m.id }); } }
    else bcastMob(m, { t: 'mu', id: m.id, l: m.lvl, mh: m.mhp, h: m.hp, st: 0, x: q1(m.x), z: q1(m.z) });
  }

  /* =============================== EVENTOS AUTOMÁTICOS ===============================
     30 eventos sorteados sozinhos pelo servidor (hordas, elites, bênçãos de zona e eventos globais). Cada evento tem 1 item raro EXCLUSIVO
     (não existe na loja de dinheiro real e vale menos que os visuais premium: é só equipamento, sem poder acima do que o jogo já dá).
     Chances por abate (cada jogador rola a sua): monstro de horda 5% · elite 100% · bênção de zona 2,5% · evento global 1,5%.
     Item raro: 70-85% Épico, 15-30% Lendário. O sorteio é feito aqui no servidor. */
  const EZ = { forest: ['Floresta Sussurrante'], goblin: ['Covil dos Goblins'], grave: ['Cemitério Esquecido'], desert: ['Areias Escarlates'], snow: ['Cume Gélido'], swamp: ['Brejo da Névoa'] };
  const EVDEF = [];
  const E = (k, zone, types, n, item, slot, extra) => EVDEF.push(Object.assign({ id: EVDEF.length + 1, k, zone, types, n, item, slot }, extra || {}));
  // hordas (um tipo de monstro invade a zona)
  E('horde', 'forest', ['wolf'], ['Matilha Enfurecida', 'Enraged Pack', 'Manada Enfurecida', 'Meute Enragée'], ['Presa da Matilha', 'Packfang Ring', 'Colmillo de la Manada', 'Croc de la Meute'], 'anel');
  E('horde', 'forest', ['boar'], ['Estouro de Javalis', 'Boar Stampede', 'Estampida de Jabalíes', 'Ruée de Sangliers'], ['Elmo de Presa Dourada', 'Golden Tusk Helm', 'Yelmo de Colmillo Dorado', 'Heaume de Défense Dorée'], 'cabeca');
  E('horde', 'goblin', ['goblin'], ['Saque Goblin', 'Goblin Raid', 'Saqueo Goblin', 'Raid Gobelin'], ['Adaga do Saqueador', "Raider's Dagger", 'Daga del Saqueador', 'Dague du Pillard'], 'arma');
  E('horde', 'grave', ['skeleton'], ['Levante dos Esqueletos', 'Skeleton Uprising', 'Alzamiento de Esqueletos', 'Soulèvement des Squelettes'], ['Couraça de Ossos Antigos', 'Ancient Bone Cuirass', 'Coraza de Huesos Antiguos', "Cuirasse d'Os Anciens"], 'peito');
  E('horde', 'desert', ['scorpion'], ['Praga Escarlate', 'Scarlet Plague', 'Plaga Escarlata', 'Fléau Écarlate'], ['Grevas de Quitina Rubra', 'Crimson Chitin Greaves', 'Grebas de Quitina Carmesí', 'Jambières de Chitine Pourpre'], 'pernas');
  E('horde', 'desert', ['mummy'], ['Despertar das Múmias', 'Mummies Awaken', 'El Despertar de las Momias', 'Réveil des Momies'], ['Escaravelho de Ankh', 'Ankh Scarab', 'Escarabajo de Ankh', "Scarabée d'Ankh"], 'anel');
  E('horde', 'snow', ['frostwolf'], ['Uivo da Nevasca', 'Blizzard Howl', 'Aullido de Ventisca', 'Hurlement du Blizzard'], ['Garra de Gelo Eterno', 'Eternal Ice Claw', 'Garra de Hielo Eterno', 'Griffe de Glace Éternelle'], 'arma');
  E('horde', 'snow', ['yeti'], ['Fúria dos Yetis', 'Yeti Fury', 'Furia de los Yetis', 'Fureur des Yétis'], ['Pelagem do Rei das Neves', "Snow King's Pelt", 'Pelaje del Rey de las Nieves', 'Fourrure du Roi des Neiges'], 'peito');
  E('horde', 'swamp', ['toad'], ['Coaxar Maldito', 'Cursed Croaking', 'Croar Maldito', 'Coassement Maudit'], ['Botas do Brejo Venenoso', 'Venomous Bog Boots', 'Botas del Pantano Venenoso', 'Bottes du Marais Venimeux'], 'pernas');
  E('horde', 'swamp', ['hag'], ['Sabá das Bruxas', "Witches' Sabbath", 'Aquelarre de Brujas', 'Sabbat des Sorcières'], ['Capuz da Matriarca', "Matriarch's Hood", 'Capucha de la Matriarca', 'Capuche de la Matriarche'], 'cabeca');
  // invasões duplas (dois tipos juntos)
  E('twin', 'grave', ['skeleton', 'mummy'], ['Guerra dos Mortos', 'War of the Dead', 'Guerra de los Muertos', 'Guerre des Morts'], ['Cetro dos Mortos-Vivos', 'Undead Scepter', 'Cetro de los No Muertos', 'Sceptre des Morts-Vivants'], 'arma');
  E('twin', 'snow', ['frostwolf', 'yeti'], ['Tempestade Gélida', 'Frozen Tempest', 'Tempestad Gélida', 'Tempête Glaciale'], ['Anel do Inverno Eterno', 'Ring of Endless Winter', 'Anillo del Invierno Eterno', "Anneau de l'Hiver Éternel"], 'anel');
  E('twin', 'swamp', ['toad', 'hag'], ['Pântano Amaldiçoado', 'Cursed Swamp', 'Pantano Maldito', 'Marais Maudit'], ['Manto da Névoa Sombria', 'Dark Mist Mantle', 'Manto de la Niebla Sombría', 'Manteau de la Brume Sombre'], 'peito');
  E('twin', 'goblin', ['goblin', 'boar'], ['Caravana Selvagem', 'Wild Caravan', 'Caravana Salvaje', 'Caravane Sauvage'], ['Chapéu do Chefe da Caravana', 'Caravan Boss Hat', 'Sombrero del Jefe de la Caravana', 'Chapeau du Chef de Caravane'], 'cabeca');
  E('twin', 'desert', ['scorpion', 'mummy'], ['Tempestade de Areia', 'Sandstorm', 'Tormenta de Arena', 'Tempête de Sable'], ['Grevas do Nômade das Dunas', 'Dune Nomad Greaves', 'Grebas del Nómada de las Dunas', 'Jambières du Nomade des Dunes'], 'pernas');
  // elites (um chefe com nome próprio + capangas)
  E('elite', 'forest', ['wolf'], ['Caça ao Alfa', 'Hunt the Alpha', 'Caza al Alfa', "Chasse à l'Alpha"], ['Lâmina da Sombra Cinzenta', 'Grey Shadow Blade', 'Hoja de la Sombra Gris', "Lame de l'Ombre Grise"], 'arma', { boss: ['Fenrir, a Sombra Cinzenta', 'Fenrir, the Grey Shadow', 'Fenrir, la Sombra Gris', "Fenrir, l'Ombre Grise"] });
  E('elite', 'goblin', ['goblin'], ['Rei dos Ladrões', 'The Thief King', 'El Rey de los Ladrones', 'Le Roi des Voleurs'], ['Anel do Rei dos Ladrões', "Thief King's Ring", 'Anillo del Rey de los Ladrones', 'Anneau du Roi des Voleurs'], 'anel', { boss: ['Gorzak, o Rei dos Ladrões', 'Gorzak, the Thief King', 'Gorzak, el Rey de los Ladrones', 'Gorzak, le Roi des Voleurs'] });
  E('elite', 'grave', ['skeleton'], ['Cavaleiro Sem Descanso', 'The Restless Knight', 'El Caballero Inquieto', 'Le Chevalier Sans Repos'], ['Elmo do Cavaleiro Sem Descanso', "Restless Knight's Helm", 'Yelmo del Caballero Inquieto', 'Heaume du Chevalier Sans Repos'], 'cabeca', { boss: ['Sir Malachar, o Sem Descanso', 'Sir Malachar, the Restless', 'Sir Malachar, el Inquieto', 'Sir Malachar, le Sans-Repos'] });
  E('elite', 'desert', ['mummy'], ['A Ira do Faraó', "The Pharaoh's Wrath", 'La Ira del Faraón', 'La Colère du Pharaon'], ['Peitoral do Faraó', "Pharaoh's Breastplate", 'Peto del Faraón', 'Plastron du Pharaon'], 'peito', { boss: ['Faraó Ankhotep', 'Pharaoh Ankhotep', 'Faraón Ankhotep', 'Pharaon Ankhotep'] });
  E('elite', 'snow', ['yeti'], ['O Colosso Branco', 'The White Colossus', 'El Coloso Blanco', 'Le Colosse Blanc'], ['Grevas de Ymir', "Ymir's Greaves", 'Grebas de Ymir', "Jambières d'Ymir"], 'pernas', { boss: ['Grande Ymir', 'Great Ymir', 'Gran Ymir', 'Grand Ymir'] });
  E('elite', 'swamp', ['hag'], ['O Caldeirão de Morgara', "Morgara's Cauldron", 'El Caldero de Morgara', 'Le Chaudron de Morgara'], ['Cajado do Caldeirão', 'Cauldron Staff', 'Bastón del Caldero', 'Bâton du Chaudron'], 'arma', { boss: ['Vovó Morgara', 'Granny Morgara', 'Abuela Morgara', 'Mamie Morgara'] });
  // bênçãos de zona (sem monstros extras: mais chance de raro em toda a zona)
  E('rain', 'forest', [], ['Bênção da Floresta', "Forest's Blessing", 'Bendición del Bosque', 'Bénédiction de la Forêt'], ['Folha Encantada', 'Enchanted Leaf', 'Hoja Encantada', 'Feuille Enchantée'], 'anel');
  E('rain', 'goblin', [], ['Febre do Ouro', 'Gold Fever', 'Fiebre del Oro', "Fièvre de l'Or"], ['Coroa de Ouro Falso', "Crown of Fool's Gold", 'Corona de Oro Falso', "Couronne d'Or Faux"], 'cabeca');
  E('rain', 'grave', [], ['Noite das Almas', 'Night of Souls', 'Noche de las Almas', 'Nuit des Âmes'], ['Mortalha Etérea', 'Ethereal Shroud', 'Sudario Etéreo', 'Linceul Éthéré'], 'peito');
  E('rain', 'desert', [], ['Miragem Dourada', 'Golden Mirage', 'Espejismo Dorado', 'Mirage Doré'], ['Grevas da Miragem', 'Mirage Greaves', 'Grebas del Espejismo', 'Jambières du Mirage'], 'pernas');
  E('rain', 'snow', [], ['Aurora Boreal', 'Northern Lights', 'Aurora Boreal', 'Aurore Boréale'], ['Anel da Aurora', 'Aurora Ring', 'Anillo de la Aurora', "Anneau de l'Aurore"], 'anel');
  E('rain', 'swamp', [], ['Vaga-lumes do Brejo', 'Bog Fireflies', 'Luciérnagas del Pantano', 'Lucioles du Marais'], ['Máscara dos Vaga-lumes', 'Firefly Mask', 'Máscara de las Luciérnagas', 'Masque des Lucioles'], 'cabeca');
  // eventos globais (valem em todo o mundo)
  E('global', '', [], ['Chuva de Estrelas', 'Starfall', 'Lluvia de Estrellas', "Pluie d'Étoiles"], ['Fragmento de Estrela Cadente', 'Fallen Star Shard', 'Fragmento de Estrella Fugaz', "Éclat d'Étoile Filante"], 'arma', { xp: .1 });
  E('global', '', [], ['Lua de Sangue', 'Blood Moon', 'Luna de Sangre', 'Lune de Sang'], ['Armadura da Lua de Sangue', 'Blood Moon Armor', 'Armadura de la Luna de Sangre', 'Armure de la Lune de Sang'], 'peito', { xp: .1 });
  E('global', '', [], ['Hora Dourada', 'Golden Hour', 'Hora Dorada', 'Heure Dorée'], ['Anel do Sol Poente', 'Setting Sun Ring', 'Anillo del Sol Poniente', 'Anneau du Soleil Couchant'], 'anel', { xp: .3 });
  const EV_DUR = { horde: 10, twin: 10, elite: 12, rain: 10, global: 10 };   // minutos
  const EV_FAST = +process.env.WOW_EV_FAST_MS || 0;
  let evCur = null, evNext = now() + (EV_FAST || +process.env.WOW_EV_FIRST_MS || 4 * 60e3); const evRecent = [];
  const evPub = () => evCur && { t: 'ev', on: 1, id: evCur.def.id, k: evCur.def.k, n: evCur.def.n, it: evCur.def.item, zn: (EZ[evCur.def.zone] || [''])[0], x: Math.round(evCur.ax), z: Math.round(evCur.az), ms: Math.max(0, evCur.end - now()), left: evCur.mobs.size ? [...evCur.mobs].filter(m => m.state !== 'dead').length : -1, bs: evCur.def.boss || undefined };
  function evSpawn(def) {
    const zn = T.ZONES.find(z => z.id === def.zone); const ev = { def, end: now() + EV_DUR[def.k] * 60e3, mobs: new Set(), ax: 0, az: 0, done: false };
    if (zn) {
      ev.ax = zn.x; ev.az = zn.z;
      for (let i = 0; i < 120; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * zn.r * .55, x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r; if (T.walkable(x, z) && T.roadDist(x, z) > 2.5) { ev.ax = x; ev.az = z; break; } }
    }
    const put = (type, n, elite) => {
      for (let i = 0, tr = 0; i < n && tr < 300; tr++) {
        const a = Math.random() * 6.283, r = (elite ? 2 : 3) + Math.random() * (elite ? 4 : 13), x = ev.ax + Math.cos(a) * r, z = ev.az + Math.sin(a) * r; if (!T.walkable(x, z)) continue; i++;
        const d = WD.MT[type], m = mkMob(type, x, z, null, d.lv[0] + Math.floor(Math.random() * (d.lv[1] - d.lv[0] + 1)));
        m.evx = ev; m.hx = x; m.hz = z;
        if (elite) { m.elite = true; m.hpMul = 7; m.dmgMul = 1.35; m.sc = d.sc * 1.5; m.rng = (d.rng || 2.3 * d.sc) * 1.4; m.nm = def.boss; setLevel(m, m.lvl); }
        ev.mobs.add(m);
      }
    };
    if (def.k === 'horde') put(def.types[0], 14);
    else if (def.k === 'twin') { put(def.types[0], 8); put(def.types[1], 8); }
    else if (def.k === 'elite') { put(def.types[0], 1, true); put(def.types[0], 6); }
    return ev;
  }
  function evStart(def) {
    if (evCur) return; evCur = evSpawn(def); evRecent.push(def.id); if (evRecent.length > 6) evRecent.shift();
    bc([...players.values()], evPub()); console.log('[EVENTO] início:', def.n[0], '(' + def.k + ')');
  }
  function evEnd(done) {
    if (!evCur) return; const ev = evCur; evCur = null;
    for (const m of ev.mobs) if (m.state !== 'dead') { worldMobs.delete(m.id); }
    bc([...players.values()], { t: 'ev', on: 0, id: ev.def.id, done: done ? 1 : 0, n: ev.def.n });
    evNext = now() + (EV_FAST || (+process.env.WOW_EV_GAP_MS || (12 + Math.random() * 6) * 60e3)); console.log('[EVENTO] fim:', ev.def.n[0], done ? '(concluído)' : '(tempo esgotado)');
  }
  function evTick() {
    const tn = now();
    if (evCur) { if (tn >= evCur.end) evEnd(false); return; }
    if (tn < evNext || !players.size) return;
    const pool = EVDEF.filter(d => !evRecent.includes(d.id)); evStart(pool[Math.floor(Math.random() * pool.length)]);
  }
  setInterval(() => { try { evTick(); } catch (e) { console.error('evento', e); } }, EV_FAST ? 2000 : 5000);
  function evKilled(m) {
    const ev = m.evx; if (!ev || ev !== evCur) return;
    const left = [...ev.mobs].filter(x => x.state !== 'dead').length;
    bc([...players.values()], { t: 'ev', u: 1, left });
    if (!left && !ev.done) { ev.done = true; setTimeout(() => { if (evCur === ev) evEnd(true); }, 4000); }
  }
  function rollRare(m, p) {
    const ev = evCur; if (!ev || m.inst) return;
    let ch = 0, elite = false;
    if (m.evx === ev) { if (m.elite) { ch = 1; elite = true; } else ch = .05; }
    else if (ev.def.k === 'rain' && T.zoneAt(m.x, m.z).id === ev.def.zone) ch = .025;
    else if (ev.def.k === 'global') ch = .015;
    if (!ch || Math.random() >= ch) return;
    return { e: ev.def.id, n: ev.def.item, s: ev.def.slot, r: Math.random() < (elite ? .3 : .15) ? 5 : 4 };
  }
  const evXp = m => { const ev = evCur; return ev && (ev.def.xp || 0) && !m.inst ? ev.def.xp : 0; };

  function stepMob(m, dt, t) {
    if (m.state === 'dead') { if (!m.inst && t >= m.respT) { if (m.evx) worldMobs.delete(m.id); else respawnMob(m); } return; }
    // dormente: ninguém por perto
    let any = false; for (const p of players.values()) { if (p.inst !== m.inst || !p.ready) continue; const dx = p.x - m.x, dz = p.z - m.z; if (dx * dx + dz * dz < SLEEP2) { any = true; break; } }
    if (!any) return;
    for (let i = m.dots.length - 1; i >= 0; i--) { const dd = m.dots[i]; if (t >= dd.next) { damageMob(m, Math.max(1, Math.round(dd.d)), dd.by, false); dd.next += dd.iv; if (--dd.n <= 0) m.dots.splice(i, 1); if (m.state === 'dead') return; } }
    const stunned = t < m.stunT, rooted = t < m.rootT || stunned;
    let spd = m.d.spd * (t < m.slowT ? (m.boss ? .7 : .55) : 1) * (m.enrage ? 1.3 : 1);
    if (m.state === 'idle') {
      if (!m.inst && t - m.lvT > 3) { m.lvT = t; const p = nearestPlayer(m, 120); if (p) { const nl = WD.mobLvl(m.base, p.lvl); if (nl !== m.lvl) { setLevel(m, nl); bcastMob(m, { t: 'mu', id: m.id, l: m.lvl, mh: m.mhp, h: m.hp, st: 0, x: q1(m.x), z: q1(m.z) }); } } }
      m.wt -= dt; if (m.wt <= 0) { m.wt = rnd(2, 6); const a = rnd(0, 6.28); m.wx = m.hx + Math.cos(a) * rnd(2, 9); m.wz = m.hz + Math.sin(a) * rnd(2, 9); }
      if (!m.inst && Math.hypot(m.wx - m.x, m.wz - m.z) > .6 && !rooted) {
        const a = Math.atan2(m.wx - m.x, m.wz - m.z); m.ry = a; const nx = m.x + Math.sin(a) * spd * .4 * dt, nz = m.z + Math.cos(a) * spd * .4 * dt; if (T.walkable(nx, nz)) { m.x = nx; m.z = nz; }
      }
      const agg = m.d.agg * (m.inst ? 1.3 : 1);
      for (const p of players.values()) {
        if (!validTarget(m, p)) continue; const dx = p.x - m.x, dz = p.z - m.z, d2 = dx * dx + dz * dz, rr = agg * clamp(1 - (p.lvl - m.lvl) * .05, .5, 1.4);
        if (d2 < rr * rr) { if (!m.inst) { const nl = WD.mobLvl(m.base, p.lvl); if (nl !== m.lvl) { setLevel(m, nl); bcastMob(m, { t: 'mu', id: m.id, l: m.lvl, mh: m.mhp, h: m.hp, st: 1, x: q1(m.x), z: q1(m.z) }); } } engage(m, p, 1); break; }
      }
    } else if (m.state === 'chase') {
      let tgt = null, bt = -1;
      for (const [id, th] of m.threat) { const p = players.get(id); if (!validTarget(m, p) || dist(p, { x: m.hx, z: m.hz }) > (m.inst ? 90 : 80)) { m.threat.delete(id); continue; } if (th > bt) { bt = th; tgt = p; } }
      if (m.tauntId) { const tp = players.get(m.tauntId); if (validTarget(m, tp)) tgt = tp; }
      if (!tgt) { if (t - m.agroT > 4) { m.state = 'evade'; } }
      else if (Math.hypot(m.x - m.hx, m.z - m.hz) > (m.inst ? 110 : m.boss ? 75 : 62)) m.state = 'evade';
      else {
        const dp = dist(m, tgt) - .4;
        if (dp > m.rng && !rooted) { const a = Math.atan2(tgt.x - m.x, tgt.z - m.z); m.ry = a; const nx = m.x + Math.sin(a) * spd * dt, nz = m.z + Math.cos(a) * spd * dt; if (m.inst || T.walkable(nx, nz)) { m.x = nx; m.z = nz; } }
        else if (dp <= m.rng && !stunned) {
          m.ry = Math.atan2(tgt.x - m.x, tgt.z - m.z);
          if (t >= m.atkT) { m.atkT = t + (m.boss ? 1.7 : 2) * (m.enrage ? .7 : 1); bcastMob(m, { t: 'ma', id: m.id }); hurtPlayer(tgt, m, m.dmg * rnd(.85, 1.15)); }
        }
        if (m.type === 'morvak' && m.inst) bossTick(m.inst, m, t, dt);
        else if (!m.inst && WB[m.type]) wbTick(m, t);
      }
    } else if (m.state === 'evade') {
      const a = Math.atan2(m.hx - m.x, m.hz - m.z); m.ry = a; m.x += Math.sin(a) * m.d.spd * 1.4 * dt; m.z += Math.cos(a) * m.d.spd * 1.4 * dt; m.hp = Math.min(m.mhp, m.hp + m.mhp * .25 * dt); m.threat.clear();
      if (Math.hypot(m.hx - m.x, m.hz - m.z) < 1.2) { m.state = 'idle'; m.hp = m.mhp; m.locked = false; m.contrib.clear(); bcastMob(m, { t: 'mu', id: m.id, l: m.lvl, mh: m.mhp, h: m.hp, st: 0, x: q1(m.x), z: q1(m.z) }); }
    }
  }

  /* =============================== CHEFES DO MUNDO ABERTO ===============================
     Ignar (vulcão), Guardião Ancestral (santuário, exigido pela subclasse) e o Dragão Ancestral (chefe mundial).
     Fases por vida (60% e 25%), círculos de aviso no chão (saia antes de explodir), pulso em área e reforços. */
  const WB = { ignar: { rain: 10, pulse: 18, add: 'imp' }, ancestral: { rain: 12, pulse: 16, add: 'sentinela' }, dragao: { rain: 8, pulse: 14, add: 'imp', breath: 1 } };
  const WTEL = [];
  const nearP = (m, r) => [...players.values()].filter(p => p.ready && !p.dead && !p.inst && dist(p, m) < r);
  function wbTick(m, t) {
    const W = WB[m.type], hf = m.hp / m.mhp, ph = hf > .6 ? 1 : hf > .25 ? 2 : 3, live = nearP(m, 60); if (!live.length) return;
    if (m.phase !== ph) { const was = m.phase; m.phase = ph; if (was) { if (ph === 3) m.enrage = true; for (const p of nearP(m, 120)) send(p, { t: 'wb', k: 'ph', p: ph, n: m.d.n }); } m.nextRain = m.nextRain || t + 6; m.nextPulse = m.nextPulse || t + 12; m.nextAdd = m.nextAdd || t + 20; }
    if (t >= m.nextRain) { m.nextRain = t + W.rain * (ph === 3 ? .6 : 1); const cnt = Math.min(live.length + (ph - 1), 6);
      for (let i = 0; i < cnt; i++) { const p = live[i % live.length], x = p.x + (i >= live.length ? rnd(-6, 6) : 0), z = p.z + (i >= live.length ? rnd(-6, 6) : 0); WTEL.push({ x, z, r: 4.5, at: t + 2.4, dmg: m.dmg * 1.5, by: m.id });
        for (const q of nearP(m, 120)) send(q, { t: 'tel', x: q1(x), z: q1(z), r: 4.5, ms: 2400, k: W.breath ? 'fire' : 'rain' }); } }
    if (ph >= 2 && t >= m.nextPulse) { m.nextPulse = t + W.pulse; WTEL.push({ x: m.x, z: m.z, r: 11 + m.sc * 1.2, at: t + 2.2, dmg: m.dmg * 2.2, by: m.id });
      for (const q of nearP(m, 120)) send(q, { t: 'tel', x: q1(m.x), z: q1(m.z), r: 11 + m.sc * 1.2, ms: 2200, k: 'pulse' }); }
    if (ph >= 2 && t >= m.nextAdd) { m.nextAdd = t + 30; const n = [...worldMobs.values()].filter(x => x.summonBy === m.id && x.state !== 'dead').length;
      if (n < 4) for (let i = 0; i < 2; i++) { const a = Math.random() * 6.283, mm = mkMob(W.add, m.x + Math.cos(a) * 5, m.z + Math.sin(a) * 5, null, WD.MT[W.add].lv[0]); mm.summonBy = m.id; mm.evx = { mobs: new Set() }; setLevel(mm, Math.max(mm.lvl, m.lvl - 2)); mm.hx = mm.x; mm.hz = mm.z; engage(mm, live[i % live.length], 1); }
      for (const q of nearP(m, 120)) send(q, { t: 'wb', k: 'add', n: m.d.n }); }
  }
  function wtelTick(t) {
    for (let i = WTEL.length - 1; i >= 0; i--) { const e = WTEL[i]; if (t < e.at) continue; WTEL.splice(i, 1);
      for (const p of players.values()) { if (!p.ready || p.dead || p.inst) continue; if (Math.hypot(p.x - e.x, p.z - e.z) < e.r) send(p, { t: 'pd', d: Math.round(e.dmg * rnd(.9, 1.1)), id: e.by }); } }
  }

  /* =============================== MASMORRA: CRIPTA DE MORVAK =============================== */
  const insts = new Map();
  function instPlayers(I) { return [...I.players]; }
  function spawnWave(I, w) {
    const n = Math.max(1, I.players.size), avg = I.avg, adds = 1 + .5 * (n - 1);
    const ring = (type, cnt, r0) => { for (let i = 0; i < cnt; i++) { const a = i / cnt * 6.283 + Math.random() * .4, r = r0 + Math.random() * 3; const m = mkMob(type, ARENA.x + Math.cos(a) * r, ARENA.z + Math.sin(a) * r, I, 22); setLevel(m, Math.max(22, avg + 2), adds); m.base = 22; } };
    if (w === 1) ring('cguard', 5 + Math.min(2, n - 1), 11);
    if (w === 2) { ring('cguard', 3, 10); ring('necro', 2, 14); }
    if (w === 3) {
      const m = mkMob('morvak', ARENA.x, ARENA.z - 4, I, 24); setLevel(m, Math.max(24, avg + 5), 1 + .85 * (n - 1)); m.base = 24; m.hx = ARENA.x; m.hz = ARENA.z - 4;
      m.phase = 1; m.nextRain = now() / 1000 + 9; m.nextPulse = now() / 1000 + 20; m.nextSummon = now() / 1000 + 15; I.boss = m;
      bc(I.players, { t: 'dun', k: 'boss', n: m.d.n });
    }
    I.wave = w;
  }
  function instMobDied(I, m, t) {
    const alive = [...I.mobs.values()].filter(x => x.state !== 'dead');
    if (m.type === 'morvak') {
      I.done = true; I.tel.length = 0; bc(I.players, { t: 'dun', k: 'win' });
      for (const x of I.mobs.values()) if (x.state !== 'dead' && x !== m) { x.state = 'dead'; x.hp = 0; bcastMob(x, { t: 'mb', d: [[x.id, q1(x.x), q1(x.z), q2(x.ry), 0, 3]] }); }
      log('[3d] masmorra vencida', I.id, I.players.size); return;
    }
    if (!alive.length && !I.done) {
      if (I.wave === 1) { bc(I.players, { t: 'dun', k: 'w2' }); setTimeout(() => { if (insts.has(I.id) && !I.done) spawnWave(I, 2); }, 3500); }
      else if (I.wave === 2) { bc(I.players, { t: 'dun', k: 'w3' }); setTimeout(() => { if (insts.has(I.id) && !I.done) spawnWave(I, 3); }, 4500); }
    }
  }
  function bossTick(I, m, t, dt) {
    const hf = m.hp / m.mhp, ph = hf > .6 ? 1 : hf > .25 ? 2 : 3;
    if (ph !== m.phase) { m.phase = ph; bc(I.players, { t: 'dun', k: 'ph', p: ph }); if (ph === 3) { m.enrage = true; } }
    const live = [...I.players].filter(p => p.ready && !p.dead);
    if (!live.length) return;
    if (t >= m.nextRain) {   // Chuva de Fogo: círculos que aparecem sob os heróis; saia de dentro antes de acabar o aviso
      m.nextRain = t + (ph === 3 ? 7 : 13);
      const cnt = Math.min(live.length + (ph === 3 ? 2 : 0), ph === 3 ? 6 : 3);
      for (let i = 0; i < cnt; i++) { const p = live[i % live.length], x = p.x + (i >= live.length ? rnd(-6, 6) : 0), z = p.z + (i >= live.length ? rnd(-6, 6) : 0); I.tel.push({ x, z, r: 4.5, at: t + 2.6, dmg: m.dmg * 1.6 }); bc(I.players, { t: 'tel', x: q1(x), z: q1(z), r: 4.5, ms: 2600, k: 'rain' }); }
    }
    if (ph >= 2 && t >= m.nextPulse) {   // Pulso Sombrio: dano enorme ao redor do chefe; só quem estiver LONGE (13 m+) escapa
      m.nextPulse = t + (ph === 3 ? 14 : 20); const x = m.x, z = m.z; I.tel.push({ x, z, r: 13, at: t + 2.4, dmg: m.dmg * 2.4 });
      bc(I.players, { t: 'tel', x: q1(x), z: q1(z), r: 13, ms: 2400, k: 'pulse' });
    }
    if (ph >= 2 && t >= m.nextSummon) {
      m.nextSummon = t + 25; const adds = [...I.mobs.values()].filter(x => x.type === 'cguard' && x.state !== 'dead').length;
      if (adds < 4) for (let i = 0; i < 2; i++) { const a = Math.random() * 6.283, mm = mkMob('cguard', m.x + Math.cos(a) * 5, m.z + Math.sin(a) * 5, I, 22); setLevel(mm, Math.max(22, I.avg + 2), 1 + .5 * (I.players.size - 1)); mm.base = 22; mm.state = 'chase'; mm.agroT = t; const tg = live[i % live.length]; mm.threat.set(tg.id, 1); }
      bc(I.players, { t: 'dun', k: 'add' });
    }
  }
  function instTick(I, t) {
    for (let i = I.tel.length - 1; i >= 0; i--) {
      const e = I.tel[i]; if (t < e.at) continue; I.tel.splice(i, 1);
      for (const p of I.players) { if (!p.ready || p.dead) continue; if (Math.hypot(p.x - e.x, p.z - e.z) < e.r) send(p, { t: 'pd', d: Math.round(e.dmg * rnd(.9, 1.1)), id: I.boss ? I.boss.id : 0 }); }
    }
    if (!I.players.size) { if (!I.emptyAt) I.emptyAt = t; if (t - I.emptyAt > 60) destroyInst(I); } else I.emptyAt = 0;
    if (t - I.t0 > 2400) destroyInst(I);
  }
  function destroyInst(I) { insts.delete(I.id); for (const p of I.players) leaveInst(p, true); for (const m of I.mobs.values()) m.state = 'dead'; I.mobs.clear(); if (I.party && I.party.inst === I) I.party.inst = null; }
  function resetView(p) {   // muda de 'mundo' (mundo aberto <-> masmorra): o navegador esquece monstros e jogadores antigos
    for (const id of p.known) send(p, { t: 'l', id }); send(p, { t: 'mclr' }); p.known.clear(); p.mk = new Set(); p.mc = new Map();
  }
  function enterInst(p) {
    if (p.inst) return sys(p, 'Você já está na masmorra.');
    if (dist(p, GATE) > 16) return sys(p, 'Chegue perto do portão da Cripta.');
    if (p.lvl < 10) return sys(p, 'A Cripta de Morvak exige nível 10.');
    let I = p.party && p.party.inst && insts.has(p.party.inst.id) ? p.party.inst : null;
    if (I && I.done) I = null;
    if (!I) {
      const avgOf = () => { const ps = p.party ? p.party.members.map(id => players.get(id)).filter(x => x && dist(x, GATE) < 40) : [p]; return Math.round(ps.reduce((a, x) => a + x.lvl, 0) / Math.max(1, ps.length)); };
      I = { id: iseq++, players: new Set(), mobs: new Map(), wave: 0, tel: [], t0: now() / 1000, avg: avgOf(), party: p.party || null, boss: null, done: false };
      insts.set(I.id, I); if (p.party) p.party.inst = I; spawnWave(I, 1);
    }
    if (I.players.size >= 5) return sys(p, 'A masmorra está cheia (máx. 5).');
    resetView(p); I.players.add(p); p.inst = I;
    p.tpTo = { x: SPAWN_IN.x + rnd(-3, 3), z: SPAWN_IN.z + rnd(-1, 1), t: now() }; p.x = p.tpTo.x; p.z = p.tpTo.z;
    send(p, { t: 'tp', x: q1(p.x), z: q1(p.z) }); send(p, { t: 'inst', on: 1, n: 'Cripta de Morvak' }); MMO.sendGround(p);
    for (const o of I.players) if (o !== p) sys(o, p.name + ' entrou na masmorra.');
  }
  function leaveInst(p, silent) {
    const I = p.inst; if (!I) return; p.inst = null; I.players.delete(p); if (!silent) resetView(p); else { p.mk = new Set(); p.mc = new Map(); p.known.clear(); }
    if (!silent && p.ws && p.ws.open) { send(p, { t: 'inst', on: 0 }); MMO.sendGround(p); }
  }
  function exitInst(p) {
    if (!p.inst) return;
    leaveInst(p); p.tpTo = { x: GATE.x + rnd(-2, 2), z: GATE.z - 4, t: now() }; p.x = p.tpTo.x; p.z = p.tpTo.z; send(p, { t: 'tp', x: q1(p.x), z: q1(p.z) });
  }

  /* =============================== GRUPO =============================== */
  const parties = new Map(), invites = new Map();
  const memberView = p => ({ id: p.id, n: p.name, c: p.cls, l: p.lvl, h: p.hpPct == null ? 100 : p.hpPct });
  function sendParty(pt) {
    const ms = pt.members.map(id => players.get(id)).filter(Boolean);
    bc(ms, { t: 'pt', l: pt.leader, m: ms.map(memberView) });
  }
  function leaveParty(p, why) {
    const pt = p.party; if (!pt) return; p.party = null;
    pt.members = pt.members.filter(id => id !== p.id);
    send(p, { t: 'pt', l: 0, m: [] }); if (why) sys(p, why);
    if (pt.members.length <= 1) { for (const id of pt.members) { const o = players.get(id); if (o) { o.party = null; send(o, { t: 'pt', l: 0, m: [] }); sys(o, 'O grupo foi desfeito.'); } } parties.delete(pt.id); return; }
    if (pt.leader === p.id) { pt.leader = pt.members[0]; const nl = players.get(pt.leader); if (nl) for (const id of pt.members) { const o = players.get(id); if (o) sys(o, nl.name + ' agora é o líder do grupo.'); } }
    sendParty(pt);
  }
  function mkInvite(kind, from, to, extra) {
    const id = invSeq++; invites.set(id, Object.assign({ id, kind, from: from.id, to: to.id, exp: now() + 60000 }, extra || {})); return id;
  }

  /* =============================== GUILDA =============================== */
  const guilds = new Map();   // nome minúsculo -> guilda
  const gkey = n => 'wowguild:' + n.toLowerCase();
  async function loadGuild(n) { const k = n.toLowerCase(); if (guilds.has(k)) return guilds.get(k); const g = await DB.kvGet(gkey(n)); if (g) guilds.set(k, g); return g || null; }
  const saveGuild = g => DB.kvSet(gkey(g.n), g);
  function guildOnline(g) { const o = []; for (const m of g.mem) { const p = byChar.get(m.c); if (p) o.push(p); } return o; }
  async function sendRoster(p) {
    const g = p.guild; if (!g) return send(p, { t: 'gro', g: null });
    send(p, { t: 'gro', g: { n: g.n, motd: g.motd || '', l: g.l, me: p.charId }, m: g.mem.map(m => { const o = byChar.get(m.c); return { c: m.c, n: m.n, r: m.r, on: o ? 1 : 0, l: o ? o.lvl : (m.l || 0) }; }) });
  }
  function rosterAll(g) { for (const p of guildOnline(g)) sendRoster(p); }
  async function setGuild(p, g) { p.guild = g; await DB.kvSet('wowg:' + p.charId, g ? g.n.toLowerCase() : null); }
  const rankOf = (g, c) => { const m = g.mem.find(x => x.c === c); return m ? m.r : null; };

  /* =============================== TROCA =============================== */
  const trades = new Map();
  const TRADABLE = it => it && !it.quest && it.id;
  function cancelTrade(tr, why) {
    if (!trades.delete(tr.id)) return;
    for (const p of [tr.a, tr.b]) { p.trade = null; if (p.ws && p.ws.open) send(p, { t: 'tx', id: tr.id, why: why || '' }); }
  }
  async function execTrade(tr) {   // tudo acontece na memória autoritativa (p.eco) dos dois heróis, num único passo síncrono
    const A = tr.a, B = tr.b; tr.busy = true;
    try {
      const ea = A.eco, eb = B.eco; if (!ea || !eb || A.ecoFrozen || B.ecoFrozen) throw new Error('save');
      const offA = tr.offer[A.id], offB = tr.offer[B.id];
      const take = (e, off) => {   // confere e retira (numa cópia) os itens oferecidos
        const inv = e.inv.map(x => Object.assign({}, x)), out = [];
        for (const o of off.items) {
          const i = inv.findIndex(x => x.u === o.id || x.id === o.id); if (i < 0 || !TRADABLE(inv[i]) || (WI.MATS[inv[i].id] && WI.MATS[inv[i].id].bound)) throw new Error('item');
          const it = inv[i], n = Math.max(1, o.n | 0);
          if (it.stack) { if ((it.n | 0) < n) throw new Error('item'); const c = Object.assign({}, it, { n }); delete c.u; out.push(c); it.n -= n; if (it.n <= 0) inv.splice(i, 1); }
          else { out.push(it); inv.splice(i, 1); }
        }
        if (off.gold > Math.floor(e.gold)) throw new Error('gold');
        return { inv, out };
      };
      const ra = take(ea, offA), rb = take(eb, offB);
      const put = (inv, items) => { for (const it of items) if (!MMO.addTo(inv, Object.assign({}, it), INV_MAX)) throw new Error('full'); };
      put(ra.inv, rb.out); put(rb.inv, ra.out);
      ea.inv = ra.inv; eb.inv = rb.inv; ea.gold = Math.floor(ea.gold) - offA.gold + offB.gold; eb.gold = Math.floor(eb.gold) - offB.gold + offA.gold;
      MMO.persist(A); MMO.persist(B); MMO.push(A); MMO.push(B);
      send(A, { t: 'td', srv: 1, gold: offB.gold - offA.gold }); send(B, { t: 'td', srv: 1, gold: offA.gold - offB.gold });
      log('[3d] troca', A.name, B.name, JSON.stringify([offA.items.length, offA.gold, offB.items.length, offB.gold]));
      DB.log('trade', { a: A.charId, b: B.charId, ia: ra.out.map(x => x.id), ib: rb.out.map(x => x.id), ga: offA.gold, gb: offB.gold });
      trades.delete(tr.id); A.trade = B.trade = null;
    } catch (e) { tr.busy = false; const m = ({ item: 'Um item oferecido não está mais na sua mochila.', gold: 'Ouro insuficiente.', full: 'A mochila de um dos jogadores está cheia.', save: 'Inventário ainda sincronizando. Tente de novo.' })[e.message] || 'Erro na troca.'; cancelTrade(tr, m); }
  }
  async function describeOffer(p, items) {   // descreve os itens oferecidos a partir da mochila autoritativa
    const inv = (p.eco && p.eco.inv) || [], out = [];
    for (const o of items) { const it = inv.find(x => x.u === o.id || x.id === o.id); if (!it || !TRADABLE(it) || (WI.MATS[it.id] && WI.MATS[it.id].bound)) return null; const n = it.stack ? clamp(o.n | 0, 1, it.n | 0) : 1; out.push(Object.assign({}, it, { n })); }
    return { out, gold: p.eco ? Math.floor(p.eco.gold) : 0 };
  }
  /* =============================== SOCKET =============================== */
  function drop(p) {
    if (!players.delete(p.id)) return;
    MMO.onLeave(p);
    if (byChar.get(p.charId) === p) byChar.delete(p.charId);
    if (byName.get(p.name.toLowerCase()) === p) byName.delete(p.name.toLowerCase());
    if (p.trade) cancelTrade(p.trade, 'O outro jogador saiu.');
    if (p.inst) { p.inst.players.delete(p); }
    if (p.party) leaveParty(p);
    if (p.guild) { const g = p.guild; const mm = g.mem.find(x => x.c === p.charId); if (mm) mm.l = p.lvl; saveGuild(g).catch(() => {}); rosterAll(g); }
    for (const m of worldMobs.values()) m.threat.delete(p.id);
    for (const o of players.values()) if (o.known.delete(p.id)) send(o, { t: 'l', id: p.id });
  }
  const nameOk = n => /^[A-Za-zÀ-ÿ0-9 ]{3,16}$/.test(n) && !/^\s|\s$|\s\s/.test(n);
  const find = n => byName.get(cleanText(n, 20).toLowerCase());

  function onSocket(ws, ip) {
    let p = null, authing = false, msgs = 0, mt = now();
    ws.on('message', async raw => {
      const t = now(); if (t - mt > 1000) { mt = t; msgs = 0; } if (++msgs > 60) return;
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (!p) {
        if (m.t !== 'hi' || authing) return; authing = true;
        try {
          const tk = verify(m.token); if (!tk) { ws.send({ t: 'err', k: 'auth' }); ws.close(1008); return; }
          const row = await DB.charById(+m.char); if (!row || row.account_id !== tk.a) { ws.send({ t: 'err', k: 'char' }); ws.close(1008); return; }
          const sv = await DB.kvGet('wow:' + row.id);
          const old = byChar.get(row.id); if (old) { send(old, { t: 'kick' }); old.ws.close(1000); drop(old); }
          const nm = (row.data && row.data.name) || '?';
          p = { id: seq++, ws, charId: row.id, accId: tk.a, name: nm, cls: (sv && sv.cls) || CLS_MAP[row.data.cls] || 'guerreiro', race: (sv && sv.race) || 'humano', look: (sv && sv.look) || {}, lvl: sv ? sv.lvl : 1,
            x: sv ? +sv.x || 0 : 0, z: sv ? +sv.z || 13 : 13, ry: 0, f: 0, ready: false, known: new Set(), mk: new Set(), budget: BURST, lt: t, tpAt: 0, cos: await cosOf(tk.a), bad: 0,
            inst: null, hpPct: 100, dead: false, party: null, guild: null, trade: null, hitB: 20, hitT: t, chatT: 0, healT: 0, fxT: 0, tpTo: null };
          if (Math.abs(p.x) > HALF || Math.abs(p.z) > HALF || Math.hypot(p.x - ARENA.x, p.z - ARENA.z) < ARENA.r + 6) { p.x = 0; p.z = 13; }   // não volta para dentro da masmorra ao reentrar
          players.set(p.id, p); byChar.set(row.id, p); byName.set(nm.toLowerCase(), p);
          const gn = await DB.kvGet('wowg:' + row.id);
          if (gn) { const g = await loadGuild(gn); if (g && g.mem.find(x => x.c === row.id)) { p.guild = g; const mm = g.mem.find(x => x.c === row.id); mm.l = p.lvl; } }
          ws.send({ t: 'hi', id: p.id, n: players.size, g: p.guild ? p.guild.n : null });
          try { await MMO.onHi(p); } catch (e) { console.error('[mmo hi]', e.message); }
          await pvpLoad(p); send(p, { t: 'pvs', on: 0, k: p.pk, d: p.pd }); try { p.gm = !!(await DB.kvGet('gm:' + p.accId)); } catch (e) { p.gm = false; } send(p, { t: 'gmst', on: p.gm ? 1 : 0 }); if (evCur) send(p, evPub());
          if (p.guild) { sendRoster(p); for (const o of guildOnline(p.guild)) if (o !== p) sys(o, '[Guilda] ' + p.name + ' entrou no jogo.'); }
        } catch (e) { console.error('[3d]', e.message); ws.close(1011); }
        return;
      }
      try { handle(p, m, t); } catch (e) { console.error('[3d msg]', e && e.stack || e); }
    });
    ws.on('close', () => { if (p) drop(p); });
  }

  function handle(p, m, t) {
    switch (m.t) {
      case 'm': return onMove(p, m);
      case 'iv': return MMO.act(p, m);
      case 'cos': return cosUpdate(p);
      case 'h': return onHit(p, m, t);
      case 'pvp': return setPvp(p, !!m.on);
      case 'ph': return onPvpHit(p, m, t);
      case 'fx': return onFx(p, m, t);
      case 'dead': pvpDeath(p); p.dead = true; for (const mo of (p.inst ? p.inst.mobs : worldMobs).values()) mo.threat.delete(p.id); if (p.trade) cancelTrade(p.trade, 'Você morreu.'); return;
      case 'heal': { if (t - p.healT < 1200 || !p.party) return; p.healT = t; const f = clamp(+m.f || 0, 0, .45); for (const id of p.party.members) { const o = players.get(id); if (o && o !== p && o.inst === p.inst && dist(o, p) < 40) send(o, { t: 'hl', f, n: p.name }); } return; }
      case 'dg': if (m.a === 'enter') enterInst(p); else if (m.a === 'leave') exitInst(p); return;
      case 'say': return onSay(p, m, t);
      case 'gmc': return onGmCmd(p, m);
      case 'pi': case 'pa': case 'pn': case 'pl': case 'pk': return onParty(p, m);
      case 'gc': case 'gi': case 'ga': case 'gn': case 'gl': case 'gk': case 'gp': case 'gd': case 'gm': case 'gr': case 'gx': return onGuild(p, m);
      case 'tr': case 'ta': case 'tn': case 'tu': case 'tl': case 'tk': case 'tx': return onTrade(p, m);
    }
  }
  async function cosUpdate(p) { try { p.cos = await cosOf(p.accId); const o = { t: 'u', id: p.id, cos: p.cos }; send(p, o); for (const q of players.values()) if (q.known.has(p.id)) send(q, o); } catch (e) {} }

  function onMove(p, m) {
    const x = +m.x, z = +m.z, ry = +m.r; if (!isFinite(x) || !isFinite(z) || !isFinite(ry)) return;
    const f = (m.f | 0) & 7, tn = now();
    if (p.tpTo) {   // teleporte feito pelo servidor (entrar/sair da masmorra): só aceita a posição nova
      if (m.tp && Math.hypot(x - p.tpTo.x, z - p.tpTo.z) < 9) { p.x = p.tpTo.x; p.z = p.tpTo.z; p.tpTo = null; p.budget = BURST; p.lt = tn; p.ready = true; p.dead = false; return; }
      if (tn - p.tpTo.t < 5000) return; p.tpTo = null;
    }
    p.budget = Math.min(BURST, p.budget + (tn - p.lt) / 1000 * (f & 1 ? SPEED.mount * MMO.mountSpd(p) : SPEED.walk) * REFILL); p.lt = tn;
    if (m.h != null) p.hpPct = clamp(m.h | 0, 0, 100);
    const lim = p.inst ? ARENA.r + 2 : HALF;
    let nx = clamp(x, -HALF, HALF), nz = clamp(z, -HALF, HALF);
    if (p.inst) { const dx = nx - ARENA.x, dz = nz - ARENA.z, d = Math.hypot(dx, dz); if (d > lim) { nx = ARENA.x + dx / d * lim; nz = ARENA.z + dz / d * lim; } }
    if (!p.ready || (m.tp && tn - p.tpAt > 8000)) {
      if (p.ready) p.tpAt = tn; p.budget = BURST;
      if (m.tp) { p.dead = false; if (p.inst && Math.hypot(nx - ARENA.x, nz - ARENA.z) > ARENA.r + 4) leaveInst(p); }
    } else {
      const d = Math.hypot(nx - p.x, nz - p.z);
      if (d > p.budget) { const k = p.budget / d; nx = p.x + (nx - p.x) * k; nz = p.z + (nz - p.z) * k; p.bad++; if (p.bad > 60 && p.bad % 60 === 1) log('[3d] velocidade suspeita', p.name); p.budget = 0; }
      else p.budget -= d;
    }
    p.x = nx; p.z = nz; p.ry = ry; p.f = f; p.ready = true;
    if (p.inst && Math.hypot(p.x - ARENA.x, p.z - ARENA.z) > ARENA.r + 5) leaveInst(p);
    if (p.trade && dist(p.trade.a, p.trade.b) > 30) cancelTrade(p.trade, 'Vocês se afastaram.');
  }

  function onHit(p, m, t) {
    if (p.dead || !p.ready) return;
    p.hitB = Math.min(24, p.hitB + (t - p.hitT) / 1000 * 9); p.hitT = t; if (p.hitB < 1) return; p.hitB -= 1;
    const mo = (p.inst ? p.inst.mobs : worldMobs).get(m.id | 0); if (!mo || mo.state === 'dead' || mo.inst !== p.inst) return;
    if (dist(p, mo) > 48) return;
    // ataque: o menor entre o que o navegador diz e o que o servidor calcula com o equipamento REAL do herói
    let mcap = 4;
    if (m.sk === 1) { const sk = MMO.subSk(p); if (!sk || (p.subT || 0) > t) return; p.subT = t + sk.cd * 1000 - 400; mcap = Math.max(4, sk.m); if (sk.k === 'single' && dist(p, mo) > (sk.rng || 6) + 4) return; }
    const cap = MMO.srvAtk(p), a = clamp(+m.a || 0, 1, cap), mult = clamp(+m.m || 0, .05, mcap), cc = clamp(+m.c || .07, .05, .75);
    const crit = Math.random() < cc, el = WD.ELEM[m.e] ? m.e : 'fis', rm = WD.resMul(mo.type, el); let d = a * mult * rnd(.9, 1.1) * (crit ? 1.8 : 1) * rm; d = Math.max(1, Math.round(d));
    damageMob(mo, d, p, crit, rm);
  }
  /* ---------- PvP: só entre quem ligou o modo PvP, fora da cidade e fora da masmorra. O dano vem do ataque do atacante (limitado pelo servidor) e a vítima aplica com a própria armadura ---------- */
  const PV_SAFE = 50, PV_MUL = .4;
  const inSafe = q => Math.hypot(q.x, q.z) < PV_SAFE;
  async function pvpLoad(p) { try { const o = await DB.kvGet('pvp:' + p.charId); p.pk = (o && o.k) | 0; p.pd = (o && o.d) | 0; } catch (e) { p.pk = p.pd = 0; } }
  const pvpSave = p => { DB.kvSet('pvp:' + p.charId, { k: p.pk | 0, d: p.pd | 0 }).catch(() => {}); };
  function setPvp(p, on) {
    const tn = now();
    if (on && p.lvl < (+process.env.PVP_MIN_LVL || 5)) return sys(p, 'PvP só a partir do nível 5.');
    if (on && inSafe(p)) { /* pode ligar na cidade; só não luta nela */ }
    if (!on && p.pvT && tn - p.pvT < 10000) return sys(p, 'Você está em combate PvP. Aguarde ' + Math.ceil((10000 - (tn - p.pvT)) / 1000) + 's para desligar.');
    p.pvp = !!on; const o = { t: 'u', id: p.id, pv: p.pvp ? 1 : 0 };
    for (const q of players.values()) if (q.known.has(p.id)) send(q, o);
    send(p, { t: 'pvs', on: p.pvp ? 1 : 0, k: p.pk, d: p.pd });
  }
  function onPvpHit(p, m, t) {
    if (p.dead || !p.ready || !p.pvp || p.inst) return;
    p.hitB = Math.min(24, p.hitB + (t - p.hitT) / 1000 * 9); p.hitT = t; if (p.hitB < 1) return; p.hitB -= 1;
    const q = players.get(m.id | 0); if (!q || q === p || !q.ready || q.dead || !q.pvp || q.inst) return;
    if (dist(p, q) > 48 || inSafe(p) || inSafe(q)) return;
    const cap = MMO.srvAtk(p), a = clamp(+m.a || 0, 1, cap), mult = clamp(+m.m || 0, .05, 4), cc = clamp(+m.c || .07, .05, .75);
    const crit = Math.random() < cc; let d = a * mult * rnd(.9, 1.1) * (crit ? 1.8 : 1) * PV_MUL; d = Math.max(1, Math.round(d));
    p.pvT = q.pvT = t; q.lastBy = { id: p.id, t };
    send(q, { t: 'pvd', d, by: p.id, n: p.name, c: crit ? 1 : 0 }); send(p, { t: 'pvh', id: q.id, d, c: crit ? 1 : 0 });
  }
  function pvpDeath(p) {
    const tn = now(), lb = p.lastBy; p.lastBy = null; if (!lb || tn - lb.t > 15000) return;
    const k = players.get(lb.id); if (!k || k === p) return;
    p.pd = (p.pd | 0) + 1; pvpSave(p); send(p, { t: 'pvs', on: p.pvp ? 1 : 0, k: p.pk, d: p.pd });
    if (k.lvKill && k.lvKill.id === p.id && tn - k.lvKill.t < 60000) return;   // não conta a mesma vítima várias vezes seguidas
    k.lvKill = { id: p.id, t: tn }; k.pk = (k.pk | 0) + 1; pvpSave(k); send(k, { t: 'pvs', on: k.pvp ? 1 : 0, k: k.pk, d: k.pd });
    bc([...players.values()], { t: 'ch', k: 's', x: '⚔️ ' + k.name + ' derrotou ' + p.name + ' no PvP! (' + k.pk + ' abates)' });
  }
  function onFx(p, m, t) {
    if (p.dead || t - p.fxT < 120) return; p.fxT = t;
    const mo = (p.inst ? p.inst.mobs : worldMobs).get(m.id | 0); if (!mo || mo.state === 'dead' || dist(p, mo) > 48) return;
    const s = clamp(+m.s || 0, 0, 6), tt = t / 1000;
    if (m.k === 'stun') { if (!mo.boss) mo.stunT = Math.max(mo.stunT, tt + Math.min(s, 3.2)); }
    else if (m.k === 'root') { if (!mo.boss) mo.rootT = Math.max(mo.rootT, tt + Math.min(s, 4.2)); }
    else if (m.k === 'slow') mo.slowT = Math.max(mo.slowT, tt + Math.min(s, 6));
    else if (m.k === 'burn') {   // dano contínuo: o servidor calcula com o ataque que o herói pode ter (limitado)
      const n = clamp(m.s | 0, 1, 8), iv = clamp(+m.iv || .5, .3, 1.2), a = clamp(+m.a || 0, 1, MMO.srvAtk(p));
      mo.dots.push({ n, iv, next: tt + iv, d: a * .45, by: p }); if (mo.dots.length > 6) mo.dots.shift();
    }
    if (mo.state === 'idle') engage(mo, p, 1);
  }

  /* ---------- chat de grupo/guilda/sussurro e comandos ---------- */
  /* Game Master: pode expulsar e silenciar (o painel completo de ADM é só da conta do dono) */
  function onGmCmd(p, m) {
    if (!p.gm) return sys(p, 'Só Game Masters usam esse comando.');
    const o = find(m.n); if (!o) return sys(p, 'Jogador não encontrado (precisa estar online).'); if (o === p) return;
    if (o.gm) return sys(p, 'Não dá para usar em outro Game Master.');
    if (m.c === 'kick') { send(o, { t: 'ch', k: 's', x: 'Você foi removido do jogo por um Game Master.' }); send(o, { t: 'kick' }); try { o.ws.close(1000); } catch (e) {} sys(p, o.name + ' foi expulso.'); }
    else if (m.c === 'mute') { const mins = clamp(+m.m || 5, 1, 1440); o.muteUntil = now() + mins * 60e3; send(o, { t: 'ch', k: 's', x: 'Você foi silenciado por ' + mins + ' min.' }); sys(p, o.name + ' silenciado por ' + mins + ' min.'); }
  }
  function onSay(p, m, t) {
    if (t - p.chatT < 600) return; p.chatT = t;
    if (p.muteUntil && p.muteUntil > t) return sys(p, 'Você está silenciado por um Game Master.');
    const x = cleanText(m.x, 90); if (!x) return;
    const nm = (p.gm ? '[GM] ' : '') + p.name;
    if (m.k === 'l') { const o = { t: 'ch', k: 'l', n: nm, x }; for (const q of players.values()) if (q.ready && q.inst === p.inst && dist(q, p) < 60) send(q, o); return; }   // local: quem está a até 60 m
    if (m.k === 'a' || m.k === 'i') { const o = { t: 'ch', k: m.k, n: nm, x }; if (m.k === 'i' && t - (p.infoT || 0) < 8000) return sys(p, 'Canal Informações: espere alguns segundos entre mensagens.'); if (m.k === 'i') p.infoT = t; bc([...players.values()], o); return; }   // global e informações: todos online
    if (m.k === 'p') { if (!p.party) return sys(p, 'Você não está em um grupo.'); bc(p.party.members.map(id => players.get(id)).filter(Boolean), { t: 'ch', k: 'p', n: (p.gm ? '[GM] ' : '') + p.name, x }); }
    else if (m.k === 'g') { if (!p.guild) return sys(p, 'Você não está em uma guilda.'); bc(guildOnline(p.guild), { t: 'ch', k: 'g', n: (p.gm ? '[GM] ' : '') + p.name, x }); }
    else if (m.k === 'w') { const o = find(m.n); if (!o || o === p) return sys(p, 'Jogador não encontrado (precisa estar online).'); send(o, { t: 'ch', k: 'w', n: (p.gm ? '[GM] ' : '') + p.name, x }); send(p, { t: 'ch', k: 'wo', n: o.name, x }); }
  }

  function onParty(p, m) {
    if (m.t === 'pi') {
      const o = find(m.n); if (!o) return sys(p, 'Jogador não encontrado (precisa estar online).'); if (o === p) return;
      if (o.party) return sys(p, o.name + ' já está em um grupo.');
      if (p.party && p.party.leader !== p.id) return sys(p, 'Só o líder convida.'); if (p.party && p.party.members.length >= 5) return sys(p, 'O grupo está cheio (5).');
      const id = mkInvite('p', p, o); send(o, { t: 'inv', id, k: 'p', from: p.name }); sys(p, 'Convite enviado para ' + o.name + '.');
    } else if (m.t === 'pa' || m.t === 'pn') {
      const iv = invites.get(m.id | 0); if (!iv || iv.kind !== 'p' || iv.to !== p.id || iv.exp < now()) return; invites.delete(iv.id);
      const from = players.get(iv.from); if (m.t === 'pn') { if (from) sys(from, p.name + ' recusou o convite.'); return; }
      if (!from || p.party) return;
      if (!from.party) { const pt = { id: iseq++, leader: from.id, members: [from.id], inst: null }; parties.set(pt.id, pt); from.party = pt; }
      if (from.party.members.length >= 5) return sys(p, 'O grupo está cheio.');
      from.party.members.push(p.id); p.party = from.party; for (const id of p.party.members) { const o = players.get(id); if (o && o !== p) sys(o, p.name + ' entrou no grupo.'); } sendParty(p.party);
    } else if (m.t === 'pl') leaveParty(p, 'Você saiu do grupo.');
    else if (m.t === 'pk') {
      const pt = p.party; if (!pt || pt.leader !== p.id) return; const o = players.get(m.id | 0); if (!o || o === p || o.party !== pt) return;
      leaveParty(o, 'Você foi removido do grupo.'); if (parties.has(pt.id)) sys(p, o.name + ' foi removido.');
    }
  }

  async function onGuild(p, m) {
    try {
      if (m.t === 'gr') return sendRoster(p);
      if (m.t === 'gc') {
        const n = cleanText(m.n, 16); if (p.guild) return sys(p, 'Você já tem guilda.'); if (!nameOk(n)) return sys(p, 'Nome da guilda: 3 a 16 letras ou números.'); if (p.lvl < 5) return sys(p, 'Criar guilda exige nível 5.');
        if (await loadGuild(n)) return sys(p, 'Esse nome de guilda já existe.');
        const g = { n, l: p.charId, mem: [{ c: p.charId, n: p.name, r: 'l', l: p.lvl }], motd: '', t: now() }; guilds.set(n.toLowerCase(), g); await saveGuild(g); await setGuild(p, g);
        sys(p, 'Guilda <' + n + '> criada!'); send(p, { t: 'gn', n }); return sendRoster(p);
      }
      const g = p.guild;
      if (m.t === 'gi') {
        if (!g) return sys(p, 'Você não está em uma guilda.'); const rk = rankOf(g, p.charId); if (rk !== 'l' && rk !== 'o') return sys(p, 'Só líder e oficiais convidam.');
        const o = find(m.n); if (!o) return sys(p, 'Jogador não encontrado (precisa estar online).'); if (o.guild) return sys(p, o.name + ' já está em uma guilda.'); if (g.mem.length >= 50) return sys(p, 'Guilda cheia (50).');
        const id = mkInvite('g', p, o, { g: g.n }); send(o, { t: 'inv', id, k: 'g', from: p.name, g: g.n }); return sys(p, 'Convite enviado para ' + o.name + '.');
      }
      if (m.t === 'ga' || m.t === 'gn') {
        const iv = invites.get(m.id | 0); if (!iv || iv.kind !== 'g' || iv.to !== p.id || iv.exp < now()) return; invites.delete(iv.id); if (m.t === 'gn' || p.guild) return;
        const gg = await loadGuild(iv.g); if (!gg || gg.mem.length >= 50) return; gg.mem.push({ c: p.charId, n: p.name, r: 'm', l: p.lvl }); await saveGuild(gg); await setGuild(p, gg);
        for (const o of guildOnline(gg)) sys(o, '[Guilda] ' + p.name + ' entrou na guilda.'); send(p, { t: 'gn', n: gg.n }); return rosterAll(gg);
      }
      if (!g) return sys(p, 'Você não está em uma guilda.');
      const rk = rankOf(g, p.charId);
      if (m.t === 'gl') {
        if (rk === 'l' && g.mem.length > 1) return sys(p, 'Passe a liderança (promova alguém a líder) ou desfaça a guilda.');
        g.mem = g.mem.filter(x => x.c !== p.charId); await setGuild(p, null); send(p, { t: 'gn', n: '' }); sendRoster(p);
        if (!g.mem.length) { guilds.delete(g.n.toLowerCase()); await DB.kvSet(gkey(g.n), null); } else { await saveGuild(g); for (const o of guildOnline(g)) sys(o, '[Guilda] ' + p.name + ' saiu da guilda.'); rosterAll(g); }
        return;
      }
      if (m.t === 'gk') {
        if (rk !== 'l' && rk !== 'o') return sys(p, 'Sem permissão.'); const c = m.c | 0, tgt = g.mem.find(x => x.c === c); if (!tgt || tgt.c === p.charId || tgt.r === 'l' || (tgt.r === 'o' && rk !== 'l')) return;
        g.mem = g.mem.filter(x => x.c !== c); await saveGuild(g); await DB.kvSet('wowg:' + c, null); const o = byChar.get(c); if (o) { o.guild = null; send(o, { t: 'gn', n: '' }); sys(o, 'Você foi removido da guilda.'); sendRoster(o); }
        for (const q of guildOnline(g)) sys(q, '[Guilda] ' + tgt.n + ' foi removido.'); return rosterAll(g);
      }
      if (m.t === 'gp' || m.t === 'gd') {   // promover / rebaixar (só o líder). Promover um oficial de novo passa a liderança.
        if (rk !== 'l') return sys(p, 'Só o líder.'); const tgt = g.mem.find(x => x.c === (m.c | 0)); if (!tgt || tgt.c === p.charId) return;
        if (m.t === 'gp') { if (tgt.r === 'm') tgt.r = 'o'; else if (tgt.r === 'o') { tgt.r = 'l'; g.l = tgt.c; g.mem.find(x => x.c === p.charId).r = 'o'; } } else if (tgt.r === 'o') tgt.r = 'm';
        await saveGuild(g); return rosterAll(g);
      }
      if (m.t === 'gm') { if (rk !== 'l' && rk !== 'o') return sys(p, 'Sem permissão.'); g.motd = cleanText(m.x, 120); await saveGuild(g); return rosterAll(g); }
      if (m.t === 'gx') { if (rk !== 'l') return sys(p, 'Só o líder desfaz a guilda.'); for (const mm of g.mem) { await DB.kvSet('wowg:' + mm.c, null); const o = byChar.get(mm.c); if (o) { o.guild = null; send(o, { t: 'gn', n: '' }); sys(o, 'A guilda foi desfeita.'); sendRoster(o); } } guilds.delete(g.n.toLowerCase()); await DB.kvSet(gkey(g.n), null); return; }
    } catch (e) { console.error('[3d guild]', e.message); }
  }

  async function onTrade(p, m) {
    try {
      if (m.t === 'tr') {
        const o = find(m.n); if (!o || o === p) return sys(p, 'Jogador não encontrado (precisa estar online).'); if (p.trade || o.trade) return sys(p, 'Alguém já está em uma troca.');
        if (o.inst !== p.inst || dist(o, p) > 15) return sys(p, 'Aproxime-se de ' + o.name + ' (até 15 m) para trocar.');
        const id = mkInvite('t', p, o); send(o, { t: 'inv', id, k: 't', from: p.name }); return sys(p, 'Pedido de troca enviado para ' + o.name + '.');
      }
      if (m.t === 'ta' || m.t === 'tn') {
        const iv = invites.get(m.id | 0); if (!iv || iv.kind !== 't' || iv.to !== p.id || iv.exp < now()) return; invites.delete(iv.id); const a = players.get(iv.from);
        if (m.t === 'tn') { if (a) sys(a, p.name + ' recusou a troca.'); return; }
        if (!a || a.trade || p.trade || a.inst !== p.inst || dist(a, p) > 18) return sys(p, 'Não foi possível iniciar a troca.');
        const tr = { id: tseq++, a, b: p, offer: { [a.id]: { items: [], gold: 0, desc: [] }, [p.id]: { items: [], gold: 0, desc: [] } }, lock: {}, ok: {}, busy: false };
        trades.set(tr.id, tr); a.trade = p.trade = tr; send(a, { t: 'to', id: tr.id, w: p.name }); send(p, { t: 'to', id: tr.id, w: a.name }); return;
      }
      const tr = p.trade; if (!tr || tr.id !== (m.id | 0) || tr.busy) return;
      const other = tr.a === p ? tr.b : tr.a;
      if (m.t === 'tx') return cancelTrade(tr, p.name + ' cancelou a troca.');
      if (m.t === 'tu') {   // atualização da minha oferta (itens por id + ouro); tudo é conferido com o último salvamento
        const items = (Array.isArray(m.items) ? m.items : []).slice(0, 6).map(o => ({ id: cleanText(o && o.id, 24), n: Math.max(1, Math.min(99, (o && o.n) | 0)) })).filter(o => o.id);
        if (new Set(items.map(o => o.id)).size !== items.length) return;
        const gold = Math.max(0, Math.min(1e9, Math.floor(+m.gold || 0))); const d = await describeOffer(p, items);
        if (!d) { send(p, { t: 'te', id: tr.id, x: 'Um item não foi encontrado no seu salvamento. Aguarde o salvamento e tente de novo.' }); return; }
        if (gold > d.gold) { send(p, { t: 'te', id: tr.id, x: 'Ouro insuficiente.' }); return; }
        const off = tr.offer[p.id], same = JSON.stringify(off.items) === JSON.stringify(items) && off.gold === gold;
        off.items = items; off.gold = gold; off.desc = d.out; if (same) { send(p, { t: 'tv', id: tr.id, items: d.out, gold, me: 1, same: 1 }); return; }
        tr.lock = {}; tr.ok = {};
        const view = { t: 'tv', id: tr.id, items: d.out, gold };
        send(other, view); send(p, Object.assign({ me: 1 }, view)); return;
      }
      if (m.t === 'tl') { tr.lock[p.id] = true; send(other, { t: 'tl', id: tr.id, by: p.id }); send(p, { t: 'tl', id: tr.id, me: 1 }); if (tr.lock[tr.a.id] && tr.lock[tr.b.id]) bc([tr.a, tr.b], { t: 'tc', id: tr.id }); return; }
      if (m.t === 'tk') { if (!(tr.lock[tr.a.id] && tr.lock[tr.b.id])) return; tr.ok[p.id] = true; send(other, { t: 'tk', id: tr.id }); if (tr.ok[tr.a.id] && tr.ok[tr.b.id]) await execTrade(tr); return; }
    } catch (e) { console.error('[3d trade]', e.message); }
  }

  /* =============================== LOOP ================================ */
  let tick = 0, lastT = now();
  setInterval(() => {
    const tn = now(), dt = Math.min(.25, (tn - lastT) / 1000); lastT = tn; const t = tn / 1000; tick++;
    if (!players.size) { for (const I of insts.values()) instTick(I, t); return; }
    // presença (outros jogadores) — só quem está na mesma instância
    const all = [...players.values()].filter(p => p.ready);
    for (const p of all) {
      const near = [];
      for (const o of all) { if (o === p || o.inst !== p.inst) continue; const dx = o.x - p.x, dz = o.z - p.z, d2 = dx * dx + dz * dz; if (d2 < NEAR2) near.push([d2, o]); }
      near.sort((a, b) => a[0] - b[0]); if (near.length > MAXN) near.length = MAXN;
      const set = new Set(), snap = [];
      for (const [, o] of near) { set.add(o.id); if (!p.known.has(o.id)) { send(p, { t: 'j', p: pub(o) }); p.known.add(o.id); } snap.push([o.id, q1(o.x), q1(o.z), q2(o.ry), o.f, o.hpPct == null ? 100 : o.hpPct]); }
      for (const id of [...p.known]) if (!set.has(id)) { p.known.delete(id); send(p, { t: 'l', id }); }
      if (snap.length) send(p, { t: 's', d: snap });
    }
    // monstros
    for (const m of worldMobs.values()) stepMob(m, dt, t);
    wtelTick(t);
    for (const I of insts.values()) { for (const m of I.mobs.values()) stepMob(m, dt, t); instTick(I, t); }
    if (tick % 2 === 0) {
      for (const p of all) {
        const src = p.inst ? p.inst.mobs : worldMobs, set = new Set(), upd = [];
        if (!p.mc) p.mc = new Map();
        for (const m of src.values()) {
          const dx = m.x - p.x, dz = m.z - p.z; if (dx * dx + dz * dz > MNEAR2) continue;
          set.add(m.id);
          if (!p.mk.has(m.id)) { send(p, { t: 'mj', m: mobPub(m) }); p.mk.add(m.id); p.mc.set(m.id, m.x + '|' + m.z + '|' + m.hp + '|' + m.state); continue; }
          const sig = m.x + '|' + m.z + '|' + m.hp + '|' + m.state;
          if (p.mc.get(m.id) !== sig) { p.mc.set(m.id, sig); upd.push([m.id, q1(m.x), q1(m.z), q2(m.ry), Math.ceil(m.hp), ST[m.state]]); }
        }
        for (const id of [...p.mk]) if (!set.has(id)) { p.mk.delete(id); p.mc.delete(id); send(p, { t: 'ml', id }); }
        if (upd.length) send(p, { t: 'mb', d: upd });
      }
    }
    if (tick % 15 === 0) {
      for (const pt of parties.values()) sendParty(pt);
      for (const [id, iv] of invites) if (iv.exp < tn) invites.delete(id);
    }
  }, TICK);

  return {
    onSocket, count: () => players.size, lock, MMO,
    ecoOnline(charId) { const p = byChar.get(charId); return p && p.eco ? p : null; },
    setGm(accId, on) { for (const p of players.values()) if (p.accId === accId) { p.gm = !!on; send(p, { t: 'gmst', on: on ? 1 : 0 }); const o = { t: 'u', id: p.id, gm: on ? 1 : 0 }; for (const q of players.values()) if (q.known.has(p.id)) send(q, o); } },
    admReload(charId) { const p = byChar.get(charId); if (p) { MMO.freeze(charId); send(p, { t: 'adm', k: 'reload' }); } },
    kick(name) { const p = find(name); if (!p) return false; send(p, { t: 'ch', k: 's', x: 'Você foi removido do jogo por um administrador.' }); send(p, { t: 'kick' }); try { p.ws.close(1000); } catch (e) {} return true; },
    mute(name, mins) { const p = find(name); if (!p) return false; p.muteUntil = now() + clamp(+mins || 5, 1, 1440) * 60e3; send(p, { t: 'ch', k: 's', x: 'Você foi silenciado por um administrador.' }); return true; },
    announce(text) { bc([...players.values()], { t: 'ch', k: 's', x: '📢 ' + cleanText(text, 120) }); },
    isOnline(charId) { return byChar.has(charId); },
    _evStart: id => { if (!process.env.WOW_EV_DEBUG) return false; const d = EVDEF.find(x => x.id === id); if (!d) return false; if (evCur) evEnd(false); evStart(d); return true; }, _evCount: () => EVDEF.length,
    setLevel(charId, lvl) { const p = byChar.get(charId); if (p && lvl > 0 && lvl <= WD.LV_CAP) { p.lvl = lvl | 0; const o = { t: 'u', id: p.id, l: p.lvl }; for (const q2 of players.values()) if (q2.known.has(p.id)) send(q2, o); } },
    _players: players, _world: worldMobs, _insts: insts, _guilds: guilds
  };
};
