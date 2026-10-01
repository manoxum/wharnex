const filenameLanguages: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'gnumakefile': 'makefile',
  'jenkinsfile': 'groovy',
  '.gitignore': 'plaintext',
  '.dockerignore': 'plaintext',
  '.editorconfig': 'ini',
}

const extensionLanguages: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml',
  go: 'go', py: 'python', rb: 'ruby', php: 'php',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', rs: 'rust', swift: 'swift', dart: 'dart',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  toml: 'ini', ini: 'ini', conf: 'ini', properties: 'ini',
  env: 'dotenv', mk: 'makefile', txt: 'plaintext', log: 'plaintext',
}

export function editorLanguageForPath(path: string) {
  const name = path.split('/').pop()?.toLowerCase() || ''
  if (name === '.env' || name.startsWith('.env.')) return 'dotenv'
  if (filenameLanguages[name]) return filenameLanguages[name]
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return extensionLanguages[name.slice(dot + 1)] || 'plaintext'
}

export function editorDisplayLanguage(path: string) {
  const language = editorLanguageForPath(path)
  const labels: Record<string, string> = {
    typescript: 'TypeScript', javascript: 'JavaScript', json: 'JSON', html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
    markdown: 'Markdown', yaml: 'YAML', xml: 'XML', go: 'Go', python: 'Python', ruby: 'Ruby', php: 'PHP', java: 'Java',
    kotlin: 'Kotlin', scala: 'Scala', c: 'C', cpp: 'C++', csharp: 'C#', rust: 'Rust', swift: 'Swift', dart: 'Dart', shell: 'Shell',
    sql: 'SQL', graphql: 'GraphQL', ini: 'Config', dotenv: 'Environment', dockerfile: 'Dockerfile', makefile: 'Makefile', groovy: 'Groovy', plaintext: 'Plain Text',
  }
  return labels[language] || language
}
