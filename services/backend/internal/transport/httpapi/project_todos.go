package httpapi

import (
	"net/http"

	"kernl.local/harness/backend/internal/app"
)

func (a *API) projectTodos(w http.ResponseWriter, r *http.Request) {
	items, err := a.service.ListProjectTodos(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_todos_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"todos": items})
}

func (a *API) createProjectTodo(w http.ResponseWriter, r *http.Request) {
	var input app.ProjectTodoCreateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := a.service.CreateProjectTodo(r.PathValue("id"), input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_todo_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *API) updateProjectTodo(w http.ResponseWriter, r *http.Request) {
	var input app.ProjectTodoPatchInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := a.service.UpdateProjectTodo(r.PathValue("id"), r.PathValue("todo_id"), input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_todo_update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) classifyProjectTodo(w http.ResponseWriter, r *http.Request) {
	item, err := a.service.ReclassifyProjectTodo(r.PathValue("id"), r.PathValue("todo_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "project_todo_classify_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, item)
}
