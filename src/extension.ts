import * as vscode from 'vscode'
import * as path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { ensureWindowsNodeBinary } from './nodeRuntime'
import { startLanguageServer } from './languageServer'

export { activate, deactivate }

const RAVEN_DOCS_URL = 'https://github.com/Unkindnesses/raven/blob/master/DOCS.md'
let languageServer: LanguageClient | undefined

function hasJSPI() {
  return typeof (WebAssembly as any).Suspending === 'function'
    && typeof (WebAssembly as any).promising === 'function'
}

async function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('raven-lang.installCLI', async () => {
    const scriptDir = path.join(context.extensionPath, 'script')
    const env = context.environmentVariableCollection
    env.clear()
    env.description = 'Add the `raven` command to the terminal'
    try {
      if (process.platform !== 'win32' && !hasJSPI()) {
        throw new Error('Update VS Code or follow the local Node.js install instructions.')
      }
      const ravenNode = process.platform === 'win32'
        ? await ensureWindowsNodeBinary(context)
        : process.execPath
      env.prepend('PATH', `${scriptDir}${path.delimiter}`)
      env.replace('RAVEN_NODE', ravenNode)
      vscode.window.showInformationMessage('Raven command is ready in new terminals.')
    } catch (error) {
      env.clear()
      const message = error instanceof Error ? error.message : String(error)
      vscode.window
        .showErrorMessage(`Failed to set up the Raven command: ${message}`, 'Open Docs')
        .then((selection) => {
          if (selection === 'Open Docs') vscode.env.openExternal(vscode.Uri.parse(RAVEN_DOCS_URL))
        })
    }
  })
  context.subscriptions.push(disposable)
  disposable = vscode.commands.registerCommand('raven-lang.removeCLI', () => {
    const env = context.environmentVariableCollection
    env.clear()
  })
  context.subscriptions.push(disposable)
  languageServer = await startLanguageServer(context)
}

async function deactivate() {
  await languageServer?.stop()
  languageServer = undefined
}
