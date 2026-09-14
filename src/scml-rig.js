// Monta a pose de um personagem direto do .scml (formato nativo do Spriter),
// sem passar pelo .unitypackage.
//
// POR QUE ESTE MODULO EXISTE
// O caminho antigo (unity-package -> unity-yaml -> unity-prefab) depende do
// .prefab exportado pelo Spriter2UnityDX estar serializado em YAML TEXTO.
// Packs mais antigos da Craftpix (ex: Pumpkin Head Guy, Unity 2017.1.1f1) vem
// com o .prefab em serializacao BINARIA -- o parser devolve 0 ossos e 0 clips
// e o personagem simplesmente nao carrega. Ja o .scml e XML texto em todos os
// packs e carrega as animacoes completas (18 no Pumpkin, 17 no Bloody
// Alchemist), com timing, hierarquia e z_index de origem, sem as perdas do
// round-trip pro Unity (que zera m_SortingOrder e converte angulo pra
// quaternion, perdendo giros acima de 180 graus).
//
// Convencao: o .scml ja esta em PIXELS (x=223.805732 bate com Body.png de
// 320x320), entao NAO existe fator de conversao aqui -- nada de
// pixelsPerUnit. Angulos em graus, anti-horario positivo, Y para cima: e
// exatamente a convencao de pose-math.combine.
//
// A pose devolvida tem o MESMO formato que computePose de unity-skeleton.js,
// entao drawPose/applyManualOverrides/bakeGrid funcionam sem alteracao.
const { identityTransform, combine } = require('./pose-math');

// Interpola angulo respeitando o "spin" do Spriter: 1 = anti-horario,
// -1 = horario, 0 = nao interpola (trava no valor da key de origem).
// Sem isso um giro de 350 -> 10 graus volta o caminho longo, ao contrario
// do que o artista desenhou.
function lerpAngle(a, b, spin, f) {
  if (spin === 0) return a;
  let target = b;
  if (spin > 0) {
    while (target < a) target += 360;
  } else {
    while (target > a) target -= 360;
  }
  return a + (target - a) * f;
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

// Estado de uma timeline no tempo t. As keys de uma timeline sao
// independentes das mainline keys: a mainline so diz QUEM e pai de QUEM e a
// ordem de desenho; o valor em si vem da interpolacao dentro da timeline.
// Quando a animacao e looping, a ultima key interpola de volta pra primeira
// (deslocada de +length), senao ela simplesmente segura o valor final.
function sampleTimeline(timeline, t, animLength, looping) {
  const keys = timeline.keys;
  if (!keys.length) return null;
  if (keys.length === 1) return keys[0];

  let i = 0;
  for (let k = 0; k < keys.length; k++) {
    if (keys[k].time <= t) i = k;
  }
  const cur = keys[i];
  const isLast = i === keys.length - 1;
  let next;
  let nextTime;
  if (isLast) {
    if (!looping) return cur;
    next = keys[0];
    nextTime = animLength;
  } else {
    next = keys[i + 1];
    nextTime = next.time;
  }
  const span = nextTime - cur.time;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - cur.time) / span)) : 0;

  return {
    ...cur,
    x: lerp(cur.x, next.x, f),
    y: lerp(cur.y, next.y, f),
    angle: lerpAngle(cur.angle, next.angle, cur.spin, f),
    scaleX: lerp(cur.scaleX, next.scaleX, f),
    scaleY: lerp(cur.scaleY, next.scaleY, f),
    alpha: lerp(cur.alpha, next.alpha, f),
  };
}

// Escolhe a mainline key vigente em t (a ultima com time <= t). E ela que
// define o parentesco e o z_index naquele instante -- em algumas animacoes o
// artista troca a ordem das camadas no meio do movimento (ex: o braco passa
// pra frente do corpo), e isso so existe aqui, nao no .unitypackage.
function mainlineKeyAt(animation, t) {
  const keys = animation.mainlineKeys;
  let chosen = keys[0];
  for (const k of keys) {
    if (k.time <= t) chosen = k;
  }
  return chosen;
}

