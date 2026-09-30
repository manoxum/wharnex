package sandbox

import (
	"reflect"
	"testing"
)

func TestNpmPeerCompatibilityCommandRecoversObservedEResolve(t *testing.T) {
	diagnostic := `npm error code ERESOLVE
npm error ERESOLVE could not resolve
npm error Could not resolve dependency:
npm error Conflicting peer dependency: graphql@15.10.3`
	want := []string{"npm", "ci", "--legacy-peer-deps"}
	if got := npmPeerCompatibilityCommand([]string{"npm", "ci"}, diagnostic); !reflect.DeepEqual(got, want) {
		t.Fatalf("compatibility command = %v, want %v", got, want)
	}
}

func TestNpmPeerCompatibilityCommandFailsClosedForOtherErrors(t *testing.T) {
	for name, diagnostic := range map[string]string{
		"stale lockfile": "npm error code EUSAGE\npackage.json and package-lock.json are not in sync",
		"install script": "npm error command failed\nnpm error lifecycle test failed",
		"network":        "npm error request failed with ECONNRESET",
	} {
		t.Run(name, func(t *testing.T) {
			if got := npmPeerCompatibilityCommand([]string{"npm", "ci"}, diagnostic); got != nil {
				t.Fatalf("unexpected compatibility fallback: %v", got)
			}
		})
	}
}

func TestNpmPeerCompatibilityCommandDoesNotAlterOtherPackageManagers(t *testing.T) {
	diagnostic := "ERESOLVE could not resolve peer dependency"
	if got := npmPeerCompatibilityCommand([]string{"pnpm", "install", "--frozen-lockfile"}, diagnostic); got != nil {
		t.Fatalf("unexpected pnpm fallback: %v", got)
	}
}

func TestNpmPeerCompatibilityCommandRetriesOnlyOnce(t *testing.T) {
	diagnostic := "ERESOLVE could not resolve peer dependency"
	if got := npmPeerCompatibilityCommand([]string{"npm", "ci", "--legacy-peer-deps"}, diagnostic); got != nil {
		t.Fatalf("compatibility fallback repeated: %v", got)
	}
}
