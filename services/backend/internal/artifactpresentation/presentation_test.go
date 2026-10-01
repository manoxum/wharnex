package artifactpresentation

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestParseBundleNormalizesTrustedArtifactMetadata(t *testing.T) {
	raw := presentationZIP(t, map[string]string{
		"artifacts/photo.png":      "png",
		"artifacts/readme.md":      "# hello",
		"artifacts/diagram.drawio": "<mxfile/>",
		ManifestPath:               `{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"mixed","layout":"masonry","items":[{"path":"artifacts/photo.png","label":"Foto"},{"path":"artifacts/readme.md"},{"path":"artifacts/diagram.drawio"}]}]}`,
	})
	presentation, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.Fallback || len(presentation.Galleries) != 1 {
		t.Fatalf("unexpected presentation: %+v", presentation)
	}
	items := presentation.Galleries[0].Items
	if items[0].Kind != "image" || items[0].Size != 3 || !strings.HasPrefix(items[0].ContentType, "image/") {
		t.Fatalf("unexpected image metadata: %+v", items[0])
	}
	if items[1].Kind != "markdown" || items[1].ContentType == "" {
		t.Fatalf("unexpected markdown metadata: %+v", items[1])
	}
	if items[2].Kind != "drawio" || items[2].ContentType != drawioContentType {
		t.Fatalf("unexpected drawio metadata: %+v", items[2])
	}
}

func TestParseBundleFallsBackForUnsafeOrDanglingManifest(t *testing.T) {
	cases := []string{
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"x","items":[{"path":"../secret"}]}]}`,
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"x","items":[{"path":"artifacts/missing.png"}]}]}`,
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"x","items":[{"path":"https://example.test/x.png"}]}]}`,
	}
	for _, manifest := range cases {
		raw := presentationZIP(t, map[string]string{"artifacts/ok.txt": "ok", ManifestPath: manifest})
		presentation, err := ParseBundle(raw)
		if err != nil {
			t.Fatal(err)
		}
		if !presentation.Fallback || presentation.Warning == "" {
			t.Fatalf("expected fallback for %s", manifest)
		}
		if got := presentation.Galleries[0].Items[0].Path; got != "artifacts/ok.txt" {
			t.Fatalf("unexpected fallback item %q", got)
		}
	}
}

func TestParseBundleFallsBackForDuplicateIDsAndItems(t *testing.T) {
	manifests := []string{
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"same","items":[{"path":"artifacts/a.txt"}]},{"id":"same","items":[{"path":"artifacts/b.txt"}]}]}`,
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"dup","items":[{"path":"artifacts/a.txt"},{"path":"artifacts/a.txt"}]}]}`,
	}
	for _, manifest := range manifests {
		raw := presentationZIP(t, map[string]string{"artifacts/a.txt": "a", "artifacts/b.txt": "b", ManifestPath: manifest})
		presentation, err := ParseBundle(raw)
		if err != nil {
			t.Fatal(err)
		}
		if !presentation.Fallback || presentation.Warning == "" {
			t.Fatalf("expected duplicate fallback: %+v", presentation)
		}
	}
}

func TestParseBundleRejectsClientDeclaredTrustedMetadata(t *testing.T) {
	manifests := []string{
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"x","items":[{"path":"artifacts/a.txt","kind":"image"}]}]}`,
		`{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"x","items":[{"path":"artifacts/a.txt","content_type":"image/png"}]}]}`,
	}
	for _, manifest := range manifests {
		raw := presentationZIP(t, map[string]string{"artifacts/a.txt": "a", ManifestPath: manifest})
		presentation, err := ParseBundle(raw)
		if err != nil {
			t.Fatal(err)
		}
		if !presentation.Fallback || presentation.Warning == "" {
			t.Fatalf("expected strict fallback: %+v", presentation)
		}
		item := presentation.Galleries[0].Items[0]
		if item.Kind != "text" || item.ContentType != "text/plain" {
			t.Fatalf("trusted metadata must be server-derived, got %+v", item)
		}
	}
}

func TestDrawioClassificationDoesNotDependOnSystemMIMEDatabase(t *testing.T) {
	if got := trustedContentType("artifacts/diagram.drawio"); got != "application/vnd.jgraph.mxfile" {
		t.Fatalf("drawio content type must be deterministic, got %q", got)
	}
	if got := previewKind("artifacts/diagram.drawio", "application/octet-stream"); got != "drawio" {
		t.Fatalf("drawio extension must select the dedicated preview kind, got %q", got)
	}
}

func TestDrawioCompositeExtensionsRemainImages(t *testing.T) {
	cases := map[string]string{
		"artifacts/diagram.drawio.png": "image/png",
		"artifacts/diagram.drawio.svg": "image/svg+xml",
	}
	for name, contentType := range cases {
		if got := previewKind(name, contentType); got != "image" {
			t.Fatalf("%s must remain an image, got %q", name, got)
		}
	}
}

func TestPlainTextKindDoesNotDependOnSystemMIMEDatabase(t *testing.T) {
	if got := previewKind("artifacts/a.txt", "application/octet-stream"); got != "text" {
		t.Fatalf("plain text extension must stay text without host MIME metadata, got %q", got)
	}
}

func TestParseBundleRejectsTrailingJSONValue(t *testing.T) {
	raw := presentationZIP(t, map[string]string{
		"artifacts/a.txt": "a",
		ManifestPath:      `{"protocol":"harness.artifact-presentation/v1","galleries":[{"id":"x","items":[{"path":"artifacts/a.txt"}]}]} {}`,
	})
	presentation, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !presentation.Fallback || presentation.Warning == "" {
		t.Fatalf("expected fallback for trailing data: %+v", presentation)
	}
}

func TestParseBundleFallsBackWhenGalleryLimitIsExceeded(t *testing.T) {
	galleries := strings.Repeat(`{"id":"x","items":[{"path":"artifacts/a.txt"}]},`, maxGalleries)
	galleries += `{"id":"last","items":[{"path":"artifacts/a.txt"}]}`
	manifest := `{"protocol":"harness.artifact-presentation/v1","galleries":[` + galleries + `]}`
	raw := presentationZIP(t, map[string]string{"artifacts/a.txt": "a", ManifestPath: manifest})
	presentation, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !presentation.Fallback || presentation.Warning == "" {
		t.Fatalf("expected limit fallback: %+v", presentation)
	}
}

func TestParseBundleSynthesizesPresentationWithoutManifest(t *testing.T) {
	raw := presentationZIP(t, map[string]string{"artifacts/b.txt": "b", "artifacts/a.txt": "a", "README.md": "ignored"})
	presentation, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !presentation.Fallback || presentation.Warning != "" || len(presentation.Galleries) != 1 {
		t.Fatalf("unexpected fallback: %+v", presentation)
	}
	if presentation.Galleries[0].Items[0].Path != "artifacts/a.txt" {
		t.Fatal("fallback should be stable and sorted")
	}
}

func TestParseBundleSynthesizesDrawioMetadataWithoutManifest(t *testing.T) {
	raw := presentationZIP(t, map[string]string{"artifacts/diagram.drawio": "<mxfile/>"})
	presentation, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !presentation.Fallback || len(presentation.Galleries) != 1 || len(presentation.Galleries[0].Items) != 1 {
		t.Fatalf("unexpected fallback: %+v", presentation)
	}
	item := presentation.Galleries[0].Items[0]
	if item.Kind != "drawio" || item.ContentType != drawioContentType {
		t.Fatalf("unexpected drawio fallback metadata: %+v", item)
	}
}

func presentationZIP(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, value := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
