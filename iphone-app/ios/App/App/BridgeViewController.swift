import UIKit
import Capacitor
import WebKit

@objc(BridgeViewController)
class BridgeViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        // Register before Cap's empty default so JSExport runs before loadWebView.
        bridge?.registerPluginInstance(ShiftSwiftHttpPlugin())
    }

    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        webView.scrollView.delaysContentTouches = false
        return webView
    }
}
