import Foundation
import XCTest
@testable import CodeBurnMenubar

final class MenubarPayloadDecodingTests: XCTestCase {
    func testDecodesLegacyTokenlessActivityPayload() throws {
        let json = """
        {
          "generated": "2026-05-11T12:00:00.000Z",
          "current": {
            "label": "Today",
            "cost": 12.5,
            "calls": 4,
            "sessions": 2,
            "oneShotRate": 0.75,
            "inputTokens": 100,
            "outputTokens": 200,
            "cacheHitPercent": 0,
            "topActivities": [
              {
                "name": "Coding",
                "cost": 12.5,
                "turns": 3,
                "oneShotRate": 0.75
              }
            ],
            "topModels": [],
            "providers": { "claude": 12.5 }
          },
          "optimize": {
            "findingCount": 0,
            "savingsUSD": 0,
            "topFindings": []
          },
          "history": { "daily": [] }
        }
        """

        let payload = try JSONDecoder().decode(MenubarPayload.self, from: Data(json.utf8))
        XCTAssertEqual(payload.current.cacheReadTokens, 0)
        XCTAssertEqual(payload.current.cacheWriteTokens, 0)
        XCTAssertEqual(payload.current.totalTokens, 300)

        let activity = try XCTUnwrap(payload.current.topActivities.first)
        XCTAssertEqual(activity.cacheReadTokens, 0)
        XCTAssertEqual(activity.cacheWriteTokens, 0)
        XCTAssertEqual(activity.totalTokens, 0)
    }
}
