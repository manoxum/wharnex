package artifactpresentation

import (
	"archive/zip"
	"fmt"
	"mime"
	"path"
	"sort"
	"strings"
)

func normalizeItem(input itemWire, entries map[string]*zip.File) (Item, error) {
	input.Path = strings.TrimSpace(input.Path)
	if !safeArtifactPath(input.Path) {
		return Item{}, fmt.Errorf("referência de artefacto insegura")
	}
	file, exists := entries[input.Path]
	if !exists {
		return Item{}, fmt.Errorf("referência de artefacto inexistente")
	}
	if len(input.Label) > 160 || len(input.Description) > 1200 || len(input.Alt) > 500 {
		return Item{}, fmt.Errorf("metadata textual de artefacto excede o limite")
	}
	if input.PreviewPath != "" {
		input.PreviewPath = strings.TrimSpace(input.PreviewPath)
		if !safeArtifactPath(input.PreviewPath) || entries[input.PreviewPath] == nil {
			return Item{}, fmt.Errorf("preview_path de artefacto inválido")
		}
	}
	contentType := trustedContentType(input.Path)
	return Item{Path: input.Path, PreviewPath: input.PreviewPath, Label: input.Label, Description: input.Description, Alt: input.Alt, Size: int64(file.UncompressedSize64), ContentType: contentType, Kind: previewKind(input.Path, contentType)}, nil
}

func safeArtifactPath(value string) bool {
	if value == "" || strings.Contains(value, "\\") || strings.ContainsRune(value, '\x00') || strings.Contains(value, "://") {
		return false
	}
	clean := path.Clean(value)
	return clean == value && strings.HasPrefix(clean, "artifacts/") && clean != "artifacts" && !strings.HasPrefix(clean, "artifacts/../")
}

func allowedLayout(value string) bool {
	switch value {
	case "", "auto", "grid", "masonry", "strip":
		return true
	default:
		return false
	}
}

func allowedSizing(value string) bool {
	switch value {
	case "", "uniform", "adaptive":
		return true
	default:
		return false
	}
}

func defaultValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func trustedContentType(name string) string {
	value := mime.TypeByExtension(strings.ToLower(path.Ext(name)))
	if value == "" {
		return "application/octet-stream"
	}
	if index := strings.IndexByte(value, ';'); index >= 0 {
		value = value[:index]
	}
	return value
}

func previewKind(name, contentType string) string {
	ext := strings.ToLower(path.Ext(name))
	switch {
	case strings.HasPrefix(contentType, "image/"):
		return "image"
	case strings.HasPrefix(contentType, "video/"):
		return "video"
	case strings.HasPrefix(contentType, "audio/"):
		return "audio"
	case ext == ".pdf":
		return "pdf"
	case ext == ".html" || ext == ".htm":
		return "html"
	case ext == ".md" || ext == ".mdx" || ext == ".markdown":
		return "markdown"
	case isOfficeExtension(ext):
		return "office"
	case strings.HasPrefix(contentType, "text/") || isTextExtension(ext):
		return "text"
	default:
		return "binary"
	}
}

func isOfficeExtension(ext string) bool {
	switch ext {
	case ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp":
		return true
	default:
		return false
	}
}

func isTextExtension(ext string) bool {
	switch ext {
	case ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".csv", ".tsv", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".go", ".py", ".sh", ".css", ".scss", ".sql", ".diff", ".patch", ".log", ".ini", ".conf", ".c", ".h", ".cpp", ".hpp", ".rs", ".rb", ".java", ".kt", ".cs", ".php", ".swift", ".lua", ".r", ".dart", ".vue", ".svelte", ".graphql", ".proto":
		return true
	default:
		return false
	}
}

func fallbackPresentation(entries map[string]*zip.File, warning string) Presentation {
	paths := make([]string, 0, len(entries))
	for name := range entries {
		paths = append(paths, name)
	}
	sort.Strings(paths)
	items := make([]Item, 0, len(paths))
	for _, name := range paths {
		file := entries[name]
		contentType := trustedContentType(name)
		items = append(items, Item{Path: name, Size: int64(file.UncompressedSize64), ContentType: contentType, Kind: previewKind(name, contentType)})
	}
	galleries := []Gallery{}
	if len(items) > 0 {
		galleries = append(galleries, Gallery{ID: "artifacts", Title: "Artefactos devolvidos", Layout: "auto", Sizing: "adaptive", Items: items})
	}
	return Presentation{Protocol: ProtocolV1, Fallback: true, Warning: warning, Galleries: galleries}
}
