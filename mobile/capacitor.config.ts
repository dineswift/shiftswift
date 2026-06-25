import type { CapacitorConfig } from "@capacitor/cli";

type AppVariant = "app" | "employee" | "business";

const variant = (process.env.SSHR_APP || "app") as AppVariant;
const devServer = process.env.SSHR_SERVER_URL?.trim();

const allowNavigation = [
  "app.shiftswifthr.co.uk",
  "api.shiftswifthr.co.uk",
  "*.shiftswifthr.co.uk",
  "localhost",
  "127.0.0.1",
];

const pluginConfig = {
  CapacitorHttp: {
    enabled: false,
  },
  SplashScreen: {
    launchAutoHide: false,
    launchShowDuration: 0,
    launchFadeOutDuration: 280,
    backgroundColor: "#0f6e56",
    showSpinner: false,
    androidSplashResourceName: "splash",
    androidScaleType: "CENTER_INSIDE",
    iosSpinnerStyle: "small",
  },
  StatusBar: {
    style: "LIGHT" as const,
    backgroundColor: "#0f6e56",
  },
};

const cameraPlist = "Scan premises QR codes to clock in at your work site.";
const locationPlist = "Verify you are at your work site when clocking in.";

const sharedPlist = {
  NSCameraUsageDescription: cameraPlist,
  NSLocationWhenInUseUsageDescription: locationPlist,
  NSLocationAlwaysAndWhenInUseUsageDescription: locationPlist,
  UIBackgroundModes: ["remote-notification"],
};

const apps: Record<AppVariant, CapacitorConfig> = {
  app: {
    appId: "co.uk.shiftswifthr.app",
    appName: "ShiftSwift HR",
    webDir: "www/app",
    server: devServer
      ? { url: devServer, cleartext: devServer.startsWith("http://"), allowNavigation }
      : { allowNavigation },
    ios: {
      path: "ios-app",
      contentInset: "automatic",
      scheme: "App",
      infoPlist: sharedPlist,
    },
    plugins: pluginConfig,
  },
  employee: {
    appId: "co.uk.shiftswifthr.employee",
    appName: "Employee",
    webDir: "www/employee",
    server: devServer
      ? { url: devServer, cleartext: devServer.startsWith("http://"), allowNavigation }
      : {
          url: "https://app.shiftswifthr.co.uk/employee-login.html?source=native",
          cleartext: false,
          allowNavigation,
        },
    ios: {
      path: "ios-employee",
      contentInset: "automatic",
      scheme: "App",
      infoPlist: sharedPlist,
    },
    plugins: pluginConfig,
  },
  business: {
    appId: "co.uk.shiftswifthr.hradmin",
    appName: "HR Admin",
    webDir: "www/business",
    server: devServer
      ? { url: devServer, cleartext: devServer.startsWith("http://"), allowNavigation }
      : {
          url: "https://app.shiftswifthr.co.uk/business-login.html?source=native",
          cleartext: false,
          allowNavigation,
        },
    ios: {
      path: "ios-business",
      contentInset: "automatic",
      scheme: "App",
      infoPlist: sharedPlist,
    },
    plugins: pluginConfig,
  },
};

export default apps[variant];
