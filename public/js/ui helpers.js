// Shared location helper used across the app (driver GPS tracking,
// customer "use my location"). Uses the Capacitor Geolocation plugin's
// native permission flow when running inside the Android app, and falls
// back to the plain browser API when this page is opened in a normal
// browser instead (e.g. for testing).

(function () {
  function isNativeGeolocationAvailable() {
    return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation);
  }

  async function ensurePermission() {
    if (!isNativeGeolocationAvailable()) return true; // the browser handles its own permission prompt
    const Geolocation = window.Capacitor.Plugins.Geolocation;
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted') return true;
    const requested = await Geolocation.requestPermissions();
    return requested.location === 'granted';
  }

  const PERMISSION_DENIED_MESSAGE = "Location permission was denied. Please enable it in your phone's Settings > Apps > Johannes Deliveries > Permissions.";

  // One-off position fetch - e.g. a "Use my current location" button.
  // Returns a Promise resolving to { lat, lng }.
  window.getCurrentLocation = async function () {
    const granted = await ensurePermission();
    if (!granted) {
      throw new Error(PERMISSION_DENIED_MESSAGE);
    }

    if (isNativeGeolocationAvailable()) {
      const Geolocation = window.Capacitor.Plugins.Geolocation;
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
      return { lat: position.coords.latitude, lng: position.coords.longitude };
    } else if (navigator.geolocation) {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
          (error) => reject(new Error(error.message)),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      });
    } else {
      throw new Error('Geolocation is not supported on this device/browser.');
    }
  };

  // Continuous watch - e.g. driver GPS broadcasting. onPosition(lat, lng)
  // fires on every update; onError(Error) fires on failure/denial.
  window.watchLocation = async function (onPosition, onError) {
    const granted = await ensurePermission();
    if (!granted) {
      onError(new Error(PERMISSION_DENIED_MESSAGE));
      return;
    }

    if (isNativeGeolocationAvailable()) {
      const Geolocation = window.Capacitor.Plugins.Geolocation;
      try {
        await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
          (position, err) => {
            if (err) { onError(new Error(err.message || 'Unknown location error')); return; }
            if (position) onPosition(position.coords.latitude, position.coords.longitude);
          }
        );
      } catch (err) {
        onError(err);
      }
    } else if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => onPosition(position.coords.latitude, position.coords.longitude),
        (error) => onError(new Error(error.message)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    } else {
      onError(new Error('Geolocation is not supported on this device/browser.'));
    }
  };
})();
