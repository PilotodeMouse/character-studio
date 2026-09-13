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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
