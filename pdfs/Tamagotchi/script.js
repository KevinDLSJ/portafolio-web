/* ---------------------------
  TAMAGOTCHI - script.js (FINAL)
  - Mood system (usa tus sprites actuales)
  - Día/Noche (fondo dinámico)
  - Mini-juegos (3): Adivina número, Click rápido, Reacción
  - Eventos aleatorios avanzados
  - Edad / cumpleaños (persistente con localStorage)
  - Animaciones inyectadas por JS (no requiere editar CSS)
  - Persistencia en localStorage
--------------------------- */

/* ---------- CONFIG ---------- */
const TIME_RATE = 9000;          // intervalo base (ms) entre cada "tick" natural
const PHASE_LENGTH = 20000;      // duración (ms) de cada fase del día (amanecer/día/tarde/noche)
const SAVE_KEY = "tamagotchi_save_v1";

/* ---------- ESTADO ---------- */
let state = {
  hunger: 50,
  energy: 50,
  cleanliness: 50,
  fun: 50,
  health: 100,
  coins: 0,
  birthDate: null,      // ISO string
  lastTick: Date.now()
};

/* ---------- UTIL: guardado y carga ---------- */
function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}
function loadState() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state = Object.assign(state, parsed);
    } catch (e) {
      console.warn("No se pudo parsear save:", e);
    }
  } else {
    // primer lanzamiento: crear birthDate
    const now = new Date();
    state.birthDate = now.toISOString();
    saveState();
  }
}
loadState();

/* ---------- INYECCIÓN DE ESTILOS (animaciones) ---------- */
(function injectStyles(){
  const css = `
    /* Animaciones inyectadas */
    @keyframes floaty { 0% { transform: translateY(0)} 50% { transform: translateY(-8px)} 100% { transform: translateY(0)} }
    @keyframes blink { 0%, 97%, 100% { opacity: 1 } 98%, 99% { opacity: 0.1 } }
    @keyframes sadShake { 0%{ transform: translateX(0)} 25%{ transform: translateX(-6px)} 50%{ transform: translateX(6px)} 75%{ transform: translateX(-4px)} 100%{ transform: translateX(0)} }

    .tmg-happy { animation: floaty 2.5s ease-in-out infinite; }
    .tmg-blink { animation: blink 4s infinite; }
    .tmg-sad { animation: sadShake .6s ease-in-out; }
    .hud-badge {
      position: fixed; top: 12px; right: 12px; background: rgba(255,255,255,0.9);
      border-radius: 10px; padding: 8px 12px; font-family: Arial, sans-serif;
      box-shadow: 0 6px 18px rgba(0,0,0,0.12); z-index: 9999; color: #333; font-size: 14px;
    }
    .modal-overlay {
      position: fixed; inset: 0; display:flex; align-items:center; justify-content:center;
      background: rgba(0,0,0,0.45); z-index: 9998;
    }
    .modal {
      width: 320px; background: #fff; border-radius: 12px; padding: 18px; text-align:center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      font-family: Arial, sans-serif;
    }
    .modal button { margin:6px; padding:8px 14px; border-radius:8px; border:none; cursor:pointer; }
  `;
  const s = document.createElement("style");
  s.innerHTML = css;
  document.head.appendChild(s);
})();

/* ---------- REFERENCIAS DOM (si no existen se crean) ---------- */
function ensureHUDandElements() {
  // HUD con coins y edad
  if (!document.getElementById("tmg-hud")) {
    const hud = document.createElement("div");
    hud.id = "tmg-hud";
    hud.className = "hud-badge";
    hud.innerHTML = `<span id="tmg-age">Edad: --</span> · <span id="tmg-coins">Monedas: 0</span> · <button id="tmg-reset" style="margin-left:8px;padding:4px 8px;border-radius:6px;">Reset</button>`;
    document.body.appendChild(hud);
    document.getElementById("tmg-reset").addEventListener("click", () => {
      if (confirm("Reiniciar todo (borrar progreso)?")) { localStorage.clear(); location.reload(); }
    });
  }

  // crear contenedor modal si no existe
  if (!document.getElementById("tmg-modal-root")) {
    const root = document.createElement("div");
    root.id = "tmg-modal-root";
    document.body.appendChild(root);
  }

  // si no hay petImage (por si usas otro HTML) -- intentar crear/alertar
  if (!document.getElementById("petImage")) {
    alert("⚠️ No se encontró el elemento #petImage en tu HTML. Asegúrate de tener <img id=\"petImage\" src=\"img/happy.png\"> en tu index.html");
  }
}
ensureHUDandElements();

