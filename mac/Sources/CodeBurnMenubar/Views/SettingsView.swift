import SwiftUI

/// macOS-standard tabbed Settings window. New per-provider sections (Codex,
/// Cursor, Copilot, etc.) plug in as additional tabs. Each tab owns its own
/// concerns; this top-level view only hosts the TabView shell.
struct SettingsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem { Label("General", systemImage: "gearshape") }

            ClaudeSettingsTab()
                .tabItem { Label("Claude", systemImage: "brain") }

            AboutSettingsTab()
                .tabItem { Label("About", systemImage: "info.circle") }
        }
        .frame(width: 520, height: 380)
    }
}

// MARK: - General

private struct GeneralSettingsTab: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Form {
            Section("Display") {
                Picker("Currency", selection: Binding(
                    get: { store.currency },
                    set: { applyCurrency(code: $0) }
                )) {
                    ForEach(["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD"], id: \.self) { code in
                        Text(code).tag(code)
                    }
                }
                Picker("Accent", selection: Binding(
                    get: { store.accentPreset },
                    set: { store.accentPreset = $0 }
                )) {
                    ForEach(AccentPreset.allCases) { preset in
                        Text(preset.rawValue).tag(preset)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    private func applyCurrency(code: String) {
        let symbol = CurrencyState.symbolForCode(code)
        Task {
            let cached = await FXRateCache.shared.cachedRate(for: code)
            if let cached {
                store.currency = code
                CurrencyState.shared.apply(code: code, rate: cached, symbol: symbol)
            }
            let fresh = await FXRateCache.shared.rate(for: code)
            store.currency = code
            CurrencyState.shared.apply(code: code, rate: fresh ?? cached, symbol: symbol)
        }
        CLICurrencyConfig.persist(code: code)
    }
}

// MARK: - Claude

private struct ClaudeSettingsTab: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Form {
            Section("Connection") {
                ClaudeConnectionRow()
            }
            Section("Quota Refresh") {
                Picker("Update every", selection: Binding(
                    get: { SubscriptionRefreshCadence.current },
                    set: { SubscriptionRefreshCadence.current = $0 }
                )) {
                    ForEach(SubscriptionRefreshCadence.allCases) { cadence in
                        Text(cadence.label).tag(cadence)
                    }
                }
                .pickerStyle(.menu)
                Text("Anthropic rate-limits this endpoint per account. 2 minutes is plenty for the 5-hour and weekly windows; pick Manual if you only want updates on demand.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Button("Refresh Now") {
                    Task { await store.refreshSubscription() }
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

private struct ClaudeConnectionRow: View {
    @Environment(AppStore.self) private var store
    @State private var showDisconnectConfirm = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: stateIcon)
                .font(.system(size: 18))
                .foregroundStyle(stateTint)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(stateTitle)
                    .font(.system(size: 12, weight: .semibold))
                Text(stateDetail)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            actionButton
        }
        .padding(.vertical, 4)
    }

    private var stateIcon: String {
        switch store.subscriptionLoadState {
        case .loaded: return "checkmark.circle.fill"
        case .terminalFailure: return "exclamationmark.triangle.fill"
        case .transientFailure: return "clock.arrow.circlepath"
        case .bootstrapping, .loading: return "ellipsis.circle"
        case .notBootstrapped, .noCredentials: return "link.circle"
        case .failed: return "xmark.circle"
        }
    }

    private var stateTint: Color {
        switch store.subscriptionLoadState {
        case .loaded: return .green
        case .terminalFailure, .failed: return .red
        case .transientFailure: return .orange
        default: return .secondary
        }
    }

    private var stateTitle: String {
        switch store.subscriptionLoadState {
        case .loaded: return "Connected"
        case let .terminalFailure(reason): return reason ?? "Reconnect required"
        case .transientFailure: return "Backing off"
        case .bootstrapping: return "Connecting…"
        case .loading: return "Refreshing…"
        case .notBootstrapped, .noCredentials: return "Not connected"
        case .failed: return "Couldn't load plan data"
        }
    }

    private var stateDetail: String {
        switch store.subscriptionLoadState {
        case .loaded:
            if let tier = store.subscription?.tier.displayName {
                return "Plan: \(tier)"
            }
            return "Live quota tracked from Anthropic."
        case .terminalFailure: return "Open Claude Code in your terminal and type `/login`, then click Reconnect."
        case .transientFailure: return store.subscriptionError ?? "Anthropic rate-limited; auto-retrying."
        case .bootstrapping: return "macOS may ask permission to read your credentials."
        case .loading: return "Background refresh in progress."
        case .notBootstrapped, .noCredentials: return "Click Connect to read your Claude Code credentials and start tracking quota."
        case .failed: return store.subscriptionError ?? ""
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        switch store.subscriptionLoadState {
        case .loaded, .transientFailure, .loading:
            Button("Disconnect") { showDisconnectConfirm = true }
                .confirmationDialog(
                    "Disconnect Claude?",
                    isPresented: $showDisconnectConfirm
                ) {
                    Button("Disconnect", role: .destructive) {
                        store.disconnectSubscription()
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("CodeBurn will stop tracking your Claude quota and forget the cached credentials. Click Connect to resume.")
                }
        case .terminalFailure, .noCredentials, .failed:
            Button("Reconnect") { Task { await store.bootstrapSubscription() } }
                .buttonStyle(.borderedProminent)
        case .notBootstrapped:
            Button("Connect") { Task { await store.bootstrapSubscription() } }
                .buttonStyle(.borderedProminent)
        case .bootstrapping:
            ProgressView().controlSize(.small)
        }
    }
}

// MARK: - About

private struct AboutSettingsTab: View {
    private let appVersion: String =
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "—"
    private let buildVersion: String =
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "—"

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "flame.fill")
                .font(.system(size: 40))
                .foregroundStyle(Theme.brandAccent)
            Text("CodeBurn")
                .font(.system(size: 18, weight: .semibold))
            Text("AI Coding Cost Tracker")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Text("Version \(appVersion) (\(buildVersion))")
                .font(.codeMono(size: 11))
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Link("GitHub", destination: URL(string: "https://github.com/getagentseal/codeburn")!)
                Link("Issues", destination: URL(string: "https://github.com/getagentseal/codeburn/issues")!)
            }
            .font(.system(size: 12))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
