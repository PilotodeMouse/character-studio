// Monta o grid de spritesheet exigido pelo VTT (linhas = direcoes, colunas =
// frames) a partir de um clip real extraido do .unitypackage, usando
// unity-skeleton para amostrar cada pose.
const { computePose, drawPose } = require('./unity-skeleton');
const { cellSpecFor } = require('./vtt-standards');

// rows: array de { row: 'north'|'east', clip, hasArt } na ordem em que devem
// ser desenhadas. Quando hasArt=false (personagem sem view de costas, comum
// nesses pacotes Craftpix de frente unica), a linha e preenchida com a
// mesma pose de EAST e marcada como placeholder no retorno.
function bakeGrid({ rig, images, pivots, zIndexByName, rows, frameCount, size, createCanvas, originOffset = { x: 0, y: 0 } }) {
  const cell = cellSpecFor(size);
  const canvas = createCanvas(cell.w * frameCount, cell.h * rows.length);
  const ctx = canvas.getContext('2d');
  const warnings = [];

  rows.forEach((rowSpec, rowIndex) => {
    const clip = rowSpec.hasArt === false ? rows.find((r) => r.hasArt !== false)?.clip : rowSpec.clip;
    if (!clip) throw new Error(`Nenhum clip disponivel para a linha ${rowSpec.row}`);

    if (rowSpec.hasArt === false) {
      warnings.push(
        `Linha ${rowSpec.row}: sem arte de costas no pacote de origem, usando a pose de EAST como placeholder.`
      );
    }

    for (let f = 0; f < frameCount; f++) {
      const t = (f * clip.length) / frameCount;
      const pose = computePose(rig, clip, t, zIndexByName);

      ctx.save();
      ctx.beginPath();
      const cellX = f * cell.w;
      const cellY = rowIndex * cell.h;
      ctx.rect(cellX, cellY, cell.w, cell.h);
      ctx.clip();

      const origin = {
        x: cellX + cell.bodyAxisX + originOffset.x,
        y: cellY + cell.groundLineY + originOffset.y,
      };
      drawPose(ctx, pose, images, pivots, origin, 1);
      ctx.restore();
    }
  });

  return { canvas, warnings, cell };
}

function canvasToWebpBuffer(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Falha ao exportar canvas para WebP'));
        blob.arrayBuffer().then((buf) => resolve(Buffer.from(buf)));
      },
      'image/webp',
      quality
    );
  });
}

module.exports = { bakeGrid, canvasToWebpBuffer };
