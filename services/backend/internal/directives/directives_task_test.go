package directives

import (
	"strings"
	"testing"
)

func TestTaskDirectiveCanonicalizesTypedAndCanonicalForms(t *testing.T) {
	input := "reuse @task:otk_20260928T003209_abc-123 then @{[task]task.done_2}"
	parsed := Parse(input)
	if len(parsed) != 2 || parsed[0].Kind != KindTask || parsed[0].Value != "otk_20260928T003209_abc-123" || parsed[1].Value != "task.done_2" {
		t.Fatalf("parsed=%#v", parsed)
	}
	want := "reuse @{[task]otk_20260928T003209_abc-123} then @{[task]task.done_2}"
	if got := Canonicalize(input); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestTaskDirectiveRejectsInvalidOrOversizedIDs(t *testing.T) {
	for _, input := range []string{
		"@task:",
		"@task:../other",
		"@task:task/id",
		"@{[task]bad id}",
		"@task:" + strings.Repeat("a", MaxValueLength+1),
	} {
		if parsed := Parse(input); len(parsed) != 0 {
			t.Fatalf("%q must not parse as @task: %#v", input, parsed)
		}
	}
}
