import * as path from 'path'
import * as vscode from 'vscode'
import * as lc from 'vscode-languageclient/node'
import { ensureWindowsNodeBinary } from './nodeRuntime'

export { startLanguageServer }

async function startLanguageServer(context: vscode.ExtensionContext): Promise<lc.LanguageClient> {
  const runtime = process.platform === 'win32'
    ? await ensureWindowsNodeBinary(context)
    : process.execPath
  const cli = path.join(
    context.extensionPath, 'node_modules', '@unkindnesses', 'raven',
    'dist', 'cli', 'index.js'
  )
  const server: lc.ServerOptions = {
    command: runtime,
    args: ['--enable-source-maps', cli, 'lsp'],
    options: {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  }
  const options: lc.LanguageClientOptions = {
    documentSelector: [
      { language: 'raven', scheme: 'file' },
      { language: 'raven', scheme: 'untitled' }
    ]
  }
  const client = new lc.LanguageClient('raven', 'Raven Language Server', server, options)
  await client.start()
  return client
}
