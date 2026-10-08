import Foundation
import Capacitor
import WidgetKit

/// The app's side of the home-screen widgets (src/data/widgets.ts). The web view hands over
/// what the widgets show as JSON; it goes into the App Group the widget extension reads
/// (ios/App/TermWidget), and iOS is asked to redraw them.
@objc(TermWidgetsPlugin)
public class TermWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TermWidgetsPlugin"
    public let jsName = "TermWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    /// Shared with the widget extension; both targets list it under App Groups.
    static let group = "group.net.vogas.term"
    static let key = "widget"

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("data"), json.utf8.count < 64_000 else {
            call.reject("No widget data")
            return
        }
        guard let shared = UserDefaults(suiteName: Self.group) else {
            call.reject("The App Group \(Self.group) is not set up")
            return
        }
        shared.set(json, forKey: Self.key)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /// Signed out: the widgets show nothing of the account.
    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults(suiteName: Self.group)?.removeObject(forKey: Self.key)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
