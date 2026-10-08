// app.config.json → every file that repeats one of its values (docs/IOS-TESTING.md). Pure: each
// function takes a file's text and returns the new text, so `ios:configure` writes them and
// `ios:doctor` and the tests can check them without touching the disk.

/** The files `ios:configure` keeps in step, relative to the repo, and what changes in each. */
export const FILES = {
  capacitor: 'capacitor.config.ts',
  pbxproj: 'ios/App/App.xcodeproj/project.pbxproj',
  appEntitlements: 'ios/App/App/App.entitlements',
  widgetEntitlements: 'ios/App/TermWidget/TermWidget.entitlements',
  pluginSwift: 'native/term-widgets/ios/Sources/TermWidgetsPlugin/TermWidgetsPlugin.swift',
  widgetSwift: 'ios/App/TermWidget/TermWidgetData.swift',
  wrangler: 'wrangler.jsonc',
};

const BUNDLE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** What is wrong with the config, as sentences; empty when it is usable. */
export function problems(cfg) {
  const out = [];
  if (!BUNDLE.test(cfg.bundleId || '')) out.push('bundleId must look like com.example.term');
  if (cfg.teamId && !/^[A-Z0-9]{10}$/.test(cfg.teamId)) out.push('teamId is the 10-character Team ID from developer.apple.com → Membership');
  if (!/^group\.[A-Za-z0-9.-]+$/.test(cfg.appGroup || '')) out.push('appGroup must start with "group.", like group.com.example.term');
  if (!Number.isInteger(cfg.build) || cfg.build < 1) out.push('build must be a whole number from 1 (raise it for every upload)');
  try { if (!/^https?:$/.test(new URL(cfg.apiBase).protocol)) throw 0; } catch { out.push('apiBase must be the Worker\'s address, like https://rounds.example.workers.dev'); }
  if (cfg.revenueCatIosKey && !/^appl_[A-Za-z0-9]+$/.test(cfg.revenueCatIosKey)) out.push('revenueCatIosKey is RevenueCat\'s public Apple key, starting appl_');
  if (cfg.appleServicesId && !BUNDLE.test(cfg.appleServicesId)) out.push('appleServicesId must look like com.example.term.web');
  if (cfg.appleServicesId && cfg.appleServicesId === cfg.bundleId) out.push('appleServicesId must differ from bundleId');
  if (cfg.appleKeyId && !/^[A-Z0-9]{10}$/.test(cfg.appleKeyId)) out.push('appleKeyId is the 10-character Key ID of the Sign in with Apple key');
  for (const k of ['signInWithApple', 'paywall', 'sandboxPurchases']) if (typeof cfg[k] !== 'boolean') out.push(`${k} must be true or false`);
  return out;
}

/** What is still missing before each part can be tested, by part. */
export function missing(cfg) {
  return {
    signing: cfg.teamId ? [] : ['teamId'],
    purchases: cfg.revenueCatIosKey ? [] : ['revenueCatIosKey'],
    signInWithApple: !cfg.signInWithApple ? ['signInWithApple: true'] : [],
    signInWithAppleWeb: cfg.signInWithApple && !cfg.appleServicesId ? ['appleServicesId'] : [],
    appleRevoke: cfg.signInWithApple && !cfg.appleKeyId ? ['appleKeyId'] : [],
  };
}

const replaceAll = (text, re, fn) => text.replace(re, fn);

export const capacitor = (text, cfg) => replaceAll(text, /appId: '[^']*'/, () => `appId: '${cfg.bundleId}'`);

/** The Xcode project: bundle ids (the widget's is the app's + ".widget"), the team, the version and the build. */
export function pbxproj(text, cfg, version) {
  let out = text.replace(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g, (_, id) =>
    `PRODUCT_BUNDLE_IDENTIFIER = ${id.trim().replace(/"/g, '').endsWith('.widget') ? cfg.bundleId + '.widget' : cfg.bundleId};`);
  out = out.replace(/\n\t*DEVELOPMENT_TEAM = [^;]*;/g, '');
  if (cfg.teamId) out = out.replace(/(\n(\t*)CODE_SIGN_STYLE = Automatic;)/g, `$1\n$2DEVELOPMENT_TEAM = ${cfg.teamId};`);
  out = out.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  out = out.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${cfg.build};`);
  return out;
}

export const entitlements = (text, cfg) => text.replace(/<string>group\.[^<]*<\/string>/g, `<string>${cfg.appGroup}</string>`);

export const swiftGroup = (text, cfg) => text.replace(/static let group = "[^"]*"/, `static let group = "${cfg.appGroup}"`);

/** The Worker's settings: who Sign in with Apple is for, the paywall and sandbox switches. */
export function wrangler(text, cfg) {
  const set = (t, key, value) => {
    const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
    if (!re.test(t)) throw new Error(`wrangler.jsonc has no "${key}" in vars`);
    return t.replace(re, `$1"${value}"`);
  };
  let out = text;
  out = set(out, 'APPLE_CLIENT_IDS', cfg.signInWithApple ? [cfg.bundleId, cfg.appleServicesId].filter(Boolean).join(',') : '');
  out = set(out, 'APPLE_TEAM_ID', cfg.signInWithApple ? cfg.teamId : '');
  out = set(out, 'APPLE_KEY_ID', cfg.signInWithApple ? cfg.appleKeyId : '');
  out = set(out, 'PAYWALL', cfg.paywall ? 'on' : 'off');
  out = set(out, 'BILLING_SANDBOX', cfg.sandboxPurchases ? 'on' : 'off');
  return out;
}

/** Every file's new text, by FILES key. `read(key)` gives a file's current text, or null when it is not there. */
export function applyConfig(cfg, read, version) {
  const out = {};
  const run = (key, fn) => { const t = read(key); if (t !== null) out[key] = fn(t); };
  run('capacitor', (t) => capacitor(t, cfg));
  run('pbxproj', (t) => pbxproj(t, cfg, version));
  run('appEntitlements', (t) => entitlements(t, cfg));
  run('widgetEntitlements', (t) => entitlements(t, cfg));
  run('pluginSwift', (t) => swiftGroup(t, cfg));
  run('widgetSwift', (t) => swiftGroup(t, cfg));
  run('wrangler', (t) => wrangler(t, cfg));
  return out;
}

/** The build-time values the front end reads (vite.config.ts): for the app build, and for the website. */
export function viteEnv(cfg, ios) {
  return ios ? {
    VITE_API_BASE: cfg.apiBase,
    VITE_REVENUECAT_IOS_KEY: cfg.revenueCatIosKey,
    VITE_APPLE_APP_ID: cfg.signInWithApple ? cfg.bundleId : '',
  } : {
    VITE_APPLE_WEB_CLIENT_ID: cfg.signInWithApple ? cfg.appleServicesId : '',
  };
}
