// IIFE: cada <script> de renderer/ roda no MESMO escopo global (nao sao
// modulos ES), entao sem isso "const ipcRenderer/fs/path" aqui colide com a
// mesma declaracao em template-mode.js e quebra o parse dos dois arquivos
// inteiros (SyntaxError silencioso -- nenhum botao funciona).
(function () {
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const { parseSCML } = require('../src/scml-parser');
const { computePose, drawPose, applyManualOverrides, findAnimatedAncestorName, computeAnimatedBounds } = require('../src/unity-skeleton');
const { bakeGrid, canvasToWebpBuffer } = require('../src/baker');
const { extractUnityPackage } = require('../src/unity-package');
const { buildRig } = require('../src/unity-prefab');
const { getZIndexByPartName } = require('../src/scml-zorder');
const { computeRigFingerprint, RigProfileStore } = require('../src/rig-profile');
const { detectCraftpixClassic, DEFAULT_ANIMATION_MAP } = require('../src/craftpix-profile');
const { validateCharacterFolderName, validateGrid } = require('../src/validate');
const { EXPORT, cellSpecFor, fitScaleForBounds } = require('../src/vtt-standards');

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
  partOffsets: new Map(), // boneName -> {dx,dy,dangle}, correcao manual do usuario
  selectedBone: null,
  lastPose: null,
  lastOrigin: null,
  lastCfg: null,
  drag: null,
  referenceImage: null,
  zoom: 1,
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

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function loadImageAnyFormat(filePath) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(filePath);
    const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png';
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:${mime};base64,${buf.toString('base64')}`;
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
  applyAutoFitScale();
  onPreviewTime();
  renderLayersList();
}

// Reduz (nunca aumenta) a "Escala do personagem dentro da celula" o quanto
// for preciso pra o personagem caber no tamanho de saida escolhido com 8px
// de margem em cada lado, amostrando o alcance real do clip de Idle (bracos/
// cabeca se movem, um frameso nao basta). Roda ao carregar o personagem e ao
// trocar o tamanho -- a escala e diferente por tamanho porque a arte tem
// dimensao fixa em pixels e as celulas 1x1/2x2/3x3 nao.
function applyAutoFitScale() {
  if (!state.rig) return;
  const cfg = readConfig();
  if (!cfg.idleClip) return;
  const cell = cellSpecFor(cfg.size);
  const bounds = computeAnimatedBounds(state.rig, cfg.idleClip, state.pivots, state.partOffsets);
  const scale = fitScaleForBounds(bounds, cell, 8);
  document.getElementById('num-scale').value = scale.toFixed(3);
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
    document.getElementById('sel-size').value = profile.size || '1x1';
    document.getElementById('num-frames-idle').value = profile.framesIdle || 4;
    document.getElementById('num-frames-walk').value = profile.framesWalk || 4;
    document.getElementById('num-scale').value = profile.scale || 1;
    document.getElementById('num-offset-x').value = profile.offsetX || 0;
    document.getElementById('num-offset-y').value = profile.offsetY || 0;
    document.getElementById('chk-has-north').checked = !!profile.hasNorthView;
    document.getElementById('sel-anim-north').disabled = !profile.hasNorthView;
    state.partOffsets = new Map(Object.entries(profile.partOffsets || {}));
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

  // O canvas de preview usa exatamente as mesmas dimensoes e a mesma linha
  // do chao (groundLineY) que o bake de verdade (src/baker.js), assim o que
  // se ve aqui e o que sai no .webp -- antes o preview usava canvas.height*0.85
  // como aproximacao e ficava um pouco fora do lugar em relacao ao bake real.
  const cell = cellSpecFor(cfg.size);
  const canvas = document.getElementById('preview-canvas');
  if (canvas.width !== cell.w) canvas.width = cell.w;
  if (canvas.height !== cell.h) canvas.height = cell.h;
  // Zoom e so tamanho de RENDER (CSS) por cima da mesma resolucao interna --
  // a matematica de hit-test/arrasto ja deriva o fator de conversao de
  // rect.width/canvas.width a cada evento, entao nao precisa mudar em lugar
  // nenhum alem daqui (ver canvasEventToLocalCraftpix).
  canvas.style.width = `${cell.w * state.zoom}px`;
  canvas.style.height = `${cell.h * state.zoom}px`;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.referenceImage) {
    ctx.save();
    ctx.globalAlpha = parseFloat(document.getElementById('ref-opacity').value) || 0.6;
    ctx.drawImage(state.referenceImage, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  const rawPose = computePose(state.rig, cfg.idleClip, clampedT, state.zIndexByName, state.partOffsets);
  const pose = applyManualOverrides(rawPose, state.partOffsets);
  const origin = { x: cell.bodyAxisX + cfg.offsetX, y: cell.groundLineY + cfg.offsetY };
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(cfg.scale, cfg.scale);
  ctx.translate(-origin.x, -origin.y);
  drawPose(ctx, pose, state.images, state.pivots, origin, 1, state.selectedBone);
  ctx.restore();

  // Guias do padrao VTT (eixo do corpo tracejado + linha do chao vermelha),
  // em espaco de pixel BRUTO da celula -- nao entram no ctx.scale(cfg.scale)
  // porque representam a geometria fixa da celula, nao algo que encolhe
  // junto com o personagem.
  if (document.getElementById('preview-chk-guides').checked) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cell.bodyAxisX, 0);
    ctx.lineTo(cell.bodyAxisX, cell.h);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cell.groundLineY);
    ctx.lineTo(cell.w, cell.groundLineY);
    ctx.stroke();
    ctx.restore();
  }

  state.lastPose = pose;
  state.lastOrigin = origin;
  state.lastCfg = cfg;
}

function selectPart(boneName) {
  state.selectedBone = boneName;
  document.getElementById('sel-part-name').textContent = boneName || '(nenhuma peca selecionada)';
  const o = state.partOffsets.get(boneName) || { dx: 0, dy: 0, dangle: 0 };
  document.getElementById('part-offset-x').value = o.dx || 0;
  document.getElementById('part-offset-y').value = o.dy || 0;
  document.getElementById('part-offset-angle').value = o.dangle || 0;

  const bone = boneName && [...state.rig.bones.values()].find((b) => b.name === boneName);
  const filePivot = bone && bone.sprite && state.pivots.get(bone.sprite.pngName);
  document.getElementById('part-pivot-x').value = o.pivotX !== undefined ? o.pivotX : filePivot ? filePivot.pivotX : 0;
  document.getElementById('part-pivot-y').value = o.pivotY !== undefined ? o.pivotY : filePivot ? filePivot.pivotY : 1;

  const followSel = document.getElementById('part-follow-bone');
  const spriteBoneNames = boneName
    ? [...state.rig.bones.values()].filter((b) => b.sprite && b.sprite.pngName && b.name !== boneName).map((b) => b.name)
    : [];
  followSel.innerHTML = '<option value="">(nenhuma)</option>' + spriteBoneNames.map((n) => `<option value="${n}">${n}</option>`).join('');
  followSel.value = o.followBone || '';

  // O amortecimento de balanco nao vive necessariamente na propria peca: a
  // maioria das pecas com sprite so tem a pose de bind (nao anima sozinha),
  // o movimento de verdade vem de um osso-junta sem arte mais acima na
  // hierarquia (ver findAnimatedAncestorName). Resolve contra o clip de Idle
  // -- e o unico que o preview deste modo toca -- e guarda o resultado em
  // state.selectedDampBone pra applyOffsetFieldsToSelected gravar no lugar certo.
  const cfg = readConfig();
  const dampBone = boneName && cfg.idleClip ? findAnimatedAncestorName(state.rig, cfg.idleClip, boneName) : boneName;
  state.selectedDampBone = dampBone;
  const d = (dampBone && state.partOffsets.get(dampBone)) || {};
  document.getElementById('part-damp-x').value = (d.dampX || 0) * 100;
  document.getElementById('part-damp-y').value = (d.dampY || 0) * 100;
  document.getElementById('part-damp-angle').value = (d.dampAngle || 0) * 100;
  const hint = document.getElementById('part-damp-hint');
  if (hint) {
    hint.textContent = !boneName || dampBone === boneName
      ? 'Reduz o deslocamento/rotacao ANIMADOS dessa peca -- 0% mantem fiel ao clip original, 100% trava nesse componente (para de balancar).'
      : `Essa peca nao anima sozinha nesse clip -- o balanco vem do osso "${dampBone}" mais acima na hierarquia; o amortecimento abaixo age nele (afeta tambem outras pecas presas ao mesmo osso).`;
  }

  renderLayersList();
}

// Camadas visiveis, na ordem de desenho atual (zIndex efetivo = override
// manual > z_index do .scml > sortingOrder do Unity). O botao ^/v atribui
// um zIndex explicito pra trocar de posicao com o vizinho, sem depender do
// numero "real" do arquivo original.
function currentLayers() {
  const bones = [...state.rig.bones.values()].filter((b) => b.sprite && b.sprite.pngName);
  return bones
    .map((b) => {
      const o = state.partOffsets.get(b.name);
      const z = o && o.zIndex !== undefined ? o.zIndex : state.zIndexByName.get(b.name) ?? b.sprite.sortingOrder ?? 0;
      return { boneName: b.name, z };
    })
    .sort((a, b) => a.z - b.z);
}

function renderLayersList() {
  if (!state.rig) return;
  const layers = currentLayers();
  const el = document.getElementById('layers-list');
  el.innerHTML = '';
  // de cima (frente) pra baixo (fundo) na lista, como no Photoshop
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const row = document.createElement('div');
    row.className = 'layer-row' + (state.selectedBone === layer.boneName ? ' selected' : '');
    row.draggable = true;
    row.innerHTML = `<span class="layer-handle">&#8942;&#8942;</span><span class="layer-name">${layer.boneName}</span>`;
    row.querySelector('.layer-name').addEventListener('click', () => selectPart(layer.boneName));
    row.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', layer.boneName);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('drag-over');
      const draggedBone = ev.dataTransfer.getData('text/plain');
      if (!draggedBone || draggedBone === layer.boneName) return;
      const rect = row.getBoundingClientRect();
      const after = ev.clientY - rect.top > rect.height / 2;
      reorderLayers(draggedBone, layer.boneName, after);
    });
    el.appendChild(row);
  }
}

