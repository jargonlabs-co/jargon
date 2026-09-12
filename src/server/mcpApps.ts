import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@modelcontextprotocol/server'
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { EMAIL_WORKSPACE_URI, EMAIL_WORKSPACE_URIS, SAMPLE_EMAIL_WORKSPACE } from './emailWorkspace'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

function inlineExtAppsBundle(): string {
  const raw = readFileSync(require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8')
  return raw.replace(/export\{([^}]+)\};?\s*$/, (_, body: string) => {
    const map = body
      .split(',')
      .map((part) => {
        const [local, exported] = part.split(' as ').map((s) => s.trim())
        return `${exported ?? local}:${local}`
      })
      .join(',')
    return `globalThis.ExtApps={${map}};`
  })
}

let cachedHtml = ''

export function emailWorkspaceHtml(): string {
  if (cachedHtml) return cachedHtml
  const template = readFileSync(join(here, 'apps/emailWorkspace.html'), 'utf8')
  cachedHtml = template.replace('/*__EXT_APPS_BUNDLE__*/', () => inlineExtAppsBundle())
  return cachedHtml
}

export const EMAIL_WORKSPACE_TOOL_META = {
  ui: { resourceUri: EMAIL_WORKSPACE_URI },
  'ui/resourceUri': EMAIL_WORKSPACE_URI
}

export function registerEmailWorkspaceApp(server: McpServer): void {
  for (const uri of EMAIL_WORKSPACE_URIS) {
    registerAppResource(
      server,
      `Jargon email workspace (${uri})`,
      uri,
      {
        description: 'Edit the email sequence, preview copy, and send or schedule Gmail from Claude.',
        mimeType: RESOURCE_MIME_TYPE
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: emailWorkspaceHtml()
          }
        ]
      })
    )
  }
}

export function emailWorkspacePreviewHtml(payloadJson?: string): string {
  const payload = payloadJson?.trim() || JSON.stringify(SAMPLE_EMAIL_WORKSPACE)
  const shim = `globalThis.ExtApps={applyHostStyleVariables:()=>{},applyDocumentTheme:()=>{},App:class{
    constructor(){this.h={theme:'light'}}
    ontoolresult; onhostcontextchanged;
    async connect(){ this.ontoolresult?.({content:[{type:'text',text:${JSON.stringify(payload)}}]}); }
    getHostContext(){return this.h}
    sendMessage(m){console.log('sendMessage',m)}
    updateModelContext(m){console.log('updateModelContext',m)}
    callServerTool(req){console.log('callServerTool',req); return Promise.resolve({content:[{type:'text',text:${JSON.stringify(payload)}}]})}
    openLink(req){console.log('openLink',req); window.open(req.url,'_blank')}
    requestDisplayMode(){return Promise.resolve({mode:'inline'})}
  }};`
  const html = readFileSync(join(here, 'apps/emailWorkspace.html'), 'utf8')
  return html.replace('/*__EXT_APPS_BUNDLE__*/', shim)
}
