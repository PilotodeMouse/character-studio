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
const { computeAlphaBoxes } = require('../src/alpha-bounds');
const { mergeImagesForRow, matchBackFiles } = require('../src/back-art');
const { computeRigFingerprint, RigProfileStore } = require('../src/rig-profile');
const { detectCraftpixClassic, DEFAULT_ANIMATION_MAP } = require('../src/craftpix-profile');
const { validateCharacterFolderName, validateGrid } = require('../src/validate');
const { EXPORT, DEFAULT_SIZE, cellSpecFor, fitScaleForBounds } = require('../src/vtt-standards');
const { listTemplates, loadTemplate } = require('../src/rig-templates');
const { computeScmlPose, clipsFromScml, computeScmlBounds } = require('../src/scml-rig');

const os = require('os');
const profileStore = new RigProfileStore(path.join(os.homedir(), '.isometric-character-studio', 'rig-profiles'));

let state = {
  packFolder: null,
  rig: null,
  pivots: new Map(),
  images: new Map(),
  imagesBack: new Map(), // PNGs de costas (opcional), mesmas chaves de state.images -- ver src/back-art.js
  alphaBoxes: null, // Map<png, caixa de pixels opacos> -- ver src/alpha-bounds.js
  previewRow: 'east', // 'east' | 'north' -- so afeta o preview; o bake sempre desenha as duas linhas
  zIndexByName: new Map(),
  rigId: null,
  outputFolder: null,
  // Ajustes manuais INDEPENDENTES por vista: mexer no NORTH (costas) nao pode
  // desmontar o EAST e vice-versa. `partOffsets` e so um atalho pro mapa da
  // vista que esta sendo editada (state.previewRow), entao todo o codigo de
  // arrastar/camadas/pivo continua igual e passa a valer so pra vista ativa.
  partOffsetsByRow: { east: new Map(), north: new Map() }, // boneName -> {dx,dy,dangle,...}
  get partOffsets() {
    return this.partOffsetsByRow[this.previewRow === 'north' ? 'north' : 'east'];
  },
  set partOffsets(m) {
    this.partOffsetsByRow[this.previewRow === 'north' ? 'north' : 'east'] = m;
  },
  selectedBone: null,
  multiSel: new Set(), // selecao multipla (Shift): sempre contem selectedBone quando ha selecao
  undoStack: [],
  redoStack: [],
  lastPose: null,
  lastOrigin: null,
  lastCfg: null,
  drag: null,
  referenceImage: null,
  refScale: 1,
  refOffsetX: 0,
  refOffsetY: 0,
  zoom: 1,
  // De onde vem a pose: 'unity' (.unitypackage -> .prefab YAML) ou 'scml'
  // (fallback direto do .scml, pra pacotes com .prefab binario). Decidido em
  // loadFromDetected; quem amostra pose passa por computePoseFn.
  poseSource: 'unity',
  activeTemplate: null, // {id, dir, detected, partNames} quando a fonte e um template embutido, null quando e pasta externa
  // Trocar a arte de uma peca vale pras DUAS fontes (template ou pasta do
  // personagem). artSourceDir e a pasta de onde a arte original veio -- e o
  // que permite o botao "voltar ao padrao" reler o arquivo do disco.
  artSourceDir: null,
  artPartNames: [], // todos os PNGs da pasta de origem (inclusive os que nenhum osso usa)
  partArtOverridesBack: new Map(), // idem, mas da arte de COSTAS (state.imagesBack)
  partArtOverrides: new Map(), // partName -> caminho escolhido pelo usuario, so pra UI/status (a peca em si ja vive em state.images)
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

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
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
  state.activeTemplate = null;
  document.getElementById('template-parts-section').style.display = 'none';

  const detected = detectCraftpixClassic(folder);
  const profileBanner = document.getElementById('profile-banner');
  if (!detected) {
    banner(
      profileBanner,
      'err',
      `Nao encontrei "PNG/Vector Parts/Animations.scml" + "Unity Package/*.unitypackage" nessa pasta. Selecione a pasta de UM personagem (ex: ".../Esqueletos/Skeleton_Crusader_1") -- ou use um template embutido acima, se voce so tem a arte propria.`
    );
    document.getElementById('pack-info').textContent = path.basename(folder);
    return;
  }
  banner(profileBanner, 'ok', `Perfil detectado: <code>craftpix-classic</code>.`);
  document.getElementById('txt-character-name').value = toKebabCase(path.basename(folder));
  await loadFromDetected(detected, path.basename(folder));
}

// Fluxo alternativo: o rig (.scml + .unitypackage) vem embutido no proprio
// app (src/rig-templates.js), o usuario so entra com a arte por peca. Ao
// escolher o template, carrega primeiro com a arte DEFAULT dele (pra ja dar
// pra ver/animar), e cada peca pode ser trocada individualmente depois pela
// lista que renderTemplatePartsList() monta.
async function onPickTemplate() {
  const templateId = document.getElementById('sel-template').value;
  if (!templateId) return;
  const template = loadTemplate(templateId);
  state.packFolder = null;
  state.activeTemplate = template;

  const profileBanner = document.getElementById('profile-banner');
  banner(profileBanner, 'ok', `Template embutido carregado: <code>${template.id}</code>. Troque as pecas que quiser abaixo -- as que voce nao trocar usam a arte default do template.`);
  document.getElementById('txt-character-name').value = '';

  // renderTemplatePartsList() depende de state.rig (pra saber quais pecas NAO
  // tem osso) e de partArtOverrides zerado -- as duas coisas so existem
  // depois do loadFromDetected, que chama as duas listas no final.
  await loadFromDetected(template.detected, template.id);
}

