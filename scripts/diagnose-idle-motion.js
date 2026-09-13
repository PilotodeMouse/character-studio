// Diagnostico: amostra o clip Idle de verdade (extraido do .unitypackage) em
// N passos ao longo do loop e imprime, por osso, a amplitude de movimento em
// X e em Y (mundo, em pixels) -- pra saber se um "balanco horizontal" que
// parece estranho no preview vem de fato da animacao original da Craftpix
// (osso com curva de posicao em X) ou seria um artefato de decodificacao.
//
// Uso: node scripts/diagnose-idle-motion.js "<pasta do personagem>" [nomeDoClip]
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
global.DOMParser = DOMParser;

const { detectCraftpixClassic, DEFAULT_ANIMATION_MAP } = require('../src/craftpix-profile');
const { extractUnityPackage } = require('../src/unity-package');
const { buildRig } = require('../src/unity-prefab');
const { computePose } = require('../src/unity-skeleton');

const charDir = process.argv[2];
const clipName = process.argv[3] || DEFAULT_ANIMATION_MAP.idle;
const STEPS = 40;

if (!charDir) {
  console.error('Uso: node scripts/diagnose-idle-motion.js "<pasta do personagem>" [nomeDoClip]');
  process.exit(1);
}

(async () => {
  const detected = detectCraftpixClassic(charDir);
  if (!detected) throw new Error('Pasta nao reconhecida como craftpix-classic: ' + charDir);

  const pkg = await extractUnityPackage(detected.unitypackagePath);
  const prefabGuid = pkg.findGuidByPathnameSuffix('.prefab');
  const rig = buildRig(pkg.readAsset(prefabGuid), pkg.guidToPathname);

  const clip = rig.clips.find((c) => c.name === clipName);
  if (!clip) {
    console.error(`Clip "${clipName}" nao encontrado. Disponiveis:`, rig.clips.map((c) => c.name).join(', '));
    process.exit(1);
  }

  const ranges = new Map(); // boneName -> {minX,maxX,minY,maxY}
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * clip.length;
    const pose = computePose(rig, clip, t, null);
    for (const item of pose) {
      const r = ranges.get(item.boneName) || { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      r.minX = Math.min(r.minX, item.world.x);
      r.maxX = Math.max(r.maxX, item.world.x);
      r.minY = Math.min(r.minY, item.world.y);
      r.maxY = Math.max(r.maxY, item.world.y);
      ranges.set(item.boneName, r);
    }
  }

  console.log(`Clip "${clipName}" (${clip.length.toFixed(2)}s), ${ranges.size} ossos com sprite. Amplitude de movimento (mundo, px):\n`);
  console.log('osso'.padEnd(24), 'amplX'.padStart(8), 'amplY'.padStart(8), '  (amplX >> amplY sugere balanco horizontal real na arte)');
  for (const [boneName, r] of [...ranges.entries()].sort((a, b) => (b[1].maxX - b[1].minX) - (a[1].maxX - a[1].minX))) {
    const amplX = r.maxX - r.minX;
    const amplY = r.maxY - r.minY;
    console.log(boneName.padEnd(24), amplX.toFixed(2).padStart(8), amplY.toFixed(2).padStart(8));
  }
})().catch((e) => { console.error(e); process.exit(1); });
