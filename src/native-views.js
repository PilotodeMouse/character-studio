// Pacotes Craftpix que JA TRAZEM as 4 direcoes desenhadas.
//
// Existem duas geracoes de pacote chibi na Craftpix:
//  - vista unica (103 dos 106 da biblioteca do usuario): uma animacao lateral
//    so. NORTH/WEST sao INVENTADOS aqui, a partir do rig de frente mais a arte
//    de costas que o usuario desenhar -- e toda a maquinaria de espelho, troca
//    de lados em profundidade e padrao do rig existe por causa deles.
//  - quatro vistas (Assassino, Robber, Thug): 24 animacoes nomeadas
//    `Front - Idle`, `Right - Walking`, `Back - Attacking`, `Left - Hurt`...,
//    com arte por vista (`Body - Back.png`, `Head - L View.png`) e uma pilha de
//    camadas propria por vista.
//
// Pra segunda geracao nao ha NADA a inventar: cada linha do VTT toca a animacao
// da vista dela, com a arte e o z-order dela, e espelho/troca de lados ficam
// DESLIGADOS. E o caso mais simples que existe -- ele so parecia complicado
// porque o app tratava `Front - Idle` como o idle do personagem e espelhava o
// resto.
//
// Nenhuma funcao aqui depende de DOM, canvas ou imagem: entra uma lista de
// nomes de animacao, sai o mapeamento. Da pra conferir um pacote novo sem abrir
// o Electron.

// Como a Craftpix nomeia cada vista, e pra qual linha do VTT ela vai.
// Varias grafias porque os tres pacotes nao sao identicos entre si e porque a
// arte usa "L View"/"R View" enquanto as animacoes usam "Left"/"Right".
const VISTAS = {
  north: ['back', 'rear'],
  east: ['right', 'r view'],
  south: ['front'],
  west: ['left', 'l view'],
};

// "Front - Idle" -> { vista: 'front', base: 'Idle' }. Aceita hifen, travessao
// ou underline como separador. Devolve null quando o nome nao tem prefixo de
// vista nenhum (o caso da geracao de vista unica).
function partirNomeDeAnimacao(nome) {
  const m = /^\s*([A-Za-z][A-Za-z\s]*?)\s*[-_–—]\s*(.+)$/.exec(String(nome));
  if (!m) return null;
  const vista = m[1].trim().toLowerCase();
  const conhecida = Object.values(VISTAS).some((nomes) => nomes.includes(vista));
  return conhecida ? { vista, base: m[2].trim() } : null;
}

// Qual prefixo de vista atende cada linha do VTT, olhando os nomes de animacao
// do pacote. Devolve null quando nao da pra montar as QUATRO -- meio caminho
// nao serve: com duas vistas desenhadas e duas faltando, o certo e continuar no
// fluxo normal (espelho + arte de costas) em vez de misturar os dois.
function detectarVistasNativas(nomesDeAnimacao) {
  const porVista = new Map();
  for (const nome of nomesDeAnimacao) {
    const p = partirNomeDeAnimacao(nome);
    if (!p) continue;
    if (!porVista.has(p.vista)) porVista.set(p.vista, []);
    porVista.get(p.vista).push(p.base);
  }
  if (!porVista.size) return null;

  const out = {};
  for (const [row, grafias] of Object.entries(VISTAS)) {
    const achada = grafias.find((g) => porVista.has(g));
    if (!achada) return null;
    out[row] = achada;
  }
  return out;
}

// Os nomes de animacao SEM o prefixo de vista, na ordem em que aparecem. E o
// que o usuario escolhe no mapeamento ("Idle", "Walking"), em vez das 24.
// So entram as bases que existem em TODAS as quatro vistas: o `Back` desses
// pacotes nao tem "Idle Blinking", e oferecer uma animacao que falta numa
// direcao daria uma linha vazia no bake.
function basesComuns(nomesDeAnimacao, vistas) {
  const porVista = new Map();
  for (const nome of nomesDeAnimacao) {
    const p = partirNomeDeAnimacao(nome);
    if (!p) continue;
    if (!porVista.has(p.vista)) porVista.set(p.vista, new Set());
    porVista.get(p.vista).add(p.base);
  }
  const usadas = Object.values(vistas);
  const ordem = [];
  for (const nome of nomesDeAnimacao) {
    const p = partirNomeDeAnimacao(nome);
    if (!p || !usadas.includes(p.vista)) continue;
    if (ordem.includes(p.base)) continue;
    if (usadas.every((v) => porVista.get(v) && porVista.get(v).has(p.base))) ordem.push(p.base);
  }
  return ordem;
}

// Nome real do clip pra uma linha do VTT e uma base. Devolve null quando a
// combinacao nao existe no pacote -- quem chama decide o que fazer.
function clipDaVista(nomesDeAnimacao, vistas, row, base) {
  const alvo = vistas[row];
  if (!alvo) return null;
  for (const nome of nomesDeAnimacao) {
    const p = partirNomeDeAnimacao(nome);
    if (p && p.vista === alvo && p.base === base) return nome;
  }
  return null;
}

module.exports = { VISTAS, partirNomeDeAnimacao, detectarVistasNativas, basesComuns, clipDaVista };
