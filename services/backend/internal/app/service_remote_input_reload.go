package app

import "context"

// ReloadRemoteInput asks the configured transport to adopt the saved tunnel
// configuration immediately. It is how saving the provider pool in the UI
// replaces what used to require a backend restart.
//
// A transport that cannot reload reports that it did not, so the caller can
// keep telling the operator a restart is still needed rather than claiming a
// change is live when it is not.
func (s *Service) ReloadRemoteInput(ctx context.Context) (bool, error) {
	if s == nil || s.remoteInputs == nil {
		return false, nil
	}
	reloader, ok := s.remoteInputs.(RemoteInputReloader)
	if !ok {
		return false, nil
	}
	if err := reloader.ReloadRemoteInput(ctx); err != nil {
		return false, err
	}
	return true, nil
}
