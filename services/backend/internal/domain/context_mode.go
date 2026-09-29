package domain

// ContextMode controls how much of the already captured project snapshot is
// transported to the planner. The snapshot itself remains authoritative.
type ContextMode string

const (
	ContextModeFull    ContextMode = "full"
	ContextModePartial ContextMode = "partial"
)

func ValidContextMode(mode ContextMode) bool {
	return mode == ContextModeFull || mode == ContextModePartial
}

// Sessions from before this field existed retain their original full behavior.
func EffectiveContextMode(mode ContextMode) ContextMode {
	if mode == ContextModePartial {
		return mode
	}
	return ContextModeFull
}
