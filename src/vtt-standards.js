// Espelha os padroes publicados em https://isometric-tactics.pages.dev/desktop/pages/standards
// Se o VTT mudar os padroes, atualize apenas este arquivo.

const CELL_BY_SIZE = {
  '1x1': { w: 256, h: 448, bodyAxisX: 128, groundLineY: 416 },
  '2x2': { w: 512, h: 896, bodyAxisX: 256, groundLineY: 832 },
  '3x3': { w: 768, h: 1344, bodyAxisX: 384, groundLineY: 1248 },
};

// Linhas do grid, na ordem exigida pelo VTT. SOUTH e WEST sao espelhadas
// automaticamente pela biblioteca a partir de EAST e NORTH, entao so
// precisamos desenhar essas duas de fato.
const ROWS = ['north', 'east', 'south', 'west'];
const MIRRORED_FROM = { south: 'east', west: 'north' };
const REAL_ROWS = ['north', 'east'];

const ANIMATIONS = {
  idle: { minFrames: 1, maxFrames: 8, recommendedFrames: 4, msPerFrame: 160 },
  walk: { minFrames: 3, maxFrames: 8, recommendedFrames: 4 },
};

const EXPORT = {
  format: 'webp',
  quality: 0.92, // >= 90 conforme padrao
  alpha: 'straight',
  noCrop: true,
};

// Tamanho padrao do VTT. 1x1 (256x448) e o que o padrao assume quando o
// personagem nao ocupa mais de um tile do tabuleiro -- e o caso da esmagadora
// maioria dos Chibi da Craftpix.
const DEFAULT_SIZE = '1x1';

function cellSpecFor(size) {
  const spec = CELL_BY_SIZE[size];
  if (!spec) throw new Error(`Tamanho de personagem desconhecido: ${size}. Use 1x1, 2x2 ou 3x3.`);
  return spec;
}

// Maior escala <= 1 que faz o personagem INTEIRO caber dentro da celula.
//
// `bounds` (de computeAnimatedBounds/computeScmlBounds) ja vem em pixels
// RELATIVOS a origem do VTT -- o cruzamento do eixo do corpo com a linha do
// chao: x negativo e a esquerda do eixo, y negativo e acima do chao. Por isso
// cada borda vira uma restricao diferente: a folga a esquerda e bodyAxisX, a
// direita e (w - bodyAxisX), pra cima e groundLineY e pra baixo e o resto.
// Escalar tudo por um fator so mantem a proporcao original da arte.
//
// So REDUZ, nunca amplia: a arte da Craftpix ja vem rasterizada e ampliar
// pra "preencher" a celula borra o traco. Se o personagem ja cabe, devolve 1.
function fitScaleForBounds(bounds, cell, margin = 8) {
  if (!bounds) return 1;
  const { minX, maxX, minY, maxY } = bounds;
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return 1;

  const limits = [];
  if (minX < 0) limits.push((cell.bodyAxisX - margin) / -minX);
  if (maxX > 0) limits.push((cell.w - margin - cell.bodyAxisX) / maxX);
  if (minY < 0) limits.push((cell.groundLineY - margin) / -minY);
  if (maxY > 0) limits.push((cell.h - margin - cell.groundLineY) / maxY);

  const scale = Math.min(1, ...limits); // Math.min(1) === 1 quando nao ha restricao
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

module.exports = {
  CELL_BY_SIZE,
  ROWS,
  MIRRORED_FROM,
  REAL_ROWS,
  ANIMATIONS,
  EXPORT,
  DEFAULT_SIZE,
  cellSpecFor,
  fitScaleForBounds,
};
