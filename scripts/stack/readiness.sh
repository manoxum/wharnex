#!/usr/bin/env sh

# An unchanged image does not prove unchanged process lifecycle configuration.
# The caller supplies only container/image identities; service_ready is the
# stack's existing health boundary, not another health implementation.
application_runtime_ready() {
  [ "$#" -eq 7 ] || return 1
  [ "$2" = "$3" ] && [ "$4" = "$5" ] && [ "$6" = "$7" ] || return 1
  [ -n "$1" ] || return 1
  app_process_contract=$(docker inspect -f '{{.HostConfig.Init}} {{.Config.StopTimeout}}' "$1" 2>/dev/null) || return 1
  [ "$app_process_contract" = 'true 30' ] || return 1
  service_ready backend 1 && service_ready frontend 1 && service_ready webapp 1 && service_ready gateway 1
}