// So as pecas que NENHUM osso usa (faces alternativas, etc.) -- as que tem
// osso ja aparecem como linha no painel de camadas, com o mesmo botao de
// trocar arte. Vale pra template embutido e pra pasta do personagem.
function renderTemplatePartsList() {
  const el = document.getElementById('template-parts-list');
  el.innerHTML = '';
  if (!state.artSourceDir) return;
  const usedByBones = new Set(
    [...(state.rig ? state.rig.bones.values() : [])].filter((b) => b.sprite && b.sprite.pngName).map((b) => b.sprite.pngName)
  );
  const orphans = state.artPartNames.filter((p) => !usedByBones.has(p));
  document.getElementById('template-parts-section').style.display = orphans.length ? 'block' : 'none';
  for (const partName of orphans) {
    const isCustom = artOverridesForView().has(partName);
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.innerHTML =
      `<span class="layer-name">${partName}</span>` +
      `<span style="color:var(--muted); font-size:11px; margin-right:6px;">${isCustom ? 'personalizada' : 'padrao'}</span>` +
      `<button class="layer-btn" data-action="load">Carregar</button>` +
      (isCustom ? `<button class="layer-btn" data-action="reset">Padrao</button>` : '');
    row.querySelector('[data-action="load"]').addEventListener('click', () => onSwapPartArt(partName));
    const resetBtn = row.querySelector('[data-action="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => onResetPartArt(partName));
    el.appendChild(row);
  }
}

// Quais trocas de arte valem pra vista que esta sendo editada.
function artOverridesForView() {
  return state.previewRow === 'north' ? state.partArtOverridesBack : state.partArtOverrides;
}

function refreshAfterArtChange() {
  updateRowControls();
  // A caixa alfa e por ARQUIVO e alimenta o auto-fit; trocar a arte sem
  // recalcular deixa o auto-fit medindo a silhueta da peca antiga.
  state.alphaBoxes = computeAlphaBoxes(state.images, (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });
  renderTemplatePartsList();
  renderLayersList();
  // SEM force: se o usuario ja calibrou a escala a mao (state.savedScale),
  // trocar a arte de uma peca nao deve descartar isso -- so personagem
  // recem-carregado (savedScale ainda null) e que ganha um auto-fit novo.
  applyAutoFitScale();
  onPreviewTime();
}

// Troca SO essa peca em state.images (o rig/pose ja estao carregados, nao
// precisa recarregar o .unitypackage nem o resto da arte).
//
// Vale pras DUAS fontes -- template embutido e pasta externa. Ficou um tempo
// so no template por um motivo que nao se sustentava: "voltar ao padrao"
// precisa de uma pasta de origem pra reler o arquivo, e so o template tinha
// uma guardada. A pasta externa tem a dela tambem (state.artSourceDir), e e
// justamente ali que trocar Sword por Axe interessa.
//
// A troca e so em memoria: nada e escrito na pasta do personagem, e o bake
// usa a arte que esta carregada. Recarregar o personagem volta tudo ao disco.
async function onSwapPartArt(partName) {
  const filePath = await ipcRenderer.invoke('select-image-file');
  if (!filePath) return;
  // Cada vista tem a SUA arte: com NORTH ativo a troca vai pra arte de costas,
  // com EAST pra de frente -- uma nao mexe na outra.
  const north = state.previewRow === 'north';
  (north ? state.partArtOverridesBack : state.partArtOverrides).set(partName, filePath);
  (north ? state.imagesBack : state.images).set(partName, await loadImageAnyFormat(filePath));
  refreshAfterArtChange();
  log(`Peca "${partName}" (${north ? 'costas' : 'frente'}) trocada por ${path.basename(filePath)} (so nesta sessao, o arquivo original nao foi tocado).`, 'ok');
}

async function onResetPartArt(partName) {
  if (!state.artSourceDir) return;
  if (state.previewRow === 'north') {
    state.partArtOverridesBack.delete(partName);
    state.imagesBack.delete(partName);
    // volta pra arte de costas do disco (se existia), senao cai pra da frente
    for (const [dir, requireSuffix] of state.backSources || []) {
      const file = matchBackFiles(fs.readdirSync(dir), [partName], requireSuffix).get(partName);
      if (file) { state.imagesBack.set(partName, await loadImage(path.join(dir, file))); break; }
    }
    refreshAfterArtChange();
    return;
  }
  state.partArtOverrides.delete(partName);
  const p = path.join(state.artSourceDir, partName);
  if (fs.existsSync(p)) state.images.set(partName, await loadImage(p));
  else state.images.delete(partName);
  refreshAfterArtChange();
}

// Corpo compartilhado entre "pasta externa" (onPickPack) e "template
// embutido" (onPickTemplate) -- a partir daqui os dois caminhos sao
// identicos: mesma extracao de rig, mesmo preview, mesmo bake.
async function loadFromDetected(detected, displayLabel) {
  // Personagem novo comeca do zero. Sem isso, os ajustes manuais do
  // personagem que estava aberto continuavam vivos no state e desmontavam o
  // proximo a ser importado -- os offsets sao em pixels da arte de UM
  // personagem, nao tem sentido nenhum no outro.
  state.partOffsetsByRow = { east: new Map(), north: new Map() };
  state.undoStack = [];
  state.redoStack = [];
  state.multiSel = new Set();
  state.selectedBone = null;
  state.selectedDampBone = null;
  state.lastPose = null;
  state.savedScale = null;
  state.partArtOverrides = new Map();
  state.partArtOverridesBack = new Map();
  state.artSourceDir = detected.vectorPartsDir;
  state.artPartNames = fs
    .readdirSync(detected.vectorPartsDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    // arte de costas solta na Vector Parts ("*-back.png") nao e variante da frente
    .filter((f) => !/[-_ ]?(back|costas)\.png$/i.test(f))
    .sort();

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

  // Arte de costas e OPCIONAL e PARCIAL: casa por nome de arquivo com a arte
  // da frente (mesmo pivo/dimensao do .scml), e so as pecas que existirem la
  // dentro sao substituidas -- ver src/back-art.js e src/craftpix-profile.js.
  state.imagesBack = new Map();
  // Pasta Back/Costas (nomes iguais ou tolerantes) ou arquivos "*-back.png"
  // soltos na propria Vector Parts.
  const backSources = [];
  state.backSources = backSources;
  if (detected.backArtDir) backSources.push([detected.backArtDir, false]);
  backSources.push([detected.vectorPartsDir, true]);
  for (const [dir, requireSuffix] of backSources) {
    const matches = matchBackFiles(fs.readdirSync(dir), [...state.pivots.keys()], requireSuffix);
    for (const [part, file] of matches) {
      if (!state.imagesBack.has(part)) state.imagesBack.set(part, await loadImage(path.join(dir, file)));
    }
  }

  // Le pixel a pixel, entao roda UMA vez por pacote e fica em cache no state:
  // e o que faz o auto-fit medir o desenho em vez da moldura transparente.
  state.alphaBoxes = computeAlphaBoxes(state.images, (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });

  // Caminho principal: .unitypackage -> .prefab (YAML texto) -> AnimationClip.
  // Alguns pacotes mais antigos da Craftpix (Unity ~2017, ex: Archer Guy,
  // Medieval Mage, Barbarian Warrior, Pumpkin Head Guy) exportam o .prefab
  // serializado em BINARIO -- unity-yaml.js so entende texto, entao esse
  // caminho volta com 0 ossos/0 clips, silenciosamente (o personagem "nao
  // monta nem anima" sem erro nenhum na tela). O .scml e sempre XML texto e
  // tem as animacoes completas (src/scml-rig.js, ja validado); cai pra ele
  // quando o caminho do Unity nao rende nada.
  log(`Extraindo ${path.basename(detected.unitypackagePath)}...`);
  state.poseSource = 'unity';
  state.rig = null;
  try {
    const pkg = await extractUnityPackage(detected.unitypackagePath);
    const prefabGuid = pkg.findGuidByPathnameSuffix('.prefab');
    if (!prefabGuid) throw new Error('sem .prefab no .unitypackage');
    const unityRig = buildRig(pkg.readAsset(prefabGuid), pkg.guidToPathname);
    if (unityRig.bones.size === 0 || unityRig.clips.length === 0) throw new Error('.prefab sem ossos/clips (provavelmente binario)');
    state.rig = unityRig;
  } catch (err) {
    log(`Caminho do Unity nao rendeu (${err.message}) -- usando o .scml direto.`, 'warn');
  }

  if (!state.rig) {
    state.poseSource = 'scml';
    const scmlClips = clipsFromScml(parsedScml.entities[0]);
    // bones "de mentirinha": so o suficiente pra alimentar o painel de
    // camadas/hit-test/follow-bone, que esperam Map<nome, {name, sprite}>.
    // Amostra o primeiro clip em t=0 -- todas as animacoes do mesmo entity
    // compartilham as mesmas timelines de sprite, entao qualquer uma revela
    // as pecas todas.
    const samplePose = scmlClips.length ? computeScmlPose(scmlClips[0].animation, 0) : [];
    const pseudoBones = new Map(samplePose.map((item) => [item.boneName, { name: item.boneName, sprite: item.sprite }]));
    state.rig = { clips: scmlClips, bones: pseudoBones };
    log('Fonte da animacao: .scml direto (prefab binario). Amortecimento de balanco (Damp X/Y/Angulo) ainda nao tem efeito nesse modo.', 'warn');
  }

  document.getElementById('pack-info').textContent =
    `${displayLabel} - ${state.rig.clips.length} animacoes, ${state.images.size} PNGs` +
    (state.imagesBack.size ? `, ${state.imagesBack.size} PNGs de costas` : '');
  document.getElementById('config-section').style.display = 'block';
  document.getElementById('preview-block').style.display = 'block';

  // O toggle de preview East/North so faz sentido mostrar quando ha arte de
  // costas de verdade pra olhar -- sem isso, north e sempre identico a east.
  state.previewRow = 'east';
  document.getElementById('preview-sel-row').value = 'east';
  document.getElementById('preview-chk-side').checked = state.imagesBack.size > 0;
  updateRowControls();

  const clipNames = state.rig.clips.map((c) => c.name).filter((n) => n !== 'Base');
  const optionsHtml = clipNames.map((n) => `<option value="${n}">${n}</option>`).join('');
  document.getElementById('sel-anim-idle').innerHTML = optionsHtml;
  document.getElementById('sel-anim-walk').innerHTML = '<option value="">(nenhuma)</option>' + optionsHtml;
  document.getElementById('sel-anim-north').innerHTML = '<option value="">(usa a mesma pose de EAST)</option>' + optionsHtml;

  if (clipNames.includes(DEFAULT_ANIMATION_MAP.idle)) document.getElementById('sel-anim-idle').value = DEFAULT_ANIMATION_MAP.idle;
  if (clipNames.includes(DEFAULT_ANIMATION_MAP.walk)) document.getElementById('sel-anim-walk').value = DEFAULT_ANIMATION_MAP.walk;

  // "Ver:" do preview lista todos os clips (nao so os dois que vao pro bake),
  // porque e nos de ataque que arma/FX ficam visiveis.
  const previewSel = document.getElementById('preview-sel-anim');
  previewSel.innerHTML = clipNames.map((n) => `<option value="${n}">Ver: ${n}</option>`).join('');
  previewSel.value = document.getElementById('sel-anim-idle').value;

  // Nome do personagem: quem chamou (onPickPack/onPickTemplate) ja decidiu o
  // valor certo pro campo antes de chegar aqui -- pasta externa usa o nome
  // da pasta, template embutido comeca vazio (o usuario digita).
  applyRigProfileIfKnown();

  // Personagem com arte de costas ja nasce com a profundidade do NORTH
  // espelhada -- e o que se quer em 100% dos casos, e antes disso a vista de
  // costas abria com a ordem da frente (escudo/braco por cima do corpo).
  // So quando o NORTH ainda nao tem ajuste nenhum: se o perfil trouxe algo
  // salvo, a ordem e do usuario e nao pode ser sobrescrita. O botao continua
  // ali pra reaplicar, e o Ctrl+Z nao desfaz isso (e o estado inicial).
  if (state.imagesBack.size && state.partOffsetsByRow.north.size === 0) {
    applyBackViewDepth(state.partOffsetsByRow.north);
    log('Vista de costas: profundidade das camadas ja espelhada automaticamente.', 'ok');
  }

  applyAutoFitScale();
  onPreviewTime();
  renderLayersList();
  renderTemplatePartsList();
}

// Reduz (nunca aumenta) a "Escala do personagem dentro da celula" o quanto
// for preciso pra o personagem caber no tamanho de saida escolhido com 8px
// de margem em cada lado, amostrando o alcance real do clip de Idle (bracos/
// cabeca se movem, um frameso nao basta). Roda ao carregar o personagem e ao
// trocar o tamanho -- a escala e diferente por tamanho porque a arte tem
// dimensao fixa em pixels e as celulas 1x1/2x2/3x3 nao.
// force=true ignora a escala salva do personagem -- e o caso de quando o
// usuario troca o TAMANHO da celula, porque a escala que cabia em 2x2 nao
// cabe em 1x1.
function applyAutoFitScale(force = false) {
  if (!state.rig) return;
  if (!force && state.savedScale) return; // escala calibrada a mao pelo usuario tem prioridade
  const cfg = readConfig();
  if (!cfg.idleClip) return;
  const cell = cellSpecFor(cfg.size);
  // Uniao do alcance de TODOS os clips que vao ser bakeados, nao so do Idle:
  // o Walk costuma abrir mais os bracos/pernas, e uma escala calculada so
  // pelo Idle deixa o walk.webp cortado na celula.
  const clips = [cfg.idleClip, cfg.walkClip].filter(Boolean);
  const bounds = clips
    .map((clip) => computeBoundsFn(clip))
    .reduce((acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      maxX: Math.max(acc.maxX, b.maxX),
      minY: Math.min(acc.minY, b.minY),
      maxY: Math.max(acc.maxY, b.maxY),
    }));
  const scale = fitScaleForBounds(bounds, cell, 8);
  document.getElementById('num-scale').value = scale.toFixed(3);
}

function applyRigProfileIfKnown() {
  const { rigId } = computeRigFingerprint(state.rig);
  state.rigId = rigId;
  const rigBanner = document.getElementById('rig-banner');

  const characterName = toKebabCase(document.getElementById('txt-character-name').value);
  const sig = `<code>${rigId.slice(0, 8)}</code>`;

  // Ponto de partida limpo, sobrescrito abaixo so pelo que for legitimamente
  // herdavel.
  document.getElementById('sel-size').value = DEFAULT_SIZE;
  document.getElementById('num-offset-x').value = 0;
  document.getElementById('num-offset-y').value = 0;

  const profile = profileStore.read(rigId);
  if (!profile) {
    banner(
      rigBanner,
      'warn',
      `Rig novo (assinatura ${sig}) -- toda a serie Chibi da Craftpix compartilha este esqueleto, entao o formato de saida que voce escolher aqui ja vem pronto nos proximos personagens dela.`
    );
    return;
  }

  // NIVEL ESQUELETO: formato de saida, valido pra serie inteira.
  if (profile.size) document.getElementById('sel-size').value = profile.size;
  if (profile.framesIdle) document.getElementById('num-frames-idle').value = profile.framesIdle;
  if (profile.framesWalk) document.getElementById('num-frames-walk').value = profile.framesWalk;
  document.getElementById('chk-has-north').checked = !!profile.hasNorthView;
  document.getElementById('sel-anim-north').disabled = !profile.hasNorthView;

  // NIVEL PERSONAGEM: so os ajustes DELE PROPRIO. Os de outro personagem
  // ficam atras de um botao, nunca aplicados por conta propria -- ver o
  // comentario grande em src/rig-profile.js.
  const mine = profile.characters[characterName];
  const notes = [];

  if (mine) {
    state.partOffsetsByRow = {
      east: new Map(Object.entries(mine.partOffsets || {})),
      north: new Map(Object.entries(mine.partOffsetsNorth || {})),
    };
    if (mine.scale) {
      state.savedScale = mine.scale;
      document.getElementById('num-scale').value = mine.scale;
    }
    document.getElementById('num-offset-x').value = mine.offsetX || 0;
    document.getElementById('num-offset-y').value = mine.offsetY || 0;
    notes.push(`Ajustes manuais de <b>${characterName}</b> restaurados.`);
  }

  if (profile.migratedFromV1 && profile.droppedPartOffsets) {
    notes.push(
      `Descartei ${profile.droppedPartOffsets} ajustes manuais antigos deste esqueleto: foram gravados na epoca do bug de pivo e eram compensacoes dele, entao reaplicar hoje desmontaria o personagem.`
    );
  }

  banner(rigBanner, 'ok', `Rig conhecido (assinatura ${sig}). Formato de saida herdado da serie. ${notes.join(' ')}`);

  const others = Object.keys(profile.characters).filter((n) => n !== characterName);
  if (others.length) {
    const opts = others.map((n) => `<option value="${n}">${n}</option>`).join('');
    const offer = document.createElement('div');
    offer.className = 'banner warn';
    offer.innerHTML =
      `Outros personagens deste esqueleto tem ajuste manual salvo. Copiar de ` +
      `<select id="sel-copy-from" style="width:auto; display:inline-block;">${opts}</select> ` +
      `<button id="btn-copy-offsets" class="secondary" style="padding:4px 8px;">Copiar</button>` +
      `<div style="margin-top:4px; opacity:.8;">So vale a pena se a arte for a mesma -- por padrao cada personagem comeca sem ajuste nenhum.</div>`;
    rigBanner.appendChild(offer);
    document.getElementById('btn-copy-offsets').addEventListener('click', () => {
      const from = document.getElementById('sel-copy-from').value;
      const source = profile.characters[from];
      if (!source) return;
      pushUndo();
      state.partOffsetsByRow = {
        east: new Map(Object.entries(source.partOffsets || {})),
        north: new Map(Object.entries(source.partOffsetsNorth || {})),
      };
      selectPart(null);
      onPreviewTime();
      log(`Ajustes manuais de "${from}" copiados para este personagem.`, 'warn');
    });
  }
}

// Amostra a pose de um clip no tempo t, sem quem chama precisar saber se ela
// vem do .unitypackage (unity-skeleton) ou direto do .scml (scml-rig,
// fallback pra .prefab binario -- ver loadFromDetected). As duas devolvem o
// mesmo formato de item, entao drawPose/applyManualOverrides/bakeGrid
// funcionam identicos dali pra frente.
function computePoseFn(clip, t, offsets = state.partOffsets) {
  if (state.poseSource === 'scml') return computeScmlPose(clip.animation, t);
  return computePose(state.rig, clip, t, state.zIndexByName, offsets);
}

function computeBoundsFn(clip) {
  if (state.poseSource === 'scml') return computeScmlBounds(clip, state.pivots);
  return computeAnimatedBounds(state.rig, clip, state.pivots, state.partOffsets, state.alphaBoxes);
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

// hasArt da linha NORTH agora reflete se existe ARTE de costas de verdade
// (state.imagesBack), nao mais o checkbox "Pacote tem view de costas" --
// esse checkbox e o select ao lado continuam servindo pra escolher uma
// ANIMACAO diferente pra north (raro, mas alguns clips tem uma variante "de
// costas"), independente de ter arte propria ou nao. Sem arte de costas, uma
// clip diferente sozinha nao ajuda -- e por isso que so a arte liga o hasArt.
function rowsFor(cfg, kind) {
  const eastClip = kind === 'idle' ? cfg.idleClip : cfg.walkClip;
  const hasBackArt = state.imagesBack.size > 0;
  const northClip = (cfg.hasNorthView && cfg.northClip) || eastClip;
  return [
    {
      row: 'north',
      clip: northClip,
      hasArt: hasBackArt,
      images: hasBackArt ? mergeImagesForRow(state.images, state.imagesBack) : undefined,
      // sem arte de costas a linha e so a pose de EAST -> usa os ajustes de EAST
      partOffsets: hasBackArt ? state.partOffsetsByRow.north : state.partOffsetsByRow.east,
    },
    { row: 'east', clip: eastClip, hasArt: true, partOffsets: state.partOffsetsByRow.east },
  ];
}

// Qual clip o preview esta mostrando. Antes era sempre o Idle, e por isso
// trocar o "Walk (opcional)" no mapeamento nao mudava nada na tela -- ele so
// aparecia no .webp bakeado. O seletor "Ver:" lista TODOS os clips do rig,
// nao so idle/walk: arma e SlashFX so tem alpha > 0 nos clips de ataque, e
// e olhando o Slashing que da pra conferir a arte de arma nova.
function previewBaseClip(cfg) {
  const want = document.getElementById('preview-sel-anim').value;
  const byName = state.rig && state.rig.clips.find((c) => c.name === want);
  return byName || cfg.idleClip;
}

// Seletor "Editando" e "Lado a lado" so aparecem quando existe arte de costas.
function updateRowControls() {
  const has = state.imagesBack.size > 0;
  document.getElementById('preview-sel-row').style.display = has ? '' : 'none';
  document.getElementById('preview-side-label').style.display = has ? '' : 'none';
  if (!has && state.previewRow === 'north') {
    state.previewRow = 'east';
    document.getElementById('preview-sel-row').value = 'east';
  }
}

// Troca a vista que os controles (arrastar, camadas, pivo, arte) editam.
function setEditingRow(row) {
  if (state.previewRow === row) return;
  state.previewRow = row;
  document.getElementById('preview-sel-row').value = row;
  selectPart(null);
  renderLayersList();
  renderTemplatePartsList();
}

function onPreviewTime() {
  if (!state.rig) return;
  const cfg = readConfig();
  const baseClip = previewBaseClip(cfg);
  if (!baseClip) return;
  const slider = document.getElementById('preview-time');
  slider.max = baseClip.length || 1;
  const clampedT = Math.min(parseFloat(slider.value), baseClip.length);
  document.getElementById('preview-time-label').textContent = `${clampedT.toFixed(2)}s / ${baseClip.length.toFixed(2)}s`;

  // Com arte de costas, da pra ver NORTH (esquerda) e EAST (direita) juntos.
  // A vista ativa (state.previewRow) e a que os controles editam e e sempre
  // desenhada POR ULTIMO -- state.lastPose/lastOrigin/lastCfg (usados pelo
  // hit-test do mouse) ficam sendo dela.
  const hasNorth = state.imagesBack.size > 0;
  const side = hasNorth && document.getElementById('preview-chk-side').checked;
  const active = hasNorth && state.previewRow === 'north' ? 'north' : 'east';
  const shown = side ? ['north', 'east'] : [active];
  const canvasNorth = document.getElementById('preview-canvas-north');
  const canvasEast = document.getElementById('preview-canvas');
  canvasNorth.style.display = shown.includes('north') ? '' : 'none';
  canvasEast.style.display = shown.includes('east') ? '' : 'none';
  canvasNorth.classList.toggle('active-row', side && active === 'north');
  canvasEast.classList.toggle('active-row', side && active === 'east');
  for (const r of [...shown.filter((x) => x !== active), active]) {
    drawRow(r === 'north' ? canvasNorth : canvasEast, r, cfg, baseClip, clampedT, active);
  }
}

// Desenha UMA vista (north ou east) num canvas de preview.
function drawRow(canvas, row, cfg, baseClip, clampedT, active) {
  // O canvas de preview usa exatamente as mesmas dimensoes e a mesma linha
  // do chao (groundLineY) que o bake de verdade (src/baker.js), assim o que
  // se ve aqui e o que sai no .webp -- antes o preview usava canvas.height*0.85
  // como aproximacao e ficava um pouco fora do lugar em relacao ao bake real.
  const cell = cellSpecFor(cfg.size);
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
    // Escala uniforme (mesmo fator nos dois eixos) pra nao distorcer a
    // proporcao original da imagem -- centralizada na celula, com
    // deslocamento manual por cima (ver fitReferenceToCell/ref-offset-*).
    const img = state.referenceImage;
    const rw = img.width * state.refScale;
    const rh = img.height * state.refScale;
    const rx = (cell.w - rw) / 2 + state.refOffsetX;
    const ry = (cell.h - rh) / 2 + state.refOffsetY;
    ctx.save();
    ctx.globalAlpha = parseFloat(document.getElementById('ref-opacity').value) || 0.6;
    ctx.drawImage(img, rx, ry, rw, rh);
    ctx.restore();
  }

  // previewRow so troca a POSE (clip) e a ARTE mostradas na tela -- o bake
  // sempre desenha as duas linhas (north e east) de qualquer forma. Existe
  // so pra dar pra conferir o alinhamento da arte de costas ANTES de bakear
  // 8 frames as cegas.
  const isNorth = row === 'north';
  const offsets = state.partOffsetsByRow[row];
  const previewClip = isNorth ? (cfg.hasNorthView && cfg.northClip) || baseClip : baseClip;
  const previewImages = isNorth ? mergeImagesForRow(state.images, state.imagesBack) : state.images;

  const rawPose = computePoseFn(previewClip, clampedT, offsets);
  let pose = applyManualOverrides(rawPose, offsets);

  // "Ocultas": arma e SlashFX ficam com alpha 0 fora dos clips de ataque (o
  // prefab grava 0 no bind e quem acende e uma curva de m_Color.a). Sem isso
  // nao da pra trocar/posicionar a arte de uma arma olhando o Idle -- a peca
  // simplesmente nao aparece. So afeta o PREVIEW; o bake continua respeitando
  // o alpha real do clip.
  if (document.getElementById('preview-chk-show-hidden').checked) {
    pose = pose.map((item) => (item.alpha > 0 ? item : { ...item, alpha: 0.35 }));
  }
  const origin = { x: cell.bodyAxisX + cfg.offsetX, y: cell.groundLineY + cfg.offsetY };
  // A escala vai pelo proprio drawPose (que escala posicao E sprite juntos),
  // exatamente como o bakeGrid faz -- assim preview e bake percorrem o mesmo
  // caminho e nao tem como divergirem.
  ctx.save();
  drawPose(ctx, pose, previewImages, state.pivots, origin, cfg.scale, row === active ? state.multiSel : null);
  ctx.restore();

  // Guias do padrao VTT, em espaco de pixel BRUTO da celula -- nao entram no
  // ctx.scale(cfg.scale) porque representam a geometria fixa da celula, nao
  // algo que encolhe junto com o personagem. Espelha a folha de padroes em
  // https://isometric-tactics.pages.dev/desktop/pages/standards :
  // limite da celula, losango do piso, eixo do corpo, linha do chao e a
  // altura util (do topo ate a linha do chao).
  if (document.getElementById('preview-chk-guides').checked) {
    ctx.save();

    // 1. Limite da celula -- o recorte real do frame no spritesheet. Meio
    // pixel de deslocamento pra linha de 1px cair inteira dentro do canvas
    // em vez de ser cortada pela metade nas bordas.
    ctx.strokeStyle = '#6b6b6b';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cell.w - 2, cell.h - 2);

    // 2. Losango do piso: a projecao isometrica de UM tile no chao, centrado
    // no cruzamento do eixo do corpo com a linha do chao. Largura = a celula
    // inteira, altura = metade (proporcao 2:1 do isometrico do VTT).
    const dw = cell.w / 2;
    const dh = cell.w / 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cell.bodyAxisX, cell.groundLineY - dh);
    ctx.lineTo(cell.bodyAxisX + dw, cell.groundLineY);
    ctx.lineTo(cell.bodyAxisX, cell.groundLineY + dh);
    ctx.lineTo(cell.bodyAxisX - dw, cell.groundLineY);
    ctx.closePath();
    ctx.stroke();

    // 3. Eixo do corpo (tracejado azul).
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cell.bodyAxisX, 0);
    ctx.lineTo(cell.bodyAxisX, cell.h);
    ctx.stroke();

    // 4. Linha do chao (vermelha, continua).
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cell.groundLineY);
    ctx.lineTo(cell.w, cell.groundLineY);
    ctx.stroke();

    // 5. Rotulos. Tamanho de fonte preso ao zoom pra continuarem legiveis
    // quando a celula 1x1 (256px) e desenhada pequena, sem virar tapume
    // quando a 3x3 (768px) e desenhada grande.
    const fs = Math.max(9, Math.round(cell.w / 26));
    ctx.setLineDash([]);
    ctx.font = `${fs}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ff3b30';
    ctx.fillText(`ground y=${cell.groundLineY}`, 6, cell.groundLineY + 4);
    ctx.fillStyle = '#5b8cff';
    ctx.fillText(`axis x=${cell.bodyAxisX}`, cell.bodyAxisX + 5, cell.groundLineY - fs - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const usable = `altura util ${cell.groundLineY - 4} px`;
    ctx.fillText(usable, cell.w - ctx.measureText(usable).width - 6, cell.groundLineY + 4);
    ctx.fillText(`${cell.w}x${cell.h}`, 6, 6);

    ctx.restore();
  }

  state.lastPose = pose;
  state.lastOrigin = origin;
  state.lastCfg = cfg;
}

// ---- Desfazer / refazer (Ctrl+Z / Ctrl+Y ou Ctrl+Shift+Z) -----------------
// Guarda so os AJUSTES DE PECA das duas vistas (posicao, angulo, pivo,
// z-order, seguir, amortecimento). Troca de arte nao entra: ela nao e
// "ajuste" e recarregar a peca do disco ja e o desfazer dela.
const UNDO_LIMIT = 100;
let lastUndoKey = null;
let lastUndoAt = 0;

function cloneOffsetMap(m) {
  return new Map([...m].map(([k, v]) => [k, { ...v }]));
}
function snapshotOffsets() {
  return { east: cloneOffsetMap(state.partOffsetsByRow.east), north: cloneOffsetMap(state.partOffsetsByRow.north) };
}

// Chamar ANTES de mudar os ajustes. `key` agrupa mudancas em sequencia (ex:
// digitar num campo numerico) numa unica entrada de desfazer.
function pushUndo(key = null) {
  const now = Date.now();
  if (key && key === lastUndoKey && now - lastUndoAt < 1000) {
    lastUndoAt = now;
    return;
  }
  lastUndoKey = key;
  lastUndoAt = now;
  state.undoStack.push(snapshotOffsets());
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}

function restoreSnapshot(snap) {
  state.partOffsetsByRow = { east: cloneOffsetMap(snap.east), north: cloneOffsetMap(snap.north) };
  lastUndoKey = null;
  const keep = new Set(state.multiSel);
  selectPart(state.selectedBone); // reatualiza campos + camadas
  state.multiSel = keep;
  renderLayersList();
  onPreviewTime();
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshotOffsets());
  restoreSnapshot(state.undoStack.pop());
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshotOffsets());
  restoreSnapshot(state.redoStack.pop());
}

// ---- Selecao multipla (Shift) ------------------------------------------------
// Shift+clique (no preview ou na lista de camadas) soma/tira uma peca da
// selecao. Arrastar com varias selecionadas move TODAS pelo mesmo deslocamento
// -- a distancia entre elas nao muda, entao nao saem do eixo.
function toggleMultiSelect(boneName) {
  const set = new Set(state.multiSel);
  if (state.selectedBone) set.add(state.selectedBone);
  if (set.has(boneName) && set.size > 1) set.delete(boneName);
  else set.add(boneName);
  const primary = set.has(boneName) ? boneName : [...set][0];
  selectPart(primary);
  state.multiSel = set;
  renderLayersList();
}

// Uma peca que SEGUE outra selecionada ja se move junto com ela (followBone
// soma o delta do pai) -- mexer nas duas contaria o deslocamento em dobro.
function followsAnyIn(boneName, set) {
  const seen = new Set();
  let cur = (state.partOffsets.get(boneName) || {}).followBone;
  while (cur && !seen.has(cur)) {
    if (set.has(cur)) return true;
    seen.add(cur);
    cur = (state.partOffsets.get(cur) || {}).followBone;
  }
  return false;
}

function selectPart(boneName) {
  state.selectedBone = boneName;
  state.multiSel = new Set(boneName ? [boneName] : []);
  document.getElementById('sel-part-name').textContent = boneName || '(nenhuma peca selecionada)';
  const o = state.partOffsets.get(boneName) || { dx: 0, dy: 0, dangle: 0 };
  document.getElementById('part-offset-x').value = o.dx || 0;
  document.getElementById('part-offset-y').value = o.dy || 0;
  document.getElementById('part-offset-angle').value = o.dangle || 0;

  const bone = boneName && [...state.rig.bones.values()].find((b) => b.name === boneName);
  const filePivot = bone && bone.sprite && state.pivots.get(bone.sprite.pngName);
  document.getElementById('part-pivot-x').value = o.pivotX !== undefined ? o.pivotX : filePivot ? filePivot.pivotX : 0;
  document.getElementById('part-pivot-y').value = o.pivotY !== undefined ? o.pivotY : filePivot ? filePivot.pivotY : 1;
  document.getElementById('part-scale-x').value = Math.round((o.scaleX ?? 1) * 100);
  document.getElementById('part-scale-y').value = Math.round((o.scaleY ?? 1) * 100);

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
  // No modo .scml (fallback de prefab binario) nao existe hierarquia de
  // ossos-junta nem curvas Unity pra procurar -- findAnimatedAncestorName
  // le clip.positionCurves/bone.path, que so o rig do Unity tem.
  const dampBone =
    boneName && cfg.idleClip && state.poseSource === 'unity'
      ? findAnimatedAncestorName(state.rig, cfg.idleClip, boneName)
      : boneName;
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
function currentLayers(offsets = state.partOffsets) {
  const bones = [...state.rig.bones.values()].filter((b) => b.sprite && b.sprite.pngName);
  return bones
    .map((b) => {
      const o = offsets.get(b.name);
      const z = o && o.zIndex !== undefined ? o.zIndex : state.zIndexByName.get(b.name) ?? b.sprite.sortingOrder ?? 0;
      return { boneName: b.name, z };
    })
    .sort((a, b) => a.z - b.z);
}

function renderLayersList() {
  if (!state.rig) return;
  const mirrorBtn = document.getElementById('btn-mirror-depth');
  mirrorBtn.style.display = state.previewRow === 'north' && state.imagesBack.size ? '' : 'none';
  const layers = currentLayers();
  const el = document.getElementById('layers-list');
  el.innerHTML = '';
  // de cima (frente) pra baixo (fundo) na lista, como no Photoshop
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const row = document.createElement('div');
    row.className = 'layer-row' + (state.multiSel.has(layer.boneName) ? ' selected' : '');
    row.draggable = true;

    // A mesma linha serve de camada E de peca: quando a fonte e um template
    // embutido, ela tambem troca a ARTE dessa peca (a lista separada de
    // "Pecas do template" so sobrou pras variantes que nenhum osso usa).
    const bone = [...state.rig.bones.values()].find((b) => b.name === layer.boneName);
    const pngName = bone && bone.sprite ? bone.sprite.pngName : null;
    const isCustom = pngName && artOverridesForView().has(pngName);
    const canSwap = !!(state.artSourceDir && pngName);

    row.innerHTML =
      `<span class="layer-handle">&#8942;&#8942;</span>` +
      `<span class="layer-name">${layer.boneName}` +
      (pngName ? `<span class="layer-file">${pngName}${isCustom ? ' (sua arte)' : ''}</span>` : '') +
      `</span>` +
      (canSwap ? `<button class="layer-btn" data-action="load" title="Trocar a arte desta peca">Arte</button>` : '') +
      (canSwap && isCustom ? `<button class="layer-btn" data-action="reset" title="Voltar pra arte default do template">&#8634;</button>` : '');

    row.querySelector('.layer-name').addEventListener('click', (ev) => {
      if (ev.shiftKey) toggleMultiSelect(layer.boneName);
      else selectPart(layer.boneName);
    });
    const loadBtn = row.querySelector('[data-action="load"]');
    if (loadBtn) loadBtn.addEventListener('click', (ev) => { ev.stopPropagation(); onSwapPartArt(pngName); });
    const resetBtn = row.querySelector('[data-action="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', (ev) => { ev.stopPropagation(); onResetPartArt(pngName); });
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

