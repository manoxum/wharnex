package documentpreview

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
)

const maxPreviewBytes = 8 << 20

func OfficeText(name string, raw []byte) (string, error) {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".doc" || ext == ".xls" || ext == ".ppt" {
		return "", errors.New("legacy binary Office preview is unavailable; download the original file")
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return "", errors.New("office document is not a valid package")
	}
	wanted := func(path string) bool {
		switch ext {
		case ".docx":
			return path == "word/document.xml"
		case ".xlsx":
			return path == "xl/sharedStrings.xml" || strings.HasPrefix(path, "xl/worksheets/sheet")
		case ".pptx":
			return strings.HasPrefix(path, "ppt/slides/slide") && strings.HasSuffix(path, ".xml")
		case ".odt", ".ods", ".odp":
			return path == "content.xml"
		}
		return false
	}
	files := make([]*zip.File, 0)
	for _, file := range reader.File {
		if wanted(file.Name) {
			files = append(files, file)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	if len(files) == 0 {
		return "", errors.New("office document has no previewable content")
	}
	var out strings.Builder
	for _, file := range files {
		if file.UncompressedSize64 > 32<<20 {
			return "", fmt.Errorf("office XML part %s exceeds preview limit", file.Name)
		}
		handle, err := file.Open()
		if err != nil {
			return "", err
		}
		if len(files) > 1 {
			out.WriteString("\n\n— ")
			out.WriteString(file.Name)
			out.WriteString(" —\n")
		}
		err = appendXMLText(&out, io.LimitReader(handle, 32<<20))
		handle.Close()
		if err != nil {
			return "", err
		}
		if out.Len() >= maxPreviewBytes {
			break
		}
	}
	result := strings.TrimSpace(out.String())
	if result == "" {
		return "", errors.New("office document contains no extractable text")
	}
	return result, nil
}

func appendXMLText(out *strings.Builder, input io.Reader) error {
	decoder := xml.NewDecoder(input)
	depth := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("decode office XML: %w", err)
		}
		switch value := token.(type) {
		case xml.StartElement:
			if value.Name.Local == "t" || value.Name.Local == "v" || value.Name.Local == "p" {
				depth++
			}
		case xml.CharData:
			if depth > 0 && out.Len() < maxPreviewBytes {
				text := strings.TrimSpace(string(value))
				if text != "" {
					if out.Len() > 0 {
						out.WriteByte(' ')
					}
					remaining := maxPreviewBytes - out.Len()
					if len(text) > remaining {
						text = text[:remaining]
					}
					out.WriteString(text)
				}
			}
		case xml.EndElement:
			if value.Name.Local == "t" || value.Name.Local == "v" || value.Name.Local == "p" {
				if depth > 0 {
					depth--
				}
				if out.Len() < maxPreviewBytes {
					out.WriteByte('\n')
				}
			}
		}
	}
}
