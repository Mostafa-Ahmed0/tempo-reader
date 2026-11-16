package app.tempo.reader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (non-npm) plugins must be registered before the bridge is created in super.onCreate.
        registerPlugin(IncomingFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
