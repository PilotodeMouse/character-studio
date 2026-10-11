#!/usr/bin/env node
// Monta um rig (.scml) a partir de pecas recortadas a mao.
//
// Uso:
//   node scripts/gerar-rig.js <pasta-com-as-pecas>
//
// POR QUE ISSO EXISTE
// Os pacotes da Craftpix trazem o rig pronto, mas so pros personagens deles.
// Pra um personagem desenhado do zero nao existe .scml nenhum -- e fazer um na
// mao, no Spriter, exige aprender o Spriter. Aqui o rig sai MEDIDO das proprias
// pecas: onde cada membro encosta no corpo e onde fica a junta.
//
// A PASTA TEM QUE ESTAR "EM REGISTRO"
// Todas as pecas na MESMA tela, cada uma no lugar em que ela ja esta no desenho.
// E o jeito mais facil de recortar (duplica a imagem, apaga o que nao e a peca,
// exporta) e e o que da a pose de repouso de graca: montando as pecas sem mover
// nada, o resultado e a ilustracao original. O script confere isso e recusa se
// as telas divergirem -- sem registro nao ha pose de repouso, e ai o rig teria
// de ser posicionado no olho.
//
// NENHUM PNG E REESCRITO. O .scml aponta pras pecas como elas estao e carrega o
// pivo como fracao da tela. Reamostrar a arte pra "economizar" tela so
// introduziria perda num passo que nao precisa existir.
//
// AS JUNTAS
// Membro: o topo da calota arredondada (o ombro, o quadril). Por isso o recorte
// precisa ultrapassar a junta e terminar em curva -- um corte reto abre uma
// fatia vazia assim que o membro gira.
// Cabeca: o centro do topo do tronco, que e onde o pescoco estaria.
// Tronco: o centro do corpo na altura em que a perna mais alta comeca.
// Pra corrigir qualquer uma, ponha um `juntas.json` na pasta com
// {"head":[x,y], ...} em pixels da tela original; ele manda no que for medido.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const pasta = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!pasta) {
  console.error('Uso: node scripts/gerar-rig.js <pasta-com-as-pecas> [--respiros N] [--passadas N]');
  process.exit(1);
}

function opcao(nome, padrao) {
  const i = process.argv.indexOf('--' + nome);
  if (i < 0) return padrao;
  const v = parseFloat(process.argv[i + 1]);
  return Number.isFinite(v) ? v : padrao;
}

// QUANTOS CICLOS CABEM NA FOLHA, e por que isso e o unico controle de
// velocidade que existe aqui.
// O baker amostra `t = (quadro * duracao) / totalDeQuadros`: os quadros sao
// sempre distribuidos por UM comprimento de clip, entao mudar a duracao nao
// muda um pixel do .webp -- 1.8s e 0.5s geram os mesmos desenhos. Quem decide
// a velocidade de reproducao e o VTT. O que da pra fazer deste lado e botar
// mais de um ciclo DENTRO da folha: com dois respiros, a mesma taxa do VTT
// mostra o personagem respirando duas vezes no tempo em que antes respirava
// uma. Vale aumentar os quadros junto (4 por ciclo e o minimo pra ficar
// suave), senao sobra so "sobe e desce".
const RESPIROS = Math.max(1, Math.round(opcao('respiros', 2)));
const PASSADAS = Math.max(1, Math.round(opcao('passadas', 1)));

// Repete um conjunto de trilhas N vezes, emendando um ciclo no outro.
function repetir(trilhas, n) {
  if (n === 1) return trilhas;
  const out = {};
  for (const [alvo, campos] of Object.entries(trilhas)) {
    out[alvo] = {};
    for (const [campo, vals] of Object.entries(campos)) {
      out[alvo][campo] = Array.from({ length: vals.length * n }, (_, i) => vals[i % vals.length]);
    }
  }
  return out;
}

// Os instantes das keys, igualmente espacados, pra `n` ciclos de `passos` keys.
function temposDe(len, passos, n) {
  const total = passos * n;
  return Array.from({ length: total }, (_, i) => Math.round((i * len) / total));
}

