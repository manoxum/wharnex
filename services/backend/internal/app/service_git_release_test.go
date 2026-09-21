package app

import "testing"

func TestComposeReleaseTagUsesVersionAndOptionalSuffix(t *testing.T) {
	tests := []struct {
		name    string
		version string
		suffix  string
		want    string
	}{
		{name: "version only", version: "v1.2.97.3", want: "v1.2.97.3"},
		{name: "suffix", version: " v1.2.97.3\n", suffix: "rc1", want: "v1.2.97.3-rc1"},
		{name: "leading separator", version: "v1.2.97.3", suffix: "-beta", want: "v1.2.97.3-beta"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := composeReleaseTag(test.version, test.suffix)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("composeReleaseTag(%q, %q) = %q; want %q", test.version, test.suffix, got, test.want)
			}
		})
	}
}

func TestComposeReleaseTagRejectsEmptyVersion(t *testing.T) {
	if _, err := composeReleaseTag("  ", "rc1"); err == nil {
		t.Fatal("expected an empty VERSION to be rejected")
	}
}
