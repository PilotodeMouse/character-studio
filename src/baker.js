// Monta o grid de spritesheet exigido pelo VTT (linhas = direcoes, colunas =
// frames), amostrando cada pose via computePoseFn(clip, t) -- assim este
// modulo nao precisa saber se a pose vem do .unitypackage (unity-skeleton)
// ou direto do .scml (scml-rig, usado quando o .prefab e binario e o
// primeiro caminho falha com 0 ossos/0 clips). Quem chama decide isso e
// passa a funcao ja resolvida; ver computePoseFn em renderer/app.js.
const { drawPose, applyManualOverrides, mirrorCell, applyHandTransplant } = require('./unity-skeleton');
const { cellSpecFor } = require('./vtt-standards');

// rows: array de { row, clip, hasArt, images, partOffsets, mirror, mirrorFrom }
// na ordem EXIGIDA pelo VTT (NORTH, EAST, SOUTH, WEST -- ver ROWS em
// src/vtt-standards.js; o jogo descobre a direcao pelo NUMERO da linha, nao
// por rotulo nenhum dentro da imagem).
// - hasArt=false: sem view de costas nenhuma (nem pose nem arte propria) --
//   a linha e preenchida com a mesma pose de EAST e marcada como placeholder.
// - images (opcional): substitui o `images` principal so pra esta linha --
//   e o que permite uma view de costas DESENHADA (nao so a mesma arte da
//   frente numa pose diferente). Normalmente vem de mergeImagesForRow
//   (renderer/app.js), que usa o PNG de costas quando existe e cai pro PNG
//   da frente peca a peca quando nao (arte parcial de costas e permitida).
// - mirror=true: a linha e o espelho horizontal de outra (mirrorFrom), do
//   jeito que a Biblioteca do VTT expande uma entrega de duas linhas. So faz
//   sentido em SOUTH (de EAST) e WEST (de NORTH): o par e costas com costas
//   e frente com frente, nunca a linha 1 virando a linha 3.
// - partOffsets (por linha): os ajustes manuais que valem pra essa linha
//   NESSE clip, ja somados por quem chama (ver effectiveOffsets em
//   renderer/app.js: geral da direcao + camada daquela animacao + correcao da
//   linha espelhada).
// partOffsets (raiz, opcional): Map<boneName,{dx,dy,dangle,dampX,dampY,dampAngle,...}>
// com correcoes manuais do usuario. Precisa ir tanto pro computePose quanto
// pro applyManualOverrides -- o primeiro cobre o amortecimento (dampX/Y/Angle,
// que age no espaco local de cada osso, antes da composicao da hierarquia) e
// o segundo cobre offset/pivo/follow (que agem no mundo, depois). So passar
// pro segundo (como este codigo fazia ate aqui) faz o amortecimento nunca
// aparecer no bake, so no preview.
// scale: a MESMA "Escala do personagem dentro da celula" usada no preview
// (cfg.scale). Sem isso o bake sai num tamanho diferente do que voce calibrou
// na tela -- era assim ate agora: o preview aplicava a escala e o bake nao.
function bakeGrid({ computePoseFn, images, pivots, rows, frameCount, size, createCanvas, originOffset = { x: 0, y: 0 }, partOffsets, scale = 1 }) {
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
    if (rowSpec.mirror) {
      warnings.push(`Linha ${rowSpec.row}: espelhada de ${rowSpec.mirrorFrom} (mesma coisa que a Biblioteca faria).`);
    }

    const rowImages = rowSpec.images || images;
    const rowOffsets = rowSpec.partOffsets || partOffsets;
    // Pose de referencia (t=0) so pra medir COMO a peca esta encaixada na mao
    // antes de transplanta-la pra outra mao -- ver applyHandTransplant.
    const refPose = rowSpec.handTransplants
      ? applyManualOverrides(computePoseFn(clip, 0, rowOffsets), rowOffsets)
      : null;

    for (let f = 0; f < frameCount; f++) {
      const t = (f * clip.length) / frameCount;
      let pose = applyManualOverrides(computePoseFn(clip, t, rowOffsets), rowOffsets);
      pose = applyHandTransplant(pose, rowSpec.handTransplants, refPose);

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
      // SOUTH/WEST podem ser espelhos de EAST/NORTH -- o espelho vai no ctx,
      // depois do clip da celula, pra valer so nela (ver mirrorCell).
      if (rowSpec.mirror) mirrorCell(ctx, cellX + cell.bodyAxisX);
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
