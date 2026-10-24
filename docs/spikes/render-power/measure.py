#!/usr/bin/env python3
"""Render + power spike harness for auracode (docs/spikes/render-power.md). macOS, no root.

For each scenario: launch the app with the scenario's environment, settle, then sample for the
window with `top` (CPU %, energy impact) and ./sampler (IOReport SoC power, GPU utilization,
per-process GPU time, per-process CPU time and energy), read the stress view's per-second frame
log out of WebKit's localStorage file, and stop the app. WebKit's WebContent, GPU and Networking
processes are XPC services whose parent is launchd, so they are attributed by diffing the set of
com.apple.WebKit.* pids before and after launch, cross-checked with the responsible pid.

Usage (from the repository root, after building the app and, for debug, starting Vite):
  measure.py --build debug|release --out DIR [--settle S] [--window S] SCENARIO...
Needs ./sampler and ./winctl next to this script (see the build commands in the spike doc).
"""

import argparse
import ctypes
import glob
import json
import os
import shutil
import signal
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("AURACODE_REPO", os.getcwd())
BINARIES = {
    "debug": f"{REPO}/target/debug/auracode",
    "release": f"{REPO}/target/release/bundle/macos/auracode.app/Contents/MacOS/auracode",
}
WEBKIT_DATA = {
    "debug": os.path.expanduser("~/Library/WebKit/auracode"),
    "release": os.path.expanduser("~/Library/WebKit/si.auracode.desktop"),
}
FRAME_LOG_KEY = "auracode.stress.frames"
SCRUBBED_ENV = ("CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_EFFORT", "CODEX_", "NODE_OPTIONS")

STRESS = "AURACODE_STRESS"
NO_GLASS = "AURACODE_NO_GLASS"
SCENARIOS = {
    # name: (environment, hide the app after settling)
    "baseline": (None, False),
    "idle": ({}, False),
    "idle-noglass": ({NO_GLASS: "1"}, False),
    "s1": ({STRESS: "orbs=1,rate=200,aura=0,seconds=0"}, False),
    "s1-aura": ({STRESS: "orbs=1,rate=200,aura=1,seconds=0"}, False),
    "s8": ({STRESS: "orbs=8,rate=200,aura=1,seconds=0"}, False),
    "s16": ({STRESS: "orbs=16,rate=200,aura=1,seconds=0"}, False),
    "s24": ({STRESS: "orbs=24,rate=200,aura=1,seconds=0"}, False),
    "s24-noaura": ({STRESS: "orbs=24,rate=200,aura=0,seconds=0"}, False),
    "s24-hidden": ({STRESS: "orbs=24,rate=200,aura=1,seconds=0"}, True),
    "s24-noglass": ({STRESS: "orbs=24,rate=200,aura=1,seconds=0", NO_GLASS: "1"}, False),
}

# Top-level IOReport "Energy Model" channels (the per-core ones are parts of "CPU Energy").
SOC_PARTS = ("CPU Energy", "GPU", "GPU SRAM", "ANE", "ISP", "AVE", "MSR", "AMCC", "DCS", "DRAM",
             "DISP", "DISPEXT", "VDEC", "SOC_AON", "SOC_REST")

_libc = ctypes.CDLL(None)
_responsible = getattr(_libc, "responsibility_get_pid_responsible_for_pid", None)
if _responsible is not None:
    _responsible.restype = ctypes.c_int
    _responsible.argtypes = [ctypes.c_int]


def log(message):
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def responsible_pid(pid):
    return _responsible(pid) if _responsible is not None else -1


def processes():
    """{pid: (ppid, executable path)} for every process."""
    out = subprocess.run(["ps", "-Ao", "pid=,ppid=,comm="], capture_output=True, text=True).stdout
    table = {}
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            table[int(parts[0])] = (int(parts[1]), parts[2])
    return table


def webkit_pids():
    return {pid: os.path.basename(path) for pid, (_, path) in processes().items()
            if os.path.basename(path).startswith("com.apple.WebKit.")}


def pid_named(name):
    for pid, (_, path) in processes().items():
        if os.path.basename(path) == name:
            return pid
    return None


def screen_locked():
    out = subprocess.run([f"{HERE}/winctl", "locked"], capture_output=True, text=True).stdout
    return out.strip() == "1"


def window_info(pid):
    out = subprocess.run([f"{HERE}/winctl", "info", str(pid)], capture_output=True,
                         text=True).stdout
    return [line for line in out.splitlines() if line.strip()]


def group_of(name):
    if name == "auracode":
        return "app"
    if name.endswith("WebContent"):
        return "webcontent"
    if name.endswith(".GPU"):
        return "webkit_gpu"
    if name.endswith("Networking"):
        return "webkit_net"
    if name == "WindowServer":
        return "windowserver"
    return "other"


