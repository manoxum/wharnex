package remoteinput

import (
	"regexp"
	"strings"
)

var tryCloudflareChannelPattern = regexp.MustCompile(`^[a-f0-9]{32,64}$`)
var tryCloudflarePromptPathPattern = regexp.MustCompile(`^prompts/[A-Za-z0-9._-]{1,180}\.md$`)

// Keep this closed list aligned with every role emitted by
// buildRemoteFileMapResources. An omitted producer role makes the optional
// live channel fail wholesale after its resources have already been prepared.
var tryCloudflareFilePathPattern = regexp.MustCompile(`^files/(context|context-map|knowledge|continuation|git-context|attachment|artifact)/[a-f0-9]{64}$`)
var tryCloudflareHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func validChannelResourcePath(path string) bool {
	switch path {
	case "manifest.json", "state.json", "hash.txt", "bundle-contract.json", "prompt.md", "file-map.json", "diff-check.json":
		return true
	default:
		return tryCloudflarePromptPathPattern.MatchString(path) || tryCloudflareFilePathPattern.MatchString(path)
	}
}

func validChannelContentType(path, contentType string) bool {
	if strings.HasSuffix(path, ".json") {
		return contentType == "application/json"
	}
	if path == "hash.txt" || path == "prompt.md" || strings.HasPrefix(path, "prompts/") {
		return contentType == "text/plain; charset=utf-8"
	}
	return tryCloudflareFilePathPattern.MatchString(path) && (contentType == "text/plain; charset=utf-8" || contentType == "application/octet-stream")
}

func validChannelEvent(event string) bool {
	switch event {
	case "request.ready", "prompt.changed", "context.changed", "attachments.changed", "comment.added", "request.superseded", "request.terminal":
		return true
	default:
		return false
	}
}
