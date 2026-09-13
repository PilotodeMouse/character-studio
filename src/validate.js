// Reimplementa em JS as checagens descritas nos standards do VTT (o
// equivalente ao tools/check-art.py deles), para pegar problemas antes de
// escrever o arquivo final. Isso NAO substitui rodar o check-art.py real do
// VTT antes de instalar -- e so uma rede de seguranca no processo de bake.
const { cellSpecFor, ANIMATIONS } = require('./vtt-standards');

const NAME_RE = /^[a-z0-9-]+$/;

function validateCharacterFolderName(name) {
  const errors = [];
  if (!NAME_RE.test(name)) {
    errors.push(
      `Nome de pasta "${name}" invalido: use so a-z, 0-9 e hifen (sem underscore, espaco ou acento).`
    );
  }
  return errors;
}

function validateGrid({ kind, size, frameCount, rowCount, canvasWidth, canvasHeight }) {
  const errors = [];
  const spec = ANIMATIONS[kind];
  if (!spec) {
    errors.push(`Tipo de animation desconhecido: ${kind}`);
    return errors;
  }
  if (frameCount < spec.minFrames || frameCount > spec.maxFrames) {
    errors.push(
      `${kind}: ${frameCount} frames fora do intervalo permitido (${spec.minFrames}-${spec.maxFrames}).`
    );
  }
  if (rowCount !== 1 && rowCount !== 2 && rowCount !== 4) {
    errors.push(`${kind}: numero de linhas invalido (${rowCount}); use 2 (NORTH+EAST) ou 4.`);
  }
  const cell = cellSpecFor(size);
  const expectedW = cell.w * frameCount;
  const expectedH = cell.h * rowCount;
  if (canvasWidth !== expectedW || canvasHeight !== expectedH) {
    errors.push(
      `${kind}: dimensoes ${canvasWidth}x${canvasHeight} nao batem com o esperado ${expectedW}x${expectedH} para size=${size}, frames=${frameCount}, linhas=${rowCount}.`
    );
  }
  return errors;
}

module.exports = { validateCharacterFolderName, validateGrid, NAME_RE };
