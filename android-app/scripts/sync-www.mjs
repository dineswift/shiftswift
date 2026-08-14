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
  "native-keyboard.js",
  "native-haptics.js",
  "unified-login.js",
  "action-feedback.js",
  "native-app-portal-guard.js",
  "native-app-bootstrap.js",
  "native-ipad-layout.js",
  "native-geolocation.js",
  "native-shift-alerts.js",
  "native-remote-push.js",
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
  "passkey-auth.js",
  "password-reset.js",
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
fs.copyFileSync(path.join(root, "scripts", "iphone-app-ipad.css"), path.join(www, "iphone-app-ipad.css"));
console.log("copied www/portal-boot.js");
console.log("copied www/admin-portal-boot.js");
console.log("copied www/iphone-app-ui.css");
console.log("copied www/iphone-app-ipad.css");

const nativeLayoutPrimeScript = `<script>(function(){try{if(!window.Capacitor?.isNativePlatform?.())return;var ua=navigator.userAgent||"";var w=screen.width||0,h=screen.height||0,min=Math.min(w,h),max=Math.max(w,h);var pad=/iPad/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)||(/Android/i.test(ua)&&!/Mobile/i.test(ua))||(min>=744&&max>=1024)||(/Android/i.test(ua)&&min>=600&&max>=900);var root=document.documentElement;root.classList.add("native-app","capacitor-native");if(/Android/i.test(ua))root.classList.add("native-android");else root.classList.add("native-ios");if(pad&&!window.matchMedia("(max-width:600px)").matches){root.classList.add("native-tablet");if(max>=1194||window.matchMedia("(min-width:1024px)").matches)root.classList.add("native-tablet-large");}else{root.classList.add("native-phone");}}catch(e){}})();</script>`;

const nativeIpadHead = `    ${nativeLayoutPrimeScript}
    <script src="./native-ipad-layout.js"></script>
    <link rel="stylesheet" href="./iphone-app-ipad.css" />
`;

const nativeStartupLoaderHtml = fs.readFileSync(
  path.join(frontend, "native-startup-loader.html"),
  "utf8",
).trim();

const nativeStartupPrimeScript = `<script>(function(){try{if(window.Capacitor?.isNativePlatform?.()){document.documentElement.classList.add("native-startup-active");document.addEventListener("DOMContentLoaded",function(){document.body?.classList.add("native-startup-active");},{once:true});}}catch(e){}})();</script>`;

const nativeStartupHead = `    <link rel="stylesheet" href="./native-app-startup.css" />`;

