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
      icon: icon || '/favicon-96x96.png',
      badge: badge || '/favicon-96x96.png',
      tag: tag || undefined,
      renotify: !!tag,
      data: { url: url || '/home' },
    })
  )
})

// Navigate to the right page when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // `?src=push` tells the page where the member came from (lib/navSource).
  const rawUrl = event.notification.data?.url || '/home'
  const targetUrl = rawUrl.includes('src=') ? rawUrl : `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}src=push`

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
