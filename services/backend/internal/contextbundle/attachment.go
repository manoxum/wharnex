package contextbundle

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/projectconfig"
)

// External attachments: a file or directory the operator pointed at with
// `@attach`, from outside the project.
//
// The selection question — what of this tree is worth sending — is the same one
// the project's own context configuration already answers, so it is answered by
// the same engine: `contextExclusion`, the mandatory `ShouldIgnore` boundary,
// the secret-content scan and the binary detector, driven by a
// `projectconfig.ContextConfig`. An operator configuring an attached folder is
// therefore using the vocabulary they already know from the settings panel, and
// there is no second predicate that can drift away from the first.
//
// What is different is the root. A project root is a repository the operator
// opened; an attachment root is an arbitrary absolute path typed into a
// composer, so it gets its own admission check before any of the above runs.

const (
	// DefaultAttachmentMaxFileBytes bounds one attached file.
	DefaultAttachmentMaxFileBytes = int64(1 << 20)
	// DefaultAttachmentMaxTotalBytes bounds one attachment's whole contribution.
	// An external folder can be arbitrarily large, and the request archive it
	// travels in is the same one every other input shares.
	DefaultAttachmentMaxTotalBytes = int64(4 << 20)
	// DefaultAttachmentMaxFiles bounds how many files one attachment admits.
	DefaultAttachmentMaxFiles = 400
	// maxAttachmentInventory bounds what the inventory reports. The inventory is
	// a configuration aid; past a few hundred rows it stops being one.
	maxAttachmentInventory = 1000
)

// ErrAttachmentDenied marks a root Wharnex refuses to read at all. It is a
// typed refusal because no pattern, retry or planner round can change it.
var ErrAttachmentDenied = errors.New("attachment path is not readable by Wharnex")

// AttachmentLimits bounds one attachment's contribution.
type AttachmentLimits struct {
	MaxFileBytes  int64
	MaxTotalBytes int64
	MaxFiles      int
}

// DefaultAttachmentLimits is what a request uses unless a caller narrows it.
func DefaultAttachmentLimits() AttachmentLimits {
	return AttachmentLimits{
		MaxFileBytes:  DefaultAttachmentMaxFileBytes,
		MaxTotalBytes: DefaultAttachmentMaxTotalBytes,
		MaxFiles:      DefaultAttachmentMaxFiles,
	}
}

// AttachmentFile is one selected file, relative to the attachment root.
type AttachmentFile struct {
	Path string
	Data []byte
	Mode fs.FileMode
}

// Attachment is the result of resolving one `@attach` directive.
type Attachment struct {
	Root          string
	Kind          string
	Files         []AttachmentFile
	Inventory     []ContextInventoryEntry
	IncludedFiles int
	IncludedBytes int64
	ExcludedItems int
	// Truncated says the selection hit a bound rather than ending naturally, so
	// the operator is told their attachment is incomplete instead of being left
	// to notice a file missing later.
	Truncated bool
}

// ResolveAttachment reads one external file or directory under the given rules.
//
// Content is read-only by construction: an attachment is never a patch target
// and never enters a plan's paths. It exists so the model can see something the
// project does not contain, and nothing about it grants a write.
func ResolveAttachment(root string, rules projectconfig.ContextConfig, limits AttachmentLimits) (Attachment, error) {
	resolved, info, err := admitAttachmentRoot(root)
	if err != nil {
		return Attachment{}, err
	}
	if limits.MaxFileBytes <= 0 || limits.MaxTotalBytes <= 0 || limits.MaxFiles <= 0 {
		limits = DefaultAttachmentLimits()
	}
	if rules.MaxFileBytes <= 0 || rules.MaxFileBytes > limits.MaxFileBytes {
		rules.MaxFileBytes = limits.MaxFileBytes
	}
	if !info.IsDir() {
		return attachSingleFile(resolved, info, limits)
	}
	return attachDirectory(resolved, rules, limits)
}

