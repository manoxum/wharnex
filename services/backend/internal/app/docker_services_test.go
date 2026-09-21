package app

import (
	"encoding/json"
	"testing"
	"time"
)

func TestValidateDockerIdentifier(t *testing.T) {
	valid := []string{"abc123", "container-name", "service_1.2"}
	for _, value := range valid {
		if err := validateDockerIdentifier(value); err != nil {
			t.Fatalf("expected %q to be valid: %v", value, err)
		}
	}
	invalid := []string{"", "../container", "name with space", "container;rm"}
	for _, value := range invalid {
		if err := validateDockerIdentifier(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestParseDockerBool(t *testing.T) {
	for _, value := range []any{true, "true", "TRUE"} {
		if !parseDockerBool(value) {
			t.Fatalf("expected %#v to be true", value)
		}
	}
	for _, value := range []any{false, "false", nil, 1} {
		if parseDockerBool(value) {
			t.Fatalf("expected %#v to be false", value)
		}
	}
}

func TestBuildDockerOverviewGroupsComposeAndResourceUsage(t *testing.T) {
	containers := []dockerContainerRow{
		{ID: "container1", Names: "demo-web-1", Image: "example/web:latest", State: "running", Status: "Up 2 minutes", Networks: "demo_default"},
		{ID: "container2", Names: "demo-worker-1", Image: "example/worker:latest", State: "exited", Status: "Exited (1)"},
	}
	first := dockerContainerInspect{ID: "container1", Image: "sha256:image1"}
	first.Config.Labels = map[string]string{"com.docker.compose.project": "demo", "com.docker.compose.service": "web"}
	first.State.Status = "running"
	first.State.Running = true
	first.Mounts = append(first.Mounts, struct {
		Name string `json:"Name"`
	}{Name: "demo_data"})
	first.NetworkSettings.Networks = map[string]json.RawMessage{"demo_default": nil}
	second := dockerContainerInspect{ID: "container2", Image: "sha256:image2"}
	second.Config.Labels = map[string]string{"com.docker.compose.project": "demo", "com.docker.compose.service": "worker"}
	second.State.Status = "exited"
	second.State.ExitCode = 1

	overview := buildDockerOverview(
		containers,
		[]dockerContainerInspect{first, second},
		[]dockerImageRow{{ID: "sha256:image1", Repository: "example/web", Tag: "latest", Size: "120MB"}},
		[]dockerVolumeRow{{Name: "demo_data", Driver: "local"}, {Name: "unused_data", Driver: "local"}},
		[]dockerNetworkRow{{ID: "net1", Name: "demo_default", Driver: "bridge"}},
		time.Unix(1, 0).UTC(),
	)

	if len(overview.ComposeProjects) != 1 {
		t.Fatalf("expected one compose project, got %d", len(overview.ComposeProjects))
	}
	project := overview.ComposeProjects[0]
	if project.Name != "demo" || project.ContainerCount != 2 || project.RunningCount != 1 || project.ErrorCount != 1 {
		t.Fatalf("unexpected compose project summary: %#v", project)
	}
	if overview.Containers[0].ComposeService != "web" || overview.Containers[1].Condition != "error" {
		t.Fatalf("unexpected container metadata: %#v", overview.Containers)
	}
	if !overview.Images[0].InUse || overview.Images[0].ContainerCount != 1 {
		t.Fatalf("expected image usage to be reported: %#v", overview.Images[0])
	}
	if !overview.Volumes[0].InUse || overview.Volumes[0].ContainerCount != 1 || overview.Volumes[1].InUse {
		t.Fatalf("unexpected volume usage: %#v", overview.Volumes)
	}
	if !overview.Networks[0].InUse || overview.Networks[0].ContainerCount != 1 {
		t.Fatalf("expected network usage to be reported: %#v", overview.Networks[0])
	}
}

func TestDockerContainerConditionClassifiesFailureStates(t *testing.T) {
	failed := dockerContainerInspect{}
	failed.State.Status = "exited"
	failed.State.ExitCode = 137
	if got := dockerContainerCondition(failed, "exited"); got != "error" {
		t.Fatalf("expected non-zero exit to be error, got %q", got)
	}
	paused := dockerContainerInspect{}
	paused.State.Paused = true
	if got := dockerContainerCondition(paused, "running"); got != "paused" {
		t.Fatalf("expected paused condition, got %q", got)
	}
}
