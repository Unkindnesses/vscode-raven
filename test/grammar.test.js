const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { describe, it, before } = require('mocha')
const vsctm = require('vscode-textmate')
const oniguruma = require('vscode-oniguruma')

let registry
let grammar

before(async () => {
  const wasmBin = readFileSync(path.join(__dirname, '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm')).buffer
  await oniguruma.loadWASM(wasmBin)
  registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (str) => new oniguruma.OnigString(str)
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.raven') {
        const grammarPath = path.join(__dirname, '..', 'syntaxes', 'raven.tmLanguage.json')
        const grammarContent = readFileSync(grammarPath, 'utf8')
        return vsctm.parseRawGrammar(grammarContent, grammarPath)
      }
      return null
    }
  })
  grammar = await registry.loadGrammar('source.raven')
})

function tokenizeLine(line, ruleStack = vsctm.INITIAL) {
  const result = grammar.tokenizeLine(line, ruleStack)
  return {
    tokens: result.tokens.map(token => ({
      startIndex: token.startIndex,
      endIndex: token.endIndex,
      text: line.substring(token.startIndex, token.endIndex),
      scopes: token.scopes
    })),
    ruleStack: result.ruleStack
  }
}

function findTokensWithScope(line, scopePattern, ruleStack = vsctm.INITIAL) {
  const { tokens } = tokenizeLine(line, ruleStack)
  return tokens
    .filter(token => token.scopes.some(scope => scope.includes(scopePattern)))
    .map(token => token.text)
}

function hasScope(line, text, scopePattern, ruleStack = vsctm.INITIAL) {
  const { tokens } = tokenizeLine(line, ruleStack)
  const token = tokens.find(t => t.text === text)
  return token && token.scopes.some(scope => scope.includes(scopePattern))
}

function macroHeads(result) {
  return result.tokens
    .filter(token => token.scopes.some(scope => scope.includes('keyword.other.macro')))
    .map(token => token.text)
}

describe('grammar', () => {
  it('macro heads follow Raven whitespace rules', () => {
    assert.deepStrictEqual(findTokensWithScope('fn foo() {', 'keyword.other.macro'), ['fn'])
    assert.deepStrictEqual(findTokensWithScope('foo(bar)', 'keyword.other.macro'), [])
    assert.deepStrictEqual(findTokensWithScope('foo bar', 'keyword.other.macro'), ['foo'])
    assert.deepStrictEqual(findTokensWithScope('foo = 1', 'keyword.other.macro'), [])
    assert.deepStrictEqual(findTokensWithScope('@label outer', 'keyword.other.macro'), [])
    assert.deepStrictEqual(findTokensWithScope('a b, c d', 'keyword.other.macro'), ['a', 'c'])
  })

  it('macro scopes nest and terminate at delimiters', () => {
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

  it('control keywords and literals', () => {
    assert.ok(hasScope('return x', 'return', 'keyword.other.macro'))
    assert.ok(hasScope('break', 'break', 'keyword.control.raven'))
    assert.ok(hasScope('continue', 'continue', 'keyword.control.raven'))
    assert.ok(!hasScope('returning', 'returning', 'keyword.control.raven'))
    assert.ok(hasScope('true', 'true', 'constant.language.raven'))
    assert.ok(hasScope('false', 'false', 'constant.language.raven'))
    assert.ok(hasScope('nil', 'nil', 'constant.language.raven'))
    assert.ok(hasScope('nil?', 'nil?', 'variable.other.raven'))
  })

  it('extensible strings handle escapes and raw backticks', () => {
    assert.ok(hasScope('"ok"', '"', 'punctuation.definition.string.begin.raven'))
    assert.ok(hasScope('"ok"', 'ok', 'string.quoted.double.raven'))
    const escapedLine = String.raw`\\"newline: \\n"\\`
    assert.ok(hasScope(escapedLine, '\\\\', 'constant.character.escape.raven'))
    const rawLine = '\\\\`\\\\d+`\\\\\\\\'
    assert.ok(hasScope(rawLine, '\\\\d+', 'string.quoted.raw.raven'))
  })

  it('numbers cover hex, floats, and signed integers', () => {
    assert.deepStrictEqual(findTokensWithScope('0xFF && -0x1', 'constant.numeric'), ['0xFF', '-0x1'])
    assert.deepStrictEqual(findTokensWithScope('pi = 3.14, shift -2.0', 'constant.numeric'), ['3.14', '-2.0'])
    assert.deepStrictEqual(findTokensWithScope('42, -7, 0', 'constant.numeric'), ['42', '-7', '0'])
  })

  it('annotations keep labels out of macro highlighting', () => {
    const line = '@label outer'
    assert.ok(hasScope(line, '@label', 'support.meta.annotation.raven'))
    assert.ok(hasScope(line, 'outer', 'variable.other.raven'))
    assert.deepStrictEqual(findTokensWithScope(line, 'keyword.other.macro'), [])
  })

  it('comments detect line and block markers', () => {
    const lineComment = 'foo # trailing'
    assert.ok(hasScope(lineComment, '# trailing', 'comment.line.raven'))

    const blockComment = '#| nested |#'
    assert.ok(hasScope(blockComment, '#|', 'comment.block.raven'))
    assert.ok(hasScope(blockComment, ' nested ', 'comment.block.raven'))
    assert.ok(hasScope(blockComment, '|#', 'comment.block.raven'))
  })

  it('special variables with & prefix', () => {
    assert.ok(hasScope('foo(&rest, ys)', '&', 'keyword.definition.variable.special.raven'))
    assert.ok(hasScope('foo(&rest, ys)', 'rest', 'variable.language.special.raven'))
  })
})
