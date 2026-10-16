import { useState } from 'react'
import { GitOperationModal } from '../../src/components/git/review/GitOperationModal'

const diff = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,3 @@\n export function greet(name: string): string {\n-  return name\n+  return `Olá, ${name}`\n }\ndiff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Projeto\n+# Atlas\n'
export function ReviewFixture() {
  const [confirmed, setConfirmed] = useState(false)
  return <main className="h-screen bg-whx-bg text-whx-text">
    <GitOperationModal sessionId="workbench-fixture" onClose={() => {}} operation={{ title: 'Rever publicação', detail: 'Duas alterações no projeto Atlas.', phase: 'reviewing', previews: [{ operation: 'push', repository: '', from_label: 'origin/main', to_label: 'feature/workbench', diff }, { operation: 'push', repository: 'services/core', from_label: 'origin/main', to_label: 'feature/workbench', diff }], onConfirmReview: () => setConfirmed(true) }}/>
    <output aria-label="Confirmação recebida">{confirmed ? 'Confirmado' : 'Por confirmar'}</output>
  </main>
}
