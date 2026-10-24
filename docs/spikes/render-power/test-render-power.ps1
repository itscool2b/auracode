#Requires -Version 5.1
<#
.SYNOPSIS
Unit tests for render-power.ps1's logic. Run them before the measurement suite, on the machine that
will run it:

    powershell -ExecutionPolicy Bypass -File .\test-render-power.ps1

.DESCRIPTION
Loading render-power.ps1 also proves that this PowerShell parses it. Nothing here starts auracode,
reads performance counters or opens a network connection, so the tests also run under PowerShell 7
on macOS and Linux. The exit code is 1 when any test fails.
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'render-power.ps1')

$script:FailedTests = New-Object System.Collections.ArrayList
$script:PassedTests = 0
$script:T0 = [datetime]::new(2026, 10, 24, 12, 0, 0)

function Test-Case {
    param([string]$Name, [scriptblock]$Body)
    try {
        & $Body
        $script:PassedTests++
        Write-Host ('ok    {0}' -f $Name)
    } catch {
        [void]$script:FailedTests.Add($Name)
        Write-Host ('FAIL  {0}' -f $Name)
        Write-Host ('      {0}' -f $_.Exception.Message)
    }
}

function Assert-Equal {
    # Scalars only: on arrays, PowerShell's -ne filters instead of comparing.
    param($Expected, $Actual, [string]$What)
    if ($null -eq $Expected -and $null -eq $Actual) { return }
    if ($null -eq $Expected -or $null -eq $Actual -or $Expected -ne $Actual) {
        throw ('{0}: expected [{1}], got [{2}]' -f $What, $Expected, $Actual)
    }
}

function Assert-Throws {
    param([scriptblock]$Body, [string]$Like)
    $message = $null
    try {
        & $Body
    } catch {
        $message = $_.Exception.Message
    }
    if ($null -eq $message) { throw 'expected an error, got none' }
    if ($Like -and $message -notlike $Like) { throw ('the error [{0}] does not match [{1}]' -f $message, $Like) }
}

function New-Proc {
    param([int]$Id, [int]$Parent, [int]$AgeSeconds, [string]$Name = 'x.exe', [string]$CommandLine = '')
    [pscustomobject]@{
        ProcessId = [uint32]$Id
        ParentProcessId = [uint32]$Parent
        CreationDate = $script:T0.AddSeconds(-$AgeSeconds)
        Name = $Name
        CommandLine = $CommandLine
        KernelModeTime = [uint64]0
        UserModeTime = [uint64]0
    }
}

function New-Sample {
    param([string]$Instance, [double]$Value, [uint32]$Status = 0)
    [pscustomobject]@{ InstanceName = $Instance; CookedValue = $Value; Status = $Status }
}

function New-Frames {
    # One sample per second from $FirstT on, with the given frame counts.
    param([double]$FirstT, [int[]]$Frames, [bool]$Hidden = $false)
    $t = $FirstT
    foreach ($count in $Frames) {
        [pscustomobject]@{ t = $t; frames = [double]$count; hidden = $Hidden }
        $t += 1000
    }
}

function Join-Names {
    param([object[]]$Items, [string]$Property)
    (@($Items | ForEach-Object { Get-Prop $_ $Property }) -join ',')
}

Test-Case 'the default suite only names known scenarios and starts and ends with a baseline' {
    $plan = @(Resolve-ScenarioList -Names @() -Table (Get-ScenarioTable))
    Assert-Equal $script:DefaultSuite.Count $plan.Count 'suite length'
    Assert-Equal 'baseline' $plan[0].Name 'first run'
    Assert-Equal 'baseline' $plan[$plan.Count - 1].Name 'last run'
}

Test-Case 'named scenarios keep their order and repeats, ignoring case and blanks' {
    $plan = @(Resolve-ScenarioList -Names @('S24', ' ', 'baseline', 's24') -Table (Get-ScenarioTable))
    Assert-Equal 's24,baseline,s24' (Join-Names $plan 'Name') 'plan'
}

Test-Case 'an unknown scenario is an error that lists the known ones' {
    Assert-Throws { Resolve-ScenarioList -Names @('s25') -Table (Get-ScenarioTable) } '*Unknown scenario: s25*s24-minimized*'
}

