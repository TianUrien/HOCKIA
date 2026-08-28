package com.inhockia.app;

import android.os.RemoteException;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google Play Install Referrer → JS.
 *
 * A Play Store link of the form
 *   https://play.google.com/store/apps/details?id=com.inhockia.app&referrer=utm_source%3Dinstagram%26hk_link%3Dig-app
 * hands the (decoded) `referrer` string to the app after install. The
 * attribution engine (lib/installReferrer.ts) reads it once, on first
 * launch, and records it as the touch that brought the install.
 *
 * Every failure path resolves with { available: false } — attribution is
 * never allowed to affect app startup. Sideloaded / debug builds and
 * installs older than the Play data window come back the same way.
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void getReferrer(final PluginCall call) {
        final InstallReferrerClient client;
        try {
            client = InstallReferrerClient.newBuilder(getContext()).build();
        } catch (Throwable t) {
            call.resolve(unavailable("build_failed"));
            return;
        }

        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            ReferrerDetails details = client.getInstallReferrer();
                            JSObject out = new JSObject();
                            out.put("available", true);
                            out.put("referrer", details.getInstallReferrer());
                            out.put("referrerClickTimestampSeconds", details.getReferrerClickTimestampSeconds());
                            out.put("installBeginTimestampSeconds", details.getInstallBeginTimestampSeconds());
                            out.put("googlePlayInstantParam", details.getGooglePlayInstantParam());
                            call.resolve(out);
                        } else {
                            call.resolve(unavailable("response_" + responseCode));
                        }
                    } catch (RemoteException | RuntimeException e) {
                        call.resolve(unavailable("read_failed"));
                    } finally {
                        try { client.endConnection(); } catch (Throwable ignored) { /* best effort */ }
                    }
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    // Play Services went away mid-call; we do not retry — the
                    // JS side asks again on the next launch if nothing was stored.
                    if (!call.isReleased()) call.resolve(unavailable("disconnected"));
                }
            });
        } catch (Throwable t) {
            call.resolve(unavailable("connect_failed"));
        }
    }

    private static JSObject unavailable(String reason) {
        JSObject out = new JSObject();
        out.put("available", false);
        out.put("reason", reason);
        return out;
    }
}
