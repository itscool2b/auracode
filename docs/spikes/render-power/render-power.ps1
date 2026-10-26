#Requires -Version 5.1
<#
.SYNOPSIS
Measures auracode's render and power cost on Windows (WebView2): the Windows half of the M0 render
and power spike, docs/spikes/render-power.md.

.DESCRIPTION
Runs the named scenarios in order, or the whole suite when none are named (about 12 minutes). Each
scenario starts auracode with the scenario's environment, waits for its window, settles, and then
measures for -Seconds:

  * CPU time of every process in auracode's tree (the app plus WebView2's browser, renderer, GPU
    and utility processes) and of dwm.exe, which composites the window and draws Mica;
  * the 3D GPU engine utilization of the same processes;
  * battery state at both ends of the window, when the machine has a battery;
  * for stress scenarios, the stress view's per-second frame log, read after the window through
    WebView2's DevTools port.

Then it closes auracode, waits for its WebView2 processes to exit, writes one JSON file per run,
prints a summary line and moves on. A scenario that fails is recorded and the suite continues.

Before running: quit auracode, close other apps, leave the window area uncovered, and leave the
machine alone until the suite ends. Run test-render-power.ps1 first; it takes seconds.

.PARAMETER Scenario
Scenario names in run order: baseline, idle, idle-noglass, idle-minimized, s1, s1-aura, s8, s16,
s24, s24-noaura, s24-noglass, s24-minimized. Names may repeat (the default suite starts and ends
with baseline).

.PARAMETER Exe
The auracode.exe to start. By default the per-user install made by the Build workflow's installer
(%LOCALAPPDATA%\auracode\auracode.exe), then a per-machine install, then auracode.exe next to this
script.

.PARAMETER Out
Folder for the results. By default render-power-results\<date-time> under the current folder.

.PARAMETER DebugPort
Loopback port WebView2 opens for DevTools during stress scenarios, used only after each window to
read the frame log.

.PARAMETER GpuCounter
The per-process 3D engine counter. On a non-English Windows the counter set has a local name; find
it with Get-Counter -ListSet * and pass the local path here.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\render-power.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\render-power.ps1 baseline s24 s24-minimized baseline -Exe D:\builds\auracode.exe
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Scenario = @(),
    [string]$Exe = '',
    [string]$Out = '',
    [ValidateRange(0, 600)]
    [int]$Settle = 10,
    [ValidateRange(2, 3600)]
    [int]$Seconds = 30,
    [ValidateRange(0, 600)]
    [int]$Cooldown = 5,
    [ValidateRange(1024, 65535)]
    [int]$DebugPort = 9333,
    [string]$GpuCounter = '\GPU Engine(*engtype_3D)\Utilization Percentage'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# The stress view writes its per-second frame counts here (apps/desktop/src/components/StressView.tsx).
$script:FrameLogKey = 'auracode.stress.frames'
$script:DefaultSuite = @(
    'baseline', 'idle', 'idle-noglass', 'idle-minimized', 's1', 's1-aura', 's8', 's16', 's24',
    's24-noaura', 's24-noglass', 's24-minimized', 'baseline'
)
# Every variable a launch sets or clears. All of them are saved before a run and restored after it,
# so nothing leaks into the shell, and every run starts from the same environment.
$script:LaunchVariables = @(
    'AURACODE_STRESS', 'AURACODE_NO_GLASS', 'AURACODE_DATA_DIR', 'AURACODE_SMOKE',
    'AURACODE_SMOKE_EXIT', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'
)
$script:RenderPowerExitCode = 1

function Get-Prop {
    # A property or dictionary entry, or $null when it is absent: strict mode throws on a missing
    # property, and counter samples, CIM instances and DevTools replies do not always carry them all.
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function New-Scenario {
    param([string]$Name, [bool]$Launch, [string]$Stress, [bool]$NoGlass, [bool]$Minimize)
    [pscustomobject]@{ Name = $Name; Launch = $Launch; Stress = $Stress; NoGlass = $NoGlass; Minimize = $Minimize }
}

function Get-ScenarioTable {
    # The same stress settings as the macOS harness (measure.py), so the two halves compare.
    $orbs1 = 'orbs=1,rate=200,aura=0,seconds=0'
    $orbs1Aura = 'orbs=1,rate=200,aura=1,seconds=0'
    $orbs8 = 'orbs=8,rate=200,aura=1,seconds=0'
    $orbs16 = 'orbs=16,rate=200,aura=1,seconds=0'
    $orbs24 = 'orbs=24,rate=200,aura=1,seconds=0'
    $orbs24NoAura = 'orbs=24,rate=200,aura=0,seconds=0'
    $all = @(
        (New-Scenario 'baseline' $false '' $false $false),
        (New-Scenario 'idle' $true '' $false $false),
        (New-Scenario 'idle-noglass' $true '' $true $false),
        (New-Scenario 'idle-minimized' $true '' $false $true),
        (New-Scenario 's1' $true $orbs1 $false $false),
        (New-Scenario 's1-aura' $true $orbs1Aura $false $false),
        (New-Scenario 's8' $true $orbs8 $false $false),
        (New-Scenario 's16' $true $orbs16 $false $false),
        (New-Scenario 's24' $true $orbs24 $false $false),
        (New-Scenario 's24-noaura' $true $orbs24NoAura $false $false),
        (New-Scenario 's24-noglass' $true $orbs24 $true $false),
        (New-Scenario 's24-minimized' $true $orbs24 $false $true)
    )
    $table = [ordered]@{}
    foreach ($entry in $all) { $table[$entry.Name] = $entry }
    $table
}

function Resolve-ScenarioList {
    # The scenarios to run, in order. Blank names are dropped, an empty list means the default
    # suite, and an unknown name stops everything before anything starts.
    param([string[]]$Names, [System.Collections.IDictionary]$Table)
    $requested = @($Names | Where-Object { $null -ne $_ -and $_.Trim() -ne '' } | ForEach-Object { $_.Trim().ToLowerInvariant() })
    if ($requested.Count -eq 0) { $requested = $script:DefaultSuite }
    $unknown = @($requested | Where-Object { -not $Table.Contains($_) })
    if ($unknown.Count -gt 0) {
        throw ('Unknown scenario: {0}. Known scenarios: {1}.' -f ($unknown -join ', '), (@($Table.Keys) -join ', '))
    }
    foreach ($name in $requested) { $Table[$name] }
}

function Get-DefaultExeCandidates {
    # Where the Build workflow's installer puts auracode (per user, the configured install mode),
    # a per-machine install, and a bare exe (a `tauri build --no-bundle` artifact) next to this script.
    $list = New-Object System.Collections.Generic.List[string]
    if ($env:LOCALAPPDATA) { $list.Add((Join-Path $env:LOCALAPPDATA 'auracode\auracode.exe')) }
    if ($env:ProgramFiles) { $list.Add((Join-Path $env:ProgramFiles 'auracode\auracode.exe')) }
    if ($PSScriptRoot) { $list.Add((Join-Path $PSScriptRoot 'auracode.exe')) }
    $list.ToArray()
}

function Resolve-AuracodeExe {
    param([string]$Requested, [string[]]$Candidates)
    if ($Requested) {
        if (-not (Test-Path -LiteralPath $Requested -PathType Leaf)) { throw "-Exe $Requested does not exist." }
        return (Resolve-Path -LiteralPath $Requested).ProviderPath
    }
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }
    throw ('No auracode.exe found (looked in: {0}). Install the Build workflow''s Windows installer, or pass -Exe.' -f ($Candidates -join '; '))
}