// Arte de DIRECAO, nao peca do rig: `body-back.png` e a textura que o NORTH e
// o WEST usam no lugar de `body.png`, na mesma tela e no mesmo pivo. O app
// casa esses arquivos sozinho (matchRowArtFiles em src/back-art.js); aqui eles
// so nao podem entrar como se fossem uma segunda peca de tronco -- sem este
// filtro o script aborta com "Duas pecas para body" assim que o usuario
// desenha as costas, que e justamente o passo seguinte.
const SUFIXOS_DE_VISTA = /(back|costas|front|frente|south|sul|west|oeste|north|norte|l[-_ ]?view|r[-_ ]?view)$/i;

// Qual peca e qual, tolerante a erro de digitacao no nome do arquivo: a chave e
// a palavra "arm"/"leg"/"head"/"body", e o lado e so a presenca de "right".
// "letf-arm.png" (digitado errado) cai em braco esquerdo sem drama.
function papelDe(arquivo) {
  const semExt = arquivo.replace(/\.[a-z0-9]+$/i, '');
  if (SUFIXOS_DE_VISTA.test(semExt)) return null;
  const n = semExt.toLowerCase().replace(/[^a-z]/g, '');
  const dir = /right|dir/.test(n);
  if (/head|cabec/.test(n)) return 'head';
  if (/body|tronco|corpo/.test(n)) return 'body';
  if (/arm|braco/.test(n)) return dir ? 'armR' : 'armL';
  if (/leg|perna/.test(n)) return dir ? 'legR' : 'legL';
  return null;
}

const ROTULO = {
  head: 'Head',
  body: 'Body',
  armL: 'Left Arm',
  armR: 'Right Arm',
  legL: 'Left Leg',
  legR: 'Right Leg',
};
// Ordem de desenho: braco de tras, pernas, tronco, cabeca, braco da frente.
const Z = { armL: 0, legL: 1, legR: 2, body: 3, head: 4, armR: 5 };

async function medir(arquivo) {
  const img = await loadImage(fs.readFileSync(arquivo));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const alfa = new Uint8Array(img.width * img.height);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (d[(y * img.width + x) * 4 + 3] > 40) {
        alfa[y * img.width + x] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { w: img.width, h: img.height, alfa, x0, y0, x1, y1, vazia: x1 < 0 };
}

// Centro horizontal da tinta numa faixa de linhas.
function centroEm(m, ya, yb) {
  let soma = 0;
  let n = 0;
  for (let y = Math.max(0, ya); y <= Math.min(m.h - 1, yb); y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.alfa[y * m.w + x]) {
        soma += x;
        n++;
      }
    }
  }
  return n ? Math.round(soma / n) : null;
}

