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

    private var portalFixTicks = 0

    private func startPortalFixTimer() {
        portalFixTimer?.invalidate()
        portalFixTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.applyPortalFixIfNeeded()
        }
    }

    private func applyPortalFixIfNeeded() {
        portalFixTicks += 1
        if portalFixTicks > 12 {
            portalFixTimer?.invalidate()
            portalFixTimer = nil
            return
        }
        guard let webView = webView, let url = webView.url?.absoluteString else { return }
        guard url.contains("shiftswifthr.co.uk") else { return }
        guard url.contains("admin.html") || url.contains("employee.html") || url.contains("master.html") else { return }
        if portalFixTicks <= 3 {
            webView.evaluateJavaScript(Self.embeddedPortalEndScript, completionHandler: nil)
        }
        if portalFixTicks == 2 {
            webView.evaluateJavaScript(Self.retryOverviewScript, completionHandler: nil)
        }
    }

    /// Patch fetch before production portal scripts run — Capacitor HTTP bypasses WebView CORS.
    /// Binary endpoints (/file, /download) request arraybuffer and decode base64 safely.
    private static let earlyNativeFetchPatch = """
    (function(){
      function wantsBinary(url, headers){
        try{
          var hint="";
          if(headers){
            if(headers.get) hint=headers.get("X-SSHR-Response-Type")||"";
            else if(typeof headers==="object"){
              Object.keys(headers).forEach(function(k){
                if(String(k).toLowerCase()==="x-sshr-response-type") hint=headers[k];
              });
            }
          }
          if(/arraybuffer|blob/i.test(String(hint||""))) return true;
          var path=new URL(String(url), "https://local.invalid").pathname;
          return /\\/(file|download)(\\/|$)/i.test(path);
        }catch(e){
          return /\\/(file|download)(?:\\?|$)/i.test(String(url||""));
        }
      }
      function b64ToBuf(b64){
        var cleaned=String(b64||"").replace(/^data:[^;]+;base64,/i,"").replace(/\\s/g,"");
        var bin=atob(cleaned);
        var bytes=new Uint8Array(bin.length);
        for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        return bytes.buffer;
      }
      function cleanHeaders(headers){
        var out={};
        if(!headers) return out;
        if(headers.forEach){ headers.forEach(function(v,k){ out[k]=v; }); }
        else if(typeof headers==="object"){ Object.assign(out, headers); }
        Object.keys(out).forEach(function(k){
          if(String(k).toLowerCase()==="x-sshr-response-type") delete out[k];
        });
        return out;
      }
      function p(){
        if(window.__SSHR_FETCH_EARLY) return;
        var c=window.Capacitor;
        if(!c||!c.isNativePlatform||!c.isNativePlatform()||!c.nativePromise) return;
        window.__SSHR_FETCH_EARLY=1;
        if(!window.__SSHR_WEB_FETCH__) window.__SSHR_WEB_FETCH__=window.fetch.bind(window);
        var wf=window.__SSHR_WEB_FETCH__;
        window.fetch=function(i,n){
          try{
            var u=typeof i==="string"?i:(i&&i.url?i.url:"");
            if(!u||u.indexOf("api.shiftswifthr.co.uk")===-1) return wf(i,n);
            var m=(n&&n.method)||(i&&i.method)||"GET";
            var h=cleanHeaders(n&&n.headers);
            var d=n&&n.body;
            var binary=wantsBinary(u, n&&n.headers);
            var payload={url:u,method:String(m).toUpperCase(),headers:h,data:d,dataType:"text"};
            if(binary) payload.responseType="arraybuffer";
            return c.nativePromise("CapacitorHttp","request",payload).then(function(r){
              var b=r.data;
              if(r.status===204) b=null;
              else if(binary) b=b64ToBuf(typeof b==="string"?b:(b&&b.data)||"");
              else if(b!=null&&typeof b!=="string") b=JSON.stringify(b);
              return new Response(b,{status:r.status,headers:r.headers||{}});
            }).catch(function(){ return wf(i,n); });
          }catch(e){
            return wf(i,n);
          }
        };
      }
      p();
      var t=setInterval(function(){ p(); if(window.__SSHR_FETCH_EARLY) clearInterval(t); },8);
      setTimeout(function(){ clearInterval(t); },4000);
    })();
    """

    private static let embeddedHideLoaderScript = """
    (function(){try{var p=location.pathname||"";if(!(/admin\\.html$|employee\\.html$|master\\.html$/i.test(p)))return;var id="sshr-portal-hide-loader";if(document.getElementById(id))return;var s=document.createElement("style");s.id=id;s.textContent="#native-startup-loader,.native-startup-loader{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;top:-9999px!important;width:0!important}#portal-pwa-install-banner,.portal-pwa-install-banner,.pwa-ios-sheet,.pwa-ios-sheet-backdrop{display:none!important;visibility:hidden!important;pointer-events:none!important}html.native-startup-active,html.native-startup-active body,body.native-startup-active{overflow:auto!important}";(document.documentElement||document.head).appendChild(s);if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){document.documentElement.classList.add("native-app","capacitor-native");if(document.body)document.body.classList.add("native-app");}var l=document.getElementById("native-startup-loader");if(l)l.remove();document.documentElement.classList.remove("native-startup-active");document.body&&document.body.classList.remove("native-startup-active");}catch(e){}})();
    """

    private static let embeddedPortalEndScript = """
    (function(){try{var p=location.pathname||"";if(!(/admin\\.html$|employee\\.html$|master\\.html$/i.test(p)))return;var cap=window.Capacitor||{};var platform=cap.getPlatform?cap.getPlatform():"";var origin;if(platform==="android"){var as=(cap.config&&cap.config.android&&cap.config.android.scheme)||"https";var host=(cap.config&&cap.config.android&&cap.config.android.hostname)||"localhost";origin=as+"://"+host;}else{origin=((cap.config&&cap.config.ios&&cap.config.ios.scheme)||"App")+"://localhost";}["native-api-fetch.js","session-auth.js","native-portal-fix.js"].forEach(function(file){if(document.querySelector('[data-sshr-ios-fix="'+file+'"]'))return;var s=document.createElement("script");s.src=origin+"/"+file+"?v=29";s.setAttribute("data-sshr-ios-fix",file);document.head.appendChild(s);});}catch(e){}})();
    """

    private static let retryOverviewScript = """
    (function(){try{if(window.__SSHR_OVERVIEW_RETRIED)return;window.__SSHR_OVERVIEW_RETRIED=1;if(!(/admin\\.html$/i.test(location.pathname||"")))return;if(window.ShiftSwiftSession&&window.ShiftSwiftSession.hydrateNativeSession){window.ShiftSwiftSession.hydrateNativeSession({force:true}).finally(function(){window.ShiftSwiftNativeApiFetch&&window.ShiftSwiftNativeApiFetch.boot&&window.ShiftSwiftNativeApiFetch.boot();var section=String(location.hash||"").replace("#","").split("/")[0]||"overview";window.dispatchEvent(new CustomEvent("admin:section",{detail:{section:section}}));if(section==="overview"){var b=document.getElementById("overview-retry-btn");if(b)b.click();}});return;}var section=String(location.hash||"").replace("#","").split("/")[0]||"overview";window.dispatchEvent(new CustomEvent("admin:section",{detail:{section:section}}));}catch(e){}})();
    """
}
