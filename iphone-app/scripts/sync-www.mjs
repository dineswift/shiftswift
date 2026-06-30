#!/usr/bin/env node
/** ShiftSwift HR iPhone app — copy frontend assets into bundled www/. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const frontend = path.join(repoRoot, "frontend");
const www = path.join(root, "www");

const jsAndCss = [
  "brand-config.js",
  "trusted-device.js",
  "session-auth.js",
  "native-app.js",
  "native-app-chrome.css",
  "native-unified-login-redirect.js",
  "login.js",
  "native-app-login.css",
  "native-app-startup.css",
  "native-app-startup.js",
  "native-bundled-url.js",
  "native-api-fetch.js",
  "unified-login.js",
  "action-feedback.js",
  "native-app-portal-guard.js",
  "native-app-bootstrap.js",
  "native-geolocation.js",
  "native-shift-alerts.js",
  "employee-mobile-polish.css",
  "employee-mobile.js",
  "admin-mobile.js",
  "mobile-shell.js",
  "employee-push-alerts.js",
  "push-notifications.js",
  "employee.js",
  "app-icons.js",
  "portal-pwa-stability.js",
  "employee-pwa.js",
  "mobile-tables.js",
  "admin-icons.js",
  "employee-time-punch.js",
  "employee-timesheet.js",
  "employee-rota.js",
  "employee-shift-reminders.js",
  "employee-documents.js",
  "employee-notes.js",
  "employee-security.js",
  "employee-leave.js",
  "employee-my-details.js",
  "styles.css",
  "theme.css",
  "admin-mobile-polish.css",
];

const adminBundle = [
  "app-host-guard.js",
  "pwa-ios.js",
  "admin-impersonation.js",
  "admin-pwa.js",
  "admin-compliance-mobile.js",
  "admin-shared.js",
  "admin-settings.js",
  "admin-workspace.js",
  "admin-address-picker.js",
  "admin-documents.js",
  "admin-employees.js",
  "admin-recruitment.js",
  "admin-promotions.js",
  "admin-crm.js",
  "admin-compliance.js",
  "admin-absence.js",
  "admin-rtw.js",
  "admin-grievance.js",
  "admin-disciplinary.js",
  "admin-offboarding.js",
  "admin-templates.js",
  "admin-global-documents.js",
  "admin-time-punch.js",
  "admin-rota.js",
  "admin-leave.js",
  "admin-profile-changes.js",
  "app.js",
  "contracts.js",
  "employment-contracts.js",
  "cookie-consent.js",
];

const assets = [
  "assets/shiftswift-employee-app-icon-192.png",
  "assets/shiftswift-hr-app-icon-192.png",
];

fs.mkdirSync(www, { recursive: true });

for (const file of jsAndCss) {
  fs.copyFileSync(path.join(frontend, file), path.join(www, file));
  console.log(`copied www/${file}`);
}

let themeCss = fs.readFileSync(path.join(www, "theme.css"), "utf8");
themeCss = themeCss.replace(
  /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com[^'"]+['"]\)\s*;?/gi,
  "",
);
themeCss = themeCss.replace(
  /--font-body:\s*"Manrope"[^;]+;/,
  '--font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;',
);
themeCss = themeCss.replace(
  /--font-heading:\s*"Sora"[^;]+;/,
  '--font-heading: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;',
);
themeCss = themeCss.replace(
  /--font-ui:\s*"Manrope"[^;]+;/,
  '--font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;',
);
fs.writeFileSync(path.join(www, "theme.css"), themeCss);
console.log("patched www/theme.css for native (no Google Fonts)");

for (const file of adminBundle) {
  const src = path.join(frontend, file);
  if (!fs.existsSync(src)) {
    console.warn(`skip missing admin bundle file: ${file}`);
    continue;
  }
  fs.copyFileSync(src, path.join(www, file));
  console.log(`copied www/${file}`);
}

fs.copyFileSync(path.join(root, "scripts", "iphone-auth-guard.js"), path.join(www, "auth-guard.js"));
console.log("copied www/auth-guard.js (iphone bundle)");

for (const file of assets) {
  const dest = path.join(www, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(frontend, file), dest);
  console.log(`copied www/${file}`);
}

fs.copyFileSync(path.join(root, "scripts", "portal-boot.js"), path.join(www, "portal-boot.js"));
fs.copyFileSync(path.join(root, "scripts", "admin-portal-boot.js"), path.join(www, "admin-portal-boot.js"));
fs.copyFileSync(path.join(root, "scripts", "iphone-app-ui.css"), path.join(www, "iphone-app-ui.css"));
console.log("copied www/portal-boot.js");
console.log("copied www/admin-portal-boot.js");
console.log("copied www/iphone-app-ui.css");

// --- App home: choose Employee or Business login (no animated loader) ---
const chooserHtml = `<!doctype html>
<html lang="en" class="native-app capacitor-native iphone-app">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f6e56" />
    <title>ShiftSwift HR</title>
    <script>
      (function () {
        try {
          window.Capacitor?.Plugins?.SplashScreen?.hide?.();
        } catch (e) {}
      })();
    </script>
    <script src="./brand-config.js"></script>
    <script src="./native-app.js"></script>
    <link rel="stylesheet" href="./theme.css" />
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    <style>
      .iphone-chooser {
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: max(24px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom));
        background: linear-gradient(165deg, #0a5a47 0%, #0f6e56 42%, #0d4d3d 100%);
        color: #fff;
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      .iphone-chooser__mark {
        width: 72px;
        height: 72px;
        margin-bottom: 14px;
      }
      .iphone-chooser__title {
        margin: 0 0 6px;
        font-size: 1.55rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .iphone-chooser__lead {
        margin: 0 0 28px;
        opacity: 0.88;
        font-size: 0.95rem;
        max-width: 280px;
      }
      .iphone-chooser__actions {
        width: min(100%, 340px);
        display: grid;
        gap: 12px;
      }
      .iphone-chooser__btn {
        display: block;
        width: 100%;
        padding: 16px 18px;
        border-radius: 14px;
        border: none;
        text-decoration: none;
        text-align: left;
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
        backdrop-filter: blur(8px);
        -webkit-tap-highlight-color: transparent;
      }
      .iphone-chooser__btn strong {
        display: block;
        font-size: 1.05rem;
        margin-bottom: 4px;
      }
      .iphone-chooser__btn span {
        font-size: 0.82rem;
        opacity: 0.85;
      }
      .iphone-chooser__btn--primary {
        background: #fff;
        color: #0a5a47;
      }
      .iphone-chooser__btn--primary span {
        color: #0f6e56;
        opacity: 0.85;
      }
      .iphone-chooser__build {
        margin-top: 22px;
        font-size: 11px;
        opacity: 0.5;
      }
    </style>
  </head>
  <body class="portal-login-page">
    <main class="iphone-chooser">
      <svg class="iphone-chooser__mark" viewBox="0 0 68 68" aria-hidden="true">
        <rect x="0" y="0" width="68" height="68" rx="14" fill="#0a5a47" stroke="#5DCAA5" stroke-width="1" />
        <rect x="14" y="14" width="26" height="5" rx="2.5" fill="#5DCAA5" />
        <rect x="14" y="24" width="18" height="5" rx="2.5" fill="#9FE1CB" />
        <rect x="14" y="34" width="22" height="5" rx="2.5" fill="#5DCAA5" />
        <line x1="14" y1="56" x2="54" y2="56" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
        <polyline points="44,48 54,56 44,64" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <h1 class="iphone-chooser__title">ShiftSwift HR</h1>
      <p class="iphone-chooser__lead">Who is signing in?</p>
      <div class="iphone-chooser__actions">
        <a class="iphone-chooser__btn iphone-chooser__btn--primary" href="./employee-login.html?source=native" id="chooser-employee">
          <strong>I'm an employee</strong>
          <span>Rota, clock in, leave &amp; payslips</span>
        </a>
        <a class="iphone-chooser__btn" href="./business-login.html?source=native" id="chooser-business">
          <strong>I'm a business admin</strong>
          <span>HR admin, employees, rota &amp; compliance</span>
        </a>
      </div>
      <p class="iphone-chooser__build">Build 63 · split login</p>
    </main>
    <script>
      (function () {
        try {
          localStorage.setItem("sshrUnifiedNativeApp", "1");
          localStorage.setItem("sshrNativeApp", "1");
        } catch (e) {}
        function hideSplash() {
          try {
            window.Capacitor?.Plugins?.SplashScreen?.hide?.();
            window.ShiftSwiftNativeApp?.hideSplash?.();
          } catch (e) {}
        }
        hideSplash();
        document.addEventListener("DOMContentLoaded", hideSplash, { once: true });
        [100, 500, 1500].forEach(function (ms) {
          window.setTimeout(hideSplash, ms);
        });
        var token = localStorage.getItem("token");
        var role = localStorage.getItem("userRole");
        if (token && role === "employee") {
          window.location.replace("./employee.html?source=native");
          return;
        }
        if (token && role && role !== "employee") {
          window.location.replace("./admin.html?source=native");
        }
      })();
    </script>
  </body>
</html>`;
fs.writeFileSync(path.join(www, "index.html"), chooserHtml);
console.log("wrote www/index.html (employee / business chooser)");

// --- Bundled business login (same form as website; post-login → bundled admin) ---
let businessLoginHtml = fs.readFileSync(path.join(frontend, "business-login.html"), "utf8");
for (const pattern of [
  /<link rel="canonical"[^>]*>\s*/i,
  /<script src="\.\/portal-sw-guard\.js[^"]*"><\/script>\s*/i,
  /<script src="\.\/cookie-consent\.js[^"]*"><\/script>\s*/i,
]) {
  businessLoginHtml = businessLoginHtml.replace(pattern, "");
}
businessLoginHtml = businessLoginHtml.replace(
  '<script src="./brand-config.js?v=brand-v7"></script>',
  '<script src="./native-api-fetch.js"></script>\n    <script src="./brand-config.js?v=brand-v7"></script>',
);
businessLoginHtml = businessLoginHtml.replace(
  'href="./sign-in.html"',
  'href="./index.html"',
);
businessLoginHtml = businessLoginHtml.replace(
  'href="./native-app-login.html"',
  'href="./index.html"',
);
businessLoginHtml = businessLoginHtml.replace(
  '<header class="portal-login-brand portal-login-brand--streamlined">',
  '<header class="portal-login-brand portal-login-brand--streamlined"><p style="margin:0 0 12px;text-align:center"><a href="./index.html" style="color:inherit;font-size:13px;opacity:.75;text-decoration:none">← Back</a></p>',
);
businessLoginHtml = businessLoginHtml.replace(
  '<p class="portal-login-secure-note">',
  '<p class="native-login-build" style="margin:10px 0 0;text-align:center;font-size:11px;opacity:0.55">Build 63 · business</p>\n        <p class="portal-login-secure-note">',
);
businessLoginHtml = businessLoginHtml.replace(
  "</head>",
  `    <script>
      (function(){function h(){try{window.Capacitor?.Plugins?.SplashScreen?.hide?.();window.ShiftSwiftNativeApp?.hideSplash?.();}catch(e){}}h();document.addEventListener("DOMContentLoaded",h,{once:true});})();
    </script>
    <link rel="stylesheet" href="./iphone-app-ui.css" />
  </head>`,
);
businessLoginHtml = businessLoginHtml.replace(
  "<html",
  '<html class="native-app capacitor-native iphone-app"',
);
fs.writeFileSync(path.join(www, "business-login.html"), businessLoginHtml);
console.log("wrote www/business-login.html");

