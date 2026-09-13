package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	ChatAgentClaimAny            = "any"
	ChatAgentClaimResidentOnly   = "resident_only"
	ChatAgentClaimUnresidentOnly = "unresident_only"
)

// Pool roles. An empty role is unrestricted and remains the behaviour for any
// caller that does not run a role-partitioned pool (the dev/web path).
const (
	ChatAgentRoleSupervisor = "supervisor"
	ChatAgentRoleWorker     = "worker"
)

type ChatAgentClaimOptions struct {
	WorkerID      string   `json:"worker_id"`
	PreferredLane string   `json:"preferred_lane"`
	ExcludedLanes []string `json:"excluded_lanes"`
	FallbackMode  string   `json:"fallback_mode"`
	// Role partitions task types between the Supervisor and Worker pools.
	//
	// It belongs in the claim rather than in a client-side check for the same
	// reason project scoping does: a claim charges an attempt, so claiming work
	// the wrong pool cannot run and handing it straight back would spend that
	// task's own bounded retry budget on a routing decision.
	Role string `json:"role"`
	// ProjectScoped and OpenProjects restrict the claim to work the operator
	// can actually supervise: a project currently open in some window.
	//
	// The flag is separate from the list because "no projects are open" and
	// "this caller does not know the window topology" are opposite instructions
	// and an empty slice cannot express both. A caller that cannot scope — the
	// web/dev path — leaves ProjectScoped false and claims as before.
	ProjectScoped bool     `json:"project_scoped"`
	OpenProjects  []string `json:"open_projects"`
}

func chatAgentTaskLane(task ChatAgentTask) string {
	if value := strings.TrimSpace(task.ConversationID); value != "" {
		return "c:" + value
	}
	if value := strings.TrimSpace(task.ChatID); value != "" {
		return "h:" + value
	}
	return ""
}

func normalizeChatAgentClaimOptions(input ChatAgentClaimOptions) (ChatAgentClaimOptions, error) {
	if strings.TrimSpace(input.WorkerID) != "" {
		worker, err := normalizeChatAgentWorkerID(input.WorkerID)
		if err != nil {
			return ChatAgentClaimOptions{}, err
		}
		input.WorkerID = worker
	}
	input.Role = strings.ToLower(strings.TrimSpace(input.Role))
	switch input.Role {
	case "", ChatAgentRoleSupervisor, ChatAgentRoleWorker:
	default:
		return ChatAgentClaimOptions{}, fmt.Errorf("unsupported chat agent pool role %q", input.Role)
	}
	input.PreferredLane = strings.TrimSpace(input.PreferredLane)
	input.FallbackMode = strings.TrimSpace(input.FallbackMode)
	if input.FallbackMode == "" {
		input.FallbackMode = ChatAgentClaimAny
	}
	switch input.FallbackMode {
	case ChatAgentClaimAny, ChatAgentClaimResidentOnly, ChatAgentClaimUnresidentOnly:
	default:
		return ChatAgentClaimOptions{}, fmt.Errorf("unsupported chat agent fallback mode %q", input.FallbackMode)
	}
	if input.FallbackMode == ChatAgentClaimResidentOnly && input.PreferredLane == "" {
		return ChatAgentClaimOptions{}, errors.New("preferred_lane is required for resident_only claim")
	}
	seen := map[string]struct{}{}
	cleaned := make([]string, 0, len(input.ExcludedLanes))
	for _, raw := range input.ExcludedLanes {
		lane := strings.TrimSpace(raw)
		if lane == "" || lane == input.PreferredLane {
			continue
		}
		if _, ok := seen[lane]; ok {
			continue
		}
		seen[lane] = struct{}{}
		cleaned = append(cleaned, lane)
	}
	if len(cleaned) > 32 {
		return ChatAgentClaimOptions{}, errors.New("excluded_lanes must contain at most 32 lanes")
	}
	input.ExcludedLanes = cleaned
	projects := make([]string, 0, len(input.OpenProjects))
	seenProjects := map[string]struct{}{}
	for _, raw := range input.OpenProjects {
		project := normalizeChatAgentProjectID(raw)
		if project == "" {
			continue
		}
		if _, ok := seenProjects[project]; ok {
			continue
		}
		seenProjects[project] = struct{}{}
		projects = append(projects, project)
	}
	if len(projects) > 32 {
		return ChatAgentClaimOptions{}, errors.New("open_projects must contain at most 32 projects")
	}
	input.OpenProjects = projects
	return input, nil
}

