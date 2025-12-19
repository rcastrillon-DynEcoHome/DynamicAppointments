// src/hooks/useAuth.js
console.log("[AUTH BUILD]", "2025-12-19T-dynamic-cap-imports");

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

// ---- AUTH DEBUG BUFFER (helps when iOS fails before Safari inspector attaches) ----
const AUTH_DEBUG_KEY = "fsr_auth_debug_log";
function _appendAuthDebug(entry) {
  try {
    const line = `[${new Date().toISOString()}] ${entry}`;
    const existing = localStorage.getItem(AUTH_DEBUG_KEY);
    const lines = existing ? existing.split("\n") : [];
    lines.push(line);
    // keep last 200 lines
    const trimmed = lines.slice(-200);
    localStorage.setItem(AUTH_DEBUG_KEY, trimmed.join("\n"));
  } catch {}
}

function getAuthDebugLog() {
  try {
    return localStorage.getItem(AUTH_DEBUG_KEY) || "";
  } catch {
    return "";
  }
}

function clearAuthDebugLog() {
  try {
    localStorage.removeItem(AUTH_DEBUG_KEY);
  } catch {}
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

// ✅ Return a NON-thenable wrapper so `await` doesn't trigger CapacitorPlugin.then()
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
    _appendAuthDebug(`Failed to load @capacitor/browser: ${e?.message || String(e)}`);
    return null;
  }
}

// ✅ Return a NON-thenable wrapper so `await` doesn't trigger CapacitorPlugin.then()
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
    _appendAuthDebug(`Failed to load @capacitor/app: ${e?.message || String(e)}`);
    return null;
  }
}

export function useAuth() {
  const [idToken, setIdToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const handledAuthRef = useRef(false);
  const isLoggingOutRef = useRef(false);

  const [lastAuthError, setLastAuthError] = useState("");

  // If you launch with ?debugAuth=1 we will NOT auto-open Hosted UI.
  // This gives you time to attach Safari Web Inspector and view logs.
  const debugAuth = (() => {
    try {
      return new URLSearchParams(window.location.search).get("debugAuth") === "1";
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Capture early fatal errors into the debug buffer
    const onErr = (msg, src, line, col, err) => {
      _appendAuthDebug(`window.onerror: ${msg} @${src}:${line}:${col} ${(err?.message || "").trim()}`);
      setLastAuthError(String(msg || ""));
      // don't prevent default
      return false;
    };

    const onRej = (ev) => {
      _appendAuthDebug(`unhandledrejection: ${ev?.reason?.message || String(ev?.reason)}`);
      setLastAuthError(String(ev?.reason?.message || ev?.reason || ""));
    };

    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);

    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  const clearAuthState = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_INFO_KEY);
    setIdToken(null);
    setUser(null);
    setLastAuthError("");
    setLoading(false);
  }, []);

  const applyToken = useCallback((token) => {
    isLoggingOutRef.current = false;
    handledAuthRef.current = true;

    localStorage.setItem(TOKEN_KEY, token);

    const claims = decodeJwt(token) || {};
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(claims));

    setIdToken(token);
    setUser(claims);
    setLastAuthError("");
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

  // ✅ Expose login() to start Hosted UI explicitly
  const login = useCallback(async ({ authMode } = {}) => {
    handledAuthRef.current = false;
    isLoggingOutRef.current = false;
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
        console.error("[auth] Browser plugin not available on native. Did you run: npx cap sync ios/android and rebuild?");
        setLoading(false);
        return;
      }
      _appendAuthDebug(`login(): opening Hosted UI. mode=${mode || ""}`);
      await Browser.open({ url: loginUrl });
      return;
    }

    window.location.href = loginUrl;
  }, []);

  useEffect(() => {
    let sub;

    async function ensureAuthenticated() {
      // 1) Web callback
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

      // 3) Start auth flow
      const params = new URLSearchParams(window.location.search);
      const authMode = params.get("authMode");

      const loginUrl =
        authMode === "sf"
          ? buildAuthorizeUrl({ identityProvider: SALESFORCE_IDP_NAME })
          : buildAuthorizeUrl();

      if (Capacitor.isNativePlatform()) {
        _appendAuthDebug(`ensureAuthenticated(): native start. authMode=${authMode || ""} debugAuth=${debugAuth}`);

        if (debugAuth) {
          _appendAuthDebug("debugAuth=1 set; skipping auto Browser.open so you can attach inspector.");
          setLoading(false);
          return;
        }

        const Browser = await getCapBrowser();
        const CapApp = await getCapApp();

        if (!CapApp?.addListener || !CapApp?.getLaunchUrl) {
          console.error("[auth] App plugin not available on native. Did you run: npx cap sync ios/android and rebuild?");
          setLoading(false);
          return;
        }

        if (!Browser?.open) {
          console.error("[auth] Browser plugin not available on native. Did you run: npx cap sync ios/android and rebuild?");
          setLoading(false);
          return;
        }

        const handleAuthUrl = async (url) => {
          console.log("[auth] received app url:", url);
          _appendAuthDebug(`handleAuthUrl(): ${url}`);
          if (!url) return;
          if (!url.startsWith(NATIVE_REDIRECT_URI)) return;

          const cb = parseHashFragmentFromUrl(url);

          // LOGIN callback
          if (cb.id_token) {
            if (handledAuthRef.current) return;
            handledAuthRef.current = true;
            isLoggingOutRef.current = false;

            try {
              await Browser.close();
            } catch {}

            applyToken(cb.id_token);
            return;
          }

          // LOGOUT callback (redirect back without hash) OR cancelled login
          try {
            await Browser.close();
          } catch {}

          clearAuthState();
          handledAuthRef.current = false;
          isLoggingOutRef.current = false;
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

        await Browser.open({ url: loginUrl });
        return;
      }

      // Web: normal redirect
      window.location.href = loginUrl;
    }

    ensureAuthenticated().catch((e) => {
      console.error("Auth guard error", e);
      _appendAuthDebug(`Auth guard error: ${e?.message || String(e)}`);
      setLastAuthError(e?.message || String(e));
      setLoading(false);
    });

    return () => {
      try {
        sub?.remove?.();
      } catch {}
    };
  }, [applyToken, clearAuthState, loadValidStoredToken]);

  // Re-validate on foreground (prevents overnight “broken buttons” state)
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
    // clear state immediately
    isLoggingOutRef.current = true;
    handledAuthRef.current = false;
    clearAuthState();

    const logoutUrl =
      `${COGNITO_DOMAIN}/logout` +
      `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
      `&logout_uri=${encodeURIComponent(getRedirectUri())}`;

    if (Capacitor.isNativePlatform()) {
      const Browser = await getCapBrowser();
      if (!Browser?.open) {
        console.error("[auth] Browser plugin not available on native. Did you run: npx cap sync ios/android and rebuild?");
        return;
      }
      await Browser.open({ url: logoutUrl });
      return;
    }

    window.location.href = logoutUrl;
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
    lastAuthError,
    authDebugLog: getAuthDebugLog(),
    clearAuthDebugLog,
  };
}