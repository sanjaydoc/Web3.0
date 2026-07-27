package com.web3.mobile;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Kill the WebView's vertical overscroll (the "stretch/glow" rubber-band). Otherwise
        // pulling down on a SHORT page (e.g. the near-empty Payments & ledger) bounces the whole
        // page, dragging the sticky top bar + its separation line downward and leaving blank space
        // above it — the "lowered header" only ever seen on short screens. CSS overscroll-behavior
        // isn't reliably honored by the Android System WebView, so disable it natively. This only
        // removes the overscroll effect; normal scrolling is unaffected.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        }
    }
}
