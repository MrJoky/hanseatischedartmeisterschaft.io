import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const BRACKET_DOC_PATH = ["publicState", "bracket"];
const RANKING_DOC_PATH = ["publicState", "ranking"];

const bracketDemoState = {
  quarterfinals: [
    { a: "Kai", b: "Mats", scoreA: "4", scoreB: "2" },
    { a: "Nico", b: "Tamme", scoreA: "4", scoreB: "3" },
    { a: "Bene", b: "Lasse", scoreA: "1", scoreB: "4" },
    { a: "Jan", b: "Fiete", scoreA: "4", scoreB: "0" }
  ],
  semifinals: [
    { scoreA: "5", scoreB: "4" },
    { scoreA: "2", scoreB: "5" }
  ],
  final: [
    { scoreA: "6", scoreB: "4" }
  ]
};

const rankingDemoState = [
  { id: makeId(), name: "Kai", games: 4, wins: 4, legsFor: 19, legsAgainst: 10, oneEighty: 6, average: 63.5, points: 12 },
  { id: makeId(), name: "Jan", games: 4, wins: 3, legsFor: 16, legsAgainst: 9, oneEighty: 5, average: 61.1, points: 9 },
  { id: makeId(), name: "Nico", games: 3, wins: 2, legsFor: 11, legsAgainst: 10, oneEighty: 2, average: 55.8, points: 6 },
  { id: makeId(), name: "Lasse", games: 3, wins: 1, legsFor: 8, legsAgainst: 12, oneEighty: 1, average: 52.4, points: 3 }
];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

document.addEventListener("DOMContentLoaded", () => {
  initReveal();
  initPage();
});

function initPage() {
  const page = document.body.dataset.page;

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

async function initBracketPage() {
  const syncStatus = document.getElementById("syncStatus");
  const bracketRef = doc(db, ...BRACKET_DOC_PATH);
  let state = createEmptyBracketState();
  let isApplyingRemote = false;

  setSyncStatus(syncStatus, "Cloud Sync verbindet...", "pending");

  onSnapshot(bracketRef, async (snapshot) => {
    if (!snapshot.exists()) {
      await setDoc(bracketRef, createBracketPayload(createEmptyBracketState()), { merge: true });
      return;
    }

    isApplyingRemote = true;
    state = normalizeBracketState(snapshot.data()?.state);
    renderBracket(state);
    isApplyingRemote = false;
    setSyncStatus(syncStatus, "Cloud Sync aktiv", "live");
  }, (error) => {
    console.error(error);
    setSyncStatus(syncStatus, "Cloud Sync fehlgeschlagen", "error");
  });

  const pushBracketState = debounce(async () => {
    try {
      await setDoc(bracketRef, createBracketPayload(state), { merge: true });
      setSyncStatus(syncStatus, "Gespeichert", "live");
    } catch (error) {
      console.error(error);
      setSyncStatus(syncStatus, "Speichern fehlgeschlagen", "error");
    }
  }, 500);

  document.querySelectorAll(".player-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      if (isApplyingRemote) {
        return;
      }

      const { round, match, side } = event.target.dataset;
      state[round][Number(match)][side] = event.target.value;
      renderBracket(state);
      setSyncStatus(syncStatus, "Änderungen werden synchronisiert...", "pending");
      pushBracketState();
    });
  });

  document.querySelectorAll(".score-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      if (isApplyingRemote) {
        return;
      }

      const { round, match, side } = event.target.dataset;
      state[round][Number(match)][scoreKey(side)] = sanitizeScore(event.target.value);
      renderBracket(state);
      setSyncStatus(syncStatus, "Änderungen werden synchronisiert...", "pending");
      pushBracketState();
    });
  });

  document.getElementById("loadBracketDemo")?.addEventListener("click", async () => {
    state = cloneValue(bracketDemoState);
    renderBracket(state);
    setSyncStatus(syncStatus, "Demo wird gespeichert...", "pending");
    await pushImmediate(bracketRef, createBracketPayload(state), syncStatus);
  });

  document.getElementById("resetBracket")?.addEventListener("click", async () => {
    state = createEmptyBracketState();
    renderBracket(state);
    setSyncStatus(syncStatus, "Leerer Baum wird gespeichert...", "pending");
    await pushImmediate(bracketRef, createBracketPayload(state), syncStatus);
  });
}