/* ---------- AUXILIARES ---------- */
function clamp(v, a=0, b=100) { return Math.max(a, Math.min(b, v)); }
function randInt(a,b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

/* ---------- DÍA/NOCHE (phases) ---------- */
const PHASES = ["AMANECER","DIA","TARDE","NOCHE"];
let phaseIndex = 0;
let phaseTimer = null;
function startDayCycle() {
  // determinar phaseIndex por el tiempo actual (para que no siempre empiece en amanecer)
  phaseIndex = 0;
  // ciclo
  phaseTimer = setInterval(() => {
    phaseIndex = (phaseIndex + 1) % PHASES.length;
    applyPhaseEffects();
  }, PHASE_LENGTH);
  applyPhaseEffects();
}
function applyPhaseEffects() {
  const phase = PHASES[phaseIndex];
  // fondo simple según fase (no requiere imágenes)
  if (phase === "AMANECER") {
    document.body.style.background = "linear-gradient(180deg,#fff7f3,#fff0f8)";
  } else if (phase === "DIA") {
    document.body.style.background = "linear-gradient(180deg,#fff6f0,#fff4fb)";
  } else if (phase === "TARDE") {
    document.body.style.background = "linear-gradient(180deg,#fff1f8,#ffe6f2)";
  } else { // NOCHE
    document.body.style.background = "linear-gradient(180deg,#0f1724,#1b2330)";
  }
  // efectos sutiles sobre decay rates (se aplicarán en tick)
  // amanecer: +energy slowly, tarde: hunger aumenta más, noche: energia baja más
  // actualizamos HUD de edad/coins también
  updateHUD();
}

/* ---------- MOOD SYSTEM ---------- */
/* El mood es lógico (no necesita sprites extra). Afecta velocidad de decay.
   Calculamos un mood en base a los stats actuales. */
function computeMood() {
  const { hunger, energy, cleanliness, fun, health } = state;
  // Prioridad: muerto > enfermo > hambriento > cansado > triste > aburrido > feliz
  if (health <= 0) return "MUERTO";
  if (health < 40) return "ENFERMO";
  if (hunger > 75) return "HAMBRIENTO";
  if (energy < 25) return "CANSADO";
  if (fun < 25) return "TRISTE";
  if (cleanliness < 25) return "SUCIO";
  if (fun > 70 && energy > 50 && hunger < 60) return "FELIZ";
  return "NEUTRO";
}

/* ---------- UPDATE IMAGE + ANIMACIONES ---------- */
function updateImageAndAnimations() {
  const img = document.getElementById("petImage");
  if (!img) return;
  // sprite según estado (usa solo los que ya tienes)
  if (state.health <= 0) img.src = "img/dead.png";
  else if (state.hunger > 75) img.src = "img/hungry.png";
  else if (state.cleanliness < 30) img.src = "img/dirty.png";
  else if (state.energy < 30) img.src = "img/sleepy.png";
  else if (state.fun < 30) img.src = "img/bored.png";
  else if (state.health < 50) img.src = "img/sick.png";
  else img.src = "img/happy.png";

  // clases de animación segun mood
  img.classList.remove("tmg-happy","tmg-blink","tmg-sad");
  const mood = computeMood();
  if (mood === "FELIZ") img.classList.add("tmg-happy","tmg-blink");
  else if (mood === "TRISTE" || mood === "ENFERMO") img.classList.add("tmg-sad");
  else img.classList.add("tmg-blink");
}

/* ---------- HUD (edad y monedas) ---------- */
function updateHUD() {
  // coins
  const coinsEl = document.getElementById("tmg-coins");
  if (coinsEl) coinsEl.textContent = `Monedas: ${state.coins}`;

  // edad en días (calculada desde birthDate)
  const ageEl = document.getElementById("tmg-age");
  if (ageEl && state.birthDate) {
    const birth = new Date(state.birthDate);
    const now = new Date();
    const diffMs = now - birth;
    const days = Math.floor(diffMs / (1000*60*60*24));
    ageEl.textContent = `Edad: ${days} d`;
    // cumpleaños real?
    if (birth.getDate() === now.getDate() && birth.getMonth() === now.getMonth() && days > 0) {
      // recompensa de cumpleaños si hoy no se aplicó (guardamos last birthday grant)
      if (!state.lastBirthday || state.lastBirthday !== now.toDateString()) {
        state.coins += 5;
        state.fun = clamp(state.fun + 5);
        state.energy = clamp(state.energy + 5);
        state.lastBirthday = now.toDateString();
        saveState();
        showModal("🎉 Feliz cumpleaños de tu mascota! Recibiste +5 monedas, +5 diversión y +5 energía.");
      }
    }
  }
}

/* ---------- ACTUALIZAR ESTADÍSTICAS EN PANTALLA ---------- */
function updateStatsDisplay() {
  const map = {
    hunger: "hunger",
    energy: "energy",
    cleanliness: "cleanliness",
    fun: "fun",
    health: "health"
  };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (el) el.textContent = state[k];
  });
  updateImageAndAnimations();
  updateHUD();
  saveState();
}

