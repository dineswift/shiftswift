import Foundation
import Capacitor

/// Direct URLSession API transport — bypasses CapacitorHttp URL encoding bugs.
@objc(ShiftSwiftHttpPlugin)
public class ShiftSwiftHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShiftSwiftHttpPlugin"
    public let jsName = "ShiftSwiftHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), !urlString.isEmpty else {
            call.reject("Invalid URL")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        var request: URLRequest
        if let components = URLComponents(string: urlString), let composed = components.url {
            request = URLRequest(url: composed)
        } else if let url = URL(string: urlString) {
            request = URLRequest(url: url)
        } else {
            call.reject("Invalid URL: \(urlString)")
            return
        }
        request.httpMethod = method

        let connectTimeoutMs = call.getDouble("connectTimeout") ?? 15000
        let readTimeoutMs = call.getDouble("readTimeout") ?? 30000
        request.timeoutInterval = max(connectTimeoutMs, readTimeoutMs) / 1000.0

        if let headers = call.getObject("headers") {
            for (key, value) in headers {
                if value is NSNull { continue }
                let headerKey = String(key)
                // Skip hop-by-hop / auto headers that can break URLSession
                let lowered = headerKey.lowercased()
                if lowered == "host" || lowered == "content-length" || lowered == "connection" {
                    continue
                }
                if let text = value as? String, !text.isEmpty {
                    request.setValue(text, forHTTPHeaderField: headerKey)
                } else if let number = value as? NSNumber {
                    request.setValue(number.stringValue, forHTTPHeaderField: headerKey)
                }
            }
        }

        if method != "GET" && method != "HEAD" {
            if let body = call.getString("data"), !body.isEmpty {
                request.httpBody = body.data(using: .utf8)
            } else if let dataObj = call.getObject("data") {
                if let json = try? JSONSerialization.data(withJSONObject: dataObj, options: []) {
                    request.httpBody = json
                    if request.value(forHTTPHeaderField: "Content-Type") == nil {
                        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    }
                }
            }
        }

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    let ns = error as NSError
                    call.reject(
                        "\(error.localizedDescription) (code \(ns.code)) \(urlString)",
                        ns.domain,
                        error,
                        nil
                    )
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    call.reject("Invalid HTTP response for \(urlString)")
                    return
                }

                var headers: [String: String] = [:]
                for (key, value) in http.allHeaderFields {
                    headers[String(describing: key).lowercased()] = String(describing: value)
                }

                let bodyText: String
                if let data = data, !data.isEmpty {
                    bodyText = String(data: data, encoding: .utf8) ?? ""
                } else {
                    bodyText = ""
                }

                call.resolve([
                    "status": http.statusCode,
                    "url": http.url?.absoluteString ?? urlString,
                    "headers": headers,
                    "data": bodyText
                ])
            }
        }
        task.resume()
    }
}
