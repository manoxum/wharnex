package contextbundle

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectconfig"
)

type ContextRule struct {
	ID          string   `json:"id"`
	Source      string   `json:"source"`
	Label       string   `json:"label"`
	Enabled     bool     `json:"enabled"`
	Patterns    []string `json:"patterns"`
	Description string   `json:"description"`
}

type ContextInventoryEntry struct {
	Path         string     `json:"path"`
	Kind         string     `json:"kind"`
	Status       string     `json:"status"`
	Size         int64      `json:"size,omitempty"`
	Reason       string     `json:"reason,omitempty"`
	Rule         string     `json:"rule,omitempty"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
	ModifiedAt   *time.Time `json:"modified_at,omitempty"`
	Configurable bool       `json:"configurable"`
}

type ContextRootEntry struct {
	Path          string     `json:"path"`
	Name          string     `json:"name"`
	Kind          string     `json:"kind"`
	Status        string     `json:"status"`
	IncludedFiles int        `json:"included_files"`
	ExcludedItems int        `json:"excluded_items"`
	IncludedBytes int64      `json:"included_bytes"`
	Reason        string     `json:"reason,omitempty"`
	CreatedAt     *time.Time `json:"created_at,omitempty"`
	ModifiedAt    *time.Time `json:"modified_at,omitempty"`
	Configurable  bool       `json:"configurable"`
}

type ContextInspection struct {
	SnapshotID    string                  `json:"snapshot_id"`
	SHA256        string                  `json:"sha256"`
	ProjectRoot   string                  `json:"project_root"`
	IncludedFiles int                     `json:"included_files"`
	ExcludedItems int                     `json:"excluded_items"`
	IncludedBytes int64                   `json:"included_bytes"`
	Roots         []ContextRootEntry      `json:"roots"`
	Entries       []ContextInventoryEntry `json:"entries"`
	Rules         []ContextRule           `json:"rules"`
}

func (b *Builder) Inspect(projectRoot string, manifest domain.ContextManifest) (ContextInspection, error) {
	root, err := filepath.Abs(projectRoot)
	if err != nil {
		return ContextInspection{}, err
	}
	cfg, _, err := projectconfig.Ensure(root)
	if err != nil {
		return ContextInspection{}, err
	}
	inspection := ContextInspection{SnapshotID: manifest.ID, SHA256: manifest.SHA256, ProjectRoot: root, Roots: []ContextRootEntry{}, Entries: []ContextInventoryEntry{}, Rules: []ContextRule{}}
	for _, file := range manifest.Files {
		createdAt, modifiedAt, _ := inventoryMetadata(root, file.Path)
		inspection.Entries = append(inspection.Entries, ContextInventoryEntry{Path: file.Path, Kind: "file", Status: "included", Size: file.Size, CreatedAt: createdAt, ModifiedAt: modifiedAt, Configurable: true})
		inspection.IncludedFiles++
		inspection.IncludedBytes += file.Size
	}
	details := manifest.ExcludedDetails
	if len(details) == 0 {
		details = legacyExclusionDetails(manifest.Excluded)
	}
	for _, item := range details {
		createdAt, modifiedAt, size := inventoryMetadata(root, item.Path)
		inspection.Entries = append(inspection.Entries, ContextInventoryEntry{Path: item.Path, Kind: item.Kind, Status: "excluded", Size: size, Reason: item.Reason, Rule: item.Rule, CreatedAt: createdAt, ModifiedAt: modifiedAt, Configurable: configurableExclusion(item.Rule)})
		inspection.ExcludedItems++
	}
	sort.Slice(inspection.Entries, func(i, j int) bool { return inspection.Entries[i].Path < inspection.Entries[j].Path })
	inspection.Rules = b.rules(root, cfg)
	inspection.Roots, err = rootEntries(root, inspection.Entries)
	if err != nil {
		return ContextInspection{}, err
	}
	return inspection, nil
}

func (b *Builder) rules(root string, cfg projectconfig.Config) []ContextRule {
	autoDirs := make([]string, 0, len(automaticDirectoryReasons))
	for name := range automaticDirectoryReasons {
		autoDirs = append(autoDirs, name+"/")
	}
	sort.Strings(autoDirs)
	return []ContextRule{
		{ID: "mandatory-directories", Source: "Wharnex", Label: "Pastas protegidas", Enabled: true, Patterns: slashSuffix(mandatoryBlockedDirs), Description: "Nunca entram no contexto e não podem ser reativadas pelo projeto."},
		{ID: "mandatory-files", Source: "Wharnex", Label: "Ficheiros/segredos protegidos", Enabled: true, Patterns: append(append([]string{}, mandatoryBlockedNames...), prefixStar(mandatoryBlockedExtensions)...), Description: "Credenciais, bases locais e material secreto são sempre bloqueados."},
		{ID: "harnessignore", Source: ".harnessignore", Label: "Regras .harnessignore", Enabled: len(LoadIgnorePatterns(root)) > 0, Patterns: nonNilPatterns(LoadIgnorePatterns(root)), Description: "Padrões adicionais definidos pelo próprio projeto."},
		{ID: "config-include", Source: projectconfig.FileName, Label: "Incluir apenas", Enabled: len(cfg.Context.Include) > 0, Patterns: nonNilPatterns(cfg.Context.Include), Description: "Quando definido, ficheiros que não casam com estes padrões ficam fora do snapshot."},
		{ID: "config-include-overrides", Source: projectconfig.FileName, Label: "Inclusões explícitas", Enabled: len(cfg.Context.IncludeOverride) > 0, Patterns: nonNilPatterns(cfg.Context.IncludeOverride), Description: "Ficheiros e pastas restaurados pela interface sem transformar a seleção numa allowlist."},
		{ID: "config-exclude", Source: projectconfig.FileName, Label: "Excluir do contexto", Enabled: len(cfg.Context.Exclude) > 0, Patterns: nonNilPatterns(cfg.Context.Exclude), Description: "Exclusões explícitas configuradas no projeto."},
		{ID: "auto-directories", Source: "Reconhecimento automático", Label: "Pastas sem valor para IA", Enabled: cfg.Context.AutoExclude, Patterns: autoDirs, Description: "Caches, estado de assistentes de IA, metadados de IDE/VCS secundário, builds, ambientes e resultados de teste."},
		{ID: "auto-generated-files", Source: "Reconhecimento automático", Label: "Artefactos gerados", Enabled: cfg.Context.AutoExclude, Patterns: prefixStar(automaticGeneratedSuffixes), Description: "Logs, temporários, bytecode e binários gerados."},
		{ID: "auto-assets", Source: "Reconhecimento automático", Label: "Assets não-fonte", Enabled: cfg.Context.AutoExclude, Patterns: prefixStar(automaticAssetSuffixes), Description: "Arquivos, media e fontes que normalmente só aumentam o contexto."},
		{ID: "file-size", Source: projectconfig.FileName, Label: "Limite por ficheiro", Enabled: true, Patterns: []string{fmt.Sprintf("ficheiro > %d bytes", cfg.Context.MaxFileBytes)}, Description: "Ficheiros individuais acima do limite configurado são excluídos."},
		{ID: "bundle-limit", Source: "Wharnex", Label: "Limite total do bundle", Enabled: true, Patterns: []string{fmt.Sprintf("bundle > %d bytes", b.maxBundleBytes)}, Description: "Impede um ZIP de contexto excessivamente grande."},
		{ID: "content-safety", Source: "Wharnex", Label: "Inspeção de segurança de conteúdo", Enabled: true, Patterns: []string{"secret-like content", "symlink"}, Description: "Marcadores de segredo e symlinks são removidos antes do ZIP."},
		{ID: "binary-content", Source: "Reconhecimento automático", Label: "Conteúdo binário", Enabled: cfg.Context.AutoExclude, Patterns: []string{"non-text/binary content"}, Description: "Quando o reconhecimento automático está ativo, conteúdo binário fica fora do contexto e não pode ser restaurado pela seleção explícita."},
	}
}

func rootEntries(root string, inventory []ContextInventoryEntry) ([]ContextRootEntry, error) {
	items, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	roots := make([]ContextRootEntry, 0, len(items))
	for _, item := range items {
		entry := ContextRootEntry{Path: item.Name(), Name: item.Name(), Kind: "file", Status: "not-in-snapshot", Configurable: true}
		if item.IsDir() {
			entry.Kind = "directory"
		}
		if info, statErr := item.Info(); statErr == nil {
			entry.CreatedAt, entry.ModifiedAt = fileTimes(info)
		}
		for _, inv := range inventory {
			if inv.Path != item.Name() && !strings.HasPrefix(inv.Path, item.Name()+"/") {
				continue
			}
			if inv.Status == "included" {
				entry.IncludedFiles++
				entry.IncludedBytes += inv.Size
			} else {
				entry.ExcludedItems++
				if inv.Path == item.Name() && entry.Reason == "" {
					entry.Reason = inv.Reason
					entry.Configurable = inv.Configurable
				}
			}
		}
		switch {
		case entry.IncludedFiles > 0 && entry.ExcludedItems > 0:
			entry.Status = "partial"
		case entry.IncludedFiles > 0:
			entry.Status = "included"
		case entry.ExcludedItems > 0:
			entry.Status = "excluded"
		}
		roots = append(roots, entry)
	}
	sort.Slice(roots, func(i, j int) bool {
		if roots[i].Kind != roots[j].Kind {
			return roots[i].Kind == "directory"
		}
		return roots[i].Name < roots[j].Name
	})
	return roots, nil
}

func inventoryMetadata(root, rel string) (createdAt, modifiedAt *time.Time, size int64) {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return nil, nil, 0
	}
	info, err := os.Lstat(filepath.Join(root, clean))
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return nil, nil, 0
	}
	createdAt, modifiedAt = fileTimes(info)
	if info.Mode().IsRegular() {
		size = info.Size()
	}
	return createdAt, modifiedAt, size
}

func fileTimes(info os.FileInfo) (*time.Time, *time.Time) {
	modified := info.ModTime().UTC()
	created := bestEffortCreatedTime(info).UTC()
	return &created, &modified
}

func configurableExclusion(rule string) bool {
	switch rule {
	case "auto-exclude", "config-exclude", "config-include":
		return true
	default:
		return false
	}
}

func legacyExclusionDetails(values []string) []domain.ContextExclusion {
	out := make([]domain.ContextExclusion, 0, len(values))
	for _, value := range values {
		path, reason := value, "excluded"
		if idx := strings.LastIndex(value, " ("); idx > 0 && strings.HasSuffix(value, ")") {
			path, reason = value[:idx], strings.TrimSuffix(value[idx+2:], ")")
		}
		out = append(out, domain.ContextExclusion{Path: path, Kind: "unknown", Reason: reason, Rule: "legacy"})
	}
	return out
}

func nonNilPatterns(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func slashSuffix(values []string) []string {
	out := make([]string, len(values))
	for i, value := range values {
		out[i] = value + "/"
	}
	return out
}

func prefixStar(values []string) []string {
	out := make([]string, len(values))
	for i, value := range values {
		if strings.HasPrefix(value, "*") {
			out[i] = value
		} else {
			out[i] = "*" + value
		}
	}
	return out
}
