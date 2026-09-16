/**
 * Notification adapter.
 *
 * CAPACITOR NOTE: this is the only module that touches the Notification API.
 * When wrapping with Capacitor, replace `show`/`requestPermission` with the
 * @capacitor/local-notifications plugin (addPermissionRequest/.schedule) —
 * the rest of the app talks to this module only.
 */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export async function notificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

/**
 * Show a local notification via the service worker registration.
 * Deliberately sparse: callers must gate on user opt-in + high-signal rules.
 */
export async function show(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    await reg?.showNotification(title, {
      body,
      tag: 'recall-deadline',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data,
    })
  } catch (e) {
    console.warn('[recall] notification failed:', (e as Error)?.message)
  }
}