Test-Case 'stress settings match the macOS harness' {
    $table = Get-ScenarioTable
    Assert-Equal 'orbs=1,rate=200,aura=0,seconds=0' $table['s1'].Stress 's1'
    Assert-Equal 'orbs=1,rate=200,aura=1,seconds=0' $table['s1-aura'].Stress 's1-aura'
    Assert-Equal 'orbs=8,rate=200,aura=1,seconds=0' $table['s8'].Stress 's8'
    Assert-Equal 'orbs=16,rate=200,aura=1,seconds=0' $table['s16'].Stress 's16'
    Assert-Equal 'orbs=24,rate=200,aura=1,seconds=0' $table['s24'].Stress 's24'
    Assert-Equal 'orbs=24,rate=200,aura=0,seconds=0' $table['s24-noaura'].Stress 's24-noaura'
    Assert-Equal $true $table['s24-noglass'].NoGlass 's24-noglass is opaque'
    Assert-Equal $true $table['s24-minimized'].Minimize 's24-minimized minimizes'
    Assert-Equal $true $table['idle-minimized'].Minimize 'idle-minimized minimizes'
    Assert-Equal '' $table['idle-minimized'].Stress 'idle-minimized is not a stress run'
    Assert-Equal $false $table['baseline'].Launch 'baseline starts nothing'
}

Test-Case 'the first candidate exe that exists wins' {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('render-power-test-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
        $second = Join-Path $dir 'second.exe'
        $third = Join-Path $dir 'third.exe'
        Set-Content -LiteralPath $second -Value 'x'
        Set-Content -LiteralPath $third -Value 'x'
        $found = Resolve-AuracodeExe -Requested '' -Candidates @((Join-Path $dir 'first.exe'), $second, $third)
        Assert-Equal (Resolve-Path -LiteralPath $second).ProviderPath $found 'exe'
    } finally {
        Remove-Item -LiteralPath $dir -Recurse -Force
    }
}

Test-Case 'no exe anywhere is an error that says how to get one' {
    $nowhere = Join-Path ([System.IO.Path]::GetTempPath()) ('render-power-missing-' + [guid]::NewGuid().ToString('N'))
    Assert-Throws { Resolve-AuracodeExe -Requested '' -Candidates @((Join-Path $nowhere 'auracode.exe')) } '*installer*-Exe*'
}

Test-Case 'a requested exe that does not exist is an error' {
    $nowhere = Join-Path ([System.IO.Path]::GetTempPath()) ('render-power-missing-' + [guid]::NewGuid().ToString('N'))
    Assert-Throws { Resolve-AuracodeExe -Requested (Join-Path $nowhere 'auracode.exe') -Candidates @() } '*does not exist*'
}

Test-Case 'a file without a Zone.Identifier stream does not count as downloaded' {
    $file = Join-Path ([System.IO.Path]::GetTempPath()) ('render-power-zone-' + [guid]::NewGuid().ToString('N') + '.exe')
    Set-Content -LiteralPath $file -Value 'x'
    try {
        Assert-Equal $false (Test-DownloadedFromInternet -Path $file) 'fresh file'
    } finally {
        Remove-Item -LiteralPath $file -Force
    }
}

Test-Case 'the tree is the root and its descendants, without older processes that inherited a recycled id' {
    $processes = @(
        (New-Proc 0 0 1000),
        (New-Proc 4 0 1000),
        (New-Proc 100 50 10 'auracode.exe'),
        (New-Proc 200 100 9 'msedgewebview2.exe'),
        (New-Proc 300 200 8 'msedgewebview2.exe'),
        (New-Proc 400 1 5),
        (New-Proc 500 100 100)
    )
    $tree = @(Get-ProcessTree -Processes $processes -RootId 100)
    Assert-Equal '100,200,300' (Join-Names $tree 'ProcessId') 'tree'
}

Test-Case 'a missing root gives an empty tree' {
    $tree = @(Get-ProcessTree -Processes @((New-Proc 1 0 5)) -RootId 99)
    Assert-Equal 0 $tree.Count 'members'
}

Test-Case 'a cycle of parent ids cannot loop forever' {
    $tree = @(Get-ProcessTree -Processes @((New-Proc 600 700 5), (New-Proc 700 600 5)) -RootId 600)
    Assert-Equal '600,700' (Join-Names $tree 'ProcessId') 'tree'
}

Test-Case 'merging keeps one entry per process id, the first one seen' {
    $merged = @(Merge-Processes -Processes @((New-Proc 1 0 5 'first.exe'), (New-Proc 2 0 5), (New-Proc 1 0 5 'second.exe'), $null))
    Assert-Equal '1,2' (Join-Names $merged 'ProcessId') 'ids'
    Assert-Equal 'first.exe' $merged[0].Name 'first one wins'
}

