// Script de validacao visual (nao faz parte do app): renderiza uma pose do
// rig extraido do .unitypackage usando node-canvas, so pra conferir a olho
// se orientacao/proporcao/camadas batem com o personagem real antes de
// integrar tudo na UI do Electron.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, Image } = require('canvas');
const { DOMParser } = require('@xmldom/xmldom');
global.DOMParser = DOMParser;

const { extractUnityPackage } = require('../src/unity-package');
const { buildRig } = require('../src/unity-prefab');
const { computePose, drawPose } = require('../src/unity-skeleton');
const { parseSCML } = require('../src/scml-parser');
const { getZIndexByPartName } = require('../src/scml-zorder');

const charDir = process.argv[2] || 'E:/_RPG/A Masmorra/A Masmorra Conceito/Personagens Chibi/Anjos/Fallen_Angels_1';
const clipName = process.argv[3] || 'Idle';
const tArg = process.argv[4] !== undefined ? parseFloat(process.argv[4]) : 0;
const outPng = process.argv[5] || path.join(__dirname, '..', 'scratch-preview.png');

(async () => {
  const vectorPartsDir = path.join(charDir, 'PNG', 'Vector Parts');
  const scmlPath = fs.readdirSync(vectorPartsDir).find((f) => f.toLowerCase().endsWith('.scml'));
  const scmlText = fs.readFileSync(path.join(vectorPartsDir, scmlPath), 'utf8');
  const parsedScml = parseSCML(scmlText);
  const zIndexByName = getZIndexByPartName(parsedScml);

  const pivots = new Map();
  for (const files of Object.values(parsedScml.folders)) {
    for (const file of Object.values(files)) {
      pivots.set(file.name, { pivotX: file.pivotX, pivotY: file.pivotY, width: file.width, height: file.height });
    }
  }

  const images = new Map();
  for (const name of pivots.keys()) {
    const p = path.join(vectorPartsDir, name);
    if (fs.existsSync(p)) images.set(name, await loadImage(p));
  }

  const unityDir = path.join(charDir, 'Unity Package');
  const pkgFile = fs.readdirSync(unityDir).find((f) => f.endsWith('.unitypackage'));
  const pkg = await extractUnityPackage(path.join(unityDir, pkgFile));
  const prefabGuid = pkg.findGuidByPathnameSuffix('.prefab');
  const rig = buildRig(pkg.readAsset(prefabGuid), pkg.guidToPathname);

  const clip = rig.clips.find((c) => c.name === clipName);
  if (!clip) throw new Error(`Clip "${clipName}" nao encontrado. Disponiveis: ${rig.clips.map((c) => c.name).join(', ')}`);

  const W = 900, H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(0, 0, W, H);
  // grade de referencia
  ctx.strokeStyle = '#444';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H * 0.8); ctx.lineTo(W, H * 0.8);
  ctx.stroke();

  const pose = computePose(rig, clip, tArg, zIndexByName);
  drawPose(ctx, pose, images, pivots, { x: W / 2, y: H * 0.8 }, 1);

  fs.writeFileSync(outPng, canvas.toBuffer('image/png'));
  console.log('Escrito em', outPng, '| clip:', clipName, 't=', tArg, '| partes desenhadas:', pose.filter(p=>p.sprite.alpha>0).length);
})().catch((e) => { console.error(e); process.exit(1); });