/* ---------- ACCIONES (con restricciones inteligentes) ---------- */
function canActCheck(action) {
  if (state.health <= 0) { showToast("💀 Tu mascota ya no está... (reinicia si quieres)"); return false; }
  if (action === "play" && state.energy < 20) { showToast("🛌 Está muy cansada para jugar."); return false; }
  if (action === "sleep" && state.hunger > 90) { showToast("🍽️ Tiene demasiada hambre para dormir."); return false; }
  if ((action === "play" || action === "sleep") && state.cleanliness < 15) { showToast("💦 Está demasiado sucia para eso. Límpiala."); return false; }
  if ((action === "play" || action === "clean") && state.health < 30) { showToast("💊 Está enferma, dale medicina primero."); return false; }
  return true;
}

function alimentar() {
  if (!canActCheck("feed")) return;
  state.hunger = clamp(state.hunger - 30);
  state.fun = clamp(state.fun - 2);
  state.cleanliness = clamp(state.cleanliness - 6);
  showToast("🍙 Le diste de comer: -30 hambre");
  updateStatsDisplay();
}
function jugar() {
  if (!canActCheck("play")) return;
  // abrir mini-juego selección
  openMiniGameMenu();
}
function limpiar() {
  if (!canActCheck("clean")) return;
  state.cleanliness = clamp(state.cleanliness + 40);
  state.fun = clamp(state.fun - 4);
  showToast("🧼 La limpiaste: +40 limpieza");
  updateStatsDisplay();
}
function dormir() {
  if (!canActCheck("sleep")) return;
  // dormir restaura más lentamente y bloquea acciones por un tiempo corto
  showToast("💤 Está durmiendo... (5s)");
  // bloquear interacciones sencillamente (no imprescindible) — implementamos sueño rápido demo
  disableActionsTemporarily(5000, () => {
    state.energy = clamp(state.energy + 50);
    state.hunger = clamp(state.hunger + 12);
    showToast("🌞 Se despertó descansada: +50 energía");
    updateStatsDisplay();
  });
}
function medicar() {
  if (!canActCheck("medicate")) return;
  state.health = clamp(state.health + 35);
  state.fun = clamp(state.fun - 6);
  showToast("💊 Medicina aplicada: +35 salud");
  updateStatsDisplay();
}

/* ---------- UTIL: bloquear botones durante n ms (temporal) ---------- */
function disableActionsTemporarily(ms, callback) {
  const buttons = Array.from(document.querySelectorAll(".actions button"));
  buttons.forEach(b => b.disabled = true);
  setTimeout(() => {
    buttons.forEach(b => b.disabled = false);
    if (callback) callback();
  }, ms);
}

