import { api } from '../../transport/http/api'
import { fileBase64 } from '../../chat/attachments/chatAttachments'

const MAX_OPERATIONAL_EVIDENCE_FILES = 8

// Imported trace files are persisted as explicit user input before the normal
// self-evolution request is prepared. Their bytes never grant command or patch
// authority; the backend accepts only this kind for evidence analysis.
export async function persistOperationalEvidence(sessionId: string, files: File[]) {
  if (files.length > MAX_OPERATIONAL_EVIDENCE_FILES) throw new Error(`Selecione no máximo ${MAX_OPERATIONAL_EVIDENCE_FILES} ficheiros de evidência.`)
  return Promise.all(files.map(async (file) => {
    if (!file.size) throw new Error(`O ficheiro “${file.name}” está vazio.`)
    const artifact = await api.persistArtifact(sessionId, {
      request_id: `evolution_evidence_${Date.now()}`, direction: 'input', kind: 'operational-evidence',
      filename: file.name, content_type: file.type || 'application/octet-stream', content_base64: await fileBase64(file),
    })
    return artifact.id
  }))
}
