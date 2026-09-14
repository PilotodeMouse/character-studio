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
  return merged;
}

module.exports = { mergeImagesForRow };
