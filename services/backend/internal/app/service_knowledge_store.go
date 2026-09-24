package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectknowledge"
	"kernl.local/harness/backend/internal/session"
)

const (
	// KnowledgeExportProtocolV1 identifies the portable knowledge bundle.
	//
	// Knowledge now lives in the local database rather than in committed
	// project files, so sharing is an explicit act with an explicit artifact
	// instead of a side effect of `git pull`. That is the point: a developer
	// chooses what to hand over and a recipient chooses what to take, rather
	// than every checkout silently inheriting another machine's conclusions.
	KnowledgeExportProtocolV1 = "harness.knowledge-export/v1"

	// KnowledgeImportReplace discards the current catalog and installs exactly
	// the imported records.
	KnowledgeImportReplace = "replace"
	// KnowledgeImportMerge keeps existing records and adds imported ones,
	// with the import winning on an id collision.
	KnowledgeImportMerge = "merge"
	// KnowledgeImportMergeKeepLocal is the same as merge, except a collision
	// keeps the local record. Used when adopting someone else's bundle without
	// letting it overwrite conclusions this machine proved for itself.
	KnowledgeImportMergeKeepLocal = "merge_keep_local"

	maxKnowledgeImportBytes = 1 << 20
)

// KnowledgeExportEntry is one exported record. The digest travels so an import
// can tell a truncated or edited transfer from an intact one.
type KnowledgeExportEntry struct {
	ID                 string    `json:"id"`
	Content            string    `json:"content"`
	Category           string    `json:"category,omitempty"`
	SHA256             string    `json:"sha256"`
	Version            int       `json:"version,omitempty"`
	UpdatedAt          time.Time `json:"updated_at,omitempty"`
	UpdatedByRequestID string    `json:"updated_by_request_id,omitempty"`
}

// KnowledgeExport is the portable bundle produced by an export and consumed by
// an import. ProjectPath and Revision are provenance only: a bundle is
// importable into any project, because knowledge about how to work on a
// codebase is frequently worth carrying between checkouts of it.
type KnowledgeExport struct {
	Protocol    string                 `json:"protocol"`
	ProjectPath string                 `json:"project_path,omitempty"`
	Revision    int64                  `json:"revision,omitempty"`
	ExportedAt  time.Time              `json:"exported_at"`
	Selective   bool                   `json:"selective,omitempty"`
	Entries     []KnowledgeExportEntry `json:"entries"`
}

// KnowledgeImportReport says what an import actually did. An import that
// silently reported success while dropping records to a validation limit would
// be worse than a refusal, so every disposition is named.
type KnowledgeImportReport struct {
	Mode     string   `json:"mode"`
	Added    []string `json:"added,omitempty"`
	Replaced []string `json:"replaced,omitempty"`
	Kept     []string `json:"kept,omitempty"`
	Removed  []string `json:"removed,omitempty"`
	Skipped  []string `json:"skipped,omitempty"`
	Revision int64    `json:"revision"`
}

// ProjectKnowledgeCatalog returns the durable catalog for a session's project.
func (s *Service) ProjectKnowledgeCatalog(sessionID string) (domain.ProjectKnowledgeCatalog, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	return s.loadProjectKnowledgeCatalog(sessionID, item.ProjectPath)
}

