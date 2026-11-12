package nl.ringapeldoorn.ringtools;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;
import org.json.JSONException;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstallationPlugin.class);
        registerPlugin(RingtoolsSplashPlugin.class);
        super.onCreate(savedInstanceState);
    }
    @Override protected void load() {
        if (config == null) config = CapConfig.loadDefault(this);
        try {
            // Laat Androids effen systeemfase automatisch eindigen bij het eerste
            // native frame. De eigen beeldfase blijft tot dezelfde JS-hide-aanroep.
            config.getPluginConfiguration("SplashScreen").getConfigJSON().put("launchShowDuration", 0);
        } catch (JSONException error) {
            Logger.warn("Native splashconfiguratie kon niet worden ingesteld.");
        }
        super.load();
    }
}
