// Package crossproject owns what naming another project with `@ref:` grants:
// which projects a request may change, and whether a bundle's cross-project
// work is inside that authority.
//
// The grammar itself lives in internal/directives, which both `@ref` and
// `@file` share. This package is only the authority half.
//
// The model is deliberately narrow and deliberately explicit. A request may
// change a project other than its own only because the operator wrote
// `@ref:<project>` in that request's own main prompt, and only for a project
// already bound to the session as a related project — which means a project the
// operator has open in this window and therefore already has authority over.
// Nothing the model returns can widen that: a bundle naming a project the
// prompt did not is refused at ingestion, before Policy and before any sandbox
// runs.
//
// Names, never paths. The unit of authority is the reference name the operator
// used, and Wharnex resolves it against what it already knows. A path supplied
// by the model would be a containment question with no good answer.
package crossproject

import (
	"fmt"
	"path"
	"strings"

	"kernl.local/harness/backend/internal/directives"
	"kernl.local/harness/backend/internal/domain"
)

const (
	// MaxReferences bounds how many projects one request may name. The related
	// project limit is the real ceiling; this only stops a pathological prompt
	// from producing a parse the rest of the pipeline has to carry.
	MaxReferences = 8
	// MaxReferencedFiles bounds the files one reference may single out.
	MaxReferencedFiles = 16
)

// Reference is one `@ref:` directive: the project it named and, optionally, the
// one file inside it the operator singled out.
type Reference struct {
	Name string
	Path string
}

// ParseReferences extracts every `@ref:` directive from a prompt.
//
// It reads only the text it is given and decides nothing about authority:
// resolution against what the session actually has is a separate step, so a
// prompt naming a project that is not bound produces a refusal that can say so
// rather than a silent omission.
func ParseReferences(message string) []Reference {
	parsed := directives.Of(directives.Parse(message), directives.KindRef)
	references := make([]Reference, 0, len(parsed))
	seen := make(map[string]bool, len(parsed))
	for _, directive := range parsed {
		if seen[directive.Value] {
			continue
		}
		seen[directive.Value] = true
		references = append(references, Reference{Name: directive.Project, Path: directive.Path})
		if len(references) >= MaxReferences*MaxReferencedFiles {
			break
		}
	}
	return references
}

// ValidName reports whether a string can name a project in this protocol.
func ValidName(name string) bool { return directives.ValidProjectName(name) }

// Candidate is a project a reference may resolve to.
//
// It deliberately covers more than the projects currently attached to the
// session: an operator naming a repository they worked in last week is naming
// something real, and making them reopen it first only to write one sentence
// about it is asking them to restage their workspace to ask a question.
type Candidate struct {
	Name        string
	ProjectPath string
	// Attached is true when this project's context is already part of the
	// session's snapshot. A resolved candidate that is not attached tells the
	// caller it has to bring that context in before the reference means
	// anything.
	Attached bool
}

// CandidatesFrom builds the resolution set from the contexts already attached
// to the session plus every project Wharnex has worked on before.
//
// Attached contexts come first so they win the name, which matters when a
// workspace has two projects whose directories share a basename: the one the
// operator already has in front of them is the one they mean.
func CandidatesFrom(related []domain.RelatedProjectContext, known []domain.KnownProjectRef) []Candidate {
	candidates := make([]Candidate, 0, len(related)+len(known))
	for _, project := range related {
		candidates = append(candidates, Candidate{Name: project.Name, ProjectPath: project.ProjectPath, Attached: true})
	}
	for _, project := range known {
		candidates = append(candidates, Candidate{Name: project.Name, ProjectPath: project.ProjectPath})
	}
	return candidates
}