function Test-DownloadedFromInternet {
    # True when the file still carries the Mark of the Web (an NTFS Zone.Identifier stream).
    # SmartScreen then holds its first launch behind a dialog and the run would time out.
    param([string]$Path)
    try {
        $stream = Get-Item -LiteralPath $Path -Stream 'Zone.Identifier' -ErrorAction Stop
        return $null -ne $stream
    } catch {
        return $false
    }
}

function Assert-PortFree {
    param([int]$Port)
    $listener = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Loopback), $Port
    try {
        $listener.Start()
    } catch {
        throw ('Port {0} is in use; pass a free one with -DebugPort.' -f $Port)
    } finally {
        try { $listener.Stop() } catch { Write-Verbose 'the port probe was not listening' }
    }
}

function Get-ProcessTree {
    # The root and every descendant from Win32_Process-shaped objects (ProcessId, ParentProcessId,
    # CreationDate), breadth first. A process older than its supposed parent is not its child:
    # Windows reuses process ids, and an orphan keeps its dead parent's id as ParentProcessId.
    param([object[]]$Processes, [int]$RootId)
    $children = @{}
    $root = $null
    foreach ($process in $Processes) {
        if ($null -eq $process) { continue }
        $id = [int](Get-Prop $process 'ProcessId')
        $parentId = [int](Get-Prop $process 'ParentProcessId')
        if ($id -eq $RootId) { $root = $process }
        # The System Idle Process is its own parent.
        if ($id -eq $parentId) { continue }
        if (-not $children.ContainsKey($parentId)) { $children[$parentId] = New-Object System.Collections.ArrayList }
        [void]$children[$parentId].Add($process)
    }
    if ($null -eq $root) { return }
    $seen = @{ $RootId = $true }
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($root)
    while ($queue.Count -gt 0) {
        $node = $queue.Dequeue()
        $node
        $nodeId = [int](Get-Prop $node 'ProcessId')
        if (-not $children.ContainsKey($nodeId)) { continue }
        $nodeCreated = Get-Prop $node 'CreationDate'
        foreach ($child in $children[$nodeId]) {
            $childId = [int](Get-Prop $child 'ProcessId')
            if ($seen.ContainsKey($childId)) { continue }
            $childCreated = Get-Prop $child 'CreationDate'
            if ($null -ne $nodeCreated -and $null -ne $childCreated -and ([datetime]$childCreated) -lt ([datetime]$nodeCreated)) { continue }
            $seen[$childId] = $true
            $queue.Enqueue($child)
        }
    }
}

function Merge-Processes {
    # One entry per process id; the first one seen wins.
    param([object[]]$Processes)
    $seen = @{}
    foreach ($process in $Processes) {
        if ($null -eq $process) { continue }
        $id = [int](Get-Prop $process 'ProcessId')
        if ($seen.ContainsKey($id)) { continue }
        $seen[$id] = $true
        $process
    }
}

function Get-ProcessRole {
    # Which part of the stack a process is: the app, one of WebView2's processes (told apart by
    # their --type switch; the browser process has none), dwm.exe, or anything else.
    param([string]$Name, [string]$CommandLine)
    $role = 'other'
    if ($Name -ieq 'auracode.exe') {
        $role = 'app'
    } elseif ($Name -ieq 'dwm.exe') {
        $role = 'dwm'
    } elseif ($Name -ieq 'msedgewebview2.exe') {
        $role = 'webview_browser'
        if ($CommandLine -match '--type=([A-Za-z-]+)') {
            $type = $Matches[1].ToLowerInvariant()
            if ($type -eq 'renderer') {
                $role = 'webview_renderer'
            } elseif ($type -eq 'gpu-process') {
                $role = 'webview_gpu'
            } else {
                $role = 'webview_utility'
            }
        }
    }
    $role
}

