import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { firebaseConfig } from "./config.js";

const BRACKET_DOC_PATH = ["publicState", "bracket"];
const EDITOR_ACCESS_COLLECTION = "editorAccess";
const RANKING_DOC_PATH = ["publicState", "ranking"];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const authState = {
  access: "signed_out",
  accessRecord: null,
  initialized: false,
  listeners: new Set(),
  ui: null,
  user: null
};
const adminState = {
  entries: [],
  status: "",
  ui: null,
  unsubscribe: null
};

document.addEventListener("DOMContentLoaded", () => {
  initReveal();
  initPage();
});

function initPage() {
  const page = document.body.dataset.page;

  if (page === "bracket" || page === "ranking") {
    initAuthPanel();
    initAdminPanel();
    initNavAuth();
  }

  if (page === "bracket") {
    initBracketPage();
  }

  if (page === "ranking") {
    initRankingPage();
  }
}

function initReveal() {
  const elements = document.querySelectorAll("[data-reveal]");
  if (!elements.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.18 });

  elements.forEach((element) => observer.observe(element));
}

function initAuthPanel() {
  if (authState.ui) {
    return authState.ui;
  }

  const pageMain = document.querySelector(".page-main");
  const pageHero = pageMain?.querySelector(".page-hero");
  if (!pageMain || !pageHero) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "panel auth-panel";
  panel.innerHTML = `
    <div class="auth-panel-layout">
      <div class="auth-copy">
        <p class="eyebrow">Organizer Login</p>
        <h2>Schreibzugriff bleibt unter Kontrolle.</h2>
        <p>
          Ranking und Turnierbaum bleiben sichtbar. Bearbeiten und Speichern ist
          nur nach Anmeldung erlaubt.
        </p>
      </div>
      <div class="auth-actions">
        <form class="auth-form" data-auth-form>
          <label class="auth-field">
            <span>Vorname</span>
            <input class="auth-input" data-auth-firstname type="text" autocomplete="given-name" placeholder="Kai" />
          </label>
          <label class="auth-field">
            <span>E-Mail</span>
            <input class="auth-input" data-auth-email type="email" autocomplete="username" placeholder="orga@hdm.de" required />
          </label>
          <label class="auth-field">
            <span>Passwort</span>
            <input class="auth-input" data-auth-password type="password" autocomplete="current-password" placeholder="Passwort" required />
          </label>
          <div class="auth-button-row">
            <button class="button button-primary" data-auth-submit type="submit">Anmelden</button>
            <button class="button button-secondary" data-auth-register type="button">Registrieren</button>
          </div>
        </form>
        <div class="auth-session" data-auth-session hidden>
          <div class="auth-badge">
            <span class="auth-badge-label">Angemeldet als</span>
            <strong data-auth-user>Organisator</strong>
          </div>
          <p class="auth-session-status" data-auth-session-status></p>
          <div class="auth-button-row">
            <button class="button button-secondary" data-auth-refresh type="button">Status aktualisieren</button>
            <button class="button button-secondary" data-auth-resend type="button">Verifizierung senden</button>
          </div>
        </div>
        <p class="auth-message" data-auth-message></p>
      </div>
    </div>
  `;

  pageHero.insertAdjacentElement("afterend", panel);

  const form = panel.querySelector("[data-auth-form]");
  const emailInput = panel.querySelector("[data-auth-email]");
  const firstNameInput = panel.querySelector("[data-auth-firstname]");
  const passwordInput = panel.querySelector("[data-auth-password]");
  const refreshButton = panel.querySelector("[data-auth-refresh]");
  const registerButton = panel.querySelector("[data-auth-register]");
  const resendButton = panel.querySelector("[data-auth-resend]");
  const session = panel.querySelector("[data-auth-session]");
  const sessionStatus = panel.querySelector("[data-auth-session-status]");
  const userLabel = panel.querySelector("[data-auth-user]");
  const message = panel.querySelector("[data-auth-message]");

  authState.ui = {
    emailInput,
    form,
    firstNameInput,
    message,
    panel,
    passwordInput,
    refreshButton,
    registerButton,
    resendButton,
    session,
    sessionStatus,
    userLabel
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      setAuthMessage("Anmeldung wird geprüft...", "pending");
      await signInWithEmailAndPassword(auth, emailInput?.value?.trim() || "", passwordInput?.value || "");
      form.reset();
    } catch (error) {
      console.error(error);
      setAuthMessage(getAuthErrorMessage(error), "error");
    }
  });

  registerButton?.addEventListener("click", async () => {
    try {
      const firstName = firstNameInput?.value?.trim() || "";
      if (!firstName) {
        setAuthMessage("Bitte beim Registrieren einen Vornamen angeben.", "error");
        firstNameInput?.focus();
        return;
      }

      setAuthMessage("Konto wird erstellt...", "pending");
      const credential = await createUserWithEmailAndPassword(auth, emailInput?.value?.trim() || "", passwordInput?.value || "");
      await setDoc(doc(db, EDITOR_ACCESS_COLLECTION, credential.user.uid), {
        email: credential.user.email || "",
        emailVerified: credential.user.emailVerified,
        firstName,
        requestedAt: new Date().toISOString(),
        uid: credential.user.uid,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      await sendEmailVerification(credential.user);
      setAuthMessage("Konto erstellt. Bitte E-Mail bestätigen und danach den Status aktualisieren.", "pending");
      form?.reset();
    } catch (error) {
      console.error(error);
      setAuthMessage(getAuthErrorMessage(error), "error");
    }
  });

  refreshButton?.addEventListener("click", async () => {
    try {
      if (!auth.currentUser) {
        return;
      }

      setAuthMessage("Anmeldestatus wird aktualisiert...", "pending");
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      syncAuthState(auth.currentUser);
    } catch (error) {
      console.error(error);
      setAuthMessage("Status konnte nicht aktualisiert werden. Bitte erneut versuchen.", "error");
    }
  });

  resendButton?.addEventListener("click", async () => {
    try {
      if (!auth.currentUser) {
        return;
      }

      setAuthMessage("Verifizierungs-Mail wird gesendet...", "pending");
      await sendEmailVerification(auth.currentUser);
      setAuthMessage("Verifizierungs-Mail versendet. Bitte Postfach prüfen.", "pending");
    } catch (error) {
      console.error(error);
      setAuthMessage(getAuthErrorMessage(error), "error");
    }
  });

  if (!authState.initialized) {
    authState.initialized = true;
    onAuthStateChanged(auth, (user) => {
      syncAuthState(user);
    });
  }

  renderAuthPanel();
  return authState.ui;
}

function initNavAuth() {
  const nav = document.querySelector(".topbar .nav");
  if (!nav || nav.querySelector("[data-nav-signout]")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-auth-button";
  button.hidden = true;
  button.dataset.navSignout = "true";
  button.textContent = "Logout";

  button.addEventListener("click", async () => {
    try {
      await signOut(auth);
      setAuthMessage("Abgemeldet. Bearbeiten ist wieder gesperrt.", "info");
      window.location.reload();
    } catch (error) {
      console.error(error);
      setAuthMessage("Abmelden fehlgeschlagen. Bitte erneut versuchen.", "error");
    }
  });

  nav.append(button);
}

function initAdminPanel() {
  if (adminState.ui) {
    return adminState.ui;
  }

  const pageMain = document.querySelector(".page-main");
  if (!pageMain) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "panel admin-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="admin-panel-head">
      <div>
        <p class="eyebrow">Adminbereich</p>
        <h2>Freigaben mit zwei Klicks.</h2>
        <p class="admin-copy">
          Hier erscheinen alle Freigabe-Anfragen aus <code>editorAccess</code>.
          Du kannst Nutzer direkt freigeben oder wieder sperren.
        </p>
      </div>
      <p class="admin-status" data-admin-status></p>
    </div>
    <div class="admin-list" data-admin-list></div>
  `;

  pageMain.append(panel);

  const list = panel.querySelector("[data-admin-list]");
  const status = panel.querySelector("[data-admin-status]");

  adminState.ui = {
    list,
    panel,
    status
  };

  list?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.userId) {
      return;
    }

    const approved = target.dataset.approved === "true";

    try {
      setAdminStatus("Freigabe wird gespeichert...", "pending");
      await setDoc(doc(db, EDITOR_ACCESS_COLLECTION, target.dataset.userId), {
        approved,
        reviewedAt: new Date().toISOString()
      }, { merge: true });
      setAdminStatus(approved ? "Nutzer freigegeben." : "Freigabe entzogen.", "success");
    } catch (error) {
      console.error(error);
      setAdminStatus("Freigabe konnte nicht gespeichert werden.", "error");
    }
  });

  renderAdminPanel();
  return adminState.ui;
}

function startAdminAccessMonitor() {
  if (adminState.unsubscribe) {
    return;
  }

  setAdminStatus("Freigaben werden geladen...", "pending");
  adminState.unsubscribe = onSnapshot(collection(db, EDITOR_ACCESS_COLLECTION), (snapshot) => {
    adminState.entries = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort(compareAccessEntries);
    setAdminStatus("Freigaben aktuell.", "success");
    renderAdminPanel();
  }, (error) => {
    console.error(error);
    setAdminStatus("Freigaben konnten nicht geladen werden.", "error");
    renderAdminPanel();
  });
}

function stopAdminAccessMonitor() {
  if (adminState.unsubscribe) {
    adminState.unsubscribe();
    adminState.unsubscribe = null;
  }

  adminState.entries = [];
  adminState.status = "";
  renderAdminPanel();
}

function compareAccessEntries(left, right) {
  const leftTime = String(left.updatedAt || left.requestedAt || "");
  const rightTime = String(right.updatedAt || right.requestedAt || "");
  return rightTime.localeCompare(leftTime);
}

function renderAdminPanel() {
  if (!adminState.ui) {
    return;
  }

  const isAdmin = authState.accessRecord?.admin === true;
  adminState.ui.panel.hidden = !isAdmin;

  if (!isAdmin) {
    return;
  }

  adminState.ui.list.innerHTML = adminState.entries.length
    ? adminState.entries.map((entry) => `
        <article class="admin-card">
          <div class="admin-card-copy">
            <strong>${escapeHtml(entry.firstName || "Ohne Vorname")}</strong>
            <span>E-Mail: ${escapeHtml(entry.email || "Unbekannter Nutzer")}</span>
            <span>UID: ${escapeHtml(entry.uid || entry.id)}</span>
            <span>E-Mail bestätigt: ${entry.emailVerified ? "Ja" : "Nein"}</span>
            <span>Freigabe: ${entry.approved ? "Aktiv" : "Ausstehend"}</span>
            <span>Admin: ${entry.admin ? "Ja" : "Nein"}</span>
          </div>
          <div class="admin-card-actions">
            <button class="button button-primary" type="button" data-user-id="${entry.id}" data-approved="true" ${entry.approved ? "disabled" : ""}>Freigeben</button>
            <button class="button button-secondary" type="button" data-user-id="${entry.id}" data-approved="false" ${!entry.approved ? "disabled" : ""}>Sperren</button>
          </div>
        </article>
      `).join("")
    : `<p class="admin-empty">Noch keine Freigabe-Anfragen vorhanden.</p>`;
}

function setAdminStatus(message = "", state = "info") {
  adminState.status = message;

  if (!adminState.ui?.status) {
    return;
  }

  adminState.ui.status.textContent = message;
  adminState.ui.status.dataset.state = state;
}

async function syncAuthState(user) {
  authState.user = user;
  authState.accessRecord = null;

  if (!user) {
    authState.access = "signed_out";
    stopAdminAccessMonitor();
    renderAuthPanel();
    renderAdminPanel();
    authState.listeners.forEach((listener) => listener(user));
    return;
  }

  await ensureOwnAccessRequest(user);

  if (!user.emailVerified) {
    authState.access = "unverified";
    stopAdminAccessMonitor();
    renderAuthPanel();
    renderAdminPanel();
    authState.listeners.forEach((listener) => listener(user));
    return;
  }

  authState.access = "checking";
  renderAuthPanel();
  renderAdminPanel();
  authState.listeners.forEach((listener) => listener(user));

  try {
    const accessSnap = await getDoc(doc(db, EDITOR_ACCESS_COLLECTION, user.uid));
    authState.accessRecord = accessSnap.exists() ? accessSnap.data() : null;
    authState.access = authState.accessRecord?.approved === true ? "approved" : "pending";
  } catch (error) {
    console.error(error);
    authState.access = "pending";
  }

  if (authState.accessRecord?.admin === true) {
    startAdminAccessMonitor();
  } else {
    stopAdminAccessMonitor();
  }

  renderAuthPanel();
  renderAdminPanel();
  authState.listeners.forEach((listener) => listener(user));
}

async function ensureOwnAccessRequest(user) {
  try {
    await setDoc(doc(db, EDITOR_ACCESS_COLLECTION, user.uid), {
      email: user.email || "",
      emailVerified: user.emailVerified,
      requestedAt: new Date().toISOString(),
      uid: user.uid,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error(error);
  }
}

function renderAuthPanel() {
  if (!authState.ui) {
    return;
  }

  const {
    form,
    panel,
    resendButton,
    session,
    sessionStatus,
    userLabel
  } = authState.ui;
  const user = authState.user;
  const isAuthenticated = Boolean(user);
  const isVerified = Boolean(user?.emailVerified);
  const isApproved = authState.access === "approved";
  const isCheckingApproval = authState.access === "checking";
  const navSignOutButton = document.querySelector("[data-nav-signout]");

  if (panel) {
    panel.hidden = isAuthenticated;
  }

  if (form) {
    form.hidden = isAuthenticated;
  }

  if (session) {
    session.hidden = !isAuthenticated;
  }

  if (userLabel) {
    userLabel.textContent = authState.accessRecord?.firstName || user?.email || "Organisator";
  }

  if (navSignOutButton) {
    navSignOutButton.hidden = !isAuthenticated;
  }

  if (sessionStatus) {
    sessionStatus.textContent = !user
      ? ""
      : !isVerified
        ? "E-Mail noch nicht bestätigt. Bitte Link im Postfach öffnen und danach den Status aktualisieren."
        : isCheckingApproval
          ? "Freigabe wird geprüft..."
          : isApproved
            ? "E-Mail bestätigt und in Firebase freigegeben. Schreiben ist jetzt erlaubt."
            : "E-Mail bestätigt. Schreibzugriff ist noch nicht freigegeben.";
    sessionStatus.dataset.state = !user
      ? "info"
      : !isVerified
        ? "pending"
        : isApproved
          ? "success"
          : "pending";
  }

  if (resendButton) {
    resendButton.hidden = !isAuthenticated || isVerified;
  }

  setAuthMessage(
    !isAuthenticated
      ? "Registriere dich oder melde dich mit einem vorhandenen Organizer-Konto an."
      : !isVerified
        ? "Konto aktiv. Bitte erst E-Mail bestätigen, bevor Schreiben möglich ist."
        : isCheckingApproval
          ? "E-Mail bestätigt. Freigabe in Firebase wird gerade geprüft."
          : isApproved
            ? "Bearbeiten entsperrt. Änderungen werden wieder in Firestore gespeichert."
            : "E-Mail bestätigt. Jetzt fehlt nur noch deine Freigabe in Firebase.",
    !isAuthenticated
      ? "info"
      : !isVerified
        ? "pending"
        : isApproved
          ? "success"
          : "pending"
  );
}

function setAuthMessage(message, state = "info") {
  if (!authState.ui?.message) {
    return;
  }

  authState.ui.message.textContent = message;
  authState.ui.message.dataset.state = state;
}

function getAuthErrorMessage(error) {
  switch (error?.code) {
    case "auth/configuration-not-found":
      return "E-Mail/Passwort ist in Firebase Authentication noch nicht aktiviert.";
    case "auth/email-already-in-use":
      return "Für diese E-Mail existiert bereits ein Konto. Bitte anmelden.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-Mail oder Passwort stimmen nicht.";
    case "auth/invalid-email":
      return "Die E-Mail-Adresse ist ungültig.";
    case "auth/weak-password":
      return "Das Passwort ist zu schwach. Bitte mindestens 6 Zeichen verwenden.";
    case "auth/too-many-requests":
      return "Zu viele Versuche. Bitte kurz warten und erneut anmelden.";
    case "auth/network-request-failed":
      return "Netzwerkfehler bei der Anmeldung. Verbindung prüfen und erneut versuchen.";
    default:
      return "Anmeldung fehlgeschlagen. Firebase Authentication bitte prüfen.";
  }
}

function onEditorAccessChange(listener) {
  authState.listeners.add(listener);
  listener(authState.user);
  return () => authState.listeners.delete(listener);
}

function hasEditorAccess() {
  return authState.access === "approved";
}

function requireEditorAccess(syncStatus) {
  const user = authState.user;

  if (hasEditorAccess()) {
    return true;
  }

  if (!user) {
    setAuthMessage("Bitte erst anmelden oder registrieren.", "error");
    setSyncStatus(syncStatus, "Nur Lesen aktiv. Zum Bearbeiten anmelden.", "pending");
  } else if (!user.emailVerified) {
    setAuthMessage("Bitte erst E-Mail bestätigen und danach den Status aktualisieren.", "error");
    setSyncStatus(syncStatus, "Nur Lesen aktiv. E-Mail-Bestätigung fehlt.", "pending");
  } else {
    setAuthMessage("E-Mail bestätigt. Es fehlt noch die Freigabe in Firebase.", "error");
    setSyncStatus(syncStatus, "Nur Lesen aktiv. Konto noch nicht freigegeben.", "pending");
  }

  authState.ui?.emailInput?.focus();
  return false;
}

function getWriteAccessMessage(error) {
  if (error?.code !== "permission-denied") {
    return null;
  }

  if (!authState.user) {
    return "Schreiben gesperrt. Bitte erst anmelden.";
  }

  if (!authState.user.emailVerified) {
    return "Schreiben gesperrt. Bitte erst E-Mail bestätigen und den Status aktualisieren.";
  }

  return "Schreiben gesperrt. Dein Konto ist noch nicht in Firebase freigegeben.";
}

function handleWriteError(error, syncStatus, fallbackMessage = "Speichern fehlgeschlagen") {
  console.error(error);
  const message = getWriteAccessMessage(error) || fallbackMessage;
  setSyncStatus(syncStatus, message, "error");

  if (getWriteAccessMessage(error)) {
    setAuthMessage(message, "error");
  }
}

async function initBracketPage() {
  const syncStatus = document.getElementById("syncStatus");
  const bracketRef = doc(db, ...BRACKET_DOC_PATH);
  const playersText = document.getElementById("playersText");
  const bracketRounds = document.getElementById("bracketRounds");
  const championName = document.getElementById("championName");
  const saveBracket = document.getElementById("saveBracket");
  const resetBracket = document.getElementById("resetBracket");
  let state = createEmptyBracketState();
  let isApplyingRemote = false;
  let canEdit = hasEditorAccess();

  onEditorAccessChange(() => {
    canEdit = hasEditorAccess();

    if (playersText) {
      playersText.disabled = !canEdit;
    }

    if (saveBracket) {
      saveBracket.disabled = !canEdit;
    }

    if (resetBracket) {
      resetBracket.disabled = !canEdit;
    }

    renderBracketPage(state, playersText, bracketRounds, championName, {
      editable: canEdit,
      syncPlayersText: true
    });
  });

  setSyncStatus(syncStatus, "Cloud Sync verbindet...", "pending");

  onSnapshot(bracketRef, async (snapshot) => {
    if (!snapshot.exists()) {
      if (!canEdit) {
        state = createEmptyBracketState();
        renderBracketPage(state, playersText, bracketRounds, championName, {
          editable: canEdit,
          syncPlayersText: true
        });
        setSyncStatus(syncStatus, "Cloud Sync leer. Zum Initialisieren anmelden.", "pending");
        return;
      }

      try {
        await writeBracketState(bracketRef, createEmptyBracketState());
      } catch (error) {
        handleWriteError(error, syncStatus);
      }
      return;
    }

    const remoteState = snapshot.data()?.state;
    isApplyingRemote = true;
    state = normalizeBracketState(remoteState);
    renderBracketPage(state, playersText, bracketRounds, championName, {
      editable: canEdit,
      syncPlayersText: true
    });
    isApplyingRemote = false;

    if (needsBracketMigration(remoteState)) {
      if (canEdit) {
        try {
          await writeBracketState(bracketRef, state);
        } catch (error) {
          handleWriteError(error, syncStatus);
        }
      }
    }

    setSyncStatus(syncStatus, canEdit ? "Cloud Sync aktiv" : "Cloud Sync aktiv. Nur Lesen.", "live");
  }, (error) => {
    console.error(error);
    setSyncStatus(syncStatus, "Cloud Sync fehlgeschlagen", "error");
  });

  playersText?.addEventListener("input", () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    if (isApplyingRemote) {
      return;
    }

    setSyncStatus(syncStatus, "Namen geändert. Mit Speichern auslosen und synchronisieren.", "pending");
  });

  saveBracket?.addEventListener("click", async () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    if (isApplyingRemote || !playersText) {
      return;
    }

    state = reshapeBracketStateForPlayers(playersText.value, state);
    renderBracketPage(state, playersText, bracketRounds, championName, { syncPlayersText: true });
    setSyncStatus(syncStatus, "Turnierbaum wird gespeichert...", "pending");
    await pushImmediate(bracketRef, createBracketPayload(state), syncStatus, false);
  });

  bracketRounds?.addEventListener("input", (event) => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    if (isApplyingRemote) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("score-input")) {
      return;
    }

    const roundIndex = Number(target.dataset.roundIndex);
    const matchIndex = Number(target.dataset.matchIndex);
    const side = target.dataset.side;

    if (!Number.isInteger(roundIndex) || !Number.isInteger(matchIndex)) {
      return;
    }

    state.rounds[roundIndex][matchIndex][scoreKey(side)] = sanitizeScore(target.value);
    state = normalizeBracketState(state);
    renderBracketPage(state, playersText, bracketRounds, championName);
    setSyncStatus(syncStatus, "Scores werden synchronisiert...", "pending");
    awaitPushBracketState(bracketRef, state, syncStatus);
  });

  resetBracket?.addEventListener("click", async () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    state = createEmptyBracketState();
    renderBracketPage(state, playersText, bracketRounds, championName, {
      editable: canEdit,
      syncPlayersText: true
    });
    setSyncStatus(syncStatus, "Leerer Baum wird gespeichert...", "pending");
    await pushImmediate(bracketRef, createBracketPayload(state), syncStatus, false);
  });
}

const awaitPushBracketState = debounce(async (ref, state, syncStatus) => {
  try {
    await writeBracketState(ref, state);
    setSyncStatus(syncStatus, "Gespeichert", "live");
  } catch (error) {
    handleWriteError(error, syncStatus);
  }
}, 500);

function renderBracketPage(state, playersTextElement, bracketRoundsElement, championNameElement, options = {}) {
  const bracket = buildBracketView(state);
  const {
    editable = true,
    syncPlayersText = false
  } = options;

  if (syncPlayersText && playersTextElement && playersTextElement.value !== bracket.playersText) {
    playersTextElement.value = bracket.playersText;
  }

  updateBracketMeta(bracket);

  if (championNameElement) {
    championNameElement.textContent = bracket.champion || "Noch offen";
  }

  if (!bracketRoundsElement) {
    return;
  }

  bracketRoundsElement.innerHTML = bracket.rounds.map((round, roundIndex) => `
    <article class="round-column dynamic-round">
      <div class="round-head">
        <span>${getRoundTitle(round.matchCount, roundIndex, bracket.rounds.length)}</span>
        <small>${round.matchCount} ${round.matchCount === 1 ? "Match" : "Matches"}</small>
      </div>
      ${round.matches.map((match, matchIndex) => `
        <div class="match-card ${match.winner ? "has-winner" : ""}">
          <div class="match-title">Match ${matchIndex + 1}</div>
          <div class="player-row is-locked">
            <span class="locked-player ${match.playerA ? "" : "is-pending"}">${escapeHtml(match.labelA)}</span>
            <input
              class="score-input"
              data-round-index="${roundIndex}"
              data-match-index="${matchIndex}"
              data-side="a"
              inputmode="numeric"
              placeholder="0"
              value="${match.scoreA}"
              ${!editable || match.scoreDisabled ? "disabled" : ""}
            />
          </div>
          <div class="player-row is-locked">
            <span class="locked-player ${match.playerB ? "" : "is-pending"}">${escapeHtml(match.labelB)}</span>
            <input
              class="score-input"
              data-round-index="${roundIndex}"
              data-match-index="${matchIndex}"
              data-side="b"
              inputmode="numeric"
              placeholder="0"
              value="${match.scoreB}"
              ${!editable || match.scoreDisabled ? "disabled" : ""}
            />
          </div>
          <div class="match-result">${escapeHtml(match.resultLabel)}</div>
        </div>
      `).join("")}
    </article>
  `).join("");
}

function updateBracketMeta(bracket) {
  setText("playerCount", bracket.players.length);
  setText("bracketSize", bracket.slotCount);
  setText("byeCount", bracket.byeCount);
  setText("roundCount", bracket.roundCount);
}

async function initRankingPage() {
  const syncStatus = document.getElementById("syncStatus");
  const rankingRef = doc(db, ...RANKING_DOC_PATH);
  const tableBody = document.getElementById("rankingBody");
  const addRankingRow = document.getElementById("addRankingRow");
  const importBracketPlayers = document.getElementById("importBracketPlayers");
  const sortRanking = document.getElementById("sortRanking");
  const resetRanking = document.getElementById("resetRanking");
  let state = [];
  let isApplyingRemote = false;
  let canEdit = hasEditorAccess();

  onEditorAccessChange(() => {
    canEdit = hasEditorAccess();
    [addRankingRow, importBracketPlayers, sortRanking, resetRanking].forEach((element) => {
      if (element) {
        element.disabled = !canEdit;
      }
    });
    renderRankingTable();
  });

  setSyncStatus(syncStatus, "Cloud Sync verbindet...", "pending");

  onSnapshot(rankingRef, async (snapshot) => {
    if (!snapshot.exists()) {
      if (!canEdit) {
        state = [];
        renderRankingTable();
        setSyncStatus(syncStatus, "Cloud Sync leer. Zum Initialisieren anmelden.", "pending");
        return;
      }

      try {
        await setDoc(rankingRef, createRankingPayload([]), { merge: true });
      } catch (error) {
        handleWriteError(error, syncStatus);
      }
      return;
    }

    isApplyingRemote = true;
    state = normalizeRankingState(snapshot.data()?.state);
    renderRankingTable();
    isApplyingRemote = false;
    setSyncStatus(syncStatus, canEdit ? "Cloud Sync aktiv" : "Cloud Sync aktiv. Nur Lesen.", "live");
  }, (error) => {
    console.error(error);
    setSyncStatus(syncStatus, "Cloud Sync fehlgeschlagen", "error");
  });

  const pushRankingState = debounce(async () => {
    try {
      await setDoc(rankingRef, createRankingPayload(state), { merge: true });
      setSyncStatus(syncStatus, "Gespeichert", "live");
    } catch (error) {
      handleWriteError(error, syncStatus);
    }
  }, 500);

  addRankingRow?.addEventListener("click", () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    state.push(createRankingRow());
    renderRankingTable();
    setSyncStatus(syncStatus, "Neuer Spieler wird synchronisiert...", "pending");
    pushRankingState();
  });

  sortRanking?.addEventListener("click", () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    state = sortRankingRows(state);
    renderRankingTable();
    setSyncStatus(syncStatus, "Ranking wird synchronisiert...", "pending");
    pushRankingState();
  });

  resetRanking?.addEventListener("click", async () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    state = [];
    renderRankingTable();
    setSyncStatus(syncStatus, "Leeres Ranking wird gespeichert...", "pending");
    await pushImmediate(rankingRef, createRankingPayload(state), syncStatus);
  });

  importBracketPlayers?.addEventListener("click", async () => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    try {
      const bracketSnap = await getDoc(doc(db, ...BRACKET_DOC_PATH));
      const bracketState = normalizeBracketState(bracketSnap.data()?.state);
      const bracketNames = parsePlayers(bracketState.playersText);
      const existingNames = new Set(state.map((row) => row.name.trim().toLowerCase()).filter(Boolean));

      bracketNames.forEach((name) => {
        if (!existingNames.has(name.toLowerCase())) {
          state.push(createRankingRow(name));
        }
      });

      renderRankingTable();
      setSyncStatus(syncStatus, "Spieler werden synchronisiert...", "pending");
      pushRankingState();
    } catch (error) {
      console.error(error);
      setSyncStatus(syncStatus, "Import fehlgeschlagen", "error");
    }
  });

  tableBody?.addEventListener("input", (event) => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    if (isApplyingRemote) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const row = state.find((entry) => entry.id === target.dataset.id);
    if (!row) {
      return;
    }

    const field = target.dataset.field;
    row[field] = target.type === "number" ? normalizeNumericValue(target.value, field === "average") : target.value;

    if (field === "legsFor" || field === "legsAgainst") {
      updateDiffCell(row.id, state);
    }

    setSyncStatus(syncStatus, "Änderungen werden synchronisiert...", "pending");
    pushRankingState();
  });

  tableBody?.addEventListener("click", (event) => {
    if (!canEdit) {
      requireEditorAccess(syncStatus);
      return;
    }

    if (isApplyingRemote) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.removeId) {
      return;
    }

    state = state.filter((entry) => entry.id !== target.dataset.removeId);
    renderRankingTable();
    setSyncStatus(syncStatus, "Spieler wird entfernt...", "pending");
    pushRankingState();
  });

  function renderRankingTable() {
    if (!tableBody) {
      return;
    }

    const disabled = canEdit ? "" : "disabled";

    tableBody.innerHTML = state.map((row, index) => {
      const diff = Number(row.legsFor) - Number(row.legsAgainst);
      return `
        <tr>
          <td><span class="rank-pill">${index + 1}</span></td>
          <td><input class="table-input name" data-id="${row.id}" data-field="name" type="text" value="${escapeHtml(row.name)}" placeholder="Name" ${disabled} /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="games" type="number" min="0" value="${row.games}" ${disabled} /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="wins" type="number" min="0" value="${row.wins}" ${disabled} /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="legsFor" type="number" min="0" value="${row.legsFor}" ${disabled} /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="legsAgainst" type="number" min="0" value="${row.legsAgainst}" ${disabled} /></td>
          <td><span class="diff-pill" data-diff-id="${row.id}">${formatDiff(diff)}</span></td>
          <td><input class="table-input" data-id="${row.id}" data-field="oneEighty" type="number" min="0" value="${row.oneEighty}" ${disabled} /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="average" type="number" step="0.1" min="0" value="${row.average}" ${disabled} /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="points" type="number" min="0" value="${row.points}" ${disabled} /></td>
          <td><button class="icon-button" type="button" data-remove-id="${row.id}" aria-label="Spieler entfernen" ${disabled}>×</button></td>
        </tr>
      `;
    }).join("");
  }
}

function createEmptyBracketState() {
  return {
    playersText: "",
    seeding: [],
    rounds: []
  };
}

function reshapeBracketStateForPlayers(playersText, currentState) {
  const previous = normalizeBracketState(currentState);
  const cleanedText = normalizePlayersText(playersText);
  const nextPlayers = parsePlayers(cleanedText);
  const nextSlotCount = nextPowerOfTwo(Math.max(2, nextPlayers.length || 2));
  const playersChanged = !arePlayerListsEqual(nextPlayers, previous.players);
  const shouldResetScores = playersChanged || nextSlotCount !== previous.slotCount;

  return normalizeBracketState({
    playersText: cleanedText,
    seeding: playersChanged ? shufflePlayers(nextPlayers) : previous.seeding,
    rounds: shouldResetScores ? [] : previous.rounds
  });
}

function normalizeBracketState(value) {
  if (!value || typeof value !== "object") {
    return hydrateBracketState(createEmptyBracketState());
  }

  if (typeof value.playersText === "string" || Array.isArray(value.rounds) || Array.isArray(value.seeding)) {
    return hydrateBracketState({
      playersText: typeof value.playersText === "string" ? value.playersText : "",
      seeding: Array.isArray(value.seeding) ? value.seeding : [],
      rounds: deserializeBracketRounds(value.rounds)
    });
  }

  if (Array.isArray(value.players)) {
    return hydrateBracketState({
      playersText: value.players.join("\n"),
      seeding: Array.isArray(value.seeding) ? value.seeding : value.players,
      rounds: deserializeBracketRounds(value.rounds)
    });
  }

  if (Array.isArray(value.quarterfinals)) {
    const playersText = value.quarterfinals
      .flatMap((match) => [String(match?.a || ""), String(match?.b || "")])
      .filter((name) => name.trim() !== "")
      .join("\n");

    return hydrateBracketState({
      playersText,
      seeding: parsePlayers(playersText),
      rounds: [
        value.quarterfinals.map((match) => ({
          scoreA: sanitizeScore(String(match?.scoreA || "")),
          scoreB: sanitizeScore(String(match?.scoreB || ""))
        })),
        Array.isArray(value.semifinals)
          ? value.semifinals.map((match) => ({
              scoreA: sanitizeScore(String(match?.scoreA || "")),
              scoreB: sanitizeScore(String(match?.scoreB || ""))
            }))
          : [],
        Array.isArray(value.final)
          ? value.final.map((match) => ({
              scoreA: sanitizeScore(String(match?.scoreA || "")),
              scoreB: sanitizeScore(String(match?.scoreB || ""))
            }))
          : []
      ]
    });
  }

  return hydrateBracketState(createEmptyBracketState());
}

function hydrateBracketState(rawState) {
  const playersText = normalizePlayersText(rawState.playersText || "");
  const players = parsePlayers(playersText);
  const seeding = normalizeBracketSeeding(rawState.seeding, players);
  const slotCount = nextPowerOfTwo(Math.max(2, players.length || 2));
  const roundCount = Math.log2(slotCount);
  const rounds = Array.from({ length: roundCount }, (_, roundIndex) => {
    const matchCount = slotCount / (2 ** (roundIndex + 1));
    return Array.from({ length: matchCount }, (_, matchIndex) => ({
      scoreA: sanitizeScore(String(rawState.rounds?.[roundIndex]?.[matchIndex]?.scoreA || "")),
      scoreB: sanitizeScore(String(rawState.rounds?.[roundIndex]?.[matchIndex]?.scoreB || ""))
    }));
  });

  return {
    playersText,
    players,
    seeding,
    slotCount,
    roundCount,
    rounds
  };
}

function buildBracketView(inputState) {
  const state = normalizeBracketState(inputState);
  const seededPlayers = [
    ...state.seeding,
    ...Array.from({ length: state.slotCount - state.players.length }, () => "")
  ];

  let previousMatches = [];
  const rounds = Array.from({ length: state.roundCount }, (_, roundIndex) => {
    const matchCount = state.slotCount / (2 ** (roundIndex + 1));
    const matches = Array.from({ length: matchCount }, (_, matchIndex) => {
      const players = roundIndex === 0
        ? {
            playerA: seededPlayers[matchIndex * 2] || "",
            playerB: seededPlayers[matchIndex * 2 + 1] || ""
          }
        : {
            playerA: previousMatches[matchIndex * 2]?.winner || "",
            playerB: previousMatches[matchIndex * 2 + 1]?.winner || ""
          };

      const score = state.rounds[roundIndex][matchIndex];
      const winner = determineWinner(players.playerA, players.playerB, score.scoreA, score.scoreB);

      return {
        ...players,
        scoreA: score.scoreA,
        scoreB: score.scoreB,
        winner,
        matchCount,
        scoreDisabled: !(players.playerA && players.playerB),
        labelA: getSlotLabel(players.playerA, players.playerB, roundIndex),
        labelB: getSlotLabel(players.playerB, players.playerA, roundIndex),
        resultLabel: getResultLabel(players.playerA, players.playerB, winner)
      };
    });

    previousMatches = matches;

    return {
      matchCount,
      matches
    };
  });

  return {
    ...state,
    rounds,
    byeCount: state.slotCount - state.players.length,
    champion: rounds.at(-1)?.matches[0]?.winner || ""
  };
}

function determineWinner(playerA, playerB, scoreA, scoreB) {
  if (playerA && !playerB) {
    return playerA;
  }

  if (!playerA && playerB) {
    return playerB;
  }

  if (!playerA || !playerB) {
    return "";
  }

  if (scoreA === "" || scoreB === "") {
    return "";
  }

  const left = Number(scoreA);
  const right = Number(scoreB);

  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) {
    return "";
  }

  return left > right ? playerA : playerB;
}

function getSlotLabel(player, opponent, roundIndex) {
  if (player) {
    return player;
  }

  if (opponent) {
    return "Freilos";
  }

  return roundIndex === 0 ? "Freier Slot" : "Warten auf Sieger";
}

function getResultLabel(playerA, playerB, winner) {
  if (!playerA && !playerB) {
    return "Noch kein Match gesetzt";
  }

  if (winner && playerA && !playerB) {
    return `${winner} rückt per Freilos weiter`;
  }

  if (winner && !playerA && playerB) {
    return `${winner} rückt per Freilos weiter`;
  }

  if (winner) {
    return `Sieger: ${winner}`;
  }

  if (playerA && playerB) {
    return "Sieger offen";
  }

  return "Warten auf Gegner";
}

function getRoundTitle(matchCount, roundIndex, totalRounds) {
  if (matchCount === 1) {
    return "Finale";
  }

  if (matchCount === 2) {
    return "Halbfinale";
  }

  if (matchCount === 4) {
    return "Viertelfinale";
  }

  if (matchCount === 8) {
    return "Achtelfinale";
  }

  if (matchCount === 16) {
    return "Runde der 32";
  }

  if (matchCount === 32) {
    return "Runde der 64";
  }

  return `Runde ${roundIndex + 1} / ${totalRounds}`;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(value));
}

function parsePlayers(playersText) {
  return normalizePlayersText(playersText)
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizePlayersText(value) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function createBracketPayload(state) {
  const normalized = normalizeBracketState(state);
  return {
    state: {
      playersText: normalized.playersText,
      seeding: normalized.seeding,
      rounds: serializeBracketRounds(normalized.rounds)
    },
    updatedAt: new Date().toISOString()
  };
}

async function writeBracketState(ref, state) {
  await setDoc(ref, createBracketPayload(state));
}

function needsBracketMigration(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return true;
  }

  const normalized = createBracketPayload(rawState).state;
  const hasOnlyExpectedKeys = Object.keys(rawState).every((key) => ["playersText", "seeding", "rounds"].includes(key));

  return !hasOnlyExpectedKeys
    || rawState.playersText !== normalized.playersText
    || !Array.isArray(rawState.seeding)
    || JSON.stringify(rawState.seeding) !== JSON.stringify(normalized.seeding)
    || !Array.isArray(rawState.rounds)
    || JSON.stringify(rawState.rounds) !== JSON.stringify(normalized.rounds);
}

function normalizeBracketSeeding(rawSeeding, players) {
  const seeding = Array.isArray(rawSeeding)
    ? rawSeeding.map((player) => String(player).trim()).filter(Boolean)
    : [];

  if (haveSamePlayers(players, seeding)) {
    return seeding;
  }

  return shufflePlayers(players);
}

function deserializeBracketRounds(rawRounds) {
  if (!Array.isArray(rawRounds)) {
    return [];
  }

  return rawRounds.map((round) => {
    const matches = Array.isArray(round)
      ? round
      : Array.isArray(round?.matches)
        ? round.matches
        : [];

    return matches.map((match) => ({
      scoreA: sanitizeScore(String(match?.scoreA || "")),
      scoreB: sanitizeScore(String(match?.scoreB || ""))
    }));
  });
}

function serializeBracketRounds(rounds) {
  return rounds.map((matches) => ({
    matches: matches.map((match) => ({
      scoreA: sanitizeScore(String(match?.scoreA || "")),
      scoreB: sanitizeScore(String(match?.scoreB || ""))
    }))
  }));
}

function haveSamePlayers(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  const counts = new Map();

  left.forEach((player) => {
    counts.set(player, (counts.get(player) || 0) + 1);
  });

  for (const player of right) {
    const remaining = counts.get(player);
    if (!remaining) {
      return false;
    }

    if (remaining === 1) {
      counts.delete(player);
    } else {
      counts.set(player, remaining - 1);
    }
  }

  return counts.size === 0;
}

function arePlayerListsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((player, index) => player === right[index]);
}

function shufflePlayers(players) {
  const shuffled = [...players];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = getRandomIndex(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function getRandomIndex(max) {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0] % max;
  }

  return Math.floor(Math.random() * max);
}

function createRankingRow(name = "") {
  return {
    id: makeId(),
    name,
    games: 0,
    wins: 0,
    legsFor: 0,
    legsAgainst: 0,
    oneEighty: 0,
    average: 0,
    points: 0
  };
}

function normalizeRankingState(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((row) => ({
    id: String(row?.id || makeId()),
    name: String(row?.name || ""),
    games: normalizeNumericValue(row?.games),
    wins: normalizeNumericValue(row?.wins),
    legsFor: normalizeNumericValue(row?.legsFor),
    legsAgainst: normalizeNumericValue(row?.legsAgainst),
    oneEighty: normalizeNumericValue(row?.oneEighty),
    average: normalizeNumericValue(row?.average, true),
    points: normalizeNumericValue(row?.points)
  }));
}

function createRankingPayload(state) {
  return {
    state: normalizeRankingState(state),
    updatedAt: new Date().toISOString()
  };
}

function sortRankingRows(rows) {
  return [...rows].sort((left, right) => {
    const pointDiff = Number(right.points) - Number(left.points);
    if (pointDiff !== 0) {
      return pointDiff;
    }

    const diffDelta = (Number(right.legsFor) - Number(right.legsAgainst)) - (Number(left.legsFor) - Number(left.legsAgainst));
    if (diffDelta !== 0) {
      return diffDelta;
    }

    return Number(right.average) - Number(left.average);
  });
}

function updateDiffCell(id, state) {
  const diffElement = document.querySelector(`[data-diff-id="${id}"]`);
  const row = state.find((entry) => entry.id === id);
  if (!diffElement || !row) {
    return;
  }

  diffElement.textContent = formatDiff(Number(row.legsFor) - Number(row.legsAgainst));
}

function formatDiff(value) {
  if (value > 0) {
    return `+${value}`;
  }

  return `${value}`;
}

function normalizeNumericValue(value, allowDecimal = false) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const numeric = allowDecimal ? Number.parseFloat(value) : Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sanitizeScore(value) {
  if (value === "") {
    return "";
  }

  const sanitized = String(value).replace(/[^\d]/g, "");
  return sanitized.slice(0, 2);
}

function scoreKey(side) {
  return side === "a" ? "scoreA" : "scoreB";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function debounce(callback, wait) {
  let timeoutId = null;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, wait);
  };
}

async function pushImmediate(ref, payload, syncStatus, merge = true) {
  try {
    if (merge) {
      await setDoc(ref, payload, { merge: true });
    } else {
      await setDoc(ref, payload);
    }

    setSyncStatus(syncStatus, "Gespeichert", "live");
  } catch (error) {
    handleWriteError(error, syncStatus);
  }
}

function setSyncStatus(element, message, state) {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.dataset.state = state;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = String(value);
  }
}
