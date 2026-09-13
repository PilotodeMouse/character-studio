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

function cellSpecFor(size) {
  const spec = CELL_BY_SIZE[size];
  if (!spec) throw new Error(`Tamanho de personagem desconhecido: ${size}. Use 1x1, 2x2 ou 3x3.`);
  return spec;
}

// A partir de uma caixa envolvente (relativa ao proprio osso-raiz, ver
// computeAnimatedBounds em unity-skeleton.js/template-skeleton.js) e da
// celula de saida, acha o maior fator de escala que faz a peca caber dentro
// da celula com uma margem de seguranca fixa dos 4 lados -- nunca aumenta
// (o "1" e o teto), so encolhe o suficiente pra nao cortar em nenhum lado.
// Os 4 lados tem folgas diferentes porque a origem (bodyAxisX,groundLineY)
// fica perto do CHAO da celula, nao no centro: quase toda a folga vertical
// esta ACIMA da origem, e quase nenhuma abaixo.
function fitScaleForBounds(bounds, cell, margin = 8) {
  const neededLeft = Math.max(0, -bounds.minX);
  const neededRight = Math.max(0, bounds.maxX);
  const neededUp = Math.max(0, -bounds.minY);
  const neededDown = Math.max(0, bounds.maxY);
  const availLeft = cell.bodyAxisX - margin;
  const availRight = cell.w - cell.bodyAxisX - margin;
  const availUp = cell.groundLineY - margin;
  const availDown = cell.h - cell.groundLineY - margin;

  let scale = 1;
  if (neededLeft > 0) scale = Math.min(scale, availLeft / neededLeft);
  if (neededRight > 0) scale = Math.min(scale, availRight / neededRight);
  if (neededUp > 0) scale = Math.min(scale, availUp / neededUp);
  if (neededDown > 0) scale = Math.min(scale, availDown / neededDown);
  return Math.max(0.05, scale);
}

module.exports = { CELL_BY_SIZE, ROWS, MIRRORED_FROM, REAL_ROWS, ANIMATIONS, EXPORT, cellSpecFor, fitScaleForBounds };
