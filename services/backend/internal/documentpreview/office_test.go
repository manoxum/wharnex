package documentpreview

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestOfficeTextExtractsDOCXWithoutExternalProcess(t *testing.T) {
	var raw bytes.Buffer
	writer := zip.NewWriter(&raw)
	part, _ := writer.Create("word/document.xml")
	_, _ = part.Write([]byte(`<w:document xmlns:w="w"><w:p><w:r><w:t>Hello WHX</w:t></w:r></w:p></w:document>`))
	_ = writer.Close()
	text, err := OfficeText("report.docx", raw.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if text != "Hello WHX" {
		t.Fatalf("text=%q", text)
	}
}
