package remoteinput

import (
	"context"
	"errors"
	"regexp"
	"time"
)

type Publication struct {
	Provider       string
	URL            string
	ExpiresAt      time.Time
	CleanupWarning string
}

var objectNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$`)

func validateObjectName(value string) error {
	if !objectNamePattern.MatchString(value) || value == "." || value == ".." {
		return errors.New("invalid remote object name")
	}
	return nil
}

type Provider interface {
	Name() string
	Put(ctx context.Context, objectName, filePath string) (Publication, error)
	Delete(ctx context.Context, objectName string) error
}
