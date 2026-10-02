package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

type configInput struct {
	EnvironmentID string `json:"environment_id"`
	ProfileID     string `json:"profile_id"`
	URL           string `json:"url"`
	Username      string `json:"username"`
	Password      string `json:"password"`
}
type runInput struct {
	TestIDs []string `json:"test_ids"`
}

func (h *Routes) configure(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var input configInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI testing configuration"))
		return
	}
	if input.EnvironmentID == "" {
		writeErr(w, 400, errors.New("environment_id is required"))
		return
	}
	doc, err := h.store.Configure(item.ProjectPath, input.EnvironmentID, input.ProfileID, input.URL, input.Username, input.Password)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 200, doc)
}

func (h *Routes) run(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var input runInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI test selection"))
		return
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	selected := map[string]bool{}
	for _, id := range input.TestIDs {
		selected[strings.TrimSpace(id)] = true
	}
	if len(selected) == 0 {
		for _, test := range doc.Tests {
			selected[test.ID] = true
		}
	}
	queued := []string{}
	for _, test := range doc.Tests {
		if selected[test.ID] {
			if taskID, err := h.enqueueRun(item.ID, item.ProjectPath, test, doc); err == nil {
				queued = append(queued, taskID)
			} else {
				writeErr(w, 409, err)
				return
			}
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"queued": queued})
}

func (h *Routes) enqueueRun(sessionID, project string, test uitesting.TestCase, doc uitesting.Document) (string, error) {
	env, profile, err := configuredTarget(doc, test)
	if err != nil {
		return "", err
	}
	taskID := session.NewChatAgentTaskID()
	runID := "run_" + strings.TrimPrefix(taskID, "cat_")
	payload, _ := json.Marshal(map[string]any{"protocol": "harness.ui-test-run/v1", "run_id": runID, "test": test, "environment": map[string]any{"id": env.ID, "name": env.Name, "url": env.URL}, "profile": map[string]any{"id": profile.ID, "label": profile.Label, "role": profile.Role}, "max_steps": 24})
	task, err := h.sessions.EnqueueChatAgentTask(session.ChatAgentTask{TaskID: taskID, Type: "UI_TEST_RUN", ProjectID: project, SessionID: sessionID, ChatID: "ui-run:" + sessionID + ":" + test.ID, RequestID: taskID, RootRequestID: taskID, DedupeKey: "ui-run:" + project + ":" + test.ID + ":" + doc.ContextSHA256, Payload: payload, MaxAttempts: 2, NotBefore: time.Now().UTC(), Title: "Teste UI · " + test.Title, Description: test.Goal})
	if err != nil {
		return "", err
	}
	_, err = h.store.BeginRun(project, uitesting.Run{ID: runID, TaskID: task.TaskID, TestID: test.ID, Status: "queued", StartedAt: time.Now().UTC()})
	return task.TaskID, err
}

func configuredTarget(doc uitesting.Document, test uitesting.TestCase) (uitesting.Environment, uitesting.Profile, error) {
	for _, env := range doc.Environments {
		if env.ID == test.EnvironmentID {
			if strings.TrimSpace(env.URL) == "" {
				return env, uitesting.Profile{}, errors.New("test environment URL is not configured")
			}
			if test.ProfileID == "" {
				return env, uitesting.Profile{}, nil
			}
			for _, profile := range env.Profiles {
				if profile.ID == test.ProfileID {
					if !profile.Configured {
						return env, profile, errors.New("test profile credentials are not configured")
					}
					return env, profile, nil
				}
			}
			return env, uitesting.Profile{}, errors.New("test profile is not defined")
		}
	}
	return uitesting.Environment{}, uitesting.Profile{}, errors.New("test environment is not defined")
}