// --- App home: choose Employee or Business login ---
const chooserHtml = `<!doctype html>
<html lang="en" class="native-app capacitor-native iphone-app">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f6e56" />
    <title>ShiftSwift HR</title>
    <script src="./brand-config.js"></script>
    <script src="./native-app.js"></script>
    ${nativeStartupHead}
    <link rel="stylesheet" href="./theme.css" />
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    ${nativeIpadHead}
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
      .iphone-chooser__signup {
        margin: 22px 0 0;
        max-width: 340px;
        font-size: 0.88rem;
        line-height: 1.45;
        opacity: 0.92;
      }
      .iphone-chooser__signup a {
        color: #fff;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
    </style>
  </head>
  <body class="portal-login-page">
    ${nativeStartupLoaderHtml}
    ${nativeStartupPrimeScript}
    <main class="iphone-chooser">
      <div class="iphone-chooser__intro">
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
      </div>
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
      <p class="iphone-chooser__signup">
        New business?
        <a href="https://app.shiftswifthr.co.uk/signup.html" data-sshr-external-url="https://app.shiftswifthr.co.uk/signup.html" id="chooser-signup">
          Start free trial
        </a>
      </p>
    </main>
    <script src="./native-app-startup.js"></script>
    <script>
      (function () {
        try {
          localStorage.setItem("sshrUnifiedNativeApp", "1");
          localStorage.setItem("sshrNativeApp", "1");
        } catch (e) {}
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

const COMPACT_NATIVE_MFA_PANEL = `        <div id="mfa-enrollment-panel" class="portal-login-card-body mfa-enrollment--native" hidden>
          <div class="portal-login-card-head mfa-enrollment-head">
            <h1>Secure your account</h1>
            <p class="portal-login-card-lead">Scan a QR code with your authenticator app, or skip for now.</p>
          </div>
          <div class="mfa-enrollment-scroll">
            <p id="mfa-enrollment-user" class="mfa-enrollment-user muted"></p>
            <button type="button" class="btn portal-login-submit portal-login-submit--secondary" id="mfa-enrollment-passkey-btn" hidden>Use device unlock</button>
            <p class="muted native-login-mfa-divider" id="mfa-enrollment-passkey-divider" hidden>or authenticator app</p>
            <div id="mfa-enrollment-qr-wrap" class="mfa-enrollment-qr-wrap" hidden>
              <img id="mfa-enrollment-qr" alt="Authenticator QR code" width="128" height="128" />
            </div>
            <details class="mfa-enrollment-manual" open>
              <summary>Manual key</summary>
              <code id="mfa-enrollment-secret" class="mfa-enrollment-secret"></code>
            </details>
            <p class="mfa-enrollment-open-wrap">
              <a id="mfa-enrollment-open-app" class="portal-login-inline-link" href="#" hidden>Open authenticator app</a>
            </p>
            <label class="mfa-enrollment-code-label">
              6-digit code
              <input id="mfa-enrollment-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" />
            </label>
            <p id="mfa-enrollment-status" class="form-error-message" hidden></p>
          </div>
          <div class="mfa-enrollment-actions">
            <button type="button" class="btn portal-login-submit portal-login-submit--secondary" id="mfa-enrollment-skip">Skip for now</button>
            <button type="button" class="btn portal-login-submit" id="mfa-enrollment-submit">Enable MFA and sign in</button>
          </div>
        </div>`;

function softenNativeFaceIdCopy(html) {
  return String(html || "")
    .replace(/>Verify with Face ID</g, ">Verify with device unlock<")
    .replace(/>Use Face ID \/ Touch ID</g, ">Use device unlock<")
    .replace(/>Sign in with Face ID</g, ">Sign in with device unlock<")
    .replace(/>Use Face ID \/ Touch ID next time</g, ">Use device unlock next time<");
}

function compactNativeMfaPanel(html) {
  return softenNativeFaceIdCopy(
    html.replace(
      /<div id="mfa-enrollment-panel"[\s\S]*?<\/div>\s*\n\s*<div id="mfa-panel"/,
      `${COMPACT_NATIVE_MFA_PANEL}\n\n        <div id="mfa-panel"`,
    ),
  );
}

// --- Bundled business login (same form as website; post-login → bundled admin) ---
let businessLoginHtml = fs.readFileSync(path.join(frontend, "business-login.html"), "utf8");
for (const pattern of [
  /<link rel="canonical"[^>]*>\s*/i,
  /<script src="\.\/portal-sw-guard\.js[^"]*"><\/script>\s*/i,
  /<script src="\.\/cookie-consent\.js[^"]*"><\/script>\s*/i,
  /<script>\s*\(function \(\) \{[\s\S]*?portal=employee[\s\S]*?\}\)\(\);\s*<\/script>\s*/i,
]) {
  businessLoginHtml = businessLoginHtml.replace(pattern, "");
}
businessLoginHtml = businessLoginHtml.replace(
  /<p class="portal-login-alt-note[\s\S]*?<\/p>\s*/i,
  `<p class="portal-login-alt-note portal-login-alt-note--compact native-business-signup">
            New business?
            <a class="portal-login-inline-link" href="https://app.shiftswifthr.co.uk/signup.html" data-sshr-external-url="https://app.shiftswifthr.co.uk/signup.html">Start free trial</a>
          </p>
