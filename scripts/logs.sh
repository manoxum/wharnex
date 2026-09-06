#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
DESKTOP_LOG=${WHARNESS_DESKTOP_LOG:-"$ROOT/.harness/logs/desktop.log"}
SELF_LOG=${WHARNESS_SELF_LOG:-"$ROOT/.harness/logs/self-evolution.log"}
STACK_SCRIPT=${WHARNESS_STACK_SCRIPT:-"$ROOT/scripts/stack.sh"}
SOURCE=${WHARNESS_LOG_SOURCE:-all}
FILTER=${WHARNESS_LOG_FILTER:-}
TAIL_LINES=${WHARNESS_LOG_TAIL:-120}
FOLLOW=${WHARNESS_LOG_FOLLOW:-0}

usage() {
  cat <<'EOF'
Usage: scripts/logs.sh [options]

  -s, --source SOURCE   all, frontend, electron, chatgpt or self (default: all)
  -g, --filter TEXT     case-insensitive fixed-text filter
  -n, --tail LINES      number of recent lines (default: 120)
  -f, --follow          continue streaming new log lines
      --list            list the available sources
  -h, --help            show this help

Through Make: make logs SOURCE=chatgpt FILTER=error FOLLOW=1 TAIL=200
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -s|--source) [ "$#" -ge 2 ] || { echo "$1 requires a value" >&2; exit 2; }; SOURCE=$2; shift 2 ;;
    -g|--filter) [ "$#" -ge 2 ] || { echo "$1 requires a value" >&2; exit 2; }; FILTER=$2; shift 2 ;;
    -n|--tail) [ "$#" -ge 2 ] || { echo "$1 requires a value" >&2; exit 2; }; TAIL_LINES=$2; shift 2 ;;
    -f|--follow) FOLLOW=1; shift ;;
    --list) printf '%s\n' all frontend electron chatgpt self; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown logs option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$SOURCE" in all|frontend|electron|chatgpt|self) ;; *) echo "Unknown log source: $SOURCE" >&2; exit 2 ;; esac
case "$TAIL_LINES" in ''|*[!0-9]*) echo 'Log tail must be a non-negative integer.' >&2; exit 2 ;; esac
case "$FOLLOW" in 1|true|yes) FOLLOW=1 ;; 0|false|no|'') FOLLOW=0 ;; *) echo 'FOLLOW must be 1/0, true/false or yes/no.' >&2; exit 2 ;; esac

format_stream() {
  mode=$1
  awk -v mode="$mode" -v filter="$FILTER" '
    BEGIN { needle = tolower(filter) }
    {
      chatgpt = index(tolower($0), "[chatgpt-") == 1
      if (mode == "electron" && chatgpt) next
      if (mode == "chatgpt" && !chatgpt) next
      if (needle != "" && index(tolower($0), needle) == 0) next
      label = mode == "split" ? (chatgpt ? "chatgpt" : "electron") : mode
      print "[" label "] " $0
      fflush()
    }
  '
}

file_stream() {
  mode=$1
  file=$2
  if [ ! -f "$file" ]; then
    printf '[%s] log unavailable: %s\n' "$mode" "$file" >&2
    return 0
  fi
  if [ "$FOLLOW" -eq 1 ]; then tail -n "$TAIL_LINES" -F "$file" | format_stream "$mode"
  else tail -n "$TAIL_LINES" "$file" | format_stream "$mode"
  fi
}

frontend_stream() {
  if [ "$FOLLOW" -eq 1 ]; then "$STACK_SCRIPT" logs --no-color --tail "$TAIL_LINES" --follow frontend | format_stream frontend
  else "$STACK_SCRIPT" logs --no-color --tail "$TAIL_LINES" frontend | format_stream frontend
  fi
}

if [ "$FOLLOW" -eq 0 ]; then
  case "$SOURCE" in
    all) frontend_stream; file_stream split "$DESKTOP_LOG"; file_stream self "$SELF_LOG" ;;
    frontend) frontend_stream ;;
    electron) file_stream electron "$DESKTOP_LOG" ;;
    chatgpt) file_stream chatgpt "$DESKTOP_LOG" ;;
    self) file_stream self "$SELF_LOG" ;;
  esac
  exit 0
fi

pids=''
stop_streams() {
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
}
trap stop_streams INT TERM EXIT
start_stream() { "$@" & pids="$pids $!"; }
case "$SOURCE" in
  all) start_stream frontend_stream; start_stream file_stream split "$DESKTOP_LOG"; start_stream file_stream self "$SELF_LOG" ;;
  frontend) start_stream frontend_stream ;;
  electron) start_stream file_stream electron "$DESKTOP_LOG" ;;
  chatgpt) start_stream file_stream chatgpt "$DESKTOP_LOG" ;;
  self) start_stream file_stream self "$SELF_LOG" ;;
esac
wait
