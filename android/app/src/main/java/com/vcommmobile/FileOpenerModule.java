package com.vcommmobile;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import java.io.File;

public class FileOpenerModule extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "FileOpener";

    public FileOpenerModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    @ReactMethod
    public void openFile(String filePath, String mimeType, Promise promise) {
        try {
            File file = new File(filePath);

            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "File does not exist: " + filePath);
                return;
            }

            ReactApplicationContext context = getReactApplicationContext();

            // Create content URI using FileProvider
            Uri contentUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                file
            );

            // Create intent to view the file
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, mimeType);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // Create chooser to let user select app
            Intent chooser = Intent.createChooser(intent, "Open with");
            chooser.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(chooser);
            promise.resolve("File opened successfully");

        } catch (Exception e) {
            promise.reject("OPEN_ERROR", "Failed to open file: " + e.getMessage(), e);
        }
    }
}
