#!/usr/bin/env python3
"""Bounded live resource sampling; never reads argv, environment or page data."""
import argparse
import json
import os
from pathlib import Path
import time


def process_stat(raw):
    left = raw.index("(")
    right = raw.rindex(")")
    fields = raw[right + 2:].split()
    return {
        "pid": int(raw[:left].strip()), "name": raw[left + 1:right],
        "state": fields[0], "ppid": int(fields[1]), "ticks": int(fields[11]) + int(fields[12]),
        "started": int(fields[19]), "threads": int(fields[17]),
        "rss_bytes": int(fields[21]) * os.sysconf("SC_PAGE_SIZE"),
    }


def processes():
    result = {}
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        try:
            value = process_stat((path / "stat").read_text())
            result[value["pid"]] = value
        except (OSError, ValueError, IndexError):
            pass  # Process exited, or belongs to a protected namespace.
    return result


def resources(previous, current, elapsed, ticks_per_second):
    rows = []
    for pid, value in current.items():
        old = previous.get(pid)
        ticks = max(0, value["ticks"] - old["ticks"]) if old and old["started"] == value["started"] else 0
        rows.append({
            "pid": pid, "ppid": value["ppid"], "name": value["name"], "state": value["state"],
            "cpu_percent": round(ticks / ticks_per_second / elapsed * 100, 2),
            "rss_mib": round(value["rss_bytes"] / (1 << 20), 2),
            "threads": value["threads"],
        })
    return sorted(rows, key=lambda row: (row["cpu_percent"], row["rss_mib"]), reverse=True)


def memory():
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
            values[key] = int(value.split()[0])
    return {"available_mib": round(values["MemAvailable"] / 1024, 1),
            "swap_used_mib": round((values["SwapTotal"] - values["SwapFree"]) / 1024, 1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=15, choices=range(1, 61), metavar="1..60")
    parser.add_argument("--interval", type=float, default=1)
    args = parser.parse_args()
    if not 0.25 <= args.interval <= args.seconds:
        parser.error("interval must be between 0.25 and the sample duration")
    previous, started = processes(), time.monotonic()
    last = started
    ticks = os.sysconf("SC_CLK_TCK")
    while last - started < args.seconds:
        time.sleep(min(args.interval, args.seconds - (last - started)))
        current, now = processes(), time.monotonic()
        print(json.dumps({"elapsed_seconds": round(now - started, 2),
                          "memory": memory(),
                          "processes": resources(previous, current, now - last, ticks)}, ensure_ascii=True), flush=True)
        previous, last = current, now


if __name__ == "__main__":
    main()
