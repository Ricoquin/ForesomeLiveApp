import Foundation
import CoreLocation

/// Course data bundled with the app (watch/shared/courses.json), so the watch works with no signal.
struct Course: Codable, Identifiable, Hashable {
    let name: String
    let pars: [Int]
    let yards: [Int]
    let greens: [[Double]]          // [lat, lng] of each green's center
    var id: String { name }

    func green(_ hole: Int) -> CLLocation? {
        guard hole >= 1, hole <= greens.count else { return nil }
        let g = greens[hole - 1]
        return CLLocation(latitude: g[0], longitude: g[1])
    }

    /// Rough middle of the course, used to sort courses by distance.
    var middle: CLLocation {
        let lat = greens.map { $0[0] }.reduce(0, +) / Double(greens.count)
        let lng = greens.map { $0[1] }.reduce(0, +) / Double(greens.count)
        return CLLocation(latitude: lat, longitude: lng)
    }

    static let all: [Course] = {
        guard let url = Bundle.main.url(forResource: "courses", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Course].self, from: data) else { return [] }
        return list
    }()
}

extension CLLocation {
    func yards(to other: CLLocation) -> Int { Int((distance(from: other) * 1.09361).rounded()) }
}
