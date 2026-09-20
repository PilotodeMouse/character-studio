// Abre o app de verdade (renderer/index.html), carrega um personagem sem
// precisar clicar em nada e salva screenshots da janela -- pra conferir o que
// o usuario ve, que pode diferir do que os scripts headless (node-canvas)
// mostram.
//
// Uso:
//   npx electron scripts/electron-shot.js "<pasta do personagem>" <saida-prefixo> [clip@t ...]
// Ex:
//   npx electron scripts/electron-shot.js "E:/.../Gnoll_1" scratch-gnoll Idle@0.3 Walking@0.4
//
// Cada "clip@t[@east|north]" escolhe o clip em "Ver:" e o instante (segundos) e gera
// <prefixo>-<clip>-<t>.png. Sem argumentos de clip, tira um unico print do
// estado logo apos carregar. O que o renderer escrever no console vai pro
// stdout (ver o forward de console-message).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const pack = process.argv[2];
const prefix = process.argv[3] || 'scratch-shot';
const shots = process.argv.slice(4);
if (!pack) {
  console.error('Uso: electron scripts/electron-shot.js "<pasta>" <prefixo> [clip@t ...]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Electron no Windows nao repassa stdout pro terminal de forma confiavel,
// entao tudo vai tambem pra um arquivo.
const LOG = 'scratch-shot.log';
fs.writeFileSync(LOG, '');
const _log = console.log;
console.log = (...a) => {
  const l = a.join(' ');
  fs.appendFileSync(LOG, l + '\n');
  _log(l);
};
process.on('uncaughtException', (e) => { console.log('ERRO:', e && e.stack || e); app.exit(1); });
process.on('unhandledRejection', (e) => { console.log('ERRO (promise):', e && e.stack || e); app.exit(1); });

app.whenReady().then(async () => {
  // Chromium cacheia os <script> file:// entre execucoes -- sem isso um teste
  // logo apos editar renderer/*.js roda o codigo ANTIGO e engana o diagnostico.
  await require('electron').session.defaultSession.clearCache();
  ipcMain.handle('select-pack-folder', async () => pack);
  ipcMain.handle('select-output-folder', async () => path.resolve('scratch-shot-out'));
  ipcMain.handle('select-reference-image', async () => null);
  ipcMain.handle('select-image-file', async () => null);

  const win = new BrowserWindow({
    width: 1500,
    height: 1000,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const label = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    if (/Electron Security Warning/.test(message)) return;
    console.log(`[renderer:${label}] ${message} (${path.basename(sourceId)}:${line})`);
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const js = (code) => win.webContents.executeJavaScript(code);
  const save = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(name, img.toPNG());
    console.log('screenshot:', name);
  };

  await js(`document.getElementById('btn-pick-pack').click()`);
  // extracao do .unitypackage + leitura das imagens leva um tempo
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ready = await js(`document.getElementById('config-section').style.display === 'block'`);
    if (ready) break;
  }
  await sleep(800);

  const info = await js(`JSON.stringify({
    pack: document.getElementById('pack-info').textContent,
    idle: document.getElementById('sel-anim-idle').value,
    walk: document.getElementById('sel-anim-walk').value,
    scale: document.getElementById('num-scale').value,
    size: document.getElementById('sel-size').value,
    log: [...document.querySelectorAll('#log li')].map(li => li.textContent).slice(0, 6),
  })`);
  console.log('estado:', info);

  if (!shots.length) {
    await save(`${prefix}.png`);
  }
  for (const s of shots) {
    const [clip, t, row] = s.split('@');
    await js(`(() => {
      const sel = document.getElementById('preview-sel-anim');
      sel.value = ${JSON.stringify(clip)};
      sel.dispatchEvent(new Event('change'));
      const rowSel = document.getElementById('preview-sel-row');
      rowSel.value = ${JSON.stringify(row || 'east')};
      rowSel.dispatchEvent(new Event('change'));
      const sl = document.getElementById('preview-time');
      sl.value = ${parseFloat(t) || 0};
      sl.dispatchEvent(new Event('input'));
    })()`);
    await sleep(400);
    await save(`${prefix}-${clip.replace(/ /g, '')}-${t}${row ? '-' + row : ''}.png`);
  }
  app.quit();
});