Test-Case 'roles come from the image name and the WebView2 type switch' {
    Assert-Equal 'app' (Get-ProcessRole -Name 'auracode.exe' -CommandLine '') 'app'
    Assert-Equal 'app' (Get-ProcessRole -Name 'AURACODE.EXE' -CommandLine '') 'any case'
    Assert-Equal 'dwm' (Get-ProcessRole -Name 'dwm.exe' -CommandLine $null) 'dwm'
    Assert-Equal 'webview_browser' (Get-ProcessRole -Name 'msedgewebview2.exe' -CommandLine '"C:\EdgeWebView\msedgewebview2.exe" --embedded-browser-webview=1') 'browser'
    Assert-Equal 'webview_browser' (Get-ProcessRole -Name 'msedgewebview2.exe' -CommandLine $null) 'browser without a readable command line'
    Assert-Equal 'webview_renderer' (Get-ProcessRole -Name 'msedgewebview2.exe' -CommandLine 'x --type=renderer --lang=en-US') 'renderer'
    Assert-Equal 'webview_gpu' (Get-ProcessRole -Name 'msedgewebview2.exe' -CommandLine 'x --type=gpu-process') 'gpu'
    Assert-Equal 'webview_utility' (Get-ProcessRole -Name 'msedgewebview2.exe' -CommandLine 'x --type=utility --utility-sub-type=network.mojom.NetworkService') 'utility'
    Assert-Equal 'webview_utility' (Get-ProcessRole -Name 'msedgewebview2.exe' -CommandLine 'x --type=crashpad-handler') 'crashpad'
    Assert-Equal 'other' (Get-ProcessRole -Name 'notepad.exe' -CommandLine '') 'other'
}

Test-Case 'the CPU snapshot adds kernel and user time and skips processes without times' {
    $processes = @(
        [pscustomobject]@{ ProcessId = [uint32]10; CreationDate = $script:T0; KernelModeTime = [uint64]30; UserModeTime = [uint64]12 },
        [pscustomobject]@{ ProcessId = [uint32]11; CreationDate = $script:T0; KernelModeTime = $null; UserModeTime = $null },
        [pscustomobject]@{ ProcessId = [uint32]12; CreationDate = $script:T0 }
    )
    $snapshot = Get-CpuSnapshot -Processes $processes
    Assert-Equal 42 $snapshot[10].Ticks 'ticks'
    Assert-Equal $false $snapshot.ContainsKey(11) 'null times'
    Assert-Equal $false $snapshot.ContainsKey(12) 'no time properties'
}

Test-Case 'CPU percent is CPU time over wall time, counting processes born in the window from zero' {
    $start = $script:T0
    $old = $start.AddSeconds(-60)
    $before = @{
        100 = [pscustomobject]@{ Ticks = 1e7; Created = $old }
        300 = [pscustomobject]@{ Ticks = 5e6; Created = $old }
        400 = [pscustomobject]@{ Ticks = 1e7; Created = $old }
    }
    $after = @{
        100 = [pscustomobject]@{ Ticks = 2.5e7; Created = $old }
        200 = [pscustomobject]@{ Ticks = 5e6; Created = $start.AddSeconds(2) }
        400 = [pscustomobject]@{ Ticks = 9e7; Created = $start.AddSeconds(-30) }
    }
    $cpu = Measure-CpuPercent -Start $before -End $after -Ids @(100, 200, 300, 400) -Seconds 10 -WindowStart $start
    Assert-Equal 15 $cpu.Percent[100] 'a process running throughout'
    Assert-Equal 5 $cpu.Percent[200] 'a process born in the window'
    Assert-Equal '300,400' ((@($cpu.Missing) | Sort-Object) -join ',') 'exited, and an id recycled before the window'
}

Test-Case 'the process id comes from the GPU engine instance name' {
    Assert-Equal 1234 (Get-InstancePid 'pid_1234_luid_0x00000000_0x0000D1A8_phys_0_eng_0_engtype_3D') 'pid'
    Assert-Equal 77 (Get-InstancePid 'PID_77_luid_0x0_0x1_phys_0_eng_0_engtype_3d') 'upper case'
    Assert-Equal $null (Get-InstancePid '_total') 'no pid'
}