def parse_top(text, pids):
    """Per-pid mean %CPU and POWER over the samples (the first, invalid sample dropped), plus
    the machine-wide idle % per sample."""
    samples = text.split("Processes:")[1:]
    per_pid = {pid: {"cpu": [], "power": []} for pid in pids}
    idle = []
    for sample in samples[1:]:
        in_table = False
        for line in sample.splitlines():
            if line.startswith("CPU usage:"):
                # CPU usage: 12.3% user, 4.5% sys, 83.2% idle
                try:
                    idle.append(float(line.rsplit(",", 1)[1].strip().split("%")[0]))
                except (IndexError, ValueError):
                    pass
            if line.startswith("PID"):
                in_table = True
                continue
            if in_table and line.strip():
                parts = line.split()
                try:
                    pid = int(parts[0])
                    cpu, power = float(parts[-3]), float(parts[-2])
                except (IndexError, ValueError):
                    continue
                # top occasionally prints a wrapped counter (e.g. -16016648) for one sample.
                if pid in per_pid and 0 <= cpu <= 1000 and 0 <= power <= 1000:
                    per_pid[pid]["cpu"].append(cpu)
                    per_pid[pid]["power"].append(power)
    means = {pid: {k: (statistics.fmean(v) if v else None) for k, v in d.items()}
             for pid, d in per_pid.items()}
    return means, idle


def sum_sampler(lines, pids):
    """Totals over the sampler's interval lines: SoC mW (mean), GPU utilization (mean), and per
    pid CPU ms, energy mJ, wakeups, GPU ms (sums) plus the covered seconds."""
    rows = [json.loads(line) for line in lines if line.startswith("{")]
    seconds = sum(row["dt"] for row in rows)
    soc = {}
    if rows and rows[0].get("soc"):
        for key in rows[0]["soc"]:
            values = [row["soc"].get(key, 0.0) * row["dt"] for row in rows if row.get("soc")]
            soc[key] = sum(values) / seconds if seconds else None
    util = [row["gpu_util"]["device"] for row in rows if row.get("gpu_util")]
    procs = {}
    for pid in pids:
        totals = {"gpu_ms": 0.0, "cpu_ms": 0.0, "energy_mj": 0.0, "idle_wakeups": 0,
                  "intr_wakeups": 0, "rusage": True}
        for row in rows:
            entry = row["procs"].get(str(pid), {})
            totals["gpu_ms"] += entry.get("gpu_ms", 0.0)
            if "cpu_ms" in entry:
                for key in ("cpu_ms", "energy_mj", "idle_wakeups", "intr_wakeups"):
                    totals[key] += entry[key]
            else:
                totals["rusage"] = False
        procs[pid] = totals
    return {"seconds": seconds, "soc": soc, "gpu_util": util, "procs": procs}


def read_frame_log(build):
    """The stress view's FrameLog from WebKit's localStorage databases (copied first, so WebKit's
    own files are never opened by us)."""
    best = None
    for path in glob.glob(f"{WEBKIT_DATA[build]}/WebsiteData/Default/*/*/LocalStorage/"
                          "localstorage.sqlite3"):
        with tempfile.TemporaryDirectory() as scratch:
            copy = os.path.join(scratch, "ls.sqlite3")
            for suffix in ("", "-wal", "-shm"):
                if os.path.exists(path + suffix):
                    shutil.copy2(path + suffix, copy + suffix)
            try:
                connection = sqlite3.connect(copy)
                row = connection.execute("SELECT value FROM ItemTable WHERE key = ?",
                                         (FRAME_LOG_KEY,)).fetchone()
                connection.close()
            except sqlite3.Error as error:
                log(f"could not read {path}: {error}")
                continue
        if not row:
            continue
        value = row[0]
        text = value.decode("utf-16-le") if isinstance(value, bytes) else value
        try:
            samples = json.loads(text)
        except ValueError:
            continue
        if samples and (best is None or samples[-1]["t"] > best[-1]["t"]):
            best = samples
    return best or []


def frame_stats(samples, start_ms, end_ms):
    inside = [s for s in samples if start_ms < s["t"] <= end_ms + 500]
    if len(inside) < 2:
        return {"samples": len(inside), "fps_avg": None, "fps_min_1s": None,
                "hidden_samples": sum(1 for s in inside if s["hidden"])}
    # The first sample's frames belong to the second before it; rates use consecutive samples.
    rates = []
    for previous, current in zip(inside, inside[1:]):
        span = (current["t"] - previous["t"]) / 1000
        if span > 0:
            rates.append(current["frames"] / span)
    frames = sum(s["frames"] for s in inside[1:])
    span = (inside[-1]["t"] - inside[0]["t"]) / 1000
    return {
        "samples": len(inside),
        "fps_avg": frames / span if span > 0 else None,
        "fps_min_1s": min(rates) if rates else None,
        "fps_p10_1s": sorted(rates)[len(rates) // 10] if rates else None,
        "hidden_samples": sum(1 for s in inside if s["hidden"]),
    }


def child_env(extra):
    env = {k: v for k, v in os.environ.items()
           if not any(k == p or (p.endswith("_") and k.startswith(p)) for p in SCRUBBED_ENV)}
    env.update(extra)
    return env


def stop(process, label, timeout=6.0):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout)
    except subprocess.TimeoutExpired:
        log(f"{label} ignored SIGTERM; killing")
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(5)