// ExportProjectKnowledge produces a portable bundle. An empty ids selection
// exports everything; a non-empty one exports exactly those records and marks
// the bundle selective, so a later import knows it is not a complete catalog
// and must never be treated as authority to delete what it omits.
func (s *Service) ExportProjectKnowledge(sessionID string, ids []string) (KnowledgeExport, error) {
	catalog, err := s.ProjectKnowledgeCatalog(sessionID)
	if err != nil {
		return KnowledgeExport{}, err
	}
	selection := normalizedKnowledgeIDs(ids)
	wanted := make(map[string]bool, len(selection))
	for _, id := range selection {
		wanted[id] = true
	}
	export := KnowledgeExport{
		Protocol: KnowledgeExportProtocolV1, ProjectPath: catalog.ProjectPath, Revision: catalog.Revision,
		ExportedAt: time.Now().UTC(), Selective: len(wanted) > 0, Entries: make([]KnowledgeExportEntry, 0, len(catalog.Entries)),
	}
	found := make(map[string]bool, len(wanted))
	for _, entry := range catalog.Entries {
		if len(wanted) > 0 && !wanted[entry.ID] {
			continue
		}
		found[entry.ID] = true
		content := strings.TrimSpace(entry.Content)
		export.Entries = append(export.Entries, KnowledgeExportEntry{
			ID: entry.ID, Content: content, Category: domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, content), SHA256: knowledgeDigest(content),
			Version: entry.Version, UpdatedAt: entry.UpdatedAt, UpdatedByRequestID: entry.UpdatedByRequestID,
		})
	}
	// A selection naming a record that does not exist is a caller mistake worth
	// surfacing: silently exporting fewer records than asked for produces a
	// bundle whose recipient cannot tell what is missing.
	missing := make([]string, 0)
	for _, id := range selection {
		if !found[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		return KnowledgeExport{}, fmt.Errorf("unknown knowledge records: %s", strings.Join(missing, ", "))
	}
	if s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.exported", map[string]any{
			"entries": len(export.Entries), "selective": export.Selective, "revision": catalog.Revision,
		})
	}
	return export, nil
}

// ParseKnowledgeExport validates a bundle before it can be imported. Content is
// verified against its own digest so an edited or truncated transfer is refused
// rather than quietly installed as project truth.
func ParseKnowledgeExport(raw []byte) (KnowledgeExport, error) {
	if len(raw) == 0 || len(raw) > maxKnowledgeImportBytes {
		return KnowledgeExport{}, fmt.Errorf("knowledge export must be between 1 byte and %d bytes", maxKnowledgeImportBytes)
	}
	var export KnowledgeExport
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&export); err != nil {
		return KnowledgeExport{}, fmt.Errorf("decode knowledge export: %w", err)
	}
	if export.Protocol != KnowledgeExportProtocolV1 {
		return KnowledgeExport{}, fmt.Errorf("knowledge export protocol must be %q", KnowledgeExportProtocolV1)
	}
	seen := make(map[string]bool, len(export.Entries))
	for index, entry := range export.Entries {
		id := strings.TrimSpace(strings.ToLower(entry.ID))
		content := strings.TrimSpace(entry.Content)
		if id == "" || content == "" {
			return KnowledgeExport{}, fmt.Errorf("knowledge export entry %d is incomplete", index)
		}
		if seen[id] {
			return KnowledgeExport{}, fmt.Errorf("duplicate knowledge id %q in export", id)
		}
		seen[id] = true
		if digest := strings.ToLower(strings.TrimSpace(entry.SHA256)); digest != "" && digest != knowledgeDigest(content) {
			return KnowledgeExport{}, fmt.Errorf("knowledge %q sha256 does not match its content", id)
		}
		if entry.Category != "" && !domain.IsKnowledgeCategory(entry.Category) {
			return KnowledgeExport{}, fmt.Errorf("knowledge %q has unsupported category %q", id, entry.Category)
		}
		export.Entries[index].ID = id
		export.Entries[index].Content = content
		export.Entries[index].Category = domain.NormalizeKnowledgeCategory(entry.Category, id, content)
	}
	return export, nil
}

