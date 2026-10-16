package com.inhockia.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.coordinatorlayout.widget.CoordinatorLayout;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Tablets get the phone layout: the WebView is held to this width (dp) and centred. */
    private static final int TABLET_CONTENT_WIDTH_DP = 640;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created.
        registerPlugin(InstallReferrerPlugin.class);
        super.onCreate(savedInstanceState);
        letterboxTablets();
    }

    /**
     * Founder ruling 2026-10-16: tablets show the phone layout, not the
     * desktop web layout. Capped at 640 dp and centred inside the bridge's
     * CoordinatorLayout, the WebView measures innerWidth 640 and the web app
     * never switches to its desktop (lg) breakpoint. Phones are untouched.
     */
    private void letterboxTablets() {
        int smallestWidthDp = getResources().getConfiguration().smallestScreenWidthDp;
        if (smallestWidthDp < 600) return;
        WebView webView = getBridge().getWebView();
        if (webView == null || !(webView.getParent() instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) webView.getParent();
        parent.setBackgroundColor(Color.WHITE);
        float density = getResources().getDisplayMetrics().density;
        int widthPx = Math.round(Math.min(TABLET_CONTENT_WIDTH_DP, smallestWidthDp) * density);
        if (parent instanceof CoordinatorLayout) {
            CoordinatorLayout.LayoutParams lp = new CoordinatorLayout.LayoutParams(widthPx, ViewGroup.LayoutParams.MATCH_PARENT);
            lp.gravity = Gravity.CENTER_HORIZONTAL;
            webView.setLayoutParams(lp);
        } else {
            ViewGroup.LayoutParams lp = webView.getLayoutParams();
            lp.width = widthPx;
            webView.setLayoutParams(lp);
        }
    }
}
