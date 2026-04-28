import SwiftUI
import AppKit
import Observation

private let refreshIntervalSeconds: UInt64 = 30
private let nanosPerSecond: UInt64 = 1_000_000_000
private let refreshIntervalNanos: UInt64 = refreshIntervalSeconds * nanosPerSecond
private let statusItemWidth: CGFloat = NSStatusItem.variableLength
private let popoverWidth: CGFloat = 360
private let popoverHeight: CGFloat = 660
private let menubarTitleFontSize: CGFloat = 13

@main
struct CodeBurnApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        // SwiftUI App needs at least one scene. Settings is invisible by default.
        Settings {
            EmptyView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private let store = AppStore()
    let updateChecker = UpdateChecker()
    /// Held for the lifetime of the app to opt out of App Nap and Automatic Termination.
    private var backgroundActivity: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // On macOS Tahoe (26.x), accessory apps may fail to render their status item
        // if the activation policy is set before the status item is created. Starting
        // as a regular app and switching to accessory after setup works around this.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        ProcessInfo.processInfo.automaticTerminationSupportEnabled = false
        ProcessInfo.processInfo.disableSuddenTermination()
        backgroundActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .automaticTerminationDisabled, .suddenTerminationDisabled],
            reason: "CodeBurn menubar polls AI coding cost every 15 seconds while idle in the background."
        )

        restorePersistedCurrency()
        setupStatusItem()
        setupPopover()

        // Switch to accessory policy after status item is set up to hide from Dock
        DispatchQueue.main.async {
            NSApp.setActivationPolicy(.accessory)
        }
        observeStore()
        startRefreshLoop()
        setupWakeObservers()
        setupDistributedNotificationListener()
        installLaunchAgentIfNeeded()
        registerLoginItemIfNeeded()
        Task { await updateChecker.checkIfNeeded() }
    }

    private func setupWakeObservers() {
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.forceRefresh() }
        }

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.screensDidWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.forceRefresh() }
        }
    }

    private func setupDistributedNotificationListener() {
        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.codeburn.refresh"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.forceRefresh() }
        }
    }

    private func installLaunchAgentIfNeeded() {
        let fm = FileManager.default
        let agentName = "com.codeburn.refresh.plist"
        let home = fm.homeDirectoryForCurrentUser.path
        let destPath = "\(home)/Library/LaunchAgents/\(agentName)"

        let plist = """
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codeburn.refresh</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/osascript</string>
        <string>-l</string>
        <string>JavaScript</string>
        <string>-e</string>
        <string>ObjC.import("Foundation"); $.NSDistributedNotificationCenter.defaultCenter.postNotificationNameObjectUserInfoDeliverImmediately("com.codeburn.refresh", $(), $(), true)</string>
    </array>
    <key>StartInterval</key>
    <integer>30</integer>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"""

        do {
            let existing = try? String(contentsOfFile: destPath, encoding: .utf8)
            if existing == plist { return }

            try fm.createDirectory(atPath: "\(home)/Library/LaunchAgents", withIntermediateDirectories: true)
            try plist.write(toFile: destPath, atomically: true, encoding: .utf8)

            let unload = Process()
            unload.launchPath = "/bin/launchctl"
            unload.arguments = ["unload", destPath]
            try? unload.run()
            unload.waitUntilExit()

            let load = Process()
            load.launchPath = "/bin/launchctl"
            load.arguments = ["load", destPath]
            try load.run()
            load.waitUntilExit()
        } catch {
            NSLog("CodeBurn: LaunchAgent setup failed: \(error)")
        }
    }

    private func registerLoginItemIfNeeded() {
        let key = "codeburn.loginItemRegistered"
        guard !UserDefaults.standard.bool(forKey: key) else { return }

        let appPath = Bundle.main.bundlePath
        let script = "tell application \"System Events\" to make login item at end with properties {path:\"\(appPath)\", hidden:false}"

        let process = Process()
        process.launchPath = "/usr/bin/osascript"
        process.arguments = ["-e", script]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus == 0 {
                UserDefaults.standard.set(true, forKey: key)
            }
        } catch {
            NSLog("CodeBurn: Login item registration failed: \(error)")
        }
    }

    private var lastRefreshTime: Date = .distantPast

    private func forceRefresh() {
        let now = Date()
        guard now.timeIntervalSince(lastRefreshTime) > 5 else { return }
        lastRefreshTime = now

        Task {
            await store.refresh(includeOptimize: true)
            refreshStatusButton()
        }
    }

    /// Loads the currency code persisted by `codeburn currency` so a relaunch picks up where
    /// the user left off. Rate is resolved from the on-disk FX cache if present, otherwise
    /// fetched live in the background.
    private func restorePersistedCurrency() {
        guard let code = CLICurrencyConfig.loadCode(), code != "USD" else { return }
        let symbol = CurrencyState.symbolForCode(code)
        store.currency = code

        Task {
            let cached = await FXRateCache.shared.cachedRate(for: code)
            await MainActor.run {
                CurrencyState.shared.apply(code: code, rate: cached, symbol: symbol)
            }
            let fresh = await FXRateCache.shared.rate(for: code)
            if let fresh, fresh != cached {
                await MainActor.run {
                    CurrencyState.shared.apply(code: code, rate: fresh, symbol: symbol)
                }
            }
        }
    }

    private func startRefreshLoop() {
        Task {
            await store.refresh(includeOptimize: true)
            refreshStatusButton()
        }
    }

    private func observeStore() {
        withObservationTracking {
            _ = store.payload
            _ = store.todayPayload
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.refreshStatusButton()
                self?.observeStore()
            }
        }
    }

    // MARK: - Status Item

    private var isCompact: Bool {
        UserDefaults.standard.bool(forKey: "CodeBurnMenubarCompact")
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: statusItemWidth)
        guard let button = statusItem.button else { return }

        // Set a simple SF Symbol image immediately to ensure the status item renders.
        // On macOS Tahoe, status items may fail to appear if only an attributed title
        // is set during initial setup.
        let flameConfig = NSImage.SymbolConfiguration(pointSize: menubarTitleFontSize, weight: .medium)
        let flame = NSImage(systemSymbolName: "flame.fill", accessibilityDescription: "CodeBurn")?
            .withSymbolConfiguration(flameConfig)
        flame?.isTemplate = true
        button.image = flame
        button.imagePosition = .imageLeading

        button.target = self
        button.action = #selector(handleButtonClick(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])

        // Defer the full attributed title setup to ensure initial render completes
        DispatchQueue.main.async { [weak self] in
            self?.refreshStatusButton()
        }
    }

    /// Composes the menubar title as a single attributed string with the flame as an inline
    /// NSTextAttachment. NSStatusItem's separate `image` + `attributedTitle` path leaves a
    /// stubborn gap between icon and text on some macOS releases (the icon hugs the left edge
    /// of the status item, the title starts at its own baseline), so we inline both so they
    /// flow as one typographic unit with a single, controllable gap.
    private func refreshStatusButton() {
        guard let button = statusItem.button else { return }

        // Clear any previously-set image so the attachment is the only glyph rendered.
        button.image = nil
        button.imagePosition = .noImage

        let font = NSFont.monospacedDigitSystemFont(ofSize: menubarTitleFontSize, weight: .medium)
        let flameConfig = NSImage.SymbolConfiguration(pointSize: menubarTitleFontSize, weight: .medium)
        let flame = NSImage(systemSymbolName: "flame.fill", accessibilityDescription: "CodeBurn")?
            .withSymbolConfiguration(flameConfig)
        flame?.isTemplate = true

        let attachment = NSTextAttachment()
        attachment.image = flame
        if let size = flame?.size {
            attachment.bounds = CGRect(x: 0, y: -3, width: size.width, height: size.height)
        }

        let hasPayload = store.todayPayload != nil
        let compact = isCompact
        let fallback = compact ? "$-" : "$—"
        let formatted = store.todayPayload?.current.cost
        let valueText = compact
            ? (formatted?.asCompactCurrencyWhole() ?? fallback)
            : " " + (formatted?.asCompactCurrency() ?? fallback)

        var textAttrs: [NSAttributedString.Key: Any] = [.font: font, .baselineOffset: -1.0]
        if !hasPayload {
            textAttrs[.foregroundColor] = NSColor.secondaryLabelColor
        }

        let composed = NSMutableAttributedString()
        composed.append(NSAttributedString(attachment: attachment))
        composed.append(NSAttributedString(string: valueText, attributes: textAttrs))
        button.attributedTitle = composed
    }

    // MARK: - Popover

    private func setupPopover() {
        popover = NSPopover()
        popover.contentSize = NSSize(width: popoverWidth, height: popoverHeight)
        popover.behavior = .transient  // auto-close only on explicit outside click
        popover.animates = true
        popover.delegate = self

        let content = MenuBarContent()
            .environment(store)
            .environment(updateChecker)
            .frame(width: popoverWidth)

        popover.contentViewController = NSHostingController(rootView: content)
    }

    @objc private func handleButtonClick(_ sender: AnyObject?) {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(sender)
        } else {
            NSApp.activate(ignoringOtherApps: true)
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    // MARK: - NSPopoverDelegate

    func popoverShouldDetach(_ popover: NSPopover) -> Bool {
        false
    }
}
