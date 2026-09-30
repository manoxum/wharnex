export const LONG_CHAT_MARKDOWN_CHARS = 1400
export const LONG_CHAT_MARKDOWN_LINES = 18
export const LONG_USER_PROMPT_CHARS = 900
export const LONG_USER_PROMPT_LINES = 12

export function collapsedUserPromptPreview(text: string) {
  const firstLines = text.split('\n', LONG_USER_PROMPT_LINES + 1)
  const lineBounded = firstLines.length > LONG_USER_PROMPT_LINES ? firstLines.slice(0, LONG_USER_PROMPT_LINES).join('\n') : text
  const preview = lineBounded.slice(0, LONG_USER_PROMPT_CHARS).trimEnd()
  return `${preview}\n\n…`
}

export function collapsedMarkdownPreview(markdown: string) {
  const firstLines = markdown.split('\n', LONG_CHAT_MARKDOWN_LINES + 1)
  const lineBounded = firstLines.length > LONG_CHAT_MARKDOWN_LINES ? firstLines.slice(0, LONG_CHAT_MARKDOWN_LINES).join('\n') : markdown
  const preview = lineBounded.slice(0, LONG_CHAT_MARKDOWN_CHARS).trimEnd()
  return `${preview}\n\n…`
}
