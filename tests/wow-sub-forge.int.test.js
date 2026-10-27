'use strict';
/* Integração: Subclasse (nível 500, 5 etapas, NPC, materiais, combate, forja, despertar, árvore, habilidade em combate)
   e Ferreiro (forja mítica e melhoria +N). Tudo validado pelo servidor real. Uso: node tests/wow-sub-forge.int.test.js */
const { mk } = require('./lib');
const T = mk(), ok = T.ok, sleep = T.sleep;
const MESTRE = [6, -25], FERREIRO = [15, 16];
(async () => {
  try {
    await T.start();
    const adm = await T.admin(), tok = await T.account('sub'), h = await T.hero(tok, 'Arcano' + Math.floor(Math.random() * 999), 'mago');
    const A = (a, o) => T.api('adm', Object.assign({ token: adm, a, name: h.name }, o || {}));
    console.log('▶ requisitos da subclasse');
    await A('level', { lvl: 499 }); await A('gold', { n: 10000000 });
    for (const [id, n] of [['mat_cristal', 30], ['mat_nucleo', 20], ['mat_frag', 10]]) await A('givemat', { id, n });
    let C = T.client(tok, h.id); await C.open(); await C.wait(m => m.t === 'eco' && m.first); C.move(MESTRE[0], MESTRE[1]); await sleep(300);
    let r = await C.act({ a: 'sub', k: 'start' }); ok(r.t === 'ie' && /500/.test(r.x), 'nível 499 não inicia: ' + r.x); C.close(); await sleep(300);
    await A('level', { lvl: 500 });
    C = T.client(tok, h.id); await C.open(); let e = await C.wait(m => m.t === 'eco' && m.first); C.move(MESTRE[0], MESTRE[1]); await sleep(300);
    r = await C.act({ a: 'sub', k: 'deliver' }); ok(r.t === 'ie', 'não pula etapas (entregar antes de aceitar): ' + r.x);
    const g0 = e.g; r = await C.act({ a: 'sub', k: 'start' }); ok(r.t === 'eco' && r.g === g0 - 500000 && r.sub.step === 2, 'Missão 1: pagou 500.000 de ouro (' + g0 + ' → ' + r.g + ')');
    r = await C.act({ a: 'sub', k: 'start' }); ok(r.t === 'ie', 'não paga duas vezes: ' + r.x);
    r = await C.act({ a: 'sub', k: 'deliver' }); ok(r.t === 'eco' && r.sub.step === 3 && !r.inv.some(x => /mat_(cristal|nucleo|frag)/.test(x.id)), 'Missão 2: entregou 30 Cristais, 20 Núcleos e 10 Fragmentos (consumidos)');
    r = await C.act({ a: 'sub', k: 'deliver' }); ok(r.t === 'ie', 'não entrega de novo: ' + r.x);
    console.log('▶ Provação de Combate (abates registrados pelo servidor)');
    await T.api('adm', { token: adm, a: 'mmoset', sub: { combat: { elites: 0, guards: 1, boss: 0 } } });   // reduz só para o teste
    C.close(); await sleep(300); C = T.client(tok, h.id); await C.open(); await C.wait(m => m.t === 'eco' && m.first);
    C.move(-205, 108); await sleep(500); let sent = null; try { sent = (await C.wait(m => m.t === 'mj' && m.m.ty === 'sentinela' && m.m.st !== 3, 6000)).m; } catch (er) {}
    ok(!!sent, 'Sentinela do Santuário encontrada');
    if (sent) { for (let i = 0; i < 12; i++) { C.move(sent.x + 1.5, sent.z, 0); await sleep(150); }
      let done = null; for (let i = 0; i < 120 && !done; i++) { C.send({ t: 'h', id: sent.id, m: 4, a: 1e9, c: .5 }); await sleep(120); const mb = C.msgs.filter(m => m.t === 'mb').flatMap(m => m.d).filter(d => d[0] === sent.id).pop(); if (mb) C.move(mb[1] + 1.4, mb[2], 0); done = C.msgs.find(m => m.t === 'subn'); }
      ok(!!done, 'servidor concluiu a Provação de Combate: ' + (done && done.x));
      await sleep(400); ok(C.eco.sub.step === 4 && C.eco.inv.some(x => x.id === 'sub_selo'), 'recebeu o Selo de Aprovação do Mestre'); }
    console.log('▶ Forja da Especialização e Despertar');
    C.close(); await sleep(300); C = T.client(tok, h.id); await C.open(); e = await C.wait(m => m.t === 'eco' && m.first); C.move(MESTRE[0], MESTRE[1]); await sleep(300);
    const sel = e.inv.find(x => x.id === 'sub_selo'); if (sel) { r = await C.act({ a: 'dr', u: sel.u }); ok(r.t === 'ie', 'Selo vinculado não pode ser largado: ' + r.x); }
    r = await C.act({ a: 'sub', k: 'core' }); ok(r.t === 'eco' && r.inv.some(x => x.id === 'sub_nucleo') && !r.inv.some(x => x.id === 'sub_selo'), 'Missão 4: trocou o Selo pelo Núcleo de Especialização');
    const g1 = r.g; r = await C.act({ a: 'sub', k: 'forge' }); ok(r.t === 'eco' && r.g === g1 - 2000000 && r.inv.some(x => x.id === 'sub_insig'), 'Missão 4: forja ativada (−2.000.000 de ouro) → Insígnia');
    r = await C.act({ a: 'sub', k: 'awaken', id: 'berserker' }); ok(r.t === 'ie', 'subclasse incompatível recusada (mago → Berserker): ' + r.x);
    const g2 = C.eco.g; r = await C.act({ a: 'sub', k: 'awaken', id: 'arquimago' }); ok(r.t === 'eco' && r.sub.id === 'arquimago' && r.g === g2 - 5000000 && !r.inv.some(x => x.id === 'sub_insig'), 'Missão 5: Arquimago despertado (−5.000.000)');
    r = await C.act({ a: 'sub', k: 'awaken', id: 'arquimago' }); ok(r.t === 'ie', 'não desperta duas vezes');
    r = await C.act({ a: 'sub', k: 'learn', n: 'p_atk' }); ok(r.t === 'ie', 'árvore respeita o nível da subclasse: ' + r.x);
    r = await C.act({ a: 'sub', k: 'learn', n: 'a1' }); ok(r.t === 'eco' && r.sub.tree.a1 === 2 && r.sub.pts === 0, 'aprendeu Domínio da Técnica (ponto gasto)');
    r = await C.act({ a: 'sub', k: 'learn', n: 'a1' }); ok(r.t === 'ie', 'sem pontos: ' + r.x);
    console.log('▶ habilidade da subclasse no combate real');
    C.close(); await sleep(300); C = T.client(tok, h.id); await C.open(); await C.wait(m => m.t === 'eco' && m.first); C.move(105, 18); await sleep(500);
    const wolf = (await C.wait(m => m.t === 'mj' && m.m.st !== 3 && (m.m.ty === 'wolf' || m.m.ty === 'boar'), 6000)).m;
    for (let i = 0; i < 6; i++) { C.move(wolf.x + 1, wolf.z, 0); await sleep(120); }
    C.clear(); C.send({ t: 'h', id: wolf.id, m: 3.6, a: 50, c: .05, sk: 1, e: 'fogo' }); await sleep(250); C.send({ t: 'h', id: wolf.id, m: 3.6, a: 50, c: .05, sk: 1, e: 'fogo' }); await sleep(400);
    const dms = C.msgs.filter(m => m.t === 'dm' && m.id === wolf.id); ok(dms.length === 1, 'habilidade da subclasse aceita uma vez e respeita a recarga (' + dms.length + ' golpe)');
    console.log('▶ Ferreiro: forja mítica e melhoria');
    await T.api('adm', { token: adm, a: 'mmoset', recipes: [{ id: 'r_elmo', n: 'Elmo Mítico de Teste', slot: 'cabeca', lvl: 80, gold: 100000, chance: 1, mats: { mat_cristal: 2, mat_nucleo: 1 } }] });
    C.close(); await sleep(300);
    await A('givemat', { id: 'mat_cristal', n: 2 }); await A('givemat', { id: 'mat_nucleo', n: 1 }); await A('givemat', { id: 'joia_bencao', n: 1 });
    C = T.client(tok, h.id); await C.open(); e = await C.wait(m => m.t === 'eco' && m.first); C.move(FERREIRO[0], FERREIRO[1]); await sleep(300);
    const g3 = e.g; r = await C.act({ a: 'craft', id: 'r_elmo' });
    const myth = r.t === 'eco' && r.inv.find(x => x.rar === 6 && x.slot === 'cabeca');
    ok(!!myth && r.g === g3 - 100000 && !r.inv.some(x => x.id === 'mat_cristal' || x.id === 'mat_nucleo'), 'forjou item Mítico (ouro e materiais consumidos)');
    r = await C.act({ a: 'craft', id: 'r_elmo' }); ok(r.t === 'ie', 'sem materiais o botão Criar é recusado: ' + r.x);
    if (myth) { const atk0 = myth.arm; r = await C.act({ a: 'up', u: myth.u }); const it = r.inv && r.inv.find(x => x.u === myth.u); ok(r.t === 'eco' && it && (it.up === 1 && it.arm > atk0), 'melhoria +1 aplicada (armadura ' + atk0 + ' → ' + (it && it.arm) + ')');
      r = await C.act({ a: 'up', u: myth.u }); ok(r.t === 'ie', 'sem Joia da Bênção não melhora: ' + r.x); }
    console.log('▶ persistência');
    C.close(); await sleep(1800); await T.stop(); await T.start();
    C = T.client(tok, h.id); await C.open(); e = await C.wait(m => m.t === 'eco' && m.first);
    ok(e.sub.id === 'arquimago' && e.sub.tree.a1 === 2, 'subclasse salva após reiniciar o servidor'); ok(e.inv.some(x => x.rar === 6), 'item mítico salvo');
    const au = await T.api('adm', { token: adm, a: 'audit', kind: 'sub_awaken', name: h.name }); ok(au.rows && au.rows.length === 1, 'auditoria registrou o despertar');
    C.close();
  } catch (e) { T.fail(e); }
  await T.finish();
})();
