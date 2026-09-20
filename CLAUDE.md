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

## Fallback pelo .scml (prefab binario) -- `src/scml-rig.js` LIGADO em `renderer/app.js`

Pacotes Craftpix antigos (Unity ~2017: Archer Guy, Medieval Mage, Barbarian Warrior, Pumpkin Head Guy)
trazem o `.prefab` em serializacao BINARIA, e `unity-yaml.js` so le texto -> 0 ossos/0 clips,
silenciosamente (o personagem "nao monta nem anima", sem erro nenhum). `loadFromDetected` agora tenta o
Unity primeiro e, se vier vazio, cai pro `.scml` direto (`state.poseSource = 'scml'`).

Toda amostragem de pose passa por `computePoseFn`/`computeBoundsFn` em `renderer/app.js`, e `bakeGrid`
recebe `computePoseFn` em vez de `rig` + `zIndexByName` -- o baker nao sabe de que fonte a pose vem. No
modo scml, `state.rig` e um stand-in `{clips, bones}` (bones "de mentirinha" tirados da pose em t=0, so
pra alimentar camadas/hit-test).

Lacunas do modo scml: o amortecimento (`dampX/Y/Angle`) nao tem efeito (`computeScmlPose` nao le
`partOffsets`; `selectPart` pula `findAnimatedAncestorName` nesse modo). O alpha vem das keys do proprio
scml (nao ha `m_FloatCurves`). O nome da peca e o da timeline (`Body`, `Head`...), nao um osso-junta.

Ao testar headless: `node-canvas` nao abre caminho com acento (`Bárbaro`) -- use
`loadImage(fs.readFileSync(p))`. O app (Electron) le por buffer e nao sofre disso.

## Templates de rig embutidos (`src/rig-templates.js` + pasta `templates/`)

Motivo: o usuario quer produzir "skins" (arte propria sobre o mesmo rig) sem precisar duplicar a pasta de
um personagem-base da Craftpix a mao toda vez -- so quer soltar PNG/SVG por peca. `templates/<id>/` guarda
uma copia completa de UM personagem-base (mesma estrutura `PNG/Vector Parts/Animations.scml` +
`Unity Package/*.unitypackage`), versionada no proprio repo. `detectCraftpixClassic()` funciona nela sem
adaptacao nenhuma -- e so mais uma pasta craftpix-classic, so que dentro do repo em vez de fora.

So `skeleton-crusader` esta embutido por enquanto (~1.1MB, copiado de
`Esqueletos/Skeleton_Crusader_1` da biblioteca Craftpix do usuario). Adicionar outro arquetipo de corpo e
so repetir o `cp` pra `templates/<novo-id>/` (mesma estrutura de pastas) e adicionar uma entrada em
`TEMPLATES` (`src/rig-templates.js`).

Fluxo na UI (`renderer/app.js`): dropdown `#sel-template` + botao "Carregar template" chama
`onPickTemplate()`, que carrega o rig com a arte DEFAULT do template inteira (mesmo caminho de
`loadFromDetected()` que a pasta externa usa) e mostra `#template-parts-list` -- uma linha por peca
canonica (`Body.png`, `Head.png`, ...) com botao "Carregar" (abre `select-image-file`, PNG ou SVG
qualquer tamanho, `drawImage` escala pro w/h gravado no `.scml`) e "Padrao" pra reverter so aquela peca.
Cada troca de peca so atualiza `state.images` + `state.alphaBoxes` daquela entrada e redesenha -- nao
recarrega o `.unitypackage` nem as outras pecas.

`onPickPack` (pasta externa) e `onPickTemplate` (template embutido) convergem no mesmo
`loadFromDetected(detected, displayLabel)` logo depois de resolver o `detected` -- se mexer no fluxo de
carregamento, mexa la, nao em cada um separado.

## North (costas) e East independentes (`renderer/app.js`)

