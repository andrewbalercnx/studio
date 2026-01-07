# Downloads Directory

This directory contains downloadable files for the StoryPic Kids app.

## Android APK

Place the built APK file here as `storypic-kids.apk`.

### Building the APK

From the `/mobile` directory:

```bash
# Development build (for testing)
npx eas build --platform android --profile development --local

# Preview build (APK for distribution)
npx eas build --platform android --profile preview --local
```

The output APK will be in `/mobile/android/app/build/outputs/apk/` or downloaded from EAS.

Copy the APK to this directory:
```bash
cp mobile/build-*.apk public/downloads/storypic-kids.apk
```

### Notes

- The APK should be signed with a release key for production distribution
- Keep the APK updated when new versions are released
- Consider versioning: `storypic-kids-v1.0.0.apk`
