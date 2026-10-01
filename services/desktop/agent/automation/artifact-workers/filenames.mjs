// Utility workers accept only the exact artifact derived from their task id.
// Each response remains a bundle so the engine can verify source identity.
function utilityTaskID(taskID, taskName) {
  const id = String(taskID || '').trim()
  if (!/^cat_[a-f0-9]{20}$/.test(id)) throw new Error(`invalid ${taskName} task id`)
  return id
}

export function markdownTranslationFilename(taskID) {
  return `whx_translation_res_${utilityTaskID(taskID, 'translation')}.zip`
}

export function todoClassificationFilename(taskID) {
  return `whx_todo_classification_res_${utilityTaskID(taskID, 'TODO classification')}.zip`
}