// chatAgentClaimProjectAllows reports whether a task's owning project permits it
// to be claimed by this caller.
//
// Account-lifecycle work is exempt on purpose. Those types act on the ChatGPT
// account rather than on a project, and the chat-deletion convergence rule
// requires deletion to actually reach the remote conversation, its temporary
// sibling and its library bundles. Scoping them to an open project would leave
// the operator's account accumulating conversations and files they explicitly
// asked to be removed, with no surface anywhere explaining why.
//
// An unattributed task is likewise claimable: it belongs to no project, so no
// project's absence can be a reason to hold it.
func chatAgentClaimProjectAllows(task ChatAgentTask, options ChatAgentClaimOptions) bool {
	if !options.ProjectScoped || task.ProjectID == "" || chatAgentTaskAccount(task.Type) {
		return true
	}
	for _, project := range options.OpenProjects {
		if task.ProjectID == project {
			return true
		}
	}
	return false
}

// chatAgentClaimRoleAllows reports whether this pool may run the task's type.
//
// An explicit operator pin overrides the partition: the pin already names one
// canonical agent, and refusing it by role would leave the task reachable by
// nobody at all — pinned away from its own pool and barred from the other.
func chatAgentClaimRoleAllows(task ChatAgentTask, options ChatAgentClaimOptions) bool {
	if options.Role == "" || task.AssignedWorker != "" {
		return true
	}
	if options.Role == ChatAgentRoleSupervisor {
		return chatAgentTaskSupervisor(task.Type)
	}
	return !chatAgentTaskSupervisor(task.Type)
}

func chatAgentClaimAllows(task ChatAgentTask, options ChatAgentClaimOptions) bool {
	if task.AssignedWorker != "" && task.AssignedWorker != options.WorkerID {
		return false
	}
	if !chatAgentClaimRoleAllows(task, options) {
		return false
	}
	if !chatAgentClaimProjectAllows(task, options) {
		return false
	}
	lane := chatAgentTaskLane(task)
	for _, excluded := range options.ExcludedLanes {
		if lane == excluded {
			return false
		}
	}
	switch options.FallbackMode {
	case ChatAgentClaimResidentOnly:
		return lane == options.PreferredLane
	case ChatAgentClaimUnresidentOnly:
		return options.PreferredLane == "" || lane != options.PreferredLane
	default:
		return true
	}
}

func (s *Store) ClaimChatAgentTask(owner string, lease time.Duration) (*ChatAgentTask, error) {
	return s.ClaimChatAgentTaskWithOptions(owner, lease, ChatAgentClaimOptions{})
}

