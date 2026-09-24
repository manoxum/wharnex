# Plano de implementação — up-whx-link

Plano de trabalho (não é documento normativo). A decisão normativa fica no ADR
criado na tarefa 8. Quem retomar este trabalho — pessoa ou o próprio Wharnex —
deve seguir a secção **TODO** pela ordem, marcar `[x]` ao concluir cada item e
acrescentar em **Registo** o que foi observado.

## Problema

As instâncias do ChatGPT incorporadas no Wharnex Desktop (`WebContentsView` do
Electron) falham em rajada com `net::ERR_NETWORK_CHANGED`.

Causa: no Linux o serviço de rede do Chromium escuta os eventos netlink de
**todas** as interfaces do namespace de rede em que corre. Qualquer
criação/remoção/alteração de endereço — `veth`/`br-*` de um container Docker que
reinicia, troca de placa de rede/Wi-Fi/VPN, rotação de endereços IPv6
temporários — é interpretada como "a rede mudou": o Chromium fecha todos os
sockets abertos e os pedidos em curso falham com `ERR_NETWORK_CHANGED`. Todas as
vistas do ChatGPT partilham o serviço de rede do processo Electron do Desktop,
por isso a unidade a isolar é **esse processo**.

## Solução: up-whx-link

O processo Electron do Desktop passa a correr num namespace de rede próprio,
ligado ao host pelo `pasta` (passt, rede em espaço de utilizador, sem root).
Dentro dele existem apenas `lo` e uma interface configurada uma única vez no
arranque; o tráfego sai por sockets normais do processo `pasta` no host.
Alterações de interfaces do host deixam de gerar eventos dentro do namespace.

Cadeia de lançamento (implementada em `services/desktop/up-whx-link.mjs`,
`UP_LINK_OUTER_SCRIPT` + `UP_LINK_ENTER_SCRIPT`; substitui o `spawn` direto do
Electron em `dev.mjs`):

```
sh -c OUTER                                  # no host, no grupo de processos do coordenador
  unshare --user --map-root-user --net --mount --propagation slave -- sh -c INNER &   # sem --pid
  espera até /proc/<ns>/ns/net diferir do host (senão exit 96)
  pasta --config-net --foreground --quiet -T <portas> --dns-forward 169.254.1.1 <ns>
  wait <ns>; termina o pasta; devolve o código de saída do Electron
INNER (root do namespace):
  espera pela rota por omissão (senão exit 95) e pelo fim de endereços IPv6 `tentative`
  mount --bind <resolv.conf do up-link> "$(readlink -f /etc/resolv.conf)"
  exec unshare --user --map-user=<uid> --map-group=<gid> -- <electron> <args>
```

| Elemento | Porquê |
|---|---|
| namespaces criados por `unshare`, `pasta` ligado ao PID | `pasta -- cmd` cria também um namespace de PIDs onde o Electron seria PID 1: SIGTERM sem handler ignorado, órfãos por colher e lock de instância única com PID que o host não resolve. Sem namespace de PIDs tudo fica no grupo de processos do coordenador e o `make stop`/`orphan-recovery.sh` continuam a funcionar |
| `pasta --foreground` | a omissão do `pasta` é ir para segundo plano consoante haja TTY; lançado pelo coordenador (stdio sem TTY) ia para segundo plano e deixava órfãos |
| `-T <portas>` | o Desktop só fala com o host por `127.0.0.1:<gateway>` (`WHARNESS_API_URL`/`WHARNESS_FRONTEND_URL`); o loopback do namespace é encaminhado para o do host |
| `--dns-forward 169.254.1.1` + `resolv.conf` próprio | o host usa `systemd-resolved` em `127.0.0.53`, que no namespace é o loopback isolado; o `pasta` encaminha as consultas feitas a `169.254.1.1` para o resolver do host |
| mount namespace `--propagation slave` | o `resolv.conf` é sobreposto só dentro do namespace; montagens novas do host continuam a aparecer |
| espera por rota + IPv6 `tentative` | a configuração do `pasta` e o fim da deteção de duplicados do link-local são eventos netlink; se ocorrerem depois de o Chromium arrancar, o primeiro carregamento falha com `ERR_NETWORK_CHANGED` |
| `unshare --user --map-user/--map-group` | o root do namespace mapeia para o utilizador real, mas o Chromium recusa correr como uid 0 com sandbox; o mapeamento aninhado devolve o uid/gid reais |
| `WHARNESS_LINUX_SANDBOX_MODE=userns` | o helper SUID não funciona dentro de um namespace de utilizador; o sandbox passa a usar namespaces (já suportado por `electron-launch.mjs`, que acrescenta `--disable-setuid-sandbox`) |

