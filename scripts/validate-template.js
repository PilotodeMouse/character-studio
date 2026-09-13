// Valida o pipeline do rig semantico (personagem SVG + template de
// animacao) de ponta a ponta, sem UI.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const { getArchetype } = require('../src/semantic-rig');
const { getTemplate } = require('../src/motion-templates');
const { emptyBinding, setPart } = require('../src/character-binding');
const { readSvgSize } = require('../src/svg-info');
const { computePose, drawPose } = require('../src/template-skeleton');

const charDir = process.argv[2] || path.join(__dirname, '..', 'test-fixtures', 'svg-hero');
const templateName = process.argv[3] || 'idle';
const t = process.argv[4] !== undefined ? parseFloat(process.argv[4]) : 0;
const outPng = process.argv[5] || 'scratch-template-preview.png';

(async () => {
  const archetype = getArchetype('humanoid-medium');
  const template = getTemplate(templateName);

  const binding = emptyBinding('svg-hero');
  const pivots = {
    head: { pivotX: 0.5, pivotY: 0 },
    torso: { pivotX: 0.5, pivotY: 0 },
    'arm-main': { pivotX: 0.5, pivotY: 0.05 },
    'arm-off': { pivotX: 0.5, pivotY: 0.05 },
    'leg-left': { pivotX: 0.5, pivotY: 0 },
    'leg-right': { pivotX: 0.5, pivotY: 0 },
  };
  for (const boneName of Object.keys(pivots)) {
    setPart(binding, boneName, { file: `${boneName}.svg`, ...pivots[boneName] });
  }

  const svgSizes = new Map();
  const images = new Map();
  for (const boneName of Object.keys(pivots)) {
    const file = `${boneName}.svg`;
    const p = path.join(charDir, file);
    svgSizes.set(file, readSvgSize(p));
    images.set(file, await loadImage(p));
  }

  const pose = computePose(archetype, template, t, binding);

  const W = 400, H = 500, ox = W / 2, oy = H * 0.9;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#20232a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(ox, 0); ctx.lineTo(ox, H);
  ctx.moveTo(0, oy); ctx.lineTo(W, oy);
  ctx.stroke();

  drawPose(ctx, pose, images, svgSizes, { x: ox, y: oy }, 1);
  fs.writeFileSync(outPng, canvas.toBuffer('image/png'));
  console.log('escrito:', outPng, '| template:', templateName, 't=', t, '/', template.length);
})().catch((e) => { console.error(e); process.exit(1); });