function renderBracket(state) {
  renderQuarterfinalInputs(state.quarterfinals);
  renderScoreInputs("quarterfinals", state.quarterfinals);
  renderScoreInputs("semifinals", state.semifinals);
  renderScoreInputs("final", state.final);

  const quarterWinners = state.quarterfinals.map(determineWinner);
  const semifinalMatches = [
    { a: quarterWinners[0], b: quarterWinners[1], scoreA: state.semifinals[0].scoreA, scoreB: state.semifinals[0].scoreB },
    { a: quarterWinners[2], b: quarterWinners[3], scoreA: state.semifinals[1].scoreA, scoreB: state.semifinals[1].scoreB }
  ];

  const semifinalWinners = semifinalMatches.map(determineWinner);
  const finalMatch = [
    { a: semifinalWinners[0], b: semifinalWinners[1], scoreA: state.final[0].scoreA, scoreB: state.final[0].scoreB }
  ];
  const champion = determineWinner(finalMatch[0]);

  renderLockedName("semifinals-0-a", quarterWinners[0]);
  renderLockedName("semifinals-0-b", quarterWinners[1]);
  renderLockedName("semifinals-1-a", quarterWinners[2]);
  renderLockedName("semifinals-1-b", quarterWinners[3]);
  renderLockedName("final-0-a", semifinalWinners[0]);
  renderLockedName("final-0-b", semifinalWinners[1]);

  const championName = document.getElementById("championName");
  if (championName) {
    championName.textContent = champion || "Noch offen";
  }
}

function renderQuarterfinalInputs(matches) {
  document.querySelectorAll(".player-input").forEach((input) => {
    const { match, side } = input.dataset;
    input.value = matches[Number(match)][side] || "";
  });
}

function renderScoreInputs(round, matches) {
  document.querySelectorAll(`.score-input[data-round="${round}"]`).forEach((input) => {
    const { match, side } = input.dataset;
    input.value = matches[Number(match)][scoreKey(side)] || "";
  });
}

function renderLockedName(key, value) {
  const element = document.querySelector(`[data-display="${key}"]`);
  if (!element) {
    return;
  }

  element.textContent = value || "Offen";
  element.classList.toggle("is-pending", !value);
}