Test-Case 'GPU percent sums one process''s 3D engines per sample and averages over samples' {
    $sets = @(
        [pscustomobject]@{ CounterSamples = @(
                (New-Sample 'pid_100_luid_0x0_0x1_phys_0_eng_0_engtype_3d' 10),
                (New-Sample 'pid_100_luid_0x0_0x2_phys_0_eng_0_engtype_3d' 5),
                (New-Sample 'pid_999_luid_0x0_0x1_phys_0_eng_0_engtype_3d' 50)
            )
        },
        [pscustomobject]@{ CounterSamples = @(
                (New-Sample 'pid_100_luid_0x0_0x1_phys_0_eng_0_engtype_3d' 20),
                (New-Sample 'pid_100_luid_0x0_0x2_phys_0_eng_0_engtype_3d' 99 3221228472)
            )
        }
    )
    $gpu = Measure-GpuPercent -SampleSets $sets -Ids @(100, 200)
    Assert-Equal 17.5 $gpu.Percent[100] 'two engines, two samples, one invalid value skipped'
    Assert-Equal 0 $gpu.Percent[200] 'a process with no 3D engine'
    Assert-Equal 2 $gpu.Samples 'samples'
}

Test-Case 'no GPU samples gives no GPU numbers rather than zeros' {
    $gpu = Measure-GpuPercent -SampleSets @() -Ids @(100)
    Assert-Equal $null $gpu.Percent[100] 'pid 100'
    Assert-Equal 0 $gpu.Samples 'samples'
}

Test-Case 'role totals add up processes and count those without a CPU number' {
    $rows = @(
        [ordered]@{ pid = 1; name = 'msedgewebview2.exe'; role = 'webview_renderer'; cpu_pct = 10.5; gpu_3d_pct = 1 },
        [ordered]@{ pid = 2; name = 'msedgewebview2.exe'; role = 'webview_renderer'; cpu_pct = $null; gpu_3d_pct = 2 },
        [ordered]@{ pid = 3; name = 'auracode.exe'; role = 'app'; cpu_pct = 4; gpu_3d_pct = $null }
    )
    $totals = Get-RoleTotals -Rows $rows
    Assert-Equal 2 $totals['webview_renderer']['processes'] 'renderer processes'
    Assert-Equal 10.5 $totals['webview_renderer']['cpu_pct'] 'renderer CPU'
    Assert-Equal 1 $totals['webview_renderer']['cpu_missing'] 'renderers without CPU'
    Assert-Equal 3 $totals['webview_renderer']['gpu_3d_pct'] 'renderer GPU'
    Assert-Equal 4 $totals['app']['cpu_pct'] 'app CPU'
    Assert-Equal 0 $totals['app']['gpu_3d_pct'] 'app GPU'
}

Test-Case 'a frame log parses to one object per sample in every PowerShell' {
    $two = @(ConvertFrom-FrameLogJson -Json '[{"t":1000,"frames":60,"hidden":false},{"t":2000,"frames":59,"hidden":true}]')
    Assert-Equal 2 $two.Count 'two samples'
    Assert-Equal 59 $two[1].frames 'frames'
    Assert-Equal $true $two[1].hidden 'hidden'
    $one = @(ConvertFrom-FrameLogJson -Json '[{"t":1000,"frames":60,"hidden":false}]')
    Assert-Equal 1 $one.Count 'one sample'
    $empty = @(ConvertFrom-FrameLogJson -Json '[]')
    Assert-Equal 0 $empty.Count 'empty log'
    $blank = @(ConvertFrom-FrameLogJson -Json '')
    Assert-Equal 0 $blank.Count 'blank text'
}

Test-Case 'a frame log that is not a list of samples is an error' {
    Assert-Throws { ConvertFrom-FrameLogJson -Json '{"t":1}' } '*frame log*'
    Assert-Throws { ConvertFrom-FrameLogJson -Json 'not json' } ''
}

Test-Case 'frame stats cover the window, skip its opening sample and find the worst second' {
    $samples = @(New-Frames 1000 @(60, 60, 60, 30, 60, 60, 60, 60, 60, 60))
    $stats = Get-FrameStats -Samples $samples -StartMs 1500 -EndMs 9000
    Assert-Equal 8 $stats['samples'] 'samples in (1500, 9500]'
    Assert-Equal 55.71 $stats['fps_avg'] 'average'
    Assert-Equal 30 $stats['fps_min_1s'] 'worst second'
    Assert-Equal 30 $stats['fps_p10_1s'] '10th percentile'
    Assert-Equal 0 $stats['hidden_samples'] 'hidden'
}

