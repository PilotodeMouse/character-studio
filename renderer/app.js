const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const { parseSCML } = require('../src/scml-parser');
const { computePose, drawPose } = require('../src/unity-skeleton');
const { bakeGrid, canvasToWebpBuffer } = require('../src/baker');
const { extractUnityPackage } = require('../src/unity-package');
const { buildRig } = require('../src/unity-prefab');
const { getZIndexByPartName } = require('../src/scml-zorder');
const { computeRigFingerprint, RigProfileStore } = require('../src/rig-profile');
const { detectCraftpixClassic, DEFAULT_ANIMATION_MAP } = require('../src/craftpix-profile');
const { validateCharacterFolderName, validateGrid } = require('../src/validate');
const { EXPORT } = require('../src/vtt-standards');

const os = require('os');
const profileStore = new RigProfileStore(path.join(os.homedir(), '.isometric-character-studio', 'rig-profiles'));

let state = {
  packFolder: null,
  rig: null,
  pivots: new Map(),
  images: new Map(),
  zIndexByName: new Map(),
  rigId: null,
  outputFolder: null,
};

function log(msg, cls) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.style.color = getComputedStyle(document.documentElement).getPropertyValue(`--${cls}`);
  document.getElementById('log').prepend(li);
}

function banner(el, cls, msg) {
  el.innerHTML = `<div class="banner ${cls}">${msg}</div>`;
}

