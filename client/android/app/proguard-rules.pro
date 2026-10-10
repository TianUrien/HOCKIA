# HOCKIA release shrinking rules (R8). Capacitor core ships consumer rules that
# keep every class extending com.getcapacitor.Plugin (our InstallReferrerPlugin
# included) and their @PluginMethod methods; Sentry, Firebase Messaging and the
# AndroidX libraries ship their own. These rules cover what is left.

# The WebView <-> native bridge is called from JavaScript by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Readable native stack traces (Sentry / Play Console): keep line numbers, hide
# the original file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations Capacitor reads at runtime to register plugins and permissions.
-keepattributes *Annotation*