Test-Case 'fewer than two samples in the window give no rates' {
    $stats = Get-FrameStats -Samples @(New-Frames 1000 @(60, 60)) -StartMs 1500 -EndMs 1600
    Assert-Equal 1 $stats['samples'] 'samples'
    Assert-Equal $null $stats['fps_avg'] 'average'
    Assert-Equal $null $stats['fps_min_1s'] 'worst second'
}

Test-Case 'hidden seconds are counted and a stopped page reads as 0 fps' {
    $stats = Get-FrameStats -Samples @(New-Frames 1000 @(0, 0, 0) $true) -StartMs 0 -EndMs 3000
    Assert-Equal 3 $stats['hidden_samples'] 'hidden'
    Assert-Equal 0 $stats['fps_avg'] 'average'
    Assert-Equal 0 $stats['fps_min_1s'] 'worst second'
}

Test-Case 'samples out of order are sorted before rates are taken' {
    $samples = @(
        [pscustomobject]@{ t = 3000.0; frames = 60.0; hidden = $false },
        [pscustomobject]@{ t = 1000.0; frames = 60.0; hidden = $false },
        [pscustomobject]@{ t = 2000.0; frames = 60.0; hidden = $false }
    )
    $stats = Get-FrameStats -Samples $samples -StartMs 0 -EndMs 3000
    Assert-Equal 60 $stats['fps_avg'] 'average'
    Assert-Equal 60 $stats['fps_min_1s'] 'worst second'
}

Test-Case 'a visible run that lost the foreground is flagged, a minimized one is not' {
    Assert-Equal $null (Get-FocusWarning -Minimize $false -AtStart $true -AtEnd $true) 'in front throughout'
    Assert-Equal $null (Get-FocusWarning -Minimize $true -AtStart $false -AtEnd $false) 'minimized'
    $lost = Get-FocusWarning -Minimize $false -AtStart $true -AtEnd $false
    if ($lost -notlike '*not in front*Mica*') { throw ('unexpected warning: {0}' -f $lost) }
    $never = Get-FocusWarning -Minimize $false -AtStart $false -AtEnd $true
    if ($null -eq $never) { throw 'a window that started behind another one was not flagged' }
}

Test-Case 'the DevTools page for auracode is picked out of the target list' {
    $targets = @(
        [pscustomobject]@{ type = 'service_worker'; url = 'http://tauri.localhost/sw.js'; webSocketDebuggerUrl = 'ws://127.0.0.1:9333/devtools/page/A' },
        [pscustomobject]@{ type = 'page'; url = 'devtools://devtools/bundled/inspector.html'; webSocketDebuggerUrl = 'ws://127.0.0.1:9333/devtools/page/B' },
        [pscustomobject]@{ type = 'page'; url = 'http://tauri.localhost/'; webSocketDebuggerUrl = 'ws://127.0.0.1:9333/devtools/page/C' }
    )
    $page = Select-PageTarget -Targets $targets -UrlPattern 'tauri.localhost'
    Assert-Equal 'ws://127.0.0.1:9333/devtools/page/C' (Get-Prop $page 'webSocketDebuggerUrl') 'page'
    Assert-Equal $null (Select-PageTarget -Targets $targets -UrlPattern 'example.com') 'no match'
    $attached = @([pscustomobject]@{ type = 'page'; url = 'http://tauri.localhost/' })
    Assert-Equal $null (Select-PageTarget -Targets $attached -UrlPattern 'tauri.localhost') 'a page another client already holds'
}

