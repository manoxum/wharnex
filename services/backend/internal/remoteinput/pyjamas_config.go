package remoteinput

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const (
	pyjamasHost           = "tunnel.pyjam.as"
	pyjamasMaxConfigBytes = 8 << 10
)

// pyjamasNetwork bounds every address the provider is willing to accept from
// the remote document, so a hostile response cannot make Wharnex claim a
// routable address or widen the peer beyond the one server it must reach.
var pyjamasNetwork = netip.MustParsePrefix("10.101.0.0/16")

var pyjamasPublicURLPattern = regexp.MustCompile(`https://[a-z0-9-]{1,63}\.tunnel\.pyjam\.as/`)

// pyjamasConfig is the parsed subset of the WireGuard document served by
// tunnel.pyjam.as. The document also carries script hooks (PostUp, PostDown,
// PreUp, PreDown) that `wg-quick` would execute as root shell strings chosen by
// the remote service. Wharnex never executes them: PostUp is read purely as
// data because it is the only place the public slug appears, and every other
// hook is discarded.
type pyjamasConfig struct {
	address       netip.Addr
	privateKey    string
	peerPublicKey string
	allowedIP     netip.Prefix
	endpointHost  string
	endpointPort  int
	keepalive     int
	public        *url.URL
}

// fetchPyjamasConfig asks tunnel.pyjam.as to publish localPort and returns the
// parsed provisioning document. Redirects are refused so the request cannot be
// steered to another origin.
func fetchPyjamasConfig(ctx context.Context, client *http.Client, localPort int) (pyjamasConfig, error) {
	if localPort < 1024 || localPort > 65535 {
		return pyjamasConfig{}, errors.New("pyjam.as local port must be between 1024 and 65535")
	}
	endpoint := "https://" + pyjamasHost + "/" + strconv.Itoa(localPort)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return pyjamasConfig{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return pyjamasConfig{}, fmt.Errorf("request pyjam.as tunnel: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return pyjamasConfig{}, fmt.Errorf("pyjam.as returned status %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, pyjamasMaxConfigBytes+1))
	if err != nil {
		return pyjamasConfig{}, fmt.Errorf("read pyjam.as tunnel config: %w", err)
	}
	if len(raw) > pyjamasMaxConfigBytes {
		return pyjamasConfig{}, errors.New("pyjam.as tunnel config is too large")
	}
	return parsePyjamasConfig(string(raw))
}

func parsePyjamasConfig(raw string) (pyjamasConfig, error) {
	section := ""
	values := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.Trim(line, "[]"))
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found || section == "" {
			continue
		}
		// First occurrence wins so a trailing duplicate cannot override a
		// directive that was already validated.
		name := section + "." + strings.ToLower(strings.TrimSpace(key))
		if _, exists := values[name]; !exists {
			values[name] = strings.TrimSpace(value)
		}
	}
	return buildPyjamasConfig(values)
}

func buildPyjamasConfig(values map[string]string) (pyjamasConfig, error) {
	address, err := parsePyjamasAddress(values["interface.address"])
	if err != nil {
		return pyjamasConfig{}, fmt.Errorf("pyjam.as interface address %w", err)
	}
	privateKey, err := decodePyjamasKey(values["interface.privatekey"])
	if err != nil {
		return pyjamasConfig{}, fmt.Errorf("pyjam.as private key %w", err)
	}
	peerPublicKey, err := decodePyjamasKey(values["peer.publickey"])
	if err != nil {
		return pyjamasConfig{}, fmt.Errorf("pyjam.as peer public key %w", err)
	}
	allowedIP, err := parsePyjamasAllowedIP(values["peer.allowedips"])
	if err != nil {
		return pyjamasConfig{}, err
	}
	host, port, err := parsePyjamasEndpoint(values["peer.endpoint"])
	if err != nil {
		return pyjamasConfig{}, err
	}
	public, err := parsePyjamasPublicURL(values["interface.postup"])
	if err != nil {
		return pyjamasConfig{}, err
	}
	keepalive := 21
	if raw := values["peer.persistentkeepalive"]; raw != "" {
		parsed, convErr := strconv.Atoi(raw)
		if convErr != nil || parsed < 0 || parsed > 600 {
			return pyjamasConfig{}, errors.New("pyjam.as persistent keepalive is invalid")
		}
		keepalive = parsed
	}
	return pyjamasConfig{address: address, privateKey: privateKey, peerPublicKey: peerPublicKey, allowedIP: allowedIP, endpointHost: host, endpointPort: port, keepalive: keepalive, public: public}, nil
}

func parsePyjamasAddress(raw string) (netip.Addr, error) {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
	if err != nil || !prefix.Addr().Is4() || prefix.Bits() != 32 {
		return netip.Addr{}, errors.New("must be a single IPv4 /32")
	}
	if !pyjamasNetwork.Contains(prefix.Addr()) {
		return netip.Addr{}, fmt.Errorf("must belong to %s", pyjamasNetwork)
	}
	return prefix.Addr(), nil
}

// parsePyjamasAllowedIP keeps the peer scoped to the single server address the
// service documents. A wider prefix would make the userspace stack treat the
// remote peer as a route for unrelated destinations.
func parsePyjamasAllowedIP(raw string) (netip.Prefix, error) {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
	if err != nil || !prefix.Addr().Is4() || prefix.Bits() != 32 {
		return netip.Prefix{}, errors.New("pyjam.as allowed IPs must be a single IPv4 /32")
	}
	if !pyjamasNetwork.Contains(prefix.Addr()) {
		return netip.Prefix{}, fmt.Errorf("pyjam.as allowed IPs must belong to %s", pyjamasNetwork)
	}
	return prefix, nil
}

func parsePyjamasEndpoint(raw string) (string, int, error) {
	host, port, err := net.SplitHostPort(strings.TrimSpace(raw))
	if err != nil {
		return "", 0, errors.New("pyjam.as endpoint must be host:port")
	}
	if !strings.EqualFold(host, pyjamasHost) {
		return "", 0, fmt.Errorf("pyjam.as endpoint host must be %s", pyjamasHost)
	}
	parsedPort, err := strconv.Atoi(port)
	if err != nil || parsedPort < 1 || parsedPort > 65535 {
		return "", 0, errors.New("pyjam.as endpoint port is invalid")
	}
	return pyjamasHost, parsedPort, nil
}

// parsePyjamasPublicURL reads the slug out of the PostUp banner as inert text.
func parsePyjamasPublicURL(raw string) (*url.URL, error) {
	match := pyjamasPublicURLPattern.FindString(raw)
	if match == "" {
		return nil, errors.New("pyjam.as response did not announce a public HTTPS origin")
	}
	parsed, err := url.Parse(strings.TrimSuffix(match, "/"))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return nil, errors.New("pyjam.as public origin is invalid")
	}
	return parsed, nil
}

func decodePyjamasKey(raw string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil || len(decoded) != 32 {
		return "", errors.New("must be 32 base64-encoded bytes")
	}
	return hex.EncodeToString(decoded), nil
}
