import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://dvkusfutsnygppvtbxmg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2a3VzZnV0c255Z3BwdnRieG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NDUwMjksImV4cCI6MjA5NjMyMTAyOX0.ZTBkpZrdZ0K0KFXGSrd2TIkKHRJcP52k0Ioy1cQFeJI";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const roleNames = { motorizado: "Conductor", soporte: "Soporte", administracion: "Administración", aliado: "Aliado", cliente: "Cliente" };
const statusNames = { pending: "Disponible", assigned: "Asignado", at_store: "En el comercio", in_transit: "En camino", delivered: "Entregado", cancelled: "Cancelado" };
const state = { session: null, profile: null, screen: "inicio", orders: [], allies: [], profiles: [], courierLocations: [], period: "day", usersRole: "all", usersSearch: "", authMode: "login", publicView: "home", requestedService: null, publicMap: null, publicPickupMarker: null, publicDestinationMarker: null, toastTimer: null, refreshTimer: null, updateCheckTimer: null, locationRefreshTimer: null, overdueTimer: null, realtime: null, serviceWorkerRegistration: null, updatePending: false, reloadingForUpdate: false, alertsEnabled: false, overdueSoundsEnabled: false, alertAudio: {}, courierLocationWatchId: null, nativeBackgroundLocationWatcherId: null, courierLocationWritePending: false, lastCourierLocationSentAt: 0, latestCourierPosition: null, courierWakeLock: null, courierLocationError: "", monitoringLocationLoadError: false, leafletPromise: null, monitoringMap: null, monitoringMarkers: null, monitoringMapContainer: null, monitoringMapDidFit: false, notifiedOrders: new Set(), courierAlarms: new Map(), overdueAlarmTimes: new Map() };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function legalFooter() {
  return `<footer class="legal-footer">Derechos reservados · <span>POWERED BY BAMBAMDEV</span></footer>`;
}

function renderAudioActivationPrompt() {
  if (state.profile.role === "motorizado" && !state.alertsEnabled) {
    return `<aside class="audio-activation" role="status"><div><strong>Activa las alertas de pedidos</strong><p>Permite el sonido de pedidos entrantes y asignados en este dispositivo.</p></div><button class="button primary" data-action="alerts">Activar alertas</button></aside>`;
  }
  if (["soporte", "administracion"].includes(state.profile.role) && !state.overdueSoundsEnabled) {
    return `<aside class="audio-activation" role="status"><div><strong>Activa la alarma de retrasos</strong><p>Habilita el sonido para pedidos que superen los 10 minutos sin llegar al comercio.</p></div><button class="button primary" data-action="overdue-sound">Activar alarma</button></aside>`;
  }
  return "";
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function showToast(message, isError = false) {
  toastNode.textContent = message;
  toastNode.classList.toggle("error-toast", isError);
  toastNode.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastNode.classList.add("hidden"), 4200);
}

function reportError(error) {
  console.error(error);
  showToast(error.message || "Ocurrió un error. Intenta nuevamente.", true);
}

function usernameEmail(username) {
  return `${username.trim().toLowerCase()}@users.tellevo.local`;
}

async function boot() {
  setupServiceWorkerUpdates();
  const { data, error } = await supabase.auth.getSession();
  if (error) return reportError(error);
  if (data.session) {
    state.session = data.session;
    await loadProfile();
  } else {
    renderPublicHome();
  }
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      clearInterval(state.refreshTimer);
      stopCourierLocationTracking();
      state.session = null;
      state.profile = null;
      renderPublicHome();
    }
  });
}

function setupServiceWorkerUpdates() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (state.reloadingForUpdate) return;
    if (state.screen === "crear" && hasUnsavedFormData()) {
      state.updatePending = true;
      showToast("Nueva versión lista. Se actualizará al terminar o salir del formulario.");
      return;
    }
    reloadForServiceWorkerUpdate();
  });

  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((registration) => {
    state.serviceWorkerRegistration = registration;
    return registration.update();
  }).catch((error) => console.error("No se pudo registrar o comprobar el service worker:", error));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkServiceWorkerUpdate();
      resumeCourierLocationTracking();
    }
  });
  window.addEventListener("pageshow", resumeCourierLocationTracking);
  window.addEventListener("focus", resumeCourierLocationTracking);
  state.updateCheckTimer = setInterval(checkServiceWorkerUpdate, 30 * 60 * 1000);
}

function checkServiceWorkerUpdate() {
  if (!state.serviceWorkerRegistration) return;
  state.serviceWorkerRegistration.update().catch((error) => {
    console.error("No se pudo comprobar si hay una versión nueva:", error);
  });
}

function hasUnsavedFormData() {
  return [...app.querySelectorAll("form input, form textarea, form select")]
    .some((field) => field.value.trim() !== "");
}

function reloadForServiceWorkerUpdate() {
  state.reloadingForUpdate = true;
  location.reload();
}

function applyPendingServiceWorkerUpdate() {
  if (state.updatePending) reloadForServiceWorkerUpdate();
}

async function loadProfile() {
  stopCourierLocationTracking();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error) return reportError(error);
  if (!data) {
    showToast("No se encontró el perfil. Contacta a administración.", true);
    await supabase.auth.signOut();
    return;
  }
  state.profile = data;
  state.courierLocations = [];
  state.monitoringLocationLoadError = false;
  state.notifiedOrders.clear();
  state.alertsEnabled = false;
  if ((!data.approved && data.role !== "cliente") || !data.role || data.suspended) {
    renderPending();
    return;
  }
  if (data.role === "motorizado" && data.online) {
    const { error: heartbeatError } = await supabase.rpc("heartbeat_courier");
    if (heartbeatError) console.error("No se pudo actualizar la actividad del motorizado:", heartbeatError);
  }
  await refreshData(false);
  if (data.role === "cliente" && state.requestedService) state.screen = state.requestedService;
  renderApp();
  if (state.profile.role === "motorizado" && state.profile.online) startCourierLocationTracking();
  startRealtime();
  clearInterval(state.refreshTimer);
  clearInterval(state.overdueTimer);
  if (["soporte", "administracion"].includes(state.profile.role)) {
    state.overdueTimer = setInterval(updateOverdueClocks, 1000);
  }
  state.refreshTimer = setInterval(async () => {
    if (state.profile.role === "motorizado" && state.profile.online) {
      const { error: heartbeatError } = await supabase.rpc("heartbeat_courier");
      if (heartbeatError) console.error("No se pudo actualizar la actividad del motorizado:", heartbeatError);
    }
    await refreshData(true);
    renderIfSafe();
  }, state.profile.role === "motorizado" ? 5000 : 18000);
}

function renderIfSafe() {
  if (state.screen === "crear") return;
  if (state.screen === "monitoreo") {
    refreshMonitoringView();
    return;
  }
  if (app.querySelector("input:focus, textarea:focus, select:focus")) return;
  if (!hasUnsavedFormData()) renderApp();
}

function startRealtime() {
  if (state.realtime) supabase.removeChannel(state.realtime);
  const channel = supabase.channel(`updates-${state.profile.id}`);
  if (state.profile.role === "motorizado") {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (payload) => {
      const locallyOwnedOrder = payload.new
        ? state.orders.find((order) => order.id === payload.new.id && order.courier_id === state.profile.id)
        : null;
      if (payload.eventType === "UPDATE" && locallyOwnedOrder && payload.new?.courier_id !== state.profile.id) {
        state.orders = state.orders.filter((order) => order.id !== payload.new.id);
        renderIfSafe();
      }
      const assignedOrder = payload.new && payload.new.courier_id === state.profile.id
        ? { ...payload.new, allies: state.allies.find((ally) => ally.id === payload.new.ally_id) }
        : null;
      await refreshData(true);
      if (assignedOrder && payload.eventType === "UPDATE") {
        emitCourierNotification("assigned", assignedOrder);
      }
      renderIfSafe();
    });
  } else {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async () => {
      await refreshData(true);
      renderIfSafe();
    }).on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, async () => {
      await refreshData(true);
      renderIfSafe();
    });
    if (["soporte", "administracion"].includes(state.profile.role)) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "courier_locations" }, async () => {
        await refreshCourierLocations();
        renderIfSafe();
      });
    }
  }

  state.realtime = channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.error(`Supabase Realtime: ${status}`);
  });
}

async function requestCourierWakeLock() {
  if (!("wakeLock" in navigator) || document.hidden) return;
  try {
    if (!state.courierWakeLock || state.courierWakeLock.released) {
      state.courierWakeLock = await navigator.wakeLock.request("screen");
      state.courierWakeLock.addEventListener("release", () => {
        state.courierWakeLock = null;
      }, { once: true });
    }
  } catch (error) {
    console.warn("No se pudo mantener activa la pantalla para el GPS:", error);
  }
}

function nativeBackgroundLocation() {
  return window.Capacitor?.Plugins?.BackgroundGeolocation || null;
}

function stopCourierLocationTracking() {
  const nativeLocation = nativeBackgroundLocation();
  if (state.nativeBackgroundLocationWatcherId !== null && nativeLocation) {
    nativeLocation.removeWatcher({ id: state.nativeBackgroundLocationWatcherId }).catch(() => {});
  }
  state.nativeBackgroundLocationWatcherId = null;
  if (state.courierLocationWatchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(state.courierLocationWatchId);
  }
  if (state.locationRefreshTimer) clearInterval(state.locationRefreshTimer);
  if (state.courierWakeLock) {
    state.courierWakeLock.release().catch(() => {});
    state.courierWakeLock = null;
  }
  state.courierLocationWatchId = null;
  state.locationRefreshTimer = null;
  state.courierLocationWritePending = false;
  state.lastCourierLocationSentAt = 0;
  state.latestCourierPosition = null;
}

async function sendCourierLocation(position, force = false) {
  if (!state.profile?.online || (!force && (state.courierLocationWritePending || Date.now() - state.lastCourierLocationSentAt < 15000))) return;
  state.courierLocationWritePending = true;
  try {
    await supabase.rpc("heartbeat_courier");
    const { error } = await supabase.rpc("update_courier_location", {
      p_latitude: position.coords.latitude,
      p_longitude: position.coords.longitude,
      p_accuracy: position.coords.accuracy
    });
    if (error) throw error;
    state.lastCourierLocationSentAt = Date.now();
    state.courierLocationError = "";
  } catch (error) {
    console.error("No se pudo guardar la ubicación del motorizado:", error);
    state.courierLocationError = "No se pudo actualizar tu ubicación. Verifica tu conexión y los permisos del GPS.";
    showToast(state.courierLocationError, true);
  } finally {
    state.courierLocationWritePending = false;
  }
}

