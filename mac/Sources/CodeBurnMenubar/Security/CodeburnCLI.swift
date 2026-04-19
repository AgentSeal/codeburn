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

    /// Absolute-path prefixes from which `CODEBURN_BIN` may resolve a binary. Anything outside
    /// this list (e.g. `/tmp`, `/Volumes/...`, `~/Downloads`) is refused so a planted binary
    /// can't be selected just by exporting an env var. Includes Homebrew, system bin dirs, and
    /// the user's Node-toolchain prefixes.
    private static let allowedBinaryPrefixes: [String] = {
        let home = NSHomeDirectory()
        return [
            "/usr/local/bin/",
            "/usr/local/lib/node_modules/",
            "/opt/homebrew/bin/",
            "/opt/homebrew/lib/node_modules/",
            "/usr/bin/",
            "\(home)/.npm-global/bin/",
            "\(home)/.npm/bin/",
            "\(home)/.nvm/",
            "\(home)/.volta/bin/",
            "\(home)/.fnm/",
            "\(home)/.asdf/shims/",
            "\(home)/Library/pnpm/",
            "\(home)/.bun/bin/",
        ]
    }()

    /// Returns the argv that launches the CLI. Dev override via `CODEBURN_BIN` is honoured only
    /// when every whitespace-delimited token passes `safeArgPattern` AND the program name (first
    /// token) is an absolute path under `allowedBinaryPrefixes`. Otherwise falls back to the
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
        guard let program = parts.first, isAllowedProgramPath(program) else {
            NSLog("CodeBurn: refusing CODEBURN_BIN whose program path is not under an allowed prefix; using default 'codeburn'")
            return ["codeburn"]
        }
        return parts
    }

    /// True only when `path` is absolute, free of `..` traversal, and lives under one of the
    /// `allowedBinaryPrefixes`. Symlinks are left to resolve at exec time -- the prefix check
    /// is the user-controlled boundary.
    static func isAllowedProgramPath(_ path: String) -> Bool {
        guard path.hasPrefix("/") else { return false }
        let normalized = (path as NSString).standardizingPath
        if normalized.contains("/../") || normalized.hasSuffix("/..") { return false }
        return allowedBinaryPrefixes.contains { normalized.hasPrefix($0) }
    }

    /// Builds a `Process` that runs the CLI with the given subcommand args. Uses `/usr/bin/env`
    /// so PATH lookup happens without involving a shell, and augments PATH with Homebrew
    /// defaults. Caller sets stdout/stderr pipes and calls `run()`.
    static func makeProcess(subcommand: [String]) -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = augmentedPath(environment["PATH"] ?? "")
        process.environment = environment
        // `env --` treats everything following as argv, not VAR=val pairs -- guards against an
        // argument accidentally resembling an env assignment.
        process.arguments = ["--"] + baseArgv() + subcommand
        return process
    }

    static func isSafe(_ s: String) -> Bool {
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return safeArgPattern.firstMatch(in: s, range: range) != nil
    }

    private static func augmentedPath(_ existing: String) -> String {
        var parts = existing.split(separator: ":", omittingEmptySubsequences: true).map(String.init)
        for extra in additionalPathEntries where !parts.contains(extra) {
            parts.append(extra)
        }
        return parts.joined(separator: ":")
    }
}
