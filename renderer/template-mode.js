// IIFE por ser um <script> classico compartilhando escopo global com
// app.js/playback.js -- ver comentario identico no topo de app.js.
(function () {
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const { getArchetype } = require('../src/semantic-rig');
const { getTemplate } = require('../src/motion-templates');
const { loadBinding, saveBinding, emptyBinding, setPart } = require('../src/character-binding');
const { readSvgSize } = require('../src/svg-info');
const { computePose, drawPose } = require('../src/template-skeleton');
const { cellSpecFor, ANIMATIONS: VTT_ANIMATIONS, EXPORT } = require('../src/vtt-standards');
const { validateGrid, validateCharacterFolderName } = require('../src/validate');

const BONE_COLORS = {
  root: '#8a8f98',
  torso: '#5b8cff',
  head: '#e0b060',
  'arm-main': '#e07a5f',
  'arm-off': '#e07a5f',
  'leg-left': '#4caf7d',
  'leg-right': '#4caf7d',
};

const archetype = getArchetype('humanoid-medium');

const tplState = {
  loaded: false,
  charDir: null,
  svgFiles: [], // [{name}]
  sizes: new Map(), // fileName -> {width,height}
  images: new Map(), // fileName -> HTMLImageElement
  binding: null,
  selectedBone: null,
  outputFolder: null,
  drag: null, // {startX,startY,startOffsetX,startOffsetY}
};
window.tplState = tplState;

function tplLog(msg, cls) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.style.color = getComputedStyle(document.documentElement).getPropertyValue(`--${cls}`);
  document.getElementById('tpl-log').prepend(li);
}

function tplBanner(el, cls, msg) {
  el.innerHTML = `<div class="banner ${cls}">${msg}</div>`;
}

function loadSvgImage(filePath) {
  return new Promise((resolve, reject) => {
    const text = fs.readFileSync(filePath, 'utf8');
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
  });
}

async function onTplPickFolder() {
  const folder = await ipcRenderer.invoke('select-pack-folder');
  if (!folder) return;
  tplState.charDir = folder;

  const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.svg'));
  if (!files.length) {
    document.getElementById('tpl-pack-info').textContent = 'Nenhum .svg encontrado nessa pasta.';
    return;
  }
  tplState.svgFiles = files;
  tplState.sizes = new Map();
  tplState.images = new Map();
  for (const f of files) {
    const p = path.join(folder, f);
    tplState.sizes.set(f, readSvgSize(p));
    tplState.images.set(f, await loadSvgImage(p));
  }

  const existing = loadBinding(folder);
  const characterName = path.basename(folder);
  tplState.binding = existing || emptyBinding(characterName);
  const banner = document.getElementById('tpl-binding-banner');
  if (existing) {
    tplBanner(banner, 'ok', `binding.json encontrado e carregado para "${characterName}".`);
  } else {
    tplBanner(banner, 'warn', `Nenhum binding.json ainda -- atribua cada osso a um arquivo SVG abaixo e salve.`);
  }

  document.getElementById('tpl-pack-info').textContent = `${characterName} - ${files.length} SVGs`;
  document.getElementById('tpl-config-section').style.display = 'block';
  document.getElementById('tpl-preview-block').style.display = 'block';
  tplState.loaded = true;

  renderPartChips();
  renderBoneList();
  selectBone(archetype.bones.find((b) => b.parent === null && b.name !== 'root')?.name || archetype.bones[1].name);
  tplTick();
}

function renderPartChips() {
  const el = document.getElementById('tpl-part-list');
  const usedFiles = new Set(Object.values(tplState.binding.parts).filter(Boolean).map((p) => p.file));
  el.innerHTML = '';
  for (const f of tplState.svgFiles) {
    const chip = document.createElement('div');
    chip.className = 'part-chip' + (usedFiles.has(f) ? ' used' : '');
    chip.textContent = f;
    el.appendChild(chip);
  }
}

function renderBoneList() {
  const el = document.getElementById('tpl-bone-list');
  el.innerHTML = '';
  for (const bone of archetype.bones) {
    const row = document.createElement('div');
    row.className = 'bone-row' + (tplState.selectedBone === bone.name ? ' selected' : '');
    row.innerHTML = `<span class="dot" style="background:${BONE_COLORS[bone.name] || '#888'}"></span><span class="bone-name">${bone.name}</span><span class="part-name">${(tplState.binding.parts[bone.name] && tplState.binding.parts[bone.name].file) || '—'}</span>`;
    row.addEventListener('click', () => selectBone(bone.name));
    el.appendChild(row);
  }
}

function selectBone(boneName) {
  tplState.selectedBone = boneName;
  renderBoneList();
  document.getElementById('tpl-selected-bone-name').textContent = boneName;

  const fileSel = document.getElementById('tpl-sel-file');
  fileSel.innerHTML = '<option value="">(nenhum)</option>' + tplState.svgFiles.map((f) => `<option value="${f}">${f}</option>`).join('');
  const part = tplState.binding.parts[boneName];
  fileSel.value = part ? part.file : '';
  document.getElementById('tpl-pivot-x').value = part ? part.pivotX : 0.5;
  document.getElementById('tpl-pivot-y').value = part ? part.pivotY : 0.5;
  document.getElementById('tpl-offset-x').value = part ? part.offsetX : 0;
  document.getElementById('tpl-offset-y').value = part ? part.offsetY : 0;
  document.getElementById('tpl-part-scale').value = part ? part.scale : 1;
  document.getElementById('tpl-rotation').value = part ? part.rotationOffset : 0;
}

function applyFieldsToSelectedPart() {
  if (!tplState.selectedBone) return;
  const file = document.getElementById('tpl-sel-file').value;
  if (!file) {
    tplState.binding.parts[tplState.selectedBone] = null;
  } else {
    setPart(tplState.binding, tplState.selectedBone, {
      file,
      pivotX: parseFloat(document.getElementById('tpl-pivot-x').value) || 0,
      pivotY: parseFloat(document.getElementById('tpl-pivot-y').value) || 0,
      offsetX: parseFloat(document.getElementById('tpl-offset-x').value) || 0,
      offsetY: parseFloat(document.getElementById('tpl-offset-y').value) || 0,
      scale: parseFloat(document.getElementById('tpl-part-scale').value) || 1,
      rotationOffset: parseFloat(document.getElementById('tpl-rotation').value) || 0,
    });
  }
  renderBoneList();
  renderPartChips();
  tplTick();
}

function readTplConfig() {
  return {
    size: document.getElementById('tpl-sel-size').value,
    framesIdle: parseInt(document.getElementById('tpl-num-frames-idle').value, 10),
    framesWalk: parseInt(document.getElementById('tpl-num-frames-walk').value, 10),
    scale: parseFloat(document.getElementById('tpl-num-scale').value) || 1,
    offsetX: parseFloat(document.getElementById('tpl-num-offset-x').value) || 0,
    offsetY: parseFloat(document.getElementById('tpl-num-offset-y').value) || 0,
  };
}

function tplTick() {
  if (!tplState.loaded) return;
  const templateName = document.getElementById('tpl-sel-anim').value;
  const template = getTemplate(templateName);
  const slider = document.getElementById('tpl-preview-time');
  slider.max = template.length / 1000;
  const t = Math.min(parseFloat(slider.value) * 1000, template.length);
  document.getElementById('tpl-preview-time-label').textContent = `${(t / 1000).toFixed(2)}s / ${(template.length / 1000).toFixed(2)}s`;

  // Mesmas dimensoes e mesma linha do chao (groundLineY) do bake de verdade
  // (a rotina de onTplBake abaixo), pra o preview corresponder exatamente ao
  // .webp gerado -- antes usava canvas.height*0.85 como aproximacao.
  const cfg = readTplConfig();
  const cell = cellSpecFor(cfg.size);
  const canvas = document.getElementById('tpl-preview-canvas');
  if (canvas.width !== cell.w) canvas.width = cell.w;
  if (canvas.height !== cell.h) canvas.height = cell.h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const pose = computePose(archetype, template, t, tplState.binding);
  const origin = { x: cell.bodyAxisX + cfg.offsetX, y: cell.groundLineY + cfg.offsetY };
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(cfg.scale, cfg.scale);
  ctx.translate(-origin.x, -origin.y);
  drawPose(ctx, pose, tplState.images, tplState.sizes, origin, 1, tplState.selectedBone);
  ctx.restore();

  tplState.lastPose = pose;
  tplState.lastOrigin = origin;
  tplState.lastCfg = cfg;
}

// Acha em qual peca (osso) um ponto do canvas cai, testando de frente pra
// tras (o pose ja vem ordenado por zIndex, entao percorremos ao contrario).
// O ponto e transformado pro espaco local de cada peca (desfazendo
// translacao+rotacao) pra testar contra o retangulo que o drawImage usa.
function hitTestBone(xLocal, yLocal, pose, origin) {
  for (let i = pose.length - 1; i >= 0; i--) {
    const item = pose[i];
    const size = tplState.sizes.get(item.part.file);
    if (!size) continue;
    const w = size.width * item.part.scale;
    const h = size.height * item.part.scale;
    const px = item.world.x + item.part.offsetX + origin.x;
    const py = -(item.world.y + item.part.offsetY) + origin.y;
    const angleRad = (-(item.world.angle + item.part.rotationOffset) * Math.PI) / 180;
    const cos = Math.cos(-angleRad);
    const sin = Math.sin(-angleRad);
    const dx = xLocal - px;
    const dy = yLocal - py;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const offsetX = -item.part.pivotX * w;
    const offsetY = -item.part.pivotY * h;
    if (localX >= offsetX && localX <= offsetX + w && localY >= offsetY && localY <= offsetY + h) {
      return item.boneName;
    }
  }
  return null;
}

function canvasEventToLocal(e) {
  const canvas = document.getElementById('tpl-preview-canvas');
  const rect = canvas.getBoundingClientRect();
  const pxScale = canvas.width / rect.width;
  const mx = (e.clientX - rect.left) * pxScale;
  const my = (e.clientY - rect.top) * pxScale;
  const cfg = tplState.lastCfg || { scale: 1 };
  const origin = tplState.lastOrigin || { x: canvas.width / 2, y: canvas.height * 0.85 };
  return {
    x: origin.x + (mx - origin.x) / cfg.scale,
    y: origin.y + (my - origin.y) / cfg.scale,
  };
}

// Mesma regra do modo Craftpix: clique esquerdo arrasta o osso ja
// selecionado sem trocar, clique direito e que escolhe pelo que esta sob o
// cursor.
function onCanvasMouseDown(e) {
  if (!tplState.lastPose) return;
  const { x, y } = canvasEventToLocal(e);

  if (e.button === 2) {
    const hitBone = hitTestBone(x, y, tplState.lastPose, tplState.lastOrigin);
    if (hitBone) selectBone(hitBone);
    return;
  }
  if (e.button !== 0) return;

  if (!tplState.selectedBone) {
    const hitBone = hitTestBone(x, y, tplState.lastPose, tplState.lastOrigin);
    if (!hitBone) return;
    selectBone(hitBone);
  }

  const part = tplState.binding.parts[tplState.selectedBone];
  if (!part) return;
  tplState.drag = {
    startX: x,
    startY: y,
    startOffsetX: part.offsetX,
    startOffsetY: part.offsetY,
  };
  document.getElementById('tpl-preview-canvas').classList.add('dragging');
  tplTick();
}

function onCanvasMouseMove(e) {
  if (!tplState.drag) return;
  const { x, y } = canvasEventToLocal(e);
  const dx = x - tplState.drag.startX;
  const dy = y - tplState.drag.startY;

  const part = tplState.binding.parts[tplState.selectedBone];
  part.offsetX = tplState.drag.startOffsetX + dx;
  part.offsetY = tplState.drag.startOffsetY - dy; // canvas Y desce, mundo Y sobe
  document.getElementById('tpl-offset-x').value = part.offsetX.toFixed(1);
  document.getElementById('tpl-offset-y').value = part.offsetY.toFixed(1);
  tplTick();
}

function onCanvasMouseUp() {
  tplState.drag = null;
  document.getElementById('tpl-preview-canvas').classList.remove('dragging');
}

function onTplSaveBinding() {
  if (!tplState.charDir) return;
  saveBinding(tplState.charDir, tplState.binding);
  tplLog(`binding.json salvo em ${tplState.charDir}`, 'ok');
}

async function onTplBake() {
  const characterName = path.basename(tplState.charDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const errs = validateCharacterFolderName(characterName);
  if (errs.length) {
    errs.forEach((e) => tplLog(e, 'err'));
    return;
  }
  if (!tplState.outputFolder) {
    tplState.outputFolder = await ipcRenderer.invoke('select-output-folder');
    if (!tplState.outputFolder) return;
  }

  const cfg = readTplConfig();
  const container = document.getElementById('tpl-canvases');
  container.innerHTML = '';

  for (const kind of ['idle', 'walk']) {
    const template = getTemplate(kind);
    const frameCount = kind === 'idle' ? cfg.framesIdle : cfg.framesWalk;
    const cell = cellSpecFor(cfg.size);
    const rows = ['north', 'east'];
    const canvas = document.createElement('canvas');
    canvas.width = cell.w * frameCount;
    canvas.height = cell.h * rows.length;
    const ctx = canvas.getContext('2d');

    rows.forEach((_row, rowIndex) => {
      for (let f = 0; f < frameCount; f++) {
        const t = (f * template.length) / frameCount;
        const pose = computePose(archetype, template, t, tplState.binding);
        ctx.save();
        ctx.beginPath();
        const cellX = f * cell.w;
        const cellY = rowIndex * cell.h;
        ctx.rect(cellX, cellY, cell.w, cell.h);
        ctx.clip();
        const origin = {
          x: cellX + cell.bodyAxisX + cfg.offsetX,
          y: cellY + cell.groundLineY + cfg.offsetY,
        };
        ctx.translate(origin.x, origin.y);
        ctx.scale(cfg.scale, cfg.scale);
        ctx.translate(-origin.x, -origin.y);
        drawPose(ctx, pose, tplState.images, tplState.sizes, origin, 1);
        ctx.restore();
      }
    });

    if (rows[0] === 'north') {
      tplLog(`[${kind}] linha north: rig de template so tem uma vista, usando a mesma pose de east.`, 'warn');
    }

    const validationErrors = validateGrid({
      kind,
      size: cfg.size,
      frameCount,
      rowCount: rows.length,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });

    const block = document.createElement('div');
    block.className = 'canvas-block';
    const h3 = document.createElement('h3');
    h3.textContent = `${kind}.webp (${canvas.width}x${canvas.height})`;
    block.appendChild(h3);
    block.appendChild(canvas);
    container.appendChild(block);

    if (validationErrors.length) {
      validationErrors.forEach((e) => tplLog(`[${kind}] ${e}`, 'err'));
      continue;
    }

    const buffer = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('falha ao exportar'));
        blob.arrayBuffer().then((b) => resolve(Buffer.from(b)));
      }, 'image/webp', EXPORT.quality);
    });
    const dir = path.join(tplState.outputFolder, characterName);
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `${kind}.webp`);
    fs.writeFileSync(outPath, buffer);
    tplLog(`Salvo: ${outPath}`, 'ok');
  }
}

