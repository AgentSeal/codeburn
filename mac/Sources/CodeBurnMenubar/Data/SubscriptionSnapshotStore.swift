import Foundation

/// Persisted snapshot of a single utilization reading. We capture one per window every time
/// SubscriptionClient.fetch() succeeds so we can answer "what did the prior 7-day cycle finish at?"
/// when the current window has no usable data yet (just reset).
struct SubscriptionSnapshot: Codable, Sendable {
    let windowKey: String        // "five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"
    let percent: Double          // 0..100
    let resetsAt: Date           // resets_at active at capture (identifies which window cycle this belongs to)
    let capturedAt: Date         // when the snapshot was recorded
    let effectiveTokens: Double? // tokens consumed in window at capture (nil if not computed)
}

private let snapshotFilename = "subscription-snapshots.json"
private let pruneOlderThanSeconds: TimeInterval = 30 * 24 * 3600

private func snapshotsCacheDir() -> String {
    return ProcessInfo.processInfo.environment["CODEBURN_CACHE_DIR"]
        ?? (NSHomeDirectory() as NSString).appendingPathComponent(".cache/codeburn")
}

private func snapshotsPath() -> String {
    return (snapshotsCacheDir() as NSString).appendingPathComponent(snapshotFilename)
}

private actor SnapshotLock {
    static let shared = SnapshotLock()
    func run<T>(_ fn: () throws -> T) rethrows -> T { try fn() }
}

enum SubscriptionSnapshotStore {
    /// Append a snapshot. Auto-prunes entries older than 30 days. Idempotent: if a snapshot
    /// with the same windowKey + resetsAt already exists, only update percent if new is higher
    /// (so "final" reading near reset is preserved).
    static func record(_ snapshot: SubscriptionSnapshot) async {
        await SnapshotLock.shared.run {
            do {
                var all = loadAll()
                let key = "\(snapshot.windowKey)|\(snapshot.resetsAt.timeIntervalSince1970)"
                if let idx = all.firstIndex(where: { "\($0.windowKey)|\($0.resetsAt.timeIntervalSince1970)" == key }) {
                    if snapshot.percent > all[idx].percent {
                        all[idx] = snapshot
                    }
                } else {
                    all.append(snapshot)
                }
                let cutoff = Date().addingTimeInterval(-pruneOlderThanSeconds)
                all = all.filter { $0.capturedAt >= cutoff }
                try save(all)
            } catch {
                NSLog("CodeBurn: snapshot record failed: \(error)")
            }
        }
    }

    /// Returns the final percent of the immediately-prior cycle for this window, or nil if no
    /// prior data is available. Logic: among snapshots whose resetsAt < currentResetsAt, pick
    /// the group with the largest resetsAt (most recent prior cycle), then return the max
    /// percent in that group (the closest-to-final reading we have).
    static func previousWindowFinal(windowKey: String, currentResetsAt: Date) async -> Double? {
        await SnapshotLock.shared.run {
            let all = loadAll()
            let priors = all.filter { $0.windowKey == windowKey && $0.resetsAt < currentResetsAt }
            guard let mostRecentPriorReset = priors.map({ $0.resetsAt }).max() else { return nil }
            let priorWindow = priors.filter { $0.resetsAt == mostRecentPriorReset }
            return priorWindow.map(\.percent).max()
        }
    }

    /// Return all snapshots for a given window key, useful for capacity estimation.
    static func snapshots(for windowKey: String) async -> [SubscriptionSnapshot] {
        await SnapshotLock.shared.run {
            loadAll().filter { $0.windowKey == windowKey }
        }
    }

    /// Test seam: clear all snapshots.
    static func resetForTesting() async {
        await clearAll()
    }

    /// Wipe all snapshots from disk. Called when the user disconnects so the
    /// "Based on last cycle" projections do not contaminate a reconnect under
    /// a different account or tier.
    static func clearAll() async {
        await SnapshotLock.shared.run {
            try? FileManager.default.removeItem(atPath: snapshotsPath())
        }
    }

    // MARK: - Internals

    private static func loadAll() -> [SubscriptionSnapshot] {
        let path = snapshotsPath()
        guard FileManager.default.fileExists(atPath: path) else { return [] }
        guard let data = try? SafeFile.read(from: path) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([SubscriptionSnapshot].self, from: data)) ?? []
    }

    private static func save(_ snapshots: [SubscriptionSnapshot]) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(snapshots)
        // SafeFile.write refuses symlinked targets and does the tmp+rename atomic dance.
        try SafeFile.write(data, to: snapshotsPath(), mode: 0o600)
    }
}