// draggedBone e solto sobre targetBone; after decide se ele entra antes ou
// depois do alvo na lista (exibida de frente/topo pra fundo). Reatribui
// zIndex inteiro sequencial pra todo mundo, igual o antigo botao ^/v fazia.
function reorderLayers(draggedBone, targetBone, after) {
  const layers = currentLayers(); // ordem ascendente de z (fundo -> frente)
  const displayed = [...layers].reverse().map((l) => l.boneName); // frente -> fundo, como na lista
  const fromIdx = displayed.indexOf(draggedBone);
  if (fromIdx === -1) return;
  displayed.splice(fromIdx, 1);
  let toIdx = displayed.indexOf(targetBone);
  if (toIdx === -1) return;
  if (after) toIdx += 1;
  displayed.splice(toIdx, 0, draggedBone);
  const backToFront = [...displayed].reverse();
  backToFront.forEach((name, i) => {
    const existing = state.partOffsets.get(name) || {};
    state.partOffsets.set(name, { ...existing, zIndex: i });
  });
  renderLayersList();
  onPreviewTime();
}

function hitTestCraftpixPart(xLocal, yLocal, pose) {
  for (let i = pose.length - 1; i >= 0; i--) {
    const item = pose[i];
    const pivot = state.pivots.get(item.sprite.pngName);
    if (!pivot || item.sprite.alpha <= 0) continue;
    const w = pivot.width;
    const h = pivot.height;
    const px = item.world.x + state.lastOrigin.x;
    const py = -item.world.y + state.lastOrigin.y;
    const angleRad = (item.world.angle * Math.PI) / 180; // drawPose usa -angle; aqui desfazemos o -angle direto
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const dx = xLocal - px;
    const dy = yLocal - py;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const offsetX = -pivot.pivotX * w;
    const offsetY = -pivot.pivotY * h;
    if (localX >= offsetX && localX <= offsetX + w && localY >= offsetY && localY <= offsetY + h) {
      return item.boneName;
    }
  }
  return null;
}