Test-Case 'a scenario sets every launch variable, and restoring puts the shell back' {
    $saved = Save-LaunchEnvironment
    try {
        [Environment]::SetEnvironmentVariable('AURACODE_STRESS', 'from-the-shell', 'Process')
        [Environment]::SetEnvironmentVariable('AURACODE_NO_GLASS', $null, 'Process')
        [Environment]::SetEnvironmentVariable('AURACODE_SMOKE', '1', 'Process')
        $shell = Save-LaunchEnvironment
        $table = Get-ScenarioTable
        Set-LaunchEnvironment -Values (Get-ScenarioEnvironment -Scenario $table['s24-noglass'] -DataDir 'scratch-data' -DebugPort 9444)
        Assert-Equal 'orbs=24,rate=200,aura=1,seconds=0' $env:AURACODE_STRESS 'stress'
        Assert-Equal '1' $env:AURACODE_NO_GLASS 'no glass'
        Assert-Equal 'scratch-data' $env:AURACODE_DATA_DIR 'scratch profile'
        Assert-Equal '--remote-debugging-port=9444' $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 'DevTools port'
        Assert-Equal $null $env:AURACODE_SMOKE 'smoke mode would override the stress view'
        Set-LaunchEnvironment -Values (Get-ScenarioEnvironment -Scenario $table['idle'] -DataDir 'scratch-data' -DebugPort 9444)
        Assert-Equal $null $env:AURACODE_STRESS 'idle has no stress view'
        Assert-Equal $null $env:AURACODE_NO_GLASS 'idle keeps the glass'
        Assert-Equal $null $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 'idle opens no DevTools port'
        Restore-LaunchEnvironment -Saved $shell
        Assert-Equal 'from-the-shell' $env:AURACODE_STRESS 'restored value'
        Assert-Equal $null $env:AURACODE_NO_GLASS 'restored as unset'
        Assert-Equal '1' $env:AURACODE_SMOKE 'restored smoke'
    } finally {
        Restore-LaunchEnvironment -Saved $saved
    }
}

Test-Case 'the summary line survives missing numbers and reads the same in every culture' {
    $bare = Format-SummaryLine -Result ([ordered]@{ scenario = 'baseline' })
    if ($bare -notlike 'baseline*dwm cpu=- gpu=-*fps=- min1s=-') { throw ('unexpected line: {0}' -f $bare) }
    $full = Format-SummaryLine -Result ([ordered]@{
            scenario = 's24'
            error = 'boom'
            roles = [ordered]@{ app = [ordered]@{ cpu_pct = 4.2; gpu_3d_pct = 0 } }
            frames = [ordered]@{ fps_avg = 59.94; fps_min_1s = 58 }
        })
    if ($full -notlike 's24 *app cpu=4.2 gpu=0.0*fps=59.9 min1s=58.0*ERROR: boom') { throw ('unexpected line: {0}' -f $full) }
}

Test-Case 'results serialize as plain JSON in every PowerShell' {
    # Windows PowerShell 5.1 rejects dictionaries with non-string keys, and can write a wrapped
    # array as {"value": [...], "Count": n}; both would break the files the report is built from.
    $start = $script:T0
    $cpu = Measure-CpuPercent -Start @{} -End @{} -Ids @(7, 8) -Seconds 10 -WindowStart $start
    $result = [ordered]@{
        scenario = 's1'
        warnings = @('first')
        processes = @([ordered]@{ pid = 1; name = 'auracode.exe'; role = 'app'; cpu_pct = 1.5; gpu_3d_pct = $null })
        roles = Get-RoleTotals -Rows @([ordered]@{ pid = 1; role = 'app'; cpu_pct = 1.5; gpu_3d_pct = $null })
        cpu_missing_pids = $cpu.Missing
        frames = Get-FrameStats -Samples @(New-Frames 1000 @(60, 60, 60)) -StartMs 0 -EndMs 3000
        environment = Get-ScenarioEnvironment -Scenario (Get-ScenarioTable)['s1'] -DataDir 'scratch-data' -DebugPort 9333
    }
    $file = Join-Path ([System.IO.Path]::GetTempPath()) ('render-power-json-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        Write-JsonFile -Path $file -Value $result
        $bytes = [System.IO.File]::ReadAllBytes($file)
        Assert-Equal $true ($bytes.Length -gt 3 -and $bytes[0] -ne 0xEF) 'no byte order mark'
        $back = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($file))
        Assert-Equal 's1' $back.scenario 'scenario'
        Assert-Equal $true ($back.warnings -is [System.Array]) 'warnings stay a JSON array'
        Assert-Equal $true ($back.processes -is [System.Array]) 'processes stay a JSON array'
        Assert-Equal $true ($back.cpu_missing_pids -is [System.Array]) 'missing pids stay a JSON array'
        Assert-Equal '7,8' ($back.cpu_missing_pids -join ',') 'missing pids'
        Assert-Equal 'app' $back.processes[0].role 'process row'
        Assert-Equal 60 $back.frames.fps_avg 'frames'
        Assert-Equal 'orbs=1,rate=200,aura=0,seconds=0' $back.environment.AURACODE_STRESS 'environment'
    } finally {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ('{0} passed, {1} failed' -f $script:PassedTests, $script:FailedTests.Count)
if ($script:FailedTests.Count -gt 0) { exit 1 }
exit 0
