// Push notification subscription manager
// Handles: service worker registration, push subscription, VAPID key exchange

import { apiFetch } from "./api";

/**
 * Register the service worker for push notifications.
 * Returns null if push is not supported.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  return registration;
}

/**
 * Subscribe the user to push notifications.
 * Gets the VAPID public key from the backend, subscribes via PushManager,
 * and sends the subscription to the backend.
 */
export async function subscribeToPush(token: string): Promise<boolean> {
  try {
    const registration = await registerServiceWorker();
    if (!registration) return false;

    // Get VAPID public key from backend
    const { vapidPublicKey } = await apiFetch<{ vapidPublicKey: string }>(
      "/api/notifications/vapid-public-key",
    );

    if (!vapidPublicKey) return false;

    // Convert VAPID key to Uint8Array
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
    });

    // Send subscription to backend
    const subJson = subscription.toJSON();
    await apiFetch("/api/notifications/subscribe", {
      method: "POST",
      token,
      body: {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
        userAgent: navigator.userAgent,
      },
    });

    return true;
  } catch (err) {
    console.error("Push subscription failed:", err);
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(token: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await apiFetch("/api/notifications/subscribe", {
        method: "DELETE",
        token,
        body: { endpoint },
      });
    }
  } catch (err) {
    console.error("Push unsubscribe failed:", err);
  }
}

/**
 * Check if the user is currently subscribed to push notifications.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

/**
 * Convert a URL-safe base64 string to a Uint8Array.
 * Used for VAPID application server key.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
