import SwiftUI

struct HeroSection: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionCaption(text: caption)

            HStack(alignment: .firstTextBaseline) {
                Text(primaryValue)
                    .font(.system(size: 32, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .tracking(-1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Theme.brandAccent, Theme.brandAccentDeep],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(store.payload.current.calls.asThousandsSeparated()) calls")
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    Text("\(store.payload.current.sessions) sessions")
                        .font(.system(size: 10.5))
                        .monospacedDigit()
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 12)
    }

    private var caption: String {
        let label = store.payload.current.label.isEmpty ? store.selectedPeriod.rawValue : store.payload.current.label
        let metricLabel = store.headlineMetric == .tokens ? "\(label) tokens" : label
        if store.selectedPeriod == .today {
            return "\(metricLabel) · \(todayDate)"
        }
        return metricLabel
    }

    private var primaryValue: String {
        switch store.headlineMetric {
        case .cost:
            return store.payload.current.cost.asCurrency()
        case .tokens:
            return "\(store.payload.current.totalTokens.asCompactTokens()) tokens"
        }
    }

    private var todayDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE MMM d"
        return formatter.string(from: Date())
    }
}
