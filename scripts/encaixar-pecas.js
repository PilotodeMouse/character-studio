#!/usr/bin/env node
// Pega pecas desenhadas SOLTAS (uma por arquivo, fundo branco, tamanho e
// posicao quaisquer) e encaixa cada uma na tela exata do rig, no lugar exato
// da peca original.
//
// Uso:
//   node scripts/encaixar-pecas.js <pasta-das-pecas-novas> <pasta-do-personagem-base> <pasta-de-saida>
//
// POR QUE ISSO EXISTE
// Um modelo de imagem de chat nao consegue tres coisas que o rig exige: PNG com
// alfa, tela de tamanho exato (ele devolve 1024x1024) e a peca na posicao certa
// dentro dessa tela (ele centraliza). A saida dele e sempre "a peca isolada num
// fundo branco, centralizada, num quadrado".
//
// Nada disso precisa ser resolvido por ele. A peca ORIGINAL ja diz onde a tinta
// tem que ficar dentro da tela -- e so medir a caixa de tinta dela e pousar a
// peca nova na mesma pegada. Isso resolve de uma vez tela, posicao, proporcao
// entre as pecas e pivo, que e o conjunto que o modelo nao entrega.
//
// A ANCORA IMPORTA
// Encaixar pelo centro funciona pro tronco e pro escudo, e erra feio num braco:
// o pivo de um braco e o OMBRO, a ponta de cima. Se a arte nova for mais
// comprida e voce centralizar, o ombro desce e o braco nasce no meio do peito.
// Entao cada peca tem a sua ancora: membro alinha pelo TOPO, cabeca pela BASE
// (ela se apoia no pescoco), o resto pelo centro.
//
// A escala e UNIFORME. Esticar a arte nova ate preencher a caixa da original
// seria mais "exato" e deformaria o desenho -- uma perna comprida viraria uma
// perna comprida e achatada. Melhor caber inteira e sobrar margem.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const [novasDir, baseDir, saidaDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!novasDir || !baseDir || !saidaDir) {
  console.error('Uso: node scripts/encaixar-pecas.js <pecas-novas> <personagem-base> <saida>');
  process.exit(1);
}

const vectorParts = fs.existsSync(path.join(baseDir, 'PNG', 'Vector Parts'))
  ? path.join(baseDir, 'PNG', 'Vector Parts')
  : baseDir;

// Onde a peca encosta no esqueleto.
function ancoraDe(nome) {
  const n = nome.toLowerCase();
  if (/arm|hand|leg|foot/.test(n)) return 'topo';   // ombro, quadril
  if (/head/.test(n)) return 'base';                // apoia no pescoco
  return 'centro';                                  // corpo, rosto, escudo, arma, efeito
}

// Tira fundo branco. Num JPG o branco "puro" nao existe: sobra um halo de
// compressao em volta de cada contorno preto, e cortar no limiar duro deixa
// franja cinza. Entao a faixa de transicao vira alfa parcial, e no fim o alfa
// e erodido 1px -- a franja que sobrar fica por baixo do contorno.
function recortarDoBranco(img) {
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const m = (p[i] + p[i + 1] + p[i + 2]) / 3;
    if (m >= 247) p[i + 3] = 0;
    else if (m >= 224) p[i + 3] = Math.round(((247 - m) / 23) * 255);
  }
  // erosao de 1px no alfa
  const alfa = new Uint8ClampedArray(img.width * img.height);
  for (let j = 0, k = 3; j < alfa.length; j++, k += 4) alfa[j] = p[k];
  for (let y = 0; y < img.height; y++) {
    for (let X = 0; X < img.width; X++) {
      const j = y * img.width + X;
      if (!alfa[j]) continue;
      let menor = alfa[j];
      if (X > 0) menor = Math.min(menor, alfa[j - 1]);
      if (X < img.width - 1) menor = Math.min(menor, alfa[j + 1]);
      if (y > 0) menor = Math.min(menor, alfa[j - img.width]);
      if (y < img.height - 1) menor = Math.min(menor, alfa[j + img.width]);
      p[j * 4 + 3] = menor;
    }
  }
  x.putImageData(d, 0, 0);
  return c;
}

