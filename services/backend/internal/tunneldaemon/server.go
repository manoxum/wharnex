package tunneldaemon

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/remoteinput"
)

type Server struct {
	manager   *remoteinput.Manager
	connector app.TunnelProviderConnector
	providers []app.TunnelProviderDescriptor
	bridgeDir string
}

func NewServer(manager *remoteinput.Manager, connector app.TunnelProviderConnector, providers []app.TunnelProviderDescriptor, bridgeDir string) (*Server, error) {
	bridge, err := filepath.Abs(strings.TrimSpace(bridgeDir))
	if err != nil || bridge == "" || bridge == string(filepath.Separator) {
		return nil, errors.New("tunnel daemon bridge directory is invalid")
	}
	return &Server{manager: manager, connector: connector, providers: append([]app.TunnelProviderDescriptor(nil), providers...), bridgeDir: bridge}, nil
}

func (s *Server) Handler(token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+APIPathHealth, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET "+APIPathStatus, func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, s.manager.Status()) })
	mux.HandleFunc("GET "+APIPathProviders, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"providers": s.providers})
	})
	mux.HandleFunc("POST "+APIPathEnroll, s.enroll)
	mux.HandleFunc("POST "+APIPathDisconnect, s.disconnect)
	mux.HandleFunc("POST "+APIPathPublish, s.publishObject)
	mux.HandleFunc("POST "+APIPathRetain, s.retainObject)
	mux.HandleFunc("POST "+APIPathRelease, s.releaseObject)
	mux.HandleFunc("POST "+APIPathChannels, s.publishChannel)
	mux.HandleFunc("POST "+APIPathChannelSet, s.publishChannelSet)
	mux.HandleFunc("PUT "+APIPathChannel, s.updateChannel)
	mux.HandleFunc("PUT "+APIPathChannelSet, s.updateChannelSet)
	mux.HandleFunc("DELETE "+APIPathChannel, s.closeChannel)
	mux.HandleFunc("DELETE "+APIPathChannelSet, s.closeChannelSet)
	mux.HandleFunc("POST "+APIPathSessionStart, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("POST "+APIPathSessionClear, s.clearSession)
	mux.HandleFunc("POST "+APIPathCleanup, s.cleanup)
	return authorize(token, mux)
}

func (s *Server) enroll(w http.ResponseWriter, r *http.Request) {
	var request app.TunnelProviderEnrollmentRequest
	if !decode(w, r, &request) {
		return
	}
	result, err := s.connector.Enroll(r.Context(), request)
	respond(w, result, err)
}

func (s *Server) disconnect(w http.ResponseWriter, r *http.Request) {
	var request struct {
		CredentialRef string `json:"credential_ref"`
	}
	if !decode(w, r, &request) {
		return
	}
	respondEmpty(w, s.connector.Disconnect(r.Context(), request.CredentialRef))
}

func (s *Server) publishObject(w http.ResponseWriter, r *http.Request) {
	var object app.RemoteInputObject
	if !decode(w, r, &object) || !s.validateSourcePath(w, object.FilePath) {
		return
	}
	result, err := s.manager.Publish(r.Context(), object)
	respond(w, result, err)
}

func (s *Server) retainObject(w http.ResponseWriter, r *http.Request)  { s.objectLease(w, r, true) }
func (s *Server) releaseObject(w http.ResponseWriter, r *http.Request) { s.objectLease(w, r, false) }

func (s *Server) objectLease(w http.ResponseWriter, r *http.Request, retain bool) {
	var request instanceObjectRequest
	if !decode(w, r, &request) {
		return
	}
	var err error
	if retain {
		err = s.manager.RetainRemoteInput(request.InstanceID, request.ObjectName)
	} else {
		err = s.manager.ReleaseRemoteInput(request.InstanceID, request.ObjectName)
	}
	respondEmpty(w, err)
}

func (s *Server) publishChannel(w http.ResponseWriter, r *http.Request) {
	var channel app.RemoteInputChannel
	if !decode(w, r, &channel) || !s.validateResources(w, channel.Resources) {
		return
	}
	result, err := s.manager.PublishRemoteInputChannel(r.Context(), channel)
	respond(w, result, err)
}

func (s *Server) publishChannelSet(w http.ResponseWriter, r *http.Request) {
	var channel app.RemoteInputChannel
	if !decode(w, r, &channel) || !s.validateResources(w, channel.Resources) {
		return
	}
	result, err := s.manager.PublishRemoteInputChannelSet(r.Context(), channel)
	respond(w, result, err)
}

func (s *Server) updateChannel(w http.ResponseWriter, r *http.Request) {
	var request struct {
		InstanceID string                       `json:"instance_id"`
		Update     app.RemoteInputChannelUpdate `json:"update"`
	}
	if !decode(w, r, &request) || !s.validateResources(w, request.Update.Resources) {
		return
	}
	respondEmpty(w, s.manager.UpdateRemoteInputChannel(r.Context(), request.InstanceID, request.Update))
}

func (s *Server) updateChannelSet(w http.ResponseWriter, r *http.Request) {
	var request struct {
		InstanceIDs []string                     `json:"instance_ids"`
		Update      app.RemoteInputChannelUpdate `json:"update"`
	}
	if !decode(w, r, &request) || !s.validateResources(w, request.Update.Resources) {
		return
	}
	respondEmpty(w, s.manager.UpdateRemoteInputChannelSet(r.Context(), request.InstanceIDs, request.Update))
}

func (s *Server) closeChannel(w http.ResponseWriter, r *http.Request) {
	var request instanceChannelRequest
	if !decode(w, r, &request) {
		return
	}
	respondEmpty(w, s.manager.CloseRemoteInputChannel(r.Context(), request.InstanceID, request.ChannelID))
}

func (s *Server) closeChannelSet(w http.ResponseWriter, r *http.Request) {
	var request closeChannelSetRequest
	if !decode(w, r, &request) {
		return
	}
	respondEmpty(w, s.manager.CloseRemoteInputChannelSet(r.Context(), request.InstanceIDs, request.ChannelID))
}

func (s *Server) clearSession(w http.ResponseWriter, r *http.Request) {
	respondEmpty(w, s.manager.ClearRemoteInputSession(r.Context()))
}

func (s *Server) cleanup(w http.ResponseWriter, r *http.Request) {
	var request cleanupRequest
	if !decode(w, r, &request) {
		return
	}
	cutoff, err := time.Parse(time.RFC3339Nano, request.Cutoff)
	if err == nil {
		err = s.manager.Cleanup(r.Context(), cutoff)
	}
	respondEmpty(w, err)
}

func (s *Server) validateResources(w http.ResponseWriter, resources []app.RemoteInputChannelResource) bool {
	for _, resource := range resources {
		for _, candidate := range []string{resource.FilePath, resource.ArchivePath} {
			if candidate != "" && !s.validateSourcePath(w, candidate) {
				return false
			}
		}
	}
	return true
}

func (s *Server) validateSourcePath(w http.ResponseWriter, source string) bool {
	clean, err := filepath.Abs(filepath.Clean(source))
	if err != nil {
		http.Error(w, "invalid shared source path", http.StatusBadRequest)
		return false
	}
	relative, err := filepath.Rel(s.bridgeDir, clean)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." {
		http.Error(w, "source path is outside the shared bridge", http.StatusBadRequest)
		return false
	}
	info, err := os.Lstat(clean)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		http.Error(w, "shared source path is not a regular file", http.StatusBadRequest)
		return false
	}
	return true
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 16<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}

func respond(w http.ResponseWriter, value any, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func respondEmpty(w http.ResponseWriter, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
