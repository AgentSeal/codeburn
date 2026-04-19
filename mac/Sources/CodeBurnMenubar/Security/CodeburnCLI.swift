import Darwin
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
    ///
    /// Cellar entries: Homebrew installs the real binary under `Cellar/<formula>/<version>/bin`
    /// and symlinks it into `bin/`. `realpath` resolves through the symlink, so without the
    /// Cellar prefix a user pointing CODEBURN_BIN at a Homebrew-managed node would be rejected
    /// after the round-2 realpath hardening. The Cellar roots are Homebrew-controlled and only
    /// contain Homebrew-managed binaries, so allow-listing them does not weaken the security
    /// boundary.
    private static let allowedBinaryPrefixes: [String] = {
        let home = NSHomeDirectory()
        return [
            "/usr/local/bin/",
            "/usr/local/lib/node_modules/",
            "/usr/local/Cellar/",
            "/opt/homebrew/bin/",
            "/opt/homebrew/lib/node_modules/",
            "/opt/homebrew/Cellar/",
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
    /// `allowedBinaryPrefixes` AFTER symlinks are resolved. Without realpath() the prefix check
    /// is bypassable: an attacker who can write `/usr/local/bin/codeburn -> /tmp/evil` would
    /// pass the textual prefix check but execve() would still run `/tmp/evil`.
    /// `realpath` requires the path to exist; non-existent paths are rejected, which matches
    /// the security stance (CODEBURN_BIN must point at a real binary in an allow-listed prefix).
    static func isAllowedProgramPath(_ path: String) -> Bool {
        guard path.hasPrefix("/") else { return false }
        let normalized = (path as NSString).standardizingPath
        if normalized.contains("/../") || normalized.hasSuffix("/..") { return false }
        var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard realpath(normalized, &buffer) != nil else { return false }
        let resolved = String(cString: buffer)
        return allowedBinaryPrefixes.contains { resolved.hasPrefix($0) }
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