function canvasEventToLocalCraftpix(e) {
  const canvas = document.getElementById('preview-canvas');
  const rect = canvas.getBoundingClientRect();
  const pxScale = canvas.width / rect.width;
  const mx = (e.clientX - rect.left) * pxScale;
  const my = (e.clientY - rect.top) * pxScale;
  const cfg = state.lastCfg || { scale: 1 };
  const origin = state.lastOrigin || { x: canvas.width / 2, y: canvas.height * 0.85 };
  return {
    x: origin.x + (mx - origin.x) / cfg.scale,
    y: origin.y + (my - origin.y) / cfg.scale,
  };
}

// Clique esquerdo NUNCA troca a camada ativa sozinho -- a camada escolhida
// na lista (ou por clique direito) e soberana, senao arrastar uma peca fina
// que fica embaixo de outra maior vira uma armadilha (clica pra arrastar A,
// o hit-test acha B por cima, e o arrasto sai errado). So clique direito
// re-seleciona pelo que esta sob o cursor.
function onPreviewCanvasMouseDown(e) {
  if (!state.lastPose) return;
  const { x, y } = canvasEventToLocalCraftpix(e);

  if (e.button === 2) {
    const hit = hitTestCraftpixPart(x, y, state.lastPose);
    if (hit) {
      selectPart(hit);
      onPreviewTime(); // redesenha ja com o contorno vermelho na peca nova
    }
    return;
  }
  if (e.button !== 0) return;

  const hit = hitTestCraftpixPart(x, y, state.lastPose);
  if (!state.selectedBone) {
    if (!hit) return;
    selectPart(hit);
  } else if (!hit) {
    // clicou fora de qualquer peca (canvas vazio) -- desmarca em vez de
    // arrastar as cegas a selecao atual pra um lugar aleatorio.
    selectPart(null);
    onPreviewTime();
    return;
  }

  document.getElementById('preview-canvas').classList.add('dragging');
  state.drag = { startX: x, startY: y, start: { ...(state.partOffsets.get(state.selectedBone) || { dx: 0, dy: 0, dangle: 0 }) } };
  onPreviewTime();
}