// ImportProjectKnowledge installs records from a bundle.
//
// A selective bundle may never delete: it does not describe a complete catalog,
// so treating its absences as removals would destroy records the exporter never
// meant to speak about. `replace` on a selective bundle is therefore refused
// rather than reinterpreted.
func (s *Service) ImportProjectKnowledge(sessionID string, export KnowledgeExport, mode string, ids []string) (KnowledgeImportReport, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return KnowledgeImportReport{}, err
	}
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "" {
		mode = KnowledgeImportMerge
	}
	switch mode {
	case KnowledgeImportReplace, KnowledgeImportMerge, KnowledgeImportMergeKeepLocal:
	default:
		return KnowledgeImportReport{}, fmt.Errorf("unsupported knowledge import mode %q", mode)
	}
	if mode == KnowledgeImportReplace && export.Selective {
		return KnowledgeImportReport{}, errors.New("a selective export cannot replace a catalog: it does not describe the records it omits")
	}
	selection := normalizedKnowledgeIDs(ids)
	wanted := make(map[string]bool, len(selection))
	for _, id := range selection {
		wanted[id] = true
	}

	report := KnowledgeImportReport{Mode: mode}
	for attempt := 0; attempt < 3; attempt++ {
		current, err := s.loadProjectKnowledgeCatalog(sessionID, item.ProjectPath)
		if err != nil {
			return KnowledgeImportReport{}, err
		}
		desired, applied := applyKnowledgeImport(current.Entries, export.Entries, mode, wanted)
		report = applied
		if sameKnowledgeCatalog(desired, current.Entries) {
			report.Revision = current.Revision
			break
		}
		saved, err := s.store.CompareAndSwapProjectKnowledgeCatalog(item.ProjectPath, desired, "knowledge-import", current.Revision)
		if err == nil {
			report.Revision = saved.Revision
			break
		}
		if !errors.Is(err, session.ErrProjectKnowledgeConflict) || attempt == 2 {
			return KnowledgeImportReport{}, fmt.Errorf("import project knowledge: %w", err)
		}
	}
	if s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.imported", map[string]any{
			"mode": report.Mode, "revision": report.Revision, "added": len(report.Added),
			"replaced": len(report.Replaced), "kept": len(report.Kept), "removed": len(report.Removed), "skipped": len(report.Skipped),
		})
	}
	return report, nil
}

func applyKnowledgeImport(current []domain.ProjectKnowledgeEntry, incoming []KnowledgeExportEntry, mode string, wanted map[string]bool) ([]domain.ProjectKnowledgeEntry, KnowledgeImportReport) {
	report := KnowledgeImportReport{Mode: mode}
	existing := make(map[string]domain.ProjectKnowledgeEntry, len(current))
	for _, entry := range current {
		existing[entry.ID] = entry
	}
	result := make(map[string]domain.ProjectKnowledgeEntry, len(current)+len(incoming))
	if mode != KnowledgeImportReplace {
		for id, entry := range existing {
			result[id] = entry
		}
	}
	for _, entry := range incoming {
		if len(wanted) > 0 && !wanted[entry.ID] {
			report.Skipped = append(report.Skipped, entry.ID)
			continue
		}
		previous, collides := existing[entry.ID]
		if collides && mode == KnowledgeImportMergeKeepLocal {
			report.Kept = append(report.Kept, entry.ID)
			continue
		}
		category := domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, entry.Content)
		result[entry.ID] = domain.ProjectKnowledgeEntry{ID: entry.ID, Content: entry.Content, Category: category}
		switch {
		case collides && strings.TrimSpace(previous.Content) == entry.Content && domain.NormalizeKnowledgeCategory(previous.Category, previous.ID, previous.Content) == category:
			report.Kept = append(report.Kept, entry.ID)
		case collides:
			report.Replaced = append(report.Replaced, entry.ID)
		default:
			report.Added = append(report.Added, entry.ID)
		}
	}
	if mode == KnowledgeImportReplace {
		for id := range existing {
			if _, survives := result[id]; !survives {
				report.Removed = append(report.Removed, id)
			}
		}
	}
	out := make([]domain.ProjectKnowledgeEntry, 0, len(result))
	for _, entry := range result {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	sort.Strings(report.Added)
	sort.Strings(report.Replaced)
	sort.Strings(report.Kept)
	sort.Strings(report.Removed)
	sort.Strings(report.Skipped)
	return out, report
}

