import UIKit

// UIKit actions and accessibility need UIApplicationMain, which SwiftPM's
// unhosted iOS test runner does not execute. Keep this app limited to testing.
@main
final class TestHostApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIViewController()
        window.rootViewController?.view.backgroundColor = .systemBackground
        self.window = window
        window.makeKeyAndVisible()
        return true
    }
}
