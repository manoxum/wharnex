package oplog

import (
	"testing"
	"time"
)

func TestDossierReadsAsATimelineAndSummarizesItsShape(t *testing.T) {
	now := time.Date(2026, 9, 25, 18, 0, 0, 0, time.UTC)
	newestFirst := []Record{
		{Event: "execution.failed", Level: LevelError, Source: SourceBackend, Component: "execution", RequestID: "req_2", OccurredAt: now},
		{Event: "chatgpt-upload", Level: LevelWarning, Source: SourceDesktop, Component: "chatgpt-upload", RequestID: "req_1", OccurredAt: now.Add(-time.Minute)},
		{Event: "host.apply_started", Level: LevelInfo, Source: SourceBackend, Component: "host", RequestID: "req_1", OccurredAt: now.Add(-2 * time.Minute)},
	}
	dossier := NewDossier(Filter{MinLevel: LevelInfo, Since: now.Add(-time.Hour)}, newestFirst, MaxExportRecords, now)
	if dossier.Protocol != DossierProtocol || dossier.Records[0].Event != "host.apply_started" || dossier.Records[2].Event != "execution.failed" {
		t.Fatalf("dossier must be ordered oldest first: %#v", dossier.Records)
	}
	summary := dossier.Summary
	if summary.Count != 3 || summary.Truncated || summary.ByLevel[LevelError] != 1 || summary.BySource[SourceDesktop] != 1 {
		t.Fatalf("summary is wrong: %#v", summary)
	}
	if len(summary.Requests) != 2 || summary.Requests[0] != "req_1" || !summary.First.Before(*summary.Last) {
		t.Fatalf("requests/time range are wrong: %#v", summary)
	}
	if dossier.Filter["min_level"] != LevelInfo || dossier.Filter["since"] == nil || len(dossier.Filter) != 2 {
		t.Fatalf("only the applied filter is described: %#v", dossier.Filter)
	}
	if !NewDossier(Filter{}, newestFirst, 3, now).Summary.Truncated {
		t.Fatal("a dossier that hit its bound must say it may be incomplete")
	}
}

func TestExportRaisesOnlyTheExportPageBound(t *testing.T) {
	if (Filter{Limit: 999999, Export: true}).BoundedLimit() != MaxExportRecords || (Filter{Limit: 999999}).BoundedLimit() != maxQueryLimit {
		t.Fatal("export and interactive page bounds must differ and both stay bounded")
	}
}