// ClearProjectKnowledge empties the catalog, or removes exactly the named
// records.
//
// This destroys accumulated learning that took real execution rounds to earn,
// so the caller must confirm explicitly at the API boundary. Wharnex does not
// take that decision on anyone's behalf, and does not offer it as a cleanup
// step inside another operation.
func (s *Service) ClearProjectKnowledge(sessionID string, ids []string, confirmed bool) (KnowledgeImportReport, error) {
	if !confirmed {
		return KnowledgeImportReport{}, errors.New("clearing project knowledge requires explicit confirmation")
	}
	item, err := s.store.Get(sessionID)
	if err != nil {
		return KnowledgeImportReport{}, err
	}
	selection := normalizedKnowledgeIDs(ids)
	doomed := make(map[string]bool, len(selection))
	for _, id := range selection {
		doomed[id] = true
	}
	report := KnowledgeImportReport{Mode: "clear"}
	for attempt := 0; attempt < 3; attempt++ {
		current, err := s.loadProjectKnowledgeCatalog(sessionID, item.ProjectPath)
		if err != nil {
			return KnowledgeImportReport{}, err
		}
		desired := make([]domain.ProjectKnowledgeEntry, 0, len(current.Entries))
		removed := make([]string, 0, len(current.Entries))
		for _, entry := range current.Entries {
			if len(doomed) == 0 || doomed[entry.ID] {
				removed = append(removed, entry.ID)
				continue
			}
			desired = append(desired, entry)
		}
		report.Removed = removed
		if len(removed) == 0 {
			report.Revision = current.Revision
			break
		}
		saved, err := s.store.CompareAndSwapProjectKnowledgeCatalog(item.ProjectPath, desired, "knowledge-clear", current.Revision)
		if err == nil {
			report.Revision = saved.Revision
			break
		}
		if !errors.Is(err, session.ErrProjectKnowledgeConflict) || attempt == 2 {
			return KnowledgeImportReport{}, fmt.Errorf("clear project knowledge: %w", err)
		}
	}
	if s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.cleared", map[string]any{
			"removed": len(report.Removed), "revision": report.Revision, "selective": len(selection) > 0,
		})
	}
	return report, nil
}

// AdoptLegacyProjectKnowledgeFiles imports a project's `.wharnex/knowledge/`
// Markdown files into the database once.
//
// Those files used to be the collaboration surface, synchronized into the
// catalog on every request. The database is now the authoritative store, so
// this exists to make the transition non-destructive: a project that already
// carries committed knowledge adopts it instead of appearing to have lost it.
// It is one-way and idempotent — the files are never written again, and a
// project whose catalog already exists is left alone.
func (s *Service) AdoptLegacyProjectKnowledgeFiles(sessionID string) (KnowledgeImportReport, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return KnowledgeImportReport{}, err
	}
	fileEntries, present, err := projectknowledge.Load(item.ProjectPath)
	if err != nil {
		return KnowledgeImportReport{}, fmt.Errorf("read %s: %w", projectknowledge.DirectoryName, err)
	}
	if !present || len(fileEntries) == 0 {
		return KnowledgeImportReport{Mode: "adopt"}, nil
	}
	incoming := make([]KnowledgeExportEntry, 0, len(fileEntries))
	for _, entry := range fileEntries {
		incoming = append(incoming, KnowledgeExportEntry{ID: entry.ID, Content: strings.TrimSpace(entry.Content), Category: domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, entry.Content)})
	}
	// Local records win: this machine's own catalog was earned by execution
	// here, while the files may be an older snapshot someone committed.
	return s.ImportProjectKnowledge(sessionID, KnowledgeExport{
		Protocol: KnowledgeExportProtocolV1, Selective: true, Entries: incoming,
	}, KnowledgeImportMergeKeepLocal, nil)
}

func normalizedKnowledgeIDs(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(strings.ToLower(id))
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
