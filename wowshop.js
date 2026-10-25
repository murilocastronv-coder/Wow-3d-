'use strict';
/* Loja do jogo 3D (Reinos de Valdor): 400 itens SÓ COSMÉTICOS (nenhum dá força, XP ou ouro).
   Os preços ficam aqui no servidor (em centavos de EURO, a mesma moeda da loja do 2D) — o navegador nunca decide o preço.
   Para mudar um preço: edite a tabela PRICE abaixo. Cada item tem um id fixo (m001, p001...), então mudar preço não perde compras antigas. */

const COLORS = [   // [pt, en, es, fr, hex]
  ['Carmesim', 'Crimson', 'Carmesí', 'Cramoisi', 0xb01830], ['Esmeralda', 'Emerald', 'Esmeralda', 'Émeraude', 0x1f9d55],
  ['Safira', 'Sapphire', 'Zafiro', 'Saphir', 0x2456c8], ['Ametista', 'Amethyst', 'Amatista', 'Améthyste', 0x8a3fc8],
  ['Âmbar', 'Amber', 'Ámbar', 'Ambre', 0xe0922a], ['Ônix', 'Onyx', 'Ónix', 'Onyx', 0x23232e],
  ['Marfim', 'Ivory', 'Marfil', 'Ivoire', 0xe8e0c8], ['Cobre', 'Copper', 'Cobre', 'Cuivre', 0xb8683a],
  ['Rubi', 'Ruby', 'Rubí', 'Rubis', 0xd0204a], ['Turquesa', 'Turquoise', 'Turquesa', 'Turquoise', 0x22b8b0],
  ['Ouro', 'Gold', 'Oro', 'Or', 0xe8c040], ['Prata', 'Silver', 'Plata', 'Argent', 0xc0c8d0],
  ['Rosa', 'Rose', 'Rosa', 'Rose', 0xe06a9a], ['Gelo', 'Frost', 'Escarcha', 'Givre', 0x8ad8f0],
  ['Veneno', 'Venom', 'Veneno', 'Venin', 0x8ad020], ['Sombra', 'Shadow', 'Sombra', 'Ombre', 0x4a3a7a],
  ['Aurora', 'Aurora', 'Aurora', 'Aurore', 0x70ffd0], ['Crepúsculo', 'Dusk', 'Crepúsculo', 'Crépuscule', 0xff7a4a],
];
// preço em centavos de euro por [categoria][raridade 1..4]
const PRICE = {
  mount: [0, 499, 799, 1199, 1799], pet: [0, 199, 299, 449, 699], xmog: [0, 399, 599, 799, 999],
  aura: [0, 199, 299, 399, 549], wing: [0, 299, 449, 649, 899], title: [0, 99, 129, 149, 199],
};
const CATS = ['mount', 'pet', 'xmog', 'wing', 'aura', 'title'];
const T = (pt, en, es, fr) => [pt, en, es, fr];
const nm = (kind, noun, ci) => {   // junta substantivo + cor nos 4 idiomas (en: cor antes)
  const c = COLORS[ci];
  return [noun[0] + ' ' + c[0], c[1] + ' ' + noun[1], noun[2] + ' ' + c[2], noun[3] + ' ' + c[3]];
};

const ITEMS = [];
const add = (cat, rar, n, a, ico) => { const k = cat[0] + String(ITEMS.filter(x => x.cat === cat).length + 1).padStart(3, '0'); ITEMS.push({ id: k, cat, rar, cents: PRICE[cat][rar], n, a, ico }); };