/* ---------- EVENTOS ALEATORIOS AVANZADOS ---------- */
function randomEvent() {
  const r = Math.random();
  if (r < 0.10) {
    // Suceso Positivo: encuentra una moneda o juguete
    const coinsFound = randInt(1,5);
    state.coins += coinsFound;
    state.fun = clamp(state.fun + 8);
    showToast(`✨ Encontró ${coinsFound} monedas y se alegró +8 diversión`);
  } else if (r < 0.20) {
    // Pequeña enfermedad por comida rara
    state.health = clamp(state.health - 8);
    showToast("🤢 Comió algo raro: -8 salud");
  } else if (r < 0.34) {
    // Se ensucia
    state.cleanliness = clamp(state.cleanliness - 12);
    showToast("💦 Se enredó y se ensució: -12 limpieza");
  } else if (r < 0.48) {
    // Pierde un poco de diversión
    state.fun = clamp(state.fun - 6);
    showToast("😕 Se aburrió un poquito: -6 diversión");
  } else if (r < 0.60) {
    // Sueño repentino
    state.energy = clamp(state.energy - 6);
    showToast("😪 Ataca el sueño: -6 energía");
  } else {
    // evento neutro o nada
    // posibilidad rara de evento especial
    if (Math.random() < 0.05) {
      state.health = clamp(state.health + 10);
      state.fun = clamp(state.fun + 10);
      showToast("🌟 Evento raro: encontró vitaminas antiguas! +10 salud +10 diversión");
    }
  }
}

/* ---------- TICK NATURAL: aplica decaimiento según mood y phase ---------- */
function applyNaturalTick() {
  // base decay
  let hungerDelta = 6;
  let energyDelta = -4;
  let cleanlinessDelta = -3;
  let funDelta = -4;
  // mood adjustments
  const mood = computeMood();
  if (mood === "FELIZ") { hungerDelta -= 1; funDelta += 2; }       // baja más lento
  if (mood === "TRISTE") { funDelta -= 2; energyDelta -= 1; }     // empeora
  if (mood === "HAMBRIENTO") { energyDelta -= 2; funDelta -= 2; }
  if (mood === "ENFERMO") { healthDelta = -3; }                   // handled later
  // phase adjustments
  const phase = PHASES[phaseIndex];
  if (phase === "AMANECER") { energyDelta += 2; }                 // levanta energía
  if (phase === "TARDE") { hungerDelta += 2; }                    // come más
  if (phase === "NOCHE") { energyDelta -= 2; funDelta -= 1; }     // baja energía en noche

  // aplicar
  state.hunger = clamp(state.hunger + hungerDelta);
  state.energy = clamp(state.energy + energyDelta);
  state.cleanliness = clamp(state.cleanliness + cleanlinessDelta);
  state.fun = clamp(state.fun + funDelta);

  // salud se ve afectada por condiciones críticas
  if (state.hunger > 85 || state.energy < 10 || state.cleanliness < 10) {
    state.health = clamp(state.health - 6);
  } else if (state.hunger < 30 && state.energy > 40 && state.cleanliness > 40) {
    // pequeña recuperación lenta si todo bien
    state.health = clamp(state.health + 1);
  }

  // eventos aleatorios cada tick
  randomEvent();
  updateStatsDisplay();
}

/* ---------- MINI-JUEGOS (creados y controlados por JS) ---------- */
function showModal(contentHtml, options = {}) {
  const root = document.getElementById("tmg-modal-root");
  if (!root) return;
  root.innerHTML = `
    <div class="modal-overlay" id="tmg-modal-overlay">
      <div class="modal">${contentHtml}</div>
    </div>
  `;
  // close on overlay click unless prevented
  const overlay = document.getElementById("tmg-modal-overlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) root.innerHTML = "";
  });
}
function closeModal() {
  const root = document.getElementById("tmg-modal-root");
  if (root) root.innerHTML = "";
}

function openMiniGameMenu() {
  showModal(`
    <h3>Mini-juegos</h3>
    <p>Elige uno para jugar y ganar diversión / monedas:</p>
    <button id="gm-guess">Adivina el número</button>
    <button id="gm-click">Click rápido</button>
    <button id="gm-react">Reacción</button>
    <div style="margin-top:10px;"><button id="gm-close">Cerrar</button></div>
  `);
  document.getElementById("gm-guess").addEventListener("click", () => { closeModal(); playGuessNumber(); });
  document.getElementById("gm-click").addEventListener("click", () => { closeModal(); playClickFast(); });
  document.getElementById("gm-react").addEventListener("click", () => { closeModal(); playReaction(); });
  document.getElementById("gm-close").addEventListener("click", closeModal);
}

