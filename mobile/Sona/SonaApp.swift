import SwiftUI

@main
struct SonaApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RecordingScreen(model: model, recorder: model.recorder)
        }
    }
}
