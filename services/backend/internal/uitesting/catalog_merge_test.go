package uitesting

import (
	"reflect"
	"strings"
	"testing"
)

func seededStore(t *testing.T) (*Store, string) {
	t.Helper()
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/merge"
	_, err = store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, ContextSHA256: "ctx-1",
		Environments: []Environment{{ID: "web", Name: "Web", Profiles: []Profile{{ID: "admin", Label: "Admin", Role: "admin"}}}},
		Tests: []TestCase{
			{ID: "home", Title: "Home", Goal: "Open home", EnvironmentID: "web", Access: AccessPublic},
			{ID: "login", Title: "Login", Goal: "Sign in", EnvironmentID: "web", Access: AccessAuthenticated, ProfileID: "admin"},
			{ID: "create-item", Title: "Criar", Goal: "Create", EnvironmentID: "web", Access: AccessAuthenticated, DependsOn: []string{"login"}},
		}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Configure(project, "web", "admin", "https://app.test", "alice", "secret"); err != nil {
		t.Fatal(err)
	}
	return store, project
}

func TestSyncMergesIncrementallyAndKeepsLocalState(t *testing.T) {
	store, project := seededStore(t)
	if _, err := store.BeginRun(project, Run{ID: "run_1", TestID: "home"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteRun(project, Run{ID: "run_1"}, RunResult{Status: "passed"}); err != nil {
		t.Fatal(err)
	}
	doc, err := store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, ContextSHA256: "ctx-2", Summary: "1 novo",
		Environments: []Environment{{ID: "web", Name: "Web app", Profiles: []Profile{{ID: "viewer", Label: "Leitor", Role: "viewer"}}}},
		Tests: []TestCase{
			{ID: "home", Title: "Home", Goal: "Open home", EnvironmentID: "web", Access: AccessPublic},
			{ID: "logout", Title: "Logout", Goal: "Sign out", EnvironmentID: "web", Access: AccessAuthenticated, DependsOn: []string{"login"}},
		}})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(doc.Tests); !reflect.DeepEqual(got, []string{"home", "login", "create-item", "logout"}) {
		t.Fatalf("omitted tests must survive an incremental sync: %v", got)
	}
	if doc.Tests[0].Status != "passed" || doc.Tests[0].LastRunID != "run_1" {
		t.Fatalf("an unchanged definition must keep its outcome: %#v", doc.Tests[0])
	}
	env := doc.Environments[0]
	if env.URL != "https://app.test" || env.Name != "Web app" || len(env.Profiles) != 2 || !env.Profiles[0].Configured {
		t.Fatalf("local configuration lost: %#v", env)
	}
	if doc.SyncSummary != "1 novo" || doc.ContextSHA256 != "ctx-2" {
		t.Fatalf("summary=%q ctx=%q", doc.SyncSummary, doc.ContextSHA256)
	}
}

