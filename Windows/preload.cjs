'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The dashboard only receives this narrow, write-only bridge. School pages
// never load this preload and cannot reach native storage or IPC.
contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    campus: {
      postMessage(message) { ipcRenderer.send('campus-action', message); }
    }
  }
});
contextBridge.exposeInMainWorld('campusDesktop', {
  platform: process.platform,
  onEvent(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('campus-event', (_event, payload) => callback(payload));
  }
});
