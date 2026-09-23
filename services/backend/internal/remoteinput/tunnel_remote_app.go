package remoteinput

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

func allowTunnelRead(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	return false
}

func firstTunnelSegment(name string) string {
	if name == "" {
		return ""
	}
	if index := strings.IndexByte(name, '/'); index >= 0 {
		return name[:index]
	}
	return name
}

func (p *TryCloudflareProvider) serveStoredObject(w http.ResponseWriter, r *http.Request, name string) bool {
	p.mu.Lock()
	path, ok := p.objects[name]
	p.mu.Unlock()
	if !ok {
		return false
	}
	if !allowTunnelRead(w, r) {
		return true
	}
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return true
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return true
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, name, info.ModTime(), file)
	return true
}

func (p *TryCloudflareProvider) serveRemoteApp(w http.ResponseWriter, r *http.Request) bool {
	p.mu.Lock()
	rawOrigin := p.remoteAppOrigin
	p.mu.Unlock()
	if rawOrigin == "" {
		return false
	}
	target, err := url.Parse(rawOrigin)
	if err != nil || target.Scheme != "http" || target.Host == "" {
		return false
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(request *http.Request) {
		original(request)
		request.Host = target.Host
		request.Header.Set("X-Wharnex-Tunnel", "1")
	}
	proxy.ErrorHandler = func(writer http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(writer, "remote Wharnex app is temporarily unavailable", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
	return true
}
