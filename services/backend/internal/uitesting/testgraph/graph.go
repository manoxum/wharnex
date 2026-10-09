// Package testgraph orders UI Lab tests by their declared prerequisites.
//
// A dependent test runs in the browser state its prerequisites leave behind, so
// every prerequisite MUST belong to the same environment, the graph MUST be
// acyclic, and a chain MUST NOT mix two authenticated profiles.
package testgraph

import (
	"fmt"
	"strings"
)

// MaxDependencies bounds the direct prerequisites of one test.
const MaxDependencies = 8

// Node is the slice of a test definition the graph needs.
type Node struct {
	ID            string
	EnvironmentID string
	ProfileID     string
	DependsOn     []string
}

// Graph indexes nodes by id.
type Graph struct{ nodes map[string]Node }

// New indexes nodes. Duplicate ids are a caller defect and are reported.
func New(nodes []Node) (Graph, error) {
	graph := Graph{nodes: make(map[string]Node, len(nodes))}
	for _, node := range nodes {
		if _, exists := graph.nodes[node.ID]; exists {
			return Graph{}, fmt.Errorf("duplicate UI test id %q", node.ID)
		}
		graph.nodes[node.ID] = node
	}
	return graph, nil
}

// Validate checks every node's references, environment, profile chain and cycles.
func (g Graph) Validate() error {
	for id, node := range g.nodes {
		if len(node.DependsOn) > MaxDependencies {
			return fmt.Errorf("UI test %q declares more than %d dependencies", id, MaxDependencies)
		}
		seen := map[string]bool{}
		for _, dep := range node.DependsOn {
			target, ok := g.nodes[dep]
			switch {
			case dep == id:
				return fmt.Errorf("UI test %q depends on itself", id)
			case !ok:
				return fmt.Errorf("UI test %q depends on unknown test %q", id, dep)
			case seen[dep]:
				return fmt.Errorf("UI test %q repeats dependency %q", id, dep)
			case target.EnvironmentID != node.EnvironmentID:
				return fmt.Errorf("UI test %q depends on %q from another environment", id, dep)
			}
			seen[dep] = true
		}
	}
	for id := range g.nodes {
		if _, err := g.Order(id); err != nil {
			return err
		}
		if _, err := g.EffectiveProfile(id); err != nil {
			return err
		}
	}
	return nil
}

// Order returns the prerequisites of id in execution order, excluding id.
func (g Graph) Order(id string) ([]string, error) {
	if _, ok := g.nodes[id]; !ok {
		return nil, fmt.Errorf("unknown UI test %q", id)
	}
	order := []string{}
	state := map[string]int{} // 1 visiting, 2 done
	var visit func(string, []string) error
	visit = func(current string, path []string) error {
		switch state[current] {
		case 1:
			return fmt.Errorf("UI test dependencies form a cycle: %s", strings.Join(append(path, current), " → "))
		case 2:
			return nil
		}
		state[current] = 1
		for _, dep := range g.nodes[current].DependsOn {
			if _, ok := g.nodes[dep]; !ok {
				return fmt.Errorf("UI test %q depends on unknown test %q", current, dep)
			}
			if err := visit(dep, append(path, current)); err != nil {
				return err
			}
		}
		state[current] = 2
		order = append(order, current)
		return nil
	}
	if err := visit(id, nil); err != nil {
		return nil, err
	}
	return order[:len(order)-1], nil
}

// EffectiveProfile is the authenticated profile whose session id runs under:
// its own profile, otherwise the one its prerequisites establish. Two different
// profiles in one chain cannot share one browser session and are refused.
func (g Graph) EffectiveProfile(id string) (string, error) {
	order, err := g.Order(id)
	if err != nil {
		return "", err
	}
	profile := ""
	for _, current := range append(order, id) {
		own := g.nodes[current].ProfileID
		if own == "" {
			continue
		}
		if profile != "" && own != profile {
			return "", fmt.Errorf("UI test %q mixes profiles %q and %q in one session chain", id, profile, own)
		}
		profile = own
	}
	return profile, nil
}

// Dependents reports whether any node other than id lists id as a prerequisite.
func (g Graph) Dependents(id string) []string {
	out := []string{}
	for other, node := range g.nodes {
		for _, dep := range node.DependsOn {
			if dep == id {
				out = append(out, other)
				break
			}
		}
	}
	return out
}
