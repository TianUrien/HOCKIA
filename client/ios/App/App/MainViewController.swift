import UIKit
import Capacitor

/// Bridge view controller for HOCKIA (Main.storyboard). Registers the app's
/// own plugins.
class MainViewController: CAPBridgeViewController {
    /// Tablets get the phone layout (founder ruling 2026-10-16): the WebView
    /// is held to a phone-like width and centred, the rest of the screen is
    /// painted white. The web app then measures innerWidth 640 and never
    /// switches to its desktop (lg) layout. Phones are untouched. Frame-based
    /// on purpose: nothing native resizes the WebView (no keyboard plugin).
    private static let tabletContentWidth: CGFloat = 640
    private var letterboxed = false

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppSurfacePlugin())
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        guard traitCollection.userInterfaceIdiom == .pad, let webView = webView else { return }
        let container = UIView(frame: webView.frame)
        container.backgroundColor = .white
        container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.autoresizingMask = []
        view = container
        container.addSubview(webView)
        letterboxed = true
    }

    override open func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard letterboxed, let webView = webView else { return }
        let bounds = view.bounds
        let width = min(Self.tabletContentWidth, bounds.width)
        webView.frame = CGRect(x: ((bounds.width - width) / 2).rounded(), y: 0, width: width, height: bounds.height)
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
