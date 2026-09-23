package app

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestOperationalEvidenceZIPKeepsLogsAndSanitizesSecrets(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	file, err := writer.Create("execution/operational-events.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte(`{"error":"exit 127","token":"must-not-leak"}`)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	text, err := operationalEvidenceText(buffer.Bytes(), "chat.zip")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "exit 127") || strings.Contains(text, "must-not-leak") || !strings.Contains(text, "[REDACTED]") {
		t.Fatalf("unsafe ZIP evidence extraction: %q", text)
	}
}

func TestOperationalEvidenceRejectsBinaryText(t *testing.T) {
	if _, err := operationalEvidenceText([]byte{0xff, 0xfe}, "trace.log"); err == nil {
		t.Fatal("binary evidence must be refused")
	}
}
