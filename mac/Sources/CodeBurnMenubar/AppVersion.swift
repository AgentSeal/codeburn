import Foundation

enum AppVersion {
    static var bundleShortVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    static var bundleBuildVersion: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
    }

    static var normalizedBundleShortVersion: String {
        normalize(bundleShortVersion)
    }

    static var normalizedBundleBuildVersion: String {
        normalize(bundleBuildVersion)
    }

    static var displayBundleShortVersion: String {
        display(bundleShortVersion)
    }

    static func normalize(_ version: String) -> String {
        let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("mac-v") {
            return String(trimmed.dropFirst(5))
        }
        if trimmed.lowercased().hasPrefix("v") {
            return String(trimmed.dropFirst())
        }
        return trimmed
    }

    static func display(_ version: String) -> String {
        let normalized = normalize(version)
        guard !normalized.isEmpty else { return "v?" }
        if normalized == "?" || normalized == "dev" || normalized == "dev-preview" || normalized == "—" {
            return normalized
        }
        return "v\(normalized)"
    }
}