func (s *Store) ClaimChatAgentTaskWithOptions(owner string, lease time.Duration, input ChatAgentClaimOptions) (*ChatAgentTask, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, errors.New("lease owner is required")
	}
	if lease < 5*time.Second || lease > 10*time.Minute {
		return nil, errors.New("lease duration must be between 5 seconds and 10 minutes")
	}
	options, err := normalizeChatAgentClaimOptions(input)
	if err != nil {
		return nil, err
	}
	if s.db != nil {
		return s.postgresClaimChatAgentTask(owner, lease, options)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if state := s.chatAgentProvider; state.Paused &&
		(state.PausedUntil == nil || state.PausedUntil.After(now)) {
		return nil, nil
	}
	if s.chatAgentProvider.Paused && s.chatAgentProvider.PausedUntil != nil {
		s.chatAgentProvider.Paused = false
		s.chatAgentProvider.PausedUntil = nil
		s.chatAgentProvider.Reason = ""
		s.chatAgentProvider.UpdatedAt = now
	}
	tasks := s.chatAgentFallback()
	for id, task := range tasks {
		if (task.Status == ChatAgentTaskLeased || task.Status == ChatAgentTaskRunning) &&
			task.LeaseExpiresAt != nil && !task.LeaseExpiresAt.After(now) {
			if task.Attempt >= task.MaxAttempts {
				task.Status = ChatAgentTaskFailed
				task.LastError = "lease expired after maximum attempts"
			} else {
				task.Status = ChatAgentTaskPending
			}
			task.LeaseOwner = ""
			task.LeaseExpiresAt = nil
			task.UpdatedAt = now
			tasks[id] = task
		}
	}
	eligible := make([]ChatAgentTask, 0, len(tasks))
	for _, task := range tasks {
		if task.Status != ChatAgentTaskPending && task.Status != ChatAgentTaskWaiting {
			continue
		}
		if task.NotBefore.After(now) || task.Attempt >= task.MaxAttempts {
			continue
		}
		if chatAgentBlockedByActiveTask(task, tasks, now) || !chatAgentClaimAllows(task, options) {
			continue
		}
		eligible = append(eligible, task)
	}
	sort.Slice(eligible, func(i, j int) bool {
		if options.PreferredLane != "" {
			iPreferred := chatAgentTaskLane(eligible[i]) == options.PreferredLane
			jPreferred := chatAgentTaskLane(eligible[j]) == options.PreferredLane
			if iPreferred != jPreferred {
				return iPreferred
			}
		}
		pi := chatAgentEffectivePriority(eligible[i], now)
		pj := chatAgentEffectivePriority(eligible[j], now)
		if pi != pj {
			return pi < pj
		}
		if eligible[i].CreatedAt.Equal(eligible[j].CreatedAt) {
			return eligible[i].TaskID < eligible[j].TaskID
		}
		return eligible[i].CreatedAt.Before(eligible[j].CreatedAt)
	})
	if len(eligible) == 0 {
		return nil, nil
	}
	task := eligible[0]
	expires := now.Add(lease)
	task.Status = ChatAgentTaskLeased
	task.LeaseOwner = owner
	task.LeaseExpiresAt = &expires
	task.Attempt++
	task.UpdatedAt = now
	tasks[task.TaskID] = task
	return &task, nil
}

// chatAgentSilencedByLiveSupervision reports whether a conversation-surface task
// must stand back because its conversation is still producing a response.
//
// The lease lock below cannot express this: AWAIT_RESPONSE spends almost all of
// its life in WAITING so the worker is released between observations, which left
// a window every cycle in which account work could drive the very conversation
// the model was still writing into.
func chatAgentSilencedByLiveSupervision(candidate ChatAgentTask, tasks map[string]ChatAgentTask) bool {
	if candidate.ConversationID == "" || !chatAgentQuietWhileAwaiting(candidate.Type) {
		return false
	}
	for _, supervision := range tasks {
		if supervision.TaskID == candidate.TaskID || supervision.Type != "AWAIT_RESPONSE" ||
			supervision.ConversationID != candidate.ConversationID {
			continue
		}
		switch supervision.Status {
		case ChatAgentTaskLeased, ChatAgentTaskRunning:
			return true
		case ChatAgentTaskPending, ChatAgentTaskWaiting:
			// A supervision past its attempt budget can never run again, so
			// treating it as live would silence the conversation for good.
			if supervision.Attempt < supervision.MaxAttempts {
				return true
			}
		}
	}
	return false
}

func chatAgentBlockedByActiveTask(candidate ChatAgentTask, tasks map[string]ChatAgentTask, now time.Time) bool {
	if chatAgentSilencedByLiveSupervision(candidate, tasks) {
		return true
	}
	for _, running := range tasks {
		if running.TaskID == candidate.TaskID || (running.Status != ChatAgentTaskLeased && running.Status != ChatAgentTaskRunning) {
			continue
		}
		if running.LeaseExpiresAt != nil && !running.LeaseExpiresAt.After(now) {
			continue
		}
		if chatAgentTaskAccount(candidate.Type) && chatAgentTaskAccount(running.Type) {
			return true
		}
		if candidate.ConversationID != "" && candidate.ConversationID == running.ConversationID &&
			(chatAgentTaskWriter(candidate.Type) || chatAgentTaskWriter(running.Type)) {
			return true
		}
	}
	return false
}

