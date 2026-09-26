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

## Pasta so com PNGs: o app empresta o rig (`templates/` + `src/rig-templates.js`)

O jeito de produzir skins em escala. O usuario cria uma pasta com os PNGs por peca dele (`Body.png`,
`Head.png`, ... com os MESMOS nomes e o MESMO tamanho de tela do rig) e abre ela em "Selecionar pasta do
personagem". Sem `.scml`/`.unitypackage` na pasta, `detectComRigEmprestado` (renderer/app.js) monta o
`detected` com o `scmlPath` + `unitypackagePath` do template escolhido no dropdown `#sel-template` e
`vectorPartsDir` apontando pra pasta do usuario. Dali pra frente e o mesmo `loadFromDetected` de sempre.
`avisarPecasFaltando` lista no log as pecas que o rig espera e a pasta nao tem -- numa pasta montada a mao,
esquecer um PNG e o erro mais facil de cometer e o mais dificil de notar.

`findArtOnlyDir` (`src/craftpix-profile.js`) aceita os PNGs soltos na pasta escolhida ou dentro de
`PNG/Vector Parts`. A arte de costas e de cada personagem: `*-back.png` na propria pasta dele (o template
NAO empresta arte, so o esqueleto).

`templates/<id>/` continua guardando uma copia completa de UM personagem-base (so `skeleton-crusader` por
enquanto, ~1.1MB), porque e de la que sai o `.scml` + `.unitypackage`. Adicionar outro arquetipo e copiar
a pasta e por uma entrada em `TEMPLATES` (`src/rig-templates.js`).

HISTORICO: existia um botao "Carregar template" que abria o template COMO personagem, com a arte da
Craftpix, e uma lista pra trocar peca por peca. Foi removido a pedido -- carregava o esqueleto errado e
exigia doze dialogos de arquivo por personagem, pior que duplicar a pasta. O dropdown sobrou como "de qual
rig emprestar". A pasta `templates/` em si nao tem a arte de costas do usuario, e era por isso que as 4
direcoes saiam identicas naquele fluxo.

## Troca de sprite por animacao (piscar, careta de dor)

"Idle Blinking" e "Hurt" rodavam com a cara PARADA. Causa: a peca que troca de desenho tem um MonoBehaviour
do Spriter2UnityDX com `Sprites: [Face 01, Face 02, Face 03]` e um `DisplayedSprite` que guarda o INDICE do
que esta na tela; quem mexe nesse indice e uma curva de `m_FloatCurves` com `attribute: DisplayedSprite`.
`unity-prefab.js` so lia `m_Color.a` dali, entao o indice era ignorado.

NAO ha `m_PPtrCurves` nenhuma nesses pacotes -- conferido nos 18 clips do Skeleton Crusader, todas vazias.
Nao perca tempo procurando por ali.

- `unity-prefab.js` monta `spriteSetsByGameObject` (guid -> nome do PNG, via `guidToPathname`) e poe em
  `bone.spriteSet`; as curvas de indice viram `clip.spriteIndexCurves`.
- `computeClipLength` passou a contar `m_FloatCurves` tambem: um clip que so pisca (sem osso nenhum se
  mexendo) sairia com duracao 0 e nao tocaria.
- `sampleStepCurve` (`unity-clip-sampler.js`) amostra o indice em DEGRAU, nao com Hermite: entre o olho
  aberto e o fechado nao existe "meio olho".
- `computePose` troca so o `pngName` do item (`{...sprite, pngName}`), sem tocar no `bone.sprite` original.
- O caminho do `.scml` (prefab binario) ja fazia isso sozinho: cada key de timeline traz o proprio
  `imageName`. Nao precisou de nada la.
- Medido depois da correcao: Idle Blinking vai Face 02 -> Face 01 -> Face 02 (chaves em 0.00/0.10/0.60) e
  Hurt fica em Face 03 o clip inteiro.

## As 4 direcoes, cada uma com arte e ajustes proprios (`renderer/app.js`)

O padrao do VTT quer 4 linhas na ordem FIXA `NORTH, EAST, SOUTH, WEST` (`ROWS` em `src/vtt-standards.js`) --
o jogo descobre a direcao pelo NUMERO da linha, nao por rotulo. NORTH e WEST mostram as COSTAS, EAST e SOUTH a
FRENTE, e o par de espelho respeita isso: `SOUTH <- EAST` e `WEST <- NORTH` (`MIRRORED_FROM`). Nunca a linha 1
virando a linha 3 -- espelho so troca uma pela outra dentro de um par que ja mostra o mesmo lado da figura.

Duas entregas validas, `#sel-row-count`: **2 linhas** (so NORTH e EAST no arquivo, a Biblioteca espelha as
outras duas ao instalar) ou **4 linhas** (todas no arquivo). Uma direcao em modo `own` obriga as 4
(`currentRowCount`), porque um arquivo de 2 linhas nao teria onde carrega-la.

