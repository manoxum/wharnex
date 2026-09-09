package app

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestBundleQuotaCountsCanonicalTransportBundlesAcrossSessions(t *testing.T) {
	now := time.Date(2026, 9, 8, 18, 0, 0, 0, time.UTC)
	store := session.NewStore()
	requestA := "req_20260908T170000_1111111111111111"
	requestB := "req_20260908T173000_2222222222222222"
	artifactsA := []domain.ArtifactRecord{
		quotaArtifact("a-in", requestA, "input", "whx_bundle_req_chat-a_"+requestA+".zip", now.Add(-2*time.Hour)),
		quotaArtifact("a-out", requestA, "output", "whx_bundle_res_chat-a_"+requestA+".zip", now.Add(-90*time.Minute)),
		quotaArtifact("old", requestA, "input", "whx_bundle_req_chat-a_"+requestA+".zip", now.Add(-4*time.Hour)),
	}
	artifactsB := []domain.ArtifactRecord{
		quotaArtifact("b-in", requestB, "input", "whx_bundle_req_chat-b_"+requestB+" (2).zip", now.Add(-30*time.Minute)),
		quotaArtifact("invalid", requestB, "input", "context-"+requestB+".zip", now.Add(-20*time.Minute)),
	}
	if err := store.Put(domain.Session{ID: "ses-a", ProjectPath: t.TempDir(), CreatedAt: now, Artifacts: artifactsA}); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(domain.Session{ID: "ses-b", ProjectPath: t.TempDir(), CreatedAt: now, Artifacts: artifactsB}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.SetBundleWindowLimit(2)

	quota := service.BundleQuota(now)
	if quota.WindowHours != 3 || quota.Limit != 2 || quota.Sent != 2 || quota.Received != 1 || quota.Total != 3 || !quota.Warning {
		t.Fatalf("unexpected quota snapshot: %#v", quota)
	}
	if !quota.WindowStart.Equal(now.Add(-3*time.Hour)) || !quota.WindowEnd.Equal(now) {
		t.Fatalf("unexpected quota window: %#v", quota)
	}
}

func TestBundleQuotaUsesInclusiveThreeHourWindowAndIgnoresFutureBundles(t *testing.T) {
	now := time.Date(2026, 9, 9, 17, 0, 0, 0, time.UTC)
	store := session.NewStore()
	requestID := "req_20260909T140000_3333333333333333"
	artifacts := []domain.ArtifactRecord{
		quotaArtifact("boundary", requestID, "input", "whx_bundle_req_chat-a_"+requestID+".zip", now.Add(-3*time.Hour)),
		quotaArtifact("inside", requestID, "input", "whx_bundle_req_chat-a_"+requestID+".zip", now.Add(-2*time.Hour)),
		quotaArtifact("outside", requestID, "input", "whx_bundle_req_chat-a_"+requestID+".zip", now.Add(-3*time.Hour-time.Nanosecond)),
		quotaArtifact("response", requestID, "output", "whx_bundle_res_chat-a_"+requestID+".zip", now.Add(-time.Hour)),
		quotaArtifact("future", requestID, "input", "whx_bundle_req_chat-a_"+requestID+".zip", now.Add(time.Second)),
	}
	if err := store.Put(domain.Session{ID: "ses-boundary", ProjectPath: t.TempDir(), CreatedAt: now, Artifacts: artifacts}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.SetBundleWindowLimit(1)

	quota := service.BundleQuota(now)
	if quota.Sent != 2 || quota.Received != 1 || quota.Total != 3 || !quota.Warning {
		t.Fatalf("unexpected boundary quota: %#v", quota)
	}
}

func TestBundleQuotaReceivedBundlesNeverConsumeTheUploadLimit(t *testing.T) {
	now := time.Date(2026, 9, 9, 17, 0, 0, 0, time.UTC)
	store := session.NewStore()
	requestA := "req_20260909T150000_4444444444444444"
	requestB := "req_20260909T160000_5555555555555555"
	artifacts := []domain.ArtifactRecord{
		quotaArtifact("response-a", requestA, "output", "whx_bundle_res_chat-a_"+requestA+".zip", now.Add(-2*time.Hour)),
		quotaArtifact("response-b", requestB, "output", "whx_bundle_res_chat-b_"+requestB+".zip", now.Add(-time.Hour)),
	}
	if err := store.Put(domain.Session{ID: "ses-responses", ProjectPath: t.TempDir(), CreatedAt: now, Artifacts: artifacts}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.SetBundleWindowLimit(1)

	quota := service.BundleQuota(now)
	if quota.Sent != 0 || quota.Received != 2 || quota.Total != 2 || quota.Warning {
		t.Fatalf("received bundles must stay informational: %#v", quota)
	}
}

func TestBundleWindowLimitDefaultsAndClamps(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	if got := service.BundleWindowLimit(); got != 80 {
		t.Fatalf("default limit = %d, want 80", got)
	}
	service.SetBundleWindowLimit(0)
	if got := service.BundleWindowLimit(); got != 80 {
		t.Fatalf("zero limit = %d, want default 80", got)
	}
	service.SetBundleWindowLimit(20000)
	if got := service.BundleWindowLimit(); got != 10000 {
		t.Fatalf("clamped limit = %d, want 10000", got)
	}
}

func quotaArtifact(id, requestID, direction, name string, createdAt time.Time) domain.ArtifactRecord {
	return domain.ArtifactRecord{ID: id, RequestID: requestID, Direction: direction, Kind: "bundle", Name: name, Bundle: true, CreatedAt: createdAt}
}
