// src/lib/device.js

const DEVICE_ID_KEY = "fsr_device_id";

/**
 * Returns a stable deviceId per browser, just like your old code.
 */
export function getDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = self.crypto?.randomUUID
      ? self.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}
