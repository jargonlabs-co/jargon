import { contextBridge } from 'electron'

function readApiBase(): string {
  const arg = process.argv.find((a) => a.startsWith('--jargon-api='))
  if (arg) return arg.replace('--jargon-api=', '')
  return 'http://127.0.0.1:8787'
}

contextBridge.exposeInMainWorld('jargon', {
  platform: process.platform,
  apiBaseUrl: readApiBase()
})