function requestCurrentCourierLocation(force = false) {
  if (!state.profile?.online || !("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition((position) => {
    state.latestCourierPosition = position;
    sendCourierLocation(position, force);
  }, (error) => {
    console.error("No se pudo consultar la ubicación actual:", error);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
}

function resumeCourierLocationTracking() {
  if (state.profile?.role === "motorizado" && state.profile.online) {
    if (state.courierLocationWatchId === null && "geolocation" in navigator) startCourierLocationTracking();
    else requestCurrentCourierLocation(true);
    requestCourierWakeLock();
  }
}

async function startNativeBackgroundLocationTracking() {
  const nativeLocation = nativeBackgroundLocation();
  if (!nativeLocation || state.nativeBackgroundLocationWatcherId !== null) return false;
  state.courierLocationError = "";
  try {
    state.nativeBackgroundLocationWatcherId = await nativeLocation.addWatcher({
      backgroundMessage: "Ubicación activa para entregas. Cambia a OFF para detenerla.",
      backgroundTitle: "Te llevo · GPS activo",
      requestPermissions: true,
      stale: false,
      distanceFilter: 10
    }, (location, error) => {
      if (error) {
        console.error("GPS nativo:", error);
        if (error.code === "NOT_AUTHORIZED") {
          state.courierLocationError = "Concede ubicación permanente y ubicación en segundo plano para compartir tu posición.";
          showToast(state.courierLocationError, true);
        }
        return;
      }
      const position = { coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } };
      state.latestCourierPosition = position;
      sendCourierLocation(position);
    });
    return true;
  } catch (error) {
    console.error("No se pudo iniciar el GPS nativo:", error);
    return false;
  }
}

function startCourierLocationTracking() {
  if (nativeBackgroundLocation()) {
    startNativeBackgroundLocationTracking();
    return;
  }
  if (state.profile?.role !== "motorizado" || !state.profile.online || !("geolocation" in navigator)) {
    if (state.profile?.role === "motorizado" && state.profile.online && !("geolocation" in navigator)) {
      state.courierLocationError = "Este navegador no permite compartir la ubicación.";
      showToast(state.courierLocationError, true);
    }
    return;
  }
  if (state.courierLocationWatchId !== null) return;
  state.courierLocationError = "";
  requestCourierWakeLock();
  state.courierLocationWatchId = navigator.geolocation.watchPosition((position) => {
    state.latestCourierPosition = position;
    sendCourierLocation(position);
  }, (error) => {
    state.courierLocationError = error.code === error.PERMISSION_DENIED
      ? "Permiso de ubicación denegado. Actívalo en los ajustes del navegador para aparecer en Monitoreo."
      : "No se pudo obtener la ubicación. Comprueba el GPS del teléfono e inténtalo de nuevo.";
    showToast(state.courierLocationError, true);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  state.locationRefreshTimer = setInterval(() => requestCurrentCourierLocation(), 15000);
  requestCurrentCourierLocation(true);
}

function renderPublicHome() {
  state.publicView = "home";
  app.innerHTML = `<div class="passenger-page">
    <header class="passenger-header"><img src="./brand-logo.jpg" alt="Te llevo"><button class="profile-button" data-public-action="auth" aria-label="Iniciar sesión">👤</button></header>
    <main class="passenger-main">
      <section class="passenger-hero"><p class="eyebrow">MUÉVETE POR TU CIUDAD</p><h1>¿A dónde te llevamos?</h1></section>
      <section class="service-grid">
        <button class="service-card" data-service="solicitar"><span class="service-icon">🚗</span><strong>Solicitar viaje</strong><small>Viaja ahora</small></button>
        <button class="service-card" data-service="agendar"><span class="service-icon">📅</span><strong>Agendar viaje</strong><small>Programa tu traslado</small></button>
        <button class="service-card" data-service="encomienda"><span class="service-icon">📦</span><strong>Solicitar encomienda</strong><small>Recogida y entrega</small></button>
      </section>
      <a class="support-float" href="https://wa.me/584128481584" target="_blank" rel="noopener" aria-label="Soporte por WhatsApp">💬 Soporte</a>
    </main>${legalFooter()}</div>`;
  app.querySelector('[data-public-action="auth"]').addEventListener("click", renderAuth);
  app.querySelectorAll("[data-service]").forEach(button => button.addEventListener("click", () => {
    state.requestedService = button.dataset.service;
    renderAuth();
  }));
}

function renderAuth() {
  state.publicView = "auth";
  const isRegister = state.authMode === "register";
  app.innerHTML = `<div class="auth-page"><section class="auth-shell"><div class="auth-card passenger-auth">
    <img class="brand-logo" src="./brand-logo.jpg" alt="Te llevo">
    <button class="back-link" data-public-action="back">← Volver</button>
    <p class="eyebrow">CLIENTE TE LLEVO</p><h1>${isRegister ? "Crea tu cuenta" : "Iniciar sesión"}</h1>
    <p class="muted">${isRegister ? "Todas las cuentas nuevas tendrán acceso de cliente." : "Ingresa para solicitar tu servicio."}</p>
    <form id="auth-form" class="stack">
      ${isRegister ? `<div class="stack"><label>Nombre<input name="firstName" autocomplete="given-name" required></label><label>Apellido<input name="lastName" autocomplete="family-name" required></label><label>Teléfono<input name="phone" type="tel" autocomplete="tel" required></label></div>` : ""}
      <label>Usuario<input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.-]{3,32}" autocapitalize="none"></label>
      <label>Contraseña<input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" required minlength="6"></label>
      <p id="auth-error" class="error hidden" role="alert"></p>
      <button class="button primary full" id="auth-submit">${isRegister ? "Crear cuenta" : "Ingresar"}</button>
    </form>
    <button class="text-button" id="auth-toggle">${isRegister ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta"}</button>
    ${!isRegister ? `<button class="button subtle full driver-interest" data-driver-interest>Quiero ser conductor</button>` : ""}
  </div></section>${legalFooter()}</div>`;
  app.querySelector('[data-public-action="back"]').addEventListener("click", renderPublicHome);
  app.querySelector("#auth-toggle").addEventListener("click", () => { state.authMode = isRegister ? "login" : "register"; renderAuth(); });
  app.querySelector("#auth-form").addEventListener("submit", submitAuth);
  const driverInterest = app.querySelector("[data-driver-interest]");
  if (driverInterest) driverInterest.addEventListener("click", renderDriverApplication);
}

function renderDriverApplication() {
  app.innerHTML = `<div class="auth-page"><section class="auth-shell"><div class="auth-card passenger-auth"><img class="brand-logo" src="./brand-logo.jpg" alt="Te llevo"><button class="back-link" data-public-action="back">← Volver</button><h1>Postulación de conductor</h1><form id="driver-form" class="stack"><label>Nombre y apellido<input name="fullName" required></label><label>Cédula<input name="idNumber" required></label><label>Teléfono<input name="phone" type="tel" required></label><label>Dirección<input name="address" required></label><p class="muted">Tu solicitud quedará registrada para una futura entrevista.</p><p id="driver-error" class="error hidden"></p><button class="button primary full">Enviar postulación</button></form></div></section>${legalFooter()}</div>`;
  app.querySelector('[data-public-action="back"]').addEventListener("click", renderAuth);
  app.querySelector("#driver-form").addEventListener("submit", submitDriverApplication);
}

async function submitDriverApplication(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const { error } = await supabase.from("driver_applications").insert({ full_name: form.get("fullName"), id_number: form.get("idNumber"), phone: form.get("phone"), address: form.get("address"), status: "pending" });
  if (error) { document.querySelector("#driver-error").textContent = error.message; document.querySelector("#driver-error").classList.remove("hidden"); return; }
  event.currentTarget.innerHTML = `<div class="success-message"><strong>¡Postulación enviada!</strong><p class="muted">Nuestro equipo revisará tus datos para una entrevista.</p><button type="button" class="button primary full" data-public-action="back">Volver</button></div>`;
  event.currentTarget.querySelector('[data-public-action="back"]').addEventListener("click", renderAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get("username")).trim();
  const password = String(form.get("password"));
  const button = document.querySelector("#auth-submit");
  const errorNode = document.querySelector("#auth-error");
  button.disabled = true;
  button.textContent = "Procesando…";
  errorNode.classList.add("hidden");
  try {
    if (state.authMode === "register") {
      const { data, error } = await supabase.auth.signUp({
        email: usernameEmail(username),
        password,
        options: { data: { username: username.toLowerCase(), first_name: String(form.get("firstName")).trim(), last_name: String(form.get("lastName")).trim(), phone: String(form.get("phone")).trim() } }
      });
      if (error) throw error;
      if (!data.session) {
        errorNode.textContent = "La cuenta se creó. En Supabase, desactiva la confirmación por correo para permitir el acceso con usuario y contraseña (no se solicita correo).";
        errorNode.classList.remove("hidden");
      } else {
        showToast("Cuenta creada. Espera la aprobación de administración.");
        state.session = data.session;
        await loadProfile();
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) throw new Error("Usuario o contraseña incorrectos.");
      state.session = data.session;
      await loadProfile();
    }
  } catch (error) {
    errorNode.textContent = error.message || "No se pudo completar el acceso.";
    errorNode.classList.remove("hidden");
  } finally {
    if (document.querySelector("#auth-submit")) {
      button.disabled = false;
      button.textContent = state.authMode === "register" ? "Crear cuenta" : "Iniciar sesión";
    }
  }
}

function renderPending() {
  const suspended = state.profile?.suspended;
  app.innerHTML = `<div class="auth-page"><section class="auth-shell"><div class="auth-card">
    <img class="brand-logo" src="./brand-logo.jpg" alt="Te llevo">
    <p class="eyebrow">TE LLEVO</p><h1>${suspended ? "Cuenta suspendida" : "Solicitud recibida"}</h1>
    <p class="muted">${suspended ? "Tu acceso está suspendido. Comunícate con administración." : "Tu cuenta aún no está habilitada. Podrás ingresar cuando administración apruebe tu usuario y asigne un rol."}</p>
    <button class="button subtle full" id="logout-button">Cerrar sesión</button>
  </div></section>${legalFooter()}</div>`;
  document.querySelector("#logout-button").addEventListener("click", signOut);
}

async function refreshData(quiet) {
  if (!state.profile || !state.session) return;
  const { data: orders, error: orderError } = await supabase.from("orders")
    .select("*, allies(name, location_url), courier:profiles!orders_courier_id_fkey(full_name, username, phone, earnings_percentage), creator:profiles!orders_created_by_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(500);
  if (orderError) {
    if (!quiet) reportError(orderError);
    return;
  }
  const previousOrders = new Map(state.orders.map((order) => [order.id, order]));
  state.orders = orders || [];
  reconcileCourierAlarms();
  if (quiet && state.profile.role === "motorizado") {
    for (const order of state.orders) {
      const previous = previousOrders.get(order.id);
      if (order.courier_id === state.profile.id && order.status !== "delivered" && previous?.courier_id !== state.profile.id) {
        emitCourierNotification("assigned", order);
      } else if (!previous && order.status === "pending" && order.released && state.profile.online) {
        emitCourierNotification("incoming", order);
      }
    }
  }
  if (["administracion", "soporte", "aliado"].includes(state.profile.role)) {
    const [allyResult, profileResult] = await Promise.all([
      supabase.from("allies").select("*").order("name"),
      supabase.from("profiles")      .select("id, username, full_name, phone, role, ally_id, earnings_percentage, approved, suspended, online, last_seen_at, updated_at").order("full_name")
    ]);
    if (allyResult.error || profileResult.error) {
      if (!quiet) reportError(allyResult.error || profileResult.error);
      return;
    }
    state.allies = allyResult.data || [];
    state.profiles = profileResult.data || [];
    if (["soporte", "administracion"].includes(state.profile.role)) await refreshCourierLocations(quiet);
    refreshActiveCourierOptions();
  }
}

async function refreshCourierLocations(quiet = true) {
  if (!["soporte", "administracion"].includes(state.profile?.role)) return;
  const freshAfter = new Date(Date.now() - 90000).toISOString();
  const { data, error } = await supabase.from("courier_locations")
    .select("courier_id, latitude, longitude, accuracy, updated_at")
    .gt("updated_at", freshAfter);
  if (error) {
    const wasUnavailable = state.monitoringLocationLoadError;
    state.monitoringLocationLoadError = true;
    if (!quiet) reportError(error);
    else if (!wasUnavailable) console.error("No se pudieron cargar las ubicaciones de motorizados:", error);
    return;
  }
  state.monitoringLocationLoadError = false;
  state.courierLocations = data || [];
}

function activeCouriers() {
  const activeAfter = Date.now() - 90000;
  return state.profiles.filter((profile) =>
    profile.role === "motorizado"
    && profile.approved
    && !profile.suspended
    && profile.online
    && profile.last_seen_at
    && new Date(profile.last_seen_at).getTime() > activeAfter
  );
}

function refreshActiveCourierOptions() {
  const select = document.querySelector("#assigned-courier");
  if (!select) return;
  const selectedId = select.value;
  const couriers = activeCouriers();
  const selectedIsActive = couriers.some((profile) => profile.id === selectedId);
  const staleSelection = selectedId && !selectedIsActive
    ? state.profiles.find((profile) => profile.id === selectedId)
    : null;
  select.innerHTML = `<option value="">Ninguno — pedido visible para motorizados activos</option>${staleSelection
    ? `<option value="${staleSelection.id}">⚠ ${escapeHtml(staleSelection.full_name)} ya no está activo</option>`
    : ""}${couriers.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)} (@${escapeHtml(profile.username)})</option>`).join("")}`;
  if (selectedId) select.value = selectedId;
}

const navItems = {
  cliente: [["solicitudes", "Mis solicitudes"], ["solicitar", "Solicitar viaje"], ["agendar", "Agendar viaje"]],
  motorizado: [["inicio", "Resumen"], ["activos", "Servicios activos"], ["curso", "Servicio en curso"], ["entregados", "Finalizados"]],
  soporte: [["inicio", "Resumen"], ["crear", "Crear servicio"], ["pendientes", "Servicios pendientes"], ["pedidos", "Servicios"], ["entregados", "Finalizados"], ["motorizados", "Motorizados activos"], ["monitoreo", "Monitoreo"], ["agendados", "Servicios agendados"], ["aliados", "Aliados"]],
  administracion: [["inicio", "Resumen"], ["pendientes", "Servicios pendientes"], ["pedidos", "Servicios"], ["agendados", "Servicios agendados"], ["entregados", "Finalizados"], ["motorizados", "Motorizados activos"], ["monitoreo", "Monitoreo"], ["usuarios", "Usuarios"], ["postulaciones", "Postulaciones"], ["configuracion", "Configuración y pagos"], ["aliados", "Aliados"], ["reportes", "Reportes"], ["metricas", "Métricas"]],
  aliado: [["crear", "Crear servicio"], ["mis_pedidos", "Servicios en curso"], ["historial", "Historial"]]
};

function renderApp() {
  if (!state.profile?.role) return renderPending();
  const items = navItems[state.profile.role] || [];
  if (!items.some(([key]) => key === state.screen)) state.screen = items[0]?.[0] || "inicio";
  const nav = items.map(([key, label]) => `<button class="nav-button ${state.screen === key ? "active" : ""}" data-screen="${key}">${label}</button>`).join("");
  app.innerHTML = `<div class="app-page"><div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand"><img src="./brand-logo.jpg" alt=""><div><strong>Te llevo</strong><span>${roleNames[state.profile.role]}</span></div></div>
      <nav class="nav-list">${nav}</nav>
      <div class="sidebar-bottom"><div class="user-summary"><strong>${escapeHtml(state.profile.full_name)}</strong><span>@${escapeHtml(state.profile.username)} · ${roleNames[state.profile.role]}</span></div><button class="button subtle full" data-action="logout">Cerrar sesión</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><div><div class="mobile-brand"><img src="./brand-logo.jpg" alt=""><strong>Te llevo</strong></div><h1>${escapeHtml(titleFor(state.screen))}</h1><p>${new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(new Date())}</p></div>
        ${state.profile.role === "motorizado" ? `<div class="header-actions"><button class="button subtle small" data-action="alerts" aria-pressed="${state.alertsEnabled}">${state.alertsEnabled ? "Desactivar alertas" : "Activar alertas"}</button><label class="switch-row"><span class="muted">${state.profile.online ? "Activo" : "Desconectado"}</span><span class="switch"><input type="checkbox" data-action="online" ${state.profile.online ? "checked" : ""} aria-label="Disponibilidad"><span></span></span></label><button class="button subtle small mobile-logout" data-action="logout">Cerrar sesión</button></div>` : `<div class="header-actions">${["soporte", "administracion"].includes(state.profile.role) ? `<button class="button subtle small" data-action="overdue-sound" aria-pressed="${state.overdueSoundsEnabled}">${state.overdueSoundsEnabled ? "Alarma activada" : "Activar alarma"}</button><span class="badge green">${countOnline()} motorizados activos</span>` : ""}${["soporte", "administracion", "aliado"].includes(state.profile.role) ? `<button class="button subtle small mobile-logout" data-action="logout">Cerrar sesión</button>` : ""}</div>`}
      </header>
      ${renderAudioActivationPrompt()}
      <section id="screen-content">${renderScreen()}</section>
    </main>
    <nav class="mobile-nav">${nav}</nav>
  </div>${legalFooter()}</div>`;
  app.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => {
    if (state.screen === "monitoreo" && button.dataset.screen !== "monitoreo" && state.monitoringMap) {
      state.monitoringMap.remove();
      state.monitoringMap = null;
      state.monitoringMarkers = null;
      state.monitoringMapContainer = null;
      state.monitoringMapDidFit = false;
    }
    state.screen = button.dataset.screen;
    renderApp();
    applyPendingServiceWorkerUpdate();
  }));
  app.querySelectorAll('[data-action="logout"]').forEach((button) => button.addEventListener("click", signOut));
  const onlineToggle = app.querySelector('[data-action="online"]');
  if (onlineToggle) onlineToggle.addEventListener("change", toggleOnline);
  const alertsButton = app.querySelector('[data-action="alerts"]');
  if (alertsButton) alertsButton.addEventListener("click", toggleCourierAlerts);
  const overdueSoundButton = app.querySelector('[data-action="overdue-sound"]');
  if (overdueSoundButton) overdueSoundButton.addEventListener("click", enableOverdueSounds);
  const activationButton = app.querySelector(".audio-activation [data-action]");
  if (activationButton) {
    activationButton.addEventListener("click", activationButton.dataset.action === "alerts" ? toggleCourierAlerts : enableOverdueSounds);
  }
  bindScreenActions();
  app.querySelectorAll("[data-client-service]").forEach(button => button.addEventListener("click", () => { state.requestedService = button.dataset.clientService; state.screen = button.dataset.clientService; renderApp(); }));
  if (["solicitar", "agendar", "encomienda"].includes(state.screen) || state.requestedService) setTimeout(bindClientRequest, 0);
  if (state.screen === "monitoreo") void initializeMonitoringMap();
}

async function toggleCourierAlerts() {
  if (state.alertsEnabled) {
    state.alertsEnabled = false;
    showToast("Alertas de sonido y vibración desactivadas.");
    renderApp();
    return;
  }

  try {
    await prepareAlertAudio("incoming");
    await enableNativeNotifications();
    state.alertsEnabled = true;
    showToast("Sonido y notificaciones de pedidos activados.");
    renderApp();
  } catch (error) {
    reportError(new Error(`No se pudieron activar las alertas: ${error.message}`));
  }
}

function alertAudioFor(kind) {
  const source = kind === "overdue"
    ? "./classic-danger-alarm.mp3"
    : "./email-notification-message-ring.wav";
  if (!state.alertAudio[kind]) {
    const audio = new Audio(source);
    audio.preload = "auto";
    audio.volume = 1;
    state.alertAudio[kind] = audio;
  }
  return state.alertAudio[kind];
}

async function prepareAlertAudio(kind) {
  const audio = alertAudioFor(kind);
  audio.currentTime = 0;
  await audio.play();
}

async function playAlertAudio(kind) {
  const audio = alertAudioFor(kind);
  try {
    audio.pause();
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    console.error(`No se pudo reproducir el audio ${kind}:`, error);
    showToast("El navegador bloqueó el sonido. Pulsa Activar alertas o Activar alarma para habilitar el audio.", true);
  }
}

async function playCourierAlert(kind) {
  if (!state.alertsEnabled) return;
  await playAlertAudio("incoming");
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(kind === "assigned" ? [350, 120, 350, 120, 500] : [180, 90, 180]);
  }
}

async function enableNativeNotifications() {
  const isNative = window.Capacitor?.isNativePlatform?.();
  if (!isNative) {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    return;
  }
  const plugin = window.Capacitor?.Plugins?.LocalNotifications;
  if (!plugin) return;
  await plugin.requestPermissions();
  await plugin.createChannel({
    id: "courier_orders",
    name: "Pedidos disponibles y asignados",
    description: "Alertas repetidas de pedidos pendientes",
    importance: 5,
    visibility: 1,
    vibration: true,
    sound: "default"
  });
}

function nativeNotificationPlugin() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

function notificationId(orderId) {
  let hash = 0;
  for (const char of String(orderId)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 100000 + (hash % 800000000);
}

async function showNativeCourierAlarm(kind, order) {
  const allyName = order.allies?.name || "Aliado";
  const plugin = nativeNotificationPlugin();
  if (!plugin) return;
  const notification = {
    id: notificationId(order.id),
    title: kind === "assigned" ? "Pedido asignado" : "Pedido disponible",
    body: kind === "assigned" ? `Tienes un pedido asignado de ${allyName}.` : `Nuevo pedido disponible de ${allyName}.`,
    channelId: "courier_orders",
    smallIcon: "ic_launcher"
  };
  if (kind === "assigned") {
    const now = Date.now();
    await plugin.schedule({ notifications: [
      { ...notification, schedule: { at: new Date(now + 500) } },
      { ...notification, id: notificationId(order.id) + 1, schedule: { at: new Date(now + 3500) } }
    ] });
  } else {
    await plugin.schedule({ notifications: [{ ...notification, schedule: { every: "minute", count: 120 } }] });
  }
}

async function stopNativeCourierAlarm(orderId) {
  const incomingAudio = state.alertAudio.incoming;
  if (incomingAudio) {
    incomingAudio.pause();
    incomingAudio.currentTime = 0;
  }
  if (typeof navigator.vibrate === "function") navigator.vibrate(0);
  const plugin = nativeNotificationPlugin();
  if (!plugin) return;
  await plugin.cancel({ notifications: [{ id: notificationId(orderId) }, { id: notificationId(orderId) + 1 }] });
}

function reconcileCourierAlarms() {
  if (state.profile?.role !== "motorizado") return;
  for (const orderId of [...state.courierAlarms.keys()]) {
    const order = state.orders.find((item) => item.id === orderId);
    const keepAvailableAlarm = order
      && order.status === "pending"
      && order.released
      && !order.courier_id
      && state.profile.online;
    const keepAssignedAlarm = order
      && order.courier_id === state.profile.id
      && !["delivered", "cancelled"].includes(order.status);
    if (!keepAvailableAlarm && !keepAssignedAlarm) stopCourierAlarm(orderId);
  }
}

function stopCourierAlarm(orderId) {
  const alarm = state.courierAlarms.get(orderId);
  if (alarm) {
    clearInterval(alarm);
    clearTimeout(alarm);
    state.courierAlarms.delete(orderId);
  }
  void stopNativeCourierAlarm(orderId);
}

async function startCourierAlarm(kind, order) {
  stopCourierAlarm(order.id);
  await showNativeCourierAlarm(kind, order);
  if (!state.alertsEnabled) return;
  await playCourierAlert(kind);
  if (kind === "assigned") {
    const secondSound = setTimeout(async () => {
      await playCourierAlert(kind);
      if (typeof navigator.vibrate === "function") navigator.vibrate([350, 120, 350]);
    }, 3000);
    state.courierAlarms.set(order.id, secondSound);
    return;
  }
  if (state.courierAlarms.has(order.id)) return;
  const alarm = setInterval(() => {
    if (!state.alertsEnabled) return stopCourierAlarm(order.id);
    void playCourierAlert(kind);
    if (typeof navigator.vibrate === "function") navigator.vibrate([500, 300, 500]);
  }, 8000);
  state.courierAlarms.set(order.id, alarm);
}

async function notifyCourier(kind, order) {
  const allyName = order.allies?.name || "Aliado";
  const message = kind === "assigned"
    ? `Tienes un pedido asignado de ${allyName}.`
    : `Nuevo pedido disponible de ${allyName}.`;
  showToast(message);
  await startCourierAlarm(kind, order);
}

function emitCourierNotification(kind, order) {
  const key = `${order.id}:${kind}`;
  if (state.notifiedOrders.has(key)) return;
  state.notifiedOrders.add(key);
  if (state.notifiedOrders.size > 500) {
    state.notifiedOrders.delete(state.notifiedOrders.values().next().value);
  }
  void notifyCourier(kind, order);
}

function titleFor(screen) {
  return ({ inicio: "Resumen", activos: "Servicios activos", curso: "Servicio en curso", entregados: "Servicios finalizados", crear: "Crear servicio", pedidos: "Pedidos", pendientes: "Servicios pendientes", mis_pedidos: "Servicios en curso", historial: "Historial", motorizados: "Motorizados activos", monitoreo: "Monitoreo", aliados: "Aliados", usuarios: "Usuarios", reportes: "Reportes", metricas: "Métricas" })[screen] || "Te llevo";
}

function countOnline() {
  const activeAfter = Date.now() - 90000;
  return state.profiles.filter((profile) => profile.role === "motorizado" && profile.approved && !profile.suspended && profile.online && profile.last_seen_at && new Date(profile.last_seen_at).getTime() > activeAfter).length;
}

function renderClientRequests() {
  setTimeout(loadClientRequests, 0);
  return `<div class="client-actions"><h2>Mis solicitudes</h2><div id="client-current-rides" class="list"><p class="muted">Consultando servicios actuales…</p></div><div class="section-head"><h2>Historial de viajes</h2></div><div id="client-ride-history" class="list"><p class="muted">Consultando historial…</p></div><a class="support-float" href="https://wa.me/584128481584" target="_blank" rel="noopener">💬 Soporte</a></div>`;
}

async function loadClientRequests() {
  const currentNode = document.querySelector("#client-current-rides");
  const historyNode = document.querySelector("#client-ride-history");
  if (!currentNode || !historyNode) return;
  const { data, error } = await supabase.from("rides").select("*").eq("client_id", state.profile.id).order("created_at", { ascending: false });
  if (error) {
    currentNode.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    historyNode.innerHTML = "";
    return;
  }
  const active = (data || []).filter(ride => !["delivered", "cancelled", "completed"].includes(ride.status));
  const history = (data || []).filter(ride => ["delivered", "cancelled", "completed"].includes(ride.status));
  const rideCard = ride => `<article class="card ride-card"><div><strong>${ride.service_type === "agendar" ? "Viaje agendado" : ride.service_type === "encomienda" ? "Encomienda" : "Viaje solicitado"}</strong><p>${escapeHtml(ride.pickup_text)} → ${escapeHtml(ride.destination_text)}</p><p class="muted">${ride.scheduled_at ? dateTime(ride.scheduled_at) + " · " : ""}${escapeHtml(ride.status)} · $${Number(ride.price || 0).toFixed(2)}</p></div></article>`;
  currentNode.innerHTML = active.length ? active.map(rideCard).join("") : `<div class="empty">No tienes servicios en curso.</div>`;
  historyNode.innerHTML = history.length ? history.map(rideCard).join("") : `<div class="empty">Aún no tienes viajes finalizados.</div>`;
}

function renderClientRequest(type) {
  const isParcel = type === "encomienda";
  state.requestedService = type;
  return `<div class="request-layout"><div class="request-form-card"><button class="button subtle small" data-client-back>← Inicio</button><h2>${isParcel ? "Solicitar encomienda" : type === "agendar" ? "Agendar viaje" : "Solicitar viaje"}</h2>
    ${type === "agendar" ? `<label>Fecha y hora del viaje<input name="scheduledAt" type="datetime-local" form="client-request-form" required></label>` : ""}
    <form id="client-request-form" class="stack"><label>Punto de recogida<input id="pickup-search" name="pickupText" placeholder="Ej. CC Unicentro, Maracay" required autocomplete="off"></label><label>Destino<input id="destination-search" name="destinationText" placeholder="Ej. Centro Comercial Galerías" required autocomplete="off"></label>
    <div id="client-address-map" class="client-map"></div><button type="button" class="button subtle" data-use-location>Usar mi ubicación actual</button>
    ${isParcel ? `<label>Descripción del paquete<textarea name="description" required></textarea><label>Nombre de quien recibe<input name="recipientName" required></label><label>Teléfono de quien recibe<input name="recipientPhone" type="tel" required></label>` : `<label class="checkbox-row"><input type="checkbox" id="other-passenger"> Viaja otra persona</label><div id="passenger-fields" class="stack hidden"><label>Nombre y apellido<input name="passengerName"></label><label>Teléfono<input name="passengerPhone" type="tel"></label></div>`}
    <div id="fare-options" class="fare-options"><p class="muted">Selecciona ambos puntos para calcular la tarifa.</p></div><button class="button primary full" id="request-submit" disabled>Solicitar servicio</button></form></div></div>`;
}

function haversineKm(a, b) { const toRad = x => x * Math.PI / 180; const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng); const aa = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2; return 6371 * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa)); }

async function bindClientRequest() {
  if (typeof L === "undefined") return;
  const mapNode = document.querySelector("#client-address-map");
  if (!mapNode) return;
  state.publicPickupMarker = null;
  state.publicDestinationMarker = null;
  state.publicMap = L.map(mapNode).setView([10.250, -67.600], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(state.publicMap);
  const pickupInput = document.querySelector("#pickup-search");
  const destinationInput = document.querySelector("#destination-search");
  let pickup = null;
  let destination = null;
  const updateFare = () => {
    const options = document.querySelector("#fare-options");
    if (!pickup || !destination) return;
    const km = haversineKm(pickup, destination);
    const etaMinutes = Math.max(1, Math.round(km / 55 * 60));
    if (state.requestedService === "encomienda") {
      options.innerHTML = `<label class="fare-card"><input type="radio" name="serviceMode" value="encomienda" checked><div><strong>Encomienda</strong><span>${km.toFixed(1)} km · ${etaMinutes} min · $${(km * 0.40).toFixed(2)}</span></div></label>`;
    } else options.innerHTML = `<label class="fare-card"><input type="radio" name="serviceMode" value="express" checked><div><strong>Express</strong><span>${km.toFixed(1)} km · ${etaMinutes} min · $${(km * 0.45).toFixed(2)}</span></div></label><label class="fare-card"><input type="radio" name="serviceMode" value="economico"><div><strong>Económico</strong><span>${km.toFixed(1)} km · ${etaMinutes} min · $${(km * 0.38).toFixed(2)}</span></div></label>`;
    document.querySelector("#request-submit").disabled = false;
  };
  const setMarker = (kind, point, label) => {
    const latLng = L.latLng(point.lat, point.lng);
    const marker = kind === "pickup" ? state.publicPickupMarker : state.publicDestinationMarker;
    if (marker) marker.setLatLng(latLng); else {
      const created = L.marker(latLng, { draggable: true }).addTo(state.publicMap).bindPopup(label).openPopup();
      created.on("dragend", event => { const position = event.target.getLatLng(); if (kind === "pickup") pickup = { lat: position.lat, lng: position.lng }; else destination = { lat: position.lat, lng: position.lng }; updateFare(); });
      if (kind === "pickup") state.publicPickupMarker = created; else state.publicDestinationMarker = created;
    }
    state.publicMap.setView(latLng, 15);
    updateFare();
  };
  async function searchPlace(input, kind) { const q = input.value.trim(); if (q.length < 3) return; const cities = "Maracay|Turmero|Cagua|La Victoria|Caracas|Valencia"; const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q + " Venezuela")}`, { headers: { "Accept-Language": "es" } }); const results = await response.json(); if (!results.length) return showToast("No encontramos esa ubicación.", true); const place = results[0]; const point = { lat: Number(place.lat), lng: Number(place.lon) }; input.value = place.display_name; if (kind === "pickup") pickup = point; else destination = point; setMarker(kind, point, place.display_name); }
  let pickupTimer, destinationTimer;
  pickupInput.addEventListener("change", () => { clearTimeout(pickupTimer); pickupTimer = setTimeout(() => searchPlace(pickupInput, "pickup"), 250); });
  destinationInput.addEventListener("change", () => { clearTimeout(destinationTimer); destinationTimer = setTimeout(() => searchPlace(destinationInput, "destination"), 250); });
  document.querySelector("[data-use-location]").addEventListener("click", () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(position => { pickup = { lat: position.coords.latitude, lng: position.coords.longitude }; pickupInput.value = "Mi ubicación actual"; setMarker("pickup", pickup, "Mi ubicación actual"); }, () => showToast("Activa el permiso de ubicación.", true), { enableHighAccuracy: true }) : showToast("Ubicación no disponible.", true));
  document.querySelector("#other-passenger")?.addEventListener("change", event => document.querySelector("#passenger-fields").classList.toggle("hidden", !event.target.checked));
  document.querySelector('[data-client-back]').addEventListener("click", () => { state.requestedService = null; state.screen = "solicitudes"; renderApp(); });
  document.querySelector("#client-request-form").onsubmit = submitClientRequest.bind(null, { getPickup: () => pickup, getDestination: () => destination });
}

