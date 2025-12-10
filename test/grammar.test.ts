import { strict as assert } from 'node:assert'
import path from 'node:path'
import * as vscode from 'vscode'
import * as vsctm from 'vscode-textmate'
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma'

type TokenInfo = {
  startIndex: number
  endIndex: number
  text: string
  scopes: string[]
}

type TokenizedLine = {
  tokens: TokenInfo[]
  ruleStack: vsctm.StateStack
}

let registry: vsctm.Registry | undefined
let grammar: vsctm.IGrammar | null = null

suiteSetup(async () => {
  const wasmBytes = await loadOnigWasm()
  await loadWASM(wasmBytes)

  registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new OnigScanner(sources),
      createOnigString: (str) => new OnigString(str)
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.raven') {
        const grammarPath = await getGrammarPath()
        const grammarContent = await vscode.workspace.fs.readFile(grammarPath)
        return vsctm.parseRawGrammar(Buffer.from(grammarContent).toString('utf8'), grammarPath.fsPath)
      }
      if (scopeName === 'source.js') {
        const grammarPath = vscode.Uri.file(path.join(vscode.env.appRoot, 'extensions', 'javascript', 'syntaxes', 'JavaScript.tmLanguage.json'))
        const grammarContent = await vscode.workspace.fs.readFile(grammarPath)
        return vsctm.parseRawGrammar(Buffer.from(grammarContent).toString('utf8'), grammarPath.fsPath)
      }
      return null
    }
  })

  grammar = await registry.loadGrammar('source.raven')
})

