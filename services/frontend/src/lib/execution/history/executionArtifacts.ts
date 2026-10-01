import type { Session } from '../../../types'

export function executionArtifact(session: Session) {
  const execution = session.last_execution
  if (!execution) return '# Wharnex execution result\n\nNo execution result is available.\n'
  const commands = (execution.commands || []).slice(-30).map((command, index) => {
    const stdout = boundedArtifactText(command.stdout)
    const stderr = boundedArtifactText(command.stderr)
    return [`## Command ${index + 1}`, `- argv: ${JSON.stringify(command.argv)}`, `- cwd: ${command.cwd}`, `- exit: ${command.exit_code}`, `- success: ${command.success}`, stdout ? `### stdout\n\n\`\`\`text\n${stdout}\n\`\`\`` : '', stderr ? `### stderr\n\n\`\`\`text\n${stderr}\n\`\`\`` : ''].filter(Boolean).join('\n')
  }).join('\n\n')
  return `# Wharnex execution result\n\n- plan: ${execution.plan_id}\n- success: ${execution.success}\n- started: ${execution.started_at}\n- completed: ${execution.completed_at}\n${execution.error ? `- error: ${boundedArtifactText(execution.error)}` : ''}\n\n${commands}\n`
}

export function errorArtifact(session: Session) {
  const execution = session.last_execution
  const failed = (execution?.commands || []).filter((command) => !command.success).slice(-12)
  const commandText = failed.map((command) => `## Failed command\n\n- argv: ${JSON.stringify(command.argv)}\n- exit: ${command.exit_code}\n\n### stderr\n\n\`\`\`text\n${boundedArtifactText(command.stderr || command.stdout)}\n\`\`\``).join('\n\n')
  return `# Wharnex failure evidence\n\n- state: ${session.state}\n- plan: ${execution?.plan_id || session.repair_parent_plan_id || 'unknown'}\n- request: ${session.last_request_id || 'unknown'}\n${session.last_repair_error ? `- repair error: ${boundedArtifactText(session.last_repair_error)}` : ''}\n${execution?.error ? `- execution error: ${boundedArtifactText(execution.error)}` : ''}\n\n${commandText}\n`
}

function boundedArtifactText(value: string, limit = 12000) {
  const text = String(value || '').trim()
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated by Wharnex]` : text
}
