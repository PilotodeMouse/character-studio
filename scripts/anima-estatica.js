#!/usr/bin/env node
// Gera idle.webp e walk.webp no padrao do VTT a partir de DUAS IMAGENS
// ESTATICAS (frente e costas) -- sem rig, sem recortar peca nenhuma.
//
// Uso:
//   node scripts/anima-estatica.js <frente.png> <costas.png> <pasta-de-saida> [opcoes]
//
// Opcoes: --size 1x1|2x2|3x3   --frames 8   --respiro 1.8   --salto 7
//         --apoio 2.5          --inclinacao 1.6
//
// POR QUE ISSO EXISTE
// O fluxo normal do app monta a pose a partir de um rig (um PNG por peca, um
// osso por peca). Arte gerada por IA nao vem assim: vem UMA imagem chapada por
// vista, e recortar 14 pecas e repintar o que estava escondido atras do braco
// custa horas por personagem. Com centenas de NPCs isso nao fecha.
//
// A saida aqui e deformacao da imagem INTEIRA, linha a linha: cada linha e
// deslocada em funcao da altura dela, com os pes presos na linha do chao.
//  - idle: a altura respira (o peito enche, os pes nao saem do lugar)
//  - walk: o corpo salta duas vezes por ciclo e comprime ao tocar o chao
//
// ONDE ISSO FUNCIONA E ONDE NAO
// Vale pra figura de silhueta COMPACTA com os pes no chao -- o chibi de cabeca
// grande, bracos colados e pernas em toco. Nessa escala a perna tem ~5px no
// tabuleiro, e articular perna seria trabalho que ninguem ve. NAO vale pra
// quadrupede (o corpo e horizontal, respiro vertical nao diz nada) nem pra
// figura com membro estendido, que fica elastica.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const sharp = require('sharp');
const { cellSpecFor, ROWS, EXPORT } = require('../src/vtt-standards');

const MARGEM = 10;
const BANDA = 3; // altura da fatia ao deformar; 1px nao muda o resultado e e 3x mais lento

