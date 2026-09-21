package directives

import "strings"

// parseSeeValue parses a spotlight over content already indexed by another
// composer source. The UI controls which sources are offered; the parser keeps
// older canonical markers readable and never makes @see itself transport bytes.
func parseSeeValue(raw string) (Directive, bool) {
	if raw == "" || len(raw) > MaxValueLength || strings.ContainsAny(raw, "{}\x00") {
		return Directive{}, false
	}
	parts := strings.Split(raw, "|")
	if len(parts) == 1 {
		name, ok := safeAttachmentName(raw)
		return Directive{Kind: KindSee, Value: name, Source: "upload", Project: "upload", Path: name}, ok
	}
	source := parts[0]
	switch source {
	case "file", "project":
		if len(parts) != 2 {
			return Directive{}, false
		}
		file, ok := safeRelativePath(parts[1])
		return Directive{Kind: KindSee, Value: source + "|" + file, Source: source, Project: source, Path: file}, ok
	case "chat":
		target, ok := parseChatValue(strings.TrimPrefix(raw, "chat|"))
		if !ok {
			return Directive{}, false
		}
		return Directive{Kind: KindSee, Value: "chat|" + target.Value, Source: source, Project: target.Project, Path: target.Path}, true
	case "lib":
		target, ok := parseLibraryValue(strings.TrimPrefix(raw, "lib|"))
		if !ok {
			return Directive{}, false
		}
		return Directive{Kind: KindSee, Value: "lib|" + target.Value, Source: source, Project: target.Project, Path: target.Path}, true
	case "todo":
		if len(parts) != 2 || !namePattern.MatchString(parts[1]) {
			return Directive{}, false
		}
		return Directive{Kind: KindSee, Value: "todo|" + parts[1], Source: source, Path: parts[1]}, true
	case "upload":
		if len(parts) != 2 {
			return Directive{}, false
		}
		name, ok := safeAttachmentName(parts[1])
		return Directive{Kind: KindSee, Value: "upload|" + name, Source: source, Project: source, Path: name}, ok
	case "ref":
		if len(parts) != 3 || !ValidProjectName(parts[1]) {
			return Directive{}, false
		}
		file, ok := safeRelativePath(parts[2])
		return Directive{Kind: KindSee, Value: "ref|" + parts[1] + "|" + file, Source: source, Project: parts[1], Path: file}, ok
	case "attach":
		if len(parts) != 3 || !strings.HasPrefix(parts[1], "/") || strings.ContainsAny(parts[1], "{}\x00") {
			return Directive{}, false
		}
		file, ok := safeRelativePath(parts[2])
		return Directive{Kind: KindSee, Value: "attach|" + parts[1] + "|" + file, Source: source, Project: parts[1], Path: file}, ok
	default:
		return Directive{}, false
	}
}
