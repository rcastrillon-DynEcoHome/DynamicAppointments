// src/hooks/useAuth.js
import { useEffect, useState, useCallback } from "react";

/**
 * ========= COGNITO / AUTH CONFIG =========
 * These match your original app.js values.
 */

const COGNITO_DOMAIN = "https://dynamicslr.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "opd5uv78vk3c8lglreo4jhkue";
// NOTE: For dev, you *may* want window.location.origin as redirect,
// but this keeps your current production URL:
const APP_URL = window.location.origin + "/"; 
const OAUTH_SCOPE = "email openid profile";
const OAUTH_RESPONSE_TYPE = "token";
const SALESFORCE_IDP_NAME = "Salesforce"; // must match provider name in Cognito

// LocalStorage keys
const TOKEN_KEY = "fsr_id_token";
const USER_INFO_KEY = "fsr_user_info";

/* ========== HELPERS ========== */

function parseHashFragment() {
  if (!window.location.hash) return {};
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
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

function buildSalesforceLoginUrl() {
  const redirectUri = encodeURIComponent(APP_URL);
  const scope = encodeURIComponent(OAUTH_SCOPE);

  return (
    `${COGNITO_DOMAIN}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
    `&response_type=${encodeURIComponent(OAUTH_RESPONSE_TYPE)}` +
    `&scope=${scope}` +
    `&redirect_uri=${redirectUri}` +
    `&identity_provider=${encodeURIComponent(SALESFORCE_IDP_NAME)}`
  );
}

function buildGenericLoginUrl() {
  const redirectUri = encodeURIComponent(APP_URL);
  const scope = encodeURIComponent(OAUTH_SCOPE);

  return (
    `${COGNITO_DOMAIN}/login` +
    `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
    `&response_type=${encodeURIComponent(OAUTH_RESPONSE_TYPE)}` +
    `&scope=${scope}` +
    `&redirect_uri=${redirectUri}`
  );
}

/**
 * useAuth:
 * - Mirrors ensureAuthenticated() from your old app.js
 * - On mount:
 *    1) If id_token in hash: store and use it
 *    2) Else if valid token in localStorage: reuse
 *    3) Else redirect to Salesforce or generic Hosted UI depending on ?authMode
 * - Exposes user + idToken + logout()
 */
export function useAuth() {
  const [idToken, setIdToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function ensureAuthenticated() {
      // 1) Just returned from Cognito?
      const hashParams = parseHashFragment();
      if (hashParams.id_token) {
        const token = hashParams.id_token;
        localStorage.setItem(TOKEN_KEY, token);

        const claims = decodeJwt(token) || {};
        localStorage.setItem(USER_INFO_KEY, JSON.stringify(claims));

        setIdToken(token);
        setUser(claims);

        // Clean URL (remove hash, keep query params like authMode/appointmentId)
        const cleanUrl = APP_URL + window.location.search;
        window.history.replaceState({}, document.title, cleanUrl);

        setLoading(false);
        return;
      }

      // 2) Existing token in localStorage
      const existing = localStorage.getItem(TOKEN_KEY);
      if (existing) {
        const claims = decodeJwt(existing);
        if (claims && claims.exp * 1000 > Date.now()) {
          setIdToken(existing);
          setUser(claims);
          setLoading(false);
          return;
        }
        // Expired
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_INFO_KEY);
      }

      // 3) No valid token → redirect to login
      const params = new URLSearchParams(window.location.search);
      const authMode = params.get("authMode"); // 'sf' for Salesforce

      const loginUrl =
        authMode === "sf"
          ? buildSalesforceLoginUrl()
          : buildGenericLoginUrl();

      window.location.href = loginUrl;
    }

    try {
      ensureAuthenticated();
    } catch (e) {
      console.error("Auth guard error", e);
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_INFO_KEY);

    const logoutUrl =
      `${COGNITO_DOMAIN}/logout` +
      `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
      `&logout_uri=${encodeURIComponent(APP_URL)}`;

    window.location.href = logoutUrl;
  }, []);

  // Normalized user object (like your old currentUser)
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

  return {
    idToken,
    user: normalizedUser,
    rawClaims: user,
    loading,
    isAuthenticated: !!idToken,
    logout,
  };
}
