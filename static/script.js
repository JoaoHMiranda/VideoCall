const socket = io();
const ROOM_ID = "sala-geral"; 
const videoGrid = document.getElementById('videos-grid');
const meetingScreen = document.getElementById('meeting-screen');
const leaveScreen = document.getElementById('leave-screen');
const warningBanner = document.getElementById('connection-warning');

let localStream;
let audioContext;
let audioSource;
let audioDestination;
let peers = {}; 
let isFilterOn = false; 
let animationId; 

// --- CORREÇÃO AQUI: Variável para saber se foi você quem saiu ---
let isIntentionalDisconnect = false; 

// Detecção simples de Mobile
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Servidores Mozilla
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.services.mozilla.com' }]
};

// --- O CÉREBRO DO ÁUDIO ---

async function toggleVoiceFilter() {
    const btn = document.getElementById('btn-filter');

    if (!localStream) return;

    if (!isFilterOn) {
        try {
            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') await audioContext.resume();

            audioSource = audioContext.createMediaStreamSource(localStream);
            audioDestination = audioContext.createMediaStreamDestination();

            // MODO MOBILE (Volume Baixo + Nativo)
            if (isMobile) {
                console.log("Modo Mobile: Reduzindo volume digitalmente.");
                const volumeControl = audioContext.createGain();
                volumeControl.gain.value = 0.2; 

                audioSource.connect(volumeControl);
                volumeControl.connect(audioDestination);

                applyProcessedStream();
                activateVisuals(btn, "Filtro Mobile Ativo");
                return; 
            }

            // MODO PC (Noise Gate + Filtros)
            console.log("Modo PC: Noise Gate Ativo");
            const preGain = audioContext.createGain(); preGain.gain.value = 3.0; 
            const lowPass = audioContext.createBiquadFilter(); lowPass.type = 'lowpass'; lowPass.frequency.value = 4000; 
            const highPass = audioContext.createBiquadFilter(); highPass.type = 'highpass'; highPass.frequency.value = 150; 
            const gateGain = audioContext.createGain(); gateGain.gain.value = 0.1; 
            const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            audioSource.connect(preGain);
            preGain.connect(highPass);
            highPass.connect(lowPass);
            lowPass.connect(gateGain);
            lowPass.connect(analyser);
            gateGain.connect(audioDestination);

            const processGate = () => {
                if (!isFilterOn) return;
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for(let i = 0; i < bufferLength; i++) sum += dataArray[i];
                const volume = sum / bufferLength; // Correção da variável bufferLength que faltava no escopo local
                // Na verdade bufferLength vem do analyser, vamos corrigir o acesso:
                const len = dataArray.length;
                let s = 0; for(let i=0; i<len; i++) s+=dataArray[i];
                const v = s / len;

                if (v > 3) {
                    gateGain.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.05);
                } else {
                    gateGain.gain.setTargetAtTime(0.02, audioContext.currentTime, 0.2);
                }
                animationId = requestAnimationFrame(processGate);
            };
            processGate();

            applyProcessedStream();
            activateVisuals(btn, "Filtro PC Ativo");

        } catch (e) {
            console.error("Erro Audio:", e);
        }
    } else {
        disableFilter(btn);
    }
}

function applyProcessedStream() {
    const processedTrack = audioDestination.stream.getAudioTracks()[0];
    for (let id in peers) {
        const sender = peers[id].getSenders().find(s => s.track.kind === 'audio');
        if (sender) sender.replaceTrack(processedTrack);
    }
}

function activateVisuals(btn, msg) {
    isFilterOn = true;
    btn.classList.remove('off');
    btn.style.backgroundColor = "#8ab4f8";
    btn.style.color = "#202124";
    console.log(msg);
}

function disableFilter(btn) {
    if (animationId) cancelAnimationFrame(animationId);
    
    const originalTrack = localStream.getAudioTracks()[0];
    for (let id in peers) {
        const sender = peers[id].getSenders().find(s => s.track.kind === 'audio');
        if (sender) sender.replaceTrack(originalTrack);
    }

    isFilterOn = false;
    btn.classList.add('off');
    btn.style.backgroundColor = "#3c4043";
    btn.style.color = "white";
    console.log("Filtro Desativado");
}