- `state.partOffsetsByRow` tem as 4; `state.partOffsets` e um getter/setter pro mapa da direcao em edicao
  (`state.previewRow`), entao arrastar/camadas/pivo/z-order/escala continuam iguais e valem so pra ela.
- A ARTE e INDEPENDENTE por direcao; so a POSE e que uma direcao espelhada herda da fonte. `state.images` e
  a base crua da Vector Parts e `state.rowArt[row]` (as QUATRO, EAST inclusive) poe por cima, peca a peca --
  `imagesForDisplayRow(row, clip)` empilha base -> rowArt[row] -> clipArt[row][clip], sem olhar a fonte.
  Motivo: trocar o escudo no EAST trocava tambem no SOUTH, e "o back de uma peca nao quer dizer que ela tem
  de estar com outras pecas back" -- o mesmo escudo pode ser de costas numa direcao e de frente na outra.
  Defaults por vista: NORTH e WEST (as duas de COSTAS) comecam com a arte `-back`/`Costas` que existir, EAST
  e SOUTH com a base. `hideFace` tira as pecas `Face*` quando a direcao mostra as costas E a cabeca foi
  trocada.
- `state.rowModes = {south, west}`: `'mirror'` (espelho da fonte, sem nada de seu) ou `'own'` (arte e ajustes
  proprios). `setRowMode` para 'own' copia os ajustes da fonte pra comecar igual; carregar arte numa direcao
  espelhada ja a torna propria sozinha. Direcao espelhada nao aceita arrasto (o que se ve ali e a fonte pelo
  avesso).
- O espelho e do CANVAS, nao da pose: `mirrorCell(ctx, axisX)` (`src/unity-skeleton.js`), celula por celula em
  torno do eixo do corpo, igual a Biblioteca -- espelhar a faixa inteira inverteria a ordem das colunas e
  tocaria a passada de tras pra frente. O preview usa o mesmo `mirrorCell`, entao tela e `.webp` batem.
- **TUDO e por ANIMACAO por padrao** (`state.editClipOnly` comeca LIGADO). Posicao, ordem das camadas, peca
  oculta e troca de arte vao pra camada do clip aberto: `state.clipOffsetsByRow[row][clip]` e
  `state.clipArtByRow[row][clip]`. Desligar a caixa "Ajustar so nesta animacao" faz a edicao cair na camada
  GERAL da direcao, que vale em todas -- e o que se usa pra calibrar a montagem de uma vez.
  Motivo de ser ligado por padrao (pedido do usuario): "se nao num vira ajuste vira um pesadelo" -- com 18
  clips, um ajuste que vaza pros outros nao e ajuste. O rotulo NAO nomeia o clip (nomear confundiu: parecia
  um ajuste especifico do Sliding em vez do "clip que estiver aberto").
  `effectiveOffsets(row, clip)` empilha, campo a campo, geral da direcao-fonte -> clip da fonte -> (se
  espelhada) geral e clip da propria linha; `imagesForDisplayRow(row, clip)` faz o mesmo com a arte. Preview
  e bake recebem o resultado ja somado, entao `bakeGrid` tem uma camada so (`rowSpec.partOffsets`).
  Quem LE a ordem pra reordenar/espelhar profundidade usa a EFETIVA, nao a camada que vai receber a escrita
  -- senao o primeiro arrasto dentro de uma animacao recalcula tudo a partir da ordem crua do `.scml` e as
  pecas saltam.
- SOUTH e WEST sao SEMPRE espelho (`sourceRowFor`/`isMirrored` so olham `MIRRORED_FROM`). Nao ha modo 'own'
  nem botao na barra da direcao: teve modo, "manter armas na mesma mao" e "virar braco do escudo", e tudo foi
  removido a pedido -- complicava mais do que resolvia. Quem quiser SOUTH desenhado troca a arte peca a peca.
- Direcao espelhada E EDITAVEL: os ajustes dela sao uma camada de CORRECAO (`overlayOffsets`) por cima dos da
  fonte; `offsetsForDisplay(row)` soma as duas pra camadas/hit-test, e o que se edita e so a de cima. Um sinal
  que ja mordeu: o hit-test desespelha o X do mouse (`canvasEventToLocalCraftpix` usa `state.lastCell.bodyAxisX`).
- **O que a mao segura acompanha a mao mais proxima na pilha** (`handTransplantsFor` + `applyHandTransplant`),
  sozinho, sem botao. Arma/escudo sao pecas SOLTAS no rig (animacao propria, nao penduram num osso de mao):
  ao reordenar as camadas de uma direcao a peca fica do lado da OUTRA mao e continuaria com a animacao da
  antiga, boiando no ar. A peca vira FILHA RIGIDA da mao nova: o encaixe e medido uma vez na pose de
  referencia (t=0, como ela estava na mao antiga, via `relativeTo` em `pose-math.js`) e recomposto quadro a
  quadro com `combine`. Medido: local x/y/angulo do escudo na mao nova ficam constantes em todos os frames.
  Quando a mao mais proxima nao mudou em relacao a pilha do `.scml`, nao ha transplante e nada muda.

  Nao adianta somar so a DIFERENCA entre as duas maos (foi a primeira tentativa e nao grudou): medido no
  Skeleton Crusader, no Walking a distancia do escudo pra qualquer osso varia de 60 a 150px -- ele nao esta
  preso na mao nem no braco, so foi animado pra parecer que esta. Somando a diferenca, o balanco proprio da
  peca continua por cima e ela segue solta.
