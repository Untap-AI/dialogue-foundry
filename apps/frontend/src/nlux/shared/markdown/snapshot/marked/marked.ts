import { _defaults, _getDefaults, changeDefaults } from './defaults'
import { _Hooks } from './Hooks'
import { Marked } from './Instance'
import { _Lexer } from './Lexer'
import { _Parser } from './Parser'
import { _Renderer } from './Renderer'
import { _TextRenderer } from './TextRenderer'
import { _Tokenizer } from './Tokenizer'
import type { MarkedExtension, MarkedOptions } from './MarkedOptions'
import type { MaybePromise } from './Instance'
import type { Token, TokensList } from './Tokens'

const markedInstance = new Marked()

export function marked(
  src: string,
  opt?: MarkedOptions
): string | Promise<string> {
  return markedInstance.parse(src, opt)
}

/**
 * Sets the default options.
 *
 * @param options Hash of options
 */
marked.options = marked.setOptions = function (options: MarkedOptions) {
  markedInstance.setOptions(options)
  marked.defaults = markedInstance.defaults
  changeDefaults(marked.defaults)
  return marked
}

/**
 * Gets the original marked default options.
 */
marked.getDefaults = _getDefaults

marked.defaults = _defaults

/**
 * Use Extension
 */

marked.use = function (...args: MarkedExtension[]) {
  markedInstance.use(...args)
  marked.defaults = markedInstance.defaults
  changeDefaults(marked.defaults)
  return marked
}

/**
 * Run callback for every token
 */

marked.walkTokens = function (
  tokens: Token[] | TokensList,
  callback: (token: Token) => MaybePromise | MaybePromise[]
) {
  return markedInstance.walkTokens(tokens, callback)
}

/**
 * Compiles markdown to HTML without enclosing `p` tag.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options
 * @return String of compiled HTML
 */
marked.parseInline = markedInstance.parseInline

/**
 * Expose
 */
marked.Parser = _Parser
marked.parser = _Parser.parse
marked.Renderer = _Renderer
marked.TextRenderer = _TextRenderer
marked.Lexer = _Lexer
marked.lexer = _Lexer.lex
marked.Tokenizer = _Tokenizer
marked.Hooks = _Hooks
marked.parse = marked
