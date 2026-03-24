const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, shell } = require('electron')
const path = require('path')

let tray = null
let mainWindow = null

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: 440,
    height: 740,
    x: width - 460,
    y: height - 760,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide() })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon-tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('DealCoach')
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { mainWindow.show(); mainWindow.focus() } },
    { label: 'Quit', click: () => { mainWindow.destroy(); app.quit() } },
  ]))
}

app.whenReady().then(() => { createWindow(); createTray() })
app.on('window-all-closed', (e) => e.preventDefault())

ipcMain.on('minimize', () => mainWindow.hide())
ipcMain.on('close', () => mainWindow.hide())
ipcMain.on('open-web', (_, url) => shell.openExternal(url))
