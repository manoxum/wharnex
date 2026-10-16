import { useCallback, type Dispatch, type SetStateAction } from 'react'

export function reorderEditorDocuments<T extends { path: string }>(documents: T[], source: string, target: string, placement: 'before' | 'after' = 'before'): T[] {
  const sourceIndex = documents.findIndex((document) => document.path === source)
  if (source === target || sourceIndex < 0 || !documents.some((document) => document.path === target)) return documents
  const next = documents.filter((document) => document.path !== source)
  const targetIndex = next.findIndex((document) => document.path === target)
  next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, documents[sourceIndex])
  return next
}
export function useEditorDocumentReorder<T extends { path: string }>(setDocuments: Dispatch<SetStateAction<T[]>>) {
  return useCallback((source: string, target: string, placement?: 'before' | 'after') => {
    setDocuments((documents) => reorderEditorDocuments(documents, source, target, placement))
  }, [setDocuments])
}