// Resolve turns parsed references into the grant a request carries.
//
// A reference resolves against the candidates it is given, folding case and
// comparing both the name the candidate carries and the project directory's own
// basename — the two spellings an operator would reasonably use. Anything else
// is returned as an unresolved name so the caller can tell the operator which
// reference did not land, rather than quietly dropping the authority they
// thought they had given.
//
// Resolving is not the same as being writable. It makes a name mean a project
// and its context transportable; whether a change may actually land there is
// decided later, against that project's own live session.
func Resolve(references []Reference, rootRequestID string, candidates []Candidate) (domain.CrossProjectGrant, []string) {
	grant := domain.CrossProjectGrant{RootRequestID: strings.TrimSpace(rootRequestID)}
	index := make(map[string]Candidate, len(candidates)*2)
	for _, project := range candidates {
		for _, spelling := range []string{fold(project.Name), fold(path.Base(project.ProjectPath))} {
			if spelling == "" {
				continue
			}
			// First writer wins: attached contexts are listed first precisely so
			// that a shared basename resolves to the project already in front of
			// the operator.
			if _, taken := index[spelling]; !taken {
				index[spelling] = project
			}
		}
	}
	byPath := map[string]int{}
	var unresolved []string
	for _, reference := range references {
		project, ok := index[fold(reference.Name)]
		if !ok {
			unresolved = appendUnique(unresolved, reference.Name)
			continue
		}
		position, exists := byPath[project.ProjectPath]
		if !exists {
			if len(grant.Projects) >= MaxReferences {
				unresolved = appendUnique(unresolved, reference.Name)
				continue
			}
			grant.Projects = append(grant.Projects, domain.CrossProjectGrantee{
				Name: reference.Name, ProjectPath: project.ProjectPath, Attached: project.Attached,
			})
			position = len(grant.Projects) - 1
			byPath[project.ProjectPath] = position
		}
		if reference.Path == "" {
			continue
		}
		grantee := &grant.Projects[position]
		if len(grantee.Files) >= MaxReferencedFiles || containsString(grantee.Files, reference.Path) {
			continue
		}
		grantee.Files = append(grantee.Files, reference.Path)
	}
	return grant, unresolved
}

// Authorize checks a bundle's cross-project units against the grant and returns
// the canonical project path each unit is allowed to write to.
//
// It is fail-closed in both directions: a unit naming a project the prompt did
// not grant is refused, and so is a grant-shaped bundle arriving for a request
// that granted nothing at all. The check runs at ingestion, before Policy and
// before any sandbox, so a refusal costs one re-request rather than a discarded
// verified candidate.
func Authorize(units []domain.CrossProjectUnit, grant *domain.CrossProjectGrant) (map[string]string, error) {
	if len(units) == 0 {
		return nil, nil
	}
	if grant == nil || len(grant.Projects) == 0 {
		return nil, fmt.Errorf("this response changes other projects, but the request granted none: name each one with @ref:<project> in the main prompt")
	}
	allowed := make(map[string]string, len(grant.Projects))
	for _, project := range grant.Projects {
		allowed[fold(project.Name)] = project.ProjectPath
		allowed[fold(path.Base(project.ProjectPath))] = project.ProjectPath
	}
	resolved := make(map[string]string, len(units))
	claimed := make(map[string]string, len(units))
	for index, unit := range units {
		name := strings.TrimSpace(unit.Project)
		target, ok := allowed[fold(name)]
		if !ok {
			return nil, fmt.Errorf("cross_project %d: project %q was not granted by this request; granted: %s", index, name, grantedNames(grant))
		}
		// One unit per project. Two units for the same project would be two
		// commit messages and two verifications for one derived request, with
		// nothing to say which is the change.
		if previous, duplicate := claimed[target]; duplicate {
			return nil, fmt.Errorf("cross_project %d: project %q is already declared as %q; declare one unit per project", index, name, previous)
		}
		claimed[target] = name
		resolved[name] = target
	}
	return resolved, nil
}

// GrantedPaths lists the canonical host paths a request may change besides its
// own, in declaration order.
func GrantedPaths(grant *domain.CrossProjectGrant) []string {
	if grant == nil {
		return nil
	}
	paths := make([]string, 0, len(grant.Projects))
	for _, project := range grant.Projects {
		paths = append(paths, project.ProjectPath)
	}
	return paths
}

func grantedNames(grant *domain.CrossProjectGrant) string {
	names := make([]string, 0, len(grant.Projects))
	for _, project := range grant.Projects {
		names = append(names, project.Name)
	}
	if len(names) == 0 {
		return "none"
	}
	return strings.Join(names, ", ")
}

func fold(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func appendUnique(values []string, candidate string) []string {
	if containsString(values, candidate) {
		return values
	}
	return append(values, candidate)
}
