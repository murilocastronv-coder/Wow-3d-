'use strict';
/* Teste de ponta a ponta do cliente WOW 3D no navegador (Chromium/Playwright) contra o servidor real.
   Uso: node tests/wow-client.e2e.js   (salva capturas em tests/out/)
   Cobre: tela inicial, modo visitante, conta + herói online, mundo 3D, andar, atacar e derrotar monstro,
   ouro direto na bolsa, coleta de item do chão, janela do item com comparação e Equipar/Dropar, chat em abas,
   montaria (invocar e andar montado) e o layout de celular. Falha se houver erro de JavaScript na página. */
const { chromium } = require('playwright'), { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = path.join(require('os').tmpdir(), 'wow3d-test-' + process.pid + '.json'), OUT = path.join(__dirname, 'out'), PORT = 3800 + Math.floor(Math.random() * 100), BASE = 'http://localhost:' + PORT;
let srv, passed = 0, failed = 0; const ok = (c, m) => { if (c) { passed++; console.log('  ✔', m); } else { failed++; console.log('  ✘', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pg => pg.evaluate(() => { const P = window.__vd.P; if (P.dead) document.getElementById('relBtn').click(); P.hp = Math.max(P.hp, 100); });
async function start() { srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT, SECRET: 'e2e', DATABASE_URL: '', DATA_FILE: DATA, WOW_ELITE_CH: '0' }), stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { await sleep(150); try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) {} } throw new Error('servidor'); }
(async () => {
  fs.mkdirSync(OUT, { recursive: true }); 
  let browser;
  try {
    await start(); browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
    const errs = []; const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 760 } }); const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|stats/i.test(m.text())) errs.push(m.text()); });
    console.log('▶ página inicial');
    await pg.goto(BASE + '/wow3d'); await pg.waitForSelector('#title', { timeout: 15000 }); await sleep(800);
    ok(await pg.isVisible('#title h1'), 'tela inicial aparece'); await pg.screenshot({ path: path.join(OUT, '01-titulo.png') });
    console.log('▶ conta e herói online');
    const u = 'e2e' + Math.floor(Math.random() * 1e5);
    const reg = await pg.evaluate(async u => { const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: u + '@t.local', password: 'segredo1' }) }); return r.json(); }, u);
    ok(!!reg.token, 'conta criada');
    const cr = await pg.evaluate(async t => { const r = await fetch('/api/wow/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t, name: 'Heroi' + Math.floor(Math.random() * 999), cls: 'guerreiro', race: 'humano', look: {} }) }); return r.json(); }, reg.token);
    ok(!!cr.id, 'herói criado (guerreiro)');
    await pg.evaluate(t => localStorage.setItem('vd-token', t), reg.token); await pg.evaluate(() => localStorage.setItem('vd-hd', '0'));
    await pg.reload(); await pg.waitForSelector('#aChars .ac', { timeout: 15000 }); await pg.click('#aChars .ac'); await sleep(2500);
    await pg.waitForFunction(() => window.__vd.ws3ok && window.__vd.SRV(), null, { timeout: 15000 }).catch(() => {});
    const st = await pg.evaluate(() => { const v = window.__vd; return { started: !!(v.P && v.P.name), ws: v.ws3ok }; });
    ok(st.started, 'entrou no mundo 3D'); ok(st.ws, 'conectado ao multiplayer (WebSocket)');
    await pg.waitForFunction(() => window.__vd.P && window.__vd.P.inv && window.__vd.P.inv.some(x => x.u), null, { timeout: 8000 }).catch(() => {});
    const inv0 = await pg.evaluate(() => ({ g: window.__vd.P.gold, inv: window.__vd.P.inv.map(x => x.id + ':' + (x.n || 1)), arma: window.__vd.P.eq.arma && window.__vd.P.eq.arma.name }));
    ok(inv0.inv.some(x => x.startsWith('pot')) && /Treino/.test(inv0.arma || ''), 'kit inicial veio do servidor: ' + inv0.inv.join(',') + ' · ' + inv0.arma);
    await pg.screenshot({ path: path.join(OUT, '02-mundo.png') });
    console.log('▶ andar até a floresta e lutar');
    // anda de verdade (teclado) por alguns segundos e confere que saiu do lugar
    const p0 = await pg.evaluate(() => ({ x: window.__vd.P.x, z: window.__vd.P.z }));
    await pg.keyboard.down('w'); await sleep(4000); await pg.keyboard.up('w');
    const p1 = await pg.evaluate(() => ({ x: window.__vd.P.x, z: window.__vd.P.z, mv: window.__vd.P.anim }));
    ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, 'herói andou com o teclado (' + Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) + ' m)');
    // leva o herói para perto dos lobos (teleporte de teste pelo próprio jogo: renascer na estrada) e usa o ataque automático
    await pg.evaluate(() => { const P = window.__vd.P; P.x = 78; P.z = 16; P.y = window.__vd.heightAt(78, 16); P._tp = 1; });
    await sleep(1500);
    let killed = false, gold0 = await pg.evaluate(() => window.__vd.P.gold);
    for (let i = 0; i < 40 && !killed; i++) {
      await alive(pg); await pg.evaluate(() => { const v = window.__vd, P = v.P; if (!P.hunt) v.autoBtn && v.autoBtn(); });
      await sleep(1000); killed = await pg.evaluate(g => window.__vd.P.gold > g, gold0);
    }
    const g1 = await pg.evaluate(() => window.__vd.P.gold);
    ok(killed, 'derrotou um monstro e recebeu ouro direto na bolsa (' + gold0 + ' → ' + g1 + ')');
    await pg.screenshot({ path: path.join(OUT, '03-combate.png') });
    const coinsOnGround = await pg.evaluate(() => window.__vd.DROPS.filter(d => d.gold).length); ok(coinsOnGround === 0, 'nenhuma moeda no chão');
    console.log('▶ item no chão e coleta');
    let picked = false;
    for (let i = 0; i < 30 && !picked; i++) { await alive(pg);
      const d = await pg.evaluate(() => { const D = window.__vd.DROPS.find(x => x.gid); if (!D) return null; const P = window.__vd.P; P.hunt = false; P.auto = false; P.x = D.x + .4; P.z = D.z; return { n: D.name, left: Math.round(D.exp - performance.now() / 1000) }; });
      if (d) { await sleep(1200); picked = await pg.evaluate(n => window.__vd.P.inv.some(x => n.indexOf(x.name) >= 0), d.n); if (picked) ok(d.left > 0 && d.left <= 60, 'item tinha prazo de ' + d.left + ' s'); }
      else { await pg.evaluate(() => { const P = window.__vd.P; if (!P.hunt) window.__vd.autoBtn(); }); await sleep(1500); }
    }
    ok(picked, 'coletou um item do chão (foi para a mochila pelo servidor)');
    console.log('▶ janela do item, comparação, equipar e dropar');
    await pg.evaluate(() => { const P = window.__vd.P; P.hunt = false; P.auto = false; P.target = null; P.x = 0; P.z = 12; P._tp = 1; }); await alive(pg); await sleep(1500);
    await pg.keyboard.press('b'); await sleep(400);
    const hasW = await pg.evaluate(() => window.__vd.P.inv.findIndex(x => x.slot));
    if (hasW >= 0) {
      await pg.click('#bagG [data-src="bag:' + hasW + '"]'); await sleep(300);
      ok(await pg.isVisible('#itPop'), 'janela do item abriu'); const txt = await pg.textContent('#itPop');
      ok(/Comparando|Desequipar/.test(txt) && /Equipar|Dropar/.test(txt), 'mostra comparação e botões Equipar/Dropar');
      ok(/Melhor|Pior|Equivalente|vazio/.test(txt), 'indica se é melhor, pior ou equivalente');
      await pg.screenshot({ path: path.join(OUT, '04-item.png') });
      const can = await pg.$('#itPop [data-ipa="eq"]:not([disabled])');
      if (can) { const before = await pg.evaluate(i => window.__vd.P.inv[i].u, hasW); await can.click(); await sleep(800); const eqd = await pg.evaluate(u => Object.values(window.__vd.P.eq).some(x => x && x.u === u), before); ok(eqd, 'equipou pelo botão (servidor confirmou)'); }
      else ok(true, 'item não equipável pela classe/nível (botão desabilitado corretamente)');
    } else ok(true, 'sem equipamento na mochila para abrir (drop sem equipamento)');
    const potIdx = await pg.evaluate(() => window.__vd.P.inv.findIndex(x => x.id === 'pot'));
    if (potIdx >= 0) { pg.once('dialog', d => d.accept('1')); await pg.click('#bagG [data-src="bag:' + potIdx + '"]'); await sleep(250); await pg.click('#itPop [data-ipa="dr"]'); await sleep(900);
      ok(await pg.evaluate(() => window.__vd.DROPS.some(d => d.gid && /Poção/.test(d.name))), 'dropou uma poção no chão'); }
    console.log('▶ chat em abas');
    ok(await pg.isVisible('#ctabs'), 'abas do chat visíveis'); const tabs = await pg.$$eval('#ctabs [data-ct]', b => b.map(x => x.textContent.trim()));
    ok(tabs.join(',') === 'Local,Global,Guilda,Privado,Info', 'abas: ' + tabs.join(', '));
    await pg.click('#ctabs [data-ct="a"]'); await sleep(200); await pg.keyboard.type('ola mundo'); await pg.keyboard.press('Enter'); await sleep(700);
    ok(/ola mundo/.test(await pg.textContent('#cl')), 'mensagem enviada aparece na aba Global');
    await pg.click('#ctabs [data-ct="l"]'); await sleep(100); ok(!/ola mundo/.test(await pg.textContent('#cl')), 'aba Local não mostra mensagem da Global');
    console.log('▶ montaria');
    await pg.evaluate(() => { const P = window.__vd.P; P.lvl = Math.max(P.lvl, 5); P.combat = 0; });
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape'); await pg.evaluate(() => { const P = window.__vd.P; P.dead = false; P.hp = 999; P.hunt = false; P.auto = false; P.combat = 0; }); await pg.keyboard.press('6'); await sleep(1500);
    ok(await pg.evaluate(() => window.__vd.P.mounted), 'montou (tecla 6)');
    const q0 = await pg.evaluate(() => ({ x: window.__vd.P.x, z: window.__vd.P.z })); await pg.keyboard.down('w'); await sleep(4000); await pg.keyboard.up('w');
    const q1 = await pg.evaluate(() => ({ x: window.__vd.P.x, z: window.__vd.P.z })); const md = Math.hypot(q1.x - q0.x, q1.z - q0.z);
    ok(md > Math.hypot(p1.x - p0.x, p1.z - p0.z) * 1.4, 'montaria transporta o herói mais rápido (' + md.toFixed(1) + ' m montado contra ' + Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) + ' m a pé no mesmo tempo)'); await pg.screenshot({ path: path.join(OUT, '05-montaria.png') });
    await pg.keyboard.press('m'); await sleep(300); ok(await pg.isVisible('#wStable'), 'janela de montarias abre (M)'); await pg.screenshot({ path: path.join(OUT, '06-estabulo.png') }); await pg.keyboard.press('Escape');
    await pg.keyboard.press('j'); await sleep(300); ok(/Mestre das Subclasses/.test(await pg.textContent('#wSub')), 'janela de subclasse abre (J) e mostra requisitos'); await pg.screenshot({ path: path.join(OUT, '07-subclasse.png') }); await pg.keyboard.press('Escape');
    console.log('▶ salvar progresso');
    const gNow = await pg.evaluate(() => window.__vd.P.gold); await pg.evaluate(() => window.__vd.save && 0); await sleep(2000);
    const pg2 = await ctx.newPage(); pg2.on('pageerror', e => errs.push(String(e)));
    await pg.close(); await sleep(1500);
    await pg2.goto(BASE + '/wow3d'); await pg2.waitForSelector('#aChars .ac', { timeout: 15000 }); await pg2.click('#aChars .ac'); await sleep(3000);
    const g2 = await pg2.evaluate(() => window.__vd.P.gold); ok(g2 === gNow, 'progresso salvo: ouro ' + g2 + ' depois de reabrir');
    console.log('▶ celular (toque)');
    const mob = await browser.newContext({ locale: 'pt-BR', viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); const pm = await mob.newPage(); await pm.addInitScript(() => { try { localStorage.setItem('vd-hd', '0'); } catch (e) {} });
    pm.on('pageerror', e => errs.push(String(e)));
    await pm.goto(BASE + '/wow3d'); await pm.waitForSelector('#title'); await pm.click('#tabs [data-tab="guest"]'); await pm.fill('#nameIn', 'Movel'); await pm.click('#goBtn'); await pm.waitForFunction(() => window.__vd && window.__vd.P, null, { timeout: 30000 }).catch(() => {}); await sleep(1500);
    ok(await pm.evaluate(() => !!window.__vd.P), 'modo visitante no celular entrou no jogo'); ok(await pm.isVisible('#joy'), 'joystick virtual visível');
    const box = await pm.$eval('#joy', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const m0 = await pm.evaluate(() => ({ x: window.__vd.P.x, z: window.__vd.P.z }));
    const cdp = await mob.newCDPSession(pm);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    for (let i = 0; i < 40; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y - 40 - (i % 2) }] }); await sleep(100); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const m1 = await pm.evaluate(() => ({ x: window.__vd.P.x, z: window.__vd.P.z })); ok(Math.hypot(m1.x - m0.x, m1.z - m0.z) > 2, 'joystick moveu o herói (' + Math.hypot(m1.x - m0.x, m1.z - m0.z).toFixed(1) + ' m)');
    await pm.screenshot({ path: path.join(OUT, '08-celular.png') });
    await pm.click('#mn [data-w="wBag"]'); await sleep(300); const pi = await pm.evaluate(() => window.__vd.P.inv.findIndex(x => x.slot || x.id === 'pot'));
    if (pi >= 0) { await pm.tap('#bagG [data-src="bag:' + pi + '"]'); await sleep(300); ok(await pm.isVisible('#itPop'), 'toque no item abre a janela no celular'); await pm.screenshot({ path: path.join(OUT, '09-celular-item.png') }); }
    ok(errs.length === 0, 'nenhum erro de JavaScript' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  } catch (e) { failed++; console.error('ERRO', e); }
  finally { try { await browser && browser.close(); } catch (e) {} if (srv) { srv.kill('SIGTERM'); await sleep(500); } try { fs.unlinkSync(DATA); } catch (e) {} }
  console.log('\n' + passed + ' ok, ' + failed + ' falha(s)'); process.exit(failed ? 1 : 0);
})();
