package nl.ringapeldoorn.ringtools;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;

@CapacitorPlugin(name = "Installation")
public class InstallationPlugin extends Plugin {
    @PluginMethod public void identity(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences("installation", Context.MODE_PRIVATE);
        String id = prefs.getString("id", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            if (!prefs.edit().putString("id", id).commit()) { call.reject("installation-unavailable"); return; }
        }
        JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
    }
}
