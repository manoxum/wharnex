package app

import "testing"

func TestValidateDockerIdentifier(t *testing.T) {
	valid := []string{"abc123", "container-name", "service_1.2"}
	for _, value := range valid {
		if err := validateDockerIdentifier(value); err != nil {
			t.Fatalf("expected %q to be valid: %v", value, err)
		}
	}
	invalid := []string{"", "../container", "name with space", "container;rm"}
	for _, value := range invalid {
		if err := validateDockerIdentifier(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestParseDockerBool(t *testing.T) {
	for _, value := range []any{true, "true", "TRUE"} {
		if !parseDockerBool(value) {
			t.Fatalf("expected %#v to be true", value)
		}
	}
	for _, value := range []any{false, "false", nil, 1} {
		if parseDockerBool(value) {
			t.Fatalf("expected %#v to be false", value)
		}
	}
}
