// Teste de bake completo fora do Electron (usa node-canvas + sharp so para
// validacao em Node; no app de verdade, o proprio Chromium do renderer
// exporta webp nativamente via canvas.toBlob).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const { DOMParser } = require('@xmldom/xmldom');
global.DOMParser = DOMParser;

const { detectCraftpixClassic, DEFAULT_ANIMATION_MAP } = require('../src/craftpix-profile');
const { parseSCML } = require('../src/scml-parser');
const { getZIndexByPartName } = require('../src/scml-zorder');
const { extractUnityPackage } = require('../src/unity-package');
const { buildRig } = require('../src/unity-prefab');
const { bakeGrid } = require('../src/baker');
const { computePose } = require('../src/unity-skeleton');
const { validateGrid, validateCharacterFolderName } = require('../src/validate');

const charDir = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, '..', 'scratch-bake-out');
const size = process.argv[4] || '2x2';

(async () => {
  const detected = detectCraftpixClassic(charDir);
  if (!detected) throw new Error('Pasta nao reconhecida como craftpix-classic: ' + charDir);

  const characterName = path.basename(charDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const nameErrors = validateCharacterFolderName(characterName);
  if (nameErrors.length) console.warn('Aviso nome:', nameErrors);

  const parsedScml = parseSCML(fs.readFileSync(detected.scmlPath, 'utf8'));
  const zIndexByName = getZIndexByPartName(parsedScml);
  const pivots = new Map();
  for (const files of Object.values(parsedScml.folders)) {
    for (const file of Object.values(files)) pivots.set(file.name, { pivotX: file.pivotX, pivotY: file.pivotY, width: file.width, height: file.height });
  }
  const images = new Map();
  for (const name of pivots.keys()) {
    const p = path.join(detected.vectorPartsDir, name);
    if (fs.existsSync(p)) images.set(name, await loadImage(p));
  }

  const pkg = await extractUnityPackage(detected.unitypackagePath);
  const prefabGuid = pkg.findGuidByPathnameSuffix('.prefab');
  const rig = buildRig(pkg.readAsset(prefabGuid), pkg.guidToPathname);

  const idleClip = rig.clips.find((c) => c.name === DEFAULT_ANIMATION_MAP.idle);
  const walkClip = rig.clips.find((c) => c.name === DEFAULT_ANIMATION_MAP.walk);
  console.log('personagem:', characterName, '| idle frames disponiveis:', idleClip ? 'ok' : 'FALTA', '| walk:', walkClip ? 'ok' : 'FALTA');

  fs.mkdirSync(path.join(outDir, characterName), { recursive: true });

  for (const [kind, clip, frameCount] of [['idle', idleClip, 4], ['walk', walkClip, 4]]) {
    if (!clip) continue;
    const rows = [
      { row: 'north', clip, hasArt: false },
      { row: 'east', clip, hasArt: true },
    ];
    const { canvas, warnings } = bakeGrid({ computePoseFn: (clip, t) => computePose(rig, clip, t, zIndexByName), images, pivots, rows, frameCount, size, createCanvas });
    const errors = validateGrid({ kind, size, frameCount, rowCount: rows.length, canvasWidth: canvas.width, canvasHeight: canvas.height });
    warnings.forEach((w) => console.log('[' + kind + '] AVISO:', w));
    errors.forEach((e) => console.log('[' + kind + '] ERRO:', e));
    const pngBuf = canvas.toBuffer('image/png');
    const outPath = path.join(outDir, characterName, `${kind}.webp`);
    await sharp(pngBuf).webp({ quality: 92, lossless: false }).toFile(outPath);
    console.log('escrito:', outPath, canvas.width + 'x' + canvas.height);
  }
})().catch((e) => { console.error(e); process.exit(1); });