function onPreviewCanvasMouseMove(e) {
  if (!state.drag) return;
  const { x, y } = canvasEventToLocalCraftpix(e);
  const dx = x - state.drag.startX;
  const dy = y - state.drag.startY;
  const o = { ...state.drag.start, dx: (state.drag.start.dx || 0) + dx, dy: (state.drag.start.dy || 0) - dy };
  state.partOffsets.set(state.selectedBone, o);
  document.getElementById('part-offset-x').value = o.dx.toFixed(1);
  document.getElementById('part-offset-y').value = o.dy.toFixed(1);
  onPreviewTime();
}

function onPreviewCanvasMouseUp() {
  state.drag = null;
  document.getElementById('preview-canvas').classList.remove('dragging');
}

function clampPercent01(elId) {
  return Math.min(1, Math.max(0, (parseFloat(document.getElementById(elId).value) || 0) / 100));
}

// Muda quem esta peca segue, preservando a posicao VISUAL atual (converte
// pra absoluto somando o pai antigo, depois subtrai o pai novo) -- assim
// ligar/trocar o "seguir" nao teleporta a peca, so muda o que ela acompanha
// dali em diante.
function setFollowBone(boneName, newFollow) {
  const entry = { dx: 0, dy: 0, dangle: 0, ...(state.partOffsets.get(boneName) || {}) };
  const oldFollow = entry.followBone || null;
  const oldParent = oldFollow ? state.partOffsets.get(oldFollow) || {} : {};
  const newParent = newFollow ? state.partOffsets.get(newFollow) || {} : {};

  const absDx = entry.dx + (oldParent.dx || 0);
  const absDy = entry.dy + (oldParent.dy || 0);
  const absDangle = entry.dangle + (oldParent.dangle || 0);

  entry.dx = absDx - (newParent.dx || 0);
  entry.dy = absDy - (newParent.dy || 0);
  entry.dangle = absDangle - (newParent.dangle || 0);
  entry.followBone = newFollow || undefined;
  state.partOffsets.set(boneName, entry);
}