// --- Bundled employee login ---
let employeeLoginHtml = fs.readFileSync(path.join(frontend, "employee-login.html"), "utf8");
for (const pattern of [
  /<link rel="canonical"[^>]*>\s*/i,
  /<script src="\.\/portal-sw-guard\.js[^"]*"><\/script>\s*/i,
  /<script>\s*\(function \(\) \{[\s\S]*?native-unified-login-redirect[\s\S]*?\}\)\(\);\s*<\/script>\s*/i,
  /<script src="\.\/cookie-consent\.js[^"]*"><\/script>\s*/i,
]) {
  employeeLoginHtml = employeeLoginHtml.replace(pattern, "");
}
employeeLoginHtml = employeeLoginHtml.replace(
  '<script src="./brand-config.js?v=brand-v7"></script>',
  '<script src="./native-api-fetch.js"></script>\n    <script src="./brand-config.js?v=brand-v7"></script>',
);
employeeLoginHtml = employeeLoginHtml.replace(
  '<p class="portal-login-secure-note">',
  '<p class="native-login-build" style="margin:10px 0 0;text-align:center;font-size:11px;opacity:0.55">Build 63 · employee</p>\n              <p class="portal-login-secure-note">',
);
employeeLoginHtml = employeeLoginHtml.replace(
  "</head>",
  `    <script>
      (function(){function h(){try{window.Capacitor?.Plugins?.SplashScreen?.hide?.();window.ShiftSwiftNativeApp?.hideSplash?.();}catch(e){}}h();document.addEventListener("DOMContentLoaded",h,{once:true});})();
    </script>
    <link rel="stylesheet" href="./iphone-app-ui.css" />
  </head>`,
);
employeeLoginHtml = employeeLoginHtml.replace(
  "<html",
  '<html class="native-app capacitor-native iphone-app"',
);
employeeLoginHtml = employeeLoginHtml.replace(
  '<header class="portal-login-brand">',
  '<header class="portal-login-brand"><p style="margin:0 0 12px"><a href="./index.html" style="color:inherit;font-size:13px;opacity:.75;text-decoration:none">← Back</a></p>',
);
fs.writeFileSync(path.join(www, "employee-login.html"), employeeLoginHtml);
console.log("wrote www/employee-login.html");

