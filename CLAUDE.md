# Contexto para o Claude Code neste repositorio

Isso resume uma sessao longa de diagnostico e correcao feita fora daqui (Cowork), pra qualquer sessao do
Claude Code aberta nesta pasta comecar sabendo o que ja foi investigado, em vez de redescobrir. Detalhes
completos de cada bug estao comentados nos proprios arquivos citados abaixo -- este arquivo e o indice.

## Estado do repositorio agora

Arvore LIMPA e em sincronia com `origin/master` (ultimo commit: a troca de lados completa nas direcoes
espelhadas -- profundidade, ombro e escudo). Rode `git status` pra confirmar antes de assumir.

`scratch-*` e ignorado pelo git: use esse prefixo (ou o diretorio temporario da sessao) pra qualquer
arquivo de teste. Ja houve um `scratch-msg.txt` commitado por engano com `git add -A` -- adicione os
arquivos pelo NOME, nunca `-A`.

O QUE ESTA EM ABERTO:
1. **Ombro do WEST** no `Maia Chibi/Skeleton_Crusader_1`: o usuario relatou que precisa de "alguns pixels
   pra esquerda". E caracteristica da arte de costas DELE, nao do rig -- o ajuste e arrastar no WEST e
   apertar "Salvar padrao do rig (camadas + posicoes)".

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

Pra MEDIR o que o app faz (em vez de olhar a tela): `window.__studio` no fim de `renderer/app.js` expoe
`state`, `computePoseFn`, `effectiveOffsets`, `currentLayers`, `rowsFor` e companhia. O renderer inteiro
vive numa IIFE, entao sem isso um teste so consegue conferir por pixel -- e afirmacao como "a espada
acompanha o braco do golpe" precisa de numero. Um harness Electron (nos moldes de `scripts/electron-shot.js`)
abre o app, carrega o personagem e roda um `executeJavaScript` que le esse objeto. A UI nao usa nada dali.

`node scripts/check-side-depth.js "<pasta com pacotes>" [--detalhe]` le so o `.scml` de cada personagem
(nome + z_index de cada peca) e roda a regra de lado/profundidade em cima disso. Serve pra responder "isso
vale pros meus outros personagens?" com numero em vez de achismo, e pra flagrar um pacote com nomenclatura
diferente antes de abrir ele no app.

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