async function submitClientRequest(points, event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const pickup = points.getPickup(), destination = points.getDestination();
  if (!pickup || !destination) return showToast("Selecciona recogida y destino en el mapa.", true);
  const km = haversineKm(pickup, destination);
  const type = state.requestedService || "solicitar";
  const isParcel = type === "encomienda";
  const mode = form.get("serviceMode") || (isParcel ? "encomienda" : "economico");
  const rate = isParcel ? 0.40 : mode === "express" ? 0.45 : 0.38;
  const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "bcv_usd_rate").maybeSingle();
  const bcvRate = Number(setting?.value || 0);
  if (!bcvRate) return showToast("La tasa BCV todavía no está configurada.", true);
  const usd = km * rate;
  const bs = usd * bcvRate;
  openPaymentGateway({ form, type, mode, pickup, destination, km, usd, bs, bcvRate, isParcel });
}

async function openPaymentGateway(service) {
  const existing = document.querySelector("#payment-modal");
  if (existing) existing.remove();
  document.body.insertAdjacentHTML("beforeend", `<div id="payment-modal" class="payment-modal-backdrop"><section class="payment-modal"><button class="payment-close" type="button" aria-label="Cerrar">×</button><h2>Pago móvil</h2><div class="payment-details"><strong>Monto: Bs ${service.bs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span>$${service.usd.toFixed(2)} al cambio BCV ${Number(service.bcvRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })}</span><hr><span>Cédula / RIF: 27.146.006</span><span>Teléfono: 0412-8481584</span><span>Banco: Mercantil · 0105</span></div><form id="payment-form" class="stack"><label>Número de referencia del pago<input name="paymentReference" inputmode="numeric" minlength="4" required></label><label>Captura de la transacción<input name="paymentCapture" type="file" accept="image/*" required></label><button class="button primary full" type="submit">Enviar comprobante y solicitar</button></form></section></div>`);
  document.querySelector("#payment-modal .payment-close").addEventListener("click", () => document.querySelector("#payment-modal").remove());
  document.querySelector("#payment-form").addEventListener("submit", event => submitPaidRide(event, service));
}

