// Roda a regra de LADO/PROFUNDIDADE (src/side-depth.js) em cima de uma
// biblioteca inteira de pacotes Craftpix, sem abrir o Electron, e diz em quais
// personagens o app resolve sozinho a troca de lados -- a que mantem a arma na
// mesma mao quando o personagem se vira -- e em quais vai precisar de mao.
//
// So le o .scml (nome e z-index de cada peca). Nao extrai .unitypackage, nao
// carrega imagem: roda a biblioteca toda em segundos e nao sofre com acento no
// caminho (o node-canvas sofre, ver CLAUDE.md).
//
// Uso:
//   node scripts/check-side-depth.js "<pasta com os pacotes>" [--detalhe]
//
// Ex:
//   node scripts/check-side-depth.js "E:/_RPG/.../Personagens Chibi"
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
global.DOMParser = DOMParser;

const { parseSCML } = require('../src/scml-parser');
const { getZIndexByPartName } = require('../src/scml-zorder');
const { sideSwapDepthOrder, sidesOfParts, maoDaArmaPorNome, isHandName, isHeldItemName } = require('../src/side-depth');

const raiz = process.argv[2];
const detalhe = process.argv.includes('--detalhe');
if (!raiz) {
  console.error('Uso: node scripts/check-side-depth.js "<pasta com os pacotes>" [--detalhe]');
  process.exit(1);
}

// Procura pastas de personagem (as que tem PNG/Vector Parts/*.scml) ate 3
// niveis abaixo da raiz -- e como a biblioteca do usuario e organizada:
// <tema>/<pacote>/PNG/Vector Parts.
function acharPersonagens(dir, profundidade = 0) {
  if (profundidade > 3) return [];
  let out = [];
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const vector = path.join(dir, 'PNG', 'Vector Parts');
  if (fs.existsSync(vector) && fs.readdirSync(vector).some((f) => f.toLowerCase().endsWith('.scml'))) {
    return [dir];
  }
  for (const e of entradas) {
    if (e.isDirectory()) out = out.concat(acharPersonagens(path.join(dir, e.name), profundidade + 1));
  }
  return out;
}

// A MESMA ordem que currentLayers(new Map()) monta no app: peca por z crescente
// (fundo -> frente), vinda do z_index do .scml.
function ordemDoScml(scmlPath) {
  const parsed = parseSCML(fs.readFileSync(scmlPath, 'utf8'));
  const z = getZIndexByPartName(parsed);
  return [...z.entries()].sort((a, b) => a[1] - b[1]).map(([nome]) => nome);
}

const personagens = acharPersonagens(raiz);
if (!personagens.length) {
  console.error(`Nenhuma pasta com PNG/Vector Parts/*.scml embaixo de ${raiz}`);
  process.exit(1);
}

const linhas = [];
let decideSozinho = 0;
let semTroca = 0;
let semNome = 0;

for (const dir of personagens) {
  const vector = path.join(dir, 'PNG', 'Vector Parts');
  const scml = fs.readdirSync(vector).find((f) => f.toLowerCase().endsWith('.scml'));
  const nome = path.relative(raiz, dir).replace(/\\/g, '/');
  let ordem;
  try {
    ordem = ordemDoScml(path.join(vector, scml));
  } catch (err) {
    linhas.push(`ERRO   ${nome}: ${err.message}`);
    continue;
  }

  const lados = sidesOfParts(ordem);
  const maos = ordem.filter(isHandName);
  const segurados = ordem.filter(isHeldItemName);
  const arma = maoDaArmaPorNome(ordem);
  const trocada = sideSwapDepthOrder(ordem);
  const mudou = trocada.some((n, i) => n !== ordem[i]);

  const notas = [];
  if (!mudou) notas.push('NAO TROCA (os dois lados nao formam blocos separados na pilha)');
  if (maos.length < 2) notas.push(`so ${maos.length} mao(s) no rig`);
  else if (!arma) notas.push('mao da arma indecisa pelo nome -> o app decide pela medida (a mao que mais se mexe)');

  if (mudou) decideSozinho++;
  else semTroca++;
  if (maos.length >= 2 && !arma) semNome++;

  const marca = !mudou ? 'ATENCAO' : arma || maos.length < 2 ? 'OK     ' : 'MEDIDA ';
  linhas.push(
    `${marca} ${nome}  [${ordem.length} pecas | maos: ${maos.join(', ') || '-'} | segura: ${segurados.join(', ') || '-'}` +
      `${arma ? ` | arma na ${arma}` : ''}]${notas.length ? '\n         ' + notas.join('; ') : ''}`
  );
  if (detalhe) {
    linhas.push(`         antes:  ${ordem.map((n) => n + (lados.get(n) ? `[${lados.get(n)[0].toUpperCase()}]` : '')).join(' > ')}`);
    linhas.push(`         depois: ${trocada.join(' > ')}`);
  }
}

console.log(linhas.join('\n'));
console.log(
  `\n${personagens.length} personagens: ${decideSozinho} com a troca de lados automatica, ` +
    `${semTroca} sem troca (ordem de camadas na mao), ${semNome} com a mao da arma decidida pela medida em vez do nome.`
);
