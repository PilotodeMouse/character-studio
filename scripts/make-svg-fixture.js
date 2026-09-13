// Gera um personagem SVG sintetico (retangulos coloridos) so pra validar o
// pipeline do rig semantico (template-skeleton + motion-templates) de ponta
// a ponta antes de existir arte de verdade.
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'test-fixtures', 'svg-hero');
fs.mkdirSync(outDir, { recursive: true });

function rectSvg(w, h, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.15}" fill="${color}"/></svg>`;
}

fs.writeFileSync(path.join(outDir, 'head.svg'), rectSvg(40, 40, '#e0b8a0'));
fs.writeFileSync(path.join(outDir, 'torso.svg'), rectSvg(50, 70, '#4a6fa5'));
fs.writeFileSync(path.join(outDir, 'arm-main.svg'), rectSvg(14, 60, '#e0b8a0'));
fs.writeFileSync(path.join(outDir, 'arm-off.svg'), rectSvg(14, 60, '#e0b8a0'));
fs.writeFileSync(path.join(outDir, 'leg-left.svg'), rectSvg(18, 90, '#333'));
fs.writeFileSync(path.join(outDir, 'leg-right.svg'), rectSvg(18, 90, '#333'));

console.log('SVGs escritos em', outDir);
