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
        allowNavigation: ["app.shiftswifthr.co.uk", "api.shiftswifthr.co.uk", "*.shiftswifthr.co.uk", "localhost"],
        iosScheme: "App",
        hostname: "localhost",
      }
    : {
        iosScheme: "App",
        hostname: "localhost",
        allowNavigation: ["app.shiftswifthr.co.uk", "api.shiftswifthr.co.uk", "*.shiftswifthr.co.uk", "localhost"],
      },
  ios: {
    path: "ios",
    contentInset: "automatic",
    scheme: "App",
    infoPlist: {
      NSCameraUsageDescription: "Scan premises QR codes to clock in at your work site.",
      NSLocationWhenInUseUsageDescription: "Verify you are at your work site when clocking in.",
      NSLocationAlwaysAndWhenInUseUsageDescription: "Verify you are at your work site when clocking in.",
      UIBackgroundModes: ["remote-notification"],
    },
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      launchFadeOutDuration: 200,
      backgroundColor: "#0f6e56",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#0f6e56",
    },
  },
};

export default config;
