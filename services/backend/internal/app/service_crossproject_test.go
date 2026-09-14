package app

import (
	"strings"
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

func newCrossProjectService(t *testing.T) *Service {
	t.Helper()
	return NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
}

func crossProjectSession(grant *domain.CrossProjectGrant) domain.Session {
	return domain.Session{ID: "ses_a", ProjectPath: "/home/op/alpha", State: "ready", CrossProjectGrant: grant}
}

func crossProjectUnit(project string) domain.CrossProjectUnit {
	return domain.CrossProjectUnit{
		Project: project, CommitMessage: "fix(auth): accept the renewed token audience",
		Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"true"}, TimeoutSeconds: 30}}},
	}
}

func grantedTo(name, path string) *domain.CrossProjectGrant {
	return &domain.CrossProjectGrant{
		RootRequestID: "req_1", GrantedAt: time.Now().UTC(),
		Projects: []domain.CrossProjectGrantee{{Name: name, ProjectPath: path}},
	}
}

// Authority comes from the operator's own prompt. A response naming a project
// the prompt did not is refused at ingestion — before Policy, before any
// sandbox — so it costs one re-request rather than a discarded candidate.
func TestAuthorizeCrossProjectUnitsRefusesAnUngrantedProject(t *testing.T) {
	service := newCrossProjectService(t)
	current := crossProjectSession(grantedTo("flowcore", "/home/op/flowcore"))
	plan := &domain.ExecutionPlan{CrossProject: []domain.CrossProjectUnit{crossProjectUnit("siage")}}

	if _, err := service.authorizeCrossProjectUnits(current, plan); err == nil || !strings.Contains(err.Error(), "was not granted") {
		t.Fatalf("err=%v", err)
	}
}

// Installing a derived plan over a project's own pending work would discard it.
// The refusal names the state so the operator knows what to finish first.
func TestAuthorizeCrossProjectUnitsRefusesABusyProject(t *testing.T) {
	service := newCrossProjectService(t)
	target := domain.Session{
		ID: "ses_b", ProjectPath: "/home/op/flowcore", State: "planned",
		Plan: &domain.ExecutionPlan{PlanID: "pln_existing"}, CreatedAt: time.Now().UTC(),
	}
	if err := service.store.Put(target); err != nil {
		t.Fatal(err)
	}
	current := crossProjectSession(grantedTo("flowcore", "/home/op/flowcore"))
	plan := &domain.ExecutionPlan{CrossProject: []domain.CrossProjectUnit{crossProjectUnit("flowcore")}}

	_, err := service.authorizeCrossProjectUnits(current, plan)
	if err == nil || !strings.Contains(err.Error(), "has not been executed") {
		t.Fatalf("err=%v", err)
	}
}