- **Ocultar camada** (`hidden` no offset da peca -> `alpha = 0` em `applyManualOverrides`): por direcao, pro
  mesmo esqueleto sair com escudo no EAST e sem no SOUTH. Vale no preview e no bake.
- **Arrumacao padrao das 4 direcoes, no nivel do ESQUELETO** (`captureRowDefaults`/`applyRowDefaults` +
  `RigProfileStore.saveRowDefaults`): botao "Salvar arrumacao como padrao do rig". Guarda, por direcao, a
  ordem das camadas (`zIndex`), as pecas ocultas (`hidden`) e qual ARQUIVO cada peca usa -- pelo NOME, nao
  pelo caminho, porque no fluxo de skins o proximo personagem tem os PNGs dele com os mesmos nomes. Os
  proximos personagens do mesmo rig abrem ja arrumados; e o que torna viavel produzir centenas de skins.
  Guarda a camada geral E uma entrada por animacao (`clips[nomeDoClip]`), senao o que foi arrumado com a
  caixa ligada (o padrao) nao entraria.
  NAO entra dx/dy/angulo/pivo/escala/amortecimento: sao correcoes na arte de UM personagem, e herdar isso e
  exatamente o erro que o formato v1 cometia (comentario grande no topo de `src/rig-profile.js`).
  Ajuste do proprio personagem tem prioridade: o padrao do rig so e aplicado quando as 4 direcoes dele
  estao vazias.
- A lista de camadas mostra o ARQUIVO em uso (`artFileInUse`), nao o nome canonico da peca: depois de trocar
  Sword por Axe a linha diz `axe.png`. `state.rowArtFiles` guarda isso por direcao.
- Preview: um canvas por direcao (`#preview-canvas` e o de EAST, os outros `#preview-canvas-<row>`), "Lado a
  lado" mostra as QUATRO, mesmo na entrega de 2 linhas -- as quatro direcoes sempre chegam ao jogo, o que a
  entrega muda e so quem as desenha, voce ou a Biblioteca. As que nao vao no arquivo dizem isso no proprio
  rotulo da celula. Todas sao editaveis: mexer numa que nao ia obriga a entrega de 4 (`currentRowCount`).
  Clicar num canvas o torna o editado, e ele ganha um contorno AMARELO grosso -- o azul fino de antes se
  perdia no quadriculado, e ainda era cortado em cima/embaixo pelo `overflow` do viewport (daí o `padding`). Na TELA elas ficam em
  `PREVIEW_ORDER` (NORTH, WEST, SOUTH, EAST, via `style.order`), que e o personagem girando no proprio eixo
  em sentido anti-horario -- no ARQUIVO a ordem continua `ROWS`, que o padrao exige.
- Arte de cada direcao casa por nome tolerante (`matchRowArtFiles` em `src/back-art.js`:
  `left-arm-back.png` -> `Left Arm.png`, `head-elm-back` -> `Head`), vinda da subpasta da direcao
  (`Back/Costas`, `South/Sul`, `West/Oeste` -- `ROW_ART_DIRNAMES`) ou solta na `Vector Parts` com o sufixo
  (`ROW_ART_SUFFIXES`).
- Perfil salva `partOffsetsByRow` + `rowModes` + `rowCount`, e repete EAST/NORTH nas chaves antigas
  (`partOffsets`/`partOffsetsNorth`) pra ir e voltar entre versoes -- `characterOffsetsByRow` le os dois.

Desfazer/refazer: `pushUndo(key)` (app.js) tira snapshot dos `partOffsetsByRow` ANTES de cada mutacao (arrasto, campos
numericos -- agrupados por `key` --, reordenar camadas, seguir, resetar); Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. Nao cobre troca de
arte. Selecao multipla: `state.multiSel` (Set); Shift+clique no preview/camadas soma/tira; arrastar move o grupo pelo mesmo
delta (pecas que ja seguem uma selecionada via `followBone` sao puladas pra nao contar em dobro).

Ordem de camadas das direcoes de costas (NORTH/WEST): o default vem do `.scml` e e o MESMO do EAST, o que esta errado pra vista de costas
(braco/mao/escudo do lado de ca deveriam ficar ATRAS do corpo). Botao "Espelhar profundidade"
(`mirrorDepthForBackView`, so aparece editando uma direcao de costas e editavel) inverte a lista toda menos
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
