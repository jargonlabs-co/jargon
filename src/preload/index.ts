import { contextBridge, ipcRenderer } from 'electron'

function readApiBase(): string {
  const arg = process.argv.find((a) => a.startsWith('--jargon-api='))
  if (arg) return arg.replace('--jargon-api=', '')
  return 'http://127.0.0.1:8787'
}

contextBridge.exposeInMainWorld('jargon', {
  platform: process.platform,
  apiBaseUrl: readApiBase(),
  getAuthToken: (): Promise<string | null> => ipcRenderer.invoke('jargon:get-auth-token'),
  setAuthToken: (token: string | null): Promise<boolean> =>
    ipcRenderer.invoke('jargon:set-auth-token', token),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('jargon:open-external', url),
  getApiBase: (): Promise<string> => ipcRenderer.invoke('jargon:get-api-base'),
  onDeepLink: (handler: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string): void => handler(url)
    ipcRenderer.on('jargon:deep-link', listener)
    return () => ipcRenderer.removeListener('jargon:deep-link', listener)
  }
})
