// Arte POR DIRECAO. O VTT quer quatro linhas (NORTH, EAST, SOUTH, WEST) e
// aceita que duas delas sejam espelhadas -- ver src/vtt-standards.js. Aqui
// mora o que permite desenhar as outras de verdade: um conjunto PARCIAL de
// PNGs por direcao, que se sobrepoe ao conjunto base (a arte de EAST).
//
// Parcial e de proposito: um personagem pode ter Head/Face/Body redesenhados
// de costas e continuar usando o mesmo PNG de frente pra Sword ou Left Hand,
// sem que isso quebre nada -- so entra a versao daquela direcao onde ela de
// fato existe.
//
// images / rowArt: Map<nomeDoPNG, imagem>. O nome e a CHAVE de encontro:
// "Head.png" de costas substitui "Head.png" da frente naquela linha,
// mantendo o mesmo pivo/dimensao do .scml (que e por NOME, nao por pasta) --
// e por isso que a arte de outra direcao tem que sair com o mesmo tamanho de
// tela que a peca correspondente da frente.
//
// hideFace: nas direcoes que mostram as COSTAS (north/west), as pecas Face*
// da frente sairiam por cima da cabeca redesenhada. Sem imagem, o drawPose
// simplesmente pula a peca. Nas que mostram a FRENTE (east/south) o rosto
// continua, claro.
function mergeImagesForRow(images, rowArt, { hideFace = false } = {}) {
  if ((!rowArt || rowArt.size === 0) && !hideFace) return images;
  const merged = new Map(images);
  if (rowArt) for (const [name, img] of rowArt) merged.set(name, img);
  if (hideFace && merged.has('Head.png') && rowArt && rowArt.has('Head.png')) {
    for (const name of [...merged.keys()]) if (name.toLowerCase().startsWith('face')) merged.delete(name);
  }
  return merged;
}

// Casa arquivos de uma direcao com nomes de peca de forma tolerante, pra nao
// obrigar a renomear: "left-arm-back.png" -> "Left Arm.png". Ignora caixa,
// espacos/hifen/underline e o sufixo da direcao. "-elm"/"helmet" e a variante
// COM capacete de uma peca ("head-elm-back" -> Head) e ganha da variante sem
// capacete quando as duas existem.
const norm = (s) => s.toLowerCase().replace(/\.(png|svg)$/, '').replace(/[\s_-]+/g, '');

// dirFiles: nomes de arquivo da pasta; partNames: chaves de state.pivots.
// suffixes: marcas que identificam a direcao no nome do arquivo.
// requireSuffix: true quando a pasta e a propria Vector Parts (so aceita
// arquivos marcados com a direcao, senao pegaria a arte da frente).
// Retorna Map<nomeDaPeca, nomeDoArquivo>.
function matchRowArtFiles(dirFiles, partNames, suffixes, requireSuffix) {
  const byNorm = new Map(partNames.map((n) => [norm(n), n]));
  const out = new Map();
  const rank = new Map();
  for (const f of dirFiles) {
    if (!/\.(png|svg)$/i.test(f)) continue;
    let key = norm(f);
    const hit = suffixes.find((s) => key.endsWith(s));
    if (requireSuffix && !hit) continue;
    if (hit) key = key.slice(0, -hit.length);
    let r = 0;
    if (key.endsWith('elm')) {
      key = key.slice(0, -3);
      r = 1;
    } else if (key.endsWith('helmet')) {
      key = key.slice(0, -6);
      r = 1;
    }
    const part = byNorm.get(key);
    if (!part) continue;
    if (!out.has(part) || r > rank.get(part)) {
      out.set(part, f);
      rank.set(part, r);
    }
  }
  return out;
}

module.exports = { mergeImagesForRow, matchRowArtFiles };
