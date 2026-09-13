// Le so o suficiente do XML de um SVG pra saber suas dimensoes logicas --
// usa viewBox quando existe (mais confiavel), senao width/height do proprio
// elemento <svg>. Isso e o que da a "caixa" sobre a qual o pivo (0..1) do
// binding e calculado.
const fs = require('fs');

function parseLength(v) {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[a-z%]+$/i, ''));
  return Number.isFinite(n) ? n : null;
}

function readSvgSize(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const svgTagMatch = text.match(/<svg[^>]*>/i);
  if (!svgTagMatch) throw new Error(`Nao encontrei a tag <svg> em ${filePath}`);
  const tag = svgTagMatch[0];

  const viewBoxMatch = tag.match(/viewBox=["']([^"']+)["']/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const widthMatch = tag.match(/[^-]width=["']([^"']+)["']/i);
  const heightMatch = tag.match(/[^-]height=["']([^"']+)["']/i);
  const width = widthMatch ? parseLength(widthMatch[1]) : null;
  const height = heightMatch ? parseLength(heightMatch[1]) : null;
  if (width && height) return { width, height };

  throw new Error(`Nao consegui determinar as dimensoes de ${filePath} (sem viewBox nem width/height numericos).`);
}

module.exports = { readSvgSize };
