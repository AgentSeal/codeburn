import SwiftUI

struct ActivitySection: View {
    @Environment(AppStore.self) private var store
    @State private var isExpanded: Bool = true

    var body: some View {
        CollapsibleSection(
            caption: "Activity",
            isExpanded: $isExpanded,
            trailing: {
                HStack(spacing: 8) {
                    Text(store.headlineMetric.rawValue).frame(minWidth: metricColumnWidth, alignment: .trailing)
                    Text("Turns").frame(minWidth: 52, alignment: .trailing)
                    Text("1-shot").frame(minWidth: 44, alignment: .trailing)
                }
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
                .tracking(-0.05)
            }
        ) {
            VStack(alignment: .leading, spacing: 7) {
                let activities = sortedActivities
                let maxValue = max(activities.map(metricValue).max() ?? 1, 1)
                ForEach(activities, id: \.name) { activity in
                    ActivityRow(
                        activity: activity,
                        metric: store.headlineMetric,
                        metricValue: metricValue(activity),
                        maxValue: maxValue,
                        metricColumnWidth: metricColumnWidth
                    )
                }
            }
        }
    }

    private var metricColumnWidth: CGFloat {
        store.headlineMetric == .tokens ? 62 : 54
    }

    private var sortedActivities: [ActivityEntry] {
        store.payload.current.topActivities.sorted { lhs, rhs in
            let lhsValue = metricValue(lhs)
            let rhsValue = metricValue(rhs)
            if lhsValue == rhsValue { return lhs.name < rhs.name }
            return lhsValue > rhsValue
        }
    }

    private func metricValue(_ activity: ActivityEntry) -> Double {
        switch store.headlineMetric {
        case .cost: return activity.cost
        case .tokens: return Double(activity.totalTokens)
        }
    }
}

struct ActivityRow: View {
    let activity: ActivityEntry
    let metric: HeadlineMetric
    let metricValue: Double
    let maxValue: Double
    let metricColumnWidth: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            FixedBar(fraction: metricValue / maxValue)
                .frame(width: 56, height: 6)

            Text(activity.name)
                .font(.system(size: 12.5, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(primaryText)
                .font(.codeMono(size: 12, weight: .medium))
                .tracking(-0.2)
                .frame(minWidth: metricColumnWidth, alignment: .trailing)

            Text("\(activity.turns)")
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(minWidth: 52, alignment: .trailing)

            Text(oneShotText)
                .font(.system(size: 10.5))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(minWidth: 44, alignment: .trailing)
        }
        .padding(.horizontal, 2)
        .padding(.vertical, 1)
    }

    private var oneShotText: String {
        guard let rate = activity.oneShotRate else { return "—" }
        return "\(Int(rate * 100))%"
    }

    private var primaryText: String {
        switch metric {
        case .cost: return activity.cost.asCompactCurrency()
        case .tokens: return activity.totalTokens.asCompactTokens()
        }
    }
}

/// Fixed-width horizontal bar that shows a fill fraction.
struct FixedBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(.secondary.opacity(0.15))
                RoundedRectangle(cornerRadius: 2)
                    .fill(Theme.brandAccent)
                    .frame(width: max(0, min(geo.size.width, geo.size.width * CGFloat(fraction))))
            }
        }
    }
}