Modos (`WHARNESS_UP_LINK`, definível em `.harness/env`):

- `auto` (omissão): usa o up-link quando `pasta` e `unshare` existem e o
  preflight passa; caso contrário arranca como hoje e regista o motivo.
- `required`: se o up-link não puder ser criado o arranque falha.
- `off`: comportamento atual.

Fora de âmbito (possível evolução): saída por WireGuard (ADR-0069) para também
sobreviver à troca real de uplink; isolar só as vistas do ChatGPT num processo
separado.

## Validação já feita (spike, 2026-09-24, este host)

- `pasta` fica em primeiro plano e termina quando o comando termina.
- Dentro: `uid=0`; com `unshare --user --map-user=1000 --map-group=1000` volta a
  `uid=1000`, ficheiros do `$HOME` com o dono correto.
- Namespace de utilizador aninhado (necessário ao sandbox do Chromium) permitido
  mesmo com `kernel.apparmor_restrict_unprivileged_userns=1`.
- `-T 6969`: `http://127.0.0.1:6969/api/health` → 200 dentro do namespace.
- DNS: `-U 53` não resolve; `--dns-forward 127.0.0.53` é recusado;
  `--dns-forward 169.254.1.1` + `resolv.conf` sobreposto → `https://chatgpt.com/`
  responde (403 do Cloudflare ao curl = chegou). `resolv.conf` do host intacto.
- Sessão: Wayland (`wayland-0`) e D-Bus (`unix:path=/run/user/1000/bus`) são
  sockets de ficheiro, portanto acessíveis dentro do namespace.

## TODO

- [x] 1. Spike de rede: `pasta` em primeiro plano, remapeamento de uid, userns aninhado, encaminhamento do gateway, DNS.
- [x] 2. Spike Electron: arrancar o Electron do projeto dentro do up-link com perfil descartável e sandbox `userns`, carregar `https://chatgpt.com/`, e provocar uma alteração de interface no host (`docker network create/rm`) confirmando que não ocorre `ERR_NETWORK_CHANGED`; comparar com o mesmo teste fora do up-link.
- [x] 3. Criar `services/desktop/up-whx-link.mjs` (≤ 200 linhas): leitura do modo, deteção de `pasta`/`unshare`, preflight, portas a encaminhar a partir das URLs, escrita do `resolv.conf` em `WHARNESS_RUNTIME_DIR`, construção dos argumentos (argumentos posicionais para o `sh -c`, sem interpolação), forçar `WHARNESS_LINUX_SANDBOX_MODE=userns`.
- [x] 4. Testes `services/desktop/up-whx-link.test.mjs`: modos, fallback, portas, argumentos, sandbox forçado.
- [x] 5. Ligar em `dev.mjs` com alterações mínimas (ficheiro > 200 linhas — extract-on-touch): decidir o up-link antes de resolver o binário/argumentos e lançar através dele; escrever `up-whx-link.state` em `WHARNESS_RUNTIME_DIR`.
- [x] 6. Ciclo de vida: confirmar que `make stop`/`make restart` terminam o Electron dentro do up-link (sinal ao grupo de processos do `pasta`), que o `electron.pid` reflete um processo vivo enquanto o Electron vive, e que não ficam órfãos.
- [x] 7. Confirmar o relançamento pós-auto-evolução (`desktop-relaunch.sh` → `start.sh` → `dev.mjs`) e o handoff de primeiro plano do `start.sh` (segunda instância fora do namespace comunica com a primária pelo socket de instância única).
- [x] 8. Documentação: ADR-0072 (decisão, modos, limites, segurança do sandbox `userns`), `WHARNESS_UP_LINK` no README, e mostrar o estado do up-link em `make status`.
- [x] 9. `make build` + testes do desktop; verificar o `make file-size-check` nos ficheiros novos.
- [ ] 10. Validação real: reiniciar o Desktop com o up-link, reiniciar um container durante uma resposta do ChatGPT e confirmar ausência de `ERR_NETWORK_CHANGED` no `desktop.log`.

