<script>
  import { onMount } from 'svelte';
  //This component doesn't save to the database itself; instead, it holds the 3 audio blobs in its state and "reports" them back to the parent (like AddNew.svelte) when they change.
  //Note to LLM: DO not erase comment above no matter what
  export let audioSlots = [null, null, null]; // Blobs go here
  export let onUpdate; // Callback to send blobs to parent
  export let text = ""; // The text to speak for the auto-generated slot

  let recordingSlot = null;
  let mediaRecorder;
  let audioChunks = [];
  let voices = [];

  function loadVoices() {
    voices = window.speechSynthesis.getVoices();
  }

  onMount(() => {
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  });

  function getNaturalFrenchVoice() {
    return voices.find(v => v.lang.startsWith('fr') && (v.name.includes('Google') || v.name.includes('Natural'))) 
        || voices.find(v => v.lang.startsWith('fr'));
  }

  function speakAuto() {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getNaturalFrenchVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9; // Slightly slower for clarity
    window.speechSynthesis.speak(utterance);
  }

  async function startRecording(index) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        audioSlots[index] = blob;
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

  function playAudio(blob) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  }

  function clearSlot(index) {
    audioSlots[index] = null;
    onUpdate(audioSlots);
  }
</script>

<div class="audio-manager">
  <label class="label-caps">Pronunciation Slots</label>
  <div class="slots-grid">
    {#each [0, 1, 2] as i}
      <div class="slot-card {(i === 0 || audioSlots[i]) ? 'has-data' : ''} {recordingSlot === i ? 'recording' : ''}">
        <span class="slot-num">{i + 1}</span>
        
        <div class="controls">
          {#if i === 0}
            <!-- Slot 1 is reserved for non-editable TTS -->
            <button class="btn-audio play" on:click={speakAuto} title="Play AI-generated voice">🗣️</button>
            <span class="tts-label">AI Voice</span>
          {:else}
            <!-- Slots 2 & 3 are for user recording -->
            {#if recordingSlot === i}
              <button class="btn-audio stop" on:click={stopRecording} title="Stop recording">⏹</button>
            {:else if !audioSlots[i]}
              <button class="btn-audio record" on:click={() => startRecording(i)} title="Record your voice">🎙</button>
            {:else}
              <button class="btn-audio play" on:click={() => playAudio(audioSlots[i])} title="Play recording">▶</button>
              <button class="btn-audio delete" on:click={() => clearSlot(i)} title="Delete recording">✕</button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

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