function arg(nome, padrao) {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const [frentePath, costasPath, saidaDir] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
if (!frentePath || !costasPath || !saidaDir) {
  console.error('Uso: node scripts/anima-estatica.js <frente.png> <costas.png> <pasta-de-saida> [--size 1x1] [--frames 8]');
  process.exit(1);
}

const OPC = {
  size: arg('size', '1x1'),
  frames: parseInt(arg('frames', '8'), 10),
  respiro: parseFloat(arg('respiro', '1.8')) / 100,
  salto: parseFloat(arg('salto', '7')),
  apoio: parseFloat(arg('apoio', '2.5')) / 100,
  inclinacao: parseFloat(arg('inclinacao', '1.6')),
  // Pra que lado a arte de COSTAS esta virada. NORTH tem que olhar pra cima-
  // direita e WEST pra cima-esquerda; se a imagem de costas veio virada pro
  // lado contrario, as duas linhas saem trocadas.
  //
  // Nao da pra detectar isso sozinho: a ideia obvia e comparar de que lado fica
  // a massa (o escudo) na frente e nas costas, que num par coerente trocam de
  // lado. Medido neste personagem, a frente desvia +2.7% da largura e as costas
  // -0.3% -- ou seja, ruido. Visto por tras o escudo fica escondido atras do
  // corpo e nao sobra assimetria pra medir. Entao e parametro, nao adivinhacao.
  //
  // Como a arte e GERADA, o jeito de nao decidir isso 300 vezes e padronizar o
  // pedido: peca sempre a vista de costas virada pro mesmo lado, e a opcao vira
  // uma constante do lote.
  inverterCostas: process.argv.includes('--inverter-costas'),
  // --cabeca separa a CABECA do corpo no idle. Um corte so, e o mais barato
  // que existe neste estilo: num chibi a cabeca e ~60% da figura, e hoje ela e
  // espremida junto com o corpo -- cranio que amassa le como borracha. Separada,
  // ela anda RIGIDA sobre o corpo que respira, com um atraso (o classico
  // "follow through"): e o que faz um idle parecer vivo em vez de pulsar.
  //
  // Sem repintura: o corte leva uma sobreposicao para dentro dos ombros maior
  // que o deslocamento da cabeca, entao nunca abre buraco no pescoco.
  cabeca: process.argv.includes('--cabeca'),
  atrasoCabeca: parseFloat(arg('atraso', '0.12')), // em fracao do ciclo
  subida: parseFloat(arg('subida', '4')), // px que a CABECA sobe no respiro (so com --cabeca)
  // Zero por padrao: qualquer balanco lateral na cabeca, somado ao do corpo,
  // vira serpenteado. So ligue se quiser de proposito.
  balancoCabeca: parseFloat(arg('balanco-cabeca', '0')),
};

// Tira o fundo branco da exportacao e recorta na tinta. Arte de IA costuma vir
// com fundo branco chapado; se ja vier transparente, a limpeza nao faz nada.
function prepararFigura(img) {
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i] > 243 && p[i + 1] > 243 && p[i + 2] > 243) p[i + 3] = 0;
  }
  x.putImageData(d, 0, 0);

  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let X = 0; X < img.width; X++) {
      if (p[(y * img.width + X) * 4 + 3] > 40) {
        if (X < minX) minX = X;
        if (X > maxX) maxX = X;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const corte = createCanvas(w, h);
  corte.getContext('2d').drawImage(c, minX, minY, w, h, 0, 0, w, h);

  // EIXO DO CORPO: o padrao diz que a linha azul e o centro do CORPO, nao o da
  // caixa em volta dele. Num personagem com escudo saindo pra um lado, os dois
  // nao sao a mesma coisa. Mede pelos PES, que estao sempre sob o tronco.
  const dc = corte.getContext('2d').getImageData(0, 0, w, h).data;
  const faixaPes = Math.max(0, h - Math.round(h * 0.06));
  let pesEsq = 1e9, pesDir = -1;
  for (let y = faixaPes; y < h; y++) {
    for (let X = 0; X < w; X++) {
      if (dc[(y * w + X) * 4 + 3] > 40) {
        if (X < pesEsq) pesEsq = X;
        if (X > pesDir) pesDir = X;
      }
    }
  }
  const eixo = pesDir >= 0 ? (pesEsq + pesDir) / 2 : w / 2;

  // PESCOCO: a linha mais estreita entre o cranio e o corpo. Num chibi isso e
  // um sinal forte -- a cabeca e uma bola larga e o corpo alarga de novo logo
  // abaixo. Procurado entre 45% e 80% da altura pra nao confundir com o topo
  // do cranio nem com a barra da tunica.
  const larguras = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let X = 0; X < w; X++) if (dc[(y * w + X) * 4 + 3] > 40) n++;
    larguras.push(n);
  }
  let pescoco = -1;
  let menor = Infinity;
  for (let y = Math.round(h * 0.45); y < Math.round(h * 0.8); y++) {
    if (larguras[y] < menor) { menor = larguras[y]; pescoco = y; }
  }
  const maiorCabeca = Math.max.apply(null, larguras.slice(Math.round(h * 0.15), Math.max(pescoco, 1)));
  const estrangulamento = maiorCabeca > 0 ? 1 - menor / maiorCabeca : 0;

  return { canvas: corte, w, h, eixo, pescoco, estrangulamento };
}