// De costas, a profundidade inverte: o que estava ENTRE a camera e o corpo
// (braco/mao do lado de ca, escudo) passa pra tras dele, e o que estava
// escondido atras (o outro braco, a espada) vem pra frente. Cabeca e rosto
// sao excecao -- ficam em cima do corpo nas duas vistas, porque nao estao
// atras dele em profundidade, so por cima na vertical.
//
// So mexe nos zIndex da vista de COSTAS (state.partOffsets ja aponta pra ela
// quando NORTH esta em edicao), entao o EAST nao muda. Ctrl+Z desfaz.
function backViewDepthOrder(layers) {
  const isHeadish = (n) => /^(head|face)/i.test(n);
  const isLeg = (n) => /leg/i.test(n);
  const bodyIdx = layers.findIndex((n) => /^body/i.test(n));
  let ordered;
  if (bodyIdx === -1) {
    ordered = [...layers.filter((n) => !isHeadish(n)).reverse(), ...layers.filter(isHeadish)];
  } else {
    const body = layers[bodyIdx];
    const movable = (n) => !isHeadish(n) && !isLeg(n) && n !== body;
    // O que estava ATRAS do corpo vem pra frente e vice-versa, cada bloco
    // (braco + mao + o que ela segura) trocando de lado inteiro.
    //
    // Dentro do bloco, o que e SEGURADO vai pro fundo: de costas o membro
    // fica entre a camera e o objeto. De frente o escudo cobre o braco (a
    // face dele aponta pra camera); de costas e o braco que cobre o escudo.
    // Vale pra arma tambem -- a mao aparece por cima do punho.
    const isHeldItem = (n) => !/\b(arm|hand|leg|foot|body|torso|hip|neck|head|face)\b/i.test(n);
    const itemsToBack = (block) => [...block.filter(isHeldItem), ...block.filter((n) => !isHeldItem(n))];
    const wasBehind = itemsToBack(layers.slice(0, bodyIdx).filter(movable));
    const wasInFront = itemsToBack(layers.slice(bodyIdx + 1).filter(movable));
    // pernas trocam de lado entre si, mas continuam ATRAS do corpo: elas nao
    // estao atras dele em profundidade, so por baixo na vertical (a saia do
    // corpo cobre o topo das pernas tanto de frente quanto de costas)
    const legs = layers.filter(isLeg).reverse();
    ordered = [...wasInFront, ...legs, body, ...layers.filter(isHeadish), ...wasBehind];
  }
  return ordered;
}

