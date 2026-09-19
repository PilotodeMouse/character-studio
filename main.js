const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Ferramenta local, de uso pessoal, so processa arquivos do disco do
// proprio usuario (nunca carrega conteudo remoto) -- por isso habilitamos
// nodeIntegration no renderer para poder usar fs/path/os e os modulos de
// src/ diretamente ali, sem precisar de um bundler so para isso.
function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 920,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Encaminha console.log/warn/error da tela pro terminal -- facilita
  // depurar sem precisar abrir o DevTools manualmente.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const label = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[renderer:${label}] ${message} (${path.basename(sourceId)}:${line})`);
  });
}

app.whenReady().then(() => {
  ipcMain.handle('select-pack-folder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('select-output-folder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('select-reference-image', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  // Usado pelo fluxo de "template embutido": trocar UMA peca do rig (Body,
  // Head, Sword...) por um arquivo proprio, PNG ou SVG (canvas desenha os
  // dois do mesmo jeito via drawImage).
  ipcMain.handle('select-image-file', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
