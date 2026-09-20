# Isometric Character Studio

App desktop (Electron) que converte personagens Chibi da Craftpix (pacotes com
`PNG/Vector Parts/Animations.scml` + `Unity Package/*.unitypackage`) para o
formato de spritesheet exigido pelo VTT **Isometric Tactics**
(`idle.webp` / `walk.webp`, grid por direcao, celulas fixas 1x1/2x2/3x3).

## Como rodar

```bash
npm install
npm start
```

Ou de dentro do Explorer: `Iniciar App.bat` na raiz do repo.

## De onde vem a animacao de verdade

**Correcao (14/09/2026): a afirmacao anterior deste README de que o `.scml` so tem uma pose estatica
"Base" estava ERRADA** -- verificado byte a byte contra varios pacotes (Bloody Alchemist, Pumpkin Head Guy,
Goblin). O `.scml` tem as animacoes completas (17 a 18 clips, com keyframes reais de posicao/angulo/escala
por osso), e o `.scml` embutido dentro do proprio `.unitypackage` e identico (mesmo md5) ao que acompanha
o pack solto.

O app le a animacao primeiro pelo caminho do Unity (`.unitypackage` -> `.prefab` YAML -> `AnimationClip`).
Esse caminho funciona quando o `.prefab` foi exportado como YAML texto, mas pacotes mais antigos (Unity
~2017: Archer Guy, Medieval Mage, Barbarian Warrior, Pumpkin Head Guy) trazem o `.prefab` serializado em
BINARIO, e o parser devolve 0 ossos/0 clips. Nesse caso o app cai sozinho pro `src/scml-rig.js`, que le
direto do `.scml` (sempre XML texto, nunca falha por isso).

## Arquitetura

- `src/unity-package.js` -- extrai o `.unitypackage` (gzip+tar) e mapeia guid -> pathname
- `src/unity-yaml.js` -- parser do YAML serializado do Unity (fileIDs sao inteiros de 64 bits, maiores que `Number.MAX_SAFE_INTEGER` -- tratados como string)
- `src/unity-prefab.js` -- monta a hierarquia de ossos (GameObject+Transform+SpriteRenderer) e extrai os `AnimationClip`. `PIXELS_PER_UNIT=100` (nao mude -- ver comentario no arquivo, era 50 como curativo de um bug de pivo ja corrigido)
- `src/unity-clip-sampler.js` -- avaliacao Hermite das curvas (posicao + quaternion) no tempo `t`
- `src/unity-skeleton.js` -- compoe o transform mundial de cada osso e desenha os sprites anexados num canvas (`drawPose`/`computePose`/`computeAnimatedBounds`/`applyManualOverrides`) -- o modulo mais sensivel do projeto, ver comentario grande sobre a convencao de pivo do Spriter ali dentro antes de mexer
- `src/scml-parser.js` -- le o `.scml`: pivot/dimensao de cada PNG, `z_index` de camadas (o Unity exporta `m_SortingOrder=0` pra tudo nesses pacotes) e as animacoes completas
- `src/scml-rig.js` -- pose/animacao direto do `.scml`, sem depender do `.unitypackage`. E o fallback automatico quando o `.prefab` e binario (Archer Guy, Medieval Mage, Barbarian Warrior...)
- `src/alpha-bounds.js` -- mede a caixa de pixels realmente opacos de cada PNG (a moldura exportada pela Craftpix tem 40-60% de ar), usada pelo auto-fit de escala
- `src/back-art.js` -- merge de imagens de costas (opcional) com as da frente, peca a peca, pra linha NORTH do bake
- `src/craftpix-profile.js` -- detecta a estrutura "craftpix-classic", aplica o mapeamento default de animacoes (`Idle`->idle, `Walking`->walk) e detecta a subpasta opcional de arte de costas (`Vector Parts/Back` ou `Costas`)
- `src/rig-profile.js` -- fingerprint do rig (nomes de ossos + hierarquia). Formato de saida (tamanho/frames) e herdado por TODOS os personagens do mesmo esqueleto; ajustes manuais por peca ficam isolados por nome de personagem (`characters[nome]`) -- NUNCA vazam entre personagens, mesmo do mesmo rig
- `src/baker.js` + `src/vtt-standards.js` + `src/validate.js` -- monta o grid final e valida contra o padrao do VTT (`fitScaleForBounds` calcula a escala que faz o personagem caber na celula, so reduz, nunca amplia)
- `scripts/check-renderer-wiring.js` -- roda sem abrir o Electron; confere que todo `getElementById` do renderer acha um id real no `index.html`, todo import de `src/` existe de verdade e todo canal IPC tem handler. Rode depois de qualquer mudanca em `renderer/*.js` ou `index.html`
- `scripts/export-part-templates.js` -- gera, a partir do `.scml` de um personagem-base, um PNG-guia por peca (tamanho exato + cruz no pivo + fantasma da arte original) pra usar como template num software de vetor

## Producao de skins em escala (varios personagens, mesmo rig)

Pra desenhar centenas de personagens reaproveitando o mesmo esqueleto/animacao: duplique a pasta do
personagem-base inteira e troque so os PNGs em `PNG/Vector Parts/`, mantendo o MESMO NOME DE ARQUIVO e o
MESMO TAMANHO DE CANVAS de cada peca (o app desenha com `drawImage(img, x, y, w, h)` usando w/h do `.scml`,
nao o tamanho real do PNG -- arte de dimensao diferente sai esticada). `Animations.scml` e o
`.unitypackage` nao mudam entre skins, sao o rig compartilhado. Use `scripts/export-part-templates.js` pra
gerar os guias de canvas/pivo de cada peca antes de desenhar.

Pra arte de costas de verdade (nao mirror): crie `PNG/Vector Parts/Back/` (ou `Costas/`) com PNGs dos
mesmos nomes -- pode ser parcial, so as pecas que voce redesenhar sao usadas, o resto cai pra arte da
frente automaticamente.

## Uso

1. `npm start`
2. **Selecionar pasta do personagem** -> escolha a pasta de UM personagem (ex: `Esqueletos/Skeleton_Crusader_1`), nao a biblioteca inteira
3. O app detecta o perfil, extrai o `.unitypackage` e lista os clips reais disponiveis
4. Confira/ajuste o mapeamento Idle/Walk; a **escala** dentro da celula e calculada automaticamente pro tamanho VTT escolhido (1x1 por padrao), ajuste fino se quiser
5. **Bake** -> escolha a pasta de saida -> gera `idle.webp` e `walk.webp` dentro de `<saida>/<nome-do-personagem>/`
6. O formato de saida (tamanho/frames) fica salvo por assinatura de rig e e herdado pelos proximos personagens da mesma serie; ajustes manuais por peca ficam isolados por personagem

## Limitacoes conhecidas

- Pacotes com `.prefab` binario carregam pelo `.scml` (fallback automatico), mas nesse modo o amortecimento de balanco (Damp X/Y/Angulo) ainda nao tem efeito
- So Idle/Walk sao bakeados por padrao; os outros clips (Slashing, Running, Dying, etc.) existem no rig mas nao tem botao dedicado de export
- FX/arma com alpha animado por clip (`m_FloatCurves`) ainda nao e lido -- partes como Sword/SlashFX usam so o alpha da pose de bind
