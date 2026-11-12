package nl.ringapeldoorn.ringtools;

import android.view.View;
import android.view.ViewGroup;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** App-eigen beeldfase: Android 12+ staat geen foto/gradient in de systeemfase toe. */
@CapacitorPlugin(name = "RingtoolsSplash")
public class RingtoolsSplashPlugin extends Plugin {
    private View splash;

    @Override public void load() {
        if (!bridge.isMinimumWebViewInstalled()) return;
        getActivity().runOnUiThread(() -> {
            ViewGroup parent = getActivity().findViewById(android.R.id.content);
            splash = getActivity().getLayoutInflater().inflate(R.layout.ringtools_splash, parent, false);
            final View mark = splash.findViewById(R.id.ringtools_splash_mark);
            final int preferred = Math.round(192 * getContext().getResources().getDisplayMetrics().density);
            splash.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
                int size = Math.min(preferred, Math.min(r - l, b - t) / 2);
                ViewGroup.LayoutParams params = mark.getLayoutParams();
                if (size > 0 && (params.width != size || params.height != size)) {
                    params.width = size; params.height = size; mark.setLayoutParams(params);
                }
            });
            parent.addView(splash, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        });
    }

    @PluginMethod public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> { removeSplash(); call.resolve(); });
    }

    private void removeSplash() {
        if (splash != null) {
            if (splash.getParent() instanceof ViewGroup) ((ViewGroup) splash.getParent()).removeView(splash);
            splash = null;
        }
    }

    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::removeSplash);
    }
}
