package remotemap_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestSelectedProjectFileSurvivesChannelContextRefresh(t *testing.T) {
	for _, directive := range []bool{false, true} {
		name := "transport-reference"
		if directive {
			name = "inline-directive"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			project := t.TempDir()
			path := filepath.Join(project, "main.txt")
			if err := os.WriteFile(path, []byte("first"), 0o600); err != nil {
				t.Fatal(err)
			}
			remote := &channelCapture{}
			service := app.NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
			service.SetRemoteInputStore(remote)
			started, err := service.StartSession(ctx, project)
			if err != nil {
				t.Fatal(err)
			}
			prompt := "inspect main"
			if directive {
				prompt = "inspect @file:main.txt"
			}
			_, item, err := service.SubmitMessage(ctx, started.ID, prompt)
			if err != nil {
				t.Fatal(err)
			}
			request := app.RemoteInputRequest{RequestID: item.LastRequestID, Prompt: item.LastManualPrompt}
			if !directive {
				request.ProjectFiles = []string{"main.txt"}
			}
			if _, err := service.PublishRemoteInput(ctx, started.ID, request); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _, _ = service.FailRemoteInputRequest(ctx, started.ID, item.LastRequestID, "test cleanup") })
			before := selectedFile(t, remote.snapshot())
			if !before.Selected {
				t.Fatal("explicit project file was not selected on publication")
			}
			if err := os.WriteFile(path, []byte("second"), 0o600); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(6 * time.Second)
			for {
				after := selectedFile(t, remote.snapshot())
				if after.SHA256 != before.SHA256 {
					if !after.Selected {
						t.Fatal("context refresh discarded the explicit project-file selection")
					}
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("live channel did not refresh the changed project file")
				}
				time.Sleep(20 * time.Millisecond)
			}
		})
	}
}

type mappedFile struct {
	Path     string `json:"path"`
	Role     string `json:"role"`
	Selected bool   `json:"selected"`
	SHA256   string `json:"sha256"`
}

func selectedFile(t *testing.T, raw []byte) mappedFile {
	t.Helper()
	var document struct {
		Files []mappedFile `json:"files"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	for _, entry := range document.Files {
		if entry.Path == "main.txt" && entry.Role == "context" {
			return entry
		}
	}
	t.Fatal("project file is missing from the channel allowlist")
	return mappedFile{}
}