function Test-SameCreation {
    # Whether two creation times belong to the same process. Unknown counts as the same.
    param($A, $B)
    if ($null -eq $A -or $null -eq $B) { return $true }
    return ([datetime]$A) -eq ([datetime]$B)
}

function Get-CpuSnapshot {
    # Kernel plus user CPU time (in 100 ns units) per process id, with the creation time that tells
    # a recycled id apart. Win32_Process carries both for every process, dwm.exe included, without
    # opening a process handle; Get-Process cannot read another user's process times unelevated.
    param([object[]]$Processes)
    $snapshot = @{}
    foreach ($process in $Processes) {
        if ($null -eq $process) { continue }
        $kernel = Get-Prop $process 'KernelModeTime'
        $user = Get-Prop $process 'UserModeTime'
        if ($null -eq $kernel -or $null -eq $user) { continue }
        $created = Get-Prop $process 'CreationDate'
        $snapshot[[int](Get-Prop $process 'ProcessId')] = [pscustomobject]@{ Ticks = [double]$kernel + [double]$user; Created = $created }
    }
    $snapshot
}

function Measure-CpuPercent {
    # Percent of one core over the window per process id: CPU time used / wall time. A process born
    # during the window counts from zero. One that exited before the end, or whose id now belongs to
    # a different, older process, has no end value and is listed in Missing instead.
    param([hashtable]$Start, [hashtable]$End, [int[]]$Ids, [double]$Seconds, [datetime]$WindowStart)
    $percent = @{}
    $missing = New-Object System.Collections.ArrayList
    foreach ($id in $Ids) {
        if (-not $End.ContainsKey($id)) {
            [void]$missing.Add($id)
            continue
        }
        $endEntry = $End[$id]
        $startTicks = $null
        if ($Start.ContainsKey($id) -and (Test-SameCreation $Start[$id].Created $endEntry.Created)) {
            $startTicks = $Start[$id].Ticks
        } elseif ($null -ne $endEntry.Created -and ([datetime]$endEntry.Created) -ge $WindowStart) {
            $startTicks = 0.0
        }
        if ($null -eq $startTicks) {
            [void]$missing.Add($id)
            continue
        }
        $percent[$id] = [math]::Round(($endEntry.Ticks - $startTicks) / ($Seconds * 1e7) * 100, 2)
    }
    [pscustomobject]@{ Percent = $percent; Missing = @($missing) }
}

function Get-InstancePid {
    # The process id in a GPU Engine counter instance name (pid_1234_luid_..._engtype_3D).
    param([string]$InstanceName)
    if ($InstanceName -match '^pid_(\d+)_') { return [int]$Matches[1] }
    return $null
}

function Measure-GpuPercent {
    # Average 3D engine utilization per process id over the counter samples. Within one sample a
    # process's engines are summed (a process can hold 3D engines on several adapters). Samples
    # whose status is not valid data (PDH status 0 or 1) are skipped.
    param([object[]]$SampleSets, [int[]]$Ids)
    $totals = @{}
    foreach ($id in $Ids) { $totals[$id] = 0.0 }
    $count = 0
    foreach ($set in $SampleSets) {
        if ($null -eq $set) { continue }
        $count++
        foreach ($sample in @(Get-Prop $set 'CounterSamples')) {
            if ($null -eq $sample) { continue }
            $id = Get-InstancePid ([string](Get-Prop $sample 'InstanceName'))
            if ($null -eq $id -or -not $totals.ContainsKey($id)) { continue }
            $status = Get-Prop $sample 'Status'
            if ($null -ne $status -and [int64]$status -ne 0 -and [int64]$status -ne 1) { continue }
            $totals[$id] += [double](Get-Prop $sample 'CookedValue')
        }
    }
    $percent = @{}
    foreach ($id in $Ids) {
        if ($count -gt 0) { $percent[$id] = [math]::Round($totals[$id] / $count, 2) } else { $percent[$id] = $null }
    }
    [pscustomobject]@{ Percent = $percent; Samples = $count }
}

function Get-RoleTotals {
    # Per role: how many processes, and the sum of their CPU and GPU numbers. cpu_missing counts
    # processes without a CPU number, so a partial sum is never mistaken for a whole one.
    param([object[]]$Rows)
    $totals = [ordered]@{}
    foreach ($row in $Rows) {
        if ($null -eq $row) { continue }
        $role = [string](Get-Prop $row 'role')
        if (-not $totals.Contains($role)) {
            $totals[$role] = [ordered]@{ processes = 0; cpu_pct = 0.0; gpu_3d_pct = 0.0; cpu_missing = 0 }
        }
        $entry = $totals[$role]
        $entry['processes'] = $entry['processes'] + 1
        $cpu = Get-Prop $row 'cpu_pct'
        if ($null -ne $cpu) {
            $entry['cpu_pct'] = [math]::Round($entry['cpu_pct'] + [double]$cpu, 2)
        } else {
            $entry['cpu_missing'] = $entry['cpu_missing'] + 1
        }
        $gpu = Get-Prop $row 'gpu_3d_pct'
        if ($null -ne $gpu) { $entry['gpu_3d_pct'] = [math]::Round($entry['gpu_3d_pct'] + [double]$gpu, 2) }
    }
    $totals
}

