package crossproject

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func related(entries ...[2]string) []Candidate {
	contexts := make([]domain.RelatedProjectContext, 0, len(entries))
	for _, entry := range entries {
		contexts = append(contexts, domain.RelatedProjectContext{Name: entry[0], ProjectPath: entry[1]})
	}
	return CandidatesFrom(contexts, nil)
}

// A project Wharnex worked on before is nameable even though it is not attached
// to this session, because resolving a name and being allowed to change what it
// names are different questions.
func known(entries ...[2]string) []Candidate {
	refs := make([]domain.KnownProjectRef, 0, len(entries))
	for _, entry := range entries {
		refs = append(refs, domain.KnownProjectRef{Name: entry[0], ProjectPath: entry[1]})
	}
	return CandidatesFrom(nil, refs)
}

// One syntax carries both "the whole project" and "this file in it", because
// those are the same intent at two levels of detail and a second directive for
// the narrower one would be a second thing to remember.
func TestParseReferencesReadsProjectsAndFiles(t *testing.T) {
	references := ParseReferences("compare @ref:flowcore with @ref:siage/services/app/src/lib/auth.ts and @ref:flowcore again")
	if len(references) != 2 {
		t.Fatalf("references=%#v want 2", references)
	}
	if references[0].Name != "flowcore" || references[0].Path != "" {
		t.Fatalf("first=%#v", references[0])
	}
	if references[1].Name != "siage" || references[1].Path != "services/app/src/lib/auth.ts" {
		t.Fatalf("second=%#v", references[1])
	}
}

// A path with spaces is still a path the operator can mean, so the same
// bracketed form `@file:` already uses is accepted here. The project name
// itself stays in the restricted charset: it is a directory basename, and the
// grant is keyed on it.
func TestParseReferencesAcceptsTheBracketedForm(t *testing.T) {
	references := ParseReferences("see @ref:<<flowcore/docs/read me.md>>")
	if len(references) != 1 || references[0].Name != "flowcore" {
		t.Fatalf("references=%#v", references)
	}
	if references[0].Path != "docs/read me.md" {
		t.Fatalf("path=%q", references[0].Path)
	}
	// A name that could not be a project directory is not a reference at all.
	if names := ParseReferences("@ref:<<my project/docs/a.md>>"); len(names) != 0 {
		t.Fatalf("a name outside the project charset must not resolve: %#v", names)
	}
}

// Traversal never becomes a reference. The grant carries these paths into a
// prompt and into the operator's own reading of what was shared, so a path that
// climbs out of the project is dropped at the parse rather than resolved later.
func TestParseReferencesDropsUnsafeNamesAndPaths(t *testing.T) {
	references := ParseReferences("@ref:../etc @ref:flowcore/../../etc/passwd @ref:flowcore//ok.md @ref:with spaces")
	for _, reference := range references {
		if strings.Contains(reference.Path, "..") || strings.HasPrefix(reference.Path, "/") {
			t.Fatalf("unsafe path survived parsing: %#v", reference)
		}
		if !ValidName(reference.Name) {
			t.Fatalf("unsafe name survived parsing: %#v", reference)
		}
	}
}

// A reference resolves only against projects the session already has bound,
// which is how the operator's own authority becomes the ceiling on the grant.
func TestResolveGrantsOnlyBoundProjects(t *testing.T) {
	references := ParseReferences("@ref:flowcore/contract.md @ref:FlowCore @ref:unknown")
	grant, unresolved := Resolve(references, "req_1", related([2]string{"flowcore", "/home/op/flowcore"}))
	if len(grant.Projects) != 1 {
		t.Fatalf("grant=%#v want exactly the bound project", grant)
	}
	if grant.Projects[0].ProjectPath != "/home/op/flowcore" {
		t.Fatalf("resolved path=%q", grant.Projects[0].ProjectPath)
	}
	if len(grant.Projects[0].Files) != 1 || grant.Projects[0].Files[0] != "contract.md" {
		t.Fatalf("files=%#v", grant.Projects[0].Files)
	}
	// An operator who wrote @ref: and got silence would reasonably conclude the
	// reference worked, so what did not resolve is reported rather than dropped.
	if len(unresolved) != 1 || unresolved[0] != "unknown" {
		t.Fatalf("unresolved=%#v", unresolved)
	}
}

