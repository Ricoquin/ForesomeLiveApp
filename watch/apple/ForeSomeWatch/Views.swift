import SwiftUI
import CoreLocation

struct CourseListView: View {
    @EnvironmentObject var gps: LocationModel

    var sorted: [Course] {
        guard let here = gps.location else { return Course.all }
        return Course.all.sorted { here.distance(from: $0.middle) < here.distance(from: $1.middle) }
    }

    var body: some View {
        List {
            if gps.denied {
                Text("Allow location in Settings to see distances.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(sorted) { course in
                NavigationLink(value: course) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(course.name).font(.headline).lineLimit(2)
                        if let here = gps.location {
                            Text(miles(here.distance(from: course.middle))).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("ForeSome")
        .navigationDestination(for: Course.self) { HoleView(course: $0) }
        .onAppear { gps.start() }
    }

    private func miles(_ meters: CLLocationDistance) -> String {
        let mi = meters / 1609.34
        return mi < 0.5 ? "You're here" : String(format: "%.1f mi away", mi)
    }
}

struct HoleView: View {
    let course: Course
    @EnvironmentObject var gps: LocationModel
    @State private var crown: Double = 1
    private var hole: Int { min(max(Int(crown.rounded()), 1), course.pars.count) }

    private var center: Int? {
        guard let here = gps.location, let green = course.green(hole) else { return nil }
        return here.yards(to: green)
    }

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text("Hole \(hole)").font(.headline)
                Spacer()
                Text("Par \(course.pars[hole - 1])").font(.headline).foregroundStyle(Brand.gold)
            }
            Spacer(minLength: 0)
            if let c = center {
                Text("\(c)")
                    .font(.system(size: 64, weight: .semibold, design: .serif))
                    .minimumScaleFactor(0.5)
                    .contentTransition(.numericText())
                Text("yards to middle").font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 14) {
                    Label("\(max(0, c - 6))", systemImage: "arrow.down").font(.footnote)
                    Label("\(c + 6)", systemImage: "arrow.up").font(.footnote)
                }
                .foregroundStyle(.secondary)
            } else {
                ProgressView()
                Text(gps.denied ? "Location is off" : "Finding GPS…").font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            HStack {
                Button { crown = Double(max(1, hole - 1)) } label: { Image(systemName: "chevron.left") }
                    .disabled(hole == 1)
                Button { crown = Double(min(course.pars.count, hole + 1)) } label: { Image(systemName: "chevron.right") }
                    .disabled(hole == course.pars.count)
            }
        }
        .padding(.horizontal, 4)
        .focusable()
        .digitalCrownRotation($crown, from: 1, through: Double(course.pars.count), by: 1,
                              sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .navigationTitle(course.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { gps.start() }
    }
}
