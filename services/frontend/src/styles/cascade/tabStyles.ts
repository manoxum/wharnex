import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The workbench migrated tab chrome from legacy CSS to these shared Tailwind owners.
export const tabBarSource = readFileSync(resolve(process.cwd(), 'src/components/presentation/tabs/TabBar.tsx'), 'utf8') + readFileSync(resolve(process.cwd(), 'src/components/presentation/tabs/tabBarAppearance.ts'), 'utf8')
export const tabButtonSource = readFileSync(resolve(process.cwd(), 'src/components/presentation/tabs/TabButton.tsx'), 'utf8') + readFileSync(resolve(process.cwd(), 'src/components/presentation/tabs/tabAppearance.ts'), 'utf8')
export const chatTabsSource = readFileSync(resolve(process.cwd(), 'src/components/chat/navigation/ChatTabs.tsx'), 'utf8')
export const projectTabsSource = readFileSync(resolve(process.cwd(), 'src/components/workspace/projects/ProjectTabs.tsx'), 'utf8')
export const terminalTabsSource = readFileSync(resolve(process.cwd(), 'src/components/terminal/workspace/TerminalTabBar.tsx'), 'utf8')
export const projectChromeSource = readFileSync(resolve(process.cwd(), 'src/components/workspace/projects/projectTabChrome.ts'), 'utf8')
