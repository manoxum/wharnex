package main

import (
	"net/http"
	"time"
)

const artifactUploadReadTimeout = 30 * time.Minute

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       artifactUploadReadTimeout,
		WriteTimeout:      30 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}
}
