import { strict as assert } from 'node:assert'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

type TerminalDataWriteEvent = { terminal: vscode.Terminal; data: string }

async function waitForTerminalOutput(terminal: vscode.Terminal, matcher: RegExp, timeoutMs = 15_000): Promise<string> {
  const onDidWriteTerminalData: vscode.Event<TerminalDataWriteEvent> | undefined = (vscode.window as any).onDidWriteTerminalData
  assert.ok(onDidWriteTerminalData, 'Terminal data events are not available')

  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      disposable.dispose()
      reject(new Error(`Timed out waiting for output matching ${matcher}; received ${JSON.stringify(buffer)}`))
    }, timeoutMs)

    const disposable = onDidWriteTerminalData((event) => {
      if (event.terminal !== terminal) {
        return
      }
      buffer += event.data
      const match = buffer.match(matcher)
      if (match) {
        clearTimeout(timeout)
        disposable.dispose()
        resolve(match[1] ?? match[0])
      }
    })
  })
}

suite('CLI integration', () => {
  test('raven version is available after setup', async function () {
    this.timeout(20_000)
    const extension = vscode.extensions.getExtension('unkindnesses.raven-lang')
    assert.ok(extension, 'Raven language extension under test was not found')
    await extension.activate()
    await vscode.commands.executeCommand('raven-lang.installCLI')

    try {
      const terminal = vscode.window.createTerminal({ name: 'raven integration test' })
      terminal.show()
      terminal.sendText('raven version', true)

      const version = await waitForTerminalOutput(terminal, /\b(\d+\.\d+\.\d+)\b/)
      assert.match(version, /\d+\.\d+\.\d+/, 'CLI did not return a semver version string')
    } finally {
      await vscode.commands.executeCommand('raven-lang.removeCLI')
    }
  })
})

suite('LSP integration', () => {
  test('formats Raven files on save', async function () {
    this.timeout(15_000)
    const extension = vscode.extensions.getExtension('unkindnesses.raven-lang')
    assert.ok(extension, 'Raven language extension under test was not found')
    await extension.activate()

    const uri = vscode.Uri.file(path.join(os.tmpdir(), `raven-format-${process.pid}.rv`))
    await vscode.workspace.fs.writeFile(uri, new Uint8Array())
    try {
      const document = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(document)
      await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'fn f() {\nx\n    }\n'))

      const config = vscode.workspace.getConfiguration('editor', document)
      assert.equal(config.get('formatOnSave'), true)
      assert.equal(config.get('defaultFormatter'), 'unkindnesses.raven-lang')
      assert.equal(await document.save(), true)
      const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
      assert.equal(document.getText(), ['fn f() {', '  x', '}', ''].join(eol))
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await vscode.workspace.fs.delete(uri)
    }
  })
})
