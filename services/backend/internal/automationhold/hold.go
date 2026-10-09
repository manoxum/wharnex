// Package automationhold owns durable, operator- or evidence-raised holds on
// ChatGPT browser automation.
//
// A hold is not a task state: the tasks it covers keep their status, attempts
// and not_before untouched. The durable claim excludes held task types before
// an attempt is charged, so suspending work never spends its budget and
// releasing the hold makes it claimable again exactly as it was.
package automationhold

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	// ChatGPTUpload records the account-wide ChatGPT file-upload limit the
	// Desktop detected. Upload-bound work defers at the upload boundary.
	ChatGPTUpload = "chatgpt_upload"
	// taskPrefix names one hold per browser task type ("task:BOT_WRITE"),
	// raised and released by the operator. It covers every pool.
	taskPrefix = "task:"
)

const maxReasonBytes = 500

var (
	// ErrUnknownHold is returned for a name outside the closed set.
	ErrUnknownHold = errors.New("unknown automation hold")
	// ErrInvalidHold is returned for a hold that cannot be stored as given.
	ErrInvalidHold = errors.New("invalid automation hold")
)

// Hold is one named hold. Until is optional: an active hold without it stays
// in force until it is released. Default marks a task hold that has never
// been set and takes the catalog's default.
type Hold struct {
	Name      string     `json:"name"`
	UID       string     `json:"uid,omitempty"`
	Active    bool       `json:"active"`
	Until     *time.Time `json:"until,omitempty"`
	Level     int        `json:"level"`
	Reason    string     `json:"reason"`
	Source    string     `json:"source"`
	Default   bool       `json:"default,omitempty"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// InForce reports whether the hold blocks work at now.
func (h Hold) InForce(now time.Time) bool {
	return h.Active && (h.Until == nil || h.Until.After(now))
}

// Store persists holds. List returns only holds that were ever set.
type Store interface {
	Get(ctx context.Context, name string) (Hold, error)
	Set(ctx context.Context, hold Hold) (Hold, error)
	List(ctx context.Context) ([]Hold, error)
}

// Catalog is the closed set of task types a task hold may name, and those
// held until the operator first decides otherwise.
type Catalog struct {
	TaskTypes   []string
	DefaultHeld []string
}

// TaskHold names the operator hold of one browser task type.
func TaskHold(taskType string) string {
	return taskPrefix + strings.ToUpper(strings.TrimSpace(taskType))
}

// TaskTypeOf returns the task type a task hold names, or "".
func TaskTypeOf(name string) string {
	if !strings.HasPrefix(name, taskPrefix) {
		return ""
	}
	return strings.TrimPrefix(name, taskPrefix)
}

func (c Catalog) knownType(taskType string) bool { return contains(c.TaskTypes, taskType) }

// Known reports whether name belongs to the closed set of holds.
func (c Catalog) Known(name string) bool {
	return name == ChatGPTUpload || (TaskTypeOf(name) != "" && c.knownType(TaskTypeOf(name)))
}

// unset is the hold a name has before it was ever stored.
func (c Catalog) unset(name string) Hold {
	held := contains(c.DefaultHeld, TaskTypeOf(name))
	hold := Hold{Name: name, Active: held, Default: true}
	if held {
		hold.Reason, hold.Source = "Suspenso por omissão até decisão do operador", "default"
	}
	return hold
}

// Normalize validates a hold before it is stored.
func (c Catalog) Normalize(hold Hold, now time.Time) (Hold, error) {
	hold.Name = strings.TrimSpace(hold.Name)
	if !c.Known(hold.Name) {
		return Hold{}, ErrUnknownHold
	}
	if hold.Active && hold.Until != nil && !hold.Until.After(now) {
		return Hold{}, fmt.Errorf("%w: until must be in the future", ErrInvalidHold)
	}
	if hold.Level < 0 {
		hold.Level = 0
	}
	hold.Reason = bounded(hold.Reason)
	hold.Source = bounded(hold.Source)
	if !hold.Active {
		hold.Until, hold.Level, hold.Reason = nil, 0, ""
	}
	hold.Default = false
	hold.UpdatedAt = now
	return hold, nil
}

func bounded(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > maxReasonBytes {
		value = value[:maxReasonBytes]
	}
	return value
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// TaskHolds returns every catalog task type's effective hold: the stored one,
// or the catalog default for a type the operator never set.
func TaskHolds(ctx context.Context, store Store, catalog Catalog) (map[string]Hold, error) {
	stored, err := store.List(ctx)
	if err != nil {
		return nil, err
	}
	byName := map[string]Hold{}
	for _, hold := range stored {
		byName[hold.Name] = hold
	}
	result := map[string]Hold{}
	for _, taskType := range catalog.TaskTypes {
		name := TaskHold(taskType)
		hold, ok := byName[name]
		if !ok {
			hold = catalog.unset(name)
		}
		result[taskType] = hold
	}
	return result, nil
}

// ExcludedTaskTypes returns the task types the durable claim must refuse at
// now. A hold that cannot be read is reported, never treated as released.
func ExcludedTaskTypes(ctx context.Context, store Store, catalog Catalog, now time.Time) ([]string, error) {
	holds, err := TaskHolds(ctx, store, catalog)
	if err != nil {
		return nil, err
	}
	var excluded []string
	for _, taskType := range catalog.TaskTypes {
		if holds[taskType].InForce(now) {
			excluded = append(excluded, taskType)
		}
	}
	return excluded, nil
}
