package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectknowledge"
	"kernl.local/harness/backend/internal/session"
)

func zipEntries(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, value := range entries {
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
	return out.Bytes()
}

func knowledgeService(t *testing.T, entries ...domain.ProjectKnowledgeEntry) (*Service, *session.Store, string, string) {
	t.Helper()
	root := t.TempDir()
	store := session.NewStore()
	if len(entries) > 0 {
		if _, err := store.CompareAndSwapProjectKnowledgeCatalog(root, entries, "req-seed", 0); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	return service, store, started.ID, root
}

func TestExportCarriesEveryRecordWithItsDigest(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t,
		domain.ProjectKnowledgeEntry{ID: "apply-order", Content: "Persist after Apply."},
		domain.ProjectKnowledgeEntry{ID: "patch-dialect", Content: "Only unified diffs apply here."},
	)
	export, err := service.ExportProjectKnowledge(sessionID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if export.Protocol != KnowledgeExportProtocolV1 || len(export.Entries) != 2 || export.Selective {
		t.Fatalf("unexpected export: %+v", export)
	}
	for _, entry := range export.Entries {
		if entry.SHA256 != knowledgeDigest(entry.Content) {
			t.Fatalf("export digest does not match content for %q", entry.ID)
		}
	}
}

// A selection naming a record that does not exist produces a bundle whose
// recipient cannot tell what is missing, so it is refused rather than silently
// exporting fewer records than asked for.
func TestSelectiveExportRefusesUnknownRecords(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t, domain.ProjectKnowledgeEntry{ID: "apply-order", Content: "Persist after Apply."})
	if _, err := service.ExportProjectKnowledge(sessionID, []string{"apply-order", "does-not-exist"}); err == nil {
		t.Fatal("expected a refusal naming the unknown record")
	}
	export, err := service.ExportProjectKnowledge(sessionID, []string{"apply-order"})
	if err != nil {
		t.Fatal(err)
	}
	if !export.Selective || len(export.Entries) != 1 {
		t.Fatalf("expected a selective export of one record: %+v", export)
	}
}

// An edited or truncated transfer must be refused, not quietly installed as
// project truth that later requests will reason from.
func TestImportRefusesABundleWhoseContentDoesNotMatchItsDigest(t *testing.T) {
	raw := []byte(`{"protocol":"harness.knowledge-export/v1","exported_at":"2026-01-01T00:00:00Z","entries":[{"id":"a","content":"tampered","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}`)
	if _, err := ParseKnowledgeExport(raw); err == nil || !strings.Contains(err.Error(), "sha256") {
		t.Fatalf("expected a digest mismatch refusal, got %v", err)
	}
}

// A selective bundle does not describe the records it omits, so treating its
// absences as removals would destroy knowledge the exporter never spoke about.
func TestSelectiveBundleMayNotReplaceACatalog(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t, domain.ProjectKnowledgeEntry{ID: "keep-me", Content: "Proven locally."})
	export := KnowledgeExport{Protocol: KnowledgeExportProtocolV1, Selective: true, Entries: []KnowledgeExportEntry{{ID: "other", Content: "Imported."}}}
	if _, err := service.ImportProjectKnowledge(sessionID, export, KnowledgeImportReplace, nil); err == nil {
		t.Fatal("a selective export must not be allowed to replace a catalog")
	}
}

