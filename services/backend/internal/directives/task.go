package directives

// parseTaskValue accepts only one stable task identifier. Task references are
// intentionally narrower than paths: they never carry a project qualifier or
// traversal syntax, so resolving one cannot widen request authority.
func parseTaskValue(value string) (Directive, bool) {
	if value == "" || len(value) > MaxValueLength || !namePattern.MatchString(value) {
		return Directive{}, false
	}
	return Directive{Kind: KindTask, Value: value, Path: value}, true
}
