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
function localTransformAt(bone, sampledByPath, pixelsPerUnit) {
  const sampled = sampledByPath.get(bone.path);
  const pos = (sampled && sampled.position) || bone.localPos;
  const rot = (sampled && sampled.rotation) || bone.localRot;
  return {
    x: pos.x * pixelsPerUnit,
    y: pos.y * pixelsPerUnit,
    angle: quatToAngleDeg(rot),
    scaleX: bone.localScale.x,
    scaleY: bone.localScale.y,
  };
}

// pose(t) -> array de { zIndex, boneName, world, sprite } ordenado por zIndex
// zIndexByName (opcional): Map<nomeDaParte, z_index> vindo do .scml, usado
// como override porque o m_SortingOrder do Unity vem zerado pra tudo nesses
// pacotes (ver scml-zorder.js).
function computePose(rig, clip, t, zIndexByName) {
  const sampledByPath = clip ? sampleClip(clip, t) : new Map();
  const worldByTransformId = new Map();

  function visit(boneId, parentWorld) {
    const bone = rig.bones.get(boneId);
    const local = localTransformAt(bone, sampledByPath, rig.pixelsPerUnit);
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
// (do scml-parser, que tem exatamente esses valores por arquivo).
function drawPose(ctx, pose, images, pivots, origin, scale = 1) {
  for (const item of pose) {
    if (item.sprite.alpha <= 0) continue;
    const img = images.get(item.sprite.pngName);
    const pivot = pivots.get(item.sprite.pngName);
    if (!img || !pivot) continue;

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
    ctx.restore();
  }
}

// Aplica correcoes manuais por osso (offsets do usuario, ajustados por
// arrastar no preview) SEM tocar nos dados extraidos do Unity -- e so uma
// camada por cima, opcional, guardada a parte no rig-profile. Chame depois
// de computePose(), antes de drawPose().
// overrides: Map<boneName, {dx,dy,dangle}>
function applyManualOverrides(pose, overrides) {
  if (!overrides || overrides.size === 0) return pose;
  return pose.map((item) => {
    const o = overrides.get(item.boneName);
    if (!o) return item;
    return {
      ...item,
      world: {
        ...item.world,
        x: item.world.x + (o.dx || 0),
        y: item.world.y + (o.dy || 0),
        angle: item.world.angle + (o.dangle || 0),
      },
    };
  });
}

module.exports = { computePose, drawPose, CONVENTION, quatToAngleDeg, applyManualOverrides };
