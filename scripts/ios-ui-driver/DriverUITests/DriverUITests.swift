import XCTest

// Command-polling UI driver. Reads lines from DIR/cmd.txt ("<id> <verb> <args...>") and writes DIR/res-<id>.txt.
// DIR comes from Config.swift, which gen.rb writes when the project is generated.
let BUNDLE = "com.anycognition.whim"

final class DriverUITests: XCTestCase {
    var app: XCUIApplication!
    func write(_ id: String, _ s: String) { try? s.write(toFile: "\(DIR)/res-\(id).txt", atomically: true, encoding: .utf8) }

    func find(_ label: String) -> XCUIElement {
        let exact = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR identifier == %@", label, label)).firstMatch
        if exact.exists { return exact }
        let p = NSPredicate(format: "label == %@ OR identifier == %@ OR label CONTAINS %@", label, label, label)
        return app.descendants(matching: .any).matching(p).firstMatch
    }
    func coord(_ x: Double, _ y: Double) -> XCUICoordinate {
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
    }

    // One snapshot walk. Enumerating elements with queries kills the XCUITest loop on a WebView screen.
    func labels() -> String {
        if app.state != .runningForeground { return "app-not-foreground state=\(app.state.rawValue)" }
        guard let snap = try? app.snapshot() else { return "no-snapshot" }
        let wanted: [XCUIElement.ElementType] = [.button, .staticText, .other, .textView, .textField]
        var lines: [String] = []
        func walk(_ s: XCUIElementSnapshot) {
            if !s.label.isEmpty, wanted.contains(s.elementType) {
                let f = s.frame
                lines.append("\(s.elementType.rawValue) [\(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height))] \(s.label.prefix(70))")
            }
            for c in s.children { walk(c) }
        }
        walk(snap)
        return lines.joined(separator: "\n")
    }

    func run(_ verb: String, _ arg: String, _ nums: [Double]) -> String {
        var out = "ok"
        switch verb {
        case "launch": app.launch()
        case "activate": app.activate()
        case "terminate": app.terminate()
        case "tapText":
            let e = find(arg); if e.waitForExistence(timeout: 5) { e.tap() } else { out = "notfound" }
        case "longText":
            let e = find(arg); if e.waitForExistence(timeout: 5) { e.press(forDuration: 1.0) } else { out = "notfound" }
        case "tap": coord(nums[0], nums[1]).tap()
        case "long": coord(nums[0], nums[1]).press(forDuration: nums.count > 2 ? nums[2] : 1.0)
        case "drag": coord(nums[0], nums[1]).press(forDuration: 0.1, thenDragTo: coord(nums[2], nums[3]))
        case "type": app.typeText(arg)
        case "exists": out = find(arg).exists ? "yes" : "no"
        case "hittable": let e = find(arg); out = e.exists ? (e.isHittable ? "hittable" : "not-hittable") : "notfound"
        case "waitFor": out = find(arg).waitForExistence(timeout: 6) ? "yes" : "no"
        case "dump": out = app.debugDescription
        case "labels": out = labels()
        case "frame": let e = find(arg); out = e.exists ? "\(e.frame)" : "notfound"
        case "wait": usleep(UInt32((nums.first ?? 1) * 1_000_000))
        default: out = "unknown verb"
        }
        return out
    }

    func testDrive() throws {
        continueAfterFailure = true
        app = XCUIApplication(bundleIdentifier: BUNDLE)
        var done = Set<String>()
        let needed = ["tap": 2, "long": 2, "drag": 4]
        write("ready", "ready")
        while !FileManager.default.fileExists(atPath: "\(DIR)/stop") {
            guard let txt = try? String(contentsOfFile: "\(DIR)/cmd.txt", encoding: .utf8) else { usleep(200_000); continue }
            for line in txt.split(separator: "\n") {
                let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true).map(String.init)
                guard parts.count >= 2 else { continue }
                let id = parts[0]; if done.contains(id) { continue }; done.insert(id)
                let verb = parts[1]; let arg = parts.count > 2 ? parts[2] : ""
                let nums = arg.split(separator: " ").compactMap { Double($0) }
                if nums.count < (needed[verb] ?? 0) { write(id, "usage: \(verb) needs \(needed[verb] ?? 0) numbers"); continue }
                write(id, run(verb, arg, nums))
            }
            usleep(150_000)
        }
        write("stopped", "stopped")
    }
}