def run_scenario(name, build, out_dir, settle, window, data_dir):
    env_extra, hide = SCENARIOS[name]
    stem = f"{build}-{name}"
    if os.path.exists(os.path.join(out_dir, f"{stem}.json")):
        # A repeated scenario (baselines before and after) keeps every run.
        stem = f"{stem}@{time.strftime('%H%M%S')}"
    result = {"scenario": name, "build": build, "locked_at_start": screen_locked(),
              "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    windowserver = pid_named("WindowServer")
    app = None
    cover = None
    groups = {}
    try:
        if env_extra is not None:
            if pid_named("auracode") is not None:
                raise RuntimeError("an auracode process is already running; quit it first")
            before = webkit_pids()
            env = child_env({**env_extra, "AURACODE_DATA_DIR": data_dir, "RUST_LOG": "warn"})
            log_path = os.path.join(out_dir, f"{stem}.app.log")
            with open(log_path, "w") as app_log:
                app = subprocess.Popen([BINARIES[build]], env=env, stdout=app_log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            launched = time.time()
            # Wait for the window record (it exists even while the screen is locked).
            while time.time() - launched < 60 and not window_info(app.pid):
                if app.poll() is not None:
                    raise RuntimeError(f"the app exited early with {app.returncode}")
                time.sleep(0.25)
            result["window_after_s"] = round(time.time() - launched, 2)
            time.sleep(settle)
            if hide:
                hidden = subprocess.run([f"{HERE}/winctl", "hide", str(app.pid)],
                                        capture_output=True, text=True).stdout.strip()
                result["hide"] = hidden
                if hidden != "ok" and not screen_locked():
                    # Hiding was refused: occlude the window instead (same WebKit path).
                    cover = subprocess.Popen([f"{HERE}/winctl", "cover", str(window + 8)],
                                             stdout=subprocess.DEVNULL, start_new_session=True)
                    result["hide"] = f"{hidden}; covered"
                time.sleep(3)
            new = {pid: n for pid, n in webkit_pids().items() if pid not in before}
            # Launched from a shell, the app inherits the terminal as its responsible process and
            # its XPC services may report either; both mean "started on behalf of this launch".
            owners = {app.pid, responsible_pid(app.pid)}
            result["responsible"] = {str(pid): responsible_pid(pid) for pid in new}
            result["app_responsible"] = responsible_pid(app.pid)
            mine = {pid: n for pid, n in new.items() if responsible_pid(pid) in owners}
            result["webkit_new"] = {str(pid): n for pid, n in new.items()}
            result["webkit_mine"] = {str(pid): n for pid, n in mine.items()}
            result["webkit_unconfirmed"] = sorted(set(new) - set(mine))
            groups["app"] = [app.pid]
            for pid, n in mine.items():
                groups.setdefault(group_of(n), []).append(pid)
            result["window"] = window_info(app.pid)
        if windowserver:
            groups["windowserver"] = [windowserver]
        pids = [pid for members in groups.values() for pid in members]

        top_cmd = ["top", "-l", str(window + 1), "-s", "1", "-stats", "pid,command,cpu,power,idlew"]
        for pid in pids:
            top_cmd += ["-pid", str(pid)]
        start_ms = time.time() * 1000
        top = subprocess.Popen(top_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               text=True)
        sampler = subprocess.Popen([f"{HERE}/sampler", "1000", str(window)] + [str(p) for p in pids],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        sampler_out, sampler_err = sampler.communicate(timeout=window + 30)
        top_out, _ = top.communicate(timeout=window + 30)
        end_ms = time.time() * 1000
        if sampler_err.strip():
            result["sampler_stderr"] = sampler_err.strip()
        with open(os.path.join(out_dir, f"{stem}.sampler.jsonl"), "w") as raw:
            raw.write(sampler_out)
        with open(os.path.join(out_dir, f"{stem}.top.txt"), "w") as raw:
            raw.write(top_out)

        top_means, idle = parse_top(top_out, pids)
        sampled = sum_sampler(sampler_out.splitlines(), pids)
        seconds = sampled["seconds"] or window
        result["seconds"] = round(seconds, 2)
        result["locked_at_end"] = screen_locked()
        result["machine_idle_pct"] = round(statistics.fmean(idle), 1) if idle else None
        result["gpu_device_util_pct"] = (round(statistics.fmean(sampled["gpu_util"]), 1)
                                         if sampled["gpu_util"] else None)
        soc = sampled["soc"]
        result["soc_mw"] = {
            "cpu": soc.get("CPU Energy"), "gpu": (soc.get("GPU") or 0) + (soc.get("GPU SRAM") or 0),
            "dram": soc.get("DRAM"), "disp": soc.get("DISP"),
            "total": sum(soc.get(k) or 0 for k in SOC_PARTS) if soc else None,
        }
        result["groups"] = {}
        for group, members in groups.items():
            agg = {"pids": members, "top_cpu_pct": 0.0, "top_power": 0.0, "cpu_pct": 0.0,
                   "cpu_mw": 0.0, "gpu_ms_per_s": 0.0, "idle_wakeups_per_s": 0.0,
                   "rusage": True}
            for pid in members:
                tm = top_means.get(pid, {})
                agg["top_cpu_pct"] += tm.get("cpu") or 0.0
                agg["top_power"] += tm.get("power") or 0.0
                pm = sampled["procs"][pid]
                agg["gpu_ms_per_s"] += pm["gpu_ms"] / seconds
                if pm["rusage"]:
                    agg["cpu_pct"] += pm["cpu_ms"] / seconds / 10
                    agg["cpu_mw"] += pm["energy_mj"] / seconds
                    agg["idle_wakeups_per_s"] += pm["idle_wakeups"] / seconds
                else:
                    agg["rusage"] = False
            result["groups"][group] = {k: (round(v, 2) if isinstance(v, float) else v)
                                       for k, v in agg.items()}
        if env_extra is not None and STRESS in env_extra:
            time.sleep(2.5)  # let WebKit write the last localStorage update
            result["frames"] = frame_stats(read_frame_log(build), start_ms, end_ms)
    finally:
        stop(cover, "cover")
        if app is not None:
            stop(app, "auracode")
            mine_pids = [int(p) for p in result.get("webkit_mine", {})]
            deadline = time.time() + 10
            while time.time() < deadline and any(p in processes() for p in mine_pids):
                time.sleep(0.5)
            result["webkit_lingering"] = [p for p in mine_pids if p in processes()]
    with open(os.path.join(out_dir, f"{stem}.json"), "w") as raw:
        json.dump(result, raw, indent=2)
    return result


def summary_line(r):
    g = r.get("groups", {})
    def grp(name, key):
        value = g.get(name, {}).get(key)
        return "-" if value is None else f"{value:.1f}"
    frames = r.get("frames") or {}
    fps = frames.get("fps_avg")
    fps_min = frames.get("fps_min_1s")
    soc = r.get("soc_mw", {})
    return (f"{r['build']:7} {r['scenario']:12} locked={int(r['locked_at_start'])}"
            f" idle={r.get('machine_idle_pct')}%"
            f" app cpu={grp('app', 'cpu_pct')}% wc cpu={grp('webcontent', 'cpu_pct')}%"
            f" gpuP cpu={grp('webkit_gpu', 'cpu_pct')}% ws cpu={grp('windowserver', 'top_cpu_pct')}%"
            f" | gpu ms/s: wkgpu={grp('webkit_gpu', 'gpu_ms_per_s')} ws={grp('windowserver', 'gpu_ms_per_s')}"
            f" util={r.get('gpu_device_util_pct')}%"
            f" | soc mW cpu={soc.get('cpu') or 0:.0f} gpu={soc.get('gpu') or 0:.0f} total={soc.get('total') or 0:.0f}"
            f" | fps={'-' if fps is None else f'{fps:.1f}'} min1s={'-' if fps_min is None else f'{fps_min:.0f}'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", choices=BINARIES, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--settle", type=float, default=10)
    parser.add_argument("--window", type=int, default=30)
    parser.add_argument("--cooldown", type=float, default=5)
    parser.add_argument("scenarios", nargs="+", choices=SCENARIOS)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    data_dir = os.path.join(args.out, "data")
    os.makedirs(data_dir, exist_ok=True)
    if not os.path.exists(BINARIES[args.build]):
        sys.exit(f"missing {BINARIES[args.build]}")
    results = []
    for name in args.scenarios:
        log(f"{args.build} {name}: start")
        try:
            result = run_scenario(name, args.build, args.out, args.settle, args.window, data_dir)
        except Exception as error:  # keep going: one failed scenario should not lose the rest
            log(f"{args.build} {name}: FAILED: {error}")
            continue
        results.append(result)
        log(summary_line(result))
        time.sleep(args.cooldown)
    with open(os.path.join(args.out, f"{args.build}-summary.txt"), "a") as summary:
        for result in results:
            summary.write(summary_line(result) + "\n")


if __name__ == "__main__":
    main()
