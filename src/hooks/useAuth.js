// src/hooks/useAuth.js
console.log("[AUTH BUILD]", "2025-12-19T-ios-smooth-logout-v1");

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

// Web-only: short "recent logout" marker across Cognito redirect
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
 * Dynamic imports + plain-object wrappers to avoid iOS "Plugin.then()" issue.
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

  const handledAuthRef = useRef(false);
  const isLoggingOutRef = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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

  const login = useCallback(async ({ authMode } = {}) => {
    handledAuthRef.current = false;

    isLoggingOutRef.current = false;
    setIsLoggingOut(false);
    clearRecentLogout();

    setLoading(true);

    const params = new URLSearchParams(window.location.search);
    const mode = authMode || params.get("authMode"); // 'sf' for Salesforce
    const loginUrl =
      mode === "sf"
        ? buildAuthorizeUrl({ identityProvider: SALESFORCE_IDP_NAME })
        : buildAuthorizeUrl();

    if (Capacitor.isNativePlatform()) {
      const Browser = await getCapBrowser();
      if (!Browser?.open) {
        console.error("[auth] Browser plugin not available on native.");
        setLoading(false);
        return;
      }
      await Browser.open({ url: loginUrl });
      return;
    }

    window.location.href = loginUrl;
  }, []);

  useEffect(() => {
    let sub;

    async function ensureAuthenticated() {
      // 1) Web callback hash
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

      // 3) Web: don't auto-login immediately after logout
      if (!Capacitor.isNativePlatform() && hasRecentLogout()) {
        isLoggingOutRef.current = true;
        setIsLoggingOut(true);
        setLoading(false);
        return;
      }

      // 4) Start auth flow
      const params = new URLSearchParams(window.location.search);
      const authMode = params.get("authMode");
      const loginUrl =
        authMode === "sf"
          ? buildAuthorizeUrl({ identityProvider: SALESFORCE_IDP_NAME })
          : buildAuthorizeUrl();

      if (Capacitor.isNativePlatform()) {
        const Browser = await getCapBrowser();
        const CapApp = await getCapApp();

        if (!Browser?.open || !Browser?.close || !CapApp?.addListener || !CapApp?.getLaunchUrl) {
          console.error("[auth] Capacitor plugins not available (sync + rebuild).");
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

          // NO id_token:
          // - logout redirect back to app
          // - or user cancelled auth
          try {
            await Browser.close();
          } catch {}

          clearAuthState();

          const wasLogout = isLoggingOutRef.current === true;

          handledAuthRef.current = false;
          isLoggingOutRef.current = false;
          setIsLoggingOut(false);

          // ✅ Smooth native UX: if this was *our* logout, go straight to login Hosted UI
          if (wasLogout) {
            try {
              // Keep UI stable in-app; immediately open sign-in UI in browser
              await Browser.open({ url: loginUrl });
            } catch {}
          }
        };

        // cold start
        try {
          const launch = await CapApp.getLaunchUrl();
          if (launch?.url) {
            await handleAuthUrl(launch.url);
            if (handledAuthRef.current || isLoggingOutRef.current) return;
          }
        } catch {}

        // warm start
        sub = CapApp.addListener("appUrlOpen", async (event) => {
          await handleAuthUrl(event?.url || "");
        });

        // Only auto-open login if we aren't mid-logout
        if (!isLoggingOutRef.current) {
          await Browser.open({ url: loginUrl });
        } else {
          setLoading(false);
        }
        return;
      }

      // Web: normal redirect
      window.location.href = loginUrl;
    }

    ensureAuthenticated().catch((e) => {
      console.error("Auth guard error", e);
      setLoading(false);
    });

    return () => {
      try {
        sub?.remove?.();
      } catch {}
    };
  }, [applyToken, clearAuthState, loadValidStoredToken]);

  // Foreground re-validate (native)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let sub;
    let cancelled = false;

    (async () => {
      const CapApp = await getCapApp();
      if (cancelled || !CapApp?.addListener) return;

      sub = CapApp.addListener("appStateChange", (state) => {
        if (state?.isActive) loadValidStoredToken();
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

    if (!Capacitor.isNativePlatform()) {
      markRecentLogout();
    }

    const logoutUrl = buildLogoutUrl();

    // clear local state immediately (so the app UI updates right away)
    handledAuthRef.current = false;
    clearAuthState();

    if (Capacitor.isNativePlatform()) {
      const Browser = await getCapBrowser();
      if (!Browser?.open) {
        console.error("[auth] Browser plugin not available on native.");
        return;
      }
      await Browser.open({ url: logoutUrl });
      return;
    }

    window.location.replace(logoutUrl);
  }, [clearAuthState]);

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
    isLoggingOut,
  };
}