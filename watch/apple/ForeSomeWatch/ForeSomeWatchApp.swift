import SwiftUI

@main
struct ForeSomeWatchApp: App {
    @StateObject private var location = LocationModel()
    var body: some Scene {
        WindowGroup {
            NavigationStack { CourseListView() }
                .environmentObject(location)
                .tint(Brand.gold)
        }
    }
}

enum Brand {
    static let gold = Color(red: 0.72, green: 0.60, blue: 0.36)
    static let cream = Color(red: 0.95, green: 0.92, blue: 0.85)
    static let forest = Color(red: 0.10, green: 0.17, blue: 0.13)
}
