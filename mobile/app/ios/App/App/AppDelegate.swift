import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Native-layer crash capture (v2.107.21): install first, then deliver
        // anything a previous (crashed) run persisted. See the block at the
        // bottom of this file for the full rationale.
        relayInstallCrashHandler()
        relaySendPendingCrashes()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - Native-layer crash capture (v2.107.21)
//
// The web bundle inside this shell already reports its own JS crashes (the
// reporter ships with the live site at your-chat.io). What it can never see is
// the SHELL dying — an uncaught NSException in the Capacitor bridge, a plugin,
// or UIKit kills the process before any JS runs. This block closes that gap,
// delivering to the SAME https://your-chat.io/api/crash pipe as every other
// surface, tagged platform "ios-shell".
//
// LIVES INSIDE AppDelegate.swift ON PURPOSE: a new .swift file only compiles if
// it is also added to project.pbxproj, and hand-editing that file is the classic
// way an iOS build breaks a week later. This file is already in the target.
//
// PERSIST-THEN-SEND-NEXT-LAUNCH, like every RELAY reporter: at crash time the
// process is milliseconds from death, so the handler only writes a small JSON
// file (fast, reliably completes) and delivery happens on the next launch. Any
// HTTP response counts as delivered — the server answers 204 to everything on
// purpose — so nothing here can retry-loop.
//
// HONEST SCOPE: NSSetUncaughtExceptionHandler catches uncaught NSExceptions
// (the dominant native failure in a Capacitor shell). Hard signal crashes
// (SIGSEGV / Swift runtime traps) are NOT caught — safe signal handling needs
// async-signal-safe machinery a homegrown reporter shouldn't pretend to have.
// The previous handler is chained, so the OS crash behaviour is unchanged.

private let relayCrashEndpoint = URL(string: "https://your-chat.io/api/crash")!
private let relayCrashPendingMax = 10

private var relayCrashFileURL: URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("relay_crash_pending.json")
}

private func relayReadPending() -> [[String: Any]] {
    guard let data = try? Data(contentsOf: relayCrashFileURL),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
    return arr
}

private func relayWritePending(_ arr: [[String: Any]]) {
    let capped = Array(arr.suffix(relayCrashPendingMax))
    if let data = try? JSONSerialization.data(withJSONObject: capped) {
        try? data.write(to: relayCrashFileURL, options: .atomic)
    }
}

private func relayPersistCrash(name: String, message: String, stack: String) {
    var pending = relayReadPending()
    pending.append([
        "errorName": name,
        "errorMessage": message,
        "stack": stack,
        "at": Int(Date().timeIntervalSince1970 * 1000),
    ])
    relayWritePending(pending)
}

private let relayPreviousExceptionHandler = NSGetUncaughtExceptionHandler()

func relayInstallCrashHandler() {
    NSSetUncaughtExceptionHandler { exception in
        relayPersistCrash(
            name: exception.name.rawValue,
            message: exception.reason ?? "",
            stack: exception.callStackSymbols.joined(separator: "\n")
        )
        relayPreviousExceptionHandler?(exception)
    }
}

func relaySendPendingCrashes() {
    DispatchQueue.global(qos: .utility).async {
        var pending = relayReadPending()
        guard !pending.isEmpty else { return }
        let appVersion =
            (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "unknown"

        while let crash = pending.first {
            let device: [String: Any] = [
                "os": "ios",
                "osVersion": UIDevice.current.systemVersion,
                "model": UIDevice.current.model,
                "layer": "capacitor-shell",
                "crashedAt": crash["at"] ?? 0,
            ]
            let body: [String: Any] = [
                "platform": "ios-shell",
                "appVersion": appVersion,
                "errorName": crash["errorName"] ?? "NSException",
                "errorMessage": crash["errorMessage"] ?? "",
                "stack": crash["stack"] ?? "",
                "device": (try? JSONSerialization.data(withJSONObject: device))
                    .flatMap { String(data: $0, encoding: .utf8) } ?? "{}",
            ]
            guard let payload = try? JSONSerialization.data(withJSONObject: body) else {
                pending.removeFirst() // unserialisable — drop it, keep the rest
                continue
            }

            var req = URLRequest(url: relayCrashEndpoint)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = payload
            req.timeoutInterval = 5

            let sema = DispatchSemaphore(value: 0)
            var delivered = false
            URLSession.shared.dataTask(with: req) { _, response, _ in
                delivered = response != nil // any response = delivered (server answers 204)
                sema.signal()
            }.resume()
            _ = sema.wait(timeout: .now() + 8)

            if !delivered { break } // offline — keep the remainder for next launch
            pending.removeFirst()
        }

        if pending.isEmpty {
            try? FileManager.default.removeItem(at: relayCrashFileURL)
        } else {
            relayWritePending(pending)
        }
    }
}
