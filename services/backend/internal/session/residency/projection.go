package residency

import "kernl.local/harness/backend/internal/domain"

// Projection strips heavy server-only state before startup transfer/decoding.
// Keep this expression in parity with Slim; a slim value is never persisted.
const Projection = `payload - '_request_knowledge' - '_request_support_artifacts' - 'baseline_file_snapshots' #- '{context,manifest,files}'`

// Slim is the scan view, with request bodies loaded only on demand. Assigning
// nil to copied fields does not change the complete aggregate held by a caller.
func Slim(item domain.Session) domain.Session {
	item.Context.Manifest.Files = nil
	item.RequestKnowledge = nil
	item.RequestSupportArtifacts = nil
	item.BaselineFileSnapshots = nil
	return item
}
