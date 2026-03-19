/**
 * Push Notification Service Worker Handler
 *
 * Injected into the Workbox-generated SW via importScripts.
 * Handles push events (show OS notification) and notification clicks (navigate).
 */

// Show OS notification when push arrives
self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'HOCKIA', body: event.data.text() }
  }

  const { title = 'HOCKIA', body, icon, badge, url, tag } = data

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body || 'You have a new notification',
      icon: icon || '/Favicon-logo.svg',
      badge: badge || '/Favicon-logo.svg',
      tag: tag || undefined,
      renotify: !!tag,
      data: { url: url || '/home' },
    })
  )
})

// Navigate to the right page when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/home'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing HOCKIA tab if one is open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      // Otherwise open new tab
      return clients.openWindow(targetUrl)
    })
  )
})
