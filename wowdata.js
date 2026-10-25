/* Dados do jogo compartilhados: classes, raças e monstros (navegador e servidor leem os mesmos números) */
(function(root){
const CLASSES={
  guerreiro:{n:'Guerreiro',em:'🛡️',res:'Fúria',rt:'rage',rc:'#c8372d',hp:[120,20],atk:[8,2.1],ar:[14,3],rng:4.2,swing:2.2,role:'tank',desc:'Combate corpo a corpo. Ganha Fúria ao bater e ao apanhar.'},
  paladino:{n:'Paladino',em:'🔨',res:'Mana',rt:'mana',rc:'#e8c860',hp:[115,19],atk:[7,1.9],ar:[13,2.8],rng:4.2,swing:2.4,role:'tank',desc:'Guerreiro sagrado: golpes de luz, cura a si e aos aliados.'},
  mago:{n:'Mago',em:'🔮',res:'Mana',rt:'mana',rc:'#3d7be0',hp:[72,11],atk:[9,2.5],ar:[4,1.2],rng:24,swing:2.8,role:'dps',desc:'Magias à distância: bola de fogo, gelo e escudo arcano.'},
  bruxo:{n:'Bruxo',em:'💀',res:'Mana',rt:'mana',rc:'#9a52d8',hp:[78,12],atk:[9,2.45],ar:[5,1.3],rng:24,swing:2.8,role:'dps',desc:'Maldições e dano ao longo do tempo. Drena a vida dos inimigos.'},
  sacerdote:{n:'Sacerdote',em:'✨',res:'Mana',rt:'mana',rc:'#f2f2ff',hp:[80,12.5],atk:[7,2.0],ar:[5,1.4],rng:24,swing:2.8,role:'healer',desc:'Mestre da cura e da luz sagrada. Protege os aliados.'},
  cacador:{n:'Caçador',em:'🏹',res:'Energia',rt:'energy',rc:'#d6b13a',hp:[92,14],atk:[9,2.3],ar:[8,2],rng:28,swing:2.4,role:'dps',desc:'Atirador ágil. Tiros certeiros, múltiplos e atordoantes.'},
  ladino:{n:'Ladino',em:'🗡️',res:'Energia',rt:'energy',rc:'#e6d44a',hp:[88,13.5],atk:[9,2.4],ar:[7,1.8],rng:4,swing:1.6,role:'dps',desc:'Assassino veloz. Golpes críticos, veneno e fuga.'},
  druida:{n:'Druida',em:'🌿',res:'Mana',rt:'mana',rc:'#48b848',hp:[96,15],atk:[8,2.1],ar:[8,2],rng:22,swing:2.6,role:'healer',desc:'Fúria da natureza: raios, enraizamento e cura ao longo do tempo.'},
  xama:{n:'Xamã',em:'⚡',res:'Mana',rt:'mana',rc:'#2a8ad8',hp:[95,15],atk:[8.5,2.2],ar:[8,2],rng:22,swing:2.6,role:'healer',desc:'Raios, terremotos e totens de cura dos espíritos.'},
  cavaleiro:{n:'Cavaleiro da Morte',em:'☠️',res:'Poder Rúnico',rt:'rage',rc:'#4ab8e8',hp:[125,20],atk:[8.5,2.15],ar:[14,3],rng:4.2,swing:2.3,role:'tank',desc:'Armadura de gelo e runas. Drena vida e congela os inimigos.'},
  monge:{n:'Monge',em:'👊',res:'Energia',rt:'energy',rc:'#e8a040',hp:[105,16.5],atk:[8.5,2.2],ar:[9,2.2],rng:4,swing:1.7,role:'dps',desc:'Artes marciais: sequências de golpes, chutes e meditação.'},
  demonio:{n:'Caçador de Demônios',em:'😈',res:'Fúria',rt:'rage',rc:'#3ad89a',hp:[100,16],atk:[9.5,2.35],ar:[8,2],rng:4.2,swing:1.8,role:'dps',desc:'Poder demoníaco: lâminas gêmeas, saltos e metamorfose.'}
};
/* b = bônus racial: atk/hp/ar/xp/gold/spd/crit/dr (fração) e reg (% de vida por segundo fora de combate) */
const RACES={
  humano:{n:'Humano',sc:1,b:{xp:.05},bd:'+5% de experiência (Diplomacia)',skins:[0xe0b890,0xf0d0b0,0xd9ac84,0xc08a62,0x8a5a3a]},
  altoelfo:{n:'Alto Elfo',sc:1.06,b:{crit:.03,atk:.01},bd:'+3% de crítico (Afinidade Arcana)',skins:[0xf0dcc0,0xf4e4cc,0xe8d0a8,0xe0c898,0xd8c0a0]},
  elfonegro:{n:'Elfo Sombrio',sc:1.04,b:{atk:.04},bd:'+4% de dano (Véu da Noite)',skins:[0x7a68a8,0x6a5898,0x8a78b8,0x5a4a88,0x9888c0]},
  anao:{n:'Anão',sc:.84,b:{ar:.08,hp:.03},bd:'+8% de armadura, +3% de vida (Pele de Pedra)',skins:[0xd8a880,0xe0b890,0xc89a70,0xb08060,0xe8c8a8]},
  orc:{n:'Orc',sc:1.12,b:{atk:.05},bd:'+5% de dano (Fúria Sangrenta)',skins:[0x5a9a48,0x6aaa50,0x4a8a3c,0x7aa858,0x3a7a38]},
  troll:{n:'Troll',sc:1.18,b:{hp:.04,reg:1},bd:'+4% de vida e regeneração rápida (Regeneração)',skins:[0x4a78b8,0x3a68a8,0x5a88c8,0x6a58a8,0x3a8898]},
  morto:{n:'Renegado',sc:1,b:{dr:.05},bd:'-5% de dano recebido (Vontade dos Renegados)',skins:[0x9ab0a0,0x8aa090,0xa8b8a0,0x80987c,0xb0b8a8]},
  gnomo:{n:'Gnomo',sc:.7,b:{crit:.02,xp:.03},bd:'+2% de crítico, +3% de experiência (Engenhoso)',skins:[0xf0c8a8,0xe8b898,0xf4d4b8,0xd8a888,0xf8e0c8]},
  goblin:{n:'Goblin',sc:.78,b:{spd:.06,gold:.1},bd:'+6% de velocidade, +10% de ouro (Faro para Lucro)',skins:[0x5fae48,0x6fbe58,0x4f9e40,0x7ac860,0x8aa838]},
  bestial:{n:'Bestial',sc:1.06,b:{spd:.04,crit:.02},bd:'+4% de velocidade, +2% de crítico (Instinto Selvagem)',skins:[0xc8904a,0xa87038,0xd8a860,0x8a6a48,0xe8d8c0]},
  draconico:{n:'Dracônico',sc:1.1,b:{atk:.03,ar:.05},bd:'+3% de dano, +5% de armadura (Escamas)',skins:[0xb83a2a,0x2a8a9a,0xc8a830,0x4a8a3a,0x7a3aa8]}
};
const HAIRCOL=[0x2a1a0a,0x5a3a1a,0x8a6a3a,0xd8c070,0xc8c8c8,0xa83a2a,0x2a4a8a,0x7a3aa8];
const HAIRSTY=['short','long','pony','none'];
/* monstros do mundo aberto e da masmorra */
const MT={
  wolf:{n:'Lobo Cinzento',lv:[1,3],hp:34,dmg:4.5,spd:5.4,agg:12,sc:1,zone:'forest',cnt:15},
  boar:{n:'Javali Selvagem',lv:[2,4],hp:46,dmg:5.5,spd:4.6,agg:7,sc:1,zone:'forest',cnt:12,drop:'tusk'},
  goblin:{n:'Goblin Saqueador',lv:[4,6],hp:58,dmg:7,spd:5,agg:14,sc:.82,zone:'goblin',cnt:18},
  skeleton:{n:'Esqueleto Errante',lv:[6,9],hp:78,dmg:9,spd:4.8,agg:13,sc:1,zone:'grave',cnt:18},
  boss:{n:'Rei Grumsh',lv:[8,8],hp:150,dmg:9,spd:4.6,agg:20,sc:1.7,zone:'goblin',cnt:0,boss:1},
  scorpion:{n:'Escorpião Escarlate',lv:[10,12],hp:70,dmg:11,spd:5,agg:12,sc:1,zone:'desert',cnt:16},
  mummy:{n:'Múmia do Deserto',lv:[11,14],hp:95,dmg:13,spd:4.4,agg:13,sc:1.05,zone:'desert',cnt:14},
  frostwolf:{n:'Lobo Gélido',lv:[14,16],hp:85,dmg:14,spd:6,agg:14,sc:1.15,zone:'snow',cnt:16},
  yeti:{n:'Yeti das Neves',lv:[16,18],hp:150,dmg:18,spd:4.2,agg:11,sc:1.55,zone:'snow',cnt:10},
  toad:{n:'Sapo do Brejo',lv:[18,20],hp:120,dmg:17,spd:4.6,agg:10,sc:1.25,zone:'swamp',cnt:14},
  hag:{n:'Bruxa do Brejo',lv:[20,22],hp:140,dmg:21,spd:4.8,agg:14,sc:1,zone:'swamp',cnt:12,rng:16},
  cguard:{n:'Guarda Ossudo',lv:[22,22],hp:110,dmg:19,spd:5,agg:16,sc:1.1,zone:'',cnt:0,dun:1},
  necro:{n:'Necromante',lv:[22,22],hp:90,dmg:24,spd:4.4,agg:20,sc:1,zone:'',cnt:0,dun:1,rng:18},
  morvak:{n:'Morvak, o Lorde Lich',lv:[24,24],hp:900,dmg:26,spd:4.2,agg:30,sc:1.9,zone:'',cnt:0,boss:1,dun:1}
};
const LV_CAP=2000;
const D={CLASSES,RACES,HAIRCOL,HAIRSTY,MT,LV_CAP,
  /* escala de monstros (igual ao jogo): sobe junto com o herói */
  mobLvl:(base,pl)=>Math.max(base,pl+base-5),
  mobHp:(d,lvl)=>Math.round(d.hp*(.55+lvl*.5)),
  mobDmg:(d,lvl)=>d.dmg*(.7+lvl*.28),
  /* teto de ataque que o servidor aceita de um herói (classe + nível + equipamento máximo possível + bônus) */
  atkCap:(cls,lvl)=>{const c=CLASSES[cls]||CLASSES.guerreiro;return(c.atk[0]+c.atk[1]*(lvl-1)+3+6.6*lvl)*1.7}
};
if(typeof module!=='undefined'&&module.exports)module.exports=D;else root.WD=D;
})(typeof window!=='undefined'?window:globalThis);
