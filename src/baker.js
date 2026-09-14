// Monta o grid de spritesheet exigido pelo VTT (linhas = direcoes, colunas =
// frames) a partir de um clip real extraido do .unitypackage, usando
// unity-skeleton para amostrar cada pose.
const { computePose, drawPose, applyManualOverrides } = require('./unity-skeleton');
const { cellSpecFor } = require('./vtt-standards');

// rows: array de { row: 'north'|'east', clip, hasArt, images } na ordem em
// que devem ser desenhadas.
// - hasArt=false: sem view de costas nenhuma (nem pose nem arte propria) --
//   a linha e preenchida com a mesma pose de EAST e marcada como placeholder.
// - images (opcional): substitui o `images` principal so pra esta linha --
//   e o que permite uma view de costas DESENHADA (nao so a mesma arte da
//   frente numa pose diferente). Normalmente vem de mergeImagesForRow
//   (renderer/app.js), que usa o PNG de costas quando existe e cai pro PNG
//   da frente peca a peca quando nao (arte parcial de costas e permitida).
// partOffsets (opcional): Map<boneName,{dx,dy,dangle,dampX,dampY,dampAngle,...}>
// com correcoes manuais do usuario. Precisa ir tanto pro computePose quanto
// pro applyManualOverrides -- o primeiro cobre o amortecimento (dampX/Y/Angle,
// que age no espaco local de cada osso, antes da composicao da hierarquia) e
// o segundo cobre offset/pivo/follow (que agem no mundo, depois). So passar
// pro segundo (como este codigo fazia ate aqui) faz o amortecimento nunca
// aparecer no bake, so no preview.
// scale: a MESMA "Escala do personagem dentro da celula" usada no preview
// (cfg.scale). Sem isso o bake sai num tamanho diferente do que voce calibrou
// na tela -- era assim ate agora: o preview aplicava a escala e o bake nao.
function bakeGrid({ rig, images, pivots, zIndexByName, rows, frameCount, size, createCanvas, originOffset = { x: 0, y: 0 }, partOffsets, scale = 1 }) {
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

    const rowImages = rowSpec.images || images;

    for (let f = 0; f < frameCount; f++) {
      const t = (f * clip.length) / frameCount;
      const pose = applyManualOverrides(computePose(rig, clip, t, zIndexByName, partOffsets), partOffsets);

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
      drawPose(ctx, pose, rowImages, pivots, origin, scale);
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