document.getElementById('tpl-btn-pick').addEventListener('click', onTplPickFolder);
document.getElementById('tpl-sel-file').addEventListener('change', applyFieldsToSelectedPart);
document.getElementById('tpl-pivot-x').addEventListener('input', applyFieldsToSelectedPart);
document.getElementById('tpl-pivot-y').addEventListener('input', applyFieldsToSelectedPart);
document.getElementById('tpl-offset-x').addEventListener('input', applyFieldsToSelectedPart);
document.getElementById('tpl-offset-y').addEventListener('input', applyFieldsToSelectedPart);
document.getElementById('tpl-part-scale').addEventListener('input', applyFieldsToSelectedPart);
document.getElementById('tpl-rotation').addEventListener('input', applyFieldsToSelectedPart);
document.getElementById('tpl-sel-anim').addEventListener('change', tplTick);
document.getElementById('tpl-sel-size').addEventListener('change', tplTick);
document.getElementById('tpl-preview-time').addEventListener('input', tplTick);
document.getElementById('tpl-num-scale').addEventListener('input', tplTick);
document.getElementById('tpl-num-offset-x').addEventListener('input', tplTick);
document.getElementById('tpl-num-offset-y').addEventListener('input', tplTick);
document.getElementById('tpl-preview-chk-checker').addEventListener('change', (e) => {
  document.getElementById('tpl-preview-canvas').classList.toggle('no-checker', !e.target.checked);
});
document.getElementById('tpl-btn-save-binding').addEventListener('click', onTplSaveBinding);
document.getElementById('tpl-btn-bake').addEventListener('click', onTplBake);

const tplCanvasEl = document.getElementById('tpl-preview-canvas');
tplCanvasEl.addEventListener('mousedown', onCanvasMouseDown);
tplCanvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', onCanvasMouseMove);
window.addEventListener('mouseup', onCanvasMouseUp);

createPlayback({
  sliderEl: document.getElementById('tpl-preview-time'),
  loopCheckboxEl: document.getElementById('tpl-preview-chk-loop'),
  playButtonEl: document.getElementById('tpl-preview-btn-play'),
  getMax: () => getTemplate(document.getElementById('tpl-sel-anim').value).length / 1000,
  onTick: tplTick,
  getSpeed: () => parseFloat(document.getElementById('tpl-preview-sel-speed').value) || 1,
});
})();