// A deformacao. t vai de 0 a 1 no ciclo.
function desenhar(ctx, fig, cel, escala, modo, t, offsetX, offsetY) {
  const giro = t * Math.PI * 2;
  let respiro, deslocY, incl;

  if (modo === 'idle') {
    // Com a cabeca separada o respiro age so no TRONCO, que e curto: no
    // Skeleton Crusader sao 87px na celula, e 1.8% disso da 1.6px de elevacao
    // -- invisivel. Entao o parametro passa a ser direto os PIXELS que a
    // CABECA sobe, e o tronco estica o quanto for preciso pra empurra-la ate
    // la. E a ordem certa de qualquer jeito: e o peito enchendo que levanta a
    // cabeca, nao o contrario.
    if (OPC.cabeca && fig.pescoco > 0) {
      // NADA deforma. Esticar o tronco parecia a conta certa (o peito enche e
      // levanta a cabeca), mas o tronco carrega o ESCUDO -- uma chapa rigida,
      // que esticada 5% le como borracha. E nao da pra esticar so o meio da
      // linha: a deformacao e por linha inteira.
      // Entao o corpo fica parado e so a cabeca sobe e desce. Num chibi em que
      // a cabeca e 73% da figura, e dela que o movimento tem que vir.
      respiro = 1;
      incl = 0;
    } else {
      respiro = 1 + OPC.respiro * Math.sin(giro);
      incl = OPC.inclinacao * Math.sin(giro + 0.6);
    }
    deslocY = 0;
  } else {
    deslocY = -OPC.salto * Math.abs(Math.sin(giro));
    respiro = 1 - OPC.apoio * Math.max(0, Math.cos(giro * 2));
    incl = OPC.inclinacao * Math.sin(giro);
  }

  const larg = fig.w * escala;
  const chao = cel.groundLineY + deslocY + offsetY;
  // o eixo do corpo (nao o da caixa) cai sobre a linha azul da celula
  const esquerda = cel.bodyAxisX + offsetX - fig.eixo * escala;

  // Sem separar a cabeca: deforma a figura inteira, linha a linha.
  const ateLinha = OPC.cabeca && fig.pescoco > 0 ? fig.pescoco : fig.h;
  const SOBRA = OPC.cabeca ? Math.round(fig.h * 0.05) : 0; // sobreposicao no pescoco

  for (let sy = OPC.cabeca ? ateLinha : 0; sy < fig.h; sy += BANDA) {
    const alturaBanda = escala * respiro * BANDA;
    const frac = 1 - sy / fig.h;
    const dy = chao - ((fig.h - sy) / BANDA) * alturaBanda;
    const dx = esquerda + incl * frac * frac;
    ctx.drawImage(fig.canvas, 0, sy, fig.w, BANDA, dx, dy, larg, alturaBanda + 1);
  }

  if (!OPC.cabeca || fig.pescoco <= 0) return;

  // A CABECA, rigida, pousada sobre o pescoco ja deformado -- mais um atraso,
  // que e o que faz ela parecer pesada em vez de colada.
  const topoDoCorpo = chao - (fig.h - ateLinha) * escala * respiro;
  const alturaCabeca = ateLinha + SOBRA;
  // UMA fase so. Antes o corpo balancava numa fase e a cabeca em outra (a
  // atrasada), e duas fases laterais diferentes dao serpenteado -- o
  // personagem parecia dancando. O atraso fica so no eixo VERTICAL, que e
  // onde ele le como peso.
  const sobe = -(OPC.subida / 2) * Math.sin((t - OPC.atrasoCabeca) * Math.PI * 2);
  const yCabeca = topoDoCorpo - ateLinha * escala + sobe;
  const xCabeca = esquerda + incl + OPC.balancoCabeca * Math.sin((t - OPC.atrasoCabeca) * Math.PI * 2);
  ctx.drawImage(
    fig.canvas, 0, 0, fig.w, alturaCabeca,
    xCabeca, yCabeca, larg, alturaCabeca * escala
  );
}

