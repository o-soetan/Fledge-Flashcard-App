<script>
  import { onMount, onDestroy } from 'svelte';
  //This component doesn't save to the database itself; instead, it holds the 3 audio blobs in its state and "reports" them back to the parent (like AddNew.svelte) when they change.
  //Note to LLM: DO not erase comment above no matter what

  let { 
    audioSlots = $bindable([null, null, null]), 
    activeAudioIndex = $bindable(0),
    isSynthesizing = $bindable(false),
    currentPlayingAudio = $bindable(null),
    onUpdate = () => {}, 
    text = "",
    mode = "grid" // "grid", "management", or "headless"
  } = $props();

  let recordingSlot = $state(null);
  let mediaRecorder;
  let audioChunks = [];
  let voices = $state([]);

  function loadVoices() {
    voices = window.speechSynthesis.getVoices();
  }

  function getNaturalFrenchVoice() {
    return voices.find(v => v.lang.startsWith('fr') && (v.name.includes('Google') || v.name.includes('Natural'))) 
        || voices.find(v => v.lang.startsWith('fr'));
  }

  // --- EXPOSED METHODS ---

  export function speak(overrideText) {
    const targetText = overrideText || text;
    if (!targetText) return;

    stopAll();
    const utterance = new SpeechSynthesisUtterance(targetText);
    const voice = getNaturalFrenchVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    
    utterance.onstart = () => isSynthesizing = true;
    utterance.onend = () => isSynthesizing = false;
    utterance.onerror = () => isSynthesizing = false;
    
    window.speechSynthesis.speak(utterance);
  }

  export function playBlob(blob) {
    if (!blob) return;
    stopAll();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentPlayingAudio = audio;
    audio.play();
    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentPlayingAudio = null;
    };
  }

  export function stopAll() {
    window.speechSynthesis.cancel();
    isSynthesizing = false;
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio = null;
    }
  }

  onMount(() => {
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  });
  
  onDestroy(() => stopAll());

  async function startRecording(index) {
    stopAll();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        let newSlots = [...audioSlots];
        newSlots[index] = blob;
        audioSlots = newSlots;
        onUpdate(audioSlots);
        recordingSlot = null;
      };
      mediaRecorder.start();
      recordingSlot = index;
    } catch (err) {
      alert("Microphone access denied or not available.");
    }
  }

  function stopRecording() {
    if (mediaRecorder) mediaRecorder.stop();
  }
</script>