func TestSyncNeverOverwritesOrRetiresOperatorTests(t *testing.T) {
	store, project := seededStore(t)
	doc, err := store.BeginDesign(project, DesignRequest{TaskID: "cat_design", Brief: "Testar exportação CSV"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err = store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginDesign, Tests: []TestCase{
		{ID: "export-csv", Title: "Exportar", Goal: "Export", EnvironmentID: "web", Access: AccessAuthenticated, DependsOn: []string{"login"}},
	}}, "cat_design")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Designs[0].Status != "done" || !reflect.DeepEqual(doc.Designs[0].TestIDs, []string{"export-csv"}) {
		t.Fatalf("design=%#v", doc.Designs[0])
	}
	designed := doc.Tests[len(doc.Tests)-1]
	if designed.Source != SourceUser || designed.Brief != "Testar exportação CSV" {
		t.Fatalf("designed test lost its provenance: %#v", designed)
	}
	doc, err = store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync,
		Tests:           []TestCase{{ID: "export-csv", Title: "Outro", Goal: "Other", EnvironmentID: "web", Access: AccessPublic}},
		ObsoleteTestIDs: []string{"export-csv", "home", "login"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(doc.Tests); !reflect.DeepEqual(got, []string{"login", "create-item", "export-csv"}) {
		t.Fatalf("retirement must spare operator tests and prerequisites: %v", got)
	}
	if doc.Tests[2].Title != "Exportar" {
		t.Fatal("a sync overwrote an operator-requested test")
	}
}

func TestMergeRejectsAnInvalidCatalogWithoutSavingIt(t *testing.T) {
	cases := map[string]TestCase{
		"cycle":             {ID: "login", Title: "Login", Goal: "Sign in", EnvironmentID: "web", Access: AccessAuthenticated, ProfileID: "admin", DependsOn: []string{"create-item"}},
		"public with role":  {ID: "about", Title: "Sobre", Goal: "Open", EnvironmentID: "web", Access: AccessPublic, DependsOn: []string{"login"}},
		"orphan auth":       {ID: "settings", Title: "Definições", Goal: "Open", EnvironmentID: "web", Access: AccessAuthenticated},
		"unknown env":       {ID: "x", Title: "X", Goal: "X", EnvironmentID: "mobile", Access: AccessPublic},
		"unknown dependent": {ID: "y", Title: "Y", Goal: "Y", EnvironmentID: "web", Access: AccessPublic, DependsOn: []string{"ghost"}},
	}
	for name, test := range cases {
		t.Run(name, func(t *testing.T) {
			store, project := seededStore(t)
			if _, err := store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, ContextSHA256: "ctx-x", Tests: []TestCase{test}}); err == nil {
				t.Fatal("invalid catalog accepted")
			}
			doc, _ := store.Load(project)
			if doc.ContextSHA256 != "ctx-1" || len(doc.Tests) != 3 {
				t.Fatalf("rejected discovery changed the store: %#v", doc)
			}
		})
	}
}

func TestCatalogInputCarriesConfigurationButNoSecrets(t *testing.T) {
	store, project := seededStore(t)
	doc, _ := store.Load(project)
	input := NewCatalogInput(doc)
	if !input.Environments[0].URLConfigured || !input.Environments[0].Profiles[0].Configured || input.Tests[0].Source != SourceDiscovered {
		t.Fatalf("catalog input=%#v", input)
	}
	_, bundle, err := BuildDiscoveryRequestV2(DiscoveryInput{TaskID: "cat_1234567890abcdef1234", Task: DiscoveryTask,
		ContextSHA256: strings.Repeat("a", 64), ContextArchive: []byte("ctx"), Catalog: input})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bundle), "secret") || strings.Contains(string(bundle), "alice") {
		t.Fatal("credentials leaked into the discovery request")
	}
}

func ids(tests []TestCase) []string {
	out := []string{}
	for _, test := range tests {
		out = append(out, test.ID)
	}
	return out
}

func TestSyncRetiresAnOutOfScopeEnvironmentWithItsTests(t *testing.T) {
	store, project := seededStore(t)
	if _, err := store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, Environments: []Environment{{ID: "kiosk", Name: "Kiosk"}},
		Tests: []TestCase{{ID: "kiosk-pair", Title: "Emparelhar", Goal: "Pair", EnvironmentID: "kiosk", Access: AccessPublic}}}); err != nil {
		t.Fatal(err)
	}
	doc, err := store.SaveDiscovery(project, Discovery{Origin: DiscoveryOriginSync, ObsoleteEnvironmentIDs: []string{"kiosk"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, env := range doc.Environments {
		if env.ID == "kiosk" {
			t.Fatal("out-of-scope environment kept")
		}
	}
	for _, test := range doc.Tests {
		if test.EnvironmentID == "kiosk" {
			t.Fatal("out-of-scope test kept")
		}
	}
	if len(doc.Tests) != 3 {
		t.Fatalf("in-scope tests changed: %v", ids(doc.Tests))
	}
}
