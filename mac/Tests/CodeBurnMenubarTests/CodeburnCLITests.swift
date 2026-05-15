import Testing
@testable import CodeBurnMenubar

@Suite("CodeburnCLI PATH handling")
struct CodeburnCLITests {
    @Test("discovers static user bins and executable nvm bins")
    func discoversExpectedUserPathEntries() {
        let home = "/Users/tester"
        let existingDirs: Set<String> = [
            "\(home)/.volta/bin",
            "\(home)/.asdf/shims",
        ]
        let executableFiles: Set<String> = [
            "\(home)/.nvm/versions/node/v22.3.1/bin/codeburn",
        ]

        let entries = CodeburnCLI.discoverUserPathEntries(
            homeDirectory: home,
            fileExists: { existingDirs.contains($0) },
            isExecutableFile: { executableFiles.contains($0) },
            contentsOfDirectory: { path in
                guard path == "\(home)/.nvm/versions/node" else { return nil }
                return ["v20.10.0", "v22.3.1"]
            }
        )

        #expect(entries == [
            "\(home)/.volta/bin",
            "\(home)/.asdf/shims",
            "\(home)/.nvm/versions/node/v22.3.1/bin",
        ])
    }

    @Test("augmented path appends missing entries once")
    func augmentedPathAppendsWithoutDuplicates() {
        let augmented = CodeburnCLI.augmentedPath(
            existing: "/usr/bin:/opt/homebrew/bin:/custom/bin",
            discoveredUserPathEntries: ["/custom/bin", "/Users/tester/.volta/bin"]
        )

        #expect(augmented == "/usr/bin:/opt/homebrew/bin:/custom/bin:/usr/local/bin:/Users/tester/.volta/bin")
    }
}
