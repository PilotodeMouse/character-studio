// LADO DO CORPO e PROFUNDIDADE -- a regra que mantem a arma sempre na mesma
// mao do personagem quando ele se vira.
//
// Mora aqui, e nao no renderer, por um motivo pratico: assim
// `scripts/check-side-depth.js` consegue rodar a MESMA regra em cima de uma
// biblioteca inteira de pacotes Craftpix sem abrir o Electron, e dizer de
// antemao em quais personagens ela decide sozinha e em quais vai precisar de
// mao. Nada aqui depende de DOM, de canvas nem de imagem carregada -- so de
// uma lista de nomes de peca na ordem de desenho (fundo -> frente).
//
// Por que o espelho sozinho nao basta: espelhar o canvas troca esquerda/direita
// na TELA e nao mexe na PROFUNDIDADE -- o braco que estava atras do corpo
// continua atras. Em vista lateral, o canhoto olhando pra um lado tem o lado
// esquerdo virado pra LONGE da camera (e por isso a Craftpix entrega as pecas
// "Left *" com z baixo, atras do corpo); olhando pro outro lado, o MESMO lado
// esquerdo fica virado PRA camera, e a mesma espada, na mesma mao, tem que
// aparecer NA FRENTE do corpo. So a profundidade dos dois lados muda: a
// animacao de cada peca continua sendo a dela, e e por isso que a espada
// continua acompanhando o braco que da o golpe.

// Peca que a mao segura (arma, escudo, efeito) -- por exclusao: o que nao e
// parte do corpo. Assim Axe/Spear/Bow/Staff entram sozinhos, sem lista.
// Compara por PALAVRA inteira ("Handaxe" e arma, nao mao). Escrito com split
// em vez de regex de proposito: expressao com \b nesta base ja foi corrompida
// duas vezes por edicao automatizada (o \b virando byte 0x08) -- ver a
// checagem de caractere de controle em scripts/check-renderer-wiring.js.
const BODY_WORDS = new Set(['arm', 'hand', 'leg', 'foot', 'feet', 'body', 'torso', 'hip', 'neck', 'head', 'face']);

// Nomes de osso de peca segurada, pra saber qual mao e a da ARMA e qual e a do
// ESCUDO. Vale o nome do OSSO, que nao muda quando o usuario troca a arte da
// peca (Sword -> Axe.png continua sendo o osso "Sword").
const WEAPON_WORDS = new Set([
  'sword', 'axe', 'blade', 'spear', 'staff', 'bow', 'hammer', 'mace', 'dagger', 'weapon',
  'katana', 'club', 'scythe', 'wand', 'pike', 'halberd', 'knife', 'gun', 'pistol', 'rifle', 'crossbow',
  'lance', 'glaive', 'trident', 'sickle', 'flail', 'cleaver', 'saber', 'sabre', 'rapier', 'machete',
  'bat', 'stick', 'rod', 'shovel', 'pickaxe', 'whip', 'chain', 'bottle', 'torch', 'book', 'orb', 'skull',
]);
const SHIELD_WORDS = new Set(['shield', 'buckler']);
const LEG_WORDS = new Set(['leg', 'foot', 'feet']);

function wordsOf(name) {
  return String(name).toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

function isHeldItemName(n) {
  return !wordsOf(n).some((w) => BODY_WORDS.has(w));
}

function isHandName(n) {
  return wordsOf(n).includes('hand');
}

function ladoDoNome(n) {
  const p = wordsOf(n);
  return p.includes('left') ? 'left' : p.includes('right') ? 'right' : null;
}

// Pra cada peca SEGURADA, a mao mais proxima dela na pilha de camadas.
function nearestHandByItem(order) {
  const out = new Map();
  order.forEach((name, i) => {
    if (!isHeldItemName(name)) return;
    let best = null;
    let bestDist = Infinity;
    order.forEach((other, j) => {
      if (!isHandName(other)) return;
      const d = Math.abs(i - j);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    });
    if (best) out.set(name, best);
  });
  return out;
}

// De qual LADO DO CORPO cada peca e. O que a mao segura (Sword, Shield) nao
// diz lado nenhum no nome, entao herda o lado da mao mais proxima na pilha.
function sidesOfParts(layers) {
  const out = new Map();
  for (const n of layers) {
    const l = ladoDoNome(n);
    if (l) out.set(n, l);
  }
  for (const [item, mao] of nearestHandByItem(layers)) {
    const l = out.get(mao);
    if (l) out.set(item, l);
  }
  return out;
}

// Qual mao segura a ARMA, pelo NOME das pecas. Devolve null quando nenhum nome
// e reconhecido -- ai quem chama decide pela medida (a mao que mais se mexe;
// ver maoDaArma em renderer/app.js). Pelo nome primeiro porque e o sinal mais
// direto e o mais facil de conferir.
function maoDaArmaPorNome(layers) {
  const maos = layers.filter(isHandName);
  if (maos.length < 2) return null;
  const porItem = nearestHandByItem(layers);
  for (const [item, mao] of porItem) {
    if (wordsOf(item).some((w) => WEAPON_WORDS.has(w))) return mao;
  }
  for (const [item, mao] of porItem) {
    if (wordsOf(item).some((w) => SHIELD_WORDS.has(w))) return maos.find((m) => m !== mao) || null;
  }
  return null;
}

// Acha os BLOCOS -- pedacos CONSECUTIVOS da pilha -- das pecas que `pertence`
// aceita, e troca os dois de lugar mantendo a ordem interna de cada um.
//
// Bloco inteiro, nao posicao por posicao: no Skeleton Crusader o bloco da arma
// tem 4 pecas (SlashFX + Sword + Left Hand + Left Arm) e o do escudo tem 3.
// Preenchendo slot a slot, o SlashFX sobrava sozinho na regiao do outro bloco
// -- medido, a amplitude de x dele saltava de 0 pra 57px, ou seja, passava a
// balancar com o braco errado.
function trocaBlocosDeLado(layers, sideByName, pertence) {
  const blocos = [];
  layers.forEach((n, i) => {
    if (!pertence(n)) return;
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.fim === i - 1) {
      ultimo.fim = i;
      ultimo.nomes.push(n);
    } else {
      blocos.push({ inicio: i, fim: i, nomes: [n] });
    }
  });
  const ladoUnico = (nomes) => {
    const l = sideByName.get(nomes[0]);
    return nomes.every((n) => sideByName.get(n) === l) ? l : null;
  };

  // Um bloco so, com os dois lados dentro (o caso das pernas): inverte os dois
  // grupos dentro do proprio bloco, sem sair do lugar na pilha.
  if (blocos.length === 1 && !ladoUnico(blocos[0].nomes)) {
    const b = blocos[0];
    const primeiro = sideByName.get(b.nomes[0]);
    const trocado = [
      ...b.nomes.filter((n) => sideByName.get(n) !== primeiro),
      ...b.nomes.filter((n) => sideByName.get(n) === primeiro),
    ];
    return [...layers.slice(0, b.inicio), ...trocado, ...layers.slice(b.fim + 1)];
  }

  // Dois blocos, um de cada lado (o caso dos bracos): trocam de lugar.
  if (blocos.length === 2) {
    const [a, b] = blocos;
    const la = ladoUnico(a.nomes);
    const lb = ladoUnico(b.nomes);
    if (la && lb && la !== lb) {
      return [
        ...layers.slice(0, a.inicio),
        ...b.nomes,
        ...layers.slice(a.fim + 1, b.inicio),
        ...a.nomes,
        ...layers.slice(b.fim + 1),
      ];
    }
  }
  return layers;
}

