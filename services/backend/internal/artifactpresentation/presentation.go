package artifactpresentation

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const (
	ProtocolV1       = "harness.artifact-presentation/v1"
	ManifestPath     = "metadata/artifact-presentation.json"
	maxManifestBytes = 128 << 10
	maxGalleries     = 12
	maxItems         = 128
)

type manifestWire struct {
	Protocol  string        `json:"protocol"`
	Galleries []galleryWire `json:"galleries"`
}

type galleryWire struct {
	ID          string     `json:"id"`
	Title       string     `json:"title,omitempty"`
	Description string     `json:"description,omitempty"`
	Layout      string     `json:"layout,omitempty"`
	Sizing      string     `json:"sizing,omitempty"`
	Items       []itemWire `json:"items"`
}

type itemWire struct {
	Path        string `json:"path"`
	PreviewPath string `json:"preview_path,omitempty"`
	Label       string `json:"label,omitempty"`
	Description string `json:"description,omitempty"`
	Alt         string `json:"alt,omitempty"`
}

type Gallery struct {
	ID          string `json:"id"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Layout      string `json:"layout"`
	Sizing      string `json:"sizing"`
	Items       []Item `json:"items"`
}

type Item struct {
	Path        string `json:"path"`
	PreviewPath string `json:"preview_path,omitempty"`
	Label       string `json:"label,omitempty"`
	Description string `json:"description,omitempty"`
	Alt         string `json:"alt,omitempty"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	Kind        string `json:"kind"`
}

type Presentation struct {
	Protocol  string    `json:"protocol"`
	Fallback  bool      `json:"fallback"`
	Warning   string    `json:"warning,omitempty"`
	Galleries []Gallery `json:"galleries"`
}

func ParseBundle(raw []byte) (Presentation, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return Presentation{}, fmt.Errorf("open artifact bundle: %w", err)
	}
	entries := artifactEntries(reader)
	manifestFile := findFile(reader, ManifestPath)
	if manifestFile == nil {
		return fallbackPresentation(entries, ""), nil
	}
	if manifestFile.UncompressedSize64 > maxManifestBytes {
		return fallbackPresentation(entries, "manifesto de apresentação excede 128 KiB"), nil
	}
	handle, err := manifestFile.Open()
	if err != nil {
		return fallbackPresentation(entries, "manifesto de apresentação não pôde ser aberto"), nil
	}
	defer handle.Close()
	var manifest manifestWire
	decoder := json.NewDecoder(handle)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return fallbackPresentation(entries, "manifesto de apresentação inválido"), nil
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return fallbackPresentation(entries, "manifesto de apresentação contém dados adicionais"), nil
	}
	galleries, err := validateAndNormalize(manifest, entries)
	if err != nil {
		return fallbackPresentation(entries, err.Error()), nil
	}
	return Presentation{Protocol: ProtocolV1, Galleries: galleries}, nil
}

func artifactEntries(reader *zip.Reader) map[string]*zip.File {
	result := map[string]*zip.File{}
	for _, file := range reader.File {
		if file.FileInfo().IsDir() || !strings.HasPrefix(file.Name, "artifacts/") || !safeArtifactPath(file.Name) {
			continue
		}
		result[file.Name] = file
	}
	return result
}

func findFile(reader *zip.Reader, name string) *zip.File {
	for _, file := range reader.File {
		if file.Name == name && !file.FileInfo().IsDir() {
			return file
		}
	}
	return nil
}

func validateAndNormalize(manifest manifestWire, entries map[string]*zip.File) ([]Gallery, error) {
	if manifest.Protocol != ProtocolV1 {
		return nil, fmt.Errorf("protocolo de apresentação inválido")
	}
	if len(manifest.Galleries) < 1 || len(manifest.Galleries) > maxGalleries {
		return nil, fmt.Errorf("quantidade de galerias fora do limite")
	}
	seenIDs := map[string]struct{}{}
	result := make([]Gallery, 0, len(manifest.Galleries))
	total := 0
	for _, candidate := range manifest.Galleries {
		candidate.ID = strings.TrimSpace(candidate.ID)
		if candidate.ID == "" || len(candidate.ID) > 80 || len(candidate.Title) > 240 || len(candidate.Description) > 1200 {
			return nil, fmt.Errorf("metadata de galeria inválida")
		}
		if _, duplicate := seenIDs[candidate.ID]; duplicate {
			return nil, fmt.Errorf("id de galeria duplicado")
		}
		seenIDs[candidate.ID] = struct{}{}
		if !allowedLayout(candidate.Layout) || !allowedSizing(candidate.Sizing) {
			return nil, fmt.Errorf("layout ou sizing de galeria inválido")
		}
		if len(candidate.Items) < 1 || len(candidate.Items) > 64 {
			return nil, fmt.Errorf("quantidade de itens da galeria fora do limite")
		}
		total += len(candidate.Items)
		if total > maxItems {
			return nil, fmt.Errorf("apresentação excede %d itens", maxItems)
		}
		gallery := Gallery{ID: candidate.ID, Title: candidate.Title, Description: candidate.Description, Layout: defaultValue(candidate.Layout, "auto"), Sizing: defaultValue(candidate.Sizing, "adaptive"), Items: make([]Item, 0, len(candidate.Items))}
		seenPaths := map[string]struct{}{}
		for _, wire := range candidate.Items {
			item, err := normalizeItem(wire, entries)
			if err != nil {
				return nil, err
			}
			if _, duplicate := seenPaths[item.Path]; duplicate {
				return nil, fmt.Errorf("item duplicado na galeria %q", gallery.ID)
			}
			seenPaths[item.Path] = struct{}{}
			gallery.Items = append(gallery.Items, item)
		}
		result = append(result, gallery)
	}
	return result, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if err == io.EOF {
		return nil
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("unexpected trailing JSON value")
}
