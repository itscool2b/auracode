# Host process supervision

M1e has a Rust Linux endpoint and a fail-closed host boundary. WSL execution is still unavailable:
the Windows bridge, helper deployment, artifact qualification and host preparation are pending.
The presence of `wsl.exe`, a distribution or an installed agent does not enable launch.

`HostSpawner` receives an explicit `HostExecution`. Native execution passes the original spec to
the existing spawner. Other hosts return `SpawnError::HostUnavailable` before a subprocess starts.
The application must inject a qualified deployment after preparing the Linux cwd and identity
realm. A global host enum must not enable execution before those checks.

## Linux endpoint

`aura-host-supervisor --stdio <absolute-state-directory>` serves one connection. `--version`
reports the package and protocol versions without resolving an environment or starting an agent.
The endpoint uses the existing environment resolver, targeted scrub, redactor, log factory,
process spawner, descendant tracking and leftover registry. The Linux environment remains local.
Provider configuration and credential contents are not inspected. Logs live under the explicit
state directory, with the same redaction rules as native launches.

Frames consist of a one-byte tag, a four-byte big-endian payload length, then that many bytes.
Control payloads are JSON and capped at 1 MiB. Agent stdin/stdout payloads are separate raw UTF-8
frames, capped at the existing 64 MiB line limit, so JSON escaping cannot multiply their allocation.
The output queue also has count and byte budgets. Malformed headers fail before payload allocation.

| Parent request | Behavior |
| --- | --- |
| Launch | Exactly one explicit Linux program, argv, cwd, daemon rules and output cap; no shell interpolation or automatic retry. |
| Stdin | One agent protocol line; newline-bearing frames are rejected. |
| CloseStdin | Ends only agent stdin, while ownership and the lease remain active. |
| Heartbeat | Renews the 15-second parent lease. |
| Stop | Stops accepting commands and shuts down the owned tree. Queued prompts are discarded. |
| Inspect | Before launch only: resolves catalog executable names, cwd and known provider configuration roots from metadata. It exports no generic environment map and executes no discovered program. |

Ready identifies the owned Linux pid. Stdout and oversized-line keys retain their protocol meaning.
Ended contains the direct exit, any unconfirmed leftovers, declared daemons spared, and a redacted
stderr tail. Endpoint signals, parent EOF, lease expiration, malformed control and broken output
all use the existing shutdown chain. A blocked output consumer cannot prevent lease cleanup.
Buffered output drains for the existing bounded EOF grace. A timed-out output does not promise
complete transcript delivery. Unconfirmed process cleanup leaves recovery records for a later
instance rather than claiming success or forgetting the process identities.

Inspection preserves Linux path case and resolves symlink aliases without reading config files.
The bridge must translate Windows drive paths using the actual distribution's `wslpath`, since
custom automount settings can change the mount root. Do not assume `/mnt/c` or normalize Linux
configuration roots with Windows case folding.

## Windows daemon boundary

Windows does not support removing a process from a job after assignment. Explicit breakaway
requires both a compatible enclosing job and a child created with `CREATE_BREAKAWAY_FROM_JOB`.
Silent breakaway releases all children and therefore loses the current kernel guarantee that
ordinary tool descendants die with their owner. See Microsoft's
[Job Objects contract](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

This checkpoint does not enable either breakaway mode or change vendor processes. Safe Windows
daemon support still needs qualified vendor behavior, tracked escaped pid/start identities and
crash recovery. An existing daemon outside auracode's job remains outside its kill authority.

## Verification

| Check | Result |
| --- | --- |
| Host gate fake-spawner regressions | pass, included in the 176-test process unit run |
| Supervisor framing/lifecycle/inspection validation | pass, 11 focused tests on Windows |
| Process all-target Clippy and rustfmt | pass |
| Existing process unit and helper integration checks | pass, 176 unit and 9 helper tests before the final inspection/signal additions |
| Remaining local process integration binaries | pending, Windows Application Control blocked execution |
| Linux real owned-child supervision and recovery tests | pending CI |
| WSL bridge, packaged helper deployment and distribution qualification | pending |
| Windows cooperative daemon breakaway and recovery | pending |

Only auracode's fake/test children were used. No real vendor agent, paid prompt, credential/config
read, security-policy change or blocked-binary workaround was performed.