// Grava a ordem espelhada como zIndex explicito no mapa de ajustes de `offsets`.
function applyBackViewDepth(offsets) {
  const ordered = backViewDepthOrder(currentLayers(offsets).map((l) => l.boneName));
  ordered.forEach((name, i) => {
    offsets.set(name, { ...(offsets.get(name) || {}), zIndex: i });
  });
}

function mirrorDepthForBackView() {
  pushUndo();
  applyBackViewDepth(state.partOffsets);
  renderLayersList();
  onPreviewTime();
  log('Ordem de camadas do NORTH espelhada em profundidade (o EAST nao mudou).', 'ok');
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
  pushUndo();
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
    if (!pivot || (item.alpha !== undefined ? item.alpha : item.sprite.alpha) <= 0) continue;
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
    const offsetY = -(1 - pivot.pivotY) * h; // mesma convencao do drawPose -- ver unity-skeleton.js
    // mesma escala/flip que o drawPose aplica, senao a area clicavel de uma
    // peca redimensionada fica do tamanho antigo
    const sx = item.world.scaleX * (item.sprite.flipX ? -1 : 1) || 1;
    const sy = item.world.scaleY * (item.sprite.flipY ? -1 : 1) || 1;
    const x0 = Math.min(offsetX * sx, (offsetX + w) * sx);
    const x1 = Math.max(offsetX * sx, (offsetX + w) * sx);
    const y0 = Math.min(offsetY * sy, (offsetY + h) * sy);
    const y1 = Math.max(offsetY * sy, (offsetY + h) * sy);
    if (localX >= x0 && localX <= x1 && localY >= y0 && localY <= y1) {
      return item.boneName;
    }
  }
  return null;
}

