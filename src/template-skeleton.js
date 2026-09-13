// Constroi a pose (transform mundial de cada osso do rig semantico) a
// partir de uma animation-template (motion-templates.js) e desenha as
// pecas SVG de um character-binding especifico nessa pose. Espelha a forma
// de unity-skeleton.js de proposito (computePose/drawPose com a mesma
// assinatura geral) para que o mesmo baker.js sirva os dois modos.
const { identityTransform, combine } = require('./pose-math');

// pose(t) -> array de { zIndex, boneName, world, part } ordenado por zIndex.
// part vem do binding (character-binding.js): { file, pivotX, pivotY,
// offsetX, offsetY, scale, rotationOffset, zIndex }.
function computePose(archetype, template, t, binding) {
  const byName = new Map(archetype.bones.map((b) => [b.name, b]));
  const worldByName = new Map();

  function visit(boneName, parentWorld) {
    const bone = byName.get(boneName);
    const delta = template ? template.sample(boneName, t) : { dx: 0, dy: 0, dangle: 0 };
    const local = {
      x: bone.bind.x + delta.dx,
      y: bone.bind.y + delta.dy,
      angle: bone.bind.angle + delta.dangle,
      scaleX: 1,
      scaleY: 1,
    };
    const world = combine(parentWorld, local);
    worldByName.set(boneName, world);
    for (const child of archetype.bones) {
      if (child.parent === boneName) visit(child.name, world);
    }
  }
  const root = archetype.bones.find((b) => !b.parent);
  visit(root.name, identityTransform());

  const items = [];
  for (const bone of archetype.bones) {
    const part = binding.parts[bone.name];
    if (!part || !part.file) continue;
    const zIndex = part.zIndex !== undefined && part.zIndex !== null ? part.zIndex : archetype.defaultZIndex[bone.name] ?? 0;
    items.push({ zIndex, boneName: bone.name, world: worldByName.get(bone.name), part });
  }
  items.sort((a, b) => a.zIndex - b.zIndex);
  return items;
}

// images: Map<fileName, HTMLImageElement>. svgSizes: Map<fileName, {width,height}>.
function drawPose(ctx, pose, images, svgSizes, origin, scale = 1, selectedBoneName = null) {
  for (const item of pose) {
    const img = images.get(item.part.file);
    const size = svgSizes.get(item.part.file);
    if (!img || !size) continue;

    const w = size.width * item.part.scale;
    const h = size.height * item.part.scale;
    const px = (item.world.x + item.part.offsetX) * scale + origin.x;
    const rawY = (item.world.y + item.part.offsetY) * scale;
    const py = -rawY + origin.y; // Y do mundo pra cima -> canvas pra baixo
    const angleDeg = -(item.world.angle + item.part.rotationOffset);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((angleDeg * Math.PI) / 180);
    const offsetX = -item.part.pivotX * w;
    const offsetY = -item.part.pivotY * h;
    ctx.drawImage(img, offsetX, offsetY, w, h);
    if (item.boneName === selectedBoneName) {
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 3;
      ctx.strokeRect(offsetX, offsetY, w, h);
    }
    ctx.restore();
  }
}

module.exports = { computePose, drawPose };
