package remoteinput

import (
	"bytes"
	"encoding/base64"
	"html/template"
	"net/url"
	"sort"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

// TunnelLanding is deliberately public discovery metadata. It is never a
// credential, grant, channel URL, or request identifier.
type TunnelLanding struct {
	InstanceName    string
	Origins         []string
	RemoteAppOrigin string
}

type tunnelLandingView struct {
	InstanceName string
	Origins      []string
	QRCode       template.URL
}

func (landing TunnelLanding) HTML() string {
	name := strings.TrimSpace(landing.InstanceName)
	if name == "" {
		name = "Wharnex"
	}
	origins := uniqueOrigins(landing.Origins)
	view := tunnelLandingView{InstanceName: name, Origins: origins}
	if len(origins) > 0 {
		if image, err := qrcode.Encode(pairingDiscoveryURL(name, origins[0]), qrcode.Medium, 240); err == nil {
			view.QRCode = template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(image))
		}
	}
	var output bytes.Buffer
	if err := tunnelLandingTemplate.Execute(&output, view); err != nil {
		return "<!doctype html><title>Wharnex</title>"
	}
	// The document is a raw Go string so its HTML quotes need no escaping.
	// Normalise the legacy escaped form before it reaches a browser.
	return strings.ReplaceAll(output.String(), `\"`, `"`)
}

func uniqueOrigins(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	origins := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
			continue
		}
		if _, exists := seen[value]; !exists {
			seen[value] = struct{}{}
			origins = append(origins, value)
		}
	}
	sort.Strings(origins)
	return origins
}

func pairingDiscoveryURL(name, origin string) string {
	query := url.Values{}
	query.Set("v", "1")
	query.Set("name", name)
	query.Set("origin", origin)
	return "wharness://discover?" + query.Encode()
}

var tunnelLandingTemplate = template.Must(template.New("tunnel-landing").Parse(`<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>{{.InstanceName}} · Wharnex</title><style>
:root{--paper:#f6f5f0;--ink:#182321;--soft:#63716d;--rule:#d9ded9;--pine:#145b4a;--coral:#e97d5f}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--paper);color:var(--ink);font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif}body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 84% 12%,rgba(185,245,210,.72),transparent 22rem),radial-gradient(circle at 8% 88%,rgba(233,125,95,.13),transparent 27rem)}main{width:min(74rem,100%);min-height:100vh;margin:auto;padding:1.5rem clamp(1.5rem,5vw,5rem) 3rem;position:relative;display:flex;flex-direction:column}nav{display:flex;align-items:center;justify-content:space-between;padding:.8rem 0;border-bottom:1px solid var(--rule);font:700 .74rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}.brand{display:flex;gap:.65rem;align-items:center}.glyph{display:grid;place-items:center;width:1.8rem;height:1.8rem;border-radius:.45rem;background:var(--pine);color:white;font-family:Georgia,serif;font-size:1.1rem;letter-spacing:-.08em}.relay{color:var(--soft)}.hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(15rem,.75fr);gap:clamp(2rem,7vw,7rem);align-items:end;flex:1;padding:clamp(4rem,10vw,8rem) 0 3rem}.kicker{font:700 .74rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:var(--pine);text-transform:uppercase;margin:0 0 1.4rem}.instance{font:600 clamp(1rem,2vw,1.25rem)/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--soft);margin:0 0 .65rem}h1{font-size:clamp(3.35rem,8vw,7rem);letter-spacing:-.075em;line-height:.88;margin:0;max-width:8ch;font-weight:500}h1 span{color:var(--pine)}.intro{margin:2rem 0 0;max-width:34rem;color:var(--soft);font-size:clamp(1.1rem,2vw,1.35rem);line-height:1.55}.aside{border-left:1px solid var(--rule);padding:0 0 0 clamp(1.5rem,4vw,3rem);align-self:stretch;display:flex;flex-direction:column;justify-content:end}.aside p{font-size:1.08rem;line-height:1.5;margin:0 0 1.3rem}.origins{margin:0;display:grid;gap:.45rem}.origins dt{font:700 .68rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--soft)}.origins dd{margin:0;font:600 .76rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.pair{display:flex;align-items:center;gap:1rem;border-top:1px solid var(--rule);margin-top:1.4rem;padding-top:1.25rem}.pair img{width:4.25rem;height:4.25rem;image-rendering:pixelated;background:white;padding:.22rem}.pair strong,.pair small{display:block}.pair strong{font-size:.93rem}.pair small{color:var(--soft);font:500 .73rem/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:.2rem}.footer{display:flex;gap:1rem;align-items:center;justify-content:space-between;border-top:1px solid var(--rule);padding-top:1.15rem;font:600 .72rem/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase}.online{display:flex;gap:.55rem;align-items:center;color:var(--soft)}.online i{width:.5rem;height:.5rem;border-radius:50%;background:var(--pine);box-shadow:0 0 0 .25rem rgba(20,91,74,.1);animation:breathe 2s ease-in-out infinite}a{color:var(--pine);text-underline-offset:.3rem;text-decoration-thickness:1px}a:hover{color:var(--coral)}@keyframes breathe{50%{transform:scale(.72);opacity:.55}}@media(max-width:42rem){.hero{grid-template-columns:1fr;padding-top:4rem}.aside{border-left:0;border-top:1px solid var(--rule);padding:1.5rem 0 0}.footer{align-items:flex-start;flex-direction:column}}@media(prefers-reduced-motion:reduce){.online i{animation:none}}
</style></head><body><main><nav><div class="brand"><span class="glyph" aria-hidden="true">W</span><span>Wharnex</span></div><span class="relay">Relay seguro</span></nav><section class="hero" aria-labelledby="title"><div><p class="kicker">Instância Wharnex</p><p class="instance">{{.InstanceName}}</p><h1 id="title">Construa com IA. <span>Mantenha o comando.</span></h1><p class="intro">Wharnex prepara contexto de projeto, valida planos e transforma sugestões em alterações revisáveis — sem entregar o controlo do seu ambiente.</p></div><aside><p>Este relay transporta apenas recursos Wharnex validados. Projetos, conversas e credenciais permanecem privados.</p>{{if .Origins}}<dl class="origins"><dt>Origins configurados</dt>{{range .Origins}}<dd>{{.}}</dd>{{end}}</dl>{{end}}{{if .QRCode}}<div class="pair"><img src="{{.QRCode}}" alt="QR de descoberta de {{.InstanceName}}"><div><strong>Descoberta para emparelhamento</strong><small>Identifica esta instância; não autoriza acesso.</small></div></div>{{end}}</aside></section><footer><span class="online"><i aria-hidden="true"></i>Relay disponível</span><a href="/status">Ver estado da ligação</a></footer></main></body></html>`))
