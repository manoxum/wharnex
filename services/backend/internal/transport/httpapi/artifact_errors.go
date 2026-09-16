package httpapi

import (
	"errors"
	"net/http"

	"kernl.local/harness/backend/internal/app"
)

func writeArtifactMutationError(w http.ResponseWriter, fallbackCode string, err error) {
	if errors.Is(err, app.ErrArtifactStorageFull) {
		writeError(w, http.StatusInsufficientStorage, "artifact_storage_full", "O armazenamento de artefactos está sem espaço livre suficiente. O Wharnex tentou limpar artefactos expirados automaticamente; elimine ficheiros desnecessários da Biblioteca ou liberte espaço em disco e tente novamente.")
		return
	}
	writeError(w, http.StatusBadRequest, fallbackCode, err.Error())
}
