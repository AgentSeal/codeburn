import Foundation

/// User-configurable cadence for /api/oauth/usage polling. Mirrors CodexBar's
/// "manual / 1m / 2m / 5m / 15m" preset set so users on tight rate-limit
/// budgets can dial it down and power users can dial it up. Stored as the raw
/// number of seconds in UserDefaults; `manual = 0` means "never auto-refresh".
enum SubscriptionRefreshCadence: Int, CaseIterable, Identifiable {
    case manual = 0
    case oneMinute = 60
    case twoMinutes = 120
    case fiveMinutes = 300
    case fifteenMinutes = 900

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .manual: return "Manual"
        case .oneMinute: return "1 minute"
        case .twoMinutes: return "2 minutes"
        case .fiveMinutes: return "5 minutes"
        case .fifteenMinutes: return "15 minutes"
        }
    }

    static let defaultsKey = "codeburn.claude.refreshCadenceSeconds"
    static let `default`: SubscriptionRefreshCadence = .twoMinutes

    static var current: SubscriptionRefreshCadence {
        get {
            // UserDefaults.integer returns 0 when the key is missing — that
            // happens to alias `manual`, which is wrong for a fresh install.
            // Probe with object(forKey:) so we can distinguish "never set"
            // from "set to manual" and seed the default on first run.
            if UserDefaults.standard.object(forKey: defaultsKey) == nil {
                return .default
            }
            return SubscriptionRefreshCadence(rawValue: UserDefaults.standard.integer(forKey: defaultsKey)) ?? .default
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: defaultsKey) }
    }
}
