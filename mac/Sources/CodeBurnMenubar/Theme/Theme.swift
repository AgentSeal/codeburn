import SwiftUI

/// Design tokens. Accent colors are driven by ThemeState so the user can switch palettes.
@MainActor
enum Theme {
    static let brandEmber        = Color(red: 0xC9/255.0, green: 0x52/255.0, blue: 0x1D/255.0)

    static var brandAccent: Color { ThemeState.shared.preset.base }
    static var brandAccentLight: Color { ThemeState.shared.preset.light }
    static var brandAccentDeep: Color { ThemeState.shared.preset.deep }
    static var brandAccentGlow: Color { ThemeState.shared.preset.glow }

    static let warmSurface       = Color(red: 0xFA/255.0, green: 0xF7/255.0, blue: 0xF3/255.0)
    static let warmSurfaceDark   = Color(red: 0x1C/255.0, green: 0x18/255.0, blue: 0x16/255.0)

    static let categoricalClaude = Color(red: 0xC9/255.0, green: 0x52/255.0, blue: 0x1D/255.0)
    static let categoricalCursor = Color(red: 0x3F/255.0, green: 0x6B/255.0, blue: 0x8C/255.0)
    static let categoricalCodex  = Color(red: 0x4A/255.0, green: 0x7D/255.0, blue: 0x5C/255.0)

    static let oneShotGood  = Color(red: 0x30/255.0, green: 0xD1/255.0, blue: 0x58/255.0)
    static let oneShotMid   = Color(red: 0xFF/255.0, green: 0x9F/255.0, blue: 0x0A/255.0)
    static let oneShotLow   = Color(red: 0xFF/255.0, green: 0x45/255.0, blue: 0x3A/255.0)

    // Semantic colors -- tuned to sit alongside the terracotta accent without clashing.
    static let semanticDanger  = Color(red: 0xC8/255.0, green: 0x3F/255.0, blue: 0x2C/255.0) // brick-red, terracotta-leaning
    static let semanticWarning = Color(red: 0xD9/255.0, green: 0x8F/255.0, blue: 0x29/255.0) // amber, warmer than vanilla
    static let semanticSuccess = Color(red: 0x4E/255.0, green: 0xA8/255.0, blue: 0x65/255.0) // muted green that holds against terracotta
}

extension Font {
    /// SF Mono for currency values -- developer-tool identity.
    static func codeMono(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
