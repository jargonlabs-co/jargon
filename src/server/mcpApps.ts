import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@modelcontextprotocol/server'
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { EMAIL_WORKSPACE_URI, EMAIL_WORKSPACE_URIS, SAMPLE_EMAIL_WORKSPACE } from './emailWorkspace'
import { applyEmailWorkspaceHtml } from '../shared/plivoSdp'

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
  cachedHtml = applyEmailWorkspaceHtml(template, inlineExtAppsBundle())
  return cachedHtml
}

/**
 * Claude sandboxes MCP apps with an empty connect-src / script-src and no
 * microphone until the resource declares them. Without this, the Plivo SDK
 * never loads and the dialer used to open the web workspace instead.
 */
export const EMAIL_WORKSPACE_UI_META = {
  csp: {
    resourceDomains: ['https://cdn.plivo.com'],
    connectDomains: [
      'https://*.plivo.com',
      'wss://*.plivo.com',
      'stun:stun.plivo.com:3478',
      'stun:stun-fb.plivo.com:3478',
      'stun:stun.l.google.com:19302'
    ]
  },
  permissions: {
    microphone: {}
  }
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
        description: 'Outbound in Claude: Contacts, Sequence, Tasks, and Admin.',
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: EMAIL_WORKSPACE_UI_META }
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: emailWorkspaceHtml(),
            _meta: { ui: EMAIL_WORKSPACE_UI_META }
          }
        ]
      })
    )
  }
}

export function emailWorkspacePreviewHtml(payloadJson?: string): string {
  const payload = (payloadJson?.trim() || JSON.stringify(SAMPLE_EMAIL_WORKSPACE)).replace(/</g, '\\u003c')
  const shim = `globalThis.ExtApps={applyHostStyleVariables:()=>{},applyDocumentTheme:()=>{},App:class{
    constructor(){this.h={theme:'light'}; this.data=${payload}}
    ontoolresult; onhostcontextchanged;
    text(){return JSON.stringify(this.data)}
    async connect(){ this.ontoolresult?.({content:[{type:'text',text:this.text()}]}); }
    getHostContext(){return this.h}
    sendMessage(m){console.log('sendMessage',m)}
    updateModelContext(m){console.log('updateModelContext',m)}
    callServerTool(req){
      const name=req&&req.name; const args=(req&&req.arguments)||{}; const tasks=this.data.tasks||[];
      const mark=(task,state)=>{ if(task){ task.state=state; task.bucket=state==='done'?'done':'skipped'; } };
      if(name==='run_skip_task') mark(tasks.find((t)=>t.contactId===args.contactId&&t.stepId===args.stepId),'skipped');
      if(name==='run_save_draft'){
        const task=tasks.find((t)=>t.contactId===args.contactId&&t.channel===(args.channel||'email')&&t.state!=='done'&&t.state!=='skipped');
        const id='msg_'+(this.n=(this.n||0)+1);
        if(task){ if(args.subject) task.subject=args.subject; if(args.body) task.body=args.body; task.messageId=id; }
        return Promise.resolve({content:[{type:'text',text:JSON.stringify({message:{id,status:'draft'}})}]});
      }
      if(name==='run_update_draft') return Promise.resolve({content:[{type:'text',text:JSON.stringify({message:{id:args.messageId||'msg_preview',status:'draft'}})}]});
      if(name==='run_send_draft') mark(tasks.find((t)=>t.messageId===args.messageId)||tasks.find((t)=>(t.channel==='email'||t.channel==='linkedin')&&t.state!=='done'&&t.state!=='skipped'),'done');
      if(name==='run_disposition'||name==='run_complete_call') mark(tasks.find((t)=>t.channel==='call'&&t.state!=='done'&&t.state!=='skipped'),'done');
      return Promise.resolve({content:[{type:'text',text:this.text()}]});
    }
    openLink(req){console.log('openLink',req); window.open(req.url,'_blank')}
    requestDisplayMode(){return Promise.resolve({mode:'inline'})}
  }};`
  const html = readFileSync(join(here, 'apps/emailWorkspace.html'), 'utf8')
  return applyEmailWorkspaceHtml(html, shim)
}
