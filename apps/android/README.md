# PlotCheck — Android test app

A thin Android app around the web app (test deployment): full-screen WebView with location (GPS
for "find the plot I'm standing on"), file picking (DXF/KML/GeoJSON/CSV/Excel imports) and
downloads (PDF/KML/DXF/GeoJSON) saved to Downloads. Links to other sites open in the browser.
The URL is `APP_URL` in `app/build.gradle` (default: the Netlify test site; `-PappUrl=…` to change).

The native app with a native map (MapLibre for React Native) comes with the store builds.

## Build

Needs JDK 17+, Gradle 8.14 and the Android SDK (platform 35, build-tools 35).

```bash
keytool -genkeypair -keystore keystore/test.jks -alias plotcheck-test -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=PlotCheck Test, O=PlotCheck, C=CY"
```

```bash
PLOTCHECK_KEYSTORE=$PWD/keystore/test.jks PLOTCHECK_KEYSTORE_PASSWORD=... ANDROID_HOME=/opt/android-sdk gradle assembleRelease
```

The APK is `app/build/outputs/apk/release/app-release.apk`; `tools/build_netlify.sh` copies it to the
test site as `/plotcheck-test.apk` (download page: `/android.html`).

The signing key is not in the repository. Keep it: an update signed with another key will not
install over the old app (uninstall first).
