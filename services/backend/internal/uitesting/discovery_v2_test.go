package uitesting

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func v2Request(t *testing.T, task, brief string) (DiscoveryTransportManifest, map[string][]byte) {
	t.Helper()
	manifest, bundle, err := BuildDiscoveryRequestV2(DiscoveryInput{TaskID: "cat_1234567890abcdef1234", Task: task, Brief: brief,
		ContextSHA256: strings.Repeat("b", 64), ContextArchive: []byte("ctx"), Catalog: CatalogInput{Protocol: CatalogInputProtocolV1}})
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string][]byte{}
	for _, entry := range reader.File {
		opened, _ := entry.Open()
		entries[entry.Name], _ = io.ReadAll(opened)
		opened.Close()
	}
	return manifest, entries
}

func v2Answer(t *testing.T, manifest DiscoveryTransportManifest, mutate func(*DiscoveryResultV2)) []byte {
	t.Helper()
	result := DiscoveryResultV2{Protocol: DiscoveryResultProtocolV2, Task: manifest.Task, TaskID: manifest.TaskID,
		ContextSHA256: manifest.ContextSHA256, SourceSHA256: manifest.SourceSHA256, CatalogSHA256: manifest.CatalogSHA256,
		Environments: []Environment{}, ObsoleteTestIDs: []string{},
		Tests: []TestCase{{ID: "login", Title: "Login", Goal: "Sign in", EnvironmentID: "web", Access: AccessAuthenticated, ProfileID: "admin",
			Steps: []StrategyStep{{Action: "Abrir /login", Expected: "Formulário visível"}}}}}
	if mutate != nil {
		mutate(&result)
	}
	payload, _ := json.Marshal(result)
	return discoveryResultBundle(t, payload)
}

func TestV2RequestCarriesCatalogAndOnlyADesignCarriesABrief(t *testing.T) {
	manifest, entries := v2Request(t, DiscoveryTask, "")
	if _, ok := entries[DiscoveryCatalogPath]; !ok || manifest.CatalogSHA256 == "" {
		t.Fatal("sync request omits the current catalog")
	}
	if _, ok := entries[DiscoveryBriefPath]; ok {
		t.Fatal("sync request carries a brief")
	}
	design, entries := v2Request(t, DesignTask, "Testar login com senha errada")
	if string(entries[DiscoveryBriefPath]) != "Testar login com senha errada\n" || design.BriefPath != DiscoveryBriefPath {
		t.Fatal("design request lost its brief")
	}
	if strings.Contains(DiscoveryRequestBootstrap(design), "senha errada") {
		t.Fatal("brief leaked into the composer bootstrap")
	}
	if _, _, err := BuildDiscoveryRequestV2(DiscoveryInput{TaskID: design.TaskID, Task: DesignTask, ContextSHA256: strings.Repeat("b", 64), ContextArchive: []byte("x")}); err == nil {
		t.Fatal("design without brief accepted")
	}
}

func TestV2ResultIsBoundToTheCatalogItWasAskedAbout(t *testing.T) {
	manifest, _ := v2Request(t, DiscoveryTask, "")
	discovery, err := ParseDiscoveryResult(manifest.ResultFilename, v2Answer(t, manifest, nil), manifest)
	if err != nil || discovery.Origin != DiscoveryOriginSync || len(discovery.Tests[0].Steps) != 1 {
		t.Fatalf("discovery=%#v err=%v", discovery, err)
	}
	rejections := map[string]func(*DiscoveryResultV2){
		"catalog hash":     func(r *DiscoveryResultV2) { r.CatalogSHA256 = strings.Repeat("0", 64) },
		"v1 protocol":      func(r *DiscoveryResultV2) { r.Protocol = DiscoveryResultProtocolV1 },
		"missing access":   func(r *DiscoveryResultV2) { r.Tests[0].Access = "" },
		"public with role": func(r *DiscoveryResultV2) { r.Tests[0].Access = AccessPublic },
		"retire and add":   func(r *DiscoveryResultV2) { r.ObsoleteTestIDs = []string{"login"} },
		"too many steps": func(r *DiscoveryResultV2) {
			r.Tests[0].Steps = make([]StrategyStep, maxStrategySteps+1)
			for i := range r.Tests[0].Steps {
				r.Tests[0].Steps[i].Action = "x"
			}
		},
	}
	for name, mutate := range rejections {
		if _, err := ParseDiscoveryResult(manifest.ResultFilename, v2Answer(t, manifest, mutate), manifest); err == nil {
			t.Fatalf("%s: invalid answer accepted", name)
		}
	}
	design, _ := v2Request(t, DesignTask, "brief")
	if _, err := ParseDiscoveryResult(design.ResultFilename, v2Answer(t, design, func(r *DiscoveryResultV2) { r.Tests = nil }), design); err == nil {
		t.Fatal("a design answer that adds nothing was accepted")
	}
	if got, err := ParseDiscoveryResult(design.ResultFilename, v2Answer(t, design, nil), design); err != nil || got.Origin != DiscoveryOriginDesign {
		t.Fatalf("design origin=%q err=%v", got.Origin, err)
	}
}
