/// <reference lib="webworker" />
import type {
  Highlighter,
  ILanguageRegistration as Lang,
  IShikiTheme as Theme,
} from '@vap/shiki'
import * as shiki from '@vap/shiki'
import { createWorkerHost } from '@vap/core/ipc'

let highlighter: Highlighter

const spec = {
  async setOnigasm({ wasm }: { wasm: string | ArrayBuffer }) {
    shiki.setWasm(wasm)
  },
  async setHighlighter({ theme, langs }: { theme: Theme; langs: Lang[] }) {
    highlighter = await shiki.getHighlighter({ theme, langs })
  },
  async loadTheme({ theme }: { theme: string | Theme }) {
    await highlighter.loadTheme(theme)
  },
  async getTheme({ theme }: { theme: string }) {
    return { themeData: JSON.stringify(highlighter.getTheme(theme)) }
  },
  async loadLanguage({ lang }: { lang: Lang }) {
    await highlighter.loadLanguage(lang)
  },
  async codeToThemedTokens({
    code,
    lang,
    theme,
  }: {
    code: string
    lang?: string
    theme?: string
  }) {
    return await highlighter.codeToThemedTokens(code, lang, theme)
  },
} as const

createWorkerHost('shiki-host', spec)

export type ShikiSpec = typeof spec