async function submitPaidRide(event, service) {
  event.preventDefault();
  const paymentForm = new FormData(event.currentTarget);
  const capture = paymentForm.get("paymentCapture");
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Verificando pago…";
  let capturePath = "";
  let captureUrl = "";
  if (capture && capture.size) {
    capturePath = `${state.profile.id}/${Date.now()}-${capture.name}`;
    const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(capturePath, capture, { upsert: false });
    if (uploadError) { submitButton.disabled = false; submitButton.textContent = "Enviar comprobante y solicitar"; return showToast(uploadError.message, true); }
    const publicUrl = supabase.storage.from("payment-proofs").getPublicUrl(capturePath);
    captureUrl = publicUrl.data.publicUrl;
  }
  const form = service.form;
  const { error } = await supabase.from("rides").insert({ client_id: state.profile.id, service_type: service.type, mode: service.mode, status: "pending_payment_verification", pickup_text: form.get("pickupText"), destination_text: form.get("destinationText"), pickup_lat: service.pickup.lat, pickup_lng: service.pickup.lng, destination_lat: service.destination.lat, destination_lng: service.destination.lng, distance_km: service.km, price: service.usd, scheduled_at: form.get("scheduledAt") || null, passenger_name: form.get("passengerName") || null, passenger_phone: form.get("passengerPhone") || null, recipient_name: form.get("recipientName") || null, recipient_phone: form.get("recipientPhone") || null, description: form.get("description") || null, payment_status: "pending_verification", payment_reference: paymentForm.get("paymentReference"), payment_capture_url: captureUrl, payment_amount_bs: service.bs, bcv_rate: service.bcvRate });
  if (error) return showToast(error.message, true);
  document.querySelector("#payment-modal")?.remove();
  showToast("Servicio solicitado correctamente."); state.requestedService = null; state.screen = "solicitudes"; renderApp();
}

function dayStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function renderScreen() {
  const role = state.profile.role;
  if (role === "cliente") {
    if (state.requestedService === "encomienda" || state.screen === "encomienda") return renderClientRequest("encomienda");
    if (state.requestedService === "agendar" || state.screen === "agendar") return renderClientRequest("agendar");
    if (state.requestedService === "solicitar" || state.screen === "solicitar") return renderClientRequest("solicitar");
    return renderClientRequests();
  }
  if (role === "aliado") {
    if (state.screen === "crear") return renderCreateOrder();
    if (state.screen === "mis_pedidos") return renderAllyOrders(false);
    if (state.screen === "historial") return renderAllyOrders(true);
  }
  if (state.screen === "inicio") return renderDashboard();
  if (state.screen === "crear" && ["soporte", "administracion"].includes(role)) return renderCreateOrder();
  if (state.screen === "pendientes" && ["soporte", "administracion"].includes(role)) return renderPendingOrders();
  if (state.screen === "agendados" && ["soporte", "administracion"].includes(role)) return renderScheduledServices();
  if (state.screen === "activos" && role === "motorizado") return renderCourierAvailable();
  if (state.screen === "curso" && role === "motorizado") return renderCourierCurrent();
  if (state.screen === "motorizados" && ["soporte", "administracion"].includes(role)) return renderActiveCouriers();
  if (state.screen === "monitoreo" && ["soporte", "administracion"].includes(role)) return renderMonitoring();
  if (state.screen === "pedidos" && role !== "motorizado") return renderStaffOrders();
  if (state.screen === "entregados") return role === "motorizado" ? renderCourierDelivered() : renderCompletedOrders();
  if (state.screen === "aliados" && role !== "motorizado") return renderAllies();
  if (state.screen === "usuarios" && role === "administracion") return renderUsers();
  if (state.screen === "postulaciones" && role === "administracion") return renderDriverApplications();
  if (state.screen === "reportes" && role === "administracion") return renderReports();
  if (state.screen === "metricas" && role === "administracion") return renderMetrics();
  if (state.screen === "configuracion" && role === "administracion") return renderPaymentConfiguration();
  return `<div class="empty">Selecciona una sección.</div>`;
}

function renderScheduledServices() { setTimeout(loadScheduledServices, 0); return `<section><h2>Servicios agendados</h2><div id="scheduled-services-list" class="list"><p class="muted">Cargando servicios agendados…</p></div></section>`; }
async function loadScheduledServices() { const node=document.querySelector("#scheduled-services-list"); if(!node)return; const {data,error}=await supabase.from("rides").select("*").eq("service_type","agendar").eq("status","pending").gte("scheduled_at",new Date().toISOString()).order("scheduled_at",{ascending:true}); if(error){node.innerHTML=`<p class="error">${escapeHtml(error.message)}</p>`;return;} node.innerHTML=data?.length ? data.map(ride=>`<article class="card"><strong>${escapeHtml(dateTime(ride.scheduled_at))}</strong><p>${escapeHtml(ride.pickup_text)} → ${escapeHtml(ride.destination_text)}</p><p class="muted">${escapeHtml(ride.mode)} · $${Number(ride.price || 0).toFixed(2)}</p></article>`).join("") : `<div class="empty">No hay servicios agendados.</div>`; }

function renderPendingOrders() {
  const orders = state.orders.filter((order) => order.status === "pending" && !order.courier_id);
  setTimeout(loadPendingPassengerServices, 0);
  return `<h2>Servicios pendientes</h2><div id="pending-passenger-services" class="list"><p class="muted">Cargando servicios…</p></div><div class="section-head"><h2>Servicios anteriores</h2></div><p class="muted">Servicios creados por aliados y servicios aún sin conductor. Asígnalos o libéralos para que los conductores activos puedan tomarlos.</p><div class="list">${renderOrderCards(orders, "pending")}</div>`;
}

async function loadPendingPassengerServices() {
  const node = document.querySelector("#pending-passenger-services");
  if (!node) return;
  const { data, error } = await supabase.from("rides").select("*").eq("status", "pending_payment_verification").order("created_at", { ascending: false });
  if (error) return node.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  node.innerHTML = data?.length ? data.map(ride => `<article class="card"><strong>#${ride.id.slice(0, 8)} · Pago por verificar</strong><p>${escapeHtml(ride.pickup_text)} → ${escapeHtml(ride.destination_text)}</p><p>Bs ${Number(ride.payment_amount_bs || 0).toFixed(2)} · Ref. ${escapeHtml(ride.payment_reference || "—")}</p>${ride.payment_capture_url ? `<a href="${escapeHtml(ride.payment_capture_url)}" target="_blank"><img class="payment-proof" src="${escapeHtml(ride.payment_capture_url)}" alt="Comprobante"></a>` : ""}<button class="button success small" data-verify-payment="${ride.id}">Verificar pago</button></article>`).join("") : `<div class="empty">No hay servicios pendientes de verificación.</div>`;
  node.querySelectorAll("[data-verify-payment]").forEach(button => button.addEventListener("click", () => verifyRidePayment(button.dataset.verifyPayment)));
}

