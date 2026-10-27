# Reinos de Valdor (WOW 3D) — sistemas de MMORPG

O jogo 3D roda no mesmo servidor do Eternal Realms (Node + PostgreSQL na Render) e abre em **`/wow3d`**
(também `/reinos`). A página inicial (`/`) e o MuOnlineClaude (`/jogar`) continuam iguais.

## Arquivos

| Arquivo | Papel |
|---|---|
| `wow.html` | Cliente: motor WebGL próprio, interface, controles de PC e celular |
| `wowitems.js` | **Compartilhado** (navegador e servidor): espaços de equipamento, raridades, armas por classe, materiais, conjuntos, melhoria +N, tabelas de drop, montarias, receitas, subclasses |
| `wowdata.js` | **Compartilhado**: classes, raças, monstros (resistências), missões, posição dos NPCs de serviço |
| `terrain.js` | **Compartilhado**: altura do terreno e regiões |
| `wowmmo.js` | Servidor: economia autoritativa (ouro, mochila, equipamento, banco, drops no chão, loja, montarias, missões, Ferreiro, subclasses, auditoria) |
| `wowrt.js` | Servidor em tempo real (WebSocket `/ws3d`): jogadores, monstros, combate, chefes, masmorra, grupo, guilda, troca, chat |
| `wow.js` | Conversão de personagens antigos e validação do salvamento |
| `server.js` | HTTP/API, rota `/wow3d`, painel de ADM |
| `tests/` | Testes unitários, de integração (servidor real) e de ponta a ponta (navegador) |

## Regras do drop (fixas)

- **Ouro** vai direto para a bolsa (`+N Ouro` na tela, moedas animadas que voam para o herói). Nunca aparece no chão, nem com a mochila cheia.
- **Itens** aparecem no chão onde o monstro morreu, cada um com o próprio prazo de **60 s** contado pelo **servidor**.
  Faltando 15 s o nome mostra os segundos; nos últimos 10 s o item pisca. Ao vencer, some para todos.
- **Coleta**: chegar perto (automático), tecla **E**, clique no nome (PC) ou toque (celular), botão ✋ no celular.
  O servidor confere: item existe, prazo, mapa, distância (5 m), permissão e espaço. Retirar do chão e entregar na mochila é um passo único
  (dois jogadores nunca levam o mesmo item).
- **Mochila cheia**: o item continua no chão e aparece *"Inventário cheio! Libere espaço para coletar este item."*
- Itens do chão são gravados no banco; ao reiniciar, voltam com o **prazo original** e os vencidos não voltam.
- Modos de distribuição (configuráveis por categoria de monstro): `individual`, `shared`, `exclusive`, `party`.
- Categorias com tabelas próprias: monstro comum, **elite** (4% dos monstros do mundo nascem elite), **chefe** e **chefe mundial**.
- Cada morte tem um identificador; o servidor nunca premia a mesma morte duas vezes. Tudo fica na auditoria (`loot_kill`, `loot_pick`, `loot_expire`…).

## Inventário e equipamento

- 40 espaços, pilhas até 999, dividir pilha, juntar, largar (com quantidade), destruir, vender no Torvin, banco (60 espaços, Banqueira Odila).
- **11 espaços**: Arma, Escudo, Elmo, Peitoral, Luvas, Calças, Botas, Colar, Anel, Brincos, Asas.
- Armas de **1 ou 2 mãos** por classe (escudo só com arma de 1 mão e para classes que usam escudo); nível mínimo.
- Raridades: Gasto, Comum, Incomum, Raro, Épico, Lendário e **Mítico** (só na forja e em chefes).
- **Janela do item** (clique/toque): ícone animado, nome, raridade, nível, atributos, descrição, **comparação** com o equipado
  (verde sobe, vermelho desce, diferença numérica e veredito *melhor / pior / equivalente*), botões **Equipar** e **Dropar**
  (e Usar, Dividir, Vender, Depositar, Melhorar quando cabe). Duplo clique equipa direto no PC.
- **Conjuntos** (Dragão, Guardião, Sombra, Arcano) com bônus de 2/4/5 peças.
- A aparência muda ao equipar (elmo, ombreiras, escudo, luvas, botas, brilho da arma, asas); itens lendários/míticos dão aura e rastro na arma.

## Ferreiro Durgan (forja mítica)

Receitas com materiais de elites/chefes + ouro, chance de sucesso configurável (falha consome ouro e materiais; dá para devolver parte
com `fail.keepMats`). O botão **Criar Item** só habilita com tudo em mãos. Melhoria **+1 a +9** com Joia da Bênção (até +6) e Joia da Alma (+7 a +9);
na falha o item não é perdido. O ADM edita as receitas no painel.

## Subclasses (nível 500)

