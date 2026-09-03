package contextbundle

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

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
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Size   int64  `json:"size,omitempty"`
	Reason string `json:"reason,omitempty"`
	Rule   string `json:"rule,omitempty"`
}

type ContextRootEntry struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	Status        string `json:"status"`
	IncludedFiles int    `json:"included_files"`
	ExcludedItems int    `json:"excluded_items"`
	IncludedBytes int64  `json:"included_bytes"`
	Reason        string `json:"reason,omitempty"`
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
	inspection := ContextInspection{SnapshotID: manifest.ID, SHA256: manifest.SHA256, ProjectRoot: root}
	for _, file := range manifest.Files {
		inspection.Entries = append(inspection.Entries, ContextInventoryEntry{Path: file.Path, Kind: "file", Status: "included", Size: file.Size})
		inspection.IncludedFiles++
		inspection.IncludedBytes += file.Size
	}
	details := manifest.ExcludedDetails
	if len(details) == 0 {
		details = legacyExclusionDetails(manifest.Excluded)
	}
	for _, item := range details {
		inspection.Entries = append(inspection.Entries, ContextInventoryEntry{Path: item.Path, Kind: item.Kind, Status: "excluded", Reason: item.Reason, Rule: item.Rule})
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
		{ID: "mandatory-directories", Source: "Wharness", Label: "Pastas protegidas", Enabled: true, Patterns: slashSuffix(mandatoryBlockedDirs), Description: "Nunca entram no contexto e não podem ser reativadas pelo projeto."},
		{ID: "mandatory-files", Source: "Wharness", Label: "Ficheiros/segredos protegidos", Enabled: true, Patterns: append(append([]string{}, mandatoryBlockedNames...), prefixStar(mandatoryBlockedExtensions)...), Description: "Credenciais, bases locais e material secreto são sempre bloqueados."},
		{ID: "harnessignore", Source: ".harnessignore", Label: "Regras .harnessignore", Enabled: len(LoadIgnorePatterns(root)) > 0, Patterns: LoadIgnorePatterns(root), Description: "Padrões adicionais definidos pelo próprio projeto."},
		{ID: "config-include", Source: projectconfig.FileName, Label: "Incluir apenas", Enabled: len(cfg.Context.Include) > 0, Patterns: cfg.Context.Include, Description: "Quando definido, ficheiros que não casam com estes padrões ficam fora do snapshot."},
		{ID: "config-exclude", Source: projectconfig.FileName, Label: "Excluir do contexto", Enabled: len(cfg.Context.Exclude) > 0, Patterns: cfg.Context.Exclude, Description: "Exclusões explícitas configuradas no projeto."},
		{ID: "auto-directories", Source: "Reconhecimento automático", Label: "Pastas sem valor para IA", Enabled: cfg.Context.AutoExclude, Patterns: autoDirs, Description: "Caches, metadados de IDE/VCS secundário, builds, ambientes e resultados de teste."},
		{ID: "auto-generated-files", Source: "Reconhecimento automático", Label: "Artefactos gerados", Enabled: cfg.Context.AutoExclude, Patterns: prefixStar(automaticGeneratedSuffixes), Description: "Logs, temporários, bytecode e binários gerados."},
		{ID: "auto-assets", Source: "Reconhecimento automático", Label: "Assets não-fonte", Enabled: cfg.Context.AutoExclude, Patterns: prefixStar(automaticAssetSuffixes), Description: "Arquivos, media e fontes que normalmente só aumentam o contexto."},
		{ID: "file-size", Source: projectconfig.FileName, Label: "Limite por ficheiro", Enabled: true, Patterns: []string{fmt.Sprintf("ficheiro > %d bytes", cfg.Context.MaxFileBytes)}, Description: "Ficheiros individuais acima do limite configurado são excluídos."},
		{ID: "bundle-limit", Source: "Wharness", Label: "Limite total do bundle", Enabled: true, Patterns: []string{fmt.Sprintf("bundle > %d bytes", b.maxBundleBytes)}, Description: "Impede um ZIP de contexto excessivamente grande."},
		{ID: "content-safety", Source: "Wharness", Label: "Inspeção de segurança de conteúdo", Enabled: true, Patterns: []string{"secret-like content", "symlink"}, Description: "Marcadores de segredo e symlinks são removidos antes do ZIP."},
		{ID: "binary-content", Source: "Reconhecimento automático", Label: "Conteúdo binário", Enabled: cfg.Context.AutoExclude, Patterns: []string{"non-text/binary content not explicitly included"}, Description: "Quando o reconhecimento automático está ativo, conteúdo binário sem inclusão explícita fica fora do contexto."},
	}
}

func rootEntries(root string, inventory []ContextInventoryEntry) ([]ContextRootEntry, error) {
	items, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	roots := make([]ContextRootEntry, 0, len(items))
	for _, item := range items {
		entry := ContextRootEntry{Path: item.Name(), Name: item.Name(), Kind: "file", Status: "not-in-snapshot"}
		if item.IsDir() {
			entry.Kind = "directory"
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