// O ESCUDO vai pra FRENTE do bloco dele numa direcao espelhada.
//
// Um escudo e uma chapa presa no antebraco, com a face apontando pra fora do
// corpo -- ele cobre o proprio braco, nao o contrario. A arma nao: ela e
// segurada pelo punho, e a mao passa por cima do cabo. Por isso
// `backViewDepthOrder` (a ordem do NORTH, que o usuario aprovou) empurra o que
// e segurado pro fundo do bloco, e aqui o escudo volta pra frente.
//
// Confere com as ordens que o usuario aprovou nas duas direcoes espelhadas:
//  - EAST  (bloco do escudo ATRAS do corpo): ... Off Hand > Off Arm > Shield ...
//  - WEST  (bloco do escudo NA FRENTE):      ... Off Hand > Off Arm > Shield  <- topo
// Em ambos o escudo esta na frente do braco dele; o que muda e so onde o BLOCO
// esta, e disso ja cuida trocaBlocosDeLado.
function posicionarEscudoNoBloco(layers) {
  const sideByName = sidesOfParts(layers);
  const isLeg = (n) => wordsOf(n).some((w) => LEG_WORDS.has(w));
  const escudos = layers.filter(ehEscudo);
  if (!escudos.length) return layers;

  let out = [...layers];
  for (const escudo of escudos) {
    const i = out.indexOf(escudo);
    const lado = sideByName.get(escudo);
    if (i < 0 || !lado) continue;
    const doBloco = (n) => sideByName.get(n) === lado && !isLeg(n);
    let ini = i;
    let fim = i;
    while (ini > 0 && doBloco(out[ini - 1])) ini--;
    while (fim < out.length - 1 && doBloco(out[fim + 1])) fim++;
    const bloco = out.slice(ini, fim + 1).filter((n) => n !== escudo);
    out = [...out.slice(0, ini), ...bloco, escudo, ...out.slice(fim + 1)];
  }
  return out;
}

// O bloco desta peca esta desenhado na frente do corpo? (lado de CA da camera)
// E o que decide qual FACE do escudo a camera ve: de ca, a face; de la, o verso.
function ladoDaCamera(layers, nome) {
  const iBody = layers.findIndex((n) => wordsOf(n).includes('body'));
  const i = layers.indexOf(nome);
  return iBody >= 0 && i >= 0 ? i > iBody : null;
}

function ehEscudo(nome) {
  return wordsOf(nome).some((w) => SHIELD_WORDS.has(w));
}

// Ordem de camadas de uma direcao ESPELHADA (recebe e devolve fundo -> frente).
// Bracos e pernas em passadas SEPARADAS: no .scml as pernas ficam coladas no
// bloco de um dos bracos, e numa passada so o bloco sairia grudado nelas.
function sideSwapDepthOrder(layers) {
  const sideByName = sidesOfParts(layers);
  const isLeg = (n) => wordsOf(n).some((w) => LEG_WORDS.has(w));
  let out = layers;
  for (const desteGrupo of [(n) => !isLeg(n), isLeg]) {
    out = trocaBlocosDeLado(out, sideByName, (n) => sideByName.has(n) && desteGrupo(n));
  }
  return posicionarEscudoNoBloco(out);
}

module.exports = {
  BODY_WORDS,
  WEAPON_WORDS,
  SHIELD_WORDS,
  wordsOf,
  isHeldItemName,
  isHandName,
  ladoDoNome,
  nearestHandByItem,
  sidesOfParts,
  maoDaArmaPorNome,
  trocaBlocosDeLado,
  posicionarEscudoNoBloco,
  sideSwapDepthOrder,
  ladoDaCamera,
  ehEscudo,
};
