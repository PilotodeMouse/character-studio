# Contexto para o Claude Code neste repositorio

Isso resume uma sessao longa de diagnostico e correcao feita fora daqui (Cowork), pra qualquer sessao do
Claude Code aberta nesta pasta comecar sabendo o que ja foi investigado, em vez de redescobrir. Detalhes
completos de cada bug estao comentados nos proprios arquivos citados abaixo -- este arquivo e o indice.

## Estado do repositorio agora

Working tree tem mudancas AINDA NAO COMMITADAS em `src/`, `renderer/`, `main.js`, `scripts/`. Antes de
qualquer coisa, rode `git status` e `git diff --stat` pra ver o tamanho real. Se ainda nao foi feito,
commitar e dar push:

```
git add src renderer main.js scripts README.md CLAUDE.md
git commit -m "fix: isola ajustes por personagem, mede alpha real, corrige amortecimento no bake; feat: arte de costas real e gerador de guias de template"
git push origin master
```

Remote confirmado com o usuario: `origin` = `https://github.com/PilotodeMouse/character-studio.git` (o
nome do repo no GitHub e `character-studio`, NAO `isometric-character-studio` -- so o nome da pasta local
diverge do nome do repo, e intencional, ja foi confirmado, nao "corrigir").

## Bugs de render corrigidos (`src/unity-skeleton.js`)

1. **Pivo do Spriter invertido** (causa raiz de pecas desalinhadas/cabeca-face descolada): o offset de
   desenho tem que ser `-(1 - pivotY) * h`, nao `-pivotY * h`. Comentario grande no topo de `drawPose`
   explica a convencao (Spriter e Y-up/origem-embaixo, canvas e Y-down/origem-em-cima). NAO reintroduza o
   calculo antigo.
2. `PIXELS_PER_UNIT` em `src/unity-prefab.js` e **100**, nao 50. 50 era compensacao do bug 1.
3. `bakeGrid` (`src/baker.js`) recebe `scale` e usa no `drawPose` -- sem isso o `.webp` sai diferente do
   preview calibrado.
4. `bakeGrid` chamava `computePose(...)` sem o 5o argumento (`partOffsets`) -- o amortecimento
   (`dampX/Y/Angle`) configurado por peca nunca aparecia no bake, so no preview. Corrigido.

## `rig-profile` v2 (`src/rig-profile.js`) -- isolamento por personagem

Formato v1 guardava `partOffsets` na raiz do arquivo, indexado so pela assinatura do esqueleto -> um
ajuste manual num personagem contaminava TODOS os outros da mesma serie (mesmo rig). Corrigido: formato de
saida (tamanho/frames/view de costas) fica no nivel do esqueleto (herdado pela serie inteira); ajustes por
peca ficam em `characters[nomeDoPersonagem]`, isolados. Perfis v1 tem os `partOffsets` descartados na
migracao (eram compensacoes do bug de pivo, reaplicar desmonta). Se o usuario reportar personagem
desmontando ou "contaminando" outros, comece por aqui -- e o segundo lugar mais provavel depois do pivo.

## Auto-fit de escala (`src/vtt-standards.js` + `src/alpha-bounds.js`)

`fitScaleForBounds(bounds, cell, margin)` calcula a maior escala <=1 que faz o personagem caber na celula
VTT (so reduz, nunca amplia). `bounds` deve vir de `computeAnimatedBounds(..., alphaBoxes)` com
`alphaBoxes` de `computeAlphaBoxes` -- SEM isso, mede o retangulo cheio do PNG (que tem 40-60% de moldura
transparente nesses packs da Craftpix) e encolhe o personagem sem necessidade. Tamanho padrao do seletor e
1x1 (`DEFAULT_SIZE`), conforme o padrao do VTT em https://isometric-tactics.pages.dev/desktop/pages/standards.

## Arte de costas real (`src/back-art.js` + `src/craftpix-profile.js`)

Pasta opcional `PNG/Vector Parts/Back/` ou `Costas/` com PNGs de mesmo nome que a arte da frente (mesmo
tamanho/pivo, so pixels diferentes). `mergeImagesForRow` faz merge peca a peca -- parcial e permitido, so
as pecas presentes na pasta de costas substituem, o resto cai pra frente. So afeta a linha NORTH do bake;
a pose (clip) continua a mesma, so a textura desenhada muda. Preview tem um toggle "Ver: East/North" pra
conferir alinhamento antes de bakear.

## Producao de skins em escala

O rig inteiro vive em `Animations.scml` + `.unitypackage`, que NAO mudam entre personagens da mesma serie.
Pra criar uma skin nova: duplicar a pasta do personagem-base inteira, manter esses dois arquivos, trocar
so os PNGs em `Vector Parts/` com o MESMO nome de arquivo e o MESMO tamanho de canvas por peca (o app
desenha com `drawImage(img, x, y, w, h)` usando w/h do `.scml`, nao o tamanho real do PNG carregado --
dimensao diferente sai esticada/achatada). `scripts/export-part-templates.js` gera um PNG-guia por peca
(tamanho exato + cruz no pivo + fantasma da arte original) a partir do `.scml` do personagem-base, pra
importar como camada de fundo num software de vetor.

## Rede de seguranca

`node scripts/check-renderer-wiring.js` roda sem abrir o Electron. Confere: todo modulo de `src/` carrega
sozinho, todo nome desestruturado de um `require('../src/...')` existe de verdade nos exports daquele
modulo, todo `getElementById` do renderer acha um `id=` real em `renderer/index.html`, e todo
`ipcRenderer.invoke('canal')` tem um `ipcMain.handle('canal')` correspondente em `main.js`. Rode isso
DEPOIS de qualquer mudanca em `renderer/*.js`, `renderer/index.html` ou `main.js`, antes de considerar a
mudanca pronta -- o renderer inteiro roda dentro de uma IIFE (`renderer/app.js`), entao um so
`getElementById` retornando `null` mata todos os `addEventListener` registrados depois dele, e o sintoma e
"nada funciona" no app, sem nenhuma pista de onde comecou. Ja aconteceu duas vezes nesta sessao.

## Pendente (proximo passo natural)

`src/scml-rig.js` implementa e valida um caminho de pose/animacao direto do `.scml` (sem depender do
`.unitypackage`), mas **ainda nao esta ligado em `renderer/app.js`**. E o que resolve pacotes com `.prefab`
serializado em BINARIO (nao YAML texto) que hoje falham silenciosamente com 0 ossos/0 clips -- ex: Pumpkin
Head Guy (Unity 2017.1.1f1). Fazer o app usar `computeScmlPose`/`pivotsFromScml`/`clipsFromScml`/
`computeScmlBounds` como fonte primaria e cair pro `.unitypackage` so como fallback.
