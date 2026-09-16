import UIKit
import Capacitor
import WebKit

@objc(BridgeViewController)
class BridgeViewController: CAPBridgeViewController {

    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        webView.scrollView.delaysContentTouches = false
        return webView
    }
}