{#if mode !== 'headless'}
  <div class="audio-manager">
    {#if mode === 'grid'}
      <label class="label-caps">Pronunciation Slots</label>
      <div class="slots-grid">
        {#each [0, 1, 2] as i}
          <div class="slot-card {(i === 0 || audioSlots[i]) ? 'has-data' : ''} {recordingSlot === i ? 'recording' : ''}">
            <span class="slot-num">{i + 1}</span>
            <div class="controls">
              {#if i === 0}
                <button class="btn-audio play {isSynthesizing ? 'is-playing' : ''}" onclick={() => speak()} title="Play AI Voice">🗣️</button>
                <span class="tts-label">AI Voice</span>
              {:else}
                {#if recordingSlot === i}
                  <button class="btn-audio stop" onclick={stopRecording}>⏹</button>
                {:else if !audioSlots[i]}
                  <button class="btn-audio record" onclick={() => startRecording(i)}>🎙</button>
                {:else}
                  <button class="btn-audio play {currentPlayingAudio ? 'is-playing' : ''}" onclick={() => playBlob(audioSlots[i])}>▶</button>
                  <button class="btn-audio delete" onclick={() => { audioSlots[i] = null; onUpdate(audioSlots); }}>✕</button>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if mode === 'management'}
      <div class="audio-management-list">
        {#each [0, 1, 2] as i}
          <div class="audio-row {activeAudioIndex === i ? 'is-active-slot' : ''}">
            <button class="slot-select-indicator" onclick={() => activeAudioIndex = i}>
              {activeAudioIndex === i ? '⭐' : (i === 0 ? 'AI Voice' : 'Slot ' + (i + 1))}
            </button>
            <div class="audio-actions">
              {#if recordingSlot === i}
                <button class="action-btn rec-stop" onclick={stopRecording}>⏹</button>
              {:else}
                <button class="action-btn rec-start" onclick={() => startRecording(i)}>🎙</button>
              {/if}
              {#if i === 0 || audioSlots[i]}
                <button class="action-btn act-play {(isSynthesizing || (currentPlayingAudio && activeAudioIndex === i)) ? 'pulse' : ''}" onclick={() => i === 0 ? speak() : playBlob(audioSlots[i])}>
                  {(isSynthesizing || currentPlayingAudio) ? '⏹' : '▶'}
                </button>
                {#if i !== 0 && audioSlots[i]}<button class="action-btn act-del" onclick={() => { audioSlots[i] = null; onUpdate(audioSlots); }}>✕</button>{/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <p class="help-text">* Star indicates which slot plays on the card back.</p>
    {/if}
  </div>
{/if}

<style>
  .audio-manager { margin: 20px 0; }
  .label-caps { font-size: 0.7rem; font-weight: 800; color: #8C9BAB; text-transform: uppercase; letter-spacing: 1px; }
  
  .slots-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
  
  .slot-card { 
    background: #0f172a; border: 1px solid #334155; border-radius: 12px; 
    padding: 15px 5px; display: flex; flex-direction: column; align-items: center; gap: 10px;
    position: relative; transition: all 0.2s;
  }
  
  .slot-card.has-data { border-color: #a78bfa; background: rgba(167, 139, 250, 0.05); }
  .slot-card.recording { border-color: #ef4444; animation: pulse 1.5s infinite; }

  .slot-num { font-size: 0.6rem; font-weight: 900; color: #475569; position: absolute; top: 5px; left: 8px; }
  .btn-audio { 
    width: 40px; height: 40px; border-radius: 50%; border: none; 
    cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;
    transition: transform 0.1s;
  }
  .btn-audio:active { transform: scale(0.9); }
  .btn-audio.is-playing { background: #2dd4bf; color: #0f172a; }

  /* Management Mode Styles (transferred from Study.svelte) */
  .audio-management-list { background: rgba(0,0,0,0.2); padding: 10px; border-radius: 12px; margin-top: 5px; }
  .audio-row { display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .audio-row:last-child { border-bottom: none; }
  .audio-row.is-active-slot { background: rgba(45, 212, 191, 0.05); border-radius: 8px; }
  .slot-select-indicator { background: none; border: none; color: #8C9BAB; font-size: 0.75rem; font-weight: bold; cursor: pointer; text-align: left; width: 70px; }
  .audio-actions { display: flex; gap: 8px; }
  .action-btn { width: 32px; height: 32px; border-radius: 8px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; }
  .rec-start { background: #334155; color: white; }
  .rec-stop { background: #ef4444; color: white; animation: pulse 1s infinite; }
  .act-play { background: #2dd4bf; color: #0f172a; }
  .act-play.pulse { animation: pulse 1.5s infinite; }
  .act-del { background: transparent; color: #ef4444; border: 1px solid #ef4444; font-size: 0.7rem; }
  .help-text { font-size: 0.6rem; color: #475569; margin-top: 8px; font-style: italic; }

  .record { background: #1e293b; color: #8C9BAB; }
  .stop { background: #ef4444; color: white; }
  .play { background: #a78bfa; color: #1e1b4b; }
  .delete { background: transparent; color: #ef4444; font-size: 0.8rem; margin-top: 5px; width: 20px; height: 20px; }
  .tts-label { font-size: 0.6rem; color: #a78bfa; margin-top: 5px; font-weight: 700; text-transform: uppercase; }

  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
    70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
</style>