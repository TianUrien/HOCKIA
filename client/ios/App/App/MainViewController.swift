import UIKit
import Capacitor

/// Bridge view controller for HOCKIA (Main.storyboard). Registers the app's
/// own plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppSurfacePlugin())
    }
}

/// The colour iOS paints under and around the web page. capacitor.config.ts
/// starts it violet (#7b39ec) so the hand-off from the launch artwork never
/// flashes white. Once the native splash is gone the web app asks for white
/// (src/lib/launchSplash.ts): with contentInset 'automatic' the WKWebView's
/// layout viewport is a little shorter than the screen (862 pt on an 874 pt
/// iPhone 17, measured 2026-10-10), so a page that exactly fits would
/// otherwise show a violet strip along the bottom edge.
@objc(AppSurfacePlugin)
public class AppSurfacePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppSurfacePlugin"
    public let jsName = "AppSurface"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "applyLightSurface", returnType: CAPPluginReturnPromise)
    ]

    @objc func applyLightSurface(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.resolve()
                return
            }
            webView.backgroundColor = .white
            webView.scrollView.backgroundColor = .white
            if #available(iOS 15.0, *) {
                webView.underPageBackgroundColor = .white
            }
            call.resolve()
        }
    }
}