`findArtOnlyDir` (`src/craftpix-profile.js`) aceita os PNGs soltos na pasta escolhida, em `PNG/Vector Parts`,
em `PNG/` ou em `Vector Parts/`. `PNG/` sozinho entrou na lista porque e onde o Corel despeja a exportacao:
sem ele, uma pasta assim nao carregava e o app nao dizia por que (caso real: `Maia Chibi/Golem_01`, com a
arte e os `*-back.png` direto em `PNG/`). `PNG/Vector Parts` e testado ANTES pra nao confundir com o `PNG/`
de um pacote Craftpix completo, que guarda folha de sprite e nao peca. A arte de costas e de cada personagem: `*-back.png` na propria pasta dele (o template
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

## Ordem de camadas e POR ANIMACAO E POR INSTANTE (`src/scml-zorder.js`)

O Spriter deixa a ordem de desenho ser diferente em qualquer ponto da timeline (manual do Spriter Pro 1.4,
"Adjusting the Z Order of Sprites"). `getZIndexByPartName` le so a primeira key da primeira animacao: isso
serve de REFERENCIA (e o que a lista de camadas mostra) e NAO serve pra desenhar.

`buildZOrderIndex` monta o indice completo (por animacao, as ordens ao longo do tempo) e `zIndexAt` devolve
a vigente em t -- em DEGRAU, nunca interpolada, porque entre uma ordem e outra nao existe meia ordem. Quem
chama e `computePoseFn` (`renderer/app.js`), entao preview e bake seguem juntos. O caminho do `.scml`
(`mainlineKeyAt` em `src/scml-rig.js`) ja fazia isso certo desde sempre; o furo era so no caminho do Unity.
Ajuste manual de zIndex continua ganhando -- `applyManualOverrides` roda depois.

Medido na biblioteca do usuario (1916 animacoes, 106 personagens):
- **6 trocam a ordem NO MEIO da animacao**: `Demons_of_Darkness_1`, `Demons_of_Darkness_3` e `Lich`, nos
  clips Slashing e Throwing -- o braco direito sobe e passa na frente da cabeca. Conferido dentro do app
  depois da correcao: no Lich, exatamente esses 2 clips mudam e os outros 16 nao.
- **57 tem ordem fixa porem diferente da referencia**: sao os 3 pacotes que trazem as 4 vistas no proprio
  `.scml` (ver abaixo), onde cada vista tem a pilha dela.

## Duas GERACOES de pacote Craftpix -- e so uma precisa da invencao de costas

Varredura dos 106 personagens do usuario (`scripts/check-side-depth.js` mostra os nomes; a varredura de
vistas foi feita a mao sobre `parseSCML`):
- **103 sao de vista unica.** Nao existe arte de costas no pacote. NORTH/WEST sao inventados aqui a partir
  do rig de frente + a arte de costas que o usuario desenhar. E toda a maquinaria de espelho, troca de
  lados em profundidade e `rowDefaults` existe por causa deles.
- **3 trazem as 4 vistas nativas** (`Assassino`, `Ladrao Pirata Ladino/Robber`, `Ladrao Pirata Ladino/Thug`):
  24 animacoes nomeadas `Front - Idle`, `Right - Walking`, `Back - Attacking`, `Left - Hurt`..., 49 PNGs com
  arte por vista (`Body - Back.png`, `Head - L View.png`, `Right Arm - R View.png`) e uma pilha de camadas
  por vista. Pra esses, NADA precisa ser inventado: `NORTH <- Back`, `EAST <- Right`, `SOUTH <- Front`,
  `WEST <- Left`, cada um com a arte e o z-order dele, sem espelho nenhum.
  **O app faz esse mapeamento** -- ver a secao abaixo.

## Pacote com as 4 VISTAS nativas (`src/native-views.js`)

`detectarVistasNativas(nomesDeAnimacao)` devolve `{north:'back', east:'right', south:'front', west:'left'}`
quando o pacote tem as quatro, e `null` quando falta alguma -- meio caminho nao serve, e com duas vistas
desenhadas e duas faltando o certo e continuar no fluxo normal (espelho + arte de costas) em vez de
misturar os dois. Guardado em `state.nativeViews`, e dali:
- `sourceRowFor(row)` devolve a propria linha e `isMirrored(row)` devolve false: cada direcao e DESENHADA.
  O arranjo (`#sel-mirror-pairing`) nao se aplica.
- `clipParaLinha(row, clipBase)` troca a vista mantendo a base: o seletor diz "Idle" e o NORTH toca
  `Back - Idle`, o WEST toca `Left - Idle`. `clipPorNomeOuBase` aceita os dois no caminho inverso.
- `basesComuns` alimenta o seletor de animacao com as BASES comuns as quatro vistas (5 opcoes em vez de
  24). Uma base que falte em alguma vista fica de fora de proposito -- nesses pacotes o `Back` nao tem
  "Idle Blinking", e oferecer ela deixaria uma linha vazia no bake.
- Espelho, troca de lados em profundidade, troca de ombro, arte de costas por sufixo e o escudo-por-lado
  ficam TODOS desligados. A arte de cada direcao ja vem dentro da animacao dela (a timeline do clip
  `Back - Idle` referencia `Body - Back.png`), entao `state.rowArt` fica VAZIO -- e isso e o esperado, nao
  sintoma de nada.

## Pasta com RIG PROPRIO sem `.unitypackage` (`detectRigProprioSemUnity`)

Dois tipos de pacote caem aqui, e nenhum dos dois tem `.unitypackage` -- so AI/EPS/PNG com o `.scml`:
- os tres de 4 vistas acima (as pecas se chamam `Body - Front.png`, nao `Body.png`);
- os de **CRIATURA**. Testado com o pack gratuito `free-monster-enemy-sprites-for-tower-defense`: 10
  monstros, 3 a 7 pecas, animacoes `Idle / Attack / Walking ou Fly / Jump ou Fall / Dying` -- cinco deles
  voadores. Mesma estrutura `Monster_N/PNG/Vector Parts/Animations.scml` dos chibis.

Sem isto os dois caiam no rig EMPRESTADO: o app jogava fora o `.scml` deles, montava o esqueleto humanoide
do template e avisava "faltam 8 pecas", prendendo a arte de um mosquito num cavaleiro.

A condicao NAO pode ser so "tem `.scml`", porque a pasta so-de-PNG do usuario tambem costuma ter um
`Animations.scml` junto e ali o certo continua sendo emprestar. O discriminador e MEDIDO: **o `.scml` da
pasta tem alguma ANIMACAO que o template nao tem?**
- `Maia Chibi/Golem_01`: as mesmas 18 do Skeleton Crusader -> e copia do mesmo rig, emprestar ou usar o
  proprio da no mesmo, entao nao se mexe (conferido: inalterado depois da mudanca).
- `Monster_1`: tem `Attack`/`Fly`/`Fall`, que o template nao tem -> e outro bicho, literalmente.

Alem disso o `.scml` precisa ser AUTO-SUFICIENTE: toda peca que ele cita existe na pasta. Um `.scml` orfao,
sem a arte, nao e rig nenhum.

LIMITE que nenhum codigo resolve: esses pacotes nao tem arte de costas, entao NORTH sai igual a EAST e WEST
igual a SOUTH. Pra criatura e pior que pra humanoide -- um inseto visto de tras nao e a lateral espelhada,
e a maquinaria de ombro/escudo/mao-da-arma nao se aplica (ele nao tem maos). Quatro direcoes de verdade
exigem alguem desenhar as costas.

Os pseudo-bones do modo scml passaram a ser amostrados em TODOS os clips, nao so no primeiro: aqui cada
vista tem as timelines dela (`Body - Front` e `Body - Back` sao pecas diferentes), entao uma animacao so
revelaria um quarto das pecas.

Dois bugs que so apareceram medindo o `.webp`, nao olhando a tela:
- `bakeGrid` tratava NORTH/WEST como PLACEHOLDER quando `state.rowArt` da direcao estava vazio, e trocava o
  clip deles pelo do EAST. Resultado: as tres linhas saiam **pixel-identicas** no arquivo (medido: 0.00% de
  diferenca) enquanto o preview mostrava as quatro certas. `ownArt` em `rowsFor` agora e true pra toda
  linha quando ha vistas nativas.
- `computeScmlBounds` media o RETANGULO CHEIO do PNG. Nesses pacotes 40-60% da imagem e moldura
  transparente, entao o auto-fit encolhia o personagem a um quarto da celula. Passou a aceitar
  `alphaBoxes`, igual `computeAnimatedBounds` do caminho do Unity ja fazia: medido no Assassino, bounds de
  320x370 viraram 178x295 e a escala foi de 0.748 pra 1.000. Vale pra TODO pacote em modo scml (inclusive
  os de prefab binario), nao so pros de 4 vistas.

Medido no bake do Assassino depois da correcao: as quatro linhas DIFERENTES entre si (1.3 a 1.8% dos
pixels), escala 1.000, `north=Back - Idle`, `east=Right - Idle`, `south=Front - Idle`, `west=Left - Idle`,
`mirror=false` nas quatro.

## As 4 direcoes, cada uma com arte e ajustes proprios (`renderer/app.js`)

O padrao do VTT quer 4 linhas na ordem FIXA `NORTH, EAST, SOUTH, WEST` (`ROWS` em `src/vtt-standards.js`) --
o jogo descobre a direcao pelo NUMERO da linha, nao por rotulo. NORTH e WEST mostram as COSTAS, EAST e SOUTH a
FRENTE, e o par de espelho respeita isso. Nunca a linha 1 virando a linha 3 -- espelho so troca uma pela
outra dentro de um par que ja mostra o mesmo lado da figura.

De onde cada linha tira a ANIMACAO, e se a celula sai espelhada, e escolha do usuario
(`#sel-mirror-pairing`, `ARRANJOS` em `src/vtt-standards.js`, salvo no nivel do ESQUELETO). A ARTE e sempre
da propria linha, nunca da fonte -- as de costas continuam com as pecas de costas em qualquer arranjo.
- `padrao`: desenha NORTH e EAST; `SOUTH <- EAST` e `WEST <- NORTH` espelhados. E o que a folha de padroes
  descreve pra entrega de 2 linhas.
- `costas-desenhadas`: desenha NORTH e SOUTH; `WEST <- NORTH` e `EAST <- SOUTH`. Obriga 4 linhas -- a
  Biblioteca so sabe espelhar NORTH e EAST, e o SOUTH desenhado nao caberia num arquivo de 2.

**FONTE NUNCA PODE SER ESPELHADA** -- `check-renderer-wiring.js` recusa. Quem deriva de uma fonte le os
ajustes dela (`effectiveOffsets`), e a correcao automatica do espelho e gravada na linha espelhada. Se a
mesma linha for as duas coisas, a correcao dela vaza pra quem deriva. Aconteceu: `costas-desenhadas` estava
escrito `east: ['east', true]` + `south: ['east', false]`, e a troca de ombro do EAST empurrava os bracos do
SOUTH 139px pro lado. O certo e a linha DESENHADA ser a fonte: `south: ['south', false]` +
`east: ['south', true]`.
- `trocar-east-west`: parte do padrao e TROCA a animacao entre EAST e WEST. O WEST roda a animacao que era
  do EAST (com a arte de costas dele) e o EAST a que era do WEST.

**A ARMA FICA SEMPRE NA MESMA MAO**, automatico em toda linha ESPELHADA. O que muda e so a PROFUNDIDADE
dos dois lados do corpo (`src/side-depth.js`, aplicado por `applySideSwapDepth` em `renderer/app.js`) -- a
animacao de peca nenhuma e tocada.

A regra mora em `src/side-depth.js`, fora do renderer, porque ela so depende de uma LISTA DE NOMES na ordem
de desenho -- nada de DOM, canvas ou imagem. E o que permite `node scripts/check-side-depth.js "<pasta>"`
rodar a mesma regra numa biblioteca inteira em segundos e dizer, ANTES de abrir o app, em quais personagens
ela decide sozinha. Medido na biblioteca do usuario: 106 personagens Craftpix, 106 com a troca automatica.
Os unicos nomes de peca segurada que aparecem em toda ela sao SlashFX, Sword, Weapon, Shield, Bow e Arrow;
so 3 personagens nao seguram nada (e ai nao ha mao pra manter).

O espelho do canvas troca esquerda/direita na TELA e nao mexe na profundidade: o braco que estava atras do
corpo continua atras, e ai o personagem vira canhoto de um lado e destro do outro. Em vista lateral: o
canhoto olhando pro EAST tem o lado esquerdo virado pra LONGE da camera (e por isso a Craftpix entrega as
pecas "Left *" com z baixo, atras do corpo); olhando pro outro lado, o MESMO lado esquerdo fica virado PRA
camera, e a mesma espada, na mesma mao, tem que aparecer NA FRENTE do corpo.

- Sao DUAS trocas, nao uma. **Profundidade** (o bloco muda de lugar na pilha) E **OMBRO** (o bloco muda de
  lugar sobre o corpo, em x). Os dois ombros nao estao no mesmo ponto: medido no Skeleton Crusader, o braco
  da arma nasce a 166px do pivo do corpo e o do escudo a 27px -- 139px de distancia. Quando a perspectiva
  vira, o braco que era o de tras passa a ser o da frente e tem que se encaixar NO OMBRO DO OUTRO; sem isso
  ele vem pra frente do corpo ainda pendurado no ombro de tras e cobre o corpo no lugar errado. So `dx`, e
  so o bloco braco+mao+objeto: em y os dois ombros diferem 6px (ruido de perspectiva) e as pernas nascem
  praticamente no mesmo x. A medida sai de `ombrosEmX()` na pose de referencia (clip "Base", senao "Idle").

  O deslocamento NAO e um `dx` fixo: e um vetor PRESO AO CORPO (`shoulderSwap` no offset ->
  `shoulderSwapDelta` em `src/unity-skeleton.js`). Guardar como dx travaria o braco num ponto do ESPACO em
  vez de num ponto do CORPO -- quando o corpo gira durante a animacao, o ombro sai do lugar. O que fica
  gravado e o vetor medido na referencia MAIS o estado do corpo naquela hora (angulo e escala), e a cada
  quadro ele e recomposto com o estado do corpo AGORA. O corpo e lido da pose que ENTRA em
  `applyManualOverrides`, antes dos ajustes manuais: a escala manual de uma peca muda so o desenho dela e
  nao propaga pela hierarquia, entao nao pode entrar nesta conta.
  Medido no Slashing do Skeleton Crusader (o corpo gira 17 graus): o vetor mantem 139.3px de tamanho em
  TODOS os instantes e gira exatamente junto com o corpo; o movimento proprio do braco fica intacto
  (diferenca 0.00px). Com dx fixo o braco chegava a 34.6px fora do ombro no pico do golpe.
- Cada bloco (braco + mao + o que ela segura) troca de slot INTEIRO, mantendo a ordem interna. Por BLOCO e
  nao posicao por posicao: aqui o bloco da arma tem 4 pecas (SlashFX + Sword + Left Hand + Left Arm) e o do
  escudo 3, e preenchendo slot a slot o SlashFX sobrava sozinho na regiao do outro bloco -- medido, a
  amplitude de x dele saltava de 0 pra 57px, ou seja, passava a balancar com o braco errado.
- As pernas trocam de lado entre elas, numa passada propria: no `.scml` elas ficam coladas no bloco de um
  dos bracos, e numa passada so o bloco sairia grudado nelas.
- A ordem sai gravada como `zIndex` nos ajustes da PROPRIA linha espelhada, no load, e so quando ela ainda
  nao tem ajuste nenhum (ajuste do personagem manda, igual ao resto). Dali pra frente e ordem do usuario:
  arrastavel, Ctrl+Z desfaz, "Salvar camadas como padrao do rig" leva pros proximos personagens.
- Isso OBRIGA a entrega de 4 linhas (`temAjuste` -> `currentRowCount`): a Biblioteca sabe espelhar, nao sabe
  trocar os lados, entao num arquivo de 2 linhas o personagem sempre troca de mao ao virar.
- Confere com o que o usuario pediu a mao antes de existir automacao nenhuma: bloco `Right Arm + Right Hand
  + Shield` "na base" no SOUTH e "no topo" no WEST. E confere com a ordem do NORTH que ele aprovou -- entre
  a vista de frente e a de costas os dois lados tambem trocam de profundidade (`backViewDepthOrder`).
- Medido (Slashing, Skeleton Crusader, perfil limpo): amplitude de x da `Sword` = 141px e da mao da arma =
  103px nas QUATRO direcoes, `Shield` = 10px nas quatro, zero transplantes. Em toda direcao a espada
  acompanha a mao que da o golpe e o escudo continua com o balanco dele.

NAO troque a ANIMACAO entre os dois membros. Foi a tentativa anterior (`swapLimbTransforms`, removida):
trocando os transforms, quem se mexe e a arte ERRADA -- o braco da espada passa a fazer o movimento parado
do braco do escudo e a espada para de acompanhar o golpe. Nao tem compensacao possivel, porque o problema
nao e de posicao, e de qual arte recebe qual movimento.

MAIN HAND (a da arma) e OFF HAND (a do escudo), nao esquerda/direita: e o vocabulario que o usuario pediu e
e como a lista de camadas rotula braco e mao (`rotuloDaCamada`, so o ROTULO -- o nome do osso continua sendo
a chave em todo lugar). Quem e quem sai de `maoDaArma()`: primeiro pelo NOME do osso da peca segurada
(`WEAPON_WORDS`/`SHIELD_WORDS`; o nome do osso nao muda quando o usuario troca a arte, Sword -> Axe.png), e
so se nenhum nome for reconhecido e que vai pela medida. E a medida olha a MAO, nao a peca: no Slashing a
mao da espada tem 103px de amplitude contra 37px da do escudo, mas as PECAS dao espada 141 e escudo 140 (o
escudo viaja junto com o corpo no golpe), entao pela peca da quase empate e as vezes inverte -- foi o que
aconteceu na primeira versao, que apontou a mao do escudo como Main Hand.

Ha tambem uma caixa "Espelhar peca" por peca (`flipX` no offset -> `sprite.flipX` em
`applyManualOverrides`), pro efeito de corte: o arco tem direcao propria e pode ficar apontando pro lado
contrario do golpe depois de uma troca de arte. Nao e usada por automacao nenhuma, e correcao na mao.

Por que o ARRANJO (`#sel-mirror-pairing`) continua sendo escolha e nao regra fixa: com as costas
DESENHADAS, qual par de direcoes vale a pena desenhar depende de como o artista desenhou -- isso nao da pra
deduzir do rig. Ja foram tentadas e removidas quatro automacoes pra lateralidade (modo 'own' por direcao,
"manter armas na mesma mao", "virar braco do escudo" e a troca de animacao entre os bracos); a que ficou e a
de profundidade, acima. Quem olha decide o resto.

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
  e SOUTH com a base. **O ESCUDO e a excecao**, e segue o LADO DO CORPO em que o braco dele ficou, nao a
  direcao (`arteDoEscudoPorLado` + `ladoDaCamera`/`ehEscudo` em `src/side-depth.js`): um escudo e uma chapa
  presa no antebraco com a face apontando pra fora do corpo, entao quando o braco dele e o mais perto da
  camera e a FACE que aparece, e quando e o de tras aparece o verso. Resultado, que e exatamente como o
  usuario resumiu: "East usa o back do escudo, South a frente, West a frente, North o back". Vale nos dois
  sentidos -- numa direcao de FRENTE o escudo pode ir buscar o `shield-back`, e numa de COSTAS pode voltar
  pra arte base.
  Pelo mesmo motivo o escudo vai pra FRENTE do bloco dele nas direcoes espelhadas (`posicionarEscudoNoBloco`):
  ele cobre o proprio braco. A ARMA nao -- ela e segurada pelo punho e a mao passa por cima do cabo, que e
  por que `backViewDepthOrder` empurra o que e segurado pro fundo do bloco. `hideFace` tira as pecas `Face*` quando a direcao mostra as costas E a cabeca foi
  trocada.
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
- `sourceRowFor`/`isMirrored` so olham o pareamento em uso. Nao ha modo por direcao nem botao na barra: teve
  modo 'own', "manter armas na mesma mao", "virar braco do escudo" e uma troca de lateralidade entre os
  bracos, e TUDO foi removido a pedido -- complicava mais do que resolvia, e nenhum deles resolvia a
  lateralidade de verdade. O que resolveu foi deixar o usuario escolher QUAL par e desenhado.
- Direcao espelhada E EDITAVEL: os ajustes dela sao uma camada de CORRECAO (`overlayOffsets`) por cima dos da
  fonte; `offsetsForDisplay(row)` soma as duas pra camadas/hit-test, e o que se edita e so a de cima. Um sinal
  que ja mordeu: o hit-test desespelha o X do mouse (`canvasEventToLocalCraftpix` usa `state.lastCell.bodyAxisX`).
- **O que a mao segura acompanha a mao mais proxima na pilha** (`handTransplantsFor` + `applyHandTransplant`),
  sozinho, sem botao. Arma/escudo sao pecas SOLTAS no rig (animacao propria, nao penduram num osso de mao):
  ao reordenar as camadas de uma direcao a peca fica do lado da OUTRA mao e continuaria com a animacao da
  antiga, boiando no ar. A peca vira FILHA RIGIDA da mao nova: o encaixe e medido uma vez na pose de
  referencia (t=0, como ela estava na mao antiga, via `relativeTo` em `pose-math.js`) e recomposto quadro a
  quadro com `combine`. Medido: local x/y/angulo do escudo na mao nova ficam constantes em todos os frames.

  So dispara quando as DUAS maos trocaram de lugar na pilha (`maos(cru) === maos(agora)` -> `null`). Mover
  UMA peca sozinha e ajuste de PROFUNDIDADE, nao troca de mao: o escudo continua na mao em que foi animado,
  so passou pra tras do corpo. Sem essa trava, arrumar a profundidade do escudo no EAST o reancorava na mao
  da espada e ele passava a balancar junto com o golpe -- medido, 140px de amplitude em vez dos 10px que ele
  tem. A troca automatica de lados nas linhas espelhadas move o bloco braco+mao+objeto inteiro, entao a mao
  mais proxima continua a mesma e nao ha transplante nenhum ali.

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
  A arte e gravada pra TODAS as pecas, inclusive as que usam o nome base. Pular as "iguais ao base" parecia
  economia e era bug: voltar o escudo do WEST pra `Shield.png` E uma escolha (direcao de costas comeca com
  `shield-back` por padrao), e descartando ela o proximo personagem voltava sozinho pro `-back`.

  **ENTRA dx/dy/angulo/pivo/escala/amortecimento tambem** (botao "Salvar padrao do rig (camadas +
  posicoes)"). Isso contraria o v1 de proposito, e as duas situacoes so PARECEM iguais -- se voce esta
  lendo isto pensando em "consertar", leia o paragrafo inteiro antes. O v1 guardava os ajustes no nivel do
  ESQUELETO, aplicava sozinho em todo mundo e regravava a cada bake: um ajuste num personagem chegava
  desmontando os outros, sem ninguem pedir e sem sinal nenhum. Aqui e um BOTAO que o usuario aperta, so
  entra em personagem sem ajuste proprio nenhum, o log diz quantas pecas vieram com posicao, a lista de
  camadas MARCA quem tem ajuste (`resumoDoAjuste` -> `x+24 y+11`, em amarelo) e "Zerar ajustes desta
  direcao" (`onResetRow`) desfaz.

  O motivo de precisar existir: as vistas de COSTAS **nao existem** nos pacotes Craftpix. Elas sao
  inventadas aqui a partir do rig de frente, e os ajustes que fazem a invencao fechar (o corpo sentar X px
  mais baixo, a cabeca de costas ser 6% menor, o escudo sair da mao ao virar) sao propriedade do RIG e da
  convencao de arte de costas, nao daquele personagem. No fluxo de skins todo mundo do mesmo rig tem os
  PNGs com os mesmos nomes e o mesmo tamanho de tela, entao a geometria bate. Sem herdar isso, produzir
  centenas de personagens quer dizer refazer o mesmo ajuste centenas de vezes -- que e exatamente o que o
  app existe pra evitar.
  Medido: com o padrao salvo no Skeleton_Crusader_1, o Skeleton_Crusader_2 abriu com as 9 pecas ajustadas
  identicas nas 4 direcoes, mais 30 pecas de arte por direcao.

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
