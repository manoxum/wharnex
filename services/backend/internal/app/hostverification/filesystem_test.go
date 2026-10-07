package hostverification

import "testing"

func TestFilesystemPermissionIsLocalNotSourceRepair(t *testing.T) {
	for _, sample := range []struct {
		text    string
		blocked bool
	}{
		{"Error EACCES: permission denied, rmdir '/project/dist/api/admin'", true},
		{"Error EPERM: operation not permitted, unlink '/project/dist/main.js'", true},
		{"src/app.ts: error TS2322: Type string is not assignable", false},
		{"Assertion failed: expected EACCES: permission denied", false},
		{"permission denied by application authorization", false},
	} {
		blocked := FilesystemBlock(sample.text)
		if (blocked != nil) != sample.blocked {
			t.Fatalf("%q: %#v", sample.text, blocked)
		}
		if blocked != nil && (len(blocked.Paths) != 1 || blocked.Remedy == "") {
			t.Fatalf("missing actionable filesystem evidence: %#v", blocked)
		}
	}
}
