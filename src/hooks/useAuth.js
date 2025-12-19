// src/hooks/useAuth.js
console.log("[AUTH BUILD]", "2025-12-19T-native-single-browser-open");

import { useEffect, useState, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * ========= COGNITO / AUTH CONFIG =========
 */
const COGNITO_DOMAIN = "https://dynamicslr.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "opd5uv78vk3c8lglreo4jhkue";
const OAUTH_SCOPE = "email openid profile";
const OAUTH_RESPONSE_TYPE = "token";
const SALESFORCE_IDP_NAME = "Salesforce";

const NATIVE_REDIRECT_URI = "dynappointments://auth";
const WEB_REDIRECT_URI = window.location.origin + "/";

const TOKEN_KEY = "fsr_id_token";
const USER_INFO_KEY = "fsr_user_info";

// Web-only: keep a short "recent logout" marker across the Cognito redirect
const LOGOUT_MARK_KEY = "fsr_recent_logout_ms";
const LOGOUT_MARK_TTL_MS = 2 * 60 * 1000; // 2 minutes

function _now() {
  return Date.now();
}
function markRecentLogout() {
  try {
    sessionStorage.setItem(LOGOUT_MARK_KEY, String(_now()));
  } catch {}
}
function clearRecentLogout() {
  try {
    sessionStorage.removeItem(LOGOUT_MARK_KEY);
  } catch {}
}
function hasRecentLogout() {
  try {
    const v = sessionStorage.getItem(LOGOUT_MARK_KEY);
    const ms = v ? Number(v) : 0;
    return ms > 0 && _now() - ms < LOGOUT_MARK_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * IMPORTANT:
 * Load Capacitor plugins dynamically AND wrap them in plain objects
 * to avoid iOS "Browser.then()" issues AND avoid thenable await traps.
 */
async function getCapBrowser() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import("@capacitor/browser");
    const Browser = mod.Browser;
    if (!Browser) return null;

    return {
      open: (opts) => Browser.open(opts),
      close: () => Browser.close(),
    };
  } catch (e) {
    console.error("[auth] Failed to load @capacitor/browser", e);
    return null;
  }
}

async function getCapApp() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import("@capacitor/app");
    const App = mod.App;
    if (!App) return null;

    return {
      getLaunchUrl: () => App.getLaunchUrl(),
      addListener: (eventName, cb) => App.addListener(eventName, cb),
    };
  } catch (e) {
    console.error("[auth] Failed to load @capacitor/app", e);
    return null;
  }
}

function getRedirectUri() {
  return Capacitor.isNativePlatform() ? NATIVE_REDIRECT_URI : WEB_REDIRECT_URI;
}

function parseHashFragmentFromUrl(urlString) {
  if (!urlString) return {};
  const hashIndex = urlString.indexOf("#");
  if (hashIndex === -1) return {};
  const hash = urlString.slice(hashIndex + 1);
  const params = new URLSearchParams(hash);
  const result = {};
  for (const [key, value] of params.entries()) result[key] = value;
  return result;
}

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch (e) {
    console.error("Failed to decode JWT", e);
    return null;
  }
}

function buildAuthorizeUrl({ identityProvider } = {}) {
  const redirectUri = encodeURIComponent(getRedirectUri());
  const scope = encodeURIComponent(OAUTH_SCOPE);

  let url =
    `${COGNITO_DOMAIN}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
    `&response_type=${encodeURIComponent(OAUTH_RESPONSE_TYPE)}` +
    `&scope=${scope}` +
    `&redirect_uri=${redirectUri}`;

  if (identityProvider) {
    url += `&identity_provider=${encodeURIComponent(identityProvider)}`;
  }

  return url;
}

function buildLogoutUrl() {
  return (
    `${COGNITO_DOMAIN}/logout` +
    `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
    `&logout_uri=${encodeURIComponent(getRedirectUri())}`
  );
}

