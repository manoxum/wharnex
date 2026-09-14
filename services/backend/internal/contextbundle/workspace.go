package contextbundle

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const relatedProjectsIndex = "RELATED_PROJECTS.json"

var unsafeProjectName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// BuildWorkspace preserves the primary project's manifest and root-relative
// paths while adding each related repository below a distinct namespace.
func (b *Builder) BuildWorkspace(projectRoot string, relatedRoots []string) (domain.ContextBundle, error) {
	primary, err := b.Build(projectRoot)
	if err != nil || len(relatedRoots) == 0 {
		return primary, err
	}
	bundles := make([]domain.ContextBundle, 0, len(relatedRoots))
	for _, root := range relatedRoots {
		bundle, buildErr := b.Build(root)
		if buildErr != nil {
			removeBundleArtifacts(primary)
			for _, built := range bundles {
				removeBundleArtifacts(built)
			}
			return domain.ContextBundle{}, fmt.Errorf("build related project context %s: %w", root, buildErr)
		}
		bundles = append(bundles, bundle)
	}
	combined, err := b.combineWorkspace(primary, bundles)
	removeBundleArtifacts(primary)
	for _, bundle := range bundles {
		removeBundleArtifacts(bundle)
	}
	return combined, err
}

func (b *Builder) combineWorkspace(primary domain.ContextBundle, related []domain.ContextBundle) (domain.ContextBundle, error) {
	directory, err := os.MkdirTemp("", "wharness-context-*")
	if err != nil {
		return domain.ContextBundle{}, err
	}
	result := domain.ContextBundle{
		ID:       primary.ID,
		ZipPath:  filepath.Join(directory, primary.ID+".zip"),
		TextPath: filepath.Join(directory, primary.ID+".txt"),
		Manifest: primary.Manifest,
	}
	workspaceHash := sha256.New()
	_, _ = io.WriteString(workspaceHash, "primary:"+primary.Manifest.ProjectRoot+":"+primary.Manifest.SHA256+"\n")
	failed := true
	defer func() {
		if failed {
			_ = os.RemoveAll(directory)
		}
	}()

	for index, bundle := range related {
		name := safeProjectName(bundle.Manifest.ProjectRoot)
		prefix := fmt.Sprintf("RELATED_PROJECTS/%02d-%s/", index+1, name)
		result.RelatedProjects = append(result.RelatedProjects, domain.RelatedProjectContext{
			ProjectPath: bundle.Manifest.ProjectRoot,
			Name:        name,
			Prefix:      prefix,
			Manifest:    bundle.Manifest,
		})
		_, _ = io.WriteString(workspaceHash, bundle.Manifest.ProjectRoot+":"+bundle.Manifest.SHA256+"\n")
	}
	result.WorkspaceSHA256 = hex.EncodeToString(workspaceHash.Sum(nil))
	if err := b.writeWorkspaceZip(result.ZipPath, primary, related, result.RelatedProjects); err != nil {
		return domain.ContextBundle{}, err
	}
	if err := b.writeWorkspaceText(result.TextPath, primary.TextPath, related, result.RelatedProjects); err != nil {
		return domain.ContextBundle{}, err
	}
	failed = false
	return result, nil
}