function Get-ScenarioEnvironment {
    # The variables auracode starts with for $Scenario. Every launch variable gets a value, $null
    # meaning unset, so nothing leaks in from the shell or from the previous run.
    param($Scenario, [string]$DataDir, [int]$DebugPort)
    $values = [ordered]@{}
    foreach ($name in $script:LaunchVariables) { $values[$name] = $null }
    # A scratch profile, so the runs never touch the user's own auracode data.
    $values['AURACODE_DATA_DIR'] = $DataDir
    if ($Scenario.Stress) {
        $values['AURACODE_STRESS'] = $Scenario.Stress
        # Lets the script read the frame log after the window. WebView2 appends this to the
        # arguments the app sets itself, and nothing attaches to the port while the window runs.
        $values['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--remote-debugging-port=$DebugPort"
    }
    if ($Scenario.NoGlass) { $values['AURACODE_NO_GLASS'] = '1' }
    $values
}

function Save-LaunchEnvironment {
    $saved = @{}
    foreach ($name in $script:LaunchVariables) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $saved
}

function Set-ProcessVariable {
    # Sets one variable of this process; $null removes it. SetEnvironmentVariable cannot remove: a
    # $null argument reaches its string parameter as '' (PowerShell's conversion), which Windows
    # PowerShell 5.1's .NET Framework treats as a removal but PowerShell 7's .NET stores as an
    # empty value. Removing through the Env: drive works the same in both.
    param([string]$Name, $Value)
    if ($null -ne $Value) {
        [Environment]::SetEnvironmentVariable($Name, [string]$Value, 'Process')
    } elseif (Test-Path -LiteralPath "Env:$Name") {
        Remove-Item -LiteralPath "Env:$Name"
    }
}

function Set-LaunchEnvironment {
    # $null removes a variable. Start-Process passes this process's environment to auracode.
    param([System.Collections.IDictionary]$Values)
    foreach ($name in @($Values.Keys)) { Set-ProcessVariable -Name ([string]$name) -Value $Values[$name] }
}

function Restore-LaunchEnvironment {
    param([hashtable]$Saved)
    foreach ($name in @($Saved.Keys)) { Set-ProcessVariable -Name ([string]$name) -Value $Saved[$name] }
}

function ConvertFrom-FrameLogJson {
    # The stress view's FrameLog JSON (an array of { t, frames, hidden }) as one object per sample.
    # Windows PowerShell 5.1 returns a JSON array as a single object and PowerShell 7 enumerates
    # it; piping the parsed value through Where-Object gives the same samples in both.
    param([string]$Json)
    if ([string]::IsNullOrWhiteSpace($Json)) { return }
    $parsed = ConvertFrom-Json -InputObject $Json
    foreach ($sample in @($parsed | Where-Object { $null -ne $_ })) {
        $t = Get-Prop $sample 't'
        $frames = Get-Prop $sample 'frames'
        if ($null -eq $t -or $null -eq $frames) { throw 'The frame log is not a list of { t, frames, hidden } samples.' }
        [pscustomobject]@{ t = [double]$t; frames = [double]$frames; hidden = [bool](Get-Prop $sample 'hidden') }
    }
}

function Get-FrameStats {
    # Frame rate over one measurement window, computed as measure.py does on macOS: samples inside
    # (start, end + 500 ms]; each sample's frames belong to the second before it, so rates come from
    # consecutive samples and the first sample only opens the window.
    param([object[]]$Samples, [double]$StartMs, [double]$EndMs)
    $inside = @($Samples | Where-Object { $null -ne $_ -and $_.t -gt $StartMs -and $_.t -le ($EndMs + 500) } | Sort-Object -Property t)
    $hidden = @($inside | Where-Object { $_.hidden }).Count
    $stats = [ordered]@{ samples = $inside.Count; fps_avg = $null; fps_min_1s = $null; fps_p10_1s = $null; hidden_samples = $hidden }
    if ($inside.Count -lt 2) { return $stats }
    $rates = New-Object System.Collections.Generic.List[double]
    $frames = 0.0
    for ($i = 1; $i -lt $inside.Count; $i++) {
        $span = ($inside[$i].t - $inside[$i - 1].t) / 1000.0
        $frames += $inside[$i].frames
        if ($span -gt 0) { $rates.Add($inside[$i].frames / $span) }
    }
    $total = ($inside[$inside.Count - 1].t - $inside[0].t) / 1000.0
    if ($total -gt 0) { $stats['fps_avg'] = [math]::Round($frames / $total, 2) }
    if ($rates.Count -gt 0) {
        $sorted = @($rates | Sort-Object)
        $stats['fps_min_1s'] = [math]::Round($sorted[0], 2)
        $stats['fps_p10_1s'] = [math]::Round($sorted[[int][math]::Floor($sorted.Count / 10)], 2)
    }
    $stats
}

function Select-PageTarget {
    # auracode's page in a DevTools target list: a "page" whose URL contains $UrlPattern (Tauri
    # serves the app from http://tauri.localhost on Windows) and that still offers a socket.
    param([object[]]$Targets, [string]$UrlPattern)
    foreach ($target in $Targets) {
        if ($null -eq $target) { continue }
        $type = [string](Get-Prop $target 'type')
        $url = [string](Get-Prop $target 'url')
        $socket = [string](Get-Prop $target 'webSocketDebuggerUrl')
        if ($type -eq 'page' -and $url.Contains($UrlPattern) -and $socket) { return $target }
    }
    return $null
}

function Invoke-HttpGetText {
    # A plain GET that ignores any system proxy, which could otherwise capture loopback requests.
    param([string]$Uri, [int]$TimeoutSec)
    $request = [System.Net.WebRequest]::Create($Uri)
    $request.Proxy = $null
    $request.Timeout = $TimeoutSec * 1000
    $response = $request.GetResponse()
    try {
        $reader = New-Object System.IO.StreamReader -ArgumentList $response.GetResponseStream()
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally {
        $response.Close()
    }
}

function Invoke-CdpEvaluate {
    # Evaluates $Expression in the page with one DevTools Runtime.evaluate over a WebSocket and
    # returns its value. Events that arrive before the answer are skipped.
    param([string]$WebSocketUrl, [string]$Expression, [int]$TimeoutSec)
    $socket = New-Object System.Net.WebSockets.ClientWebSocket
    $socket.Options.Proxy = $null
    $cancel = New-Object System.Threading.CancellationTokenSource -ArgumentList ([TimeSpan]::FromSeconds($TimeoutSec))
    try {
        $socket.ConnectAsync([Uri]$WebSocketUrl, $cancel.Token).GetAwaiter().GetResult()
        $request = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $Expression; returnByValue = $true } } | ConvertTo-Json -Depth 4 -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($request)
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
        $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cancel.Token).GetAwaiter().GetResult()
        $buffer = New-Object byte[] 65536
        while ($true) {
            $message = New-Object System.IO.MemoryStream
            do {
                $chunk = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
                $received = $socket.ReceiveAsync($chunk, $cancel.Token).GetAwaiter().GetResult()
                if ($received.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                    throw 'The DevTools connection closed before answering.'
                }
                $message.Write($buffer, 0, $received.Count)
            } while (-not $received.EndOfMessage)
            $reply = ConvertFrom-Json -InputObject ([System.Text.Encoding]::UTF8.GetString($message.ToArray()))
            if ((Get-Prop $reply 'id') -ne 1) { continue }
            $failure = Get-Prop $reply 'error'
            if ($null -ne $failure) { throw ('DevTools refused the request: {0}' -f (Get-Prop $failure 'message')) }
            $outer = Get-Prop $reply 'result'
            $exception = Get-Prop $outer 'exceptionDetails'
            if ($null -ne $exception) { throw ('The page threw: {0}' -f (Get-Prop $exception 'text')) }
            return (Get-Prop (Get-Prop $outer 'result') 'value')
        }
    } finally {
        if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            try {
                $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, '', [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
            } catch {
                Write-Verbose ('closing the DevTools socket failed: {0}' -f $_.Exception.Message)
            }
        }
        $socket.Dispose()
        $cancel.Dispose()
    }
}

