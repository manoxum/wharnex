import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readStyleSource } from './readStyleSource'

export const css = readStyleSource('styles/legacy/styles.css')
export const operationalCss = readStyleSource('styles/domains/workspace/chrome/operational-panels.css')
export const terminalSource = readFileSync(resolve(process.cwd(), 'src/components/terminal/workspace/InteractiveTerminal.tsx'), 'utf8')

function ruleExpression(selector: string, flags: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, flags)
}

export function lastRule(selector: string) {
  return lastRuleIn(css, selector)
}

export function firstRule(selector: string) {
  return css.match(ruleExpression(selector, 'm'))?.[1] || ''
}

export function lastRuleIn(source: string, selector: string) {
  return [...source.matchAll(ruleExpression(selector, 'gm'))].at(-1)?.[1] || ''
}