function renderPaymentConfiguration() {
  setTimeout(loadPaymentConfiguration, 0);
  return `<section class="card form-card"><h2>Tasa BCV y Pago móvil</h2><div id="payment-config-fields"></div></section>`;
}

async function loadPaymentConfiguration() {
  const node = document.querySelector("#payment-config-fields");
  if (!node) return;
  const { data } = await supabase.from("app_settings").select("*").order("key");
  const rate = data?.find(item => item.key === "bcv_usd_rate")?.value || "";
  node.innerHTML = `<form id="payment-config-form" class="stack"><label>Tasa BCV: 1 USD en Bs<input name="bcvRate" type="number" step="0.01" min="0.01" value="${escapeHtml(rate)}" required></label><button class="button primary">Guardar tasa</button><div class="payment-details"><span>Cédula / RIF: 27.146.006</span><span>Teléfono: 0412-8481584</span><span>Banco: Mercantil · 0105</span></div></form>`;
  document.querySelector("#payment-config-form").addEventListener("submit", async event => {
    event.preventDefault();
    const rateValue = new FormData(event.currentTarget).get("bcvRate");
    const { error } = await supabase.from("app_settings").update({ value: String(rateValue), updated_at: new Date().toISOString() }).eq("key", "bcv_usd_rate");
    if (error) return showToast(error.message, true);
    showToast("Tasa BCV actualizada.");
  });
}

function renderAllyOrders(history) {
  const orders = state.orders.filter((order) => history ? order.status === "delivered" : !["delivered", "cancelled"].includes(order.status));
  return `<p class="muted">${history ? "Servicios finalizados de tu aliado." : "Pedidos en espera de soporte, asignados o en curso."}</p><div class="list">${renderOrderCards(orders, history ? "completed" : "ally")}</div>`;
}

function renderDriverApplications() { setTimeout(loadDriverApplications, 0); return `<section><h2>Postulaciones de conductores</h2><div id="driver-applications-list" class="list"><p class="muted">Cargando solicitudes…</p></div></section>`; }
async function loadDriverApplications() { const node=document.querySelector("#driver-applications-list"); if(!node)return; const {data,error}=await supabase.from("driver_applications").select("*").order("created_at",{ascending:false}); if(error)return node.innerHTML=`<p class="error">${escapeHtml(error.message)}</p>`; node.innerHTML=data?.length ? data.map(a=>`<article class="card"><strong>${escapeHtml(a.full_name)}</strong><p>CC: ${escapeHtml(a.id_number)} · ${escapeHtml(a.phone)}</p><p>${escapeHtml(a.address)}</p><span class="badge">${escapeHtml(a.status)}</span></article>`).join("") : `<div class="empty">No hay postulaciones.</div>`; }

function renderActiveCouriers() {
  const couriers = activeCouriers();
  if (!couriers.length) return `<div class="empty">No hay motorizados activos en este momento.</div>`;
  return `<p class="muted">Estado de disponibilidad de cada motorizado conectado.</p><div class="list">${couriers.map((profile) => {
    const currentOrders = state.orders.filter((order) => order.courier_id === profile.id && ["assigned", "at_store", "in_transit"].includes(order.status));
    const isBusy = currentOrders.length > 0;
    const orderDetails = currentOrders.map((order) => `${escapeHtml(order.allies?.name || "Aliado")} · ${escapeHtml(order.client_name)} (#${order.id.slice(0, 8)}) — ${statusNames[order.status]}`).join("<br>");
    return `<article class="card order-top"><div><h3>${escapeHtml(profile.full_name)}</h3><p>@${escapeHtml(profile.username)} · ${escapeHtml(profile.phone || "Sin teléfono")}</p><p class="muted">Última conexión: ${dateTime(profile.last_seen_at)}</p>${isBusy ? `<p class="courier-work"><strong>Pedido${currentOrders.length > 1 ? "s" : ""} en curso:</strong><br>${orderDetails}</p>` : ""}</div><span class="badge ${isBusy ? "orange" : "green"}">${isBusy ? "Ocupado" : "Disponible"}</span></article>`;
  }).join("")}</div>`;
}

function monitoringCouriers() {
  const positions = new Map(state.courierLocations.map((location) => [location.courier_id, location]));
  const freshAfter = Date.now() - 90000;
  return activeCouriers().map((profile) => {
    const currentOrders = state.orders.filter((order) => order.courier_id === profile.id && ["assigned", "at_store", "in_transit"].includes(order.status));
    const location = positions.get(profile.id);
    const locationIsFresh = location && new Date(location.updated_at).getTime() > freshAfter;
    const busy = currentOrders.length > 0;
    const orderDescription = currentOrders.map((order) => `${escapeHtml(order.allies?.name || "Aliado")} · #${order.id.slice(0, 8)} · ${statusNames[order.status]}`).join("<br>");
    const positionDescription = locationIsFresh
      ? `Ubicación actualizada ${dateTime(location.updated_at)}${location.accuracy ? ` · precisión ±${Math.round(location.accuracy)} m` : ""}`
      : "Esperando ubicación GPS del teléfono";
    return `<article class="card monitoring-courier"><div><h3>${escapeHtml(profile.full_name)}</h3><p>${escapeHtml(profile.phone || "Sin teléfono")} · ${positionDescription}</p>${busy ? `<p class="courier-work"><strong>Ocupado:</strong><br>${orderDescription}</p>` : `<p class="courier-work">Disponible para tomar pedidos</p>`}</div><span class="badge ${busy ? "orange" : "green"}">${busy ? "Ocupado" : "Disponible"}</span></article>`;
  }).join("");
}

function renderMonitoring() {
  const couriers = activeCouriers();
  return `<p class="muted">Ubicaciones recientes de motorizados conectados. La posición se comparte mientras el motorizado está en línea y autorizó el GPS.</p>
    <p id="monitoring-data-warning" class="error ${state.monitoringLocationLoadError ? "" : "hidden"}">No se pudo consultar la tabla de ubicaciones. Ejecuta la actualización de <code>supabase/schema.sql</code> y verifica los permisos.</p>
    <div id="monitoring-map" class="monitoring-map" role="application" aria-label="Mapa de motorizados"></div>
    <p id="monitoring-map-message" class="fine-print">${couriers.length ? "Cargando mapa y ubicaciones..." : "No hay motorizados conectados ahora."}</p>
    ${state.courierLocationError ? `<p class="error">${escapeHtml(state.courierLocationError)}</p>` : ""}
    <div id="monitoring-couriers" class="list">${monitoringCouriers() || `<div class="empty">No hay motorizados conectados en este momento.</div>`}</div>
    <p class="fine-print">El mapa usa Leaflet y datos cartográficos de OpenStreetMap. El seguimiento se detiene cuando el motorizado cambia a OFF o cierra sesión.</p>`;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (state.leafletPromise) return state.leafletPromise;
  state.leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet="true"]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      stylesheet.dataset.leaflet = "true";
      document.head.appendChild(stylesheet);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      state.leafletPromise = null;
      reject(new Error("No se pudo cargar Leaflet. Comprueba la conexión a internet."));
    };
    document.head.appendChild(script);
  });
  return state.leafletPromise;
}

async function initializeMonitoringMap() {
  const container = document.querySelector("#monitoring-map");
  if (!container) return;
  try {
    const leaflet = await loadLeaflet();
    if (state.screen !== "monitoreo" || !container.isConnected) return;
    if (state.monitoringMap && state.monitoringMapContainer !== container) {
      state.monitoringMap.remove();
      state.monitoringMap = null;
      state.monitoringMarkers = null;
      state.monitoringMapDidFit = false;
    }
    if (!state.monitoringMap) {
      state.monitoringMapContainer = container;
      state.monitoringMap = leaflet.map(container).setView([10.5, -66.9], 5);
      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      }).addTo(state.monitoringMap);
      state.monitoringMarkers = leaflet.layerGroup().addTo(state.monitoringMap);
    }
    refreshMonitoringMap();
  } catch (error) {
    console.error("No se pudo inicializar el mapa de monitoreo:", error);
    const message = document.querySelector("#monitoring-map-message");
    if (message) message.textContent = error.message;
  }
}

function monitoringLocations() {
  const profiles = new Map(activeCouriers().map((profile) => [profile.id, profile]));
  const freshAfter = Date.now() - 90000;
  return state.courierLocations
    .filter((location) => profiles.has(location.courier_id) && new Date(location.updated_at).getTime() > freshAfter)
    .map((location) => ({ ...location, profile: profiles.get(location.courier_id) }));
}

function refreshMonitoringMap() {
  if (!state.monitoringMap || !state.monitoringMarkers) return;
  const leaflet = window.L;
  const locations = monitoringLocations();
  state.monitoringMarkers.clearLayers();
  const bounds = [];

  for (const location of locations) {
    const busy = state.orders.some((order) => order.courier_id === location.courier_id && ["assigned", "at_store", "in_transit"].includes(order.status));
    const name = escapeHtml(location.profile.full_name);
    const marker = leaflet.circleMarker([location.latitude, location.longitude], {
      radius: 9,
      color: busy ? "#ff707b" : "#42d392",
      fillColor: busy ? "#ff707b" : "#42d392",
      fillOpacity: 0.9,
      weight: 2
    });
    marker.bindTooltip(name, {
      permanent: true,
      direction: "top",
      offset: [0, -8],
      className: "courier-map-label",
      opacity: 1
    });
    marker.bindPopup(`<strong>${name}</strong><br>${busy ? "Ocupado" : "Disponible"}<br>Actualizado: ${dateTime(location.updated_at)}`);
    marker.addTo(state.monitoringMarkers);
    bounds.push([location.latitude, location.longitude]);
  }

  if (bounds.length && !state.monitoringMapDidFit) {
    state.monitoringMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    state.monitoringMapDidFit = true;
  }
  const message = document.querySelector("#monitoring-map-message");
  if (message) {
    message.textContent = locations.length
      ? `${locations.length} ubicación${locations.length === 1 ? "" : "es"} reciente${locations.length === 1 ? "" : "s"} en el mapa.`
      : "No hay posiciones GPS recientes. Verifica que los motorizados estén en línea y hayan permitido la ubicación.";
  }
}

function refreshMonitoringView() {
  const list = document.querySelector("#monitoring-couriers");
  if (!list) return;
  const warning = document.querySelector("#monitoring-data-warning");
  warning?.classList.toggle("hidden", !state.monitoringLocationLoadError);
  list.innerHTML = monitoringCouriers() || `<div class="empty">No hay motorizados conectados en este momento.</div>`;
  refreshMonitoringMap();
}

function renderDashboard() {
  const role = state.profile.role;
  const today = dayStart();
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= today && (role !== "motorizado" || order.courier_id === state.profile.id));
  const completed = state.orders.filter((order) => order.status === "delivered" && new Date(order.delivered_at) >= today);
  const revenue = completed.reduce((sum, order) => sum + (role === "motorizado" ? courierEarnings(order) : Number(order.delivery_fee)), 0);
  const activeOrders = state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  return `<div class="grid metrics">
    <article class="card"><span class="metric-label">Pedidos creados hoy</span><div class="metric-value">${createdToday.length}</div><span class="metric-foot">${completed.length} entregas finalizadas</span></article>
    <article class="card"><span class="metric-label">${role === "motorizado" ? `Tu ganancia hoy (${courierEarningsPercentage()}%)` : "Delivery generado hoy"}</span><div class="metric-value">${formatMoney(revenue)}</div><span class="metric-foot">${role === "motorizado" ? "Tu parte de los pedidos entregados" : "Suma de costos de delivery"}</span></article>
    <article class="card"><span class="metric-label">Motorizados activos</span><div class="metric-value">${role === "motorizado" ? (state.profile.online ? "1" : "0") : countOnline()}</div><span class="metric-foot">Disponibles en este momento</span></article>
  </div>
  <div class="section-head"><h2>${role === "motorizado" ? "Tus entregas activas" : "Servicios en curso"}</h2></div>
  <div class="list">${renderOrderCards(activeOrders.filter((order) => role !== "motorizado" || order.courier_id === state.profile.id).slice(0, 5), "dashboard")}</div>`;
}

function statusBadge(status) {
  const color = status === "delivered" ? "green" : status === "pending" ? "gray" : status === "in_transit" ? "orange" : "";
  const label = status === "pending" && state.profile.role !== "motorizado" ? "Pendiente de asignación" : statusNames[status] || status;
  return `<span class="badge ${color}">${label}</span>`;
}