function caixaDeTinta(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let a = Infinity, b = -1, t = Infinity, u = -1;
  for (let y = 0; y < h; y++) {
    for (let X = 0; X < w; X++) {
      if (d[(y * w + X) * 4 + 3] > 40) {
        if (X < a) a = X;
        if (X > b) b = X;
        if (y < t) t = y;
        if (y > u) u = y;
      }
    }
  }
  return b < 0 ? null : { x: a, y: t, w: b - a + 1, h: u - t + 1 };
}

function semExtensao(n) {
  return n.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

(async () => {
  const originais = fs.readdirSync(vectorParts).filter((f) => /\.png$/i.test(f));
  const novas = fs.readdirSync(novasDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!originais.length) {
    console.error('Nenhum PNG de peca em ' + vectorParts);
    process.exit(1);
  }
  fs.mkdirSync(saidaDir, { recursive: true });

  const linhas = [];
  let feitas = 0;
  for (const nomeOrig of originais) {
    const alvo = semExtensao(nomeOrig);
    const nova = novas.find((f) => semExtensao(f) === alvo);
    if (!nova) {
      linhas.push('  ' + nomeOrig.padEnd(16) + ' -- sem peca nova, pulada');
      continue;
    }

    const orig = await loadImage(fs.readFileSync(path.join(vectorParts, nomeOrig)));
    const telaW = orig.width;
    const telaH = orig.height;
    const cOrig = createCanvas(telaW, telaH);
    cOrig.getContext('2d').drawImage(orig, 0, 0);
    const pegada = caixaDeTinta(cOrig);
    if (!pegada) {
      linhas.push('  ' + nomeOrig.padEnd(16) + ' -- original sem tinta, pulada');
      continue;
    }

    const limpa = recortarDoBranco(await loadImage(fs.readFileSync(path.join(novasDir, nova))));
    const cx = caixaDeTinta(limpa);
    if (!cx) {
      linhas.push('  ' + nomeOrig.padEnd(16) + ' -- peca nova vazia depois de tirar o branco');
      continue;
    }

    const escala = Math.min(pegada.w / cx.w, pegada.h / cx.h);
    const novoW = cx.w * escala;
    const novoH = cx.h * escala;
    const ancora = ancoraDe(nomeOrig);
    const destX = pegada.x + (pegada.w - novoW) / 2;
    const destY =
      ancora === 'topo' ? pegada.y
      : ancora === 'base' ? pegada.y + pegada.h - novoH
      : pegada.y + (pegada.h - novoH) / 2;

    const saida = createCanvas(telaW, telaH);
    const sx = saida.getContext('2d');
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(limpa, cx.x, cx.y, cx.w, cx.h, destX, destY, novoW, novoH);
    fs.writeFileSync(path.join(saidaDir, nomeOrig), saida.toBuffer('image/png'));
    feitas++;

    const aspOrig = pegada.w / pegada.h;
    const aspNova = cx.w / cx.h;
    const desvio = Math.abs(aspNova / aspOrig - 1) * 100;
    linhas.push(
      '  ' + nomeOrig.padEnd(16) + ' tela ' + (telaW + 'x' + telaH).padEnd(9) +
      ' pegada ' + (pegada.w + 'x' + pegada.h).padEnd(9) +
      ' ancora ' + ancora.padEnd(7) +
      ' aspecto ' + (desvio < 12 ? 'ok' : 'DIFERE ' + desvio.toFixed(0) + '%')
    );
  }

  console.log(feitas + ' de ' + originais.length + ' pecas encaixadas em ' + saidaDir);
  console.log('');
  linhas.forEach((l) => console.log(l));
  console.log('');
  console.log('"aspecto DIFERE" quer dizer que a peca nova tem outra forma que a original:');
  console.log('ela entra inteira e sobra margem, mas o desenho e de outro personagem naquele membro.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
