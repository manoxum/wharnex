package directives

import "testing"

func TestSeeTodoParsesAndCanonicalizes(t *testing.T) {
	parsed := Parse("focus @see:todo|todo_123")
	if len(parsed) != 1 || parsed[0].Kind != KindSee || parsed[0].Source != "todo" || parsed[0].Path != "todo_123" {
		t.Fatalf("parsed=%#v", parsed)
	}
	if got := Canonicalize("focus @see:todo|todo_123"); got != "focus @{[see]todo|todo_123}" {
		t.Fatalf("canonical=%q", got)
	}
}

func TestSeeTodoRejectsMalformedIDs(t *testing.T) {
	for _, marker := range []string{"@see:todo|", "@{[see]todo|../todo}", "@{[see]todo|todo/1}"} {
		if parsed := Parse(marker); len(parsed) != 0 {
			t.Fatalf("%q parsed as %#v", marker, parsed)
		}
	}
}
