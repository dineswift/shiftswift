#!/usr/bin/env node
/**
 * Capacitor PushNotifications.register() crashes the whole Android process when
 * google-services.json is missing (IllegalStateException: Default FirebaseApp is
 * not initialized). Guard register/unregister so Play reviewers cannot crash the app.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules/@capacitor/push-notifications/android/src/main/java/com/capacitorjs/plugins/pushnotifications/PushNotificationsPlugin.java",
);

if (!fs.existsSync(target)) {
  console.warn("patch-push-firebase-guard: plugin source not found — skip");
  process.exit(0);
}

let src = fs.readFileSync(target, "utf8");
if (src.includes("ShiftSwiftFirebaseGuard")) {
  console.log("patch-push-firebase-guard: already applied");
  process.exit(0);
}

const unpatchedRegister = `    @PluginMethod
    public void register(PluginCall call) {
        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        FirebaseMessaging
            .getInstance()
            .getToken()
            .addOnCompleteListener(
                task -> {
                    if (!task.isSuccessful()) {
                        sendError(task.getException().getLocalizedMessage());
                        return;
                    }
                    sendToken(task.getResult());
                }
            );
        call.resolve();
    }`;

const patchedRegister = `    @PluginMethod
    public void register(PluginCall call) {
        // ShiftSwiftFirebaseGuard: missing google-services.json must not kill the process.
        try {
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging
                .getInstance()
                .getToken()
                .addOnCompleteListener(
                    task -> {
                        if (!task.isSuccessful()) {
                            Exception exception = task.getException();
                            sendError(exception != null ? exception.getLocalizedMessage() : "Unable to get FCM token");
                            return;
                        }
                        sendToken(task.getResult());
                    }
                );
            call.resolve();
        } catch (Exception e) {
            call.reject("Push notifications unavailable: " + e.getLocalizedMessage());
        }
    }`;

const unpatchedUnregister = `    @PluginMethod
    public void unregister(PluginCall call) {
        FirebaseMessaging.getInstance().setAutoInitEnabled(false);
        FirebaseMessaging.getInstance().deleteToken();
        call.resolve();
    }`;

const patchedUnregister = `    @PluginMethod
    public void unregister(PluginCall call) {
        // ShiftSwiftFirebaseGuard
        try {
            FirebaseMessaging.getInstance().setAutoInitEnabled(false);
            FirebaseMessaging.getInstance().deleteToken();
            call.resolve();
        } catch (Exception e) {
            call.reject("Push notifications unavailable: " + e.getLocalizedMessage());
        }
    }`;

if (!src.includes(unpatchedRegister) || !src.includes(unpatchedUnregister)) {
  console.error("patch-push-firebase-guard: unexpected plugin source — update the patch");
  process.exit(1);
}

src = src.replace(unpatchedRegister, patchedRegister).replace(unpatchedUnregister, patchedUnregister);
fs.writeFileSync(target, src);
console.log("patch-push-firebase-guard: applied");
