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

// Caixa envolvente (AABB) de todas as pecas com sprite, relativa ao proprio
// osso-raiz (SEM somar a origem da celula), amostrando o clip em varios
// pontos no tempo -- um unico frame nao basta pra saber o alcance maximo,
// ja que bracos/cabeca se movem. Usado pra descobrir se o personagem cabe
// numa celula de saida sem cortar (ver fitScaleForBounds em vtt-standards.js).
function computeAnimatedBounds(rig, clip, pivots, partOffsets, samples = 12) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = clip ? (i / samples) * clip.length : 0;
    const rawPose = computePose(rig, clip, t, null, partOffsets);
    const pose = applyManualOverrides(rawPose, partOffsets);
    for (const item of pose) {
      if (item.sprite.alpha <= 0) continue;
      const filePivot = pivots.get(item.sprite.pngName);
      if (!filePivot) continue;
      const pivot = item.pivotOverride ? { ...filePivot, ...item.pivotOverride } : filePivot;
      const w = pivot.width;
      const h = pivot.height;
      const px = item.world.x;
      const py = CONVENTION.flipY ? -item.world.y : item.world.y;
      const angleDeg = CONVENTION.invertAngle ? -item.world.angle : item.world.angle;
      const angleRad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const sx = item.world.scaleX * (item.sprite.flipX ? -1 : 1);
      const sy = item.world.scaleY * (item.sprite.flipY ? -1 : 1);
      const offsetX = -pivot.pivotX * w;
      const offsetY = -(1 - pivot.pivotY) * h; // ver spriteDrawOffset em drawPose
      const corners = [
        [offsetX, offsetY],
        [offsetX + w, offsetY],
        [offsetX, offsetY + h],
        [offsetX + w, offsetY + h],
      ];
      for (const [lx, ly] of corners) {
        const sxp = lx * sx;
        const syp = ly * sy;
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
//
// PIVO (spriteDrawOffset) -- ponto que ja custou caro, nao "simplifique":
// no Spriter o pivot_x/pivot_y e normalizado a partir do canto INFERIOR-
// esquerdo, com Y para CIMA. Todos os PNGs desses pacotes vem com
// pivot_y="1", ou seja, o pivo esta no TOPO da imagem. O drawImage do canvas
// trabalha com o canto SUPERIOR-esquerdo e Y para baixo, entao o pivo em
// coordenadas de imagem e (pivotX*w, (1-pivotY)*h) e o offset de desenho e o
// negativo disso: -(1 - pivotY) * h.
// Usar -pivotY*h (o que o codigo fazia antes) sobe cada peca pela PROPRIA
// altura dela -- a Head (480px) subia 480 e a Face 01 (240px) subia 240,
// gerando 240px de deriva entre duas pecas que sao filhas do mesmo osso.
// Era a causa dos "gaps" que levaram ao PIXELS_PER_UNIT=50 e da impressao de
// que cabeca e face precisavam ser linkadas na mao (nao precisam: as duas ja
// sao filhas de bone_007 tanto no .scml quanto no prefab).
//
// scale escala a pose INTEIRA (posicao e tamanho do sprite juntos). Escalar
// so a posicao desmonta o personagem: as juntas se aproximam e os sprites
// continuam do tamanho original.
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
      item.world.scaleX * scale * (item.sprite.flipX ? -1 : 1),
      item.world.scaleY * scale * (item.sprite.flipY ? -1 : 1)
    );
    const offsetX = -pivot.pivotX * w;
    const offsetY = -(1 - pivot.pivotY) * h;
    ctx.drawImage(img, offsetX, offsetY, w, h);
    if (item.boneName === selectedBoneName) {
      // Contorno desenhado dentro do mesmo transform da imagem (mesma
      // translacao/rotacao/escala/flip), entao fica pixel-perfect alinhado
      // com a peca de verdade, em vez de replicar a matematica em outro lugar.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ff3b30';
      // dividido pela escala pra manter 3px na TELA, ja que o ctx acima esta
      // escalado junto com o sprite.
      ctx.lineWidth = 3 / (scale * Math.abs(item.world.scaleX) || 1);
      ctx.strokeRect(offsetX, offsetY, w, h);
    }
    ctx.restore();
  }
}

// Soma o dx/dy/dangle de um osso com o do osso que ele segue (followBone),
// recursivamente (ex: se A segue B e B segue C, A recebe a soma dos tres).
// O "seen" evita loop infinito se alguem criar um ciclo por engano.
function resolveFollowedDelta(boneName, overrides, seen) {
  if (seen.has(boneName)) return { dx: 0, dy: 0, dangle: 0 };
  seen.add(boneName);
  const o = overrides.get(boneName);
  if (!o) return { dx: 0, dy: 0, dangle: 0 };
  let dx = o.dx || 0;
  let dy = o.dy || 0;
  let dangle = o.dangle || 0;
  if (o.followBone) {
    const parent = resolveFollowedDelta(o.followBone, overrides, seen);
    dx += parent.dx;
    dy += parent.dy;
    dangle += parent.dangle;
  }
  return { dx, dy, dangle };
}

// Aplica correcoes manuais por osso (offset de posicao/angulo, pivo e
// camada) SEM tocar nos dados extraidos do Unity -- e so uma camada por
// cima, opcional, guardada a parte no rig-profile. Chame depois de
// computePose(), antes de drawPose().
// overrides: Map<boneName, {dx,dy,dangle,pivotX,pivotY,zIndex,followBone}>
// (todos opcionais). followBone (nome de outro osso) faz esse osso herdar
// TAMBEM o dx/dy/dangle daquele -- util pra pecas presas rigidamente a outra
// (ex: Face 01 deve sempre acompanhar qualquer ajuste feito na Head).
function applyManualOverrides(pose, overrides) {
  if (!overrides || overrides.size === 0) return pose;
  const withOverrides = pose.map((item) => {
    const o = overrides.get(item.boneName);
    if (!o) return item;
    const { dx, dy, dangle } = resolveFollowedDelta(item.boneName, overrides, new Set());
    const next = {
      ...item,
      world: {
        ...item.world,
        x: item.world.x + dx,
        y: item.world.y + dy,
        angle: item.world.angle + dangle,
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

module.exports = {
  computePose,
  drawPose,
  CONVENTION,
  quatToAngleDeg,
  applyManualOverrides,
  findAnimatedAncestorName,
  computeAnimatedBounds,
};
