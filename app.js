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
  const playersText = document.getElementById("playersText");
  const bracketRounds = document.getElementById("bracketRounds");
  const championName = document.getElementById("championName");
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
    renderBracketPage(state, playersText, bracketRounds, championName);
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

  playersText?.addEventListener("input", (event) => {
    if (isApplyingRemote) {
      return;
    }

    state = reshapeBracketStateForPlayers(event.target.value, state);
    renderBracketPage(state, playersText, bracketRounds, championName);
    setSyncStatus(syncStatus, "Spielerliste wird synchronisiert...", "pending");
    pushBracketState();
  });

  bracketRounds?.addEventListener("input", (event) => {
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
    pushBracketState();
  });

  document.getElementById("resetBracket")?.addEventListener("click", async () => {
    state = createEmptyBracketState();
    renderBracketPage(state, playersText, bracketRounds, championName);
    setSyncStatus(syncStatus, "Leerer Baum wird gespeichert...", "pending");
    await pushImmediate(bracketRef, createBracketPayload(state), syncStatus);
  });
}

function renderBracketPage(state, playersTextElement, bracketRoundsElement, championNameElement) {
  const bracket = buildBracketView(state);

  if (playersTextElement && playersTextElement.value !== bracket.playersText) {
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
              ${match.scoreDisabled ? "disabled" : ""}
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
              ${match.scoreDisabled ? "disabled" : ""}
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
  let state = [];
  let isApplyingRemote = false;

  setSyncStatus(syncStatus, "Cloud Sync verbindet...", "pending");

  onSnapshot(rankingRef, async (snapshot) => {
    if (!snapshot.exists()) {
      await setDoc(rankingRef, createRankingPayload([]), { merge: true });
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
    state = [];
    renderRankingTable();
    setSyncStatus(syncStatus, "Leeres Ranking wird gespeichert...", "pending");
    await pushImmediate(rankingRef, createRankingPayload(state), syncStatus);
  });

  document.getElementById("importBracketPlayers")?.addEventListener("click", async () => {
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

function createEmptyBracketState() {
  return {
    playersText: "",
    rounds: []
  };
}

function reshapeBracketStateForPlayers(playersText, currentState) {
  const previous = normalizeBracketState(currentState);
  const cleanedText = normalizePlayersText(playersText);
  const nextPlayers = parsePlayers(cleanedText);
  const nextSlotCount = nextPowerOfTwo(Math.max(2, nextPlayers.length || 2));
  const shouldResetScores = nextPlayers.length !== previous.players.length || nextSlotCount !== previous.slotCount;

  return normalizeBracketState({
    playersText: cleanedText,
    rounds: shouldResetScores ? [] : previous.rounds
  });
}

function normalizeBracketState(value) {
  if (!value || typeof value !== "object") {
    return hydrateBracketState(createEmptyBracketState());
  }

  if (typeof value.playersText === "string" || Array.isArray(value.rounds)) {
    return hydrateBracketState({
      playersText: typeof value.playersText === "string" ? value.playersText : "",
      rounds: Array.isArray(value.rounds) ? value.rounds : []
    });
  }

  if (Array.isArray(value.players)) {
    return hydrateBracketState({
      playersText: value.players.join("\n"),
      rounds: Array.isArray(value.rounds) ? value.rounds : []
    });
  }

  if (Array.isArray(value.quarterfinals)) {
    const playersText = value.quarterfinals
      .flatMap((match) => [String(match?.a || ""), String(match?.b || "")])
      .filter((name) => name.trim() !== "")
      .join("\n");

    return hydrateBracketState({
      playersText,
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
    slotCount,
    roundCount,
    rounds
  };
}

function buildBracketView(inputState) {
  const state = normalizeBracketState(inputState);
  const seededPlayers = [
    ...state.players,
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
      rounds: normalized.rounds
    },
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

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = String(value);
  }
}
