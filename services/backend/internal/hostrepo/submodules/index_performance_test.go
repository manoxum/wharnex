package submodules_test

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

func largeIndex(t testing.TB) string {
	t.Helper()
	root := t.TempDir()
	run := func(input string, args ...string) string {
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		cmd.Stdin = strings.NewReader(input)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("", "init", "-q")
	sha := run("payload", "hash-object", "-w", "--stdin")
	var index strings.Builder
	for i := 0; i < 40_000; i++ {
		fmt.Fprintf(&index, "100644 %s\tfiles/entry-%06d.txt\n", sha, i)
	}
	fmt.Fprintf(&index, "160000 %s\tunregistered module\n", sha)
	run(index.String(), "update-index", "--index-info")
	return root
}

func TestTopologyAllocationDoesNotScaleWithOrdinaryIndexEntries(t *testing.T) {
	root := largeIndex(t)
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	topology, err := hostrepo.Inspect(context.Background(), root)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	if len(topology.Submodules) != 1 || topology.Submodules[0].Path != "unregistered module" || topology.Submodules[0].Registered {
		t.Fatalf("unregistered gitlink lost: %+v", topology.Submodules)
	}
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("topology allocated %d bytes for 40,000 ordinary entries", allocated)
	if allocated > 2<<20 {
		t.Fatalf("topology materializes the ordinary index: %d bytes allocated", allocated)
	}
}

func BenchmarkLargeIndexTopology(b *testing.B) {
	root := largeIndex(b)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := hostrepo.Inspect(context.Background(), root); err != nil {
			b.Fatal(err)
		}
	}
}
