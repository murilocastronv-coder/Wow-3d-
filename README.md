# WOW 3D — Reinos de Valdor (Eternal Realms)

MMORPG 3D no navegador (motor WebGL próprio) + servidor Node com WebSocket e PostgreSQL.

## Rodar localmente
    npm install
    PORT=3000 node server.js      # sem DATABASE_URL grava em data.json
    # abra http://localhost:3000

## Publicar na Render
- Web Service, `npm install` / `npm start`, Node >= 20.
- Variáveis: `DATABASE_URL` (PostgreSQL), `PGSSL=true`, `SECRET` (obrigatório em produção). Opcionais: `RESEND_API_KEY`, `STRIPE_*`, `PUBLIC_URL`.
- Todos os arquivos ficam na raiz do repositório (o servidor detecta o modo "raiz").

## Arquivos que o código espera mas NÃO estavam no zip
- `systems.js` (eventos/títulos/pets — o servidor roda sem ele, com aviso no log)
- Modelos HD: `guerreiro.glb`, `cls_<classe>.glb`, `mob_<tipo>.glb`, `npc_<id>.glb` (sem eles o jogo usa os modelos procedurais; só `mount_horse.glb` existe)

## v11 (esta revisão)
- Câmera não atravessa mais árvores/casas.
- Celular em pé: hotbar inteira visível (Poção e Montaria estavam fora da tela).
- Desktop ~900–1300px: menu não cobre mais os slots 5–6.
