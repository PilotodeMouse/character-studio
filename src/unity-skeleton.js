// Constroi a pose (transform mundial de cada osso + sprites anexados) de um
// rig Unity num tempo t de um clip, e desenha essa pose num canvas 2D.
//
// Convencao de coordenadas: Unity 2D aqui usa Y para cima (como o Spriter) e
// quaternion puro em Z para rotacao 2D. Canvas usa Y para baixo e rotate()
// horario. As duas flags abaixo concentram essa conversao; se o personagem
// sair de cabeca pra baixo ou espelhado ao testar com arte real, e so
// inverter aqui -- e o unico ponto sensivel a convencao do projeto inteiro.
const { sampleClip } = require('./unity-clip-sampler');
const { identityTransform, combine } = require('./pose-math');

const CONVENTION = { flipY: true, invertAngle: true };

function quatToAngleDeg(q) {
  // quaternion puro em Z (x=0,y=0): angulo = 2*atan2(z,w), em radianos.
  return (2 * Math.atan2(q.z, q.w) * 180) / Math.PI;
}

// Retorna o transform local (em pixels/graus) de um osso no tempo t: usa a
// curva do clip quando existe, cai pra pose de bind (a Transform local do
// proprio prefab) quando o osso nao e animado neste clip especifico.
//
// partOffsets (opcional): o mesmo Map<boneName,{...}> dos ajustes manuais
// (ver applyManualOverrides). Alem dos campos estaticos que ele ja carrega,
// dampX/dampY/dampAngle (0-1) amortecem o deslocamento/rotacao ANIMADOS
// desse osso -- puxam de volta em direcao a pose de bind naquele componente.
// Precisa acontecer aqui, no espaco local de cada osso, porque o balanco de
// um pai se propaga pros filhos pela composicao da hierarquia; aplicar isso
// so depois, no mundo (como applyManualOverrides faz), nao teria como isolar
// "o quanto desse osso especifico e animacao" de "o quanto veio herdado do pai".
//
// Importante: nesses rigs Craftpix, a maioria das PECAS com sprite (Head,
// Body, bracos...) nao tem curva propria -- sao so um sprite preso na ponta
// de um osso-junta sem arte que gira/desliza mais acima na hierarquia (ver
// findAnimatedAncestorName). O amortecimento precisa ser configurado no
// nome do osso que REALMENTE anima, nao no nome da peca visivel.
function localTransformAt(bone, sampledByPath, pixelsPerUnit, partOffsets) {
  const sampled = sampledByPath.get(bone.path);
  const sampledPos = sampled && sampled.position;
  const sampledRot = sampled && sampled.rotation;
  const bindX = bone.localPos.x * pixelsPerUnit;
  const bindY = bone.localPos.y * pixelsPerUnit;
  const bindAngle = quatToAngleDeg(bone.localRot);
  let x = sampledPos ? sampledPos.x * pixelsPerUnit : bindX;
  let y = sampledPos ? sampledPos.y * pixelsPerUnit : bindY;
  let angle = sampledRot ? quatToAngleDeg(sampledRot) : bindAngle;
  const damp = partOffsets && partOffsets.get(bone.name);
  if (damp && damp.dampX) x = bindX + (x - bindX) * (1 - damp.dampX);
  if (damp && damp.dampY) y = bindY + (y - bindY) * (1 - damp.dampY);
  if (damp && damp.dampAngle) angle = bindAngle + (angle - bindAngle) * (1 - damp.dampAngle);
  return {
    x,
    y,
    angle,
    scaleX: bone.localScale.x,
    scaleY: bone.localScale.y,
  };
}

// Acha o ancestral mais proximo (incluindo o proprio osso) que de fato tem
// curva de posicao ou rotacao neste clip especifico. Usado pra saber, quando
// o usuario seleciona uma PECA (ex: "Head") pra amortecer o balanco, em qual
// osso de verdade gravar o ajuste -- porque a peca em si costuma so herdar
// posicao/rotacao de uma junta sem arte mais acima (comum nesses rigs
// Craftpix: braco/cabeca sao um sprite preso na ponta de um osso que gira).
function findAnimatedAncestorName(rig, clip, boneName) {
  if (!clip) return boneName;
  const isAnimated = (path) =>
    clip.positionCurves.some((c) => c.path === path) || clip.rotationCurves.some((c) => c.path === path);
  let bone = [...rig.bones.values()].find((b) => b.name === boneName);
  while (bone) {
    if (isAnimated(bone.path)) return bone.name;
    bone = bone.parentTransformId ? rig.bones.get(bone.parentTransformId) : null;
  }
  return boneName;
}