// --- Employee employee.html ---
const employeeSrc = fs.readFileSync(path.join(frontend, "employee.html"), "utf8");
const shellStart = employeeSrc.indexOf('<div id="sidebar-overlay"');
const scriptsMarker = employeeSrc.indexOf('<script src="./portal-pwa-stability.js');
if (shellStart === -1 || scriptsMarker === -1) {
  console.error("employee.html layout changed");
  process.exit(1);
}
const shellEnd = employeeSrc.lastIndexOf("</dialog>", scriptsMarker);
let shell = employeeSrc.slice(shellStart, shellEnd + "</dialog>".length);
shell = shell.replace(/Loading…/g, "…");
shell = shell.replace(/Loading your account…/g, "…");
shell = shell.replace(/Loading balance…/g, "…");
shell = shell.replace(/Loading shifts…/g, "…");
shell = shell.replace(/Loading leave requests…/g, "…");
shell = shell.replace(/Loading your hours…/g, "…");
shell = shell.replace(/Loading documents…/g, "…");
shell = shell.replace(/Loading notes…/g, "…");
shell = shell.replace(/Loading payslips…/g, "…");
shell = shell.replace(/Loading security settings…/g, "…");

const sessionBridgeScript = `<script>
(function(){try{var p=new URLSearchParams(location.search);var h=p.get("sshr_handoff");if(h){var d=JSON.parse(atob(h.replace(/-/g,"+").replace(/_/g,"/")));if(d&&d.ts&&Date.now()-d.ts<12e4){["token","refreshToken","tenantId","userRole","masterTenantId"].forEach(function(k){if(d[k])localStorage.setItem(k,d[k]);});window.__SSHR_HANDOFF_CONSUMED=1;p.delete("sshr_handoff");var q=p.toString();history.replaceState(null,"",location.pathname+(q?"?"+q:"")+location.hash);return;}}var r=sessionStorage.getItem("sshrNativeSessionBridge");if(!r)return;var d=JSON.parse(r);if(!d||!d.ts||Date.now()-d.ts>12e4)return;["token","refreshToken","tenantId","userRole","masterTenantId"].forEach(function(k){if(d[k])localStorage.setItem(k,d[k]);});sessionStorage.removeItem("sshrNativeSessionBridge");}catch(e){}})();
</script>`;