async function initRankingPage() {
  const syncStatus = document.getElementById("syncStatus");
  const rankingRef = doc(db, ...RANKING_DOC_PATH);
  const tableBody = document.getElementById("rankingBody");
  let state = [];
  let isApplyingRemote = false;

  setSyncStatus(syncStatus, "Cloud Sync verbindet...", "pending");

  onSnapshot(rankingRef, async (snapshot) => {
    if (!snapshot.exists()) {
      await setDoc(rankingRef, createRankingPayload(cloneValue(rankingDemoState)), { merge: true });
      return;
    }

    isApplyingRemote = true;
    state = normalizeRankingState(snapshot.data()?.state);
    renderRankingTable();
    isApplyingRemote = false;
    setSyncStatus(syncStatus, "Cloud Sync aktiv", "live");
  }, (error) => {
    console.error(error);
    setSyncStatus(syncStatus, "Cloud Sync fehlgeschlagen", "error");
  });

  const pushRankingState = debounce(async () => {
    try {
      await setDoc(rankingRef, createRankingPayload(state), { merge: true });
      setSyncStatus(syncStatus, "Gespeichert", "live");
    } catch (error) {
      console.error(error);
      setSyncStatus(syncStatus, "Speichern fehlgeschlagen", "error");
    }
  }, 500);

  document.getElementById("addRankingRow")?.addEventListener("click", () => {
    state.push(createRankingRow());
    renderRankingTable();
    setSyncStatus(syncStatus, "Neuer Spieler wird synchronisiert...", "pending");
    pushRankingState();
  });

  document.getElementById("sortRanking")?.addEventListener("click", () => {
    state = sortRankingRows(state);
    renderRankingTable();
    setSyncStatus(syncStatus, "Ranking wird synchronisiert...", "pending");
    pushRankingState();
  });

  document.getElementById("resetRanking")?.addEventListener("click", async () => {
    state = cloneValue(rankingDemoState);
    renderRankingTable();
    setSyncStatus(syncStatus, "Demo-Ranking wird gespeichert...", "pending");
    await pushImmediate(rankingRef, createRankingPayload(state), syncStatus);
  });

  document.getElementById("importBracketPlayers")?.addEventListener("click", async () => {
    try {
      const bracketSnap = await getDoc(doc(db, ...BRACKET_DOC_PATH));
      const bracketState = normalizeBracketState(bracketSnap.data()?.state);
      const bracketNames = bracketState.quarterfinals
        .flatMap((match) => [match.a, match.b])
        .map((name) => name.trim())
        .filter(Boolean);

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

    tableBody.innerHTML = state.map((row, index) => {
      const diff = Number(row.legsFor) - Number(row.legsAgainst);
      return `
        <tr>
          <td><span class="rank-pill">${index + 1}</span></td>
          <td><input class="table-input name" data-id="${row.id}" data-field="name" type="text" value="${escapeHtml(row.name)}" placeholder="Name" /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="games" type="number" min="0" value="${row.games}" /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="wins" type="number" min="0" value="${row.wins}" /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="legsFor" type="number" min="0" value="${row.legsFor}" /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="legsAgainst" type="number" min="0" value="${row.legsAgainst}" /></td>
          <td><span class="diff-pill" data-diff-id="${row.id}">${formatDiff(diff)}</span></td>
          <td><input class="table-input" data-id="${row.id}" data-field="oneEighty" type="number" min="0" value="${row.oneEighty}" /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="average" type="number" step="0.1" min="0" value="${row.average}" /></td>
          <td><input class="table-input" data-id="${row.id}" data-field="points" type="number" min="0" value="${row.points}" /></td>
          <td><button class="icon-button" type="button" data-remove-id="${row.id}" aria-label="Spieler entfernen">×</button></td>
        </tr>
      `;
    }).join("");
  }
}

function determineWinner(match) {
  if (!match?.a || !match?.b) {
    return "";
  }

  const scoreA = Number(match.scoreA);
  const scoreB = Number(match.scoreB);

  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || match.scoreA === "" || match.scoreB === "" || scoreA === scoreB) {
    return "";
  }

  return scoreA > scoreB ? match.a : match.b;
}

function createEmptyBracketState() {
  return {
    quarterfinals: Array.from({ length: 4 }, () => ({ a: "", b: "", scoreA: "", scoreB: "" })),
    semifinals: Array.from({ length: 2 }, () => ({ scoreA: "", scoreB: "" })),
    final: [{ scoreA: "", scoreB: "" }]
  };
}

function normalizeBracketState(value) {
  const fallback = createEmptyBracketState();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  return {
    quarterfinals: Array.from({ length: 4 }, (_, index) => ({
      a: String(value.quarterfinals?.[index]?.a || ""),
      b: String(value.quarterfinals?.[index]?.b || ""),
      scoreA: sanitizeScore(String(value.quarterfinals?.[index]?.scoreA || "")),
      scoreB: sanitizeScore(String(value.quarterfinals?.[index]?.scoreB || ""))
    })),
    semifinals: Array.from({ length: 2 }, (_, index) => ({
      scoreA: sanitizeScore(String(value.semifinals?.[index]?.scoreA || "")),
      scoreB: sanitizeScore(String(value.semifinals?.[index]?.scoreB || ""))
    })),
    final: [
      {
        scoreA: sanitizeScore(String(value.final?.[0]?.scoreA || "")),
        scoreB: sanitizeScore(String(value.final?.[0]?.scoreB || ""))
      }
    ]
  };
}

function createBracketPayload(state) {
  return {
    state: normalizeBracketState(state),
    updatedAt: new Date().toISOString()
  };
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
    return cloneValue(rankingDemoState);
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

  const sanitized = value.replace(/[^\d]/g, "");
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

async function pushImmediate(ref, payload, syncStatus) {
  try {
    await setDoc(ref, payload, { merge: true });
    setSyncStatus(syncStatus, "Gespeichert", "live");
  } catch (error) {
    console.error(error);
    setSyncStatus(syncStatus, "Speichern fehlgeschlagen", "error");
  }
}

function setSyncStatus(element, message, state) {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.dataset.state = state;
}