function Read-FrameLog {
    # The stress view's frame log, read from the running page over WebView2's DevTools port.
    param([int]$Port, [string]$UrlPattern = 'tauri.localhost', [int]$TimeoutSec = 10)
    $targets = ConvertFrom-Json -InputObject (Invoke-HttpGetText -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec $TimeoutSec)
    $page = Select-PageTarget -Targets @($targets | Where-Object { $null -ne $_ }) -UrlPattern $UrlPattern
    if ($null -eq $page) { throw "No DevTools page for $UrlPattern on port $Port." }
    $expression = "localStorage.getItem('$($script:FrameLogKey)')"
    $json = Invoke-CdpEvaluate -WebSocketUrl ([string](Get-Prop $page 'webSocketDebuggerUrl')) -Expression $expression -TimeoutSec $TimeoutSec
    if ($null -eq $json) { throw "The page has no $($script:FrameLogKey) entry (is it the stress view?)." }
    ConvertFrom-FrameLogJson -Json ([string]$json)
}

function Get-BatteryReading {
    # Battery state from the ACPI battery driver, or $null on a desktop or when it cannot be read.
    try {
        $status = @(Get-CimInstance -Namespace 'root\wmi' -ClassName 'BatteryStatus' -ErrorAction Stop)
    } catch {
        return $null
    }
    if ($status.Count -eq 0) { return $null }
    $first = $status[0]
    [ordered]@{
        on_ac = [bool](Get-Prop $first 'PowerOnline')
        discharging = [bool](Get-Prop $first 'Discharging')
        discharge_rate_mw = (Get-Prop $first 'DischargeRate')
        remaining_mwh = (Get-Prop $first 'RemainingCapacity')
    }
}

function Get-NativeWindowApi {
    # user32 calls for minimizing the window and checking its state. Added once per session, so a
    # second run of the script in the same shell reuses the type.
    $type = 'RenderPower.Native' -as [type]
    if ($null -eq $type) {
        Add-Type -Namespace RenderPower -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@
        $type = 'RenderPower.Native' -as [type]
    }
    $type
}

function Get-FocusWarning {
    # Windows draws Mica flat for an inactive window, so a visible run whose window lost the
    # foreground did not measure the glass. Minimized runs are not expected to be in front.
    param([bool]$Minimize, [bool]$AtStart, [bool]$AtEnd)
    if ($Minimize -or ($AtStart -and $AtEnd)) { return $null }
    return 'auracode''s window was not in front for the whole window (Mica is drawn flat while a window is inactive); rerun this scenario without touching the machine.'
}

function Wait-MainWindow {
    # auracode creates its window hidden and shows it after the page's first paint, so a visible
    # main window means the UI is up.
    param([System.Diagnostics.Process]$Process, [int]$TimeoutSec)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw ('auracode exited during startup with code {0}. If another auracode was running, it took this launch over.' -f $Process.ExitCode)
        }
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero) { return $Process.MainWindowHandle }
        Start-Sleep -Milliseconds 250
    }
    throw ('auracode showed no window within {0} s. A SmartScreen or error dialog may be waiting.' -f $TimeoutSec)
}