// pose(t) -> array de { zIndex, boneName, world, sprite, pivotOverride? }
// ordenado por zIndex, no mesmo formato que unity-skeleton.computePose.
// t em SEGUNDOS (o .scml guarda em ms; convertemos aqui pra manter a mesma
// unidade do resto do app, que veio do AnimationClip do Unity).
function computeScmlPose(animation, tSeconds) {
  const lengthMs = animation.length;
  let t = tSeconds * 1000;
  if (animation.looping && lengthMs > 0) {
    t = ((t % lengthMs) + lengthMs) % lengthMs;
  } else {
    t = Math.min(Math.max(0, t), lengthMs);
  }

  const mainKey = mainlineKeyAt(animation, t);

  // Ossos primeiro: precisam estar resolvidos antes dos sprites que penduram
  // neles. boneRefs vem em ordem topologica (pai antes do filho) no .scml,
  // mas nao confiamos nisso -- resolvemos sob demanda, com memo.
  const boneWorldById = new Map();
  const boneRefById = new Map();
  for (const br of mainKey.boneRefs) boneRefById.set(br.id, br);

  function worldOfBone(id, guard) {
    if (id === -1 || id === undefined || id === null) return identityTransform();
    if (boneWorldById.has(id)) return boneWorldById.get(id);
    if (guard.has(id)) return identityTransform(); // ciclo: nao deve acontecer
    guard.add(id);

    const ref = boneRefById.get(id);
    if (!ref) return identityTransform();
    const tl = animation.timelines[ref.timeline];
    const k = tl ? sampleTimeline(tl, t, lengthMs, animation.looping) : null;
    const local = k
      ? { x: k.x, y: k.y, angle: k.angle, scaleX: k.scaleX, scaleY: k.scaleY }
      : identityTransform();
    const world = combine(worldOfBone(ref.parent, guard), local);
    boneWorldById.set(id, world);
    return world;
  }

  const items = [];
  for (const or of mainKey.objectRefs) {
    const tl = animation.timelines[or.timeline];
    if (!tl) continue;
    const k = sampleTimeline(tl, t, lengthMs, animation.looping);
    if (!k || !k.imageName) continue;

    const parentWorld = worldOfBone(or.parent, new Set());
    const world = combine(parentWorld, {
      x: k.x,
      y: k.y,
      angle: k.angle,
      scaleX: k.scaleX,
      scaleY: k.scaleY,
    });

    items.push({
      zIndex: or.zIndex,
      boneName: tl.name, // no .scml a timeline do sprite ja tem o nome da peca
      world,
      sprite: {
        pngName: k.imageName,
        sortingOrder: or.zIndex,
        alpha: k.alpha,
        flipX: false, // espelhamento no Spriter vem por scale negativo, nao por flag
        flipY: false,
      },
      // O Spriter permite pivo por key, sobrepondo o do arquivo. drawPose ja
      // entende pivotOverride.
      pivotOverride: { pivotX: k.pivotX, pivotY: k.pivotY },
    });
  }

  items.sort((a, b) => a.zIndex - b.zIndex);
  return items;
}

// Mapa nomeDoPNG -> { pivotX, pivotY, width, height }, no formato que
// drawPose espera. Vem das <folder>/<file> do proprio .scml, que ja declaram
// dimensao e pivo de cada peca (conferido: batem 1:1 com os PNGs reais).
function pivotsFromScml(scml) {
  const pivots = new Map();
  for (const files of Object.values(scml.folders)) {
    for (const f of Object.values(files)) {
      pivots.set(f.name, {
        pivotX: f.pivotX,
        pivotY: f.pivotY,
        width: f.width,
        height: f.height,
      });
    }
  }
  return pivots;
}

// Lista de "clips" no mesmo formato que o app ja usa pro rig do Unity
// (nome + duracao em SEGUNDOS), pra alimentar os mesmos <select> de Idle/Walk
// sem mudar a UI.
function clipsFromScml(entity) {
  return entity.animations.map((a) => ({
    name: a.name,
    length: a.length / 1000,
    animation: a, // referencia usada por computeScmlPose
    source: 'scml',
  }));
}

// Caixa envolvente da animacao inteira, equivalente a computeAnimatedBounds
// de unity-skeleton.js (mesma finalidade: alimentar fitScaleForBounds).
function computeScmlBounds(clip, pivots, samples = 12) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * clip.length;
    for (const item of computeScmlPose(clip.animation, t)) {
      if (item.sprite.alpha <= 0) continue;
      const filePivot = pivots.get(item.sprite.pngName);
      if (!filePivot) continue;
      const pv = item.pivotOverride ? { ...filePivot, ...item.pivotOverride } : filePivot;
      const w = pv.width;
      const h = pv.height;
      const px = item.world.x;
      const py = -item.world.y; // mesma convencao flipY do unity-skeleton
      const angleRad = (-item.world.angle * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const offsetX = -pv.pivotX * w;
      const offsetY = -(1 - pv.pivotY) * h;
      for (const [lx, ly] of [
        [offsetX, offsetY],
        [offsetX + w, offsetY],
        [offsetX, offsetY + h],
        [offsetX + w, offsetY + h],
      ]) {
        const sxp = lx * item.world.scaleX;
        const syp = ly * item.world.scaleY;
        const wx = px + (sxp * cos - syp * sin);
        const wy = py + (sxp * sin + syp * cos);
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

module.exports = { computeScmlPose, pivotsFromScml, clipsFromScml, computeScmlBounds };
