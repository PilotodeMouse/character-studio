#!/usr/bin/env node
// Confere a "fiacao" do app SEM precisar abrir o Electron.
//
// POR QUE ISSO EXISTE
// O renderer nao e compilado: um getElementById que devolve null so estoura
// em tempo de execucao, no meio de um clique, e como todo o app.js roda dentro
// de uma IIFE, UM erro desses mata todos os addEventListener registrados
// depois dele -- o sintoma e "nada funciona", sem nenhuma pista de onde
// comecou. Ja aconteceu duas vezes: quando o app.js de uma branch foi copiado
// por cima de um index.html antigo (faltavam preview-sel-bg, preview-chk-guides,
// zoom, imagem de referencia) e quando o app.js passou a importar
// fitScaleForBounds de um vtt-standards.js que nao exportava a funcao.
//
// Roda com: node scripts/check-renderer-wiring.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const problems = [];
const checked = { modulos: 0, imports: 0, ids: 0, canais: 0 };

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 1. Todo modulo de src/ tem que carregar sozinho.
for (const file of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
  checked.modulos++;
  try {
    require(path.join(ROOT, 'src', file));
  } catch (err) {
    problems.push(`src/${file} nao carrega: ${err.message}`);
  }
}

const rendererFiles = fs
  .readdirSync(path.join(ROOT, 'renderer'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: `renderer/${f}`, text: read(`renderer/${f}`) }));

// 2. Todo nome desestruturado de um require('../src/...') tem que existir
//    de verdade nos exports daquele modulo.
for (const { name, text } of rendererFiles) {
  const re = /const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\.\/src\/([\w-]+)['"]\)/g;
  let m;
  while ((m = re.exec(text))) {
    const wanted = m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
    let mod;
    try {
      mod = require(path.join(ROOT, 'src', m[2]));
    } catch (err) {
      problems.push(`${name}: require('../src/${m[2]}') falhou: ${err.message}`);
      continue;
    }
    for (const w of wanted) {
      checked.imports++;
      if (!(w in mod)) problems.push(`${name}: importa "${w}" de src/${m[2]}, que NAO exporta esse nome`);
    }
  }
}

// 3. Todo getElementById tem que achar um id no index.html.
const html = read('renderer/index.html');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
// ids criados em tempo de execucao pelo proprio JS (innerHTML), nao vem do html
const runtimeIds = new Set(
  rendererFiles.flatMap(({ text }) => [...text.matchAll(/id=\\?["']([\w-]+)\\?["']/g)].map((m) => m[1]))
);
for (const { name, text } of rendererFiles) {
  for (const m of text.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    checked.ids++;
    const id = m[1];
    if (!htmlIds.has(id) && !runtimeIds.has(id)) {
      problems.push(`${name}: getElementById('${id}') -- esse id nao existe em renderer/index.html`);
    }
  }
}

// 4. Todo canal de ipcRenderer.invoke tem que ter um ipcMain.handle no main.js.
const main = read('main.js');
const handled = new Set([...main.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
for (const { name, text } of rendererFiles) {
  for (const m of text.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)) {
    checked.canais++;
    if (!handled.has(m[1])) {
      problems.push(`${name}: ipcRenderer.invoke('${m[1]}') -- main.js nao registra esse canal`);
    }
  }
}

// 5. Nenhum caractere de controle invisivel no fonte. Ja aconteceu: uma
// edicao automatizada transformou o "\b" de uma regex (/^body\b/i) num byte
// 0x08 de verdade. O arquivo continua rodando, a regex simplesmente nunca
// casa, e o sintoma ("o botao faz a coisa errada") nao aponta pra lugar
// nenhum -- ate no grep o caractere e invisivel.
const CONTROL_OK = new Set([9, 10, 13]); // tab, \n, \r
const sourceFiles = [
  ...rendererFiles.map((f) => f.name),
  ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
  'renderer/index.html',
  'main.js',
];
for (const file of sourceFiles) {
  const buf = fs.readFileSync(path.join(ROOT, file));
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c < 32 && !CONTROL_OK.has(c)) {
      const linha = buf.slice(0, i).toString('utf8').split('\n').length;
      problems.push(`${file}:${linha} -- caractere de controle invisivel 0x${c.toString(16)} no fonte`);
      break; // um aviso por arquivo ja basta pra achar
    }
  }
}

// Funcao declarada DUAS VEZES no mesmo arquivo. O JS aceita (a ultima vence) e
// nada quebra, entao isso passa despercebido -- ja aconteceu em
// src/side-depth.js, onde duas edicoes seguidas deixaram `ladoDaCamera` e
// `ehEscudo` duplicadas. O risco nao e hoje: e editar a copia de cima e nao
// entender por que o comportamento nao muda.
for (const dir of ['src', 'renderer']) {
  for (const nome of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js'))) {
    const texto = fs.readFileSync(path.join(ROOT, dir, nome), 'utf8');
    const vistas = new Map();
    for (const linha of texto.split(String.fromCharCode(10))) {
      const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(linha);
      if (m) vistas.set(m[1], (vistas.get(m[1]) || 0) + 1);
    }
    for (const [fn, n] of vistas) {
      if (n > 1) {
        problems.push(`${dir}/${nome}: function ${fn}() declarada ${n} vezes -- a ultima vence e as outras viram codigo morto`);
      }
    }
  }
}

// ARRANJOS: uma direcao FONTE nunca pode ser espelhada.
//
// Quem deriva de uma fonte le os ajustes dela (effectiveOffsets), e a correcao
// automatica do espelho (troca de lado em profundidade e de ombro) e gravada na
// linha espelhada. Se a mesma linha for as duas coisas, a correcao do espelho
// dela vaza pra quem deriva dela: medido, empurrou os bracos do SOUTH 139px
// pro lado quando o EAST era espelhado e fonte ao mesmo tempo.
const { ARRANJOS } = require(path.join(ROOT, 'src', 'vtt-standards'));
let arranjosConferidos = 0;
for (const [nome, arranjo] of Object.entries(ARRANJOS)) {
  arranjosConferidos++;
  for (const [linha, [fonte, espelha]] of Object.entries(arranjo)) {
    if (!espelha) continue;
    const derivadas = Object.entries(arranjo)
      .filter(([outra, v]) => outra !== linha && v[0] === linha)
      .map(([outra]) => outra);
    if (derivadas.length) {
      problems.push(
        `ARRANJOS.${nome}: a linha ${linha} e ESPELHADA (de ${fonte}) e ao mesmo tempo e fonte de ${derivadas.join(', ')} -- ` +
          'a correcao automatica do espelho dela vai vazar pra essas. Inverta: a linha desenhada e a fonte.'
      );
    }
  }
}

console.log(
  `Conferido: ${checked.modulos} modulos, ${checked.imports} imports, ${checked.ids} getElementById, ${checked.canais} canais IPC, ${arranjosConferidos} arranjos.`
);
if (!problems.length) {
  console.log('OK -- nenhuma ponta solta.');
  process.exit(0);
}
console.error(`\n${problems.length} problema(s):`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
