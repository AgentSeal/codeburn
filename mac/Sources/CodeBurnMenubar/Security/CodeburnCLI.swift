import Foundation

/// Single entry point for spawning the `codeburn` CLI. All callers route through here so the
/// binary argv is validated once and no code path ever passes user-influenced strings through
/// a shell (`/bin/zsh -c`, `open --args`, AppleScript). This closes the shell-injection attack
/// surface end-to-end.
enum CodeburnCLI {
    /// Matches a plain file path / program name: alphanumerics, dot, underscore, slash, hyphen,
    /// space. Deliberately excludes shell metacharacters (`$`, `;`, `&`, `|`, quotes, backticks,
    /// newlines) so a malicious `CODEBURN_BIN="codeburn; rm -rf ~"` can't slip through.
    private static let safeArgPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9 ._/\\-]+$")

    /// PATH additions for GUI-launched apps, which otherwise get a minimal PATH that misses
    /// Homebrew and npm global installs.
    private static let additionalPathEntries = ["/opt/homebrew/bin", "/usr/local/bin"]
    private static let cachedDiscoveredUserPathEntries = discoverUserPathEntries()

    /// Returns the argv that launches the CLI. Dev override via `CODEBURN_BIN` is honoured only
    /// if every whitespace-delimited token passes `safeArgPattern`. Otherwise falls back to the
    /// plain `codeburn` name (resolved via PATH).
    static func baseArgv() -> [String] {
        guard let raw = ProcessInfo.processInfo.environment["CODEBURN_BIN"], !raw.isEmpty else {
            return ["codeburn"]
        }
        let parts = raw.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard parts.allSatisfy(isSafe) else {
            NSLog("CodeBurn: refusing unsafe CODEBURN_BIN; using default 'codeburn'")
            return ["codeburn"]
        }
        return parts
    }

    /// Builds a `Process` that runs the CLI with the given subcommand args. Uses `/usr/bin/env`
    /// so PATH lookup happens without involving a shell, and augments PATH with Homebrew
    /// defaults. Caller sets stdout/stderr pipes and calls `run()`.
    static func makeProcess(subcommand: [String]) -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        var environment = ProcessInfo.processInfo.environment
        let existingPath = environment["PATH"] ?? ""
        let combinedPath = augmentedPath(existingPath)
        environment["PATH"] = combinedPath
        process.environment = environment
        // `env --` treats everything following as argv, not VAR=val pairs -- guards against an
        // argument accidentally resembling an env assignment.
        let argv = ["--"] + baseArgv() + subcommand
        process.arguments = argv
        // The menubar runs as an accessory app with no foreground window, and macOS
        // background-throttles accessory apps and their children. Without this lift the
        // codeburn subprocess parses 5-10x slower than the same command run from a
        // user-interactive terminal, which starves the 15s refresh cadence on large corpora.
        process.qualityOfService = .userInitiated
        return process
    }

    static func isSafe(_ s: String) -> Bool {
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return safeArgPattern.firstMatch(in: s, range: range) != nil
    }

    static func augmentedPath(existing: String, discoveredUserPathEntries: [String]) -> String {
        var parts = existing.split(separator: ":", omittingEmptySubsequences: true).map(String.init)
        let dynamicEntries = additionalPathEntries + discoveredUserPathEntries
        for extra in dynamicEntries where !parts.contains(extra) {
            parts.append(extra)
        }
        return parts.joined(separator: ":")
    }

    private static func augmentedPath(_ existing: String) -> String {
        augmentedPath(existing: existing, discoveredUserPathEntries: cachedDiscoveredUserPathEntries)
    }

    private static func discoverUserPathEntries() -> [String] {
        let fileManager = FileManager.default
        return discoverUserPathEntries(
            homeDirectory: NSHomeDirectory(),
            fileExists: { fileManager.fileExists(atPath: $0) },
            isExecutableFile: { fileManager.isExecutableFile(atPath: $0) },
            contentsOfDirectory: { try? fileManager.contentsOfDirectory(atPath: $0) }
        )
    }

    static func discoverUserPathEntries(
        homeDirectory: String,
        fileExists: (String) -> Bool,
        isExecutableFile: (String) -> Bool,
        contentsOfDirectory: (String) -> [String]?
    ) -> [String] {
        var entries: [String] = []

        let staticUserCandidates = [
            "\(homeDirectory)/.volta/bin",
            "\(homeDirectory)/.npm-global/bin",
            "\(homeDirectory)/.asdf/shims",
        ]
        for candidate in staticUserCandidates where fileExists(candidate) {
            entries.append(candidate)
        }

        let nvmRoot = "\(homeDirectory)/.nvm/versions/node"
        if let nodeVersions = contentsOfDirectory(nvmRoot) {
            // Prefer newer versions first to match typical `nvm current` semantics.
            for version in nodeVersions.sorted(by: >) {
                let binPath = "\(nvmRoot)/\(version)/bin"
                let codeburnPath = "\(binPath)/codeburn"
                if isExecutableFile(codeburnPath) {
                    entries.append(binPath)
                }
            }
        }

        return entries
    }
}
