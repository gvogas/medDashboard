// The iPhone, iPad and Mac app (docs/IOS.md). Capacitor wraps the front end that
// `npm run build:ios` puts in dist-ios/; `npm run ios:sync` copies it into ios/.
// appId must match the bundle id registered in your Apple Developer account.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.vogas.term',
  appName: 'Term',
  webDir: 'dist-ios',
  ios: {
    // The page draws under the notch and home bar itself (viewport-fit=cover, safe-area insets).
    contentInset: 'never',
    // Links to other sites (Spotify, a course link) open in Safari, not inside the app.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    LocalNotifications: { iconColor: '#0E7C74' },
  },
};

export default config;
