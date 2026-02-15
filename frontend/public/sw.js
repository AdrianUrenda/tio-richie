// Service worker for Tío Richie push notifications
// Handles: push event (display notification), notificationclick (open chat with context)

self.addEventListener("push", function (event) {
  if (!event.data) return;

  var payload;
  try {
    payload = event.data.json();
  } catch (e) {
    return;
  }

  var title = payload.title || "Tío Richie";
  var options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload.data || {},
    tag: payload.data && payload.data.notificationId ? payload.data.notificationId : undefined,
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var data = event.notification.data || {};
  var url = data.url || "/chat";

  // Append notificationId so the chat page can mark it as opened
  if (data.notificationId) {
    var separator = url.indexOf("?") >= 0 ? "&" : "?";
    url = url + separator + "notificationId=" + data.notificationId;
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        // Focus existing window if one is open on /chat
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.indexOf("/chat") >= 0 && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open a new window
        return clients.openWindow(url);
      })
  );
});
