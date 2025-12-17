// src/lib/sfDeepLink.js
// Deep-link helpers for BOTH web/PWA and Capacitor native builds.
// IMPORTANT: Do NOT import "@capacitor/app" (static or dynamic) to keep Vite builds happy.

import { Capacitor } from "@capacitor/core";

const RETURN_KEY = "sf_return_url";

export function captureSalesforceReturnUrlFromLocation(locationHref = window.location.href) {
  try {
    const url = new URL(locationHref);
    const params = url.searchParams;
    const raw = params.get("returnUrl") || params.get("returnTo") || params.get("back") || "";
    if (!raw) return "";

    const decoded = decodeURIComponent(raw);
    window.localStorage.setItem(RETURN_KEY, decoded);
    return decoded;
  } catch (e) {
    console.warn("Failed to capture Salesforce return URL", e);
    return "";
  }
}

export function getSavedSalesforceReturnUrl() {
  try {
    return window.localStorage.getItem(RETURN_KEY) || "";
  } catch {
    return "";
  }
}

export function clearSavedSalesforceReturnUrl() {
  try {
    window.localStorage.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Field Service Mobile record deep link:
 *   com.salesforce.fieldservice://v1/sObject/<recordId>
 */
export function buildFieldServiceRecordDeepLink(recordId) {
  if (!recordId) return "";
  return `com.salesforce.fieldservice://v1/sObject/${encodeURIComponent(recordId)}`;
}

function isNativePlatform() {
  try {
    if (typeof Capacitor.isNativePlatform === "function") return Capacitor.isNativePlatform();
    return (Capacitor.getPlatform?.() || "web") !== "web";
  } catch {
    return false;
  }
}

/**
 * Open a deep link URL.
 * - Native: use Capacitor.Plugins.App.openUrl if available (no dependency on @capacitor/app at build time)
 * - Web/PWA: window.location.href
 */
export async function openDeepLink(url) {
  if (!url) return;

  if (!isNativePlatform()) {
    window.location.href = url;
    return;
  }

  // Try Capacitor App plugin via runtime registry (works if the plugin exists in native build)
  try {
    const appPlugin = Capacitor?.Plugins?.App;
    if (appPlugin?.openUrl) {
      await appPlugin.openUrl({ url });
      return;
    }
  } catch (e) {
    console.warn("Capacitor App plugin openUrl failed", e);
  }

  // Fallback
  try {
    window.location.href = url;
  } catch (e) {
    console.warn("Failed to open deep link", e);
  }
}

export async function returnToFieldService({ appointmentId } = {}) {
  const returnUrl = getSavedSalesforceReturnUrl();
  const target = returnUrl || buildFieldServiceRecordDeepLink(appointmentId);
  await openDeepLink(target);
  clearSavedSalesforceReturnUrl();
}
