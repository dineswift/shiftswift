#!/usr/bin/env node
/** Build bundled Capacitor employee.html — same origin as login, no production hijacks. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const src = path.join(repoRoot, "frontend", "employee.html");
const dest = path.join(root, "www", "app", "employee.html");

const raw = fs.readFileSync(src, "utf8");

const shellStart = raw.indexOf('<div id="sidebar-overlay"');
const scriptsMarker = raw.indexOf('<script src="./portal-pwa-stability.js');
if (shellStart === -1 || scriptsMarker === -1) {
  console.error("employee.html structure changed — update sync-employee-html.mjs");
  process.exit(1);
}

const shellEnd = raw.lastIndexOf("</dialog>", scriptsMarker);
const shell = raw.slice(shellStart, shellEnd + "</dialog>".length);

const hydrateMatch = raw.match(/<script>\s*\(function hydrateEmployeeChrome\(\)[\s\S]*?<\/script>/);
const hydrateScript = hydrateMatch ? hydrateMatch[0] : "";
void hydrateScript;

const sessionBridgeScript = `<script>
(function(){try{var p=new URLSearchParams(location.search);var h=p.get("sshr_handoff");if(h){var d=JSON.parse(atob(h.replace(/-/g,"+").replace(/_/g,"/")));if(d&&d.ts&&Date.now()-d.ts<12e4){["token","refreshToken","tenantId","userRole","masterTenantId"].forEach(function(k){if(d[k])localStorage.setItem(k,d[k]);});window.__SSHR_HANDOFF_CONSUMED=1;p.delete("sshr_handoff");var q=p.toString();history.replaceState(null,"",location.pathname+(q?"?"+q:"")+location.hash);return;}}var r=sessionStorage.getItem("sshrNativeSessionBridge");if(!r)return;var d=JSON.parse(r);if(!d||!d.ts||Date.now()-d.ts>12e4)return;["token","refreshToken","tenantId","userRole","masterTenantId"].forEach(function(k){if(d[k])localStorage.setItem(k,d[k]);});sessionStorage.removeItem("sshrNativeSessionBridge");}catch(e){}})();
</script>`;

const html = `<!doctype html>
<html lang="en" data-app-icon="employee" data-pwa-portal="employee">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f6e56" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Employee" />
    <meta name="description" content="View payslips, documents, shifts, and clock in from your phone." />
    <title>ShiftSwift HR | Employee Portal</title>
    ${sessionBridgeScript}
    <link rel="stylesheet" href="./theme.css?v=bundled" />
    <link rel="stylesheet" href="./native-app-chrome.css?v=bundled" />
    <link rel="stylesheet" href="./styles.css?v=bundled" />
    <link rel="stylesheet" href="./employee-mobile-polish.css?v=bundled" />
    <script src="./native-bundled-url.js?v=bundled"></script>
    <script src="./native-api-fetch.js?v=bundled"></script>
    <script src="./session-auth.js?v=bundled"></script>
    <script src="./native-app.js?v=bundled"></script>
    <script src="./brand-config.js?v=bundled"></script>
    <script src="./app-icons.js?v=bundled"></script>
    <script src="./native-employee-boot.js?v=bundled"></script>
  </head>
  <body class="employee-portal native-app capacitor-native portal-startup-ready">
    ${shell}
  </body>
</html>
`;

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, html);
console.log(`wrote ${path.relative(root, dest)}`);