const employeeHtml = `<!doctype html>
<html lang="en" data-app-icon="employee" class="native-app capacitor-native iphone-app">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f6e56" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <title>ShiftSwift HR | Employee</title>
    ${sessionBridgeScript}
    <link rel="stylesheet" href="./theme.css" />
    <link rel="stylesheet" href="./native-app-chrome.css" />
    <link rel="stylesheet" href="./styles.css" />
    <link rel="stylesheet" href="./employee-mobile-polish.css" />
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    <script src="./native-bundled-url.js"></script>
    <script src="./native-api-fetch.js"></script>
    <script src="./session-auth.js"></script>
    <script src="./native-app.js"></script>
    <script src="./brand-config.js"></script>
  </head>
  <body class="employee-portal native-app capacitor-native portal-startup-ready">
    ${shell}
    <script src="./portal-boot.js"></script>
  </body>
</html>
`;

fs.writeFileSync(path.join(www, "employee.html"), employeeHtml);
console.log("wrote www/employee.html");

// --- Admin admin.html (bundled native shell) ---
let adminHtml = fs.readFileSync(path.join(frontend, "admin.html"), "utf8");
adminHtml = adminHtml.replace(
  "<html lang=\"en\"",
  '<html lang="en" class="native-app capacitor-native iphone-app"',
);
adminHtml = adminHtml.replace(
  '<body class="admin-portal">',
  `<body class="admin-portal native-app capacitor-native portal-startup-ready iphone-app">
    <script>
      (function(){function h(){try{window.Capacitor?.Plugins?.SplashScreen?.hide?.();window.ShiftSwiftNativeApp?.hideSplash?.();document.getElementById("native-startup-loader")?.remove();document.documentElement.classList.remove("native-startup-active");document.body?.classList.remove("native-startup-active","portal-startup-pending");document.body?.classList.add("portal-startup-ready");}catch(e){}}h();[50,300,1200].forEach(function(ms){setTimeout(h,ms);});})();
    </script>`,
);
adminHtml = adminHtml.replace(
  /<script>\s*\(function \(\) \{\s*try \{\s*if \(sessionStorage\.getItem\("impersonationActive"\)[\s\S]*?<\/script>\s*/,
  "",
);
adminHtml = adminHtml.replace(
  /<script>\s*if \(!window\.__SSHR_BUNDLED_NATIVE_BOOT\) \{\s*document\.write\('<script src="\.\/native-app\.js[^]*?<\/script>\s*/,
  "",
);
adminHtml = adminHtml.replace(
  /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\s*/,
  "",
);
adminHtml = adminHtml.replace(
  /<meta name="viewport"[^>]*>\s*<script>[\s\S]*?native-app-portal-guard\.js\?v=26[\s\S]*?<\/script>\s*<script>[\s\S]*?native-app-bootstrap\.js\?v=6[\s\S]*?<\/script>\s*/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n',
);
const adminScriptsMarker = adminHtml.indexOf('<script src="./session-auth.js?v=11"></script>');
if (adminScriptsMarker === -1) {
  console.error("admin.html layout changed — body script block not found");
  process.exit(1);
}
adminHtml =
  adminHtml.slice(0, adminScriptsMarker) +
  '    <script src="./admin-portal-boot.js"></script>\n' +
  adminHtml.slice(adminHtml.lastIndexOf("</body>"));
adminHtml = adminHtml.replace(
  "</head>",
  `    ${sessionBridgeScript}
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    <script src="./native-bundled-url.js"></script>
    <script src="./native-api-fetch.js"></script>
    <script src="./session-auth.js"></script>
    <script src="./native-app.js"></script>
  </head>`,
);
fs.writeFileSync(path.join(www, "admin.html"), adminHtml);
console.log("wrote www/admin.html");