function toKebabCase(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadImage(filePath) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(filePath);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${buf.toString('base64')}`;
  });
}

async function onPickPack() {
  const folder = await ipcRenderer.invoke('select-pack-folder');
  if (!folder) return;
  state.packFolder = folder;

  const detected = detectCraftpixClassic(folder);
  const profileBanner = document.getElementById('profile-banner');
  if (!detected) {
    banner(
      profileBanner,
      'err',
      `Nao encontrei "PNG/Vector Parts/Animations.scml" + "Unity Package/*.unitypackage" nessa pasta. Selecione a pasta de UM personagem (ex: ".../Esqueletos/Skeleton_Crusader_1").`
    );
    document.getElementById('pack-info').textContent = path.basename(folder);
    return;
  }
  banner(profileBanner, 'ok', `Perfil detectado: <code>craftpix-classic</code>.`);

  const scmlText = fs.readFileSync(detected.scmlPath, 'utf8');
  const parsedScml = parseSCML(scmlText);
  state.zIndexByName = getZIndexByPartName(parsedScml);

  state.pivots = new Map();
  for (const files of Object.values(parsedScml.folders)) {
    for (const file of Object.values(files)) {
      state.pivots.set(file.name, { pivotX: file.pivotX, pivotY: file.pivotY, width: file.width, height: file.height });
    }
  }

  state.images = new Map();
  for (const name of state.pivots.keys()) {
    const p = path.join(detected.vectorPartsDir, name);
    if (fs.existsSync(p)) state.images.set(name, await loadImage(p));
  }

  log(`Extraindo ${path.basename(detected.unitypackagePath)}...`);
  const pkg = await extractUnityPackage(detected.unitypackagePath);
  const prefabGuid = pkg.findGuidByPathnameSuffix('.prefab');
  if (!prefabGuid) throw new Error('Nao encontrei o .prefab dentro do .unitypackage.');
  state.rig = buildRig(pkg.readAsset(prefabGuid), pkg.guidToPathname);

  document.getElementById('pack-info').textContent =
    `${path.basename(folder)} - ${state.rig.clips.length} animacoes, ${state.images.size} PNGs`;
  document.getElementById('config-section').style.display = 'block';
  document.getElementById('preview-block').style.display = 'block';

  const clipNames = state.rig.clips.map((c) => c.name).filter((n) => n !== 'Base');
  const optionsHtml = clipNames.map((n) => `<option value="${n}">${n}</option>`).join('');
  document.getElementById('sel-anim-idle').innerHTML = optionsHtml;
  document.getElementById('sel-anim-walk').innerHTML = '<option value="">(nenhuma)</option>' + optionsHtml;
  document.getElementById('sel-anim-north').innerHTML = '<option value="">(usa a mesma pose de EAST)</option>' + optionsHtml;

  if (clipNames.includes(DEFAULT_ANIMATION_MAP.idle)) document.getElementById('sel-anim-idle').value = DEFAULT_ANIMATION_MAP.idle;
  if (clipNames.includes(DEFAULT_ANIMATION_MAP.walk)) document.getElementById('sel-anim-walk').value = DEFAULT_ANIMATION_MAP.walk;

  document.getElementById('txt-character-name').value = toKebabCase(path.basename(folder));

  applyRigProfileIfKnown();
  onPreviewTime();
}

function applyRigProfileIfKnown() {
  const { rigId } = computeRigFingerprint(state.rig);
  state.rigId = rigId;
  const rigBanner = document.getElementById('rig-banner');

  const profile = profileStore.get(rigId);
  if (profile) {
    banner(
      rigBanner,
      'ok',
      `Rig conhecido (assinatura <code>${rigId.slice(0, 8)}</code>) -- essa e a mesma estrutura de esqueleto de "${profile.sourceCharacterName}". Preferencias de bake aplicadas automaticamente.`
    );
    document.getElementById('sel-size').value = profile.size || '2x2';
    document.getElementById('num-frames-idle').value = profile.framesIdle || 4;
    document.getElementById('num-frames-walk').value = profile.framesWalk || 4;
    document.getElementById('num-scale').value = profile.scale || 1;
    document.getElementById('num-offset-x').value = profile.offsetX || 0;
    document.getElementById('num-offset-y').value = profile.offsetY || 0;
    document.getElementById('chk-has-north').checked = !!profile.hasNorthView;
    document.getElementById('sel-anim-north').disabled = !profile.hasNorthView;
  } else {
    banner(
      rigBanner,
      'warn',
      `Rig novo (assinatura <code>${rigId.slice(0, 8)}</code>) -- todos os personagens dessa mesma serie Chibi da Craftpix compartilham este esqueleto, entao suas escolhas de tamanho/escala serao lembradas para os proximos.`
    );
  }
}

function readConfig() {
  const idleClip = state.rig.clips.find((c) => c.name === document.getElementById('sel-anim-idle').value);
  const walkName = document.getElementById('sel-anim-walk').value;
  const walkClip = walkName ? state.rig.clips.find((c) => c.name === walkName) : null;
  const northName = document.getElementById('sel-anim-north').value;
  return {
    idleClip,
    walkClip,
    northClip: northName ? state.rig.clips.find((c) => c.name === northName) : null,
    hasNorthView: document.getElementById('chk-has-north').checked,
    size: document.getElementById('sel-size').value,
    framesIdle: parseInt(document.getElementById('num-frames-idle').value, 10),
    framesWalk: parseInt(document.getElementById('num-frames-walk').value, 10),
    scale: parseFloat(document.getElementById('num-scale').value) || 1,
    offsetX: parseFloat(document.getElementById('num-offset-x').value) || 0,
    offsetY: parseFloat(document.getElementById('num-offset-y').value) || 0,
    characterName: toKebabCase(document.getElementById('txt-character-name').value),
  };
}

function rowsFor(cfg, kind) {
  const eastClip = kind === 'idle' ? cfg.idleClip : cfg.walkClip;
  const northClip = cfg.hasNorthView ? cfg.northClip || eastClip : null;
  return [
    { row: 'north', clip: northClip || eastClip, hasArt: cfg.hasNorthView && !!northClip },
    { row: 'east', clip: eastClip, hasArt: true },
  ];
}

function onPreviewTime() {
  if (!state.rig) return;
  const cfg = readConfig();
  if (!cfg.idleClip) return;
  const slider = document.getElementById('preview-time');
  slider.max = cfg.idleClip.length || 1;
  const t = parseFloat(slider.value) * (cfg.idleClip.length ? 1 : 1);
  const clampedT = Math.min(t, cfg.idleClip.length);
  document.getElementById('preview-time-label').textContent = `${clampedT.toFixed(2)}s / ${cfg.idleClip.length.toFixed(2)}s`;

  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pose = computePose(state.rig, cfg.idleClip, clampedT, state.zIndexByName);
  const origin = { x: canvas.width / 2 + cfg.offsetX, y: canvas.height * 0.85 + cfg.offsetY };
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(cfg.scale, cfg.scale);
  ctx.translate(-origin.x, -origin.y);
  drawPose(ctx, pose, state.images, state.pivots, origin, 1);
  ctx.restore();
}

function renderCanvasBlock(container, title, canvas, warnings, errors) {
  const block = document.createElement('div');
  block.className = 'canvas-block';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  block.appendChild(h3);
  block.appendChild(canvas);
  for (const w of warnings) {
    const d = document.createElement('div');
    d.className = 'banner warn';
    d.style.marginTop = '6px';
    d.textContent = w;
    block.appendChild(d);
  }
  for (const e of errors) {
    const d = document.createElement('div');
    d.className = 'banner err';
    d.style.marginTop = '6px';
    d.textContent = e;
    block.appendChild(d);
  }
  container.appendChild(block);
}

async function onBakeClick() {
  const cfg = readConfig();
  if (!cfg.idleClip) {
    log('Selecione uma animation de Idle antes de bakear.', 'err');
    return;
  }
  const errs = validateCharacterFolderName(cfg.characterName);
  if (errs.length) {
    errs.forEach((e) => log(e, 'err'));
    return;
  }
  if (!state.outputFolder) {
    state.outputFolder = await ipcRenderer.invoke('select-output-folder');
    if (!state.outputFolder) return;
  }

  const container = document.getElementById('canvases');
  container.innerHTML = '';

  const jobs = [{ kind: 'idle', clip: cfg.idleClip, frames: cfg.framesIdle }];
  if (cfg.walkClip) jobs.push({ kind: 'walk', clip: cfg.walkClip, frames: cfg.framesWalk });

  for (const job of jobs) {
    const rows = rowsFor(cfg, job.kind);
    const { canvas, warnings, cell } = bakeGrid({
      rig: state.rig,
      images: state.images,
      pivots: state.pivots,
      zIndexByName: state.zIndexByName,
      rows,
      frameCount: job.frames,
      size: cfg.size,
      originOffset: { x: cfg.offsetX, y: cfg.offsetY },
      createCanvas: (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
    });

    const validationErrors = validateGrid({
      kind: job.kind,
      size: cfg.size,
      frameCount: job.frames,
      rowCount: rows.length,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });

    renderCanvasBlock(container, `${job.kind}.webp (${canvas.width}x${canvas.height})`, canvas, warnings, validationErrors);
    warnings.forEach((w) => log(`[${job.kind}] ${w}`, 'warn'));

    if (validationErrors.length) {
      validationErrors.forEach((e) => log(`[${job.kind}] ${e}`, 'err'));
      continue;
    }

    const buffer = await canvasToWebpBuffer(canvas, EXPORT.quality);
    const dir = path.join(state.outputFolder, cfg.characterName);
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `${job.kind}.webp`);
    fs.writeFileSync(outPath, buffer);
    log(`Salvo: ${outPath}`, 'ok');
  }

  profileStore.save(state.rigId, {
    sourceCharacterName: cfg.characterName,
    size: cfg.size,
    framesIdle: cfg.framesIdle,
    framesWalk: cfg.framesWalk,
    scale: cfg.scale,
    offsetX: cfg.offsetX,
    offsetY: cfg.offsetY,
    hasNorthView: cfg.hasNorthView,
  });
  log(`Preferencias salvas para o rig ${state.rigId.slice(0, 8)} -- outros personagens dessa serie vao herdar isso.`, 'ok');
}

document.getElementById('btn-pick-pack').addEventListener('click', onPickPack);
document.getElementById('chk-has-north').addEventListener('change', (e) => {
  document.getElementById('sel-anim-north').disabled = !e.target.checked;
});
document.getElementById('sel-anim-idle').addEventListener('change', onPreviewTime);
document.getElementById('preview-time').addEventListener('input', onPreviewTime);
document.getElementById('num-scale').addEventListener('input', onPreviewTime);
document.getElementById('num-offset-x').addEventListener('input', onPreviewTime);
document.getElementById('num-offset-y').addEventListener('input', onPreviewTime);
document.getElementById('btn-preview').addEventListener('click', onPreviewTime);
document.getElementById('btn-bake').addEventListener('click', onBakeClick);