NPC **Mestre Aldric** (Mestre das Subclasses). Cadeia de 5 etapas, toda validada no servidor:
1. Provação do Mestre — nível 500 + 500.000 de ouro.
2. Coleta de Recursos — 30 Cristais Arcanos, 20 Núcleos de Monstro, 10 Fragmentos Antigos (drop de elites).
3. Provação de Combate — 50 elites, 3 Sentinelas do Santuário e o Guardião Ancestral (abates contados pelo servidor) → Selo.
4. Forja da Especialização — Selo → Núcleo de Especialização; 2.000.000 de ouro → Insígnia.
5. Despertar — Insígnia + 5.000.000 de ouro + escolha de uma subclasse **compatível** com a classe.

9 subclasses (Berserker, Guardião Sagrado, Arquimago, Senhor das Sombras, Mestre Arqueiro, Invocador Ancestral, Mestre Marcial,
Cavaleiro Dragão, Oráculo). Cada uma tem bônus passivos, uma habilidade ativa (tecla **7**), árvore de 8 nós (níveis 1, 5, 10, 20, 30, 50),
nível próprio até 50 com XP de abates e pontos. Valores, taxas e quantidades são editáveis pelo ADM; subclasses podem ser desligadas.

## Montarias

9 montarias (Cavalo de Guerra grátis no nível 5, Cavalo Blindado, Lobo Gigante, Tigre, Pantera, Leão, Dragão Terrestre, Unicórnio,
Dragão das Chamas lendário que só cai do Dragão Ancestral). Compra com ouro no **Cavalariço Bruno**, seleção na janela (**M**),
invocar/desmontar com **6**/**Z**. A montaria leva o herói (velocidade própria, validada no servidor), com efeito de invocação e
animação de montar/desmontar; os outros jogadores veem a montaria escolhida.

## Mundo e conteúdo novo

- Regiões: **Vulcão de Ignar**, **Ruínas de Eldoria**, **Santuário Ancestral**, **Arena dos Campeões**.
- Monstros: Diabrete de Fogo, Golem de Lava, Demônio Infernal, Gárgula, Espectro, Cavaleiro Sombrio, Sentinela do Santuário.
- Chefes: **Ignar** (vulcão), **Guardião Ancestral** (santuário) e o chefe mundial **Dragão Ancestral**, com fases (60% / 25%),
  círculos de aviso no chão, pulso em área e reforços.
- Resistências e fraquezas por elemento (fogo, gelo, raio, luz, sombras, natureza, físico): o servidor aplica no dano.
- Classes novas: **Invocador** (lobo espiritual e golem que lutam de verdade) e **Gladiador Arcano** (híbrido lâmina + magia). Total: 14.
- Missões novas (6–9) com abates contados pelo servidor.

## Combate e animações

- O servidor calcula o ataque do herói com o **equipamento real** (bônus de conjunto e subclasse) e usa o menor entre esse valor e o enviado.
- Golpes corpo a corpo aplicam dano no **impacto** da animação (preparo → impacto → recuperação).
- Modelos com esqueleto: transição suave entre animações, reação a dano (Hit), pulo (Jump), conjuração, morte. Modelo simples: respiração e ataque em 3 tempos.

## Chat

5 abas com cor própria: **Local** (branco, 60 m), **Global** (amarelo), **Guilda** (verde), **Privado** (rosa, campo "Para"),
**Info** (azul). Só mensagens de jogadores; avisos do jogo vão para um aviso discreto no topo da tela. Minimizar/expandir, contador de não lidas.

## Painel de ADM (⚙️ → Painel de ADM)

Além do que já existia: editar drops/raridade/tempo no chão, receitas, subclasses (JSON), dar materiais, consultar/corrigir a subclasse
de um jogador e ver a auditoria (drops, coletas, compras, banco, forja, subclasses, trocas).

## Rodar e testar

```bash
npm install
node server.js                      # sem DATABASE_URL usa data.json (desenvolvimento)
# abrir http://localhost:3000/wow3d

node tests/wowitems.test.js         # unitários (itens, drops, subclasses)
node tests/wow-mmo.int.test.js      # servidor real: drop, coleta, cheio, corrida, save, reinício (WOW_TEST_LONG=1 inclui os 60 s)
node tests/wow-sub-forge.int.test.js  # servidor real: subclasse (5 etapas) e Ferreiro
node tests/wow-client.e2e.js        # navegador (Playwright): PC e celular, capturas em tests/out/
```

## Publicar na Render

O `render.yaml` já existente serve: web service Node (`node server.js`, health `/health`) + banco PostgreSQL (`DATABASE_URL`).
Ao fazer o merge na branch publicada, a Render faz o deploy. Não há migração manual: os dados novos ficam na tabela `kv`
(`wow:<id>` ganha `bank`, `mounts`, `mnt`, `sub`, `qk`, `qa`, `qd`; itens do chão em `wow:ground`; configuração em `wowcfg`)
e na tabela `logs` (auditoria). Personagens antigos são convertidos sozinhos no primeiro login.
