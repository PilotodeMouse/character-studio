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

module.exports = { CELL_BY_SIZE, ROWS, MIRRORED_FROM, REAL_ROWS, ANIMATIONS, EXPORT, cellSpecFor };