/* ---- montarias (80) ---- a: [espécie, cor, traço] */
{
  const hs = [[null, 1, T('Corcel', 'Steed', 'Corcel', 'Destrier')], ['horn', 2, T('Unicórnio', 'Unicorn', 'Unicornio', 'Licorne')], ['wings', 2, T('Pégaso', 'Pegasus', 'Pegaso', 'Pégase')], ['flame', 3, T('Corcel Espectral', 'Spectral Steed', 'Corcel Espectral', 'Destrier Spectral')]];
  for (const [tr, rar, noun] of hs) for (let c = 0; c < 10; c++) add('mount', rar, nm('m', noun, c), ['horse', COLORS[c][4], tr], '🐴');
  for (const [tr, rar, noun] of [[null, 1, T('Lobo', 'Wolf', 'Lobo', 'Loup')], ['flame', 3, T('Lobo Infernal', 'Hellwolf', 'Lobo Infernal', 'Loup Infernal')]]) for (let c = 0; c < 8; c++) add('mount', rar, nm('m', noun, c), ['wolf', COLORS[c][4], tr], '🐺');
  for (const [tr, rar, noun] of [[null, 1, T('Javali', 'Boar', 'Jabalí', 'Sanglier')], ['horn', 2, T('Javali Gigante', 'Giant Boar', 'Jabalí Gigante', 'Sanglier Géant')]]) for (let c = 0; c < 8; c++) add('mount', rar, nm('m', noun, c), ['boar', COLORS[c][4], tr], '🐗');
  for (let c = 0; c < 8; c++) add('mount', 4, nm('m', T('Corcel Fênix', 'Phoenix Steed', 'Corcel Fénix', 'Destrier Phénix'), c), ['horse', COLORS[c + 8][4], 'phoenix'], '🔥');
}
/* ---- mascotes (70) ---- a: [forma, cor, cor2] */
{
  const sh = [['slime', 1, T('Slime', 'Slime', 'Slime', 'Slime'), '🟢'], ['cat', 1, T('Gatinho', 'Kitten', 'Gatito', 'Chaton'), '🐱'], ['dog', 1, T('Cãozinho', 'Puppy', 'Cachorrito', 'Chiot'), '🐶'],
    ['bunny', 1, T('Coelhinho', 'Bunny', 'Conejito', 'Lapin'), '🐰'], ['owl', 2, T('Coruja', 'Owl', 'Búho', 'Hibou'), '🦉'], ['fox', 2, T('Raposinha', 'Fox Kit', 'Zorrito', 'Renardeau'), '🦊'],
    ['shroom', 2, T('Cogumelinho', 'Mushling', 'Setita', 'Champignon'), '🍄'], ['golem', 3, T('Mini Golem', 'Mini Golem', 'Mini Gólem', 'Mini Golem'), '🗿'],
    ['wisp', 3, T('Fada Luminosa', 'Wisp', 'Fuego Fatuo', 'Feu Follet'), '✨'], ['whelp', 4, T('Dragãozinho', 'Drake Whelp', 'Dragoncito', 'Dragonneau'), '🐲']];
  sh.forEach(([f, rar, noun, ico], i) => { for (let k = 0; k < 7; k++) { const c = (i * 3 + k * 2) % 18; add('pet', rar, nm('p', noun, c), [f, COLORS[c][4], COLORS[(c + 5) % 18][4]], ico); } });
}
/* ---- aparências / transmog (90) ---- a: [cor do tecido, estilo] */
{
  const st = [[1, T('Manto', 'Garb', 'Atuendo', 'Tenue')], [2, T('Cavaleiro', 'Knight', 'Caballero', 'Chevalier')], [2, T('Elmo de Chifres', 'Horned Helm', 'Yelmo Astado', 'Heaume à Cornes')],
    [3, T('Realeza', 'Royal', 'Realeza', 'Royal')], [4, T('Arcano', 'Arcane', 'Arcano', 'Arcane')]];
  st.forEach(([rar, noun], s) => { for (let c = 0; c < 18; c++) add('xmog', rar, nm('x', noun, c), [COLORS[c][4], s], '👘'); });
}
/* ---- capas e asas (60) ---- a: [estilo, cor, cor2] */
{
  const st = [[1, T('Capa', 'Cape', 'Capa', 'Cape'), 'cape'], [3, T('Asas de Anjo', 'Angel Wings', 'Alas de Ángel', 'Ailes d’Ange'), 'angel'], [2, T('Asas de Morcego', 'Bat Wings', 'Alas de Murciélago', 'Ailes de Chauve-souris'), 'bat'],
    [4, T('Asas de Dragão', 'Dragon Wings', 'Alas de Dragón', 'Ailes de Dragon'), 'dragon'], [2, T('Asas de Borboleta', 'Butterfly Wings', 'Alas de Mariposa', 'Ailes de Papillon'), 'fly'], [3, T('Asas de Cristal', 'Crystal Wings', 'Alas de Cristal', 'Ailes de Cristal'), 'crystal']];
  st.forEach(([rar, noun, key], s) => { for (let c = 0; c < 10; c++) add('wing', rar, nm('w', noun, c), [key, COLORS[c][4], COLORS[(c + 6) % 18][4]], s === 0 ? '🧣' : '🪽'); });
}
/* ---- auras (50) ---- a: [estilo, cor] */
{
  const st = [[1, T('Aura em Anel', 'Ring Aura', 'Aura en Anillo', 'Aura en Anneau'), 'ring'], [2, T('Aura Orbital', 'Orbit Aura', 'Aura Orbital', 'Aura Orbitale'), 'orbit'], [2, T('Coluna de Luz', 'Light Pillar', 'Columna de Luz', 'Colonne de Lumière'), 'pillar'],
    [3, T('Aura Faiscante', 'Sparkle Aura', 'Aura Chispeante', 'Aura Scintillante'), 'spark'], [4, T('Aura Flamejante', 'Blaze Aura', 'Aura Llameante', 'Aura Flamboyante'), 'flame']];
  st.forEach(([rar, noun, key], s) => { for (let c = 0; c < 10; c++) add('aura', rar, nm('a', noun, (c + s * 2) % 18), [key, COLORS[(c + s * 2) % 18][4]], '🔆'); });
}
/* ---- títulos (50) ---- a: [cor do texto] */
{
  const L = [
    ['o Destemido|the Fearless|el Intrépido|l’Intrépide', 1], ['Caçador de Goblins|Goblin Hunter|Cazador de Goblins|Chasseur de Gobelins', 1], ['Guardião de Valdor|Warden of Valdor|Guardián de Valdor|Gardien de Valdor', 2],
    ['Lenda Viva|Living Legend|Leyenda Viva|Légende Vivante', 3], ['o Imortal|the Undying|el Inmortal|l’Immortel', 3], ['Domador de Feras|Beastmaster|Domador de Bestias|Maître des Bêtes', 2],
    ['Rei da Arena|Arena King|Rey de la Arena|Roi de l’Arène', 3], ['Flagelo dos Mortos|Scourge of the Dead|Azote de los Muertos|Fléau des Morts', 2], ['Mestre das Chamas|Flamebinder|Señor de las Llamas|Maître des Flammes', 3],
    ['Andarilho|the Wanderer|el Errante|le Vagabond', 1], ['Sábio de Valdor|Sage of Valdor|Sabio de Valdor|Sage de Valdor', 2], ['o Colecionador|the Collector|el Coleccionista|le Collectionneur', 2],
    ['Senhor dos Reinos|Lord of the Realms|Señor de los Reinos|Seigneur des Royaumes', 4], ['Lâmina Silenciosa|Silent Blade|Hoja Silenciosa|Lame Silencieuse', 2], ['Tempestade Viva|Living Storm|Tormenta Viva|Tempête Vivante', 3],
    ['Coração de Leão|Lionheart|Corazón de León|Cœur de Lion', 2], ['o Implacável|the Relentless|el Implacable|l’Implacable', 2], ['Sombra da Noite|Nightshade|Sombra de la Noche|Ombre de la Nuit', 2],
    ['Luz da Aurora|Dawnbringer|Portador del Alba|Porteur d’Aube', 3], ['o Abençoado|the Blessed|el Bendito|le Béni', 1], ['Quebra-Escudos|Shieldbreaker|Rompescudos|Brise-Boucliers', 1],
    ['Matador de Dragões|Dragonslayer|Mata Dragones|Tueur de Dragons', 4], ['o Magnífico|the Magnificent|el Magnífico|le Magnifique', 3], ['Herói de Valdor|Hero of Valdor|Héroe de Valdor|Héros de Valdor', 2],
    ['Campeão Eterno|Eternal Champion|Campeón Eterno|Champion Éternel', 4], ['o Astuto|the Cunning|el Astuto|le Rusé', 1], ['Mão de Ouro|Goldenhand|Mano de Oro|Main d’Or', 2],
    ['Olho de Águia|Eagle Eye|Ojo de Águila|Œil d’Aigle', 2], ['o Valente|the Valiant|el Valiente|le Vaillant', 1], ['Ceifador|the Reaper|el Segador|le Faucheur', 3],
    ['Ás da Guilda|Guild Ace|As del Gremio|As de la Guilde', 2], ['Fundador|the Founder|el Fundador|le Fondateur', 4], ['Conquistador|Conqueror|Conquistador|Conquérant', 3], ['o Venerado|the Revered|el Venerado|le Vénéré', 2],
  ];
  L.forEach(([s, rar], i) => { const n = s.split('|'); add('title', rar, n, [COLORS[[10, 11, 14, 13, 4, 16, 12, 0, 9, 2][i % 10]][4]], '🏷️'); });
  for (let c = 0; c < 16; c++) add('title', 2, [['Mestre ', 'Master ', 'Maestro ', 'Maître '][0] + COLORS[c][0], 'Master ' + COLORS[c][1], 'Maestro ' + COLORS[c][2], 'Maître ' + COLORS[c][3]], [COLORS[c][4]], '🏷️');
}

const BY_ID = {}; for (const it of ITEMS) BY_ID[it.id] = it;
const slotOf = it => it.cat;   // mount | pet | xmog | wing | aura | title (1 equipado por categoria)
module.exports = { ITEMS, BY_ID, CATS, slotOf, COLORS };
