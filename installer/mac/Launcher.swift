// TranslateOS (Mac) başlatıcı: kurulum programını çalıştırır, Dock'ta simge gösterir.
// Dock'ta sağ tık › Çık ya da ⌘Q ile kapanır; simgeye tıklayınca kurulum sayfası yeniden açılır.
// Kurulum programı kendiliğinden kapanınca (kurulum bitti / Kapat düğmesi) bu uygulama da kapanır.
// Copyright (C) 2026 Emrah AYDIN. AGPL-3.0.
import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var proc: Process?
    private var pageURL: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let exe = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/translateos-kurulum")
        let p = Process()
        p.executableURL = exe
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let s = String(data: data, encoding: .utf8),
                  let r = s.range(of: "http://127\\.0\\.0\\.1:[0-9]+/[0-9a-f]+/", options: .regularExpression) else { return }
            DispatchQueue.main.async { self?.pageURL = URL(string: String(s[r])) }
        }
        p.terminationHandler = { _ in DispatchQueue.main.async { NSApp.terminate(nil) } }
        do { try p.run(); proc = p } catch { NSApp.terminate(nil) }
    }

    // Dock simgesine tıklanınca kurulum sayfasını yeniden aç
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let u = pageURL { NSWorkspace.shared.open(u) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let p = proc, p.isRunning { p.terminate() }
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Kurulum sayfasını aç", action: #selector(openPage), keyEquivalent: "o").target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "TranslateOS'tan çık", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main
    }

    @objc private func openPage() { if let u = pageURL { NSWorkspace.shared.open(u) } }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