export function useAuth() {
  const [idToken, setIdToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Prevent duplicate callback handling
  const handledAuthRef = useRef(false);

  // Track a logout flow
  const isLoggingOutRef = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // ✅ iOS: prevent Browser.open from being called twice (this is the root of your flicker)
  const browserOpenInFlightRef = useRef(false);

  // Optional: drive an overlay in App during native transitions (logout->login)
  const [nativeAuthTransition, setNativeAuthTransition] = useState(false);

  // Remember last authMode so logout can return to same login provider
  const lastAuthModeRef = useRef("");

  const clearAuthState = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_INFO_KEY);
    setIdToken(null);
    setUser(null);
    setLoading(false);
  }, []);

  const applyToken = useCallback((token) => {
    isLoggingOutRef.current = false;
    setIsLoggingOut(false);
    clearRecentLogout();
    setNativeAuthTransition(false);

    handledAuthRef.current = true;

    localStorage.setItem(TOKEN_KEY, token);

    const claims = decodeJwt(token) || {};
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(claims));

    setIdToken(token);
    setUser(claims);
    setLoading(false);
  }, []);

  const loadValidStoredToken = useCallback(() => {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (!existing) return null;

    const claims = decodeJwt(existing);
    const expMs = claims?.exp ? claims.exp * 1000 : 0;

    if (claims && expMs > Date.now()) {
      setIdToken(existing);
      setUser(claims);
      setLoading(false);
      return existing;
    }

    clearAuthState();
    return null;
  }, [clearAuthState]);

  // ✅ Single authority opener for native
  const openHostedUiNative = useCallback(
    async (url) => {
      if (!Capacitor.isNativePlatform()) return;

      // Hard guard: if already opening/presented, do nothing.
      if (browserOpenInFlightRef.current) return;

      const Browser = await getCapBrowser();
      if (!Browser?.open) {
        console.error("[auth] Browser plugin not available on native.");
        return;
      }

      browserOpenInFlightRef.current = true;
      try {
        await Browser.open({ url });
      } catch (e) {
        // This is your "Unable to display URL" case
        console.error("[auth] Browser.open failed:", e);
      } finally {
        // Release in-flight guard slightly later so iOS has time to settle
        setTimeout(() => {
          browserOpenInFlightRef.current = false;
        }, 350);
      }
    },
    []
  );

  const login = useCallback(
    async ({ authMode } = {}) => {
      handledAuthRef.current = false;

      // user initiated login clears logout markers
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
      clearRecentLogout();
      setNativeAuthTransition(true);

      setLoading(true);

      const params = new URLSearchParams(window.location.search);
      const mode = authMode || params.get("authMode") || "";
      lastAuthModeRef.current = mode;

      const loginUrl =
        mode === "sf"
          ? buildAuthorizeUrl({ identityProvider: SALESFORCE_IDP_NAME })
          : buildAuthorizeUrl();

      if (Capacitor.isNativePlatform()) {
        await openHostedUiNative(loginUrl);
        // Do NOT setLoading(false) here; we’ll resolve on callback
        return;
      }

      window.location.href = loginUrl;
    },
    [openHostedUiNative]
  );

  useEffect(() => {
    let sub;

    async function ensureAuthenticated() {
      // 1) Web hash callback
      const hashParams = parseHashFragmentFromUrl(window.location.href);
      if (hashParams.id_token) {
        applyToken(hashParams.id_token);
        window.history.replaceState(
          {},
          document.title,
          WEB_REDIRECT_URI + window.location.search
        );
        return;
      }

      // 2) Existing token
      if (loadValidStoredToken()) return;

      // 3) Web: if we JUST logged out, do NOT auto-start login again
      if (!Capacitor.isNativePlatform() && hasRecentLogout()) {
        isLoggingOutRef.current = true;
        setIsLoggingOut(true);
        setLoading(false);
        return;
      }

      // 4) Start auth flow (AUTO) — but only from here (App.jsx will NOT auto-login on native)
      const params = new URLSearchParams(window.location.search);
      const authMode = params.get("authMode") || "";
      lastAuthModeRef.current = authMode;

      const loginUrl =
        authMode === "sf"
          ? buildAuthorizeUrl({ identityProvider: SALESFORCE_IDP_NAME })
          : buildAuthorizeUrl();

      if (Capacitor.isNativePlatform()) {
        const CapApp = await getCapApp();
        if (!CapApp?.addListener || !CapApp?.getLaunchUrl) {
          console.error("[auth] App plugin not available (sync + rebuild).");
          setLoading(false);
          return;
        }

        const Browser = await getCapBrowser();
        if (!Browser?.close) {
          console.error("[auth] Browser plugin not available (sync + rebuild).");
          setLoading(false);
          return;
        }

        const handleAuthUrl = async (url) => {
          if (!url) return;
          if (!url.startsWith(NATIVE_REDIRECT_URI)) return;

          const cb = parseHashFragmentFromUrl(url);

          // LOGIN callback
          if (cb.id_token) {
            if (handledAuthRef.current) return;
            handledAuthRef.current = true;

            isLoggingOutRef.current = false;
            setIsLoggingOut(false);

            try {
              await Browser.close();
            } catch {}

            applyToken(cb.id_token);
            return;
          }

          // LOGOUT callback (redirect back without hash) OR canceled login
          try {
            await Browser.close();
          } catch {}

          clearAuthState();
          handledAuthRef.current = false;

          // If we were logging out, immediately go back to login Hosted UI
          // (prevents blank “in-between” state)
          if (isLoggingOutRef.current) {
            isLoggingOutRef.current = false;
            setIsLoggingOut(false);
            setNativeAuthTransition(true);

            // Small delay to allow iOS to finish dismissing SafariVC
            const mode = lastAuthModeRef.current || "";
            const nextLoginUrl =
              mode === "sf"
                ? buildAuthorizeUrl({ identityProvider: SALESFORCE_IDP_NAME })
                : buildAuthorizeUrl();

            setTimeout(() => {
              openHostedUiNative(nextLoginUrl);
            }, 400);
          } else {
            setNativeAuthTransition(false);
          }
        };

        // cold start
        try {
          const launch = await CapApp.getLaunchUrl();
          if (launch?.url) {
            await handleAuthUrl(launch.url);
            if (handledAuthRef.current) return;
          }
        } catch {}

        // warm start
        sub = CapApp.addListener("appUrlOpen", async (event) => {
          await handleAuthUrl(event?.url || "");
        });

        // ✅ Auto-open login once (guarded)
        setNativeAuthTransition(true);
        await openHostedUiNative(loginUrl);
        return;
      }

      // Web: normal redirect
      window.location.href = loginUrl;
    }

    ensureAuthenticated().catch((e) => {
      console.error("Auth guard error", e);
      setLoading(false);
      setNativeAuthTransition(false);
    });

    return () => {
      try {
        sub?.remove?.();
      } catch {}
    };
  }, [applyToken, clearAuthState, loadValidStoredToken, openHostedUiNative]);

  // Re-validate on foreground (native)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let sub;
    let cancelled = false;

    (async () => {
      const CapApp = await getCapApp();
      if (cancelled || !CapApp?.addListener) return;

      sub = CapApp.addListener("appStateChange", (state) => {
        if (state?.isActive) {
          loadValidStoredToken();
        }
      });
    })().catch(() => {});

    return () => {
      cancelled = true;
      try {
        sub?.remove?.();
      } catch {}
    };
  }, [loadValidStoredToken]);

  const logout = useCallback(async () => {
    // mark logging out
    isLoggingOutRef.current = true;
    setIsLoggingOut(true);
    setNativeAuthTransition(true);

    // Web needs persistence across the Cognito redirect
    if (!Capacitor.isNativePlatform()) markRecentLogout();

    const logoutUrl = buildLogoutUrl();

    // clear local state immediately
    handledAuthRef.current = false;
    clearAuthState();

    if (Capacitor.isNativePlatform()) {
      await openHostedUiNative(logoutUrl);
      return;
    }

    window.location.replace(logoutUrl);
  }, [clearAuthState, openHostedUiNative]);

  let normalizedUser = null;
  if (user) {
    const fullName =
      (user.given_name && user.family_name
        ? `${user.given_name} ${user.family_name}`
        : user.name) ||
      user.email ||
      user["cognito:username"];

    normalizedUser = {
      sub: user.sub,
      email: user.email,
      givenName: user.given_name,
      familyName: user.family_name,
      name: fullName,
    };
  }

  const computedIsAuthenticated = (() => {
    if (!idToken) return false;
    const claims = decodeJwt(idToken);
    const expMs = claims?.exp ? claims.exp * 1000 : 0;
    return !!expMs && expMs > Date.now();
  })();

  return {
    idToken,
    user: normalizedUser,
    rawClaims: user,
    loading,
    isAuthenticated: computedIsAuthenticated,
    login,
    logout,
    isLoggingOut, // web: disables auto-login after logout
    nativeAuthTransition, // native: show overlay during transitions
  };
}