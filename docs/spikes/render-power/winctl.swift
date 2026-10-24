// Window helper for the render + power spike. No permissions needed.
//   winctl locked          prints 1 if the login session's screen is locked, else 0
//   winctl info <pid>      prints "<id> <x>,<y> <w>x<h> onscreen=<0|1> alpha=<a>" per normal window
//   winctl hide <pid>      hides the app (Cmd+H), the closest permission-free stand-in for minimize
//   winctl unhide <pid>
//   winctl cover [seconds] covers every screen with a black window (measure.py's fallback when
//                          macOS refuses to hide the app; WebKit treats it like a minimized window)
import AppKit
import CoreGraphics

func normalWindows(of pid: pid_t) -> [[String: Any]] {
    let list = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
    return list.filter {
        ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: winctl locked | info <pid> | hide <pid> | unhide <pid> | cover [seconds]\n".data(using: .utf8)!)
    exit(2)
}
switch args[1] {
case "locked":
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    print((session["CGSSessionScreenIsLocked"] as? Int) ?? 0)
case "cover":
    // An opaque window over every screen for N seconds: occludes everything below it, which WebKit
    // treats like a minimized window (the view is not visible, so the page becomes hidden).
    let seconds = args.count >= 3 ? Double(args[2]) ?? 30 : 30
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    var covers: [NSWindow] = []
    for screen in NSScreen.screens {
        let window = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered,
                              defer: false, screen: screen)
        window.level = .floating
        window.backgroundColor = .black
        window.isOpaque = true
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.canJoinAllSpaces, .stationary]
        window.orderFrontRegardless()
        covers.append(window)
    }
    print("covering \(covers.count) screen(s) for \(seconds)s")
    fflush(stdout)
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { exit(0) }
    app.run()
case "info", "hide", "unhide":
    guard args.count >= 3, let pid = Int32(args[2]) else { exit(2) }
    if args[1] == "info" {
        for window in normalWindows(of: pid) {
            let id = window[kCGWindowNumber as String] as? Int ?? 0
            let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
            let x = bounds["X"] as? Double ?? 0, y = bounds["Y"] as? Double ?? 0
            let w = bounds["Width"] as? Double ?? 0, h = bounds["Height"] as? Double ?? 0
            let onscreen = (window[kCGWindowIsOnscreen as String] as? Bool) ?? false
            let alpha = window[kCGWindowAlpha as String] as? Double ?? 0
            print("\(id) \(Int(x)),\(Int(y)) \(Int(w))x\(Int(h)) onscreen=\(onscreen ? 1 : 0) alpha=\(alpha)")
        }
    } else {
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            print("no such app")
            exit(1)
        }
        let ok = args[1] == "hide" ? app.hide() : app.unhide()
        print(ok ? "ok" : "refused")
        exit(ok ? 0 : 1)
    }
default:
    exit(2)
}