func TestAuthorizeCrossProjectUnitsResolvesAnOpenGrantedProject(t *testing.T) {
	service := newCrossProjectService(t)
	if err := service.store.Put(domain.Session{ID: "ses_b", ProjectPath: "/home/op/flowcore", State: "ready", CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	current := crossProjectSession(grantedTo("flowcore", "/home/op/flowcore"))
	plan := &domain.ExecutionPlan{CrossProject: []domain.CrossProjectUnit{crossProjectUnit("flowcore")}}

	targets, err := service.authorizeCrossProjectUnits(current, plan)
	if err != nil {
		t.Fatal(err)
	}
	if targets["flowcore"] != "/home/op/flowcore" {
		t.Fatalf("targets=%#v", targets)
	}
}

// A continuation is the same Main Request. It inherits the authority the
// operator gave at the start and cannot acquire more by naming a new project in
// a later round.
func TestCrossProjectGrantIsInheritedByContinuationsAndReplacedByNewRequests(t *testing.T) {
	service := newCrossProjectService(t)
	existing := grantedTo("flowcore", "/home/op/flowcore")
	item := crossProjectSession(existing)
	item.Context.RelatedProjects = []domain.RelatedProjectContext{{Name: "siage", ProjectPath: "/home/op/siage"}}

	inherited, _ := service.crossProjectGrantForRequest(item, "now also change @ref:siage", "req_2", "req_1")
	if inherited != existing {
		t.Fatalf("a continuation must inherit the original grant unchanged, got %#v", inherited)
	}

	fresh, unresolved := service.crossProjectGrantForRequest(item, "now change @ref:siage", "req_3", "")
	if fresh == nil || len(fresh.Projects) != 1 || fresh.Projects[0].ProjectPath != "/home/op/siage" {
		t.Fatalf("a new Main Request must re-derive the grant from its own prompt, got %#v", fresh)
	}
	if len(unresolved) != 0 {
		t.Fatalf("unresolved=%#v", unresolved)
	}

	// A Main Request with no directive grants nothing, replacing whatever the
	// previous one carried.
	cleared, _ := service.crossProjectGrantForRequest(item, "just a question", "req_4", "")
	if cleared != nil {
		t.Fatalf("a prompt with no @ref: must grant nothing, got %#v", cleared)
	}
}

// The prompt must not tell the model both that it may change a project and that
// it may not. Whichever sentence it read second would be the one that governed.
func TestPromptStatesTheGrantWithoutContradictingIt(t *testing.T) {
	related := []domain.RelatedProjectContext{{Name: "flowcore", ProjectPath: "/home/op/flowcore", Prefix: "RELATED_PROJECTS/01-flowcore/"}}

	ungranted := messageWithRelatedProjects("do the thing", "/home/op/alpha", related, nil)
	if !strings.Contains(ungranted, "may mutate only the primary project") {
		t.Fatalf("without a grant the old rule must still be stated: %q", ungranted)
	}

	granted := messageWithRelatedProjects("do the thing", "/home/op/alpha", related, []string{"/home/op/flowcore"})
	if strings.Contains(granted, "may mutate only the primary project") {
		t.Fatalf("with a grant the contradicting rule must be gone: %q", granted)
	}
	full := messageWithCrossProjectGrant(granted, grantedTo("flowcore", "/home/op/flowcore"), []string{"siage"}, map[string]bool{"/home/op/flowcore": true})
	if !strings.Contains(full, "cross_project") || !strings.Contains(full, "flowcore") {
		t.Fatalf("the grant must name the field and the project: %q", full)
	}
	// A reference that did not resolve is stated too: an operator who wrote
	// @ref: and got silence would reasonably think it worked.
	if !strings.Contains(full, "siage") {
		t.Fatalf("an unresolved reference must be reported to the planner: %q", full)
	}
}

// Referring to a project and changing it are different authorities. A name
// resolves from what Wharnex has worked on before; a change needs the live
// session that carries the modes the operator chose for that project.
func TestGrantResolvesAKnownProjectThatIsNotAttached(t *testing.T) {
	service := newCrossProjectService(t)
	if err := service.store.Put(domain.Session{ID: "ses_known", ProjectPath: "/home/op/flowcore", State: "ready", CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	item := crossProjectSession(nil)

	grant, unresolved := service.crossProjectGrantForRequest(item, "alinha com @ref:flowcore", "req_1", "")
	if grant == nil || len(grant.Projects) != 1 || grant.Projects[0].ProjectPath != "/home/op/flowcore" {
		t.Fatalf("a project Wharnex has worked on before must resolve: %#v (unresolved=%#v)", grant, unresolved)
	}
	if grant.Projects[0].Attached {
		t.Fatal("a project that is not in the session snapshot must be reported as unattached so its context is brought in")
	}
}

// A project the planner cannot change is named as such in the prompt, so the
// effort goes where it can land instead of coming back as a refused entry.
func TestGrantPromptNamesTheProjectsAChangeCannotReach(t *testing.T) {
	granted := messageWithCrossProjectGrant("do it", grantedTo("flowcore", "/home/op/flowcore"), nil, map[string]bool{})
	if !strings.Contains(granted, "not currently open") || !strings.Contains(granted, "flowcore") {
		t.Fatalf("prompt=%q", granted)
	}
	reachable := messageWithCrossProjectGrant("do it", grantedTo("flowcore", "/home/op/flowcore"), nil, map[string]bool{"/home/op/flowcore": true})
	if strings.Contains(reachable, "not currently open") {
		t.Fatalf("an open project must not be reported as unreachable: %q", reachable)
	}
}

// The refusal says what is different about this case: the project is readable,
// the change is not, and the remedy is opening it.
func TestClosedGrantedProjectRefusalNamesTheRemedy(t *testing.T) {
	service := newCrossProjectService(t)
	current := crossProjectSession(grantedTo("flowcore", "/home/op/flowcore"))
	plan := &domain.ExecutionPlan{CrossProject: []domain.CrossProjectUnit{crossProjectUnit("flowcore")}}

	_, err := service.authorizeCrossProjectUnits(current, plan)
	if err == nil || !strings.Contains(err.Error(), "not open") || !strings.Contains(err.Error(), "/home/op/flowcore") {
		t.Fatalf("err=%v", err)
	}
}
