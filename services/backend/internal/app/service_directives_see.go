package app

import (
	"strings"

	"kernl.local/harness/backend/internal/directives"
	"kernl.local/harness/backend/internal/domain"
)

func resolveSeeTarget(marker directives.Directive, context domain.ContextBundle, parsed []directives.Directive) (string, string, bool) {
	if marker.Source != "upload" && marker.Source != "" && !seeHasBackingDirective(marker, parsed) {
		return "", "", false
	}
	switch marker.Source {
	case "file", "project":
		paths := make([]string, 0, len(context.Manifest.Files))
		for _, file := range context.Manifest.Files {
			paths = append(paths, file.Path)
		}
		return resolveSeePath("", marker.Path, paths)
	case "chat":
		return "@{[chat]" + strings.TrimPrefix(marker.Value, "chat|") + "} via request attachment transport", "chat artifact", true
	case "lib":
		return "@{[lib]" + strings.TrimPrefix(marker.Value, "lib|") + "} via request attachment transport", "library artifact", true
	case "todo":
		return "@{[todo]" + strings.TrimPrefix(marker.Value, "todo|") + "} via request attachment transport", "TODO", true
	case "ref":
		for _, project := range context.RelatedProjects {
			if !strings.EqualFold(project.Name, marker.Project) {
				continue
			}
			paths := make([]string, 0, len(project.Manifest.Files))
			for _, file := range project.Manifest.Files {
				paths = append(paths, file.Path)
			}
			return resolveSeePath(requestArchiveRelatedPrefix(project.Prefix), marker.Path, paths)
		}
	case "attach":
		for _, attachment := range context.Attachments {
			if attachment.Root == marker.Project {
				return resolveSeePath(requestArchiveAttachmentPrefix(attachment.Prefix), marker.Path, attachment.IncludedPaths)
			}
		}
	}
	return "", "", false
}

func seeHasBackingDirective(marker directives.Directive, parsed []directives.Directive) bool {
	for _, candidate := range parsed {
		switch marker.Source {
		case "file", "project":
			if candidate.Kind == directives.KindFile && seePathCovered(candidate.Path, marker.Path) {
				return true
			}
		case "ref":
			if candidate.Kind == directives.KindRef && strings.EqualFold(candidate.Project, marker.Project) && seePathCovered(candidate.Path, marker.Path) {
				return true
			}
		case "attach":
			if candidate.Kind == directives.KindAttach && candidate.Path == marker.Project {
				return true
			}
		case "chat":
			if candidate.Kind == directives.KindChat && candidate.Value == strings.TrimPrefix(marker.Value, "chat|") {
				return true
			}
		case "lib":
			if candidate.Kind == directives.KindLib && candidate.Value == strings.TrimPrefix(marker.Value, "lib|") {
				return true
			}
		case "todo":
			if candidate.Kind == directives.KindTodo && candidate.Value == strings.TrimPrefix(marker.Value, "todo|") {
				return true
			}
		}
	}
	return false
}

func seePathCovered(selection, target string) bool {
	clean := strings.TrimSuffix(selection, "/")
	return clean == "" || target == clean || strings.HasPrefix(target, clean+"/")
}

func resolveSeePath(prefix, target string, visibleFiles []string) (string, string, bool) {
	for _, file := range visibleFiles {
		if file == target {
			return prefix + target, "file", true
		}
	}
	directoryPrefix := strings.TrimSuffix(target, "/") + "/"
	for _, file := range visibleFiles {
		if strings.HasPrefix(file, directoryPrefix) {
			return prefix + directoryPrefix, "directory", true
		}
	}
	return "", "", false
}
