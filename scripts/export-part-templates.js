#!/usr/bin/env node
// Gera, a partir do .scml de um personagem-base, um PNG-guia por peca: canvas
// EXATAMENTE do tamanho que o app vai usar, com uma cruz no ponto de pivo e a
// arte original como fantasma (10% de opacidade) por baixo. Importe cada guia
// como camada de fundo no seu software de vetor -- desenhando por cima dele,
// a arte nova sai com o mesmo tamanho de tela e o mesmo ponto de ancoragem da
// original, que e exatamente o que o app precisa pra reusar o rig sem
// nenhum ajuste manual.
//
// POR QUE ISSO IMPORTA
// drawPose (src/unity-skeleton.js) desenha cada peca com
// ctx.drawImage(img, offsetX, offsetY, w, h) -- w/h vem do .scml, NAO do
// tamanho real do PNG carregado. Uma arte nova com dimensao diferente da
// original e ESTICADA ou ACHATADA pra caber na caixa antiga, e o pivo (onde
// a peca gira/aninha no osso) tambem vem do .scml, nao da arte -- entao o
// canvas e o pivo tem que bater com o original pixel a pixel.
//
// Uso:
//   node scripts/export-part-templates.js "<pasta do personagem-base>" [pasta-de-saida]
//
// A pasta do personagem-base e a que tem PNG/Vector Parts/Animations.scml
// (a mesma que voce seleciona no app). A saida default e
// "<pasta-base>/PNG/Vector Parts/_guias-de-template".
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { DOMParser } = require('@xmldom/xmldom');
global.DOMParser = DOMParser;
const { parseSCML } = require('../src/scml-parser');

const characterDir = process.argv[2];
if (!characterDir) {
  console.error('Uso: node scripts/export-part-templates.js "<pasta do personagem-base>" [pasta-de-saida]');
  process.exit(1);
}
const vectorPartsDir = path.join(characterDir, 'PNG', 'Vector Parts');
const scmlFile = fs.readdirSync(vectorPartsDir).find((f) => f.toLowerCase().endsWith('.scml'));
if (!scmlFile) {
  console.error(`Nao achei um .scml em ${vectorPartsDir}`);
  process.exit(1);
}
const outDir = process.argv[3] || path.join(vectorPartsDir, '_guias-de-template');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const scml = parseSCML(fs.readFileSync(path.join(vectorPartsDir, scmlFile), 'utf8'));
  const parts = [];
  for (const files of Object.values(scml.folders)) {
    for (const f of Object.values(files)) parts.push(f);
  }

  const rows = [];
  for (const part of parts) {
    const canvas = createCanvas(part.width, part.height);
    const ctx = canvas.getContext('2d');

    const srcPath = path.join(vectorPartsDir, part.name);
    if (fs.existsSync(srcPath)) {
      ctx.globalAlpha = 0.12;
      ctx.drawImage(await loadImage(srcPath), 0, 0, part.width, part.height);
      ctx.globalAlpha = 1;
    }

    // pivo em coordenadas de canvas: mesma conversao que drawPose usa
    // (Spriter e Y-up/origem embaixo; canvas e Y-down/origem em cima).
    const px = part.pivotX * part.width;
    const py = (1 - part.pivotY) * part.height;
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = Math.max(1, Math.round(Math.min(part.width, part.height) / 120));
    const armLen = Math.max(part.width, part.height) * 0.06;
    ctx.beginPath();
    ctx.moveTo(px - armLen, py);
    ctx.lineTo(px + armLen, py);
    ctx.moveTo(px, py - armLen);
    ctx.lineTo(px, py + armLen);
    ctx.stroke();
    ctx.strokeStyle = '#6b6b6b';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, part.width - 1, part.height - 1);

    const outPath = path.join(outDir, part.name);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    rows.push({ name: part.name, w: part.width, h: part.height, pivotX: part.pivotX, pivotY: part.pivotY });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  const table = rows
    .map((r) => `${r.name.padEnd(20)} ${String(r.w).padStart(4)} x ${String(r.h).padEnd(4)} px   pivo (${r.pivotX.toFixed(2)}, ${r.pivotY.toFixed(2)})`)
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'ESPECIFICACAO.txt'), table + '\n');

  console.log(`${rows.length} guias gravados em:\n  ${outDir}\n`);
  console.log(table);
  console.log(`\nMesma lista em ESPECIFICACAO.txt dentro dessa pasta.`);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
