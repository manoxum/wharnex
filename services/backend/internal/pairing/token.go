package pairing

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"
)

func activeSessions(sessions []sessionRecord, now time.Time) []sessionRecord {
	kept := make([]sessionRecord, 0, len(sessions))
	for _, item := range sessions {
		if item.ExpiresAt.After(now) {
			kept = append(kept, item)
		}
	}
	return kept
}

func randomToken(bytes int) (string, error) {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func hash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