// chatAgentBlockedByActiveTaskSQL is the durable PostgreSQL equivalent of
// chatAgentBlockedByActiveTask. Both the claim and queue summary use it: a task
// protected by account/conversation exclusivity is waiting on that guard, not
// on an idle Worker, and must not be reported as immediately claimable.
func chatAgentBlockedByActiveTaskSQL(candidate string) string {
	return `(
		(` + chatAgentTaskAccountSQL(candidate+".type") + ` AND EXISTS (
			SELECT 1 FROM harness_chat_agent_tasks a
			WHERE a.task_id<>` + candidate + `.task_id
			  AND a.status IN ('LEASED','RUNNING') AND a.lease_expires_at>now()
			  AND ` + chatAgentTaskAccountSQL("a.type") + `
		))
		OR (` + candidate + `.conversation_id<>'' AND EXISTS (
			SELECT 1 FROM harness_chat_agent_tasks w
			WHERE w.task_id<>` + candidate + `.task_id
			  AND w.status IN ('LEASED','RUNNING') AND w.lease_expires_at>now()
			  AND w.conversation_id=` + candidate + `.conversation_id
			  AND (` + chatAgentTaskWriterSQL(candidate+".type") + ` OR ` + chatAgentTaskWriterSQL("w.type") + `)
		))
		OR (` + candidate + `.conversation_id<>'' AND ` + chatAgentQuietWhileAwaitingSQL(candidate+".type") + ` AND EXISTS (
			SELECT 1 FROM harness_chat_agent_tasks s
			WHERE s.task_id<>` + candidate + `.task_id
			  AND s.conversation_id=` + candidate + `.conversation_id
			  AND s.type='AWAIT_RESPONSE'
			  AND (s.status IN ('LEASED','RUNNING')
				OR (s.status IN ('PENDING','WAITING') AND s.attempt<s.max_attempts))
		))
	)`
}

func (s *Store) StartChatAgentTask(taskID, owner string) (ChatAgentTask, error) {
	return s.transitionChatAgentTask(taskID, owner, ChatAgentTaskRunning, time.Time{}, "", false)
}

// WaitChatAgentTask returns a leased task to WAITING until notBefore.
//
// `observation` marks a lease that only watched healthy remote progress rather
// than attempting anything. A claim always increments `attempt`, which is
// correct for a try and wrong for a passive probe: `AWAIT_RESPONSE` observes a
// resident conversation every 30 seconds for as long as the model keeps
// working, so with a bounded budget a long — but perfectly healthy — response
// exhausts its own supervisor and the request is abandoned mid-reasoning. An
// observation therefore gives the increment back, leaving the budget to count
// only real attempts. It never falls below zero, and the caller may only claim
// it when the remote side is provably still generating.
func (s *Store) WaitChatAgentTask(taskID, owner string, notBefore time.Time, detail string, observation bool) (ChatAgentTask, error) {
	if notBefore.IsZero() {
		return ChatAgentTask{}, errors.New("not_before is required for WAITING")
	}
	return s.transitionChatAgentTask(taskID, owner, ChatAgentTaskWaiting, notBefore, detail, observation)
}

func (s *Store) CompleteChatAgentTask(taskID, owner string) (ChatAgentTask, error) {
	return s.completeChatAgentTask(taskID, owner, nil)
}

func (s *Store) CompleteChatAgentTaskWithPayload(taskID, owner string, payload json.RawMessage) (ChatAgentTask, error) {
	if len(payload) == 0 || !json.Valid(payload) {
		return ChatAgentTask{}, errors.New("chat agent completion payload must be valid JSON")
	}
	return s.completeChatAgentTask(taskID, owner, payload)
}

