package nl.ringapeldoorn.ringtools;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstallationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
