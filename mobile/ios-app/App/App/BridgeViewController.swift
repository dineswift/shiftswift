import UIKit
import Capacitor
import WebKit

@objc(BridgeViewController)
class BridgeViewController: CAPBridgeViewController {

    private static var portalScriptsInstalled = false
    private var portalFixTimer: Timer?

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        installPortalUserScripts()
        startPortalFixTimer()
    }

    deinit {
        portalFixTimer?.invalidate()
    }

    private func installPortalUserScripts() {
        guard !Self.portalScriptsInstalled else { return }
        guard let controller = webView?.configuration.userContentController else { return }
        Self.portalScriptsInstalled = true

        controller.addUserScript(
            WKUserScript(source: Self.earlyNativeFetchPatch, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        controller.addUserScript(
            WKUserScript(source: Self.embeddedHideLoaderScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        controller.addUserScript(
            WKUserScript(source: Self.embeddedPortalEndScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
    }

    private func startPortalFixTimer() {
        portalFixTimer?.invalidate()
        portalFixTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.applyPortalFixIfNeeded()
        }
    }

    private func applyPortalFixIfNeeded() {
        guard let webView = webView, let url = webView.url?.absoluteString else { return }
        guard url.contains("shiftswifthr.co.uk") else { return }
        guard url.contains("admin.html") || url.contains("employee.html") || url.contains("master.html") else { return }
        webView.evaluateJavaScript(Self.embeddedPortalEndScript, completionHandler: nil)
        webView.evaluateJavaScript(Self.retryOverviewScript, completionHandler: nil)
    }

    /// Patch fetch before production portal scripts run — Capacitor HTTP bypasses WebView CORS.
    private static let earlyNativeFetchPatch = """
    (function(){function p(){if(window.__SSHR_FETCH_EARLY)return;var c=window.Capacitor;if(!c||!c.isNativePlatform||!c.isNativePlatform()||!c.nativePromise)return;window.__SSHR_FETCH_EARLY=1;if(!window.__SSHR_WEB_FETCH__)window.__SSHR_WEB_FETCH__=window.fetch.bind(window);var wf=window.__SSHR_WEB_FETCH__;window.fetch=function(i,n){try{var u=typeof i==='string'?i:(i&&i.url?i.url:'');if(!u||u.indexOf('api.shiftswifthr.co.uk')===-1)return wf(i,n);var m=(n&&n.method)||(i&&i.method)||'GET';var h={};if(n&&n.headers){if(n.headers.forEach)n.headers.forEach(function(v,k){h[k]=v;});else if(typeof n.headers==='object')Object.assign(h,n.headers);}var d=n&&n.body;return c.nativePromise('CapacitorHttp','request',{url:u,method:String(m).toUpperCase(),headers:h,data:d,dataType:'text'}).then(function(r){var b=r.data;if(r.status===204)b=null;else if(b!=null&&typeof b!=='string')b=JSON.stringify(b);return new Response(b,{status:r.status,headers:r.headers||{}});}).catch(function(){return wf(i,n);});}catch(e){return wf(i,n);}};}p();var t=setInterval(function(){p();if(window.__SSHR_FETCH_EARLY)clearInterval(t);},8);setTimeout(function(){clearInterval(t);},4000);})();
    """

    private static let embeddedHideLoaderScript = """
    (function(){try{var p=location.pathname||"";if(!(/admin\\.html$|employee\\.html$|master\\.html$/i.test(p)))return;var id="sshr-portal-hide-loader";if(document.getElementById(id))return;var s=document.createElement("style");s.id=id;s.textContent="#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important}html.native-startup-active,html.native-startup-active body,body.native-startup-active{overflow:auto!important}";(document.documentElement||document.head).appendChild(s);var l=document.getElementById("native-startup-loader");if(l)l.remove();document.documentElement.classList.remove("native-startup-active");document.body&&document.body.classList.remove("native-startup-active");}catch(e){}})();
    """

    private static let embeddedPortalEndScript = """
    (function(){try{var p=location.pathname||"";if(!(/admin\\.html$|employee\\.html$|master\\.html$/i.test(p)))return;var scheme=(window.Capacitor&&window.Capacitor.config&&window.Capacitor.config.ios&&window.Capacitor.config.ios.scheme)||"App";["native-api-fetch.js","session-auth.js","native-portal-fix.js"].forEach(function(file){if(document.querySelector('[data-sshr-ios-fix="'+file+'"]'))return;var s=document.createElement("script");s.src=scheme+"://localhost/"+file+"?v=20";s.setAttribute("data-sshr-ios-fix",file);document.head.appendChild(s);});}catch(e){}})();
    """

    private static let retryOverviewScript = """
    (function(){try{if(!(/admin\\.html$/i.test(location.pathname||"")))return;if(window.ShiftSwiftSession&&window.ShiftSwiftSession.hydrateNativeSession){window.ShiftSwiftSession.hydrateNativeSession({force:true}).finally(function(){window.ShiftSwiftNativeApiFetch&&window.ShiftSwiftNativeApiFetch.boot&&window.ShiftSwiftNativeApiFetch.boot();window.dispatchEvent(new CustomEvent("admin:section",{detail:{section:"overview"}}));var b=document.getElementById("overview-retry-btn");if(b)b.click();});return;}window.dispatchEvent(new CustomEvent("admin:section",{detail:{section:"overview"}}));}catch(e){}})();
    """
}
