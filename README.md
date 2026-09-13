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

## Descoberta central: de onde vem a animacao de verdade

O `Animations.scml` desses pacotes **nao contem as animacoes** (Idle,
Walking, Slashing...) -- ele so tem uma unica pose estatica de referencia
("Base"), usada pelo Spriter2UnityDX para montar o rig. As animacoes de
verdade (curvas de rotacao/posicao por osso, com timing real) estao
**embutidas no `.unitypackage`**, dentro do `.prefab` gerado pelo
Spriter2UnityDX, como `AnimationClip`s nativos do Unity serializados em YAML
texto. `src/unity-yaml.js` faz o parse desse formato (documentos `--- !u!ID
&fileID` concatenados), `src/unity-prefab.js` reconstroi a hierarquia de
ossos e os clips, e `src/unity-clip-sampler.js` reimplementa a interpolacao
Hermite do Unity para amostrar qualquer instante `t` de qualquer clip.

Isso significa que o app usa a animacao **real** (18 clips: Idle, Walking,
Running, Slashing, Dying, etc.), nao uma reconstrucao aproximada nem os
frames ja renderizados em PNG Sequences (que so existem para 1 direcao e um
numero fixo de frames escolhido pela Craftpix).

## Arquitetura

- `src/unity-package.js` -- extrai o `.unitypackage` (gzip+tar) e mapeia guid -> pathname
- `src/unity-yaml.js` -- parser do YAML serializado do Unity (cuidado: fileIDs sao inteiros de 64 bits, maiores que `Number.MAX_SAFE_INTEGER` -- sao tratados como string)
- `src/unity-prefab.js` -- monta a hierarquia de ossos (GameObject+Transform+SpriteRenderer) e extrai os `AnimationClip`
- `src/unity-clip-sampler.js` -- avaliacao Hermite das curvas (posicao + quaternion) no tempo `t`
- `src/unity-skeleton.js` -- compoe o transform mundial de cada osso e desenha os sprites anexados num canvas
- `src/scml-parser.js` -- le o `.scml` so para pivot/dimensao de cada PNG e para o `z_index` de camadas (o Unity exporta `m_SortingOrder=0` pra tudo nesses pacotes; a ordem real vem do `.scml`)
- `src/craftpix-profile.js` -- detecta a estrutura "craftpix-classic" e aplica o mapeamento default de animacoes (`Idle`->idle, `Walking`->walk) **automaticamente**, porque toda a serie Chibi da Craftpix compartilha o mesmo rig-base
- `src/rig-profile.js` -- fingerprint do rig (nomes de ossos + hierarquia) para lembrar tamanho/escala/offset calibrados e reaplicar em outros personagens da mesma serie
- `src/baker.js` + `src/vtt-standards.js` + `src/validate.js` -- monta o grid final e valida contra o padrao do VTT

## Uso

1. `npm start`
2. **Selecionar pasta do personagem** -> escolha a pasta de UM personagem (ex: `Esqueletos/Skeleton_Crusader_1`), nao a biblioteca inteira
3. O app detecta o perfil, extrai o `.unitypackage` e lista os clips reais disponiveis
4. Confira/ajuste o mapeamento Idle/Walk, tamanho da celula e a **escala/deslocamento** no preview (a pose eh calculada certo, mas o ponto de ancoragem chao/centro varia por arquetipo -- calibre uma vez)
5. **Bake** -> escolha a pasta de saida -> gera `idle.webp` e `walk.webp` dentro de `<saida>/<nome-do-personagem>/`
6. Essa calibracao (tamanho/escala/offset) fica salva por assinatura de rig -- o proximo personagem da mesma serie (mesmos nomes de osso) ja vem pre-preenchido

## Limitacoes conhecidas

- Pacotes sem view de costas (a maioria dos Chibi da Craftpix e desenhada de um angulo so) geram a linha NORTH como copia de EAST, marcada como aviso no log -- estruturalmente valido pro VTT, mas visualmente nao ha uma vista traseira real
- So Idle/Walk sao bakeados por padrao; os outros clips (Slashing, Running, Dying, etc.) existem no rig e podem ser exportados manualmente trocando o clip selecionado, mas ainda nao tem um botao dedicado
- FX/arma com alpha animado por clip (`m_FloatCurves`) ainda nao e lido -- partes como Sword/SlashFX usam so o alpha da pose de bind (funciona bem pra Idle/Walk, pode ficar errado em bakes de ataque)