function whatsappUrl(phone, allyName) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `57${digits}`;
  const message = `Buenas, soy el delivery de ${allyName}, ya estoy recogiendo su pedido, me confirma su ubicación por favor.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function courierEarnings(order) {
  const configuredPercentage = Number(order.courier?.earnings_percentage ?? state.profile?.earnings_percentage ?? 70);
  const percentage = Number.isFinite(configuredPercentage) ? Math.min(100, Math.max(0, configuredPercentage)) : 70;
  return Number(order.delivery_fee || 0) * percentage / 100;
}

function courierEarningsPercentage() {
  const configuredPercentage = Number(state.profile?.earnings_percentage ?? 70);
  return Number.isFinite(configuredPercentage) ? Math.min(100, Math.max(0, configuredPercentage)) : 70;
}

function orderDeadline(order) {
  if (order.status === "pending") return new Date(order.assigned_at || order.created_at).getTime() + 10 * 60 * 1000;
  if (order.status === "assigned" && !order.at_store_at) return new Date(order.assigned_at || order.created_at).getTime() + 10 * 60 * 1000;
  return null;
}

function renderDeadline(order) {
  if (!["soporte", "administracion"].includes(state.profile.role)) return "";
  const deadline = orderDeadline(order);
  if (!deadline) return "";
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const overdue = seconds === 0;
  const display = overdue ? `RETRASADO +${formatElapsed(-seconds)}` : `Llegada al comercio en ${formatElapsed(seconds)}`;
  return `<div class="deadline ${overdue ? "overdue" : ""}" data-deadline="${deadline}" data-order-id="${order.id}">${display}</div>`;
}

function formatElapsed(seconds) {
  const safeSeconds = Math.abs(seconds);
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function updateOverdueClocks() {
  const now = Date.now();
  document.querySelectorAll(".deadline[data-deadline]").forEach((node) => {
    const deadline = Number(node.dataset.deadline);
    const seconds = Math.ceil((deadline - now) / 1000);
    const overdue = seconds <= 0;
    node.classList.toggle("overdue", overdue);
    node.closest(".order-card")?.classList.toggle("late", overdue);
    node.textContent = overdue
      ? `RETRASADO +${formatElapsed(-seconds)}`
      : `Llegada al comercio en ${formatElapsed(seconds)}`;
  });

  if (!state.overdueSoundsEnabled || document.hidden) return;
  let shouldAlarm = false;
  for (const order of state.orders) {
    const deadline = orderDeadline(order);
    if (!deadline || now < deadline) continue;
    const lastAlarm = state.overdueAlarmTimes.get(order.id) || 0;
    if (now - lastAlarm < 2 * 60 * 1000) continue;
    state.overdueAlarmTimes.set(order.id, now);
    shouldAlarm = true;
  }
  if (shouldAlarm) void playOverdueAlarm();
}

async function enableOverdueSounds() {
  if (state.overdueSoundsEnabled) {
    state.overdueSoundsEnabled = false;
    showToast("Alarma de pedidos retrasados desactivada.");
    renderApp();
    return;
  }
  try {
    await prepareAlertAudio("overdue");
    state.overdueSoundsEnabled = true;
    showToast("Alarma activada con el audio de peligro clásico.");
    renderApp();
  } catch (error) {
    reportError(error);
  }
}

async function playOverdueAlarm() {
  if (!state.overdueSoundsEnabled) return;
  await playAlertAudio("overdue");
}

function renderOrderCards(orders, context = "") {
  if (!orders.length) return `<div class="empty">No hay pedidos para mostrar.</div>`;
  return orders.map((order) => {
    const allyName = order.allies?.name || "Aliado";
    const ally = escapeHtml(allyName);
    const courier = escapeHtml(order.courier?.full_name || "Sin asignar");
    const buttons = [];
    if (context === "available") {
      buttons.push(`<span class="badge green courier-earnings">Tu ganancia: ${formatMoney(courierEarnings(order))}</span>`);
      buttons.push(`<button class="button primary small" data-action="claim" data-id="${order.id}">Tomar pedido</button>`);
    }
    if (context === "current") {
      const next = { assigned: ["at_store", "Llegada al comercio"], at_store: ["in_transit", "Pedido en camino"], in_transit: ["delivered", "Pedido entregado"] }[order.status];
      if (next) buttons.push(`<button class="button ${next[0] === "delivered" ? "success" : "primary"} small" data-action="advance" data-status="${next[0]}" data-id="${order.id}">${next[1]}</button>`);
      buttons.push(`<button class="button subtle small" data-action="maps" data-url="${escapeHtml(order.maps_url || "")}">Abrir ubicación</button>`);
      buttons.push(`<button class="button subtle small" data-action="copy-phone" data-phone="${escapeHtml(order.client_phone)}">Copiar teléfono</button>`);
      buttons.push(`<a class="button success small" target="_blank" rel="noopener noreferrer" href="${whatsappUrl(order.client_phone, allyName)}">Contactar cliente</a>`);
    }
    if (context === "pending" && !order.released) buttons.push(`<button class="button primary small" data-action="release" data-id="${order.id}">Liberar pedido</button>`);
    if (["staff", "pending"].includes(context) && state.profile.role === "soporte" && !["delivered", "cancelled"].includes(order.status)) {
      buttons.push(`<button class="button danger small" data-action="cancel-order" data-id="${order.id}">Cancelar pedido</button>`);
    }
    if (context === "staff" && order.status === "assigned" && !order.at_store_at && ["administracion", "soporte"].includes(state.profile.role)) {
      buttons.push(`<label class="assign-control">Nuevo motorizado<select data-reassign-select="${order.id}"><option value="">Selecciona un motorizado activo…</option>${activeCouriers().filter((profile) => profile.id !== order.courier_id).map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>`);
      buttons.push(`<button class="button primary small" data-action="reassign" data-id="${order.id}">Reasignar pedido</button>`);
      buttons.push(`<button class="button subtle small" data-action="release" data-id="${order.id}">Liberar para que otro lo tome</button>`);
    } else if (["staff", "pending"].includes(context) && ["administracion", "soporte"].includes(state.profile.role) && order.status === "pending") {
      buttons.push(`<label class="assign-control">Asignar motorizado<select data-action="assign" data-id="${order.id}"><option value="">${order.courier_id ? "Cambiar asignación…" : "Seleccionar…"}</option>${activeCouriers().map((profile) => `<option value="${profile.id}" ${profile.id === order.courier_id ? "selected" : ""}>${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>`);
    }
    const isCourier = state.profile.role === "motorizado";
    const priceLabel = isCourier ? `<strong>Tu ganancia (${courierEarningsPercentage()}%):</strong> ${formatMoney(courierEarnings(order))}` : `<strong>Delivery:</strong> ${formatMoney(order.delivery_fee)}`;
    const orderStatus = order.status === "pending" && order.released === false && ["soporte", "administracion"].includes(state.profile.role)
      ? `<span class="badge orange">Pendiente de soporte</span>`
      : statusBadge(order.status);
    return `<article class="order-card"><div class="order-top"><div><h3>${ally} <span class="muted">· ${escapeHtml(order.client_name)}</span></h3><p>Pedido #${order.id.slice(0, 8)} · ${dateTime(order.created_at)}</p></div>${orderStatus}</div>
      ${renderDeadline(order)}
      ${context === "current" && order.allies?.location_url ? `<div class="merchant-location"><button class="button subtle small" data-action="maps" data-url="${escapeHtml(order.allies.location_url)}">Ubicación del comercio</button></div>` : ""}
      <p class="order-detail"><strong>Cliente:</strong> ${escapeHtml(order.client_name)} · ${escapeHtml(order.client_phone)}<br><strong>Descripción:</strong> ${escapeHtml(order.description || "—")}<br><strong>Dirección:</strong> ${escapeHtml(order.address)}<br><strong>Motorizado:</strong> ${courier === "Sin asignar" ? escapeHtml(order.courier_name || courier) : courier}<br><strong>Creado por:</strong> ${escapeHtml(order.creator?.full_name || order.creator_name || "—")}${context === "completed" ? `<br><strong>Recogida en comercio:</strong> ${dateTime(order.at_store_at)}<br><strong>Entrega:</strong> ${dateTime(order.delivered_at)}` : ""}${order.status === "cancelled" ? `<br><strong>Motivo de cancelación:</strong> ${escapeHtml(order.cancellation_reason || "No indicado")}<br><strong>Cancelado:</strong> ${dateTime(order.cancelled_at)}` : ""}<br>${priceLabel}</p>
      ${buttons.length ? `<div class="order-actions">${buttons.join("")}</div>` : ""}</article>`;
  }).join("");
}

function renderCourierAvailable() {
  const orders = state.orders.filter((order) => order.status === "pending" && order.released !== false);
  return `<p class="muted">Toma un pedido disponible para asignarlo a tu cuenta. Solo podrás recibir pedidos mientras estés activo.</p><div class="list">${renderOrderCards(state.profile.online ? orders : [], "available")}</div>`;
}

function renderCourierCurrent() {
  const orders = state.orders.filter((order) => order.courier_id === state.profile.id && !["delivered", "cancelled"].includes(order.status));
  return `<div class="list">${renderOrderCards(orders, "current")}</div>`;
}

function renderCourierDelivered() {
  return `<div class="toolbar"><label>Periodo<select id="period-select"><option value="day" ${state.period === "day" ? "selected" : ""}>Hoy</option><option value="week" ${state.period === "week" ? "selected" : ""}>Esta semana</option><option value="month" ${state.period === "month" ? "selected" : ""}>Este mes</option><option value="all" ${state.period === "all" ? "selected" : ""}>Todo el historial</option><option value="custom" ${state.period === "custom" ? "selected" : ""}>Elegir fechas</option></select></label>
    <label class="custom-date ${state.period === "custom" ? "" : "hidden"}">Desde<input type="date" id="date-from"></label><label class="custom-date ${state.period === "custom" ? "" : "hidden"}">Hasta<input type="date" id="date-to"></label>
  </div><div id="delivered-results">${deliveredSummary()}</div>`;
}

function filteredDelivered() {
  const now = new Date();
  const list = state.orders.filter((order) => order.status === "delivered" && order.courier_id === state.profile.id);
  if (state.period === "all" || state.period === "custom") return list;
  const start = dayStart(now);
  if (state.period === "week") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  }
  if (state.period === "month") start.setDate(1);
  return list.filter((order) => new Date(order.delivered_at) >= start);
}

function deliveredSummary() {
  const orders = filteredDelivered();
  const amount = orders.reduce((sum, order) => sum + courierEarnings(order), 0);
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos en el periodo</span><div class="metric-value">${orders.length}</div></article><article class="card"><span class="metric-label">Ganancia (${courierEarningsPercentage()}%)</span><div class="metric-value">${formatMoney(amount)}</div></article><article class="card"><span class="metric-label">Ganancia de hoy</span><div class="metric-value">${formatMoney(filteredToday().reduce((sum, order) => sum + courierEarnings(order), 0))}</div></article></div><div class="section-head"><h2>Historial de entregas</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function filteredToday() {
  return state.orders.filter((order) => order.status === "delivered" && order.courier_id === state.profile.id && new Date(order.delivered_at) >= dayStart());
}

function renderCompletedOrders() {
  const orders = state.orders.filter((order) => order.status === "delivered");
  return `<div class="section-head"><h2>Pedidos finalizados</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function renderStaffOrders() {
  setTimeout(loadPassengerServices, 0);
  return `<h2>Servicios de traslado</h2><div id="passenger-services-list" class="list"><p class="muted">Cargando solicitudes…</p></div><div class="section-head"><h2>Servicios anteriores</h2></div><div class="toolbar"><label>Filtrar por estado<select id="staff-status"><option value="active">En curso</option><option value="pending">Sin asignar</option><option value="assigned">Asignados</option><option value="at_store">En el comercio</option><option value="in_transit">En camino</option><option value="cancelled">Cancelados</option><option value="all">Todos</option></select></label></div><div id="staff-orders" class="list">${renderOrderCards(state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status)), "staff")}</div>`;
}

async function loadPassengerServices() {
  const node = document.querySelector("#passenger-services-list");
  if (!node) return;
  const { data, error } = await supabase.from("rides").select("*").order("created_at", { ascending: false });
  if (error) return node.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  node.innerHTML = data?.length ? data.map(ride => `<article class="card"><div class="ride-admin-card"><div><strong>#${ride.id.slice(0, 8)} · ${escapeHtml(ride.service_type)}</strong><p>${escapeHtml(ride.pickup_text)} → ${escapeHtml(ride.destination_text)}</p><p class="muted">$${Number(ride.price || 0).toFixed(2)} · Bs ${Number(ride.payment_amount_bs || 0).toFixed(2)} · Ref. ${escapeHtml(ride.payment_reference || "—")}</p></div>${ride.payment_capture_url ? `<a href="${escapeHtml(ride.payment_capture_url)}" target="_blank" rel="noopener"><img class="payment-proof" src="${escapeHtml(ride.payment_capture_url)}" alt="Comprobante de pago"></a>` : `<span class="badge orange">Sin comprobante</span>`}</div><button class="button success small" data-verify-payment="${ride.id}" ${ride.payment_status === "verified" ? "disabled" : ""}>${ride.payment_status === "verified" ? "Pago verificado" : "Verificar pago"}</button></article>`).join("") : `<div class="empty">No hay solicitudes de traslado.</div>`;
  node.querySelectorAll("[data-verify-payment]").forEach(button => button.addEventListener("click", () => verifyRidePayment(button.dataset.verifyPayment)));
}

async function verifyRidePayment(id) {
  const { error } = await supabase.from("rides").update({ payment_status: "verified", status: "pending" }).eq("id", id);
  if (error) return showToast(error.message, true);
  showToast("Pago verificado. El servicio ya puede asignarse.");
  loadPassengerServices();
}