// admitAttachmentRoot decides whether Wharnex will read this path at all.
//
// The deny list is short and deliberate: it names the places where "the
// operator typed it, so they meant it" stops being a good enough reason —
// credential stores, system and kernel surfaces, and the bare roots whose whole
// subtree is everything. A typo in a composer should not be able to put an SSH
// key into a prompt.
func admitAttachmentRoot(root string) (string, os.FileInfo, error) {
	candidate := strings.TrimSpace(root)
	if candidate == "" || !filepath.IsAbs(candidate) {
		return "", nil, fmt.Errorf("%w: an attachment path must be absolute", ErrAttachmentDenied)
	}
	// Lstat first: a symlinked root is refused rather than followed, so an
	// attachment cannot be aimed somewhere other than where it reads.
	link, err := os.Lstat(candidate)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %s", ErrAttachmentDenied, err.Error())
	}
	if link.Mode()&os.ModeSymlink != 0 {
		return "", nil, fmt.Errorf("%w: %s is a symlink", ErrAttachmentDenied, candidate)
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %s", ErrAttachmentDenied, err.Error())
	}
	resolved = filepath.Clean(resolved)
	if reason := deniedAttachmentReason(resolved); reason != "" {
		return "", nil, fmt.Errorf("%w: %s", ErrAttachmentDenied, reason)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %s", ErrAttachmentDenied, err.Error())
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return "", nil, fmt.Errorf("%w: %s is not a regular file or directory", ErrAttachmentDenied, resolved)
	}
	return resolved, info, nil
}