/* Mini-juego 1: Adivina número */
function playGuessNumber() {
  const target = randInt(1, 7);
  let attempts = 3;
  showModal(`
    <h3>Adivina el número (1-7)</h3>
    <p>Tienes 3 intentos</p>
    <input id="guess-input" type="number" min="1" max="7" style="width:60px">
    <div style="margin-top:10px;"><button id="guess-send">Adivinar</button> <button id="guess-cancel">Salir</button></div>
    <p id="guess-msg"></p>
  `);
  document.getElementById("guess-send").addEventListener("click", () => {
    const g = parseInt(document.getElementById("guess-input").value,10);
    const msg = document.getElementById("guess-msg");
    if (!g || g < 1 || g > 7) { msg.textContent = "Elige un número entre 1 y 7"; return; }
    attempts--;
    if (g === target) {
      state.fun = clamp(state.fun + 10);
      state.coins += 5;
      showToast("🎉 Adivinaste! +10 diversión +5 monedas");
      closeModal();
      updateStatsDisplay();
    } else {
      if (attempts <= 0) {
        showToast(`😅 No lo adivinaste. Era ${target}.`);
        closeModal();
        updateStatsDisplay();
      } else {
        msg.textContent = `No es. Te quedan ${attempts} intentos.`;
      }
    }
  });
  document.getElementById("guess-cancel").addEventListener("click", closeModal);
}

/* Mini-juego 2: Click rápido */
function playClickFast() {
  let clicks = 0;
  const duration = 5000; // 5s
  showModal(`
    <h3>Click rápido (5s)</h3>
    <p>Haz cuantos clicks puedas</p>
    <button id="fast-btn" style="font-size:20px;padding:12px 18px;">Clic!</button>
    <p id="fast-msg">Clicks: 0</p>
    <div style="margin-top:10px;"><button id="fast-cancel">Salir</button></div>
  `);
  const btn = document.getElementById("fast-btn");
  const msg = document.getElementById("fast-msg");
  btn.addEventListener("click", () => { clicks++; msg.textContent = `Clicks: ${clicks}`; });
  document.getElementById("fast-cancel").addEventListener("click", closeModal);
  setTimeout(() => {
    // evaluar
    if (clicks >= 18) {
      state.fun = clamp(state.fun + 15);
      state.coins += 8;
      state.energy = clamp(state.energy - 8);
      showToast(`🔥 Increíble! ${clicks} clicks: +15 diversión +8 monedas (-8 energía)`);
    } else if (clicks >= 10) {
      state.fun = clamp(state.fun + 10);
      state.coins += 4;
      state.energy = clamp(state.energy - 6);
      showToast(`👍 Bien! ${clicks} clicks: +10 diversión +4 monedas (-6 energía)`);
    } else {
      state.fun = clamp(state.fun + 4);
      state.energy = clamp(state.energy - 4);
      showToast(`🙂 ${clicks} clicks: +4 diversión (-4 energía)`);
    }
    closeModal();
    updateStatsDisplay();
  }, duration);
}

/* Mini-juego 3: Reacción */
function playReaction() {
  showModal(`
    <h3>Reacción: espera el botón</h3>
    <p>Un botón aparecerá en pantalla — haz clic lo más rápido posible.</p>
    <div id="react-area" style="height:100px;"></div>
    <div style="margin-top:10px;"><button id="react-cancel">Salir</button></div>
  `);
  document.getElementById("react-cancel").addEventListener("click", closeModal);
  const wait = randInt(800, 3000);
  setTimeout(() => {
    const area = document.getElementById("react-area");
    const btn = document.createElement("button");
    btn.textContent = "¡CLICK!";
    btn.style.padding = "10px 16px";
    btn.style.fontSize = "16px";
    area.appendChild(btn);
    const start = performance.now();
    btn.addEventListener("click", () => {
      const ms = performance.now() - start;
      if (ms < 250) {
        state.fun = clamp(state.fun + 12);
        state.coins += 6;
        showToast(`⚡ Reacción perfecto (${Math.round(ms)}ms): +12 diversión +6 monedas`);
      } else if (ms < 500) {
        state.fun = clamp(state.fun + 8);
        state.coins += 4;
        showToast(`✅ Buena reacción (${Math.round(ms)}ms): +8 diversión +4 monedas`);
      } else {
        state.fun = clamp(state.fun + 4);
        showToast(`🙂 Lento (${Math.round(ms)}ms): +4 diversión`);
      }
      closeModal();
      updateStatsDisplay();
    });
  }, wait);
}

