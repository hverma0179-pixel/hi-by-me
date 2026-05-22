const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const micButton = document.getElementById("micButton");
const stopButton = document.getElementById("stopButton");
const clearButton = document.getElementById("clearButton");
const voiceSelect = document.getElementById("voiceSelect");
const orb = document.getElementById("aiOrb");
const stateText = document.getElementById("stateText");
const quickPromptButtons = document.querySelectorAll(".quick-prompts button");

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let recognition = null;
let selectedVoice = null;
let voices = [];
let isBusy = false;

function setState(state, text) {
  orb.className = `orb ${state}`;
  stateText.textContent = text;
}

function addMessage(role, text, extraClass = "") {
  const article = document.createElement("article");
  article.className = `message ${role} ${extraClass}`.trim();
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.appendChild(paragraph);
  messagesEl.appendChild(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showError(message) {
  addMessage("ai", message, "error");
  setState("idle", "Ready, but something needs attention.");
}

function detectBestVoice(list) {
  const preferred = [
    "Google US English",
    "Microsoft Aria",
    "Microsoft Jenny",
    "Samantha",
    "Daniel"
  ];

  return (
    preferred.map((name) => list.find((voice) => voice.name.includes(name))).find(Boolean) ||
    list.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith("en")) ||
    list[0] ||
    null
  );
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    voiceSelect.innerHTML = '<option value="">Voice output unsupported</option>';
    stopButton.disabled = true;
    showError("Voice output is not supported in this browser.");
    return;
  }

  voices = window.speechSynthesis.getVoices();
  voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading voices...";
    voiceSelect.appendChild(option);
    return;
  }

  selectedVoice = detectBestVoice(voices);

  voices.forEach((voice, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = selectedVoice === voice;
    voiceSelect.appendChild(option);
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    showError("Voice output is not supported in this browser.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = selectedVoice;
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.onstart = () => setState("speaking", "Speaking...");
  utterance.onend = () => setState("idle", "Ready for your command.");
  utterance.onerror = () => showError("Voice playback failed.");

  window.speechSynthesis.speak(utterance);
}

async function askHarvis(message) {
  if (!message || isBusy) return;

  isBusy = true;
  micButton.disabled = true;
  addMessage("user", message);
  inputEl.value = "";
  setState("thinking", "Thinking...");

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Backend failed to answer.");
    }

    const answer = data.answer || "I could not generate a clear response.";
    addMessage("ai", answer);
    speak(answer);
  } catch (error) {
    showError(error.message || "Harvis backend is not reachable.");
  } finally {
    isBusy = false;
    micButton.disabled = false;
    if (!window.speechSynthesis?.speaking) {
      setState("idle", "Ready for your command.");
    }
  }
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    micButton.disabled = true;
    micButton.title = "SpeechRecognition is not supported in this browser.";
    showError("Mic voice input is not supported in this browser. Try Chrome or Edge.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => setState("listening", "Listening...");

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    askHarvis(transcript.trim());
  };

  recognition.onerror = (event) => {
    const reason = event.error === "not-allowed" ? "Microphone permission denied." : "Mic failed.";
    showError(`${reason} You can still type your message.`);
  };

  recognition.onend = () => {
    if (!isBusy && !window.speechSynthesis?.speaking) {
      setState("idle", "Ready for your command.");
    }
  };
}

micButton.addEventListener("click", () => {
  if (!recognition) {
    showError("Mic voice input is not supported in this browser.");
    return;
  }

  window.speechSynthesis?.cancel();
  recognition.start();
});

stopButton.addEventListener("click", () => {
  window.speechSynthesis?.cancel();
  setState("idle", "Speech stopped.");
});

clearButton.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  addMessage("ai", "Chat cleared. I am ready.");
  setState("idle", "Ready for your command.");
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  askHarvis(inputEl.value.trim());
});

voiceSelect.addEventListener("change", () => {
  selectedVoice = voices[Number(voiceSelect.value)] || selectedVoice;
});

quickPromptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    askHarvis(button.textContent.trim());
  });
});

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

loadVoices();
setupSpeechRecognition();
setState("idle", "Ready for your command.");