// A interpolacao de angulo no Spriter segue o `spin` da key de origem, nao o
// caminho curto: de +18 para -18 com spin=1 o membro da a volta por 342 graus.
function spinEntre(a, b) {
  const d = ((b - a + 540) % 360) - 180;
  return d < 0 ? -1 : 1;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

(async () => {
  const arquivos = fs.readdirSync(pasta).filter((f) => /\.png$/i.test(f) && !f.startsWith('_'));
  const pecas = {};
  for (const f of arquivos) {
    const papel = papelDe(f);
    if (!papel) {
      const vista = SUFIXOS_DE_VISTA.test(f.replace(/\.[a-z0-9]+$/i, ''));
      console.log(
        vista
          ? '  arte de direcao (o app usa, o rig nao): ' + f
          : '  ignorado (nao reconheci a peca): ' + f
      );
      continue;
    }
    if (pecas[papel]) {
      console.error('Duas pecas para "' + papel + '": ' + pecas[papel].arquivo + ' e ' + f);
      process.exit(1);
    }
    pecas[papel] = { arquivo: f, m: await medir(path.join(pasta, f)) };
  }

  const faltando = Object.keys(ROTULO).filter((p) => !pecas[p]);
  if (faltando.length) {
    console.error('Faltam pecas: ' + faltando.map((p) => ROTULO[p]).join(', '));
    process.exit(1);
  }

  // Registro: todas na mesma tela.
  const W = pecas.body.m.w;
  const H = pecas.body.m.h;
  for (const p of Object.values(pecas)) {
    if (p.m.vazia) {
      console.error(p.arquivo + ' esta vazia (so transparencia).');
      process.exit(1);
    }
    if (p.m.w !== W || p.m.h !== H) {
      console.error(
        'Fora de registro: ' + p.arquivo + ' e ' + p.m.w + 'x' + p.m.h +
          ' e ' + pecas.body.arquivo + ' e ' + W + 'x' + H + '.\n' +
          'Todas as pecas precisam estar na MESMA tela, cada uma no lugar dela no desenho.'
      );
      process.exit(1);
    }
  }

  // Juntas.
  const juntas = {};
  for (const papel of ['armL', 'armR', 'legL', 'legR']) {
    const m = pecas[papel].m;
    const faixa = Math.max(2, Math.round((m.y1 - m.y0) * 0.06));
    juntas[papel] = { x: centroEm(m, m.y0, m.y0 + faixa), y: m.y0 + Math.round(faixa / 2) };
  }
  const b = pecas.body.m;
  juntas.head = {
    x: centroEm(b, b.y0, b.y0 + Math.round((b.y1 - b.y0) * 0.12)),
    y: b.y0 + 10,
  };
  const topoPerna = Math.min(pecas.legL.m.y0, pecas.legR.m.y0);
  juntas.body = { x: centroEm(b, topoPerna - 20, topoPerna + 20), y: topoPerna };

  const override = path.join(pasta, 'juntas.json');
  if (fs.existsSync(override)) {
    const j = JSON.parse(fs.readFileSync(override, 'utf8'));
    for (const [k, v] of Object.entries(j)) {
      if (juntas[k] && Array.isArray(v)) juntas[k] = { x: v[0], y: v[1] };
    }
    console.log('juntas.json aplicado por cima do que foi medido.');
  }

  // Spriter e Y pra cima; a tela e Y pra baixo. Mas a origem NAO pode ser o
  // canto da tela: o padrao do VTT posiciona a figura em relacao a ORIGEM DO
  // MUNDO -- ela cai no eixo do corpo (x=128 da celula) e na linha do chao
  // (y=416), e e sobre ela que fitScaleForBounds decide a escala. Com a origem
  // no canto esquerdo o app le "o personagem inteiro esta a direita do eixo" e
  // encolhe pra caber nessa metade: medido, escala 0.137 e 120px de largura
  // numa celula de 256.
  // Entao a origem e o CHAO NO EIXO DO CORPO: x no quadril (que e tambem o eixo
  // em torno do qual o app espelha) e y no pixel mais baixo de tinta.
  const chaoY = Math.max(...Object.values(pecas).map((p) => p.m.y1)) + 1;
  const eixoX = juntas.body.x;
  const mundo = (p) => ({ x: p.x - eixoX, y: chaoY - p.y });
  const q = mundo(juntas.body); // quadril: a raiz de tudo
  const rel = (papel) => {
    const w = mundo(juntas[papel]);
    return { x: w.x - q.x, y: w.y - q.y };
  };

  const OSSOS = [
    { nome: 'hip', pai: -1, x: q.x, y: q.y },
    { nome: 'torso', pai: 0, x: 0, y: 0 },
    { nome: 'neck', pai: 1, ...rel('head') },
    { nome: 'shoulderL', pai: 1, ...rel('armL') },
    { nome: 'shoulderR', pai: 1, ...rel('armR') },
    { nome: 'hipL', pai: 0, ...rel('legL') },
    { nome: 'hipR', pai: 0, ...rel('legR') },
  ];
  const OSSO_DA_PECA = { body: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6 };

  // Cada sprite e filho do osso dele com deslocamento ZERO, porque o pivo do
  // sprite E a junta. Girar o osso gira a peca em torno da junta, que e a
  // definicao de articulacao -- sem nenhuma conta de compensacao.
  const ORDEM = ['body', 'head', 'armL', 'armR', 'legL', 'legR'];

  const ANIMS = [
    { nome: 'Rig Base', len: 100, loop: false, tempos: [0], trilhas: {} },
    {
      // Respiracao. O tronco sobe e desce inteiro (a cabeca vai junto, pendurada
      // nele) e o peito incha um tiquinho por fora, no proprio sprite -- escala
      // em OSSO propagaria pros filhos e a cabeca cresceria junto.
      //
      // A CABECA NAO GIRA, so sobe e desce. Num chibi de cranio enorme o pescoco
      // fica fora do eixo do corpo (medido neste: 42px a esquerda do quadril),
      // entao um grau de rotacao vira dezenas de pixels de deslocamento lateral
      // la em cima -- e o personagem parece bambear, nao respirar. Movimento
      // so no eixo vertical.
      nome: 'Idle',
      len: 1800,
      loop: true,
      tempos: temposDe(1800, 4, RESPIROS),
      trilhas: repetir(
        {
          torso: { y: [0, 7, 0, -3] },
          neck: { y: [0, 2, 0, -1] },
          shoulderL: { angle: [0, 1.4, 0, -1.4] },
          shoulderR: { angle: [0, -1.1, 0, 1.1] },
          '@body': { scaleY: [1, 1.015, 1, 0.996] },
        },
        RESPIROS
      ),
    },
    {
      // Caminhada. O corpo sobe duas vezes por ciclo (uma por passo) e os bracos
      // vao em contrafase com a perna do mesmo lado, que e o que o corpo humano
      // faz pra nao girar o tronco.
      //
      // O braco do escudo balanca MENOS que o outro (6 contra 10 graus): o pivo
      // dele e o ombro, e o escudo esta na ponta, entao o mesmo angulo varre
      // muito mais pixel desse lado. Igualar os dois no papel desiguala na tela.
      // E a cabeca, de novo, so sobe e desce.
      nome: 'Walk',
      len: 800,
      loop: true,
      tempos: temposDe(800, 4, PASSADAS),
      trilhas: repetir(
        {
          hip: { y: [0, 12, 0, 12] },
          torso: { angle: [0, 1, 0, -1] },
          hipL: { angle: [18, 0, -18, 0] },
          hipR: { angle: [-18, 0, 18, 0] },
          shoulderL: { angle: [-10, 0, 10, 0] },
          shoulderR: { angle: [6, 0, -6, 0] },
          neck: { y: [0, -3, 0, -3] },
        },
        PASSADAS
      ),
    },
  ];

  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push(
    '<spriter_data scml_version="1.0" generator="isometric-character-studio/gerar-rig" generator_version="1.0">'
  );
  L.push('    <folder id="0">');
  ORDEM.forEach((papel, i) => {
    const j = juntas[papel];
    const px = (j.x / W).toFixed(6);
    const py = ((H - j.y) / H).toFixed(6);
    L.push(
      '        <file id="' + i + '" name="' + esc(pecas[papel].arquivo) + '" width="' + W +
        '" height="' + H + '" pivot_x="' + px + '" pivot_y="' + py + '"/>'
    );
  });
  L.push('    </folder>');
  L.push('    <entity id="0" name="Personagem">');

  ANIMS.forEach((anim, ai) => {
    L.push(
      '        <animation id="' + ai + '" name="' + esc(anim.nome) + '" length="' + anim.len +
        '" looping="' + anim.loop + '">'
    );
    L.push('            <mainline>');
    L.push('                <key id="0" time="0">');
    OSSOS.forEach((o, i) => {
      const pai = o.pai >= 0 ? ' parent="' + o.pai + '"' : '';
      L.push('                    <bone_ref id="' + i + '"' + pai + ' timeline="' + i + '" key="0"/>');
    });
    ORDEM.forEach((papel, i) => {
      L.push(
        '                    <object_ref id="' + i + '" parent="' + OSSO_DA_PECA[papel] +
          '" timeline="' + (OSSOS.length + i) + '" key="0" z_index="' + Z[papel] + '"/>'
      );
    });
    L.push('                </key>');
    L.push('            </mainline>');

    const keysDe = (base, trilha) => {
      const n = anim.tempos.length;
      const vals = (campo, padrao) => {
        const v = trilha && trilha[campo];
        return Array.from({ length: n }, (_, k) => (v ? v[k] : padrao));
      };
      const ang = vals('angle', 0);
      const xs = vals('x', 0);
      const ys = vals('y', 0);
      const sx = vals('scaleX', 1);
      const sy = vals('scaleY', 1);
      return anim.tempos.map((t, k) => {
        const prox = (k + 1) % n;
        const spin = anim.loop || k < n - 1 ? spinEntre(ang[k], ang[prox]) : 1;
        return {
          t,
          k,
          spin,
          x: base.x + xs[k],
          y: base.y + ys[k],
          angle: ((ang[k] % 360) + 360) % 360,
          sx: sx[k],
          sy: sy[k],
        };
      });
    };

    OSSOS.forEach((o, i) => {
      L.push('            <timeline id="' + i + '" name="' + o.nome + '" object_type="bone">');
      for (const kk of keysDe({ x: o.x, y: o.y }, anim.trilhas[o.nome])) {
        L.push('                <key id="' + kk.k + '" time="' + kk.t + '" spin="' + kk.spin + '">');
        L.push(
          '                    <bone x="' + kk.x.toFixed(2) + '" y="' + kk.y.toFixed(2) +
            '" angle="' + kk.angle + '" scale_x="' + kk.sx + '" scale_y="' + kk.sy + '"/>'
        );
        L.push('                </key>');
      }
      L.push('            </timeline>');
    });

    ORDEM.forEach((papel, i) => {
      L.push('            <timeline id="' + (OSSOS.length + i) + '" name="' + esc(ROTULO[papel]) + '">');
      for (const kk of keysDe({ x: 0, y: 0 }, anim.trilhas['@' + papel])) {
        L.push('                <key id="' + kk.k + '" time="' + kk.t + '" spin="' + kk.spin + '">');
        L.push(
          '                    <object folder="0" file="' + i + '" x="' + kk.x.toFixed(2) +
            '" y="' + kk.y.toFixed(2) + '" angle="' + kk.angle + '" scale_x="' + kk.sx +
            '" scale_y="' + kk.sy + '"/>'
        );
        L.push('                </key>');
      }
      L.push('            </timeline>');
    });

    L.push('        </animation>');
  });

  L.push('    </entity>');
  L.push('</spriter_data>');

  const destino = path.join(pasta, 'Animations.scml');
  fs.writeFileSync(destino, L.join('\n') + '\n', 'utf8');

  console.log('\nTela ' + W + 'x' + H + ', 6 pecas em registro.\n');
  console.log('peca'.padEnd(14) + 'arquivo'.padEnd(18) + 'junta (tela)'.padEnd(16) + 'pivo (fracao)');
  console.log('-'.repeat(70));
  for (const papel of ORDEM) {
    const j = juntas[papel];
    console.log(
      ROTULO[papel].padEnd(14) +
        pecas[papel].arquivo.padEnd(18) +
        (j.x + ',' + j.y).padEnd(16) +
        (j.x / W).toFixed(3) + ', ' + ((H - j.y) / H).toFixed(3)
    );
  }
  console.log('\nEscrito: ' + destino);
  console.log('Animacoes: ' + ANIMS.map((a) => a.nome).join(', '));

  // ALIASING: o baker distribui os quadros por UM comprimento de clip. Se o
  // numero de quadros for multiplo do numero de ciclos, toda amostra cai na
  // MESMA fase e o personagem sai CONGELADO -- medido com 2 respiros em 4
  // quadros: a cabeca ficou em 467 nos quatro. Nao e sutil, e imovel.
  const minIdle = 4 * RESPIROS;
  const minWalk = 4 * PASSADAS;
  console.log(
    '\nQuadros no app: pelo menos ' + minIdle + ' no idle (' + RESPIROS + ' respiro(s)) e ' +
      minWalk + ' no walk (' + PASSADAS + ' passada(s)).'
  );
  if (RESPIROS > 1 || PASSADAS > 1) {
    console.log(
      'Com menos que isso a amostragem cai sempre na mesma fase do ciclo e a\n' +
        'animacao sai PARADA -- nao e um bug do app, e o numero de quadros.'
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