func (s *Store) completeChatAgentTask(taskID, owner string, payload json.RawMessage) (ChatAgentTask, error) {
	if s.db != nil {
		if len(payload) == 0 {
			return s.postgresTransitionChatAgentTask(taskID, owner, ChatAgentTaskDone, time.Time{}, "", false)
		}
		return s.postgresCompleteChatAgentTask(taskID, owner, payload)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if task.LeaseOwner != owner || strings.TrimSpace(owner) == "" || (task.Status != ChatAgentTaskLeased && task.Status != ChatAgentTaskRunning) {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	if len(payload) > 0 {
		task.Payload = append(json.RawMessage(nil), payload...)
	}
	task.Status = ChatAgentTaskDone
	task.LastError = ""
	task.LeaseOwner = ""
	task.LeaseExpiresAt = nil
	task.UpdatedAt = time.Now().UTC()
	s.chatAgentFallback()[task.TaskID] = task
	return task, nil
}

func (s *Store) FailChatAgentTask(taskID, owner, detail string, attention bool) (ChatAgentTask, error) {
	status := ChatAgentTaskFailed
	if attention {
		status = ChatAgentTaskAttention
	}
	return s.transitionChatAgentTask(taskID, owner, status, time.Time{}, detail, false)
}

// Diagnostic precedence for `last_error`.
//
// An observation is the outcome of a lease that attempted nothing, so its note
// explains why the task is waiting — not what went wrong. Letting that note
// overwrite the error of a real, attempt-consuming failure erases the only
// record of why the budget is draining: a task reads as "waiting for the
// provider cooldown" at attempt 7/8 while the failures that actually spent
// those seven attempts have each been overwritten by the next benign note.
// A real failure therefore holds the field until another real outcome replaces
// it, and an observation fills it only while it is empty.
func chatAgentTransitionError(current, detail, status string, observation bool) string {
	next := strings.TrimSpace(detail)
	if status == ChatAgentTaskWaiting && observation && strings.TrimSpace(current) != "" {
		return current
	}
	return next
}

func (s *Store) transitionChatAgentTask(taskID, owner, status string, notBefore time.Time, detail string, observation bool) (ChatAgentTask, error) {
	if s.db != nil {
		return s.postgresTransitionChatAgentTask(taskID, owner, status, notBefore, detail, observation)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if task.LeaseOwner != owner || strings.TrimSpace(owner) == "" {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	switch status {
	case ChatAgentTaskRunning:
		if task.Status != ChatAgentTaskLeased {
			return ChatAgentTask{}, fmt.Errorf("cannot start chat agent task from %s", task.Status)
		}
	case ChatAgentTaskWaiting, ChatAgentTaskDone, ChatAgentTaskFailed, ChatAgentTaskAttention:
		if task.Status != ChatAgentTaskLeased && task.Status != ChatAgentTaskRunning {
			return ChatAgentTask{}, fmt.Errorf("cannot finish chat agent task from %s", task.Status)
		}
	default:
		return ChatAgentTask{}, fmt.Errorf("unsupported chat agent transition %s", status)
	}
	now := time.Now().UTC()
	task.Status = status
	task.LastError = chatAgentTransitionError(task.LastError, detail, status, observation)
	if status == ChatAgentTaskWaiting {
		task.NotBefore = notBefore.UTC()
		if observation && task.Attempt > 0 {
			task.Attempt--
		}
	}
	if status != ChatAgentTaskRunning {
		task.LeaseOwner = ""
		task.LeaseExpiresAt = nil
	}
	task.UpdatedAt = now
	s.chatAgentFallback()[task.TaskID] = task
	return task, nil
}

func (s *Store) HeartbeatChatAgentTask(taskID, owner string, lease time.Duration) (ChatAgentTask, error) {
	if lease < 5*time.Second || lease > 10*time.Minute {
		return ChatAgentTask{}, errors.New("lease duration must be between 5 seconds and 10 minutes")
	}
	if s.db != nil {
		return s.postgresHeartbeatChatAgentTask(taskID, owner, lease)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if task.LeaseOwner != owner || (task.Status != ChatAgentTaskLeased && task.Status != ChatAgentTaskRunning) {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	now := time.Now().UTC()
	expires := now.Add(lease)
	task.LeaseExpiresAt = &expires
	task.UpdatedAt = now
	s.chatAgentFallback()[taskID] = task
	return task, nil
}

func (s *Store) CancelChatAgentLineage(rootRequestID string) (int, error) {
	rootRequestID = strings.TrimSpace(rootRequestID)
	if rootRequestID == "" {
		return 0, errors.New("root_request_id is required")
	}
	if s.db != nil {
		return s.postgresCancelChatAgentLineage(rootRequestID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	count := 0
	for id, task := range s.chatAgentFallback() {
		if task.RootRequestID != rootRequestID || !chatAgentTaskActive(task.Status) {
			continue
		}
		task.Status = ChatAgentTaskCancelled
		task.LeaseOwner = ""
		task.LeaseExpiresAt = nil
		task.UpdatedAt = now
		s.chatAgentFallback()[id] = task
		count++
	}
	return count, nil
}