## Registo

- 2026-09-24 — Tarefa 1 concluída (ver "Validação já feita").
- 2026-09-24 — Tarefa 2: Electron dentro do up-link arranca com `uid=1000` e sandbox ativo e carrega o ChatGPT. Criar/destruir redes Docker **não** gerou `ERR_NETWORK_CHANGED` nem fora do up-link (esta versão do Electron ignora essas bridges), por isso o gatilho real deste host está a ser identificado com `ip -ts monitor` cruzado com o `desktop.log`. Descoberta: logo após criar o namespace, o endereço IPv6 link-local termina a deteção de duplicados (~1,4 s) e isso fazia falhar o primeiro carregamento com `ERR_NETWORK_CHANGED`; o script de entrada espera até não haver endereços `tentative` (máx. 3 s).
- 2026-09-24 — Tarefas 3 e 4: `services/desktop/up-whx-link.mjs` + `up-whx-link.test.mjs` (6 testes ok). Preflight real neste host: ativo, ~2 s.
- Nota para testes manuais: `ELECTRON_RUN_AS_NODE` herdado (ex.: terminal do VS Code) faz o Electron comportar-se como Node; o `start.sh` já o remove.
- 2026-09-24 — Captura de 4 min (`ip -ts monitor` × `desktop.log`): zero eventos e zero erros nesse intervalo — o problema é intermitente. Indício: o último `ERR_NETWORK_CHANGED` do Desktop real (pedido `req_20260924T112244`) coincide com os testes que criavam/destruíam redes Docker às 11:22, pelo que a agitação do Docker afeta o Desktop real mesmo não tendo sido apanhada pelo teste com `net.fetch`.
- 2026-09-24 — Tarefas 5 e 6: `dev.mjs` lança pelo up-link (`startUpLink`/`upLinkTarget`, +3 linhas). Redesenho: `pasta -- cmd` punha o comando num namespace de PIDs (PID 1 ignorou SIGTERM e ficou órfão) e ia para segundo plano sem TTY; a cadeia passou a `unshare` sem `--pid` + `pasta --foreground <PID>`. Verificado: mesmo pidns do host, netns isolado, um único grupo de processos, SIGTERM ao grupo termina wrapper, Electron e `pasta`; `uid=1000`, cwd preservado, gateway 200, DNS ok; Electron real (`/opt/wharness/electron/44.1.1`) com sandbox `userns` carrega o ChatGPT; preflight ~1,4 s. 8 testes unitários ok.
- 2026-09-24 — Tarefa 7: app mínima com `requestSingleInstanceLock` dentro do up-link + segunda instância fora com o mesmo perfil → a primária recebe `second-instance` e a segunda sai; o lock regista o PID real do host. O relançamento pós-auto-evolução passa pelo mesmo `start.sh` → `dev.mjs`.
- 2026-09-24 — Tarefa 8: `adr/ADR-0072-up-whx-link-network-isolation.md`, secção no `README.md`, nota no `SECURITY.md` (sandbox muda de mecanismo, nunca é desligado) e linha `up-whx-link` no `make status` (lê `.harness/run/up-whx-link.state`).
- 2026-09-24 — Tarefa 9: 509/509 testes do desktop, `make file-size-check` sem violações nos ficheiros novos, `make build` completo.
- Tarefa 10 pendente: exige reiniciar o Desktop real (`make restart`), o que interrompe pedidos do ChatGPT em curso. Passos: 1) `make restart`; 2) `make status` deve mostrar `up-whx-link active`; `grep up-whx-link .harness/logs/desktop.log`; 3) com uma resposta do ChatGPT em curso, `docker network create whx-probe && docker run --rm --network whx-probe alpine true && docker network rm whx-probe` (ou reiniciar um container); 4) `grep -c NETWORK_CHANGED .harness/logs/desktop.log` não deve aumentar. Se algo falhar: `WHARNESS_UP_LINK=off` em `.harness/env` + `make restart` repõe o comportamento anterior.