// pose(t) -> array de { zIndex, boneName, world, sprite } ordenado por zIndex
// zIndexByName (opcional): Map<nomeDaParte, z_index> vindo do .scml, usado
// como override porque o m_SortingOrder do Unity vem zerado pra tudo nesses
// pacotes (ver scml-zorder.js).
// partOffsets (opcional): ver comentario de localTransformAt acima.
function computePose(rig, clip, t, zIndexByName, partOffsets) {
  const sampledByPath = clip ? sampleClip(clip, t) : new Map();
  const worldByTransformId = new Map();

  function visit(boneId, parentWorld) {
    const bone = rig.bones.get(boneId);
    const local = localTransformAt(bone, sampledByPath, rig.pixelsPerUnit, partOffsets);
    const world = combine(parentWorld, local);
    worldByTransformId.set(boneId, world);
    for (const childId of bone.children) visit(childId, world);
  }
  if (rig.root) visit(rig.root.transformId, identityTransform());

  const items = [];
  for (const bone of rig.bones.values()) {
    if (!bone.sprite || !bone.sprite.pngName) continue;
    const zFromScml = zIndexByName && zIndexByName.get(bone.name);
    items.push({
      zIndex: zFromScml !== undefined ? zFromScml : bone.sprite.sortingOrder,
      boneName: bone.name,
      world: worldByTransformId.get(bone.transformId),
      sprite: bone.sprite,
    });
  }
  items.sort((a, b) => a.zIndex - b.zIndex);
  return items;
}

// images: Map<pngName, HTMLImageElement>. pivots: Map<pngName, {pivotX,pivotY,width,height}>
// (do scml-parser, que tem exatamente esses valores por arquivo). Quando o
// item tem um pivotOverride (de applyManualOverrides), ele substitui so o
// pivotX/pivotY do arquivo, mantendo width/height reais da imagem.
function drawPose(ctx, pose, images, pivots, origin, scale = 1, selectedBoneName = null) {
  for (const item of pose) {
    if (item.sprite.alpha <= 0) continue;
    const img = images.get(item.sprite.pngName);
    const filePivot = pivots.get(item.sprite.pngName);
    if (!img || !filePivot) continue;
    const pivot = item.pivotOverride ? { ...filePivot, ...item.pivotOverride } : filePivot;

    const w = pivot.width;
    const h = pivot.height;
    const px = item.world.x * scale + origin.x;
    const rawY = item.world.y * scale;
    const py = (CONVENTION.flipY ? -rawY : rawY) + origin.y;
    const angleDeg = CONVENTION.invertAngle ? -item.world.angle : item.world.angle;

    ctx.save();
    ctx.globalAlpha = item.sprite.alpha;
    ctx.translate(px, py);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.scale(
      item.world.scaleX * (item.sprite.flipX ? -1 : 1),
      item.world.scaleY * (item.sprite.flipY ? -1 : 1)
    );
    const offsetX = -pivot.pivotX * w;
    const offsetY = -pivot.pivotY * h;
    ctx.drawImage(img, offsetX, offsetY, w, h);
    if (item.boneName === selectedBoneName) {
      // Contorno desenhado dentro do mesmo transform da imagem (mesma
      // translacao/rotacao/escala/flip), entao fica pixel-perfect alinhado
      // com a peca de verdade, em vez de replicar a matematica em outro lugar.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 3;
      ctx.strokeRect(offsetX, offsetY, w, h);
    }
    ctx.restore();
  }
}

// Aplica correcoes manuais por osso (offset de posicao/angulo, pivo e
// camada) SEM tocar nos dados extraidos do Unity -- e so uma camada por
// cima, opcional, guardada a parte no rig-profile. Chame depois de
// computePose(), antes de drawPose().
// overrides: Map<boneName, {dx,dy,dangle,pivotX,pivotY,zIndex}> (todos opcionais)
function applyManualOverrides(pose, overrides) {
  if (!overrides || overrides.size === 0) return pose;
  const withOverrides = pose.map((item) => {
    const o = overrides.get(item.boneName);
    if (!o) return item;
    const next = {
      ...item,
      world: {
        ...item.world,
        x: item.world.x + (o.dx || 0),
        y: item.world.y + (o.dy || 0),
        angle: item.world.angle + (o.dangle || 0),
      },
    };
    if (o.pivotX !== undefined && o.pivotY !== undefined) {
      next.pivotOverride = { pivotX: o.pivotX, pivotY: o.pivotY };
    }
    if (o.zIndex !== undefined) next.zIndex = o.zIndex;
    return next;
  });
  withOverrides.sort((a, b) => a.zIndex - b.zIndex);
  return withOverrides;
}

module.exports = { computePose, drawPose, CONVENTION, quatToAngleDeg, applyManualOverrides, findAnimatedAncestorName };
