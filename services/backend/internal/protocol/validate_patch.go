package protocol

import "kernl.local/harness/backend/internal/protocol/patchdiff"

// ValidatePatch performs structural preflight before Policy or sandbox execution.
func ValidatePatch(patch string) error {
	if err := ValidatePatchPaths(patch); err != nil {
		return err
	}
	return patchdiff.ValidateStructure(patch)
}