(async () => {
  const frente = prepararFigura(await loadImage(fs.readFileSync(frentePath)));
  const costas = prepararFigura(await loadImage(fs.readFileSync(costasPath)));
  const cel = cellSpecFor(OPC.size);

  // UMA escala pras quatro linhas: o personagem nao pode mudar de tamanho ao
  // virar. Cabe pelos DOIS lados -- escalar so pela altura corta as laterais
  // de quem for mais largo (aqui, a vista de frente, por causa do escudo).
  const maiorW = Math.max(frente.w, costas.w);
  const maiorH = Math.max(frente.h, costas.h);
  const escala = Math.min((cel.w - 2 * MARGEM) / maiorW, (cel.groundLineY - MARGEM) / maiorH);

  // NORTH e WEST mostram as COSTAS; EAST e SOUTH, a FRENTE. Dentro de cada par
  // uma e o espelho da outra (o mesmo pareamento do resto do app).
  const costasEspelhada = OPC.inverterCostas;
  const porLinha = {
    north: { fig: costas, espelha: costasEspelhada },
    east: { fig: frente, espelha: false },
    south: { fig: frente, espelha: true },
    west: { fig: costas, espelha: !costasEspelhada },
  };

  fs.mkdirSync(saidaDir, { recursive: true });
  const feitos = [];

  for (const modo of ['idle', 'walk']) {
    const folha = createCanvas(cel.w * OPC.frames, cel.h * ROWS.length);
    const ctx = folha.getContext('2d');
    ROWS.forEach((linha, i) => {
      const { fig, espelha } = porLinha[linha];
      for (let f = 0; f < OPC.frames; f++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(f * cel.w, i * cel.h, cel.w, cel.h);
        ctx.clip();
        if (espelha) {
          // espelho da CELULA em torno do eixo do corpo, como a Biblioteca faz
          ctx.translate(f * cel.w + cel.bodyAxisX * 2, 0);
          ctx.scale(-1, 1);
          ctx.translate(-f * cel.w, 0);
        }
        desenhar(ctx, fig, cel, escala, modo, f / OPC.frames, f * cel.w, i * cel.h);
        ctx.restore();
      }
    });

    const destino = path.join(saidaDir, modo + '.webp');
    await sharp(folha.toBuffer('image/png'))
      .webp({ quality: Math.round(EXPORT.quality * 100), alphaQuality: 100 })
      .toFile(destino);
    feitos.push({ modo, destino, w: folha.width, h: folha.height });
  }

  console.log('escala comum: ' + escala.toFixed(3) +
    '   figura na celula: ' + Math.round(maiorW * escala) + ' x ' + Math.round(maiorH * escala) + ' px' +
    '   (celula ' + cel.w + ' x ' + cel.h + ')');
  console.log('eixo do corpo medido pelos pes: frente x=' + frente.eixo.toFixed(0) + '/' + frente.w +
    '   costas x=' + costas.eixo.toFixed(0) + '/' + costas.w);
  const prop = (f) => (f.pescoco / f.h * 100).toFixed(0);
  console.log('pescoco: frente y=' + frente.pescoco + ' (' + prop(frente) + '% da altura, estrangulamento ' +
    Math.round(frente.estrangulamento * 100) + '%)   costas y=' + costas.pescoco + ' (' + prop(costas) +
    '%, ' + Math.round(costas.estrangulamento * 100) + '%)');
  const dif = Math.abs(frente.pescoco / frente.h - costas.pescoco / costas.h) * 100;
  if (dif > 6) {
    console.log('AVISO: a cabeca ocupa ' + prop(frente) + '% da figura numa vista e ' + prop(costas) +
      '% na outra -- ' + dif.toFixed(0) + ' pontos de diferenca. As duas imagens nao sao o mesmo');
    console.log('       personagem em proporcao, e o token vai mudar de cabeca ao virar. E arte, nao bake.');
  }
  console.log('');
  for (const f of feitos) {
    const kb = Math.round(fs.statSync(f.destino).size / 1024);
    console.log(f.modo.padEnd(5) + ' ' + f.w + ' x ' + f.h + '  ' + String(kb).padStart(4) + ' KB   ' + f.destino);
  }
  console.log('');
  console.log(ROWS.length + ' linhas (' + ROWS.join(', ') + ') x ' + OPC.frames + ' quadros, WebP q' +
    Math.round(EXPORT.quality * 100) + ', sem aparar.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