func TestImportModesAddReplaceAndPreserve(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t,
		domain.ProjectKnowledgeEntry{ID: "shared", Content: "local version"},
		domain.ProjectKnowledgeEntry{ID: "local-only", Content: "earned here"},
	)
	export := KnowledgeExport{Protocol: KnowledgeExportProtocolV1, Entries: []KnowledgeExportEntry{
		{ID: "shared", Content: "imported version"},
		{ID: "imported-only", Content: "from a peer"},
	}}

	report, err := service.ImportProjectKnowledge(sessionID, export, KnowledgeImportMergeKeepLocal, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(report.Kept, "shared") || !containsString(report.Added, "imported-only") {
		t.Fatalf("merge_keep_local must keep the local record and add the new one: %+v", report)
	}
	catalog, err := service.ProjectKnowledgeCatalog(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range catalog.Entries {
		if entry.ID == "shared" && entry.Content != "local version" {
			t.Fatalf("merge_keep_local overwrote a locally proven record: %+v", entry)
		}
	}

	if report, err = service.ImportProjectKnowledge(sessionID, export, KnowledgeImportMerge, nil); err != nil {
		t.Fatal(err)
	}
	if !containsString(report.Replaced, "shared") {
		t.Fatalf("merge must let the import win on a collision: %+v", report)
	}

	report, err = service.ImportProjectKnowledge(sessionID, export, KnowledgeImportReplace, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(report.Removed, "local-only") {
		t.Fatalf("replace must report what it removed: %+v", report)
	}
	catalog, err = service.ProjectKnowledgeCatalog(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Entries) != 2 {
		t.Fatalf("replace must install exactly the bundle: %+v", catalog.Entries)
	}
}

// Clearing destroys learning that took real execution rounds to earn.
func TestClearRequiresExplicitConfirmation(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t, domain.ProjectKnowledgeEntry{ID: "apply-order", Content: "Persist after Apply."})
	if _, err := service.ClearProjectKnowledge(sessionID, nil, false); err == nil {
		t.Fatal("clearing knowledge must require explicit confirmation")
	}
	catalog, err := service.ProjectKnowledgeCatalog(sessionID)
	if err != nil || len(catalog.Entries) != 1 {
		t.Fatalf("an unconfirmed clear must change nothing: %+v", catalog)
	}
}

func TestClearRemovesEverythingOrOnlyTheNamedRecords(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t,
		domain.ProjectKnowledgeEntry{ID: "one", Content: "first"},
		domain.ProjectKnowledgeEntry{ID: "two", Content: "second"},
	)
	report, err := service.ClearProjectKnowledge(sessionID, []string{"one"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Removed) != 1 || report.Removed[0] != "one" {
		t.Fatalf("selective clear removed the wrong records: %+v", report)
	}
	catalog, err := service.ProjectKnowledgeCatalog(sessionID)
	if err != nil || len(catalog.Entries) != 1 || catalog.Entries[0].ID != "two" {
		t.Fatalf("selective clear must keep the unnamed records: %+v", catalog)
	}
	if _, err = service.ClearProjectKnowledge(sessionID, nil, true); err != nil {
		t.Fatal(err)
	}
	catalog, err = service.ProjectKnowledgeCatalog(sessionID)
	if err != nil || len(catalog.Entries) != 0 {
		t.Fatalf("a full clear must empty the catalog: %+v", catalog)
	}
}

// Upgrading must not look like losing every lesson a project had earned.
func TestLegacyProjectFilesAreAdoptedOnceIntoTheDatabase(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	if err := projectknowledge.Save(root, []domain.ProjectKnowledgeEntry{{ID: "legacy-lesson", Content: "Committed before the migration."}}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := service.ProjectKnowledgeCatalog(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Entries) != 1 || catalog.Entries[0].ID != "legacy-lesson" {
		t.Fatalf("committed project knowledge was not adopted: %+v", catalog)
	}
	// Adoption is one-way: a later edit to the files must not resurrect them as
	// a store, because the database is now the authority.
	if err := projectknowledge.Save(root, []domain.ProjectKnowledgeEntry{{ID: "edited-on-disk", Content: "Should not be picked up."}}); err != nil {
		t.Fatal(err)
	}
	catalog, err = service.ProjectKnowledgeCatalog(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Entries) != 1 || catalog.Entries[0].ID != "legacy-lesson" {
		t.Fatalf("project files must not be re-synchronized after adoption: %+v", catalog)
	}
}

func TestConsolidationNeedsSomethingToConsolidate(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t, domain.ProjectKnowledgeEntry{ID: "only-one", Content: "single record"})
	if _, err := service.StartKnowledgeConsolidation(context.Background(), sessionID); err == nil {
		t.Fatal("consolidating a single-record catalog has nothing to do")
	}
}

// Consolidation reorganizes; it must never become a way to delete everything.
func TestConsolidationRefusesAnEmptyResult(t *testing.T) {
	service, _, sessionID, root := knowledgeService(t,
		domain.ProjectKnowledgeEntry{ID: "one", Content: "first"},
		domain.ProjectKnowledgeEntry{ID: "two", Content: "second"},
	)
	prepared, err := service.StartKnowledgeConsolidation(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := prepared.LastRequestID
	if !strings.Contains(prepared.LastManualPrompt, "KNOWLEDGE CONSOLIDATION") {
		t.Fatalf("consolidation prompt was not prepared: %q", prepared.LastManualPrompt)
	}
	entries := map[string]string{
		"README.md":            "# Consolidation\n",
		"turn.json":            `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"merged","outcome":{"status":"completed","retryable":false}}`,
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":1,"mode":"replace","entries":[]}`,
	}
	if _, err := service.SubmitExecutionBundle(context.Background(), sessionID, "whx_bundle_res_system_"+requestID+".zip", zipEntries(t, entries)); err == nil {
		t.Fatal("an empty consolidation result must be refused")
	}
	catalog, err := service.ProjectKnowledgeCatalog(sessionID)
	if err != nil || len(catalog.Entries) != 2 {
		t.Fatalf("a refused consolidation must leave the catalog intact: %+v", catalog)
	}
	if _, present, _ := projectknowledge.Load(root); present {
		t.Fatal("consolidation must not write into the project tree")
	}
}

func TestConsolidationInstallsTheReorganizedCatalog(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t,
		domain.ProjectKnowledgeEntry{ID: "one", Content: "first"},
		domain.ProjectKnowledgeEntry{ID: "two", Content: "second"},
	)
	prepared, err := service.StartKnowledgeConsolidation(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := prepared.LastRequestID
	merged := "first and second, merged"
	entries := map[string]string{
		"README.md":            "# Consolidation\n",
		"turn.json":            `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"merged one and two","outcome":{"status":"completed","retryable":false}}`,
		"knowledge/index.json": `{"protocol":"harness.knowledge/v2","base_revision":1,"mode":"replace","entries":[{"id":"one","file":"knowledge/one.md","sha256":"` + knowledgeDigest(merged) + `"}]}`,
		"knowledge/one.md":     merged,
	}
	if _, err := service.SubmitExecutionBundle(context.Background(), sessionID, "whx_bundle_res_system_"+requestID+".zip", zipEntries(t, entries)); err != nil {
		t.Fatal(err)
	}
	catalog, err := service.ProjectKnowledgeCatalog(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Entries) != 1 || catalog.Entries[0].ID != "one" || catalog.Entries[0].Content != merged {
		t.Fatalf("consolidated catalog was not installed: %+v", catalog.Entries)
	}
	if catalog.Revision <= 1 {
		t.Fatalf("consolidation must advance the catalog revision, got %d", catalog.Revision)
	}
}

// The bundle must round-trip: what an export writes, an import must accept.
func TestExportRoundTripsThroughTheWireFormat(t *testing.T) {
	service, _, sessionID, _ := knowledgeService(t,
		domain.ProjectKnowledgeEntry{ID: "apply-order", Content: "Persist after Apply."},
		domain.ProjectKnowledgeEntry{ID: "patch-dialect", Content: "Only unified diffs apply here."},
	)
	export, err := service.ExportProjectKnowledge(sessionID, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(export)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseKnowledgeExport(raw)
	if err != nil {
		t.Fatalf("an exported bundle must be importable: %v", err)
	}
	if len(parsed.Entries) != 2 {
		t.Fatalf("round trip lost records: %+v", parsed.Entries)
	}
}