`,
);
businessLoginHtml = businessLoginHtml.replace(
  '<script src="./brand-config.js?v=brand-v7"></script>',
  '<script src="./native-api-fetch.js"></script>\n    <script src="./brand-config.js?v=brand-v7"></script>',
);
businessLoginHtml = businessLoginHtml.replace(
  'href="./sign-in.html"',
  'href="./index.html"',
);
businessLoginHtml = businessLoginHtml.replace(
  /<script src="\.\/login\.js[^"]*"><\/script>/,
  '<script src="./login.js"></script>',
);
businessLoginHtml = businessLoginHtml.replace(
  '<header class="portal-login-brand portal-login-brand--streamlined">',
  '<header class="portal-login-brand portal-login-brand--streamlined"><p style="margin:0 0 12px;text-align:center"><a href="./index.html" style="color:inherit;font-size:13px;text-decoration:none">← Back</a></p>',
);
businessLoginHtml = businessLoginHtml.replace(
  "</head>",
  `    <link rel="stylesheet" href="./native-app-login.css" />
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    ${nativeStartupHead}
    ${nativeIpadHead}
  </head>`,
);
businessLoginHtml = businessLoginHtml.replace(
  /<body([^>]*)>/,
  `<body$1>\n    ${nativeStartupLoaderHtml}\n    ${nativeStartupPrimeScript}`,
);
businessLoginHtml = businessLoginHtml.replace(
  /<script src="\.\/login\.js"><\/script>/,
  '<script src="./native-app-startup.js"></script>\n    <script src="./login.js"></script>',
);
businessLoginHtml = businessLoginHtml.replace(
  "<html",
  '<html class="native-app capacitor-native iphone-app"',
);
businessLoginHtml = compactNativeMfaPanel(businessLoginHtml);
fs.writeFileSync(path.join(www, "business-login.html"), businessLoginHtml);
console.log("wrote www/business-login.html");

function patchForgotPasswordPage(html, { backHref, titleMark }) {
  let out = html;
  for (const pattern of [
    /<link rel="canonical"[^>]*>\s*/i,
    /<link rel="manifest"[^>]*>\s*/i,
    /<script src="\.\/cookie-consent\.js[^"]*"><\/script>\s*/i,
    /<script src="\.\/employee-pwa\.js[^"]*"><\/script>\s*/i,
    /<script src="\.\/session-auth\.js[^"]*"><\/script>\s*/i,
  ]) {
    out = out.replace(pattern, "");
  }
  out = out.replace(
    '<script src="./brand-config.js?v=brand-v7"></script>',
    '<script src="./native-api-fetch.js"></script>\n    <script src="./brand-config.js?v=brand-v7"></script>',
  );
  out = out.replace(
    /<script src="\.\/password-reset\.js[^"]*"><\/script>/,
    '<script src="./password-reset.js"></script>',
  );
  out = out.replace("<html", '<html class="native-app capacitor-native iphone-app"');
  out = out.replace(
    "</head>",
    `    <link rel="stylesheet" href="./iphone-app-ui.css" />
    ${nativeIpadHead}
  </head>`,
  );
  if (backHref) {
    out = out.replace(/href="\.\/business-login\.html"/g, `href="${backHref}"`);
    out = out.replace(/href="\.\/employee-login\.html"/g, `href="${backHref}"`);
  }
  void titleMark;
  return out;
}

let forgotBusinessHtml = fs.readFileSync(path.join(frontend, "forgot-password.html"), "utf8");
forgotBusinessHtml = patchForgotPasswordPage(forgotBusinessHtml, {
  backHref: "./business-login.html?source=native",
});
fs.writeFileSync(path.join(www, "forgot-password.html"), forgotBusinessHtml);
console.log("wrote www/forgot-password.html");

let forgotEmployeeHtml = fs.readFileSync(path.join(frontend, "employee-forgot-password.html"), "utf8");
forgotEmployeeHtml = patchForgotPasswordPage(forgotEmployeeHtml, {
  backHref: "./employee-login.html?source=native",
});
fs.writeFileSync(path.join(www, "employee-forgot-password.html"), forgotEmployeeHtml);
console.log("wrote www/employee-forgot-password.html");

let resetPasswordHtml = fs.readFileSync(path.join(frontend, "reset-password.html"), "utf8");
resetPasswordHtml = patchForgotPasswordPage(resetPasswordHtml, {
  backHref: "./business-login.html?source=native",
});
fs.writeFileSync(path.join(www, "reset-password.html"), resetPasswordHtml);
console.log("wrote www/reset-password.html");

function stripNativeEmployeeInstallBanner(html) {
  return html
    .replace(
      /<div id="portal-pwa-install-banner"[\s\S]*?<div class="portal-pwa-install-banner__actions">[\s\S]*?<\/div>\s*<\/div>\s*/i,
      "",
    )
    .replace(
      /<div class="portal-pwa-install-banner__actions">[\s\S]*?<\/div>\s*<\/div>\s*/i,
      "",
    );
}

// --- Bundled employee login ---
let employeeLoginHtml = fs.readFileSync(path.join(frontend, "employee-login.html"), "utf8");
employeeLoginHtml = stripNativeEmployeeInstallBanner(employeeLoginHtml);
for (const pattern of [
  /<link rel="canonical"[^>]*>\s*/i,
  /<script src="\.\/portal-sw-guard\.js[^"]*"><\/script>\s*/i,
  /<script>\s*\(function \(\) \{[\s\S]*?sign-in\.html[\s\S]*?\}\)\(\);\s*<\/script>\s*/i,
  /<script>\s*\(function \(\) \{[\s\S]*?native-unified-login-redirect[\s\S]*?\}\)\(\);\s*<\/script>\s*/i,
  /<script\s+src="\.\/portal-pwa-install\.js[^"]*"[\s\S]*?<\/script>\s*/gi,
  /<p class="portal-login-alt-note">[\s\S]*?<\/p>\s*/i,
  /<p class="portal-login-footnote[\s\S]*?<\/p>\s*/i,
  /<script src="\.\/cookie-consent\.js[^"]*"><\/script>\s*/i,
]) {
  employeeLoginHtml = employeeLoginHtml.replace(pattern, "");
}
employeeLoginHtml = employeeLoginHtml.replace(
  '<script src="./brand-config.js?v=brand-v7"></script>',
  '<script src="./native-api-fetch.js"></script>\n    <script src="./brand-config.js?v=brand-v7"></script>',
);
employeeLoginHtml = employeeLoginHtml.replace(
  /<script src="\.\/login\.js[^"]*"><\/script>/,
  '<script src="./native-app-startup.js"></script>\n    <script src="./login.js"></script>',
);
employeeLoginHtml = employeeLoginHtml.replace(
  "</head>",
  `    <link rel="stylesheet" href="./native-app-login.css" />
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    ${nativeStartupHead}
    ${nativeIpadHead}
  </head>`,
);
employeeLoginHtml = employeeLoginHtml.replace(
  /<body([^>]*)>/,
  `<body$1>\n    ${nativeStartupLoaderHtml}\n    ${nativeStartupPrimeScript}`,
);
employeeLoginHtml = employeeLoginHtml.replace(
  "<html",
  '<html class="native-app capacitor-native iphone-app"',
);
employeeLoginHtml = employeeLoginHtml.replace(
  '<header class="portal-login-brand">',
  '<header class="portal-login-brand"><p style="margin:0 0 12px"><a href="./index.html" style="color:inherit;font-size:13px;text-decoration:none">← Back</a></p>',
);
employeeLoginHtml = employeeLoginHtml.replace(
  "portal-login-card--employee portal-login-card--has-install",
  "portal-login-card--employee",
);
employeeLoginHtml = compactNativeMfaPanel(employeeLoginHtml);
if (!employeeLoginHtml.includes('id="portal-login-form"')) {
  console.error("employee-login.html sync produced invalid output — portal-login-form missing");
  process.exit(1);
}
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
    ${nativeIpadHead}
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
const adminSessionAuthMatch = adminHtml.match(/<script src="\.\/session-auth\.js(?:\?v=\d+)?"><\/script>/);
if (!adminSessionAuthMatch) {
  console.error("admin.html layout changed — body script block not found");
  process.exit(1);
}
const adminScriptsMarker = adminHtml.indexOf(adminSessionAuthMatch[0]);
adminHtml =
  adminHtml.slice(0, adminScriptsMarker) +
  '    <script src="./admin-portal-boot.js"></script>\n' +
  adminHtml.slice(adminHtml.lastIndexOf("</body>"));
adminHtml = adminHtml.replace(
  "</head>",
  `    ${sessionBridgeScript}
    ${nativeLayoutPrimeScript}
    <script src="./native-ipad-layout.js"></script>
    <link rel="stylesheet" href="./iphone-app-ui.css" />
    <link rel="stylesheet" href="./iphone-app-ipad.css" />
    <script src="./native-bundled-url.js"></script>
    <script src="./native-api-fetch.js"></script>
    <script src="./session-auth.js"></script>
    <script src="./native-app.js"></script>
  </head>`,
);
fs.writeFileSync(path.join(www, "admin.html"), adminHtml);
console.log("wrote www/admin.html");

// Android FCM is only safe when google-services.json matches this app id.
// Without it, Capacitor PushNotifications.register() can crash the process.
const googleServicesPath = path.join(root, "android/app/google-services.json");
let androidFcmEnabled = false;
if (fs.existsSync(googleServicesPath)) {
  try {
    const googleServices = JSON.parse(fs.readFileSync(googleServicesPath, "utf8"));
    androidFcmEnabled = (googleServices.client || []).some(
      (client) =>
        client?.client_info?.android_client_info?.package_name === "co.uk.shiftswifthr.app",
    );
  } catch {
    androidFcmEnabled = false;
  }
}
fs.writeFileSync(
  path.join(www, "android-fcm-flag.js"),
  `window.__SSHR_ANDROID_FCM__ = ${androidFcmEnabled ? "true" : "false"};\n`,
);
console.log(
  androidFcmEnabled
    ? "wrote www/android-fcm-flag.js (FCM enabled)"
    : "wrote www/android-fcm-flag.js (FCM disabled — add google-services.json for co.uk.shiftswifthr.app)",
);