function renderCreateOrder() {
  const isAlly = state.profile.role === "aliado";
  const linkedAlly = state.allies.find((ally) => ally.id === state.profile.ally_id);
  return `<article class="card form-card"><form id="create-order" class="form-grid">
    ${isAlly
      ? `<div class="card wide"><strong>Aliado:</strong> ${escapeHtml(linkedAlly?.name || "Sin aliado asignado")}${linkedAlly?.location_url ? ` · <a href="${escapeHtml(linkedAlly.location_url)}" target="_blank" rel="noopener noreferrer">Ver GPS del comercio</a>` : ""}</div>`
      : `<label>Aliado comercial<select name="allyId" required><option value="">Selecciona un aliado</option>${state.allies.map((ally) => `<option value="${ally.id}">${escapeHtml(ally.name)}</option>`).join("")}</select></label>
        <label class="inline-checkbox"><input type="checkbox" id="assign-courier-toggle">Asignar repartidor ahora</label>
        <label class="wide hidden" id="assigned-courier-field">Motorizado activo<select name="courierId" id="assigned-courier"><option value="">Selecciona un motorizado activo</option>${activeCouriers().map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)} (@${escapeHtml(profile.username)})</option>`).join("")}</select><span class="muted">Solo aparecen motorizados activos ahora.</span></label>`}
    <label>Nombre del cliente<input name="clientName" required></label>
    <label>Teléfono del cliente<input name="clientPhone" type="tel" required></label>
    <label>Precio del delivery<input name="deliveryFee" type="number" min="0" step="any" inputmode="decimal" required></label>
    <label class="wide">Descripción del pedido<textarea name="description" placeholder="Ej.: Torta, traslado, encomienda..." required></textarea></label>
    <label class="wide">Dirección escrita<textarea name="address"></textarea></label>
    <label class="wide">Ubicación de Google Maps (URL)<input name="mapsUrl" type="url" placeholder="https://maps.google.com/..."></label>
    <div class="wide"><button class="button primary" type="submit">Crear servicio</button></div>
  </form></article>`;
}

function renderAllies() {
  const isAdmin = state.profile.role === "administracion";
  return `<div class="section-head"><h2>Aliados comerciales</h2></div>${isAdmin ? `<form id="ally-form" class="form-grid card"><label>Nombre del aliado<input name="name" required></label><label>Ubicación GPS del comercio (URL)<input name="locationUrl" type="url" placeholder="https://maps.google.com/..."></label><div class="wide"><button class="button primary">Agregar aliado</button></div></form>` : ""}
    <div class="list">${state.allies.length ? state.allies.map((ally) => `<article class="card order-top"><div><h3>${escapeHtml(ally.name)}</h3><p class="muted">Creado ${dateTime(ally.created_at)}</p>${ally.location_url ? `<a class="text-button" href="${escapeHtml(ally.location_url)}" target="_blank" rel="noopener noreferrer">Ver ubicación del comercio</a>` : ""}</div>${isAdmin ? `<button class="button danger small" data-action="delete-ally" data-id="${ally.id}">Eliminar</button>` : ""}</article>`).join("") : `<div class="empty">Aún no hay aliados registrados.</div>`}</div>`;
}

function renderUsers() {
  const query = state.usersSearch.trim().toLowerCase();
  const visibleProfiles = state.profiles.filter((profile) => {
    const matchesRole = state.usersRole === "all" || profile.role === state.usersRole;
    const matchesSearch = !query || `${profile.username} ${profile.full_name} ${profile.phone || ""}`.toLowerCase().includes(query);
    return matchesRole && matchesSearch;
  });
  const roleTabs = [
    ["all", "Todos"], ["motorizado", "Motorizados"], ["aliado", "Aliados"],
    ["soporte", "Soporte"], ["administracion", "Administración"]
  ];
  const rows = visibleProfiles.map((profile) => `<tr><td>@${escapeHtml(profile.username)}</td><td><input aria-label="Nombre completo" data-profile-name="${profile.id}" value="${escapeHtml(profile.full_name)}"><input aria-label="Teléfono" data-profile-phone="${profile.id}" value="${escapeHtml(profile.phone || "")}" style="margin-top:6px"></td><td><select data-action="role" data-id="${profile.id}"><option value="">Sin rol</option>${Object.entries(roleNames).map(([value, label]) => `<option value="${value}" ${profile.role === value ? "selected" : ""}>${label}</option>`).join("")}</select>${profile.role === "motorizado" ? `<label class="muted">Porcentaje de ganancia <input type="number" min="0" max="100" step="1" data-profile-percentage="${profile.id}" value="${Number(profile.earnings_percentage ?? 70)}">%</label>` : ""}</td><td><select aria-label="Aliado del usuario" data-profile-ally="${profile.id}"><option value="">Sin aliado</option>${state.allies.map((ally) => `<option value="${ally.id}" ${profile.ally_id === ally.id ? "selected" : ""}>${escapeHtml(ally.name)}</option>`).join("")}</select></td><td>${profile.suspended ? `<span class="badge">Suspendido</span>` : profile.approved ? `<span class="badge green">${profile.online ? "Activo" : "Aprobado"}</span>` : `<span class="badge orange">Pendiente</span>`}</td><td class="user-actions"><button class="button subtle small" data-action="save-profile" data-id="${profile.id}">Guardar</button><button class="button ${profile.suspended ? "success" : "danger"} small" data-action="suspend" data-id="${profile.id}" data-suspended="${profile.suspended}">${profile.suspended ? "Reactivar" : "Suspender"}</button><button class="button danger small" data-action="delete-user" data-id="${profile.id}">Eliminar</button></td></tr>`).join("");
  return `<div class="section-head"><h2>Usuarios y permisos</h2><span class="badge">${visibleProfiles.length} usuarios</span></div>
    <div class="toolbar users-toolbar"><label class="wide">Buscar usuario<input id="users-search" type="search" placeholder="Nombre, usuario o teléfono" value="${escapeHtml(state.usersSearch)}"></label><div class="wide" style="display:flex;gap:8px;flex-wrap:wrap">${roleTabs.map(([role, label]) => `<button type="button" class="button ${state.usersRole === role ? "primary" : "subtle"} small" data-user-role="${role}">${label}</button>`).join("")}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Nombre y teléfono</th><th>Rol / porcentaje</th><th>Aliado asignado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="muted">No hay usuarios que coincidan.</td></tr>`}</tbody></table></div><p class="fine-print">El porcentaje de ganancia se aplica sobre el costo de cada delivery. Las amonestaciones se pueden reflejar reduciendo este porcentaje.</p>`;
}

function renderReports() {
  const delivered = state.orders.filter((order) => order.status === "delivered");
  const todayDelivered = delivered.filter((order) => new Date(order.delivered_at) >= dayStart());
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= dayStart());
  const couriers = state.profiles.filter((profile) => profile.role === "motorizado");
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos creados hoy</span><div class="metric-value">${createdToday.length}</div><span class="metric-foot">${todayDelivered.length} entregados</span></article><article class="card"><span class="metric-label">Delivery generado hoy</span><div class="metric-value">${formatMoney(todayDelivered.reduce((sum, order) => sum + Number(order.delivery_fee), 0))}</div></article><article class="card"><span class="metric-label">Motorizados activos</span><div class="metric-value">${countOnline()}</div></article></div>
    <div class="section-head"><h2>Reportes de entregas</h2></div><div class="toolbar">
      <label>Desde<input type="date" id="report-from"></label>
      <label>Hasta<input type="date" id="report-to"></label>
      <label>Motorizado<select id="report-courier"><option value="">Todos los motorizados</option>${couriers.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>
      <label>Aliado<select id="report-ally"><option value="">Todos los aliados</option>${state.allies.map((ally) => `<option value="${ally.id}">${escapeHtml(ally.name)}</option>`).join("")}</select></label>
      <button class="button primary" data-action="export">Descargar reporte Excel</button>
    </div>
    <div id="report-table" class="table-wrap">${reportTable(reportOrders())}</div>`;
}

function averageDurationSeconds(orders, startField, endField) {
  const durations = orders
    .filter((order) => order[startField] && order[endField])
    .map((order) => (new Date(order[endField]).getTime() - new Date(order[startField]).getTime()) / 1000)
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
  if (!durations.length) return null;
  return durations.reduce((total, seconds) => total + seconds, 0) / durations.length;
}

function formatDuration(seconds) {
  if (seconds === null) return "—";
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min ${remainingSeconds} s`;
  return `${remainingSeconds} s`;
}

function renderMetrics() {
  const today = dayStart();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const deliveredToday = state.orders.filter((order) => order.status === "delivered"
    && new Date(order.delivered_at) >= today
    && new Date(order.delivered_at) < tomorrow);
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= today && new Date(order.created_at) < tomorrow);
  const avgAcceptance = averageDurationSeconds(createdToday, "created_at", "assigned_at");
  const avgDelivery = averageDurationSeconds(deliveredToday, "at_store_at", "delivered_at");
  const ordersByCourier = new Map();

  const courierMetrics = (name) => ({ name, orders: [], acceptanceOrders: [] });

  for (const order of deliveredToday) {
    if (!order.courier_id) continue;
    const existing = ordersByCourier.get(order.courier_id) || courierMetrics(order.courier?.full_name || order.courier_name || "Motorizado");
    existing.orders.push(order);
    ordersByCourier.set(order.courier_id, existing);
  }

  for (const order of createdToday.filter((item) => item.assigned_at && item.courier_id)) {
    const existing = ordersByCourier.get(order.courier_id) || courierMetrics(order.courier?.full_name || order.courier_name || "Motorizado");
    existing.acceptanceOrders.push(order);
    ordersByCourier.set(order.courier_id, existing);
  }

  for (const profile of state.profiles.filter((item) => item.role === "motorizado")) {
    if (!ordersByCourier.has(profile.id)) {
      ordersByCourier.set(profile.id, courierMetrics(profile.full_name));
    }
  }

  const ranking = [...ordersByCourier.values()].sort((left, right) =>
    right.orders.length - left.orders.length || left.name.localeCompare(right.name, "es")
  );
  const topCourier = ranking[0]?.orders.length ? ranking[0].name : "—";
  const rankingRows = ranking.map(({ name, orders, acceptanceOrders }) => {
    const acceptance = averageDurationSeconds(acceptanceOrders, "created_at", "assigned_at");
    const delivery = averageDurationSeconds(orders, "at_store_at", "delivered_at");
    return `<tr><td>${escapeHtml(name)}</td><td>${orders.length}</td><td>${formatDuration(acceptance)}</td><td>${formatDuration(delivery)}</td></tr>`;
  }).join("");

  return `<div class="grid metrics">
    <article class="card"><span class="metric-label">Servicios finalizados hoy</span><div class="metric-value">${deliveredToday.length}</div></article>
    <article class="card"><span class="metric-label">Motorizado con más entregas</span><div class="metric-value metric-text">${escapeHtml(topCourier)}</div><span class="metric-foot">${ranking[0]?.orders.length || 0} pedidos completados hoy</span></article>
    <article class="card"><span class="metric-label">Promedio de aceptación</span><div class="metric-value">${formatDuration(avgAcceptance)}</div><span class="metric-foot">Desde creación hasta asignación, pedidos creados hoy</span></article>
    <article class="card"><span class="metric-label">Promedio de entrega</span><div class="metric-value">${formatDuration(avgDelivery)}</div><span class="metric-foot">Desde llegada al comercio hasta entrega, finalizados hoy</span></article>
  </div>
  <div class="section-head"><h2>Desempeño de motorizados · hoy</h2></div>
  <div class="table-wrap"><table><thead><tr><th>Motorizado</th><th>Servicios finalizados</th><th>Promedio de aceptación</th><th>Promedio de entrega</th></tr></thead><tbody>${rankingRows || `<tr><td colspan="4">No hay motorizados registrados.</td></tr>`}</tbody></table></div>`;
}

function reportTable(orders) {
  return `<table><thead><tr><th>Aliado</th><th>Cliente</th><th>Dirección</th><th>Motorizado</th><th>Creado por</th><th>Hora comercio</th><th>Hora entrega</th><th>Fecha</th><th>Delivery</th></tr></thead><tbody>${orders.length ? orders.map((order) => `<tr><td>${escapeHtml(order.allies?.name)}</td><td>${escapeHtml(order.client_name)}</td><td>${escapeHtml(order.address)}</td><td>${escapeHtml(order.courier?.full_name || order.courier_name || "")}</td><td>${escapeHtml(order.creator?.full_name || order.creator_name || "—")}</td><td>${dateTime(order.at_store_at)}</td><td>${dateTime(order.delivered_at)}</td><td>${new Date(order.delivered_at).toLocaleDateString("es-CO")}</td><td>${formatMoney(order.delivery_fee)}</td></tr>`).join("") : `<tr><td colspan="9">Sin pedidos para el periodo seleccionado.</td></tr>`}</tbody></table>`;
}

function reportOrders() {
  const from = document.querySelector("#report-from")?.value;
  const to = document.querySelector("#report-to")?.value;
  const courierId = document.querySelector("#report-courier")?.value;
  const allyId = document.querySelector("#report-ally")?.value;
  const endExclusive = to ? new Date(`${to}T00:00:00`) : null;
  if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1);
  return state.orders.filter((order) => order.status === "delivered"
    && (!from || new Date(order.delivered_at) >= new Date(`${from}T00:00:00`))
    && (!endExclusive || new Date(order.delivered_at) < endExclusive)
    && (!courierId || order.courier_id === courierId)
    && (!allyId || order.ally_id === allyId));
}