function Get-LiveTreeMembers {
    # The recorded processes that still run as themselves (same id and same creation time).
    param([object[]]$Tree)
    if ($null -eq $Tree -or $Tree.Count -eq 0) { return }
    $now = @{}
    foreach ($process in @(Get-CimInstance -ClassName Win32_Process)) { $now[[int]$process.ProcessId] = $process }
    foreach ($member in $Tree) {
        $id = [int](Get-Prop $member 'ProcessId')
        if (-not $now.ContainsKey($id)) { continue }
        if (Test-SameCreation (Get-Prop $member 'CreationDate') (Get-Prop $now[$id] 'CreationDate')) { $now[$id] }
    }
}

function Stop-Auracode {
    # Closes the window as a user would (auracode quits when its last window closes), kills the app
    # if it has not exited after 10 s, then waits up to 15 s for the rest of its tree (WebView2's
    # processes) and kills what lingers, so the next run starts clean.
    param([System.Diagnostics.Process]$Process, [object[]]$Tree)
    $report = [ordered]@{ closed = $false; killed = $false; lingering_killed = @() }
    if ($null -eq $Process) { return $report }
    try {
        if (-not $Process.HasExited) {
            [void]$Process.CloseMainWindow()
            if ($Process.WaitForExit(10000)) {
                $report['closed'] = $true
            } else {
                Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
                $report['killed'] = $true
            }
        }
    } catch {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        $report['killed'] = $true
    }
    $deadline = (Get-Date).AddSeconds(15)
    $alive = @()
    do {
        $alive = @(Get-LiveTreeMembers -Tree $Tree)
        if ($alive.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    $killed = @()
    foreach ($member in $alive) {
        Stop-Process -Id ([int]$member.ProcessId) -Force -ErrorAction SilentlyContinue
        $killed += [int]$member.ProcessId
    }
    $report['lingering_killed'] = $killed
    $report
}

function Get-FileVersion {
    param([string]$Path)
    try {
        return (Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo.ProductVersion
    } catch {
        return $null
    }
}

function Get-MachineInfo {
    # What the results depend on: Windows build, GPUs and refresh rates, scaling, whether
    # transparency effects are on (Mica is drawn as a flat colour when they are off), the theme,
    # the power source, and whether this is a local console session (remote sessions compose
    # differently).
    $info = [ordered]@{
        collected = (Get-Date).ToString('o')
        powershell = $PSVersionTable.PSVersion.ToString()
        session = $env:SESSIONNAME
    }
    try {
        $nt = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $info['windows'] = [ordered]@{
            product = (Get-Prop $nt 'ProductName')
            display_version = (Get-Prop $nt 'DisplayVersion')
            build = (Get-Prop $nt 'CurrentBuild')
            ubr = (Get-Prop $nt 'UBR')
        }
    } catch {
        $info['windows_error'] = $_.Exception.Message
    }
    try {
        $info['gpus'] = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | ForEach-Object {
                [ordered]@{
                    name = $_.Name
                    driver = $_.DriverVersion
                    refresh_hz = $_.CurrentRefreshRate
                    width = $_.CurrentHorizontalResolution
                    height = $_.CurrentVerticalResolution
                }
            })
    } catch {
        $info['gpus_error'] = $_.Exception.Message
    }
    try {
        $metrics = Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop\WindowMetrics' -ErrorAction Stop
        $info['applied_dpi'] = Get-Prop $metrics 'AppliedDPI'
    } catch {
        $info['applied_dpi'] = $null
    }
    try {
        $personalize = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction Stop
        $info['transparency_effects'] = Get-Prop $personalize 'EnableTransparency'
        $info['apps_use_light_theme'] = Get-Prop $personalize 'AppsUseLightTheme'
        $info['system_uses_light_theme'] = Get-Prop $personalize 'SystemUsesLightTheme'
    } catch {
        $info['personalize_error'] = $_.Exception.Message
    }
    $info['battery'] = Get-BatteryReading
    $info
}

function Write-JsonFile {
    # UTF-8 without a byte order mark, which every JSON reader accepts. Every dictionary written
    # here has string keys: Windows PowerShell 5.1's ConvertTo-Json rejects any other kind.
    param([string]$Path, $Value)
    $json = ConvertTo-Json -InputObject $Value -Depth 8
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
}

function Format-Number {
    param($Value)
    if ($null -eq $Value) { return '-' }
    return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0:0.0}', [double]$Value)
}

function Format-SummaryLine {
    # One line per run: CPU (% of one core) and GPU 3D (%) per role, and the frame rate.
    param($Result)
    $roles = Get-Prop $Result 'roles'
    $parts = New-Object System.Collections.Generic.List[string]
    $parts.Add(('{0,-15}' -f (Get-Prop $Result 'scenario')))
    foreach ($role in @('app', 'webview_browser', 'webview_renderer', 'webview_gpu', 'webview_utility', 'dwm')) {
        $entry = Get-Prop $roles $role
        $parts.Add(('{0} cpu={1} gpu={2}' -f $role, (Format-Number (Get-Prop $entry 'cpu_pct')), (Format-Number (Get-Prop $entry 'gpu_3d_pct'))))
    }
    $frames = Get-Prop $Result 'frames'
    $parts.Add(('fps={0} min1s={1}' -f (Format-Number (Get-Prop $frames 'fps_avg')), (Format-Number (Get-Prop $frames 'fps_min_1s'))))
    $failure = Get-Prop $Result 'error'
    if ($failure) { $parts.Add(('ERROR: {0}' -f $failure)) }
    $parts -join ' | '
}

function Invoke-Scenario {
    param($Scenario, [int]$Index, [hashtable]$Settings)
    $result = [ordered]@{
        scenario = $Scenario.Name
        index = $Index
        started = (Get-Date).ToString('o')
        settle_s = 0
        window_s = $Settings.Seconds
        environment = $null
        warnings = @()
    }
    $saved = Save-LaunchEnvironment
    $app = $null
    $tree = @()
    try {
        if ($Scenario.Launch) {
            $running = @(Get-Process -Name 'auracode' -ErrorAction SilentlyContinue)
            if ($running.Count -gt 0) {
                throw ('auracode is already running (pid {0}); quit it first.' -f (($running | ForEach-Object { $_.Id }) -join ', '))
            }
            $environment = Get-ScenarioEnvironment -Scenario $Scenario -DataDir $Settings.DataDir -DebugPort $Settings.DebugPort
            $result['environment'] = $environment
            Set-LaunchEnvironment -Values $environment
            $launchClock = [System.Diagnostics.Stopwatch]::StartNew()
            $app = Start-Process -FilePath $Settings.Exe -WorkingDirectory (Split-Path -Parent $Settings.Exe) -PassThru
            # Touching the handle keeps ExitCode readable if the process exits early.
            $null = $app.Handle
            $hwnd = Wait-MainWindow -Process $app -TimeoutSec 60
            $result['window_after_s'] = [math]::Round($launchClock.Elapsed.TotalSeconds, 2)
            Start-Sleep -Seconds $Settings.Settle
            $result['settle_s'] = $Settings.Settle
            $api = Get-NativeWindowApi
            if ($Scenario.Minimize) {
                # SW_MINIMIZE, then time for WebView2 to react before the window starts.
                [void]$api::ShowWindow($hwnd, 6)
                Start-Sleep -Seconds 3
            }
            $result['window_minimized'] = [bool]$api::IsIconic($hwnd)
            $result['window_visible'] = [bool]$api::IsWindowVisible($hwnd)
            $result['window_in_front'] = ($api::GetForegroundWindow() -eq $hwnd)
            if ($Scenario.Minimize -ne $result['window_minimized']) {
                $result['warnings'] += ('The window is {0}minimized, which this scenario does not expect.' -f $(if ($result['window_minimized']) { '' } else { 'not ' }))
            }
            $tree = @(Get-ProcessTree -Processes @(Get-CimInstance -ClassName Win32_Process) -RootId $app.Id)
            $browser = @($tree | Where-Object { (Get-Prop $_ 'Name') -ieq 'msedgewebview2.exe' } | Select-Object -First 1)
            if ($browser.Count -gt 0) { $result['webview2_version'] = Get-FileVersion ([string](Get-Prop $browser[0] 'ExecutablePath')) }
        }

        $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
        $dwm = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'dwm.exe'" | Where-Object { [int]$_.SessionId -eq $sessionId })
        $windowStart = Get-Date
        $before = Get-CpuSnapshot -Processes @(Get-CimInstance -ClassName Win32_Process)
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        $startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $batteryStart = Get-BatteryReading
        $sampleSets = @()
        try {
            $sampleSets = @(Get-Counter -Counter $Settings.GpuCounter -SampleInterval 1 -MaxSamples $Settings.Seconds -ErrorAction SilentlyContinue)
        } catch {
            $result['gpu_error'] = $_.Exception.Message
        }
        # Keeps the window at its full length when the counter read returned early.
        $left = $Settings.Seconds - $clock.Elapsed.TotalSeconds
        if ($left -gt 0) { Start-Sleep -Milliseconds ([int]($left * 1000)) }
        $after = @(Get-CimInstance -ClassName Win32_Process)
        $elapsed = $clock.Elapsed.TotalSeconds
        $endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $batteryEnd = Get-BatteryReading
        $afterSnapshot = Get-CpuSnapshot -Processes $after

        # Processes WebView2 started during the window are part of the cost too, and of the cleanup.
        $treeAfter = @()
        if ($null -ne $app) { $treeAfter = @(Get-ProcessTree -Processes $after -RootId $app.Id) }
        $tree = @(Merge-Processes -Processes (@($tree) + @($treeAfter)))
        $members = @(Merge-Processes -Processes (@($tree) + @($dwm)))
        $ids = @($members | ForEach-Object { [int](Get-Prop $_ 'ProcessId') })
        $cpu = Measure-CpuPercent -Start $before -End $afterSnapshot -Ids $ids -Seconds $elapsed -WindowStart $windowStart
        $gpu = Measure-GpuPercent -SampleSets $sampleSets -Ids $ids
        if ($gpu.Samples -eq 0 -and -not $result.Contains('gpu_error')) {
            $result['gpu_error'] = ('No samples from {0}; see -GpuCounter.' -f $Settings.GpuCounter)
        }
        $rows = @(foreach ($member in $members) {
                $id = [int](Get-Prop $member 'ProcessId')
                $name = [string](Get-Prop $member 'Name')
                [ordered]@{
                    pid = $id
                    name = $name
                    role = (Get-ProcessRole -Name $name -CommandLine ([string](Get-Prop $member 'CommandLine')))
                    cpu_pct = $cpu.Percent[$id]
                    gpu_3d_pct = $gpu.Percent[$id]
                }
            })
        $result['seconds'] = [math]::Round($elapsed, 2)
        $result['processes'] = $rows
        $result['roles'] = Get-RoleTotals -Rows $rows
        $result['cpu_missing_pids'] = $cpu.Missing
        $result['gpu_samples'] = $gpu.Samples
        $result['battery'] = [ordered]@{ start = $batteryStart; end = $batteryEnd }
        if ($null -ne $app) {
            $app.Refresh()
            $result['app_exited_during_window'] = [bool]$app.HasExited
            $result['window_in_front_at_end'] = ($api::GetForegroundWindow() -eq $hwnd)
            $focus = Get-FocusWarning -Minimize $Scenario.Minimize -AtStart $result['window_in_front'] -AtEnd $result['window_in_front_at_end']
            if ($null -ne $focus) { $result['warnings'] += $focus }
        }
        if ($Scenario.Launch -and $Scenario.Stress) {
            # The page writes its frame log once a second; give it time to record the window's end.
            Start-Sleep -Milliseconds 1500
            try {
                $samples = @(Read-FrameLog -Port $Settings.DebugPort)
                $result['frames'] = Get-FrameStats -Samples $samples -StartMs $startMs -EndMs $endMs
            } catch {
                $result['frames'] = [ordered]@{ error = $_.Exception.Message; instead = 'note the on-screen fps readout near the end of the window' }
            }
        }
    } catch {
        $result['error'] = $_.Exception.Message
    } finally {
        if ($null -ne $app) { $result['stop'] = Stop-Auracode -Process $app -Tree $tree }
        Restore-LaunchEnvironment -Saved $saved
    }
    $result['finished'] = (Get-Date).ToString('o')
    $result
}

function Invoke-RenderPower {
    param(
        [string[]]$Scenario,
        [string]$Exe,
        [string]$Out,
        [int]$Settle,
        [int]$Seconds,
        [int]$Cooldown,
        [int]$DebugPort,
        [string]$GpuCounter
    )
    if ($env:OS -ne 'Windows_NT') { throw 'render-power.ps1 measures auracode on Windows. Elsewhere, run test-render-power.ps1.' }
    $plan = @(Resolve-ScenarioList -Names $Scenario -Table (Get-ScenarioTable))
    $launches = @($plan | Where-Object { $_.Launch }).Count -gt 0
    if (-not $Out) { $Out = Join-Path (Get-Location).ProviderPath ('render-power-results\' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
    $dataDir = Join-Path $Out 'data'
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    $settings = @{ Exe = $null; Settle = $Settle; Seconds = $Seconds; DebugPort = $DebugPort; GpuCounter = $GpuCounter; DataDir = $dataDir }

    # Everything that would make a run fail is checked before the first one starts.
    if ($launches) {
        $settings.Exe = Resolve-AuracodeExe -Requested $Exe -Candidates (Get-DefaultExeCandidates)
        if (Test-DownloadedFromInternet -Path $settings.Exe) {
            throw ("{0} is marked as downloaded from the internet, so SmartScreen would hold its first launch. Run: Unblock-File -LiteralPath '{0}'" -f $settings.Exe)
        }
        $running = @(Get-Process -Name 'auracode' -ErrorAction SilentlyContinue)
        if ($running.Count -gt 0) { throw 'auracode is running; quit it (check the notification area too) before measuring.' }
        Assert-PortFree -Port $DebugPort
    }
    $machine = Get-MachineInfo
    $machine['auracode_exe'] = $settings.Exe
    if ($settings.Exe) { $machine['auracode_version'] = Get-FileVersion $settings.Exe }
    $machine['scenarios'] = @($plan | ForEach-Object { $_.Name })
    $machine['settle_s'] = $Settle
    $machine['window_s'] = $Seconds
    try {
        $null = Get-Counter -Counter $GpuCounter -MaxSamples 1 -ErrorAction Stop
    } catch {
        $machine['gpu_counter_error'] = $_.Exception.Message
        Write-Warning ('The GPU counter {0} is unavailable ({1}). GPU numbers will be missing; on a non-English Windows pass the local name with -GpuCounter.' -f $GpuCounter, $_.Exception.Message)
    }
    if ($env:SESSIONNAME -and $env:SESSIONNAME -ne 'Console') {
        Write-Warning ('This is a {0} session, not the local console; remote sessions compose windows differently.' -f $env:SESSIONNAME)
    }
    $transparency = Get-Prop $machine 'transparency_effects'
    if ($null -ne $transparency -and [int]$transparency -eq 0) {
        Write-Warning 'Transparency effects are off (Settings > Personalization > Colors), so Mica is drawn flat and glass costs nothing.'
    }
    Write-JsonFile -Path (Join-Path $Out 'machine.json') -Value $machine

    $summaryPath = Join-Path $Out 'summary.txt'
    $failed = 0
    for ($i = 0; $i -lt $plan.Count; $i++) {
        $item = $plan[$i]
        Write-Host ('[{0}] {1}/{2} {3}' -f (Get-Date -Format 'HH:mm:ss'), ($i + 1), $plan.Count, $item.Name)
        $result = Invoke-Scenario -Scenario $item -Index ($i + 1) -Settings $settings
        Write-JsonFile -Path (Join-Path $Out ('{0:D2}-{1}.json' -f ($i + 1), $item.Name)) -Value $result
        $line = Format-SummaryLine -Result $result
        Add-Content -LiteralPath $summaryPath -Value $line
        Write-Host $line
        if ($result.Contains('error')) { $failed++ }
        if ($i -lt $plan.Count - 1) { Start-Sleep -Seconds $Cooldown }
    }
    Write-Host ('Results: {0}' -f $Out)
    if ($failed -gt 0) {
        Write-Warning ('{0} of {1} runs failed; their JSON files hold the errors.' -f $failed, $plan.Count)
        $script:RenderPowerExitCode = 1
    } else {
        $script:RenderPowerExitCode = 0
    }
}

# Dot-sourcing (as test-render-power.ps1 does) only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-RenderPower -Scenario $Scenario -Exe $Exe -Out $Out -Settle $Settle -Seconds $Seconds -Cooldown $Cooldown -DebugPort $DebugPort -GpuCounter $GpuCounter
    exit $script:RenderPowerExitCode
}
