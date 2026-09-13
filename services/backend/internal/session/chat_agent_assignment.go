package session

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var ErrChatAgentTaskAssignment = errors.New("chat agent task assignment conflict")

// normalizeChatAgentWorkerID canonicalizes an agent id.
//
// Both pools address the same durable queue, so both namespaces are accepted:
// `worker-N` for the small-task pool and `supervisor-N` for the chat-bound pool.
// A Supervisor claim carries its own id so an operator pin to that Supervisor is
// honoured by the same `assigned_worker` check Workers already use.
func normalizeChatAgentWorkerID(value string) (string, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	for _, prefix := range []string{"worker-", "supervisor-"} {
		if !strings.HasPrefix(value, prefix) {
			continue
		}
		number, err := strconv.Atoi(strings.TrimPrefix(value, prefix))
		if err != nil || number < 1 || number > 64 {
			break
		}
		return fmt.Sprintf("%s%d", prefix, number), nil
	}
	return "", errors.New("worker_id must use worker-N or supervisor-N format")
}

func chatAgentLeaseMatchesWorker(owner, workerID string) bool {
	owner = strings.TrimSpace(owner)
	return owner == workerID || strings.HasSuffix(owner, ":"+workerID)
}

// AssignChatAgentTask pins queued work to one Worker and optionally enables a
// task-scoped Keep flowing sponsorship. For an already leased/running task the
// assignment may only be adopted by the Worker that currently owns the lease;
// this is what lets an operator promote the current task to Keep flowing without
// reassigning live work underneath another Worker.
func (s *Store) AssignChatAgentTask(taskID, workerID string, keepFlowing bool) (ChatAgentTask, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return ChatAgentTask{}, errors.New("task_id is required")
	}
	if strings.TrimSpace(workerID) != "" {
		var err error
		workerID, err = normalizeChatAgentWorkerID(workerID)
		if err != nil {
			return ChatAgentTask{}, err
		}
	}
	if keepFlowing && workerID == "" {
		return ChatAgentTask{}, errors.New("worker_id is required for task Keep flowing")
	}
	if s.db != nil {
		return s.postgresAssignChatAgentTask(taskID, workerID, keepFlowing)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	switch task.Status {
	case ChatAgentTaskPending, ChatAgentTaskWaiting:
		// Queued work can be routed or returned to automatic scheduling.
	case ChatAgentTaskLeased, ChatAgentTaskRunning:
		if workerID == "" || !chatAgentLeaseMatchesWorker(task.LeaseOwner, workerID) {
			return ChatAgentTask{}, ErrChatAgentTaskAssignment
		}
	default:
		return ChatAgentTask{}, ErrChatAgentTaskAssignment
	}
	task.AssignedWorker = workerID
	task.KeepFlowing = keepFlowing
	task.UpdatedAt = time.Now().UTC()
	s.chatAgentFallback()[taskID] = task
	return task, nil
}

func (s *Store) postgresAssignChatAgentTask(taskID, workerID string, keepFlowing bool) (ChatAgentTask, error) {
	row := s.db.QueryRow(`UPDATE harness_chat_agent_tasks
		SET assigned_worker=$2, keep_flowing=$3, updated_at=now()
		WHERE task_id=$1 AND status IN ('PENDING','WAITING','LEASED','RUNNING')
		  AND (status IN ('PENDING','WAITING') OR ($2<>'' AND (lease_owner=$2 OR right(lease_owner,length($2)+1)=':'||$2)))
		RETURNING `+chatAgentTaskColumns, taskID, workerID, keepFlowing)
	task, err := scanChatAgentTask(row)
	if err == nil {
		return task, nil
	}
	if err != sql.ErrNoRows {
		return ChatAgentTask{}, fmt.Errorf("assign chat agent task: %w", err)
	}
	if _, getErr := s.postgresGetChatAgentTask(taskID); getErr != nil {
		return ChatAgentTask{}, getErr
	}
	return ChatAgentTask{}, ErrChatAgentTaskAssignment
}
