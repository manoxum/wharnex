package automationhold

import (
	"context"
	"testing"
	"time"
)

var testCatalog = Catalog{
	TaskTypes:   []string{"BOT_WRITE", "RENAME_CHAT", "UI_TEST_RUN"},
	DefaultHeld: []string{"RENAME_CHAT"},
}

func TestTaskHoldsExcludeTypesUntilReleasedAndHonourDefaults(t *testing.T) {
	ctx := context.Background()
	store := NewMemory(testCatalog)
	now := time.Now().UTC()
	excluded, err := ExcludedTaskTypes(ctx, store, testCatalog, now)
	if err != nil || len(excluded) != 1 || excluded[0] != "RENAME_CHAT" {
		t.Fatalf("an unset default-held type must be excluded, got %v %v", excluded, err)
	}
	if _, err := store.Set(ctx, Hold{Name: TaskHold("UI_TEST_RUN"), Active: true, Reason: "operator"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Set(ctx, Hold{Name: TaskHold("RENAME_CHAT"), Active: false}); err != nil {
		t.Fatal(err)
	}
	excluded, _ = ExcludedTaskTypes(ctx, store, testCatalog, now)
	if len(excluded) != 1 || excluded[0] != "UI_TEST_RUN" {
		t.Fatalf("operator decisions replace defaults, got %v", excluded)
	}
	released, _ := store.Set(ctx, Hold{Name: TaskHold("UI_TEST_RUN"), Active: false, Reason: "ignored"})
	if released.Reason != "" || released.Until != nil {
		t.Fatalf("a released hold keeps no reason or deadline: %+v", released)
	}
	if excluded, _ = ExcludedTaskTypes(ctx, store, testCatalog, now); len(excluded) != 0 {
		t.Fatalf("released holds must exclude nothing, got %v", excluded)
	}
}

func TestTimedHoldLapses(t *testing.T) {
	ctx := context.Background()
	store := NewMemory(testCatalog)
	until := time.Now().UTC().Add(time.Hour)
	if _, err := store.Set(ctx, Hold{Name: TaskHold("BOT_WRITE"), Active: true, Until: &until}); err != nil {
		t.Fatal(err)
	}
	excluded, _ := ExcludedTaskTypes(ctx, store, testCatalog, until.Add(time.Second))
	if len(excluded) != 1 || excluded[0] != "RENAME_CHAT" {
		t.Fatalf("an expired hold must not exclude work, got %v", excluded)
	}
}

func TestCatalogRefusesUnknownNamesAndPastDeadlines(t *testing.T) {
	now := time.Now().UTC()
	for _, name := range []string{"everything", "task:NOT_A_TYPE", "ui_testing"} {
		if _, err := testCatalog.Normalize(Hold{Name: name, Active: true}, now); err != ErrUnknownHold {
			t.Fatalf("%s must be refused, got %v", name, err)
		}
	}
	past := now.Add(-time.Minute)
	if _, err := testCatalog.Normalize(Hold{Name: ChatGPTUpload, Active: true, Until: &past}, now); err == nil {
		t.Fatal("an active hold that already expired must be refused")
	}
}

func TestTaskPoliciesReportActiveSuspendedAndCooldown(t *testing.T) {
	now := time.Now().UTC()
	until := now.Add(10 * time.Minute)
	kinds := []TaskKind{
		{Type: "BOT_WRITE", Pool: "supervisor", Uploads: true},
		{Type: "RENAME_CHAT", Pool: "worker"},
		{Type: "TODO_CLASSIFY", Pool: "worker", Uploads: true},
		{Type: "AWAIT_RESPONSE", Pool: "supervisor"},
	}
	holds := map[string]Hold{"RENAME_CHAT": {Name: TaskHold("RENAME_CHAT"), Active: true, Default: true}}
	policies := TaskPolicies(kinds, holds, ProviderPause{Paused: true, Until: &until, Reason: "429"},
		Hold{Name: ChatGPTUpload, Active: true, Until: &until}, now)
	got := map[string]TaskPolicy{}
	for _, policy := range policies {
		got[policy.Type] = policy
	}
	if got["BOT_WRITE"].State != StateCooldown || len(got["BOT_WRITE"].Cooldowns) != 1 || got["BOT_WRITE"].Cooldowns[0].Kind != "upload_limit" {
		t.Fatalf("a Supervisor upload type is reached only by the upload limit: %+v", got["BOT_WRITE"])
	}
	if got["RENAME_CHAT"].State != StateSuspended || len(got["RENAME_CHAT"].Cooldowns) != 1 {
		t.Fatalf("a suspension outranks the cooldown it still lists: %+v", got["RENAME_CHAT"])
	}
	if got["TODO_CLASSIFY"].State != StateCooldown || len(got["TODO_CLASSIFY"].Cooldowns) != 2 {
		t.Fatalf("a Worker upload type carries both cooldowns: %+v", got["TODO_CLASSIFY"])
	}
	if got["AWAIT_RESPONSE"].State != StateActive {
		t.Fatalf("an unaffected type is active: %+v", got["AWAIT_RESPONSE"])
	}
}