function canvasEventToLocalCraftpix(e) {
  const canvas = e.currentTarget && e.currentTarget.tagName === 'CANVAS' ? e.currentTarget : dragCanvas || document.getElementById('preview-canvas');
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
let dragCanvas = null; // canvas onde o arrasto comecou (o mousemove vem da window)

function onPreviewCanvasMouseDown(e) {
  // Clicar na vista que NAO e a ativa so passa a edita-la (e redesenha, pra
  // lastPose/lastOrigin passarem a ser dela) -- o hit-test roda ja nela.
  const row = e.currentTarget.dataset.row === 'north' ? 'north' : 'east';
  if (row !== state.previewRow) {
    setEditingRow(row);
    onPreviewTime();
  }
  dragCanvas = e.currentTarget;
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
  let shiftToggle = null;
  if (e.shiftKey) {
    // Shift so soma/tira pecas da selecao; clicar no vazio nao desmarca nada.
    if (!hit) return;
    if (!state.selectedBone) selectPart(hit);
    else if (state.multiSel.has(hit)) shiftToggle = hit; // tira no mouseup, se nao arrastou
    else toggleMultiSelect(hit);
  } else if (!state.selectedBone) {
    if (!hit) return;
    selectPart(hit);
  } else if (!hit) {
    // clicou fora de qualquer peca (canvas vazio) -- desmarca em vez de
    // arrastar as cegas a selecao atual pra um lugar aleatorio.
    selectPart(null);
    onPreviewTime();
    return;
  }

  dragCanvas.classList.add('dragging');
  const group = [...state.multiSel].filter((n) => !followsAnyIn(n, state.multiSel));
  state.drag = {
    startX: x,
    startY: y,
    starts: new Map(group.map((n) => [n, { ...(state.partOffsets.get(n) || { dx: 0, dy: 0, dangle: 0 }) }])),
    moved: false,
    shiftToggle,
  };
  onPreviewTime();
}

function onPreviewCanvasMouseMove(e) {
  if (!state.drag) return;
  const { x, y } = canvasEventToLocalCraftpix(e);
  const dx = x - state.drag.startX;
  const dy = y - state.drag.startY;
  if (!state.drag.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 1) return; // clique parado nao vira arrasto
    state.drag.moved = true;
    pushUndo();
  }
  for (const [name, start] of state.drag.starts) {
    state.partOffsets.set(name, { ...start, dx: (start.dx || 0) + dx, dy: (start.dy || 0) - dy });
  }
  const o = state.partOffsets.get(state.selectedBone);
  if (o) {
    document.getElementById('part-offset-x').value = (o.dx || 0).toFixed(1);
    document.getElementById('part-offset-y').value = (o.dy || 0).toFixed(1);
  }
  onPreviewTime();
}

