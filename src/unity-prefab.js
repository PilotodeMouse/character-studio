// Monta o rig (hierarquia de ossos + sprites anexados + clips de animacao) a
// partir dos documentos YAML de um .prefab exportado pelo Spriter2UnityDX
// (GameObject + Transform + SpriteRenderer + AnimationClip).
const { parseUnityYaml } = require('./unity-yaml');

// Unity guarda posicao/escala em "unidades", nao pixels. O .meta de cada PNG
// diz spritePixelsToUnits=100, e multiplicar por 100 reconstroi exatamente
// as coordenadas cruas do .scml (x=223.805732 etc -- conferido byte a byte).
// MAS o .scml embutido nesses pacotes (so a pose "Base", usada para montar o
// rig) foi exportado numa escala 2x maior do que a usada pra gerar os PNGs
// oficiais da Craftpix: renderizando com fator 100 o personagem sai
// "esparramado" (gaps entre cabeca/corpo/pernas que nao existem na arte de
// referencia); com fator 50 a montagem bate com a arte oficial. Calibrado
// visualmente contra os PNG Sequences originais -- ver README.
const PIXELS_PER_UNIT = 50;

function buildRig(prefabAssetText, guidToPathname) {
  const docs = parseUnityYaml(prefabAssetText);

  const gameObjects = [...docs.entries()].filter(([, d]) => d.key === 'GameObject');
  const transforms = new Map([...docs.entries()].filter(([, d]) => d.key === 'Transform'));
  const spriteRenderers = new Map([...docs.entries()].filter(([, d]) => d.key === 'SpriteRenderer'));

  // fileId do componente Transform -> { fileId, name, ... }
  const bonesByTransformId = new Map();
  const transformIdByGameObjectId = new Map();

  for (const [goId, go] of gameObjects) {
    const transformRef = go.data.m_Component.find((c) => transforms.has(String(c.component.fileID)));
    if (!transformRef) continue;
    const transformId = String(transformRef.component.fileID);
    transformIdByGameObjectId.set(goId, transformId);

    const spriteRef = go.data.m_Component
      .map((c) => String(c.component.fileID))
      .find((id) => spriteRenderers.has(id));

    let sprite = null;
    if (spriteRef) {
      const sr = spriteRenderers.get(spriteRef).data;
      const guid = sr.m_Sprite && sr.m_Sprite.guid;
      const pathname = guid ? guidToPathname.get(guid) : null;
      sprite = {
        pngName: pathname ? pathname.split('/').pop() : null,
        sortingOrder: sr.m_SortingOrder || 0,
        alpha: sr.m_Color ? sr.m_Color.a : 1,
        flipX: !!sr.m_FlipX,
        flipY: !!sr.m_FlipY,
      };
    }

    bonesByTransformId.set(transformId, {
      transformId,
      gameObjectId: goId,
      name: go.data.m_Name,
      sprite,
      parentTransformId: null,
      localPos: { x: 0, y: 0, z: 0 },
      localRot: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
      children: [],
    });
  }

  for (const [transformId, t] of transforms) {
    const bone = bonesByTransformId.get(transformId);
    if (!bone) continue;
    bone.localPos = t.data.m_LocalPosition;
    bone.localRot = t.data.m_LocalRotation;
    bone.localScale = t.data.m_LocalScale;
    const fatherId = String(t.data.m_Father.fileID);
    bone.parentTransformId = fatherId !== '0' ? fatherId : null;
  }

  for (const bone of bonesByTransformId.values()) {
    if (bone.parentTransformId) {
      const parent = bonesByTransformId.get(bone.parentTransformId);
      if (parent) parent.children.push(bone.transformId);
    }
  }

  const root = [...bonesByTransformId.values()].find((b) => !b.parentTransformId);

  // Resolve um "path" de curva de animacao (ex: "bone_006/bone_007") para o
  // transformId do osso, andando por nome a partir da raiz.
  // Unity anima "relativo ao objeto que tem o componente Animation", que e a
  // propria raiz do prefab -- por isso a raiz recebe path="" e os filhos
  // diretos usam so o proprio nome (sem prefixar o nome da raiz), igual as
  // curvas do AnimationClip (ex: "bone_004", "bone_006/bone_007").
  const nameIndex = new Map();
  function indexNames(boneId, path) {
    const bone = bonesByTransformId.get(boneId);
    bone.path = path;
    nameIndex.set(path, boneId);
    for (const childId of bone.children) {
      const child = bonesByTransformId.get(childId);
      indexNames(childId, path ? `${path}/${child.name}` : child.name);
    }
  }
  if (root) indexNames(root.transformId, '');

  const clips = [...docs.values()]
    .filter((d) => d.key === 'AnimationClip')
    .map((d) => ({
      name: d.data.m_Name,
      length: computeClipLength(d.data),
      rotationCurves: (d.data.m_RotationCurves || []).map((c) => ({
        path: c.path,
        keys: c.curve.m_Curve.map((k) => ({ time: k.time, value: k.value, inSlope: k.inSlope, outSlope: k.outSlope })),
      })),
      positionCurves: (d.data.m_PositionCurves || []).map((c) => ({
        path: c.path,
        keys: c.curve.m_Curve.map((k) => ({ time: k.time, value: k.value, inSlope: k.inSlope, outSlope: k.outSlope })),
      })),
    }));

  return { bones: bonesByTransformId, root, nameIndex, clips, pixelsPerUnit: PIXELS_PER_UNIT };
}

function computeClipLength(clipData) {
  let maxTime = 0;
  for (const c of clipData.m_RotationCurves || []) {
    for (const k of c.curve.m_Curve) maxTime = Math.max(maxTime, k.time);
  }
  for (const c of clipData.m_PositionCurves || []) {
    for (const k of c.curve.m_Curve) maxTime = Math.max(maxTime, k.time);
  }
  return maxTime; // segundos (formato nativo do Unity AnimationClip)
}

module.exports = { buildRig, PIXELS_PER_UNIT };