func (b *Builder) writeWorkspaceZip(target string, primary domain.ContextBundle, related []domain.ContextBundle, metadata []domain.RelatedProjectContext) error {
	file, err := os.Create(target)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(file)
	var expanded int64
	copyBundle := func(source, prefix string) error {
		reader, openErr := zip.OpenReader(source)
		if openErr != nil {
			return openErr
		}
		defer reader.Close()
		for _, entry := range reader.File {
			if entry.FileInfo().IsDir() {
				continue
			}
			expanded += int64(entry.UncompressedSize64)
			if expanded > b.maxBundleBytes {
				return fmt.Errorf("combined project contexts exceed the %d-byte bundle limit", b.maxBundleBytes)
			}
			header := entry.FileHeader
			header.Name = prefix + entry.Name
			header.Extra = nil
			header.Comment = ""
			out, createErr := writer.CreateHeader(&header)
			if createErr != nil {
				return createErr
			}
			in, readErr := entry.Open()
			if readErr != nil {
				return readErr
			}
			_, copyErr := io.Copy(out, in)
			_ = in.Close()
			if copyErr != nil {
				return copyErr
			}
		}
		return nil
	}
	if err := copyBundle(primary.ZipPath, ""); err != nil {
		_ = writer.Close()
		_ = file.Close()
		return err
	}
	for index, bundle := range related {
		if err := copyBundle(bundle.ZipPath, metadata[index].Prefix); err != nil {
			_ = writer.Close()
			_ = file.Close()
			return err
		}
	}
	indexBytes, _ := json.MarshalIndent(struct {
		Protocol string                         `json:"protocol"`
		Primary  string                         `json:"primary_project"`
		Projects []domain.RelatedProjectContext `json:"related_projects"`
		Rule     string                         `json:"execution_rule"`
	}{
		Protocol: "harness.related-projects/v1", Primary: primary.Manifest.ProjectRoot, Projects: metadata,
		Rule: "Paths under RELATED_PROJECTS are reference context. A plan in this response targets only the primary project; make changes to another project through that project's own Wharnex session and Protected Apply.",
	}, "", "  ")
	expanded += int64(len(indexBytes))
	if expanded > b.maxBundleBytes {
		_ = writer.Close()
		_ = file.Close()
		return errors.New("combined project context index exceeds the bundle limit")
	}
	indexWriter, err := writer.Create(relatedProjectsIndex)
	if err == nil {
		_, err = indexWriter.Write(indexBytes)
	}
	if closeErr := writer.Close(); err == nil {
		err = closeErr
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func (b *Builder) writeWorkspaceText(target, primaryPath string, related []domain.ContextBundle, metadata []domain.RelatedProjectContext) error {
	file, err := os.Create(target)
	if err != nil {
		return err
	}
	defer file.Close()
	var written int64
	appendFile := func(source, heading string, budget int64) error {
		if heading != "" {
			remaining := b.maxContextBytes - written
			if remaining <= 0 {
				return nil
			}
			if int64(len(heading)) > remaining {
				heading = heading[:remaining]
			}
			n, writeErr := io.WriteString(file, heading)
			written += int64(n)
			if writeErr != nil {
				return writeErr
			}
		}
		input, openErr := os.Open(source)
		if openErr != nil {
			return openErr
		}
		defer input.Close()
		remaining := min(budget, b.maxContextBytes-written)
		if remaining <= 0 {
			return nil
		}
		n, copyErr := io.CopyN(file, input, remaining)
		written += n
		if errors.Is(copyErr, io.EOF) {
			return nil
		}
		return copyErr
	}
	primaryBudget := b.maxContextBytes
	relatedBudget := int64(0)
	if len(related) > 0 {
		primaryBudget = b.maxContextBytes / 2
		relatedBudget = (b.maxContextBytes - primaryBudget) / int64(len(related))
	}
	if err := appendFile(primaryPath, "", primaryBudget); err != nil {
		return err
	}
	for index, bundle := range related {
		heading := fmt.Sprintf("\n\n===== RELATED PROJECT %d: %s =====\nROOT: %s\nNAMESPACE: %s\n", index+1, metadata[index].Name, metadata[index].ProjectPath, metadata[index].Prefix)
		if err := appendFile(bundle.TextPath, heading, relatedBudget); err != nil {
			return err
		}
	}
	return nil
}

func safeProjectName(root string) string {
	name := unsafeProjectName.ReplaceAllString(filepath.Base(root), "-")
	name = strings.Trim(name, "-.")
	if name == "" {
		return "project"
	}
	return name
}

func removeBundleArtifacts(bundle domain.ContextBundle) {
	directory := filepath.Dir(bundle.ZipPath)
	if strings.HasPrefix(filepath.Base(directory), "wharness-context-") {
		_ = os.RemoveAll(directory)
	}
}