/* ---------- TOASTS (mensajes pequeños) ---------- */
let toastTimer = null;
function showToast(text) {
  // reutilizamos HUD area para pequeños mensajes o creamos uno temporal
  let t = document.getElementById("tmg-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "tmg-toast";
    t.style.position = "fixed";
    t.style.left = "50%";
    t.style.bottom = "22px";
    t.style.transform = "translateX(-50%)";
    t.style.background = "rgba(255,255,255,0.95)";
    t.style.padding = "10px 14px";
    t.style.borderRadius = "12px";
    t.style.boxShadow = "0 10px 20px rgba(0,0,0,0.12)";
    t.style.zIndex = "9999";
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 3500);
}

/* ---------- CICLO PRINCIPAL ---------- */
startDayCycle();
updateStatsDisplay();
let mainTick = setInterval(() => {
  applyNaturalTick();
}, TIME_RATE);

/* ---------- INICIO: enlazar botones del HTML si existen ---------- */
function bindButtonsIfExist() {
  const map = {
    "alimentar": alimentar,
    "jugar": jugar,
    "limpiar": limpiar,
    "dormir": dormir,
    "medicar": medicar
  };
  // si tus botones no tienen id, los usaremos por texto (clase .actions button)
  const actionsContainer = document.querySelector(".actions");
  if (actionsContainer) {
    const buttons = actionsContainer.querySelectorAll("button");
    buttons.forEach(btn => {
      const txt = btn.textContent.toLowerCase();
      if (txt.includes("aliment")) btn.addEventListener("click", alimentar);
      else if (txt.includes("jugar")) btn.addEventListener("click", jugar);
      else if (txt.includes("limpi")) btn.addEventListener("click", limpiar);
      else if (txt.includes("dorm")) btn.addEventListener("click", dormir);
      else if (txt.includes("medic") || txt.includes("med")) btn.addEventListener("click", medicar);
    });
  }
}
bindButtonsIfExist();

/* ---------- FINAL: exportar reinicio rapida (si quieres usar) ---------- */
window.Tamagotchi = {
  state,
  saveState,
  loadState,
  playGuessNumber,
  playClickFast,
  playReaction
};

/* ---------- HUD EXTRA: mostrar ánimo y fase del día ---------- */
(function createMoodHUD(){
  let hud = document.getElementById("tmg-extra-hud");
  if(!hud){
    hud = document.createElement("div");
    hud.id = "tmg-extra-hud";
    hud.style.position = "fixed";
    hud.style.bottom = "12px";
    hud.style.left = "50%";
    hud.style.transform = "translateX(-50%)";
    hud.style.padding = "8px 12px";
    hud.style.borderRadius = "10px";
    hud.style.background = "rgba(255,255,255,0.95)";
    hud.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)";
    hud.style.fontFamily = "Arial, sans-serif";
    hud.style.fontSize = "16px";
    hud.style.zIndex = "9999";
    document.body.appendChild(hud);
  }

  function updateExtraHUD() {
    const mood = computeMood(); // tu función original
    const phase = PHASES[phaseIndex] || "NEUTRO";
    const now = new Date();
    const hours = now.getHours().toString().padStart(2,"0");
    const minutes = now.getMinutes().toString().padStart(2,"0");
    hud.innerHTML = `Estado de ánimo: <b>${mood}</b> | Fase del día: <b>${phase}</b> | Hora: <b>${hours}:${minutes}</b>`;
  }

  setInterval(updateExtraHUD, 1000); // actualiza cada segundo
  updateExtraHUD(); // inicial
})();
