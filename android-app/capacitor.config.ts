import type { CapacitorConfig } from "@capacitor/cli";

const devServer = process.env.SSHR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "co.uk.shiftswifthr.app",
  appName: "ShiftSwift HR",
  webDir: "www",
  server: devServer
    ? {
        url: devServer,
        cleartext: devServer.startsWith("http://"),
        // Keep app/api in-WebView; www (storefront/signup) opens in Chrome Custom Tabs.
        allowNavigation: ["app.shiftswifthr.co.uk", "api.shiftswifthr.co.uk", "localhost"],
        androidScheme: "https",
        hostname: "localhost",
      }
    : {
        androidScheme: "https",
        hostname: "localhost",
        // Keep app/api in-WebView; www (storefront/signup) opens in Chrome Custom Tabs.
        allowNavigation: ["app.shiftswifthr.co.uk", "api.shiftswifthr.co.uk", "localhost"],
      },
  android: {
    path: "android",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: "#0f6e56",
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      launchFadeOutDuration: 200,
      backgroundColor: "#0f6e56",
      showSpinner: false,
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_INSIDE",
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#0f6e56",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      resize: "none",
    },
  },
};

export default config;
