// Combina o conjunto de PNGs "de costas" com o conjunto principal (frente),
// peca por peca. Existe pra permitir arte de costas PARCIAL: um personagem
// pode ter Head/Face/Body redesenhados de costas e continuar usando o mesmo
// PNG de frente pra Sword ou Left Hand, por exemplo, sem que isso quebre nada
// -- so entra a versao de costas onde ela de fato existe.
//
// images / imagesBack: Map<nomeDoPNG, imagem>. O nome e a CHAVE de encontro:
// "Head.png" de costas substitui "Head.png" da frente na linha NORTH,
// mantendo o mesmo pivo/dimensao do .scml (que e por NOME, nao por pasta) --
// e por isso que a arte de costas tem que ser exportada com o mesmo nome de
// arquivo e o mesmo tamanho de tela que a peca da frente correspondente.
function mergeImagesForRow(images, imagesBack) {
  if (!imagesBack || imagesBack.size === 0) return images;
  const merged = new Map(images);
  for (const [name, img] of imagesBack) merged.set(name, img);
  // De costas nao se ve o rosto: se a Head foi redesenhada de costas, as
  // pecas Face* da frente (olhos/nariz/boca) sairiam por cima dela. Sem
  // imagem, o drawPose simplesmente pula a peca.
  if (imagesBack.has('Head.png')) {
    for (const name of [...merged.keys()]) if (name.toLowerCase().startsWith('face') && !imagesBack.has(name)) merged.delete(name);
  }
  return merged;
}

// Casa arquivos de costas com nomes de peca de forma tolerante, pra nao
// obrigar a renomear: "left-arm-back.png" -> "Left Arm.png". Ignora caixa,
// espacos/hifen/underline e o sufixo "back"/"costas". "-elm"/"helmet" e a
// variante COM capacete de uma peca ("head-elm-back" -> Head) e ganha da
// variante sem capacete quando as duas existem.
const norm = (s) => s.toLowerCase().replace(/\.(png|svg)$/, '').replace(/[\s_-]+/g, '');
const BACK_SUFFIX = /(back|costas)$/;

// dirFiles: nomes de arquivo da pasta; partNames: chaves de state.pivots.
// requireSuffix: true quando a pasta e a propria Vector Parts (so aceita
// arquivos marcados como costas, senao pegaria a arte da frente).
// Retorna Map<nomeDaPeca, nomeDoArquivo>.
function matchBackFiles(dirFiles, partNames, requireSuffix) {
  const byNorm = new Map(partNames.map((n) => [norm(n), n]));
  const out = new Map();
  const rank = new Map();
  for (const f of dirFiles) {
    if (!/\.(png|svg)$/i.test(f)) continue;
    let key = norm(f);
    const hasSuffix = BACK_SUFFIX.test(key);
    if (requireSuffix && !hasSuffix) continue;
    key = key.replace(BACK_SUFFIX, '');
    let r = 0;
    if (key.endsWith('elm')) { key = key.slice(0, -3); r = 1; } else if (key.endsWith('helmet')) { key = key.slice(0, -6); r = 1; }
    const part = byNorm.get(key);
    if (!part) continue;
    if (!out.has(part) || r > rank.get(part)) { out.set(part, f); rank.set(part, r); }
  }
  return out;
}

module.exports = { mergeImagesForRow, matchBackFiles };
