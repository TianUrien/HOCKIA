import UIKit
import Capacitor

/// UIScene lifecycle (required by the iOS 27 SDK: an app built with Xcode 27
/// that still runs on the app-delegate-only lifecycle is refused at launch
/// with "UIScene lifecycle adoption" — App Review rejection of 1.3.19 (31),
/// 2026-10-15). The scene's window and the Main storyboard (MainViewController)
/// come from the UIApplicationSceneManifest in Info.plist; this delegate only
/// forwards the scene events Capacitor cares about — custom-scheme URLs
/// (hockia://) and universal links — to Capacitor's SceneDelegateProxy, which
/// turns them into the same appUrlOpen events the AppDelegate path produced.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