`state.partOffsetsByRow = {east, north}`; `state.partOffsets` e um getter/setter que aponta pro mapa da vista
em edicao (`state.previewRow`), entao arrastar/camadas/pivo/z-order continuam iguais e valem so pra vista ativa.
Arte tambem e por vista: com NORTH ativo, "Arte" grava em `state.imagesBack` (`partArtOverridesBack`), com EAST
em `state.images`. O bake passa `partOffsets` por linha (`rowSpec.partOffsets`) e `computePoseFn(clip, t, offsets)`
recebe os ajustes da linha (amortecimento). Preview: `#preview-canvas-north` (esq.) + `#preview-canvas` (dir.),
"Lado a lado" liga os dois; clicar num canvas o torna a vista editada. Perfil salva `partOffsetsNorth`.
Arte de costas casa por nome tolerante (`matchBackFiles` em `src/back-art.js`: `left-arm-back.png` -> `Left Arm.png`,
`head-elm-back` -> `Head`), da pasta `Back/Costas` ou solta na `Vector Parts` com sufixo `-back`.

Desfazer/refazer: `pushUndo(key)` (app.js) tira snapshot dos `partOffsetsByRow` ANTES de cada mutacao (arrasto, campos
numericos -- agrupados por `key` --, reordenar camadas, seguir, resetar); Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. Nao cobre troca de
arte. Selecao multipla: `state.multiSel` (Set); Shift+clique no preview/camadas soma/tira; arrastar move o grupo pelo mesmo
delta (pecas que ja seguem uma selecionada via `followBone` sao puladas pra nao contar em dobro).

Ordem de camadas do NORTH: o default vem do `.scml` e e o MESMO do EAST, o que esta errado pra vista de costas
(braco/mao/escudo do lado de ca deveriam ficar ATRAS do corpo). Botao "Espelhar profundidade"
(`mirrorDepthForBackView`, so aparece editando NORTH com arte de costas) inverte a lista toda menos
`Head`/`Face*`, que continuam por cima -- eles nao estao atras do corpo em profundidade, so por cima na vertical.
Grava zIndex so nos offsets do NORTH; Ctrl+Z desfaz. `loadFromDetected` ja aplica isso sozinho
(`applyBackViewDepth`) quando ha arte de costas E o NORTH ainda nao tem ajuste nenhum -- se o perfil salvo trouxe
`partOffsetsNorth`, a ordem e do usuario e NAO pode ser sobrescrita. `currentLayers(offsets)` aceita o mapa de
qual vista ler, pra dar pra calcular a ordem do NORTH com o EAST ainda ativo. Cada bloco (braco + mao + o que ela segura) troca de lado
INTEIRO. Dentro do bloco, o que e SEGURADO (qualquer peca que nao case com arm/hand/leg/foot/body/torso/hip/
neck/head/face) vai pro FUNDO: de costas o membro fica entre a camera e o objeto -- de frente o escudo cobre o
braco, de costas o braco cobre o escudo, e a mao aparece por cima do punho da arma.

Nomenclatura Left/Right do rig Craftpix: e o lado DO PERSONAGEM, nao o da tela, e esta correta -- medido no
Skeleton Crusader, as pecas "Right *" sao desenhadas mais perto da camera (z alto, na frente do corpo) e as
"Left *" no lado oposto. Como o personagem olha pra EAST, o lado direito dele e o que fica pra camera. O que
surpreende e que esses pacotes poem o ESCUDO na mao direita e a ESPADA na esquerda (personagem canhoto) -- e
escolha do artista, nao bug de nome; nao "corrigir" renomeando osso (quebraria a assinatura de rig).

Escala por peca: `partOffsets[osso].scaleX/scaleY` (1 = original), aplicada em `applyManualOverrides` multiplicando
`world.scaleX/scaleY` -- a peca cresce em torno do PROPRIO PIVO, entao continua presa no mesmo ponto do rig. Campos
"Escala X/Y (%)" + "Travar". O hit-test do preview tambem escala a area clicavel. Serve pra acertar arte de costas que
saiu maior/menor que a da frente sem reexportar o PNG.

`check-renderer-wiring.js` tambem recusa caractere de controle invisivel no fonte. Motivo: uma edicao automatizada trocou
o `\b` de `/^body\b/i` por um byte 0x08 de verdade; a regex nunca casava, o app rodava sem erro nenhum e o sintoma
("Espelhar profundidade erra as pernas") nao apontava pra causa -- ate no grep o caractere e invisivel.
