package bundlename

import "testing"

const (
	chatID    = "9f3a2b1c-uuid-like"
	rootReq   = "req_20260906T192238_1adfea24039ba474"
	derivedID = "req_20260906T193501_a512a09f68dd0c96"
)

func TestBuildAndParseMainRequest(t *testing.T) {
	name := Build(KindRequest, chatID, rootReq, "")
	want := "whx_bundle_req_9f3a2b1c-uuid-like_req_20260906T192238_1adfea24039ba474.zip"
	if name != want {
		t.Fatalf("Build() = %q, want %q", name, want)
	}
	parsed, ok := Parse(name)
	if !ok {
		t.Fatalf("Parse(%q) failed", name)
	}
	if parsed.Kind != KindRequest || parsed.ChatID != chatID || parsed.RequestID != rootReq || parsed.SubrequestID != "" {
		t.Fatalf("unexpected parse result: %#v", parsed)
	}
	if got := RequestIDFromFilename(name); got != rootReq {
		t.Fatalf("RequestIDFromFilename() = %q, want %q", got, rootReq)
	}
}

func TestBuildAndParseDerivedRequest(t *testing.T) {
	name := Build(KindResponse, chatID, rootReq, derivedID)
	want := "whx_bundle_res_9f3a2b1c-uuid-like_req_20260906T192238_1adfea24039ba474_req_20260906T193501_a512a09f68dd0c96.zip"
	if name != want {
		t.Fatalf("Build() = %q, want %q", name, want)
	}
	parsed, ok := Parse(name)
	if !ok {
		t.Fatalf("Parse(%q) failed", name)
	}
	if parsed.Kind != KindResponse || parsed.ChatID != chatID || parsed.RequestID != rootReq || parsed.SubrequestID != derivedID {
		t.Fatalf("unexpected parse result: %#v", parsed)
	}
	if got := RequestIDFromFilename(name); got != derivedID {
		t.Fatalf("RequestIDFromFilename() = %q, want the subrequest id %q", got, derivedID)
	}
}

func TestBuildTreatsEqualSubrequestAsMainRequest(t *testing.T) {
	name := Build(KindRequest, chatID, rootReq, rootReq)
	want := Build(KindRequest, chatID, rootReq, "")
	if name != want {
		t.Fatalf("Build() with subrequestID == requestID = %q, want %q (collapsed to main-request form)", name, want)
	}
}

func TestParseRejectsUnrelatedNames(t *testing.T) {
	for _, bad := range []string{
		"wharness-bundle-req_20260906T192238_1adfea24039ba474.zip",
		"wharness-input-req_20260906T192238_1adfea24039ba474.zip",
		"whx_bundle_req_" + chatID + "_not-a-request-id.zip",
		"whx_bundle_bad_" + chatID + "_" + rootReq + ".zip",
		"whx_bundle_req_" + chatID + "_" + rootReq + ".tar.gz",
		"",
	} {
		if _, ok := Parse(bad); ok {
			t.Fatalf("Parse(%q) unexpectedly succeeded", bad)
		}
	}
}

func TestChatIDPatternRejectsUnderscore(t *testing.T) {
	if ChatIDPattern.MatchString("chat_with_underscore") {
		t.Fatal("ChatIDPattern must reject '_': it is the scheme's own segment separator")
	}
	if !ChatIDPattern.MatchString("f47ac10b-58cc-4372-a567-0e02b2c3d479") {
		t.Fatal("ChatIDPattern must accept a real crypto.randomUUID() shape")
	}
}