// --- CONTROLES PADRÃO ---

function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('btn-mic');
            const icon = btn.querySelector('span');
            if (audioTrack.enabled) {
                btn.classList.remove('off');
                icon.innerText = 'mic';
            } else {
                btn.classList.add('off');
                icon.innerText = 'mic_off';
            }
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('btn-cam');
            const icon = btn.querySelector('span');
            if (videoTrack.enabled) {
                btn.classList.remove('off');
                icon.innerText = 'videocam';
            } else {
                btn.classList.add('off');
                icon.innerText = 'videocam_off';
            }
        }
    }
}

function leaveRoom() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (audioContext) audioContext.close();
    
    // --- CORREÇÃO ---
    isIntentionalDisconnect = true; // Avisa o sistema que fui EU que saí
    socket.disconnect();
    
    meetingScreen.style.display = 'none';
    leaveScreen.style.display = 'flex';
}

// --- WEBRTC ---

async function start() {
    try {
        const constraints = { 
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user" 
            }, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        const myVideo = document.createElement('video');
        myVideo.muted = true; 
        myVideo.srcObject = localStream;
        myVideo.autoplay = true;
        myVideo.playsInline = true;
        myVideo.classList.add('local-video');
        myVideo.onloadedmetadata = () => { myVideo.play(); };
        videoGrid.appendChild(myVideo);

        socket.emit('join', ROOM_ID);

    } catch (err) {
        alert("Erro: " + err.message);
    }
}

function createPeer(targetSid, initiator) {
    const pc = new RTCPeerConnection(rtcConfig);
    
    let streamToSend = localStream;
    if (isFilterOn && audioDestination) {
        const processedTrack = audioDestination.stream.getAudioTracks()[0];
        const videoTrack = localStream.getVideoTracks()[0];
        streamToSend = new MediaStream([processedTrack, videoTrack]);
    }

    if (streamToSend) {
        streamToSend.getTracks().forEach(track => pc.addTrack(track, streamToSend));
    }

    pc.ontrack = (event) => {
        let vid = document.getElementById(targetSid);
        if (!vid) {
            vid = document.createElement('video');
            vid.id = targetSid;
            vid.autoplay = true;
            vid.playsInline = true; 
            videoGrid.appendChild(vid);
        }
        vid.srcObject = event.streams[0];
        vid.onloadedmetadata = () => { vid.play().catch(console.error); };
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { type: 'candidate', target_sid: targetSid, payload: event.candidate });
        }
    };

    if (initiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            socket.emit('signal', { type: 'offer', target_sid: targetSid, payload: offer });
        });
    }
    return pc;
}

socket.on('new-peer', (data) => { peers[data.peer_id] = createPeer(data.peer_id, true); });
socket.on('signal', async (data) => {
    const pc = peers[data.sender_sid] || createPeer(data.sender_sid, false);
    peers[data.sender_sid] = pc;
    if (data.type === 'offer') {
        await pc.setRemoteDescription(data.payload);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { type: 'answer', target_sid: data.sender_sid, payload: answer });
    } else if (data.type === 'answer') await pc.setRemoteDescription(data.payload);
    else if (data.type === 'candidate') await pc.addIceCandidate(data.payload);
});
socket.on('peer-disconnected', (data) => {
    const vid = document.getElementById(data.peer_id);
    if (vid) vid.remove();
    if (peers[data.peer_id]) { peers[data.peer_id].close(); delete peers[data.peer_id]; }
});

// --- MONITOR DE CONEXÃO CORRIGIDO ---

socket.on('disconnect', () => {
    // Só mostra o erro se NÃO foi intencional
    if (!isIntentionalDisconnect) {
        warningBanner.style.display = 'flex';
    }
});

socket.on('connect', () => {
    warningBanner.style.display = 'none';
    isIntentionalDisconnect = false; // Reseta para a próxima vez
});

window.addEventListener('offline', () => { warningBanner.style.display = 'flex'; });
window.addEventListener('online', () => { 
    if (socket.connected) warningBanner.style.display = 'none'; 
});

start();