function bindScreenActions() {
  const createForm = document.querySelector("#create-order");
  if (createForm) createForm.addEventListener("submit", createOrder);
  const assignCourierToggle = document.querySelector("#assign-courier-toggle");
  if (assignCourierToggle) assignCourierToggle.addEventListener("change", () => {
    const courierField = document.querySelector("#assigned-courier-field");
    const courierSelect = document.querySelector("#assigned-courier");
    courierField.classList.toggle("hidden", !assignCourierToggle.checked);
    courierSelect.required = assignCourierToggle.checked;
    if (!assignCourierToggle.checked) courierSelect.value = "";
  });
  const allyForm = document.querySelector("#ally-form");
  if (allyForm) allyForm.addEventListener("submit", createAlly);
  const staffStatus = document.querySelector("#staff-status");
  if (staffStatus) staffStatus.addEventListener("change", () => {
    const value = staffStatus.value;
    const orders = value === "active" ? state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status)) : value === "all" ? state.orders : state.orders.filter((order) => order.status === value);
    document.querySelector("#staff-orders").innerHTML = renderOrderCards(orders, "staff");
    bindOrderActions();
  });
  const period = document.querySelector("#period-select");
  if (period) period.addEventListener("change", () => {
    state.period = period.value;
    renderApp();
  });
  document.querySelectorAll("#date-from, #date-to").forEach((input) => input.addEventListener("change", () => {
    const from = document.querySelector("#date-from")?.value;
    const to = document.querySelector("#date-to")?.value;
    if (from && to) {
      const orders = state.orders.filter((order) => order.status === "delivered" && order.courier_id === state.profile.id && new Date(order.delivered_at) >= new Date(`${from}T00:00:00`) && new Date(order.delivered_at) <= new Date(`${to}T23:59:59.999`));
      document.querySelector("#delivered-results").innerHTML = deliveredSummaryFor(orders);
    }
  }));
  document.querySelectorAll("#report-from, #report-to, #report-courier, #report-ally").forEach((input) => input.addEventListener("change", () => {
    document.querySelector("#report-table").innerHTML = reportTable(reportOrders());
  }));
  bindOrderActions();
}

function deliveredSummaryFor(orders) {
  const amount = orders.reduce((sum, order) => sum + courierEarnings(order), 0);
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos en el periodo</span><div class="metric-value">${orders.length}</div></article><article class="card"><span class="metric-label">Ganancia (${courierEarningsPercentage()}%)</span><div class="metric-value">${formatMoney(amount)}</div></article><article class="card"><span class="metric-label">Ganancia de hoy</span><div class="metric-value">${formatMoney(filteredToday().reduce((sum, order) => sum + courierEarnings(order), 0))}</div></article></div><div class="section-head"><h2>Historial de entregas</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function bindOrderActions() {
  const usersSearch = document.querySelector("#users-search");
  if (usersSearch) usersSearch.addEventListener("input", () => {
    state.usersSearch = usersSearch.value;
    renderApp();
    document.querySelector("#users-search")?.focus();
  });
  document.querySelectorAll("[data-user-role]").forEach((button) => button.addEventListener("click", () => {
    state.usersRole = button.dataset.userRole;
    renderApp();
  }));
  document.querySelectorAll('[data-action="claim"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "claim_order")));
  document.querySelectorAll('[data-action="advance"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "advance_order", { next_status: button.dataset.status })));
  document.querySelectorAll('[data-action="assign"]').forEach((select) => select.addEventListener("change", () => {
    if (select.value) updateOrder(select.dataset.id, "assign_order", { target_courier: select.value });
  }));
  document.querySelectorAll('[data-action="release"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "release_order")));
  document.querySelectorAll('[data-action="cancel-order"]').forEach((button) => button.addEventListener("click", () => cancelOrder(button.dataset.id)));
  document.querySelectorAll('[data-action="reassign"]').forEach((button) => button.addEventListener("click", () => {
    const select = document.querySelector(`[data-reassign-select="${button.dataset.id}"]`);
    if (!select?.value) return showToast("Selecciona el motorizado que recibirá el pedido.", true);
    updateOrder(button.dataset.id, "assign_order", { target_courier: select.value });
  }));
  document.querySelectorAll('[data-action="copy-phone"]').forEach((button) => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.phone);
      showToast("Teléfono copiado.");
    } catch (error) {
      reportError(new Error(`No se pudo copiar el teléfono: ${error.message}`));
    }
  }));
  document.querySelectorAll('[data-action="maps"]').forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.url) window.open(button.dataset.url, "_blank", "noopener,noreferrer");
  }));
  document.querySelectorAll('[data-action="save-profile"]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    const full_name = document.querySelector(`[data-profile-name="${id}"]`).value.trim();
    const phone = document.querySelector(`[data-profile-phone="${id}"]`).value.trim();
    if (!full_name || !phone) return showToast("Nombre y teléfono son obligatorios.", true);
    const role = document.querySelector(`[data-action="role"][data-id="${id}"]`).value || null;
    const allyId = document.querySelector(`[data-profile-ally="${id}"]`).value || null;
    if (role === "aliado" && !allyId) return showToast("Asigna un aliado comercial a este usuario.", true);
    const percentageInput = document.querySelector(`[data-profile-percentage="${id}"]`);
    const earningsPercentage = percentageInput ? Number(percentageInput.value) : undefined;
    if (earningsPercentage !== undefined && (!Number.isFinite(earningsPercentage) || earningsPercentage < 0 || earningsPercentage > 100)) return showToast("El porcentaje debe estar entre 0 y 100.", true);
    const changes = { full_name, phone, role, approved: Boolean(role), ally_id: role === "aliado" ? allyId : null };
    if (role === "motorizado" && earningsPercentage !== undefined) changes.earnings_percentage = earningsPercentage;
    updateProfile(id, changes);
  }));
  document.querySelectorAll('[data-action="suspend"]').forEach((button) => button.addEventListener("click", () => updateProfile(button.dataset.id, { suspended: button.dataset.suspended !== "true", online: false })));
  document.querySelectorAll('[data-action="delete-user"]').forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.id)));
  document.querySelectorAll('[data-action="delete-ally"]').forEach((button) => button.addEventListener("click", () => deleteAlly(button.dataset.id)));
  const exportButton = document.querySelector('[data-action="export"]');
  if (exportButton) exportButton.addEventListener("click", exportReport);
}

async function toggleOnline(event) {
  const online = event.currentTarget.checked;
  const { error } = await supabase.rpc("set_courier_online", { is_online: online });
  if (error) {
    event.currentTarget.checked = !online;
    return reportError(error);
  }
  state.profile.online = online;
  if (online) startCourierLocationTracking();
  else {
    stopCourierLocationTracking();
    state.courierLocations = state.courierLocations.filter((location) => location.courier_id !== state.profile.id);
  }
  showToast(online ? "Estás activo. Se solicitará permiso de ubicación para aparecer en Monitoreo." : "Quedaste desconectado; tu ubicación fue retirada del monitoreo.");
  await refreshData(true);
  renderApp();
}

async function createOrder(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const mapsUrl = String(data.get("mapsUrl")).trim();
  const isAlly = state.profile.role === "aliado";
  const assignedCourier = !isAlly && Boolean(document.querySelector("#assign-courier-toggle")?.checked);
  const allyId = isAlly ? state.profile.ally_id : data.get("allyId");
  if (!allyId) return showToast("Esta cuenta no tiene un aliado asignado. Contacta a administración.", true);
  if (mapsUrl && !/^https?:\/\/\S+$/i.test(mapsUrl)) return showToast("La ubicación debe ser una URL http o https.", true);
  const { data: orderId, error } = await supabase.rpc("create_order", {
    p_ally_id: allyId,
    p_client_name: String(data.get("clientName")).trim(),
    p_client_phone: String(data.get("clientPhone")).trim(),
    p_description: String(data.get("description")).trim(),
    p_address: String(data.get("address")).trim(),
    p_maps_url: mapsUrl,
    p_delivery_fee: Number(data.get("deliveryFee")),
    p_courier_id: assignedCourier ? data.get("courierId") : null
  });
  if (error) return reportError(error);
  showToast(isAlly ? "Pedido enviado a soporte; ningún motorizado lo verá todavía." : assignedCourier ? "Pedido creado y asignado al motorizado." : "Pedido creado y disponible para los motorizados.");
  state.screen = isAlly ? "mis_pedidos" : "pedidos";
  await refreshData(false);
  renderApp();
  applyPendingServiceWorkerUpdate();
  return orderId;
}

async function createAlly(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = form.get("name").toString().trim();
  const locationUrl = form.get("locationUrl").toString().trim();
  if (locationUrl && !/^https?:\/\/\S+$/i.test(locationUrl)) return showToast("La ubicación debe ser una URL http o https.", true);
  const { error } = await supabase.from("allies").insert({ name, location_url: locationUrl || null });
  if (error) return reportError(error);
  showToast("Aliado agregado.");
  await refreshData(false);
  renderApp();
}

async function deleteAlly(id) {
  if (!window.confirm("¿Eliminar este aliado?")) return;
  const { error } = await supabase.from("allies").delete().eq("id", id);
  if (error) return reportError(error);
  showToast("Aliado eliminado.");
  await refreshData(false);
  renderApp();
}

async function deleteUser(id) {
  if (id === state.profile.id) return showToast("No puedes eliminar tu propia cuenta de administración.", true);
  if (!window.confirm("¿Eliminar el acceso de este usuario? Los pedidos realizados permanecerán en el historial.")) return;
  const { error } = await supabase.rpc("delete_user_account", { target_user: id });
  if (error) return reportError(error);
  showToast("Cuenta eliminada; se conservó el historial de pedidos.");
  await refreshData(false);
  renderApp();
}

async function cancelOrder(id) {
  let reason = "";
  while (!reason.trim()) {
    reason = window.prompt("Indica la razón de la cancelación del pedido:");
    if (reason === null) return;
    if (!reason.trim()) showToast("Debes indicar una razón para cancelar el pedido.", true);
  }
  await updateOrder(id, "cancel_order", { p_reason: reason.trim() });
}

async function updateOrder(id, action, args = {}) {
  const previousOrder = action === "claim_order" ? state.orders.find((order) => order.id === id) : null;
  if (action === "claim_order") {
    state.orders = state.orders.map((order) => order.id === id
      ? { ...order, status: "assigned", courier_id: state.profile.id, courier_name: state.profile.full_name, assigned_at: new Date().toISOString(), courier: { full_name: state.profile.full_name, username: state.profile.username } }
      : order);
    if (state.screen === "activos") renderApp();
  }
  const { error } = await supabase.rpc(action, { order_id: id, ...args });
  if (error) {
    if (previousOrder) {
      state.orders = state.orders.map((order) => order.id === id ? previousOrder : order);
      renderApp();
    }
    return reportError(error);
  }
  showToast(action === "claim_order" ? "Pedido asignado a tu cuenta." : action === "assign_order" ? "Pedido asignado al motorizado." : action === "release_order" ? "Pedido liberado para motorizados activos." : "Estado del pedido actualizado.");
  if (action === "claim_order") stopCourierAlarm(id);
  await refreshData(true);
  renderApp();
}

async function updateProfile(id, changes) {
  const { error } = await supabase.from("profiles").update(changes).eq("id", id);
  if (error) return reportError(error);
  if (id === state.profile.id) state.profile = { ...state.profile, ...changes };
  showToast("Usuario actualizado.");
  await refreshData(false);
  renderApp();
}

function exportReport() {
  const columns = [
    ["Aliado", (order) => order.allies?.name || ""],
    ["Cliente", (order) => order.client_name],
    ["Descripción", (order) => order.description || ""],
    ["Direccion", (order) => order.address],
    ["Motorizado", (order) => order.courier?.full_name || ""],
    ["Creado por", (order) => order.creator?.full_name || order.creator_name || ""],
    ["Hora llegada comercio", (order) => order.at_store_at ? new Date(order.at_store_at).toLocaleTimeString("es-CO") : ""],
    ["Hora entrega", (order) => order.delivered_at ? new Date(order.delivered_at).toLocaleTimeString("es-CO") : ""],
    ["Fecha", (order) => order.delivered_at ? new Date(order.delivered_at).toLocaleDateString("es-CO") : ""],
    ["Costo delivery", (order) => order.delivery_fee]
  ];
  const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  const rows = [
    `<Row>${columns.map(([title]) => `<Cell><Data ss:Type="String">${xmlEscape(title)}</Data></Cell>`).join("")}</Row>`,
    ...reportOrders().map((order) => `<Row>${columns.map(([title, value]) => `<Cell><Data ss:Type="${title === "Costo delivery" ? "Number" : "String"}">${xmlEscape(title === "Motorizado" ? (order.courier?.full_name || order.courier_name || "") : value(order))}</Data></Cell>`).join("")}</Row>`)
  ].join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Entregas"><Table>${rows}</Table></Worksheet></Workbook>`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" }));
  link.download = "reporte-a-un-paso.xls";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function signOut() {
  if (state.profile?.role === "motorizado" && state.profile.online) {
    stopCourierLocationTracking();
    const { error: availabilityError } = await supabase.rpc("set_courier_online", { is_online: false });
    if (availabilityError) console.error("No se pudo cerrar la disponibilidad antes de salir:", availabilityError);
  }
  stopCourierLocationTracking();
  if (state.realtime) {
    await supabase.removeChannel(state.realtime);
    state.realtime = null;
  }
  const { error } = await supabase.auth.signOut();
  if (error) return reportError(error);
  clearInterval(state.refreshTimer);
  state.profile = null;
  state.session = null;
  state.authMode = "login";
  renderAuth();
}

boot();
