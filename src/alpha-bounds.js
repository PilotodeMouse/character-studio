// Caixa de pixels REALMENTE opacos de cada PNG do pacote.
//
// POR QUE ISSO EXISTE
// A Craftpix exporta cada peca numa moldura quadrada generosa: Head.png tem
// 480x480 mas so 379x375 de desenho (38% e ar), Body.png tem 320x320 com
// 200x212 de desenho (59% e ar). O auto-fit media o retangulo CHEIO do
// arquivo, entao encolhia o personagem pra fazer caber essa borda invisivel:
// no Goblin, dava escala 0.41 numa celula 1x1 onde ele cabe folgado a 0.54, e
// o token saia pequeno no tabuleiro, com meia celula desperdicada.
//
// Medir alpha e caro (le pixel a pixel), entao roda UMA vez por pacote, ao
// importar o personagem, e o resultado e reusado em todo recalculo de escala.
const ALPHA_THRESHOLD = 8; // ignora antialias quase invisivel da borda vetorial

// images: Map<nomeDoPNG, imagem desenhavel>
// createCanvas: (w, h) -> canvas com getContext('2d'), pra funcionar tanto no
// renderer do Electron quanto no node-canvas dos scripts de validacao.
// Retorna Map<nomeDoPNG, {x, y, w, h}> em pixels da propria imagem, ou null
// para uma peca inteiramente transparente.
function computeAlphaBoxes(images, createCanvas) {
  const boxes = new Map();
  for (const [name, img] of images) {
    const w = img.width;
    const h = img.height;
    if (!w || !h) {
      boxes.set(name, null);
      continue;
    }
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (data[(row + x) * 4 + 3] > ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    boxes.set(name, maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return boxes;
}

module.exports = { computeAlphaBoxes, ALPHA_THRESHOLD };