func deniedAttachmentReason(resolved string) string {
	if resolved == "/" {
		return "the filesystem root is not an attachment"
	}
	for _, prefix := range deniedAttachmentPrefixes {
		if resolved == prefix || strings.HasPrefix(resolved, prefix+"/") {
			return prefix + " holds system or credential state"
		}
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	home = filepath.Clean(home)
	if resolved == home {
		return "the whole home directory is not an attachment; point at the folder you mean"
	}
	for _, name := range deniedHomeSubdirectories {
		secret := filepath.Join(home, name)
		if resolved == secret || strings.HasPrefix(resolved, secret+"/") {
			return name + " holds credential state"
		}
	}
	return ""
}

// These are the paths where an explicit operator gesture is not sufficient
// justification, because the cost of one typo is a leaked credential or a
// kernel pseudo-filesystem walked to exhaustion.
var deniedAttachmentPrefixes = []string{
	"/proc", "/sys", "/dev", "/boot", "/root", "/etc", "/var/log", "/var/lib",
}

var deniedHomeSubdirectories = []string{
	".ssh", ".gnupg", ".aws", ".kube", ".docker", ".azure", ".config/gcloud",
	".password-store", ".netrc", ".npmrc", ".pypirc",
}

func attachSingleFile(resolved string, info os.FileInfo, limits AttachmentLimits) (Attachment, error) {
	name := filepath.Base(resolved)
	attachment := Attachment{Root: resolved, Kind: "file"}
	if ShouldIgnore(name, false) {
		attachment.Inventory = append(attachment.Inventory, ContextInventoryEntry{
			Path: name, Kind: "file", Status: "excluded", Reason: "mandatory security/context exclusion", Rule: "mandatory",
		})
		attachment.ExcludedItems = 1
		return attachment, nil
	}
	if info.Size() > limits.MaxFileBytes {
		attachment.Inventory = append(attachment.Inventory, ContextInventoryEntry{
			Path: name, Kind: "file", Status: "excluded", Size: info.Size(), Reason: "file size limit", Rule: "file-size",
		})
		attachment.ExcludedItems, attachment.Truncated = 1, true
		return attachment, nil
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return Attachment{}, fmt.Errorf("%w: %s", ErrAttachmentDenied, err.Error())
	}
	if containsSecret(data) {
		attachment.Inventory = append(attachment.Inventory, ContextInventoryEntry{
			Path: name, Kind: "file", Status: "excluded", Size: info.Size(), Reason: "secret-like content", Rule: "secret-content",
		})
		attachment.ExcludedItems = 1
		return attachment, nil
	}
	attachment.Files = append(attachment.Files, AttachmentFile{Path: name, Data: data, Mode: info.Mode().Perm()})
	attachment.Inventory = append(attachment.Inventory, ContextInventoryEntry{
		Path: name, Kind: "file", Status: "included", Size: info.Size(), Configurable: false,
	})
	attachment.IncludedFiles, attachment.IncludedBytes = 1, info.Size()
	return attachment, nil
}

func attachDirectory(resolved string, rules projectconfig.ContextConfig, limits AttachmentLimits) (Attachment, error) {
	attachment := Attachment{Root: resolved, Kind: "directory"}
	walkErr := filepath.WalkDir(resolved, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// An unreadable subtree is reported and stepped over. Failing the
			// whole attachment because one directory denies access would make a
			// perfectly usable selection unusable.
			attachment.record(ContextInventoryEntry{
				Path: relativeAttachmentPath(resolved, path), Kind: "directory",
				Status: "excluded", Reason: "not readable", Rule: "unreadable",
			})
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel := relativeAttachmentPath(resolved, path)
		if rel == "" {
			return nil
		}
		kind := "file"
		if entry.IsDir() {
			kind = "directory"
		}
		if entry.Type()&os.ModeSymlink != 0 {
			attachment.record(ContextInventoryEntry{Path: rel, Kind: "symlink", Status: "excluded", Reason: "symlink", Rule: "symlink"})
			return nil
		}
		if reason, rule, ignored := contextExclusion(rel, entry.IsDir(), nil, rules); ignored {
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Reason: reason, Rule: rule, Configurable: configurableExclusion(rule)})
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		switch {
		case attachment.IncludedFiles >= limits.MaxFiles:
			attachment.Truncated = true
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Size: info.Size(), Reason: "attachment file-count limit", Rule: "attachment-limit"})
			return nil
		case info.Size() > rules.MaxFileBytes:
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Size: info.Size(), Reason: "file size limit", Rule: "file-size"})
			return nil
		case attachment.IncludedBytes+info.Size() > limits.MaxTotalBytes:
			attachment.Truncated = true
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Size: info.Size(), Reason: "attachment size limit", Rule: "attachment-limit"})
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Reason: "not readable", Rule: "unreadable"})
			return nil
		}
		if containsSecret(data) {
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Size: info.Size(), Reason: "secret-like content", Rule: "secret-content"})
			return nil
		}
		if rules.AutoExclude && !looksText(data) {
			attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "excluded", Size: info.Size(), Reason: "binary content", Rule: "binary-content"})
			return nil
		}
		attachment.Files = append(attachment.Files, AttachmentFile{Path: rel, Data: data, Mode: info.Mode().Perm()})
		attachment.IncludedFiles++
		attachment.IncludedBytes += info.Size()
		attachment.record(ContextInventoryEntry{Path: rel, Kind: kind, Status: "included", Size: info.Size(), Configurable: true})
		return nil
	})
	if walkErr != nil {
		return Attachment{}, fmt.Errorf("%w: %s", ErrAttachmentDenied, walkErr.Error())
	}
	sort.Slice(attachment.Files, func(i, j int) bool { return attachment.Files[i].Path < attachment.Files[j].Path })
	sort.Slice(attachment.Inventory, func(i, j int) bool { return attachment.Inventory[i].Path < attachment.Inventory[j].Path })
	return attachment, nil
}

func (a *Attachment) record(entry ContextInventoryEntry) {
	if entry.Status == "excluded" {
		a.ExcludedItems++
	}
	if len(a.Inventory) >= maxAttachmentInventory {
		return
	}
	a.Inventory = append(a.Inventory, entry)
}

func relativeAttachmentPath(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return ""
	}
	return filepath.ToSlash(rel)
}

// AttachmentRules converts a directive's selection into the context
// configuration the shared engine already understands.
func AttachmentRules(autoExclude bool, include, exclude []string, maxFileBytes int64) projectconfig.ContextConfig {
	if maxFileBytes <= 0 {
		maxFileBytes = DefaultAttachmentMaxFileBytes
	}
	return projectconfig.ContextConfig{
		AutoExclude:  autoExclude,
		MaxFileBytes: maxFileBytes,
		Include:      append([]string(nil), include...),
		Exclude:      append([]string(nil), exclude...),
	}
}
