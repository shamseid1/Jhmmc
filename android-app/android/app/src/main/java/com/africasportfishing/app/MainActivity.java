package com.africasportfishing.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;
import java.util.List;

/**
 * The Africa Sportfishing site (africasportfishing.com) in a native shell.
 * - Location: the Geolocation plugin asks with Android's own dialog and, when the
 *   phone's location is off, offers to turn it on right there (no trip to Settings).
 * - Photos: "from photos" buttons open Android's photo picker (the gallery), not a file browser.
 * - Notifications: Firebase Cloud Messaging, through the PushNotifications plugin.
 * - Back: goes back a page in the app, and closes it on the first page.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        webView.setWebChromeClient(new PhotoPickerChromeClient(bridge));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });
        // Android 8+: notifications go in a channel the person can see in Settings.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("club", "Club notifications", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Weigh-ins, fish logged and club announcements");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    /** File inputs: picking existing photos or videos opens the photo picker; taking one opens the camera. */
    static class PhotoPickerChromeClient extends BridgeWebChromeClient {
        private ValueCallback<Uri[]> pending;
        private final ActivityResultLauncher<PickVisualMediaRequest> pickOne;
        private final ActivityResultLauncher<PickVisualMediaRequest> pickMany;

        PhotoPickerChromeClient(Bridge bridge) {
            super(bridge);
            pickOne = bridge.registerForActivityResult(new ActivityResultContracts.PickVisualMedia(), (uri) ->
                deliver(uri == null ? null : new Uri[] { uri }));
            pickMany = bridge.registerForActivityResult(new ActivityResultContracts.PickMultipleVisualMedia(), (uris) ->
                deliver(uris == null || uris.isEmpty() ? null : uris.toArray(new Uri[0])));
        }

        private void deliver(Uri[] uris) {
            if (pending != null) pending.onReceiveValue(uris);
            pending = null;
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
            List<String> types = Arrays.asList(params.getAcceptTypes());
            boolean images = types.contains("image/*");
            boolean videos = types.contains("video/*");
            boolean onlyMedia = (images || videos) && types.stream().allMatch((t) -> t.startsWith("image/") || t.startsWith("video/"));
            if (params.isCaptureEnabled() || !onlyMedia) return super.onShowFileChooser(webView, callback, params);
            if (pending != null) pending.onReceiveValue(null);
            pending = callback;
            ActivityResultContracts.PickVisualMedia.VisualMediaType kind = images && videos
                ? ActivityResultContracts.PickVisualMedia.ImageAndVideo.INSTANCE
                : images ? ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE
                : ActivityResultContracts.PickVisualMedia.VideoOnly.INSTANCE;
            PickVisualMediaRequest request = new PickVisualMediaRequest.Builder().setMediaType(kind).build();
            if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pickMany.launch(request);
            else pickOne.launch(request);
            return true;
        }
    }
}
