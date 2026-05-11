import Testing
@testable import CodeBurnMenubar

@Suite("AppVersion")
struct AppVersionTests {
    @Test("display avoids duplicate v prefix")
    func displayAvoidsDuplicatePrefix() {
        #expect(AppVersion.display("0.9.8") == "v0.9.8")
        #expect(AppVersion.display("v0.9.8") == "v0.9.8")
        #expect(AppVersion.display("mac-v0.9.8") == "v0.9.8")
    }

    @Test("bundle metadata stores unprefixed semver")
    func normalizeBundleVersion() {
        #expect(AppVersion.normalize("v0.9.8") == "0.9.8")
        #expect(AppVersion.normalize("mac-v0.9.8") == "0.9.8")
        #expect(AppVersion.normalize("dev") == "dev")
    }
}