// The directory basename is as good a name as the namespace one, because it is
// the name the operator sees in their own project switcher.
func TestResolveMatchesTheProjectDirectoryName(t *testing.T) {
	grant, unresolved := Resolve(ParseReferences("@ref:kaxafirme-deploy"), "req_1",
		related([2]string{"01-kaxafirme", "/home/op/kaxafirme-deploy"}))
	if len(grant.Projects) != 1 || len(unresolved) != 0 {
		t.Fatalf("grant=%#v unresolved=%#v", grant, unresolved)
	}
}

func grantFor(paths ...[2]string) *domain.CrossProjectGrant {
	grant := &domain.CrossProjectGrant{RootRequestID: "req_1"}
	for _, entry := range paths {
		grant.Projects = append(grant.Projects, domain.CrossProjectGrantee{Name: entry[0], ProjectPath: entry[1]})
	}
	return grant
}

func TestAuthorizeResolvesGrantedUnits(t *testing.T) {
	targets, err := Authorize(
		[]domain.CrossProjectUnit{{Project: "flowcore"}},
		grantFor([2]string{"flowcore", "/home/op/flowcore"}),
	)
	if err != nil {
		t.Fatal(err)
	}
	if targets["flowcore"] != "/home/op/flowcore" {
		t.Fatalf("targets=%#v", targets)
	}
}

// Authority comes from the prompt and only from the prompt. A response that
// names a project the operator did not is refused, whatever else it got right.
func TestAuthorizeRefusesAProjectTheRequestDidNotGrant(t *testing.T) {
	_, err := Authorize(
		[]domain.CrossProjectUnit{{Project: "siage"}},
		grantFor([2]string{"flowcore", "/home/op/flowcore"}),
	)
	if err == nil || !strings.Contains(err.Error(), "was not granted") {
		t.Fatalf("err=%v", err)
	}
	if !strings.Contains(err.Error(), "flowcore") {
		t.Fatalf("the refusal must name what was granted, got %v", err)
	}
}

// A response that reaches into other projects when the prompt granted none is
// the case worth being loudest about: nothing about it is a near miss.
func TestAuthorizeRefusesCrossProjectWorkWithoutAnyGrant(t *testing.T) {
	_, err := Authorize([]domain.CrossProjectUnit{{Project: "flowcore"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "@ref:") {
		t.Fatalf("the refusal must name the directive that grants authority, got %v", err)
	}
}

// Two units for one project would be two commit messages and two verifications
// for a single derived request, with nothing to say which is the change.
func TestAuthorizeRefusesDuplicateUnitsForOneProject(t *testing.T) {
	_, err := Authorize(
		[]domain.CrossProjectUnit{{Project: "flowcore"}, {Project: "flowcore"}},
		grantFor([2]string{"flowcore", "/home/op/flowcore"}),
	)
	if err == nil || !strings.Contains(err.Error(), "one unit per project") {
		t.Fatalf("err=%v", err)
	}
}

func TestAuthorizeIsANoOpWithoutUnits(t *testing.T) {
	targets, err := Authorize(nil, nil)
	if err != nil || targets != nil {
		t.Fatalf("targets=%#v err=%v", targets, err)
	}
}

func TestResolveReachesAProjectThatIsMerelyKnown(t *testing.T) {
	grant, unresolved := Resolve(ParseReferences("@ref:flowcore"), "req_1", known([2]string{"flowcore", "/home/op/flowcore"}))
	if len(grant.Projects) != 1 || len(unresolved) != 0 {
		t.Fatalf("grant=%#v unresolved=%#v", grant, unresolved)
	}
	if grant.Projects[0].Attached {
		t.Fatal("a project that is not in the session snapshot must be reported as unattached")
	}
}

// Two projects can share a directory basename. The one already in front of the
// operator is the one they mean.
func TestResolvePrefersAnAttachedProjectOverAMerelyKnownOne(t *testing.T) {
	candidates := CandidatesFrom(
		[]domain.RelatedProjectContext{{Name: "app", ProjectPath: "/home/op/current/app"}},
		[]domain.KnownProjectRef{{Name: "app", ProjectPath: "/home/op/archive/app"}},
	)
	grant, _ := Resolve(ParseReferences("@ref:app"), "req_1", candidates)
	if len(grant.Projects) != 1 || grant.Projects[0].ProjectPath != "/home/op/current/app" {
		t.Fatalf("grant=%#v", grant)
	}
	if !grant.Projects[0].Attached {
		t.Fatal("the attached candidate must win the name")
	}
}