async function loadOnigWasm(): Promise<Uint8Array> {
  const uri = vscode.Uri.file(path.join(vscode.env.appRoot, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'))
  const wasmData = await vscode.workspace.fs.readFile(uri)
  // Copy to avoid sharing a larger underlying buffer from Uint8Array.
  return wasmData.slice()
}

async function getGrammarPath(): Promise<vscode.Uri> {
  const extension = vscode.extensions.getExtension('unkindnesses.raven-lang')
  if (!extension) {
    throw new Error('Raven language extension under test was not found')
  }

  return vscode.Uri.joinPath(extension.extensionUri, 'syntaxes', 'raven.tmLanguage.json')
}

function tokenizeLine(line: string, ruleStack: vsctm.StateStack = vsctm.INITIAL): TokenizedLine {
  if (!grammar) {
    throw new Error('Grammar is not loaded')
  }

  const result = grammar.tokenizeLine(line, ruleStack)
  return {
    tokens: result.tokens.map((token) => ({
      startIndex: token.startIndex,
      endIndex: token.endIndex,
      text: line.substring(token.startIndex, token.endIndex),
      scopes: token.scopes
    })),
    ruleStack: result.ruleStack
  }
}

function findTokensWithScope(line: string, scopePattern: string, ruleStack: vsctm.StateStack = vsctm.INITIAL): string[] {
  const { tokens } = tokenizeLine(line, ruleStack)
  return tokens
    .filter((token) => token.scopes.some((scope) => scope.includes(scopePattern)))
    .map((token) => token.text)
}

function hasScope(line: string, text: string, scopePattern: string, ruleStack: vsctm.StateStack = vsctm.INITIAL): boolean {
  const { tokens } = tokenizeLine(line, ruleStack)
  const token = tokens.find((t) => t.text === text)
  return Boolean(token && token.scopes.some((scope) => scope.includes(scopePattern)))
}

function macroHeads(result: TokenizedLine): string[] {
  return result.tokens
    .filter((token) => token.scopes.some((scope) => scope.includes('keyword.other.macro')))
    .map((token) => token.text)
}

suite('grammar', () => {
  test('macro heads follow Raven whitespace rules', () => {
    assert.deepStrictEqual(findTokensWithScope('fn foo() {', 'keyword.other.macro'), ['fn'])
    assert.deepStrictEqual(findTokensWithScope('foo(bar)', 'keyword.other.macro'), [])
    assert.deepStrictEqual(findTokensWithScope('foo bar', 'keyword.other.macro'), ['foo'])
    assert.deepStrictEqual(findTokensWithScope('foo = 1', 'keyword.other.macro'), [])
    assert.deepStrictEqual(findTokensWithScope('@label outer', 'keyword.other.macro'), [])
    assert.deepStrictEqual(findTokensWithScope('a b, c d', 'keyword.other.macro'), ['a', 'c'])
  })

  test('macro scopes nest and terminate at delimiters', () => {
    assert.deepStrictEqual(findTokensWithScope('xs = a b c', 'keyword.other.macro'), ['a'])
    assert.deepStrictEqual(findTokensWithScope('a { b c }', 'keyword.other.macro'), ['a', 'b'])

    const firstLine = tokenizeLine('a {')
    assert.deepStrictEqual(macroHeads(firstLine), ['a'])

    const secondLine = tokenizeLine('  b c', firstLine.ruleStack)
    assert.deepStrictEqual(macroHeads(secondLine), ['b'])

    const thirdLine = tokenizeLine('}', secondLine.ruleStack)
    const fourthLine = tokenizeLine('d e', thirdLine.ruleStack)
    assert.deepStrictEqual(macroHeads(fourthLine), ['d'])
  })

  test('control keywords and literals', () => {
    assert.ok(hasScope('return x', 'return', 'keyword.other.macro'))
    assert.ok(hasScope('break', 'break', 'keyword.control.raven'))
    assert.ok(hasScope('continue', 'continue', 'keyword.control.raven'))
    assert.ok(!hasScope('returning', 'returning', 'keyword.control.raven'))
    assert.ok(hasScope('true', 'true', 'constant.language.raven'))
    assert.ok(hasScope('false', 'false', 'constant.language.raven'))
    assert.ok(hasScope('nil', 'nil', 'constant.language.raven'))
    assert.ok(hasScope('nil?', 'nil?', 'variable.other.raven'))
  })

  test('extensible strings handle escapes and raw backticks', () => {
    assert.ok(hasScope('"ok"', '"', 'punctuation.definition.string.begin.raven'))
    assert.ok(hasScope('"ok"', 'ok', 'string.quoted.double.raven'))
    const escapedLine = String.raw`\\"newline: \\n"\\`
    assert.ok(hasScope(escapedLine, String.raw`\\n`, 'constant.character.escape.raven'))
  })

  test('numbers cover hex, floats, and signed integers', () => {
    assert.deepStrictEqual(findTokensWithScope('0xFF && -0x1', 'constant.numeric'), ['0xFF', '-0x1'])
    assert.deepStrictEqual(findTokensWithScope('pi = 3.14, shift -2.0', 'constant.numeric'), ['3.14', '-2.0'])
    assert.deepStrictEqual(findTokensWithScope('42, -7, 0', 'constant.numeric'), ['42', '-7', '0'])
  })

  test('annotations keep labels out of macro highlighting', () => {
    const line = '@label outer'
    assert.ok(hasScope(line, '@label', 'support.meta.annotation.raven'))
    assert.ok(hasScope(line, 'outer', 'variable.other.raven'))
    assert.deepStrictEqual(findTokensWithScope(line, 'keyword.other.macro'), [])
  })

  test('inline JS tagged template closes and highlights JS', () => {
    const line = 'result = js`return Math.sqrt(2)`'
    const first = tokenizeLine(line)

    // JS content should be highlighted inside the embedded region.
    const jsTokens = first.tokens.filter((t) => t.scopes.some((s) => s.includes('source.js')))
    assert.ok(jsTokens.some((t) => t.text.includes('return')))

    // Closing backtick should be owned by Raven, not reinterpreted as a JS template start.
    const closing = first.tokens.find((t) => t.text === '`' && t.endIndex === line.length)
    assert.ok(closing && closing.scopes.some((s) => s.includes('punctuation.definition.string.end.raven')))
    assert.ok(!closing?.scopes.some((s) => s.includes('string.template')))

    // After the line, the stack should be closed; the next line must not be inside a string.
    assert.deepStrictEqual(findTokensWithScope('x = 1', 'string.quoted', first.ruleStack), [])
    assert.deepStrictEqual(findTokensWithScope('x = 1', 'source.js', first.ruleStack), [])
  })

  test('comments detect line and block markers', () => {
    const lineComment = 'foo # trailing'
    assert.ok(hasScope(lineComment, '# trailing', 'comment.line.raven'))

    const blockComment = '#| nested |#'
    assert.ok(hasScope(blockComment, '#|', 'comment.block.raven'))
    assert.ok(hasScope(blockComment, ' nested ', 'comment.block.raven'))
    assert.ok(hasScope(blockComment, '|#', 'comment.block.raven'))
  })

  test('special variables with & prefix', () => {
    assert.ok(hasScope('foo(&rest, ys)', '&', 'keyword.definition.variable.special.raven'))
    assert.ok(hasScope('foo(&rest, ys)', 'rest', 'variable.language.special.raven'))
  })
})