function applyOffsetFieldsToSelected() {
  if (!state.selectedBone) return;
  const existing = state.partOffsets.get(state.selectedBone) || {};
  state.partOffsets.set(state.selectedBone, {
    ...existing,
    dx: parseFloat(document.getElementById('part-offset-x').value) || 0,
    dy: parseFloat(document.getElementById('part-offset-y').value) || 0,
    dangle: parseFloat(document.getElementById('part-offset-angle').value) || 0,
    pivotX: parseFloat(document.getElementById('part-pivot-x').value),
    pivotY: parseFloat(document.getElementById('part-pivot-y').value),
  });

  // O amortecimento grava no osso que REALMENTE anima (state.selectedDampBone,
  // resolvido em selectPart), que pode ser diferente da peca clicada -- ver
  // comentario em findAnimatedAncestorName (unity-skeleton.js).
  const dampBone = state.selectedDampBone || state.selectedBone;
  const existingDamp = state.partOffsets.get(dampBone) || {};
  state.partOffsets.set(dampBone, {
    ...existingDamp,
    dampX: clampPercent01('part-damp-x'),
    dampY: clampPercent01('part-damp-y'),
    dampAngle: clampPercent01('part-damp-angle'),
  });

  onPreviewTime();
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
      partOffsets: state.partOffsets,
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
    partOffsets: Object.fromEntries(state.partOffsets),
  });
  log(`Preferencias salvas para o rig ${state.rigId.slice(0, 8)} -- outros personagens dessa serie vao herdar isso.`, 'ok');
}

document.getElementById('btn-pick-pack').addEventListener('click', onPickPack);
document.getElementById('chk-has-north').addEventListener('change', (e) => {
  document.getElementById('sel-anim-north').disabled = !e.target.checked;
});
document.getElementById('sel-anim-idle').addEventListener('change', onPreviewTime);
document.getElementById('sel-size').addEventListener('change', () => {
  applyAutoFitScale();
  onPreviewTime();
});
document.getElementById('preview-time').addEventListener('input', onPreviewTime);
document.getElementById('num-scale').addEventListener('input', onPreviewTime);
document.getElementById('num-offset-x').addEventListener('input', onPreviewTime);
document.getElementById('num-offset-y').addEventListener('input', onPreviewTime);
document.getElementById('btn-preview').addEventListener('click', onPreviewTime);
document.getElementById('btn-bake').addEventListener('click', onBakeClick);
document.getElementById('preview-chk-checker').addEventListener('change', (e) => {
  document.getElementById('preview-canvas').classList.toggle('no-checker', !e.target.checked);
});
document.getElementById('preview-chk-guides').addEventListener('change', onPreviewTime);

document.getElementById('btn-load-reference').addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('select-reference-image');
  if (!filePath) return;
  const img = await loadImageAnyFormat(filePath);
  state.referenceImage = img;
  document.getElementById('btn-clear-reference').disabled = false;
  onPreviewTime();
});
document.getElementById('btn-clear-reference').addEventListener('click', (e) => {
  state.referenceImage = null;
  e.target.disabled = true;
  onPreviewTime();
});
document.getElementById('ref-opacity').addEventListener('input', onPreviewTime);