function onPreviewCanvasMouseUp() {
  const d = state.drag;
  state.drag = null;
  if (d && d.shiftToggle && !d.moved) {
    // Shift+clique numa peca ja selecionada, sem arrastar: tira ela do grupo.
    toggleMultiSelect(d.shiftToggle);
    onPreviewTime();
  }
  if (dragCanvas) dragCanvas.classList.remove('dragging');
  dragCanvas = null;
}

function clampPercent01(elId) {
  return Math.min(1, Math.max(0, (parseFloat(document.getElementById(elId).value) || 0) / 100));
}

// Muda quem esta peca segue, preservando a posicao VISUAL atual (converte
// pra absoluto somando o pai antigo, depois subtrai o pai novo) -- assim
// ligar/trocar o "seguir" nao teleporta a peca, so muda o que ela acompanha
// dali em diante.
function setFollowBone(boneName, newFollow) {
  pushUndo();
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
  pushUndo('fields:' + state.selectedBone);
  const existing = state.partOffsets.get(state.selectedBone) || {};
  state.partOffsets.set(state.selectedBone, {
    ...existing,
    dx: parseFloat(document.getElementById('part-offset-x').value) || 0,
    dy: parseFloat(document.getElementById('part-offset-y').value) || 0,
    dangle: parseFloat(document.getElementById('part-offset-angle').value) || 0,
    pivotX: parseFloat(document.getElementById('part-pivot-x').value),
    pivotY: parseFloat(document.getElementById('part-pivot-y').value),
    scaleX: (parseFloat(document.getElementById('part-scale-x').value) || 100) / 100,
    scaleY: (parseFloat(document.getElementById('part-scale-y').value) || 100) / 100,
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
      computePoseFn,
      images: state.images,
      pivots: state.pivots,
      rows,
      frameCount: job.frames,
      size: cfg.size,
      scale: cfg.scale,
      originOffset: { x: cfg.offsetX, y: cfg.offsetY },
      partOffsets: state.partOffsetsByRow.east,
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

  // Formato de saida vai pro nivel do esqueleto (a serie inteira herda);
  // ajustes manuais ficam presos a ESTE personagem.
  profileStore.saveForCharacter(state.rigId, cfg.characterName, {
    size: cfg.size,
    framesIdle: cfg.framesIdle,
    framesWalk: cfg.framesWalk,
    hasNorthView: cfg.hasNorthView,
    scale: cfg.scale,
    offsetX: cfg.offsetX,
    offsetY: cfg.offsetY,
    partOffsets: Object.fromEntries(state.partOffsetsByRow.east),
    partOffsetsNorth: Object.fromEntries(state.partOffsetsByRow.north),
  });
  log(
    `Formato de saida salvo para o rig ${state.rigId.slice(0, 8)} (a serie herda); ajustes manuais salvos so para "${cfg.characterName}".`,
    'ok'
  );
}

// Lista de templates embutidos (templates/<id>/) fica pronta desde o
// carregamento da tela -- nao depende de nenhuma pasta ser selecionada.
(function initTemplateDropdown() {
  const sel = document.getElementById('sel-template');
  for (const t of listTemplates()) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    sel.appendChild(opt);
  }
})();

document.getElementById('btn-pick-pack').addEventListener('click', onPickPack);
document.getElementById('btn-pick-template').addEventListener('click', onPickTemplate);
document.getElementById('chk-has-north').addEventListener('change', (e) => {
  document.getElementById('sel-anim-north').disabled = !e.target.checked;
});
document.getElementById('sel-anim-idle').addEventListener('change', onPreviewTime);
document.getElementById('sel-anim-walk').addEventListener('change', () => {
  applyAutoFitScale(); // sem force -- so recalcula se o usuario ainda nao calibrou a mao
  onPreviewTime();
});
document.getElementById('preview-sel-anim').addEventListener('change', () => {
  document.getElementById('preview-time').value = 0;
  onPreviewTime();
});
document.getElementById('preview-chk-show-hidden').addEventListener('change', onPreviewTime);
document.getElementById('sel-size').addEventListener('change', () => {
  applyAutoFitScale(true); // celula mudou: reencaixa mesmo que houvesse escala salva
  onPreviewTime();
});
document.getElementById('preview-time').addEventListener('input', onPreviewTime);
document.getElementById('num-scale').addEventListener('input', () => {
  // Assim que o usuario mexe na escala, ela vira "calibrada a mao" na hora,
  // nao so depois de um bake -- antes disso, so entrava em state.savedScale
  // ao carregar um perfil ja salvo, entao qualquer coisa que rechamasse
  // applyAutoFitScale(true) no meio da sessao (trocar a arte de uma peca,
  // por exemplo) apagava o valor que o usuario acabou de digitar.
  state.savedScale = parseFloat(document.getElementById('num-scale').value) || null;
  onPreviewTime();
});
document.getElementById('num-offset-x').addEventListener('input', onPreviewTime);
document.getElementById('num-offset-y').addEventListener('input', onPreviewTime);
document.getElementById('btn-preview').addEventListener('click', onPreviewTime);
document.getElementById('btn-bake').addEventListener('click', onBakeClick);
document.getElementById('preview-sel-bg').addEventListener('change', (e) => {
  for (const id of ['preview-canvas', 'preview-canvas-north']) {
    const canvas = document.getElementById(id);
    canvas.classList.toggle('bg-checker', e.target.value === 'checker');
    canvas.classList.toggle('bg-dadada', e.target.value === 'dadada');
  }
});
document.getElementById('preview-chk-guides').addEventListener('change', onPreviewTime);
document.getElementById('preview-sel-row').addEventListener('change', (e) => {
  setEditingRow(e.target.value === 'north' ? 'north' : 'east');
  onPreviewTime();
});
document.getElementById('preview-chk-side').addEventListener('change', onPreviewTime);
document.getElementById('btn-mirror-depth').addEventListener('click', mirrorDepthForBackView);

// Encontra a escala que faz a referencia caber inteira dentro da celula sem
// distorcer a proporcao original (equivalente ao "contain" do CSS), depois
// centraliza -- e o ponto de partida; escala/deslocamento continuam
// ajustaveis a mao pelos campos ao lado.
function fitReferenceToCell() {
  if (!state.referenceImage) return;
  const cfg = readConfig();
  const cell = cellSpecFor(cfg.size);
  const img = state.referenceImage;
  state.refScale = Math.min(cell.w / img.width, cell.h / img.height);
  state.refOffsetX = 0;
  state.refOffsetY = 0;
  document.getElementById('ref-scale').value = state.refScale.toFixed(3);
  document.getElementById('ref-offset-x').value = 0;
  document.getElementById('ref-offset-y').value = 0;
}

document.getElementById('btn-load-reference').addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('select-reference-image');
  if (!filePath) return;
  const img = await loadImageAnyFormat(filePath);
  state.referenceImage = img;
  fitReferenceToCell();
  document.getElementById('btn-clear-reference').disabled = false;
  document.getElementById('reference-controls').style.display = 'flex';
  onPreviewTime();
});
document.getElementById('btn-clear-reference').addEventListener('click', (e) => {
  state.referenceImage = null;
  e.target.disabled = true;
  document.getElementById('reference-controls').style.display = 'none';
  onPreviewTime();
});
document.getElementById('ref-opacity').addEventListener('input', onPreviewTime);
document.getElementById('ref-scale').addEventListener('input', () => {
  state.refScale = parseFloat(document.getElementById('ref-scale').value) || 1;
  onPreviewTime();
});
document.getElementById('ref-offset-x').addEventListener('input', () => {
  state.refOffsetX = parseFloat(document.getElementById('ref-offset-x').value) || 0;
  onPreviewTime();
});
document.getElementById('ref-offset-y').addEventListener('input', () => {
  state.refOffsetY = parseFloat(document.getElementById('ref-offset-y').value) || 0;
  onPreviewTime();
});
document.getElementById('btn-ref-fit').addEventListener('click', () => {
  fitReferenceToCell();
  onPreviewTime();
});

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
// Com "Travar" ligado, mexer num eixo copia pro outro -- e o caso comum
// (peca inteira um pouco grande demais), e evita distorcer a arte sem querer.
function onScaleFieldInput(e) {
  if (document.getElementById('part-scale-lock').checked) {
    const other = e.target.id === 'part-scale-x' ? 'part-scale-y' : 'part-scale-x';
    document.getElementById(other).value = e.target.value;
  }
  applyOffsetFieldsToSelected();
}
document.getElementById('part-scale-x').addEventListener('input', onScaleFieldInput);
document.getElementById('part-scale-y').addEventListener('input', onScaleFieldInput);
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
  pushUndo();
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
const previewCanvasNorthEl = document.getElementById('preview-canvas-north');
previewCanvasNorthEl.addEventListener('mousedown', onPreviewCanvasMouseDown);
previewCanvasNorthEl.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', onPreviewCanvasMouseMove);
window.addEventListener('mouseup', onPreviewCanvasMouseUp);

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || !state.rig) return;
  if (document.getElementById('preview-block').style.display === 'none') return;
  const t = e.target;
  // nos campos de texto o Ctrl+Z nativo (desfazer digitacao) continua valendo
  if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && ['text', 'search'].includes(t.type)))) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

createPlayback({
  sliderEl: document.getElementById('preview-time'),
  loopCheckboxEl: document.getElementById('preview-chk-loop'),
  playButtonEl: document.getElementById('preview-btn-play'),
  getMax: () => {
    const cfg = readConfig();
    const clip = previewBaseClip(cfg);
    return clip ? clip.length : 1;
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
