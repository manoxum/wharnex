package testgraph

import (
	"reflect"
	"strings"
	"testing"
)

func catalog(t *testing.T, nodes ...Node) Graph {
	t.Helper()
	graph, err := New(nodes)
	if err != nil {
		t.Fatal(err)
	}
	return graph
}

func TestOrderRunsPrerequisitesFirstAndOnce(t *testing.T) {
	graph := catalog(t,
		Node{ID: "login", EnvironmentID: "web", ProfileID: "admin"},
		Node{ID: "open-project", EnvironmentID: "web", DependsOn: []string{"login"}},
		Node{ID: "open-settings", EnvironmentID: "web", DependsOn: []string{"login"}},
		Node{ID: "create-item", EnvironmentID: "web", DependsOn: []string{"open-project", "open-settings"}},
	)
	if err := graph.Validate(); err != nil {
		t.Fatal(err)
	}
	order, err := graph.Order("create-item")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"login", "open-project", "open-settings"}; !reflect.DeepEqual(order, want) {
		t.Fatalf("order=%v want %v", order, want)
	}
	profile, err := graph.EffectiveProfile("create-item")
	if err != nil || profile != "admin" {
		t.Fatalf("profile=%q err=%v", profile, err)
	}
	if order, _ := graph.Order("login"); len(order) != 0 {
		t.Fatalf("root has prerequisites: %v", order)
	}
}

func TestValidateRefusesUnsafeChains(t *testing.T) {
	cases := map[string][]Node{
		"cycle": {
			{ID: "a", EnvironmentID: "web", DependsOn: []string{"b"}},
			{ID: "b", EnvironmentID: "web", DependsOn: []string{"a"}},
		},
		"self":    {{ID: "a", EnvironmentID: "web", DependsOn: []string{"a"}}},
		"unknown": {{ID: "a", EnvironmentID: "web", DependsOn: []string{"ghost"}}},
		"environment": {
			{ID: "login", EnvironmentID: "admin"},
			{ID: "a", EnvironmentID: "web", DependsOn: []string{"login"}},
		},
		"profiles": {
			{ID: "login", EnvironmentID: "web", ProfileID: "admin"},
			{ID: "a", EnvironmentID: "web", ProfileID: "viewer", DependsOn: []string{"login"}},
		},
		"repeat": {
			{ID: "login", EnvironmentID: "web"},
			{ID: "a", EnvironmentID: "web", DependsOn: []string{"login", "login"}},
		},
	}
	for name, nodes := range cases {
		t.Run(name, func(t *testing.T) {
			if err := catalog(t, nodes...).Validate(); err == nil {
				t.Fatal("unsafe chain accepted")
			}
		})
	}
	if _, err := New([]Node{{ID: "a"}, {ID: "a"}}); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate ids accepted: %v", err)
	}
}

func TestDependentsListsDirectConsumers(t *testing.T) {
	graph := catalog(t,
		Node{ID: "login", EnvironmentID: "web"},
		Node{ID: "a", EnvironmentID: "web", DependsOn: []string{"login"}},
		Node{ID: "b", EnvironmentID: "web"},
	)
	if got := graph.Dependents("login"); !reflect.DeepEqual(got, []string{"a"}) {
		t.Fatalf("dependents=%v", got)
	}
}
