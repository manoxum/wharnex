package contextbundle

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeAttachmentFile(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func includedPaths(attachment Attachment) []string {
	paths := make([]string, 0, len(attachment.Files))
	for _, file := range attachment.Files {
		paths = append(paths, file.Path)
	}
	return paths
}

// An attached folder is selected by the same engine the project's own context
// configuration uses, so the operator configures it with one vocabulary rather
// than two.
func TestResolveAttachmentAppliesTheSameSelectionAsProjectContext(t *testing.T) {
	root := t.TempDir()
	writeAttachmentFile(t, root, "openapi/spec.yaml", "openapi: 3.0.0\n")
	writeAttachmentFile(t, root, "openapi/notes.bak", "stale\n")
	writeAttachmentFile(t, root, "node_modules/left-pad/index.js", "module.exports = 1\n")
	writeAttachmentFile(t, root, "README.md", "# contracts\n")

	attachment, err := ResolveAttachment(root, AttachmentRules(true, nil, []string{"**/*.bak"}, 0), DefaultAttachmentLimits())
	if err != nil {
		t.Fatal(err)
	}
	paths := includedPaths(attachment)
	if !strings.Contains(strings.Join(paths, ","), "openapi/spec.yaml") {
		t.Fatalf("included=%#v", paths)
	}
	for _, unwanted := range []string{"openapi/notes.bak", "node_modules/left-pad/index.js"} {
		for _, path := range paths {
			if path == unwanted {
				t.Fatalf("%s must not be attached: %#v", unwanted, paths)
			}
		}
	}
	if attachment.Kind != "directory" || attachment.IncludedFiles != len(attachment.Files) {
		t.Fatalf("attachment=%#v", attachment)
	}
}

// An include list is a whitelist, exactly as it is for the project.
func TestResolveAttachmentHonoursAnIncludeWhitelist(t *testing.T) {
	root := t.TempDir()
	writeAttachmentFile(t, root, "openapi/spec.yaml", "openapi: 3.0.0\n")
	writeAttachmentFile(t, root, "docs/guide.md", "# guide\n")

	attachment, err := ResolveAttachment(root, AttachmentRules(true, []string{"openapi/**"}, nil, 0), DefaultAttachmentLimits())
	if err != nil {
		t.Fatal(err)
	}
	if paths := includedPaths(attachment); len(paths) != 1 || paths[0] != "openapi/spec.yaml" {
		t.Fatalf("included=%#v", paths)
	}
}

// A single file attaches as itself, under its own basename.
func TestResolveAttachmentReadsOneFile(t *testing.T) {
	root := t.TempDir()
	writeAttachmentFile(t, root, "contract.md", "# contract\n")

	attachment, err := ResolveAttachment(filepath.Join(root, "contract.md"), AttachmentRules(true, nil, nil, 0), DefaultAttachmentLimits())
	if err != nil {
		t.Fatal(err)
	}
	if attachment.Kind != "file" || len(attachment.Files) != 1 || attachment.Files[0].Path != "contract.md" {
		t.Fatalf("attachment=%#v", attachment)
	}
}

// Credential-shaped content never travels, however the operator pointed at it.
func TestResolveAttachmentDropsSecretContent(t *testing.T) {
	root := t.TempDir()
	writeAttachmentFile(t, root, "env.txt", "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLEKEY0123456789abcd\n")

	attachment, err := ResolveAttachment(root, AttachmentRules(true, nil, nil, 0), DefaultAttachmentLimits())
	if err != nil {
		t.Fatal(err)
	}
	if len(attachment.Files) != 0 {
		t.Fatalf("secret-like content must not attach: %#v", includedPaths(attachment))
	}
	if attachment.ExcludedItems == 0 {
		t.Fatal("the exclusion must be reported, not silent")
	}
}

// "The operator typed it, so they meant it" stops being a good enough reason at
// credential stores and kernel surfaces. One typo in a composer must not be
// able to put an SSH key into a prompt.
func TestResolveAttachmentRefusesSensitiveRoots(t *testing.T) {
	for _, root := range []string{"/", "/etc", "/proc/self", "/root"} {
		if _, err := ResolveAttachment(root, AttachmentRules(true, nil, nil, 0), DefaultAttachmentLimits()); !errors.Is(err, ErrAttachmentDenied) {
			t.Fatalf("%s must be refused, got %v", root, err)
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		for _, name := range []string{"", ".ssh"} {
			if _, err := ResolveAttachment(filepath.Join(home, name), AttachmentRules(true, nil, nil, 0), DefaultAttachmentLimits()); !errors.Is(err, ErrAttachmentDenied) {
				t.Fatalf("%s must be refused", filepath.Join(home, name))
			}
		}
	}
}

// A symlinked root is refused rather than followed: an attachment must read
// where it says it reads.
func TestResolveAttachmentRefusesASymlinkedRoot(t *testing.T) {
	root := t.TempDir()
	writeAttachmentFile(t, root, "real/file.md", "# real\n")
	link := filepath.Join(root, "link")
	if err := os.Symlink(filepath.Join(root, "real"), link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := ResolveAttachment(link, AttachmentRules(true, nil, nil, 0), DefaultAttachmentLimits()); !errors.Is(err, ErrAttachmentDenied) {
		t.Fatalf("a symlinked root must be refused, got %v", err)
	}
}

// Hitting a bound is reported, so the operator learns their attachment is
// incomplete instead of noticing a missing file later.
func TestResolveAttachmentReportsTruncation(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		writeAttachmentFile(t, root, name, strings.Repeat("x", 512))
	}
	attachment, err := ResolveAttachment(root, AttachmentRules(true, nil, nil, 0), AttachmentLimits{MaxFileBytes: 1 << 20, MaxTotalBytes: 1 << 20, MaxFiles: 2})
	if err != nil {
		t.Fatal(err)
	}
	if !attachment.Truncated || attachment.IncludedFiles != 2 {
		t.Fatalf("attachment=%#v", attachment)
	}
}