// Zoom centrado no mouse: guarda o ponto do canvas sob o cursor antes de
// mudar o zoom e realinha o scroll do viewport pra ele continuar sob o
// cursor depois -- efeito comum de editor grafico (Figma, Photoshop).
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
function setZoom(newZoomRaw, anchor) {
  const viewport = document.getElementById('preview-viewport');
  const oldZoom = state.zoom;
  const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoomRaw));
  if (newZoom === oldZoom) return;
  let cx, cy, ax, ay;
  if (anchor) {
    const rect = viewport.getBoundingClientRect();
    ax = anchor.clientX - rect.left;
    ay = anchor.clientY - rect.top;
    cx = ax + viewport.scrollLeft;
    cy = ay + viewport.scrollTop;
  }
  state.zoom = newZoom;
  document.getElementById('btn-zoom-reset').textContent = `${Math.round(newZoom * 100)}%`;
  onPreviewTime();
  if (anchor) {
    viewport.scrollLeft = cx * (newZoom / oldZoom) - ax;
    viewport.scrollTop = cy * (newZoom / oldZoom) - ay;
  }
}
document.getElementById('preview-viewport').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom(state.zoom * factor, e);
  },
  { passive: false }
);
document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
document.getElementById('btn-zoom-reset').addEventListener('click', () => setZoom(1));

document.getElementById('part-offset-x').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-offset-y').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-offset-angle').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-pivot-x').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-pivot-y').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-damp-x').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-damp-y').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-damp-angle').addEventListener('input', applyOffsetFieldsToSelected);
document.getElementById('part-follow-bone').addEventListener('change', (e) => {
  if (!state.selectedBone) return;
  setFollowBone(state.selectedBone, e.target.value || null);
  selectPart(state.selectedBone);
  onPreviewTime();
});
document.getElementById('btn-reset-part-offset').addEventListener('click', () => {
  if (!state.selectedBone) return;
  state.partOffsets.delete(state.selectedBone);
  if (state.selectedDampBone && state.selectedDampBone !== state.selectedBone) {
    state.partOffsets.delete(state.selectedDampBone);
  }
  selectPart(state.selectedBone);
  onPreviewTime();
});

const previewCanvasEl = document.getElementById('preview-canvas');
previewCanvasEl.addEventListener('mousedown', onPreviewCanvasMouseDown);
previewCanvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', onPreviewCanvasMouseMove);
window.addEventListener('mouseup', onPreviewCanvasMouseUp);

createPlayback({
  sliderEl: document.getElementById('preview-time'),
  loopCheckboxEl: document.getElementById('preview-chk-loop'),
  playButtonEl: document.getElementById('preview-btn-play'),
  getMax: () => {
    const cfg = readConfig();
    return cfg.idleClip ? cfg.idleClip.length : 1;
  },
  onTick: onPreviewTime,
  getSpeed: () => parseFloat(document.getElementById('preview-sel-speed').value) || 1,
});

function setMode(mode) {
  const isCraftpix = mode === 'craftpix';
  document.getElementById('tab-craftpix').classList.toggle('active', isCraftpix);
  document.getElementById('tab-template').classList.toggle('active', !isCraftpix);
  document.getElementById('mode-craftpix').style.display = isCraftpix ? 'block' : 'none';
  document.getElementById('mode-template').style.display = isCraftpix ? 'none' : 'block';
  document.getElementById('preview-block').style.display = isCraftpix && state.rig ? 'block' : 'none';
  document.getElementById('canvases').style.display = isCraftpix ? 'block' : 'none';
  document.getElementById('tpl-preview-block').style.display = !isCraftpix && window.tplState && window.tplState.loaded ? 'block' : 'none';
  document.getElementById('tpl-canvases').style.display = !isCraftpix ? 'block' : 'none';
}
document.getElementById('tab-craftpix').addEventListener('click', () => setMode('craftpix'));
document.getElementById('tab-template').addEventListener('click', () => setMode('template'));
})();
