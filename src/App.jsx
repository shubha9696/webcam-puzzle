import { useState, useEffect, useRef } from 'react';
import './App.css';

// Preset local images loaded into public/presets/
const presetImages = {
  cyberpunk_city: '/presets/cyberpunk_city.png',
  space_nebula: '/presets/space_nebula.png',
  retro_arcade: '/presets/retro_arcade.png'
};

function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, settings, instructions

  // Game configuration States
  const [gridSize, setGridSizeState] = useState(3);
  const [imageSource, setImageSourceState] = useState('webcam'); // webcam, cyberpunk_city, space_nebula, retro_arcade, custom
  const [muteSound, setMuteSoundState] = useState(false);
  const [disableVFX, setDisableVFXState] = useState(false);
  const [hintMode, setHintModeState] = useState(false);

  // Calibration and Tracker States
  const [pinchThreshold, setPinchThresholdState] = useState(0.045);
  const [landmarkStyle, setLandmarkStyleState] = useState('neon'); // neon, minimal, hidden

  // Game States
  const [, setBoardState] = useState([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const [gameState, setGameStateState] = useState('LOBBY'); // LOBBY, PLAYING, COMPLETED
  const [moves, setMovesState] = useState(0);
  const [timer, setTimer] = useState(0);
  const [userName, setUserName] = useState('');
  const [customImageName, setCustomImageName] = useState('');

  // Hand Status
  const [webcamReady, setWebcamReady] = useState(false);
  const [handDetected, setHandDetected] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Leaderboards state (separated by grid sizes 3, 4, 5)
  const [leaderboards, setLeaderboards] = useState(() => {
    const saved = localStorage.getItem('webcam_puzzle_leaderboards_v3');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse leaderboards:', e);
      }
    }
    return {
      3: [
        { name: 'CyberPinch', moves: 21, time: 28, date: '1/20/2026' },
        { name: 'Matrix3', moves: 32, time: 42, date: '1/21/2026' }
      ],
      4: [
        { name: 'Aero4x4', moves: 64, time: 88, date: '1/20/2026' }
      ],
      5: [
        { name: 'ZenMaster', moves: 125, time: 210, date: '1/20/2026' }
      ]
    };
  });

  // Active Leaderboard difficulty Tab
  const [leaderboardTab, setLeaderboardTab] = useState(3);

  // Refs for Animation Loop and State sync (avoids React stale closures)
  const videoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const puzzleCanvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const animationFrameId = useRef(null);

  const boardRef = useRef([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const gameStateRef = useRef('LOBBY');
  const latestLandmarksRef = useRef(null);
  const hasPinchedRef = useRef(false);
  const lastSwapTimeRef = useRef(0);

  // Advanced Config Refs
  const gridSizeRef = useRef(3);
  const muteSoundRef = useRef(false);
  const disableVFXRef = useRef(false);
  const hintModeRef = useRef(false);
  const pinchThresholdRef = useRef(0.045);
  const imageSourceRef = useRef('webcam');
  const landmarkStyleRef = useRef('neon');

  // Asset refs
  const loadedImageRef = useRef(null);

  // Web Audio Synth engine Ref
  const audioCtxRef = useRef(null);

  // DOM Refs for high-performance direct manipulation (prevents React lag at 60fps)
  const hudBarRef = useRef(null);
  const hudDistLabelRef = useRef(null);

  // Canvas VFX Particle lists
  const particlesRef = useRef([]);
  const cursorTrailRef = useRef([]);

  // Sync state changes with refs so the canvas loop sees them instantly
  const setBoard = (newBoard) => {
    boardRef.current = newBoard;
    setBoardState(newBoard);
  };

  const setGameState = (newState) => {
    gameStateRef.current = newState;
    setGameStateState(newState);
  };

  const setMoves = (newMoves) => {
    setMovesState(newMoves);
  };

  const setGridSize = (size) => {
    gridSizeRef.current = size;
    setGridSizeState(size);
    // Initialize sorted board
    const newBoard = Array.from({ length: size * size }, (_, i) => i);
    setBoard(newBoard);
  };

  const setMuteSound = (val) => {
    muteSoundRef.current = val;
    setMuteSoundState(val);
  };

  const setDisableVFX = (val) => {
    disableVFXRef.current = val;
    setDisableVFXState(val);
    if (val) {
      particlesRef.current = [];
      cursorTrailRef.current = [];
    }
  };

  const setHintMode = (val) => {
    hintModeRef.current = val;
    setHintModeState(val);
  };

  const setPinchThreshold = (val) => {
    pinchThresholdRef.current = val;
    setPinchThresholdState(val);
  };

  const setImageSource = (source) => {
    imageSourceRef.current = source;
    setImageSourceState(source);
  };

  const setLandmarkStyle = (style) => {
    landmarkStyleRef.current = style;
    setLandmarkStyleState(style);
  };

  // Helper to format time (MM:SS)
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Web Audio Synth sound generator
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
  };

  const playSound = (type) => {
    if (muteSoundRef.current) return;
    try {
      initAudio();
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      const now = ctx.currentTime;
      
      if (type === 'pinch') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'release') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(550, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'swap') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(480, now + 0.12);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'shuffle') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(240, now + 0.04);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (type === 'victory') {
        const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C Major arpeggio
        notes.forEach((freq, index) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, now + index * 0.08);
          g.gain.setValueAtTime(0.12, now + index * 0.08);
          g.gain.exponentialRampToValueAtTime(0.01, now + index * 0.08 + 0.35);
          o.start(now + index * 0.08);
          o.stop(now + index * 0.08 + 0.35);
        });
      }
    } catch (err) {
      console.warn('Audio synth failed:', err);
    }
  };

  // Preset Visual Loading Effect
  useEffect(() => {
    if (imageSource === 'webcam') {
      loadedImageRef.current = null;
    } else if (presetImages[imageSource]) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = presetImages[imageSource];
      img.onload = () => {
        loadedImageRef.current = img;
      };
      img.onerror = () => {
        console.error('Failed to load image preset:', imageSource);
      };
    }
  }, [imageSource]);

  // Shuffling logic via legal sliding moves starting from the solved state (guarantees solvability)
  const shuffleBoard = (currentBoard, size) => {
    let boardCopy = [...currentBoard];
    let emptyIdx = boardCopy.indexOf(size * size - 1);
    let lastMoveIdx = -1;

    // Use Web Audio clicks during shuffling
    const shuffleSteps = size === 3 ? 60 : size === 4 ? 100 : 150;

    for (let i = 0; i < shuffleSteps; i++) {
      const r = Math.floor(emptyIdx / size);
      const c = emptyIdx % size;
      const candidates = [];

      if (c > 0) candidates.push(emptyIdx - 1); // left
      if (c < size - 1) candidates.push(emptyIdx + 1); // right
      if (r > 0) candidates.push(emptyIdx - size); // up
      if (r < size - 1) candidates.push(emptyIdx + size); // down

      // Avoid immediately swapping back
      let filtered = candidates.filter(idx => idx !== lastMoveIdx);
      if (filtered.length === 0) filtered = candidates;

      const nextIdx = filtered[Math.floor(Math.random() * filtered.length)];
      
      // Swap
      boardCopy[emptyIdx] = boardCopy[nextIdx];
      boardCopy[nextIdx] = size * size - 1;

      lastMoveIdx = emptyIdx;
      emptyIdx = nextIdx;
    }
    return boardCopy;
  };

  // Spark particle generator for tile swaps
  const spawnSwapParticles = (tileIdx, size, canvasW, canvasH) => {
    if (disableVFXRef.current) return;
    const tileW = canvasW / size;
    const tileH = canvasH / size;
    const row = Math.floor(tileIdx / size);
    const col = tileIdx % size;
    const centerX = col * tileW + tileW / 2;
    const centerY = row * tileH + tileH / 2;
    
    const colors = ['#00f2fe', '#ff007f', '#9d4edd', '#ffffff', '#39ff14'];
    
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 4.5;
      particlesRef.current.push({
        x: centerX + (Math.random() - 0.5) * tileW * 0.7,
        y: centerY + (Math.random() - 0.5) * tileH * 0.7,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
        life: 20 + Math.floor(Math.random() * 15),
        maxLife: 35
      });
    }
  };

  // Screen particle explosion on Victory
  const spawnVictoryParticles = (canvasW, canvasH) => {
    if (disableVFXRef.current) return;
    const colors = ['#ff007f', '#00f2fe', '#9d4edd', '#39ff14', '#ffff00'];
    for (let i = 0; i < 180; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 8.5;
      particlesRef.current.push({
        x: canvasW / 2,
        y: canvasH / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
        life: 50 + Math.floor(Math.random() * 40),
        maxLife: 90
      });
    }
  };

  // Trigger swap logic
  const handleSwap = (clickedIdx) => {
    if (gameStateRef.current !== 'PLAYING') return;

    const currentBoard = [...boardRef.current];
    const size = gridSizeRef.current;
    const emptyIdx = currentBoard.indexOf(size * size - 1);

    const r_click = Math.floor(clickedIdx / size);
    const c_click = clickedIdx % size;
    const r_empty = Math.floor(emptyIdx / size);
    const c_empty = emptyIdx % size;

    // Check if adjacent (Manhattan distance === 1)
    if (Math.abs(r_click - r_empty) + Math.abs(c_click - c_empty) === 1) {
      currentBoard[emptyIdx] = currentBoard[clickedIdx];
      currentBoard[clickedIdx] = size * size - 1;
      
      setBoard(currentBoard);
      setMoves(prev => prev + 1);
      
      playSound('swap');
      spawnSwapParticles(clickedIdx, size, 500, 500);

      // Check solved state
      const isSolved = currentBoard.every((val, idx) => val === idx);
      if (isSolved) {
        setGameState('COMPLETED');
        playSound('victory');
        spawnVictoryParticles(500, 500);
      }
    }
  };

  // Custom File Uploader logic
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    processUploadedFile(file);
  };

  const processUploadedFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        loadedImageRef.current = img;
        setCustomImageName(file.name);
        setImageSource('custom');
      };
    };
    reader.readAsDataURL(file);
  };

  const removeUploadedImage = () => {
    loadedImageRef.current = null;
    setCustomImageName('');
    setImageSource('webcam');
  };

  // Manual mouse click fallback
  const handleCanvasClick = (e) => {
    if (gameState !== 'PLAYING') return;
    const canvas = puzzleCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const size = gridSize;
    const col = Math.floor((clickX / rect.width) * size);
    const row = Math.floor((clickY / rect.height) * size);

    if (col >= 0 && col < size && row >= 0 && row < size) {
      handleSwap(row * size + col);
    }
  };

  // Game actions
  const handleStartGame = () => {
    const initialBoard = Array.from({ length: gridSize * gridSize }, (_, i) => i);
    const shuffled = shuffleBoard(initialBoard, gridSize);
    setBoard(shuffled);
    setMoves(0);
    setTimer(0);
    setGameState('PLAYING');
    playSound('victory'); // Fun start arpeggio
  };

  const handleResetGame = () => {
    const initialBoard = Array.from({ length: gridSize * gridSize }, (_, i) => i);
    setBoard(initialBoard);
    setMoves(0);
    setTimer(0);
    setGameState('LOBBY');
  };

  const saveScore = (e) => {
    e.preventDefault();
    const finalName = userName.trim() || 'Player';
    const newEntry = {
      name: finalName,
      moves: moves,
      time: timer,
      date: new Date().toLocaleDateString()
    };

    const sizeKey = gridSize;
    const updatedSubList = [...leaderboards[sizeKey], newEntry]
      .sort((a, b) => a.time - b.time || a.moves - b.moves)
      .slice(0, 10);

    const updatedLeaderboards = {
      ...leaderboards,
      [sizeKey]: updatedSubList
    };

    setLeaderboards(updatedLeaderboards);
    localStorage.setItem('webcam_puzzle_leaderboards_v3', JSON.stringify(updatedLeaderboards));
    setUserName('');
    setLeaderboardTab(sizeKey);
    setActiveTab('leaderboard');
    setGameState('LOBBY');
    
    // Reset board
    const initialBoard = Array.from({ length: gridSize * gridSize }, (_, i) => i);
    setBoard(initialBoard);
  };

  // Timer Effect
  useEffect(() => {
    let interval = null;
    if (gameState === 'PLAYING') {
      interval = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState]);

  // Main Canvas and Hand Tracking Effect
  useEffect(() => {
    let cameraInstance = null;
    let handsInstance = null;

    // Helper to draw skeleton joints & bones
    const drawSkeleton = (ctx, landmarks, w, h, style) => {
      ctx.save();
      // Draw joints
      landmarks.forEach((lm, idx) => {
        const cx = (1 - lm.x) * w;
        const cy = lm.y * h;
        
        // Highlight thumb and index tips
        if (idx === 4 || idx === 8) {
          ctx.fillStyle = '#ff007f';
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#ff007f';
        } else {
          ctx.fillStyle = '#00f2fe';
          ctx.shadowBlur = 6;
          ctx.shadowColor = '#00f2fe';
        }
        
        ctx.beginPath();
        ctx.arc(cx, cy, idx === 4 || idx === 8 ? 6 : 4.5, 0, 2 * Math.PI);
        ctx.fill();
      });

      if (style === 'minimal') {
        ctx.restore();
        return;
      }

      // Draw bones
      const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [5, 9], [9, 10], [10, 11], [11, 12], // Middle
        [9, 13], [13, 14], [14, 15], [15, 16], // Ring
        [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [0, 17] // Palm base
      ];

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2.0;
      ctx.shadowBlur = 0;
      connections.forEach(([i, j]) => {
        const p1 = landmarks[i];
        const p2 = landmarks[j];
        ctx.beginPath();
        ctx.moveTo((1 - p1.x) * w, p1.y * h);
        ctx.lineTo((1 - p2.x) * w, p2.y * h);
        ctx.stroke();
      });
      ctx.restore();
    };

    // Animation Loop
    const animate = () => {
      const video = videoRef.current;
      const previewCanvas = previewCanvasRef.current;
      const puzzleCanvas = puzzleCanvasRef.current;

      if (!video || !previewCanvas || !puzzleCanvas) {
        animationFrameId.current = requestAnimationFrame(animate);
        return;
      }

      if (video.readyState < 2) {
        animationFrameId.current = requestAnimationFrame(animate);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      // Adjust canvas resolution dynamically
      if (previewCanvas.width !== 400) {
        previewCanvas.width = 400;
        previewCanvas.height = 300;
      }
      if (puzzleCanvas.width !== 500) {
        puzzleCanvas.width = 500;
        puzzleCanvas.height = 500;
      }

      const pCtx = previewCanvas.getContext('2d');
      const puzzleCtx = puzzleCanvas.getContext('2d');

      // Create offscreen canvas if missing
      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
      }
      const offscreen = offscreenCanvasRef.current;
      if (offscreen.width !== vw || offscreen.height !== vh) {
        offscreen.width = vw;
        offscreen.height = vh;
      }
      const offCtx = offscreen.getContext('2d');

      // Mirror video onto offscreen canvas
      offCtx.save();
      offCtx.translate(vw, 0);
      offCtx.scale(-1, 1);
      offCtx.drawImage(video, 0, 0, vw, vh);
      offCtx.restore();

      // Render mirrored video to hand preview card
      pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      pCtx.drawImage(offscreen, 0, 0, previewCanvas.width, previewCanvas.height);

      // Render puzzle tiles
      puzzleCtx.clearRect(0, 0, puzzleCanvas.width, puzzleCanvas.height);
      const currentBoard = boardRef.current;
      const size = gridSizeRef.current;
      const tileW = puzzleCanvas.width / size;
      const tileH = puzzleCanvas.height / size;
      const blankVal = size * size - 1;

      for (let idx = 0; idx < size * size; idx++) {
        const tileValue = currentBoard[idx];
        const destX = (idx % size) * tileW;
        const destY = Math.floor(idx / size) * tileH;

        if (tileValue === blankVal) {
          // Empty slot (Vaporwave dark background)
          puzzleCtx.fillStyle = '#06060c';
          puzzleCtx.fillRect(destX, destY, tileW, tileH);
          puzzleCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
          puzzleCtx.lineWidth = 1;
          puzzleCtx.strokeRect(destX + 4, destY + 4, tileW - 8, tileH - 8);
        } else {
          // Sliced section from webcam OR static loaded image
          if (imageSourceRef.current === 'webcam' || !loadedImageRef.current) {
            const srcW = vw / size;
            const srcH = vh / size;
            const srcX = (tileValue % size) * srcW;
            const srcY = Math.floor(tileValue / size) * srcH;

            puzzleCtx.drawImage(
              offscreen,
              srcX, srcY, srcW, srcH,
              destX, destY, tileW, tileH
            );
          } else {
            const img = loadedImageRef.current;
            const srcW = img.naturalWidth / size;
            const srcH = img.naturalHeight / size;
            const srcX = (tileValue % size) * srcW;
            const srcY = Math.floor(tileValue / size) * srcH;

            puzzleCtx.drawImage(
              img,
              srcX, srcY, srcW, srcH,
              destX, destY, tileW, tileH
            );
          }

          // Tile neon boundaries
          puzzleCtx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
          puzzleCtx.lineWidth = 2.0;
          puzzleCtx.strokeRect(destX, destY, tileW, tileH);

          // Tile guides
          puzzleCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          puzzleCtx.fillRect(destX + 5, destY + 5, 22, 22);
          puzzleCtx.fillStyle = '#00f2fe';
          puzzleCtx.font = 'bold 11px "JetBrains Mono", monospace';
          puzzleCtx.textAlign = 'center';
          puzzleCtx.textBaseline = 'middle';
          puzzleCtx.fillText(String(tileValue + 1), destX + 16, destY + 16);

          // Ghost Hint overlay
          if (hintModeRef.current) {
            puzzleCtx.save();
            puzzleCtx.fillStyle = 'rgba(157, 78, 221, 0.3)';
            puzzleCtx.fillRect(destX, destY, tileW, tileH);
            puzzleCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            puzzleCtx.font = 'bold 20px "JetBrains Mono", monospace';
            puzzleCtx.textAlign = 'center';
            puzzleCtx.textBaseline = 'middle';
            puzzleCtx.fillText(String(idx + 1), destX + tileW / 2, destY + tileH / 2);
            puzzleCtx.restore();
          }
        }
      }

      // Outer puzzle boundary decoration
      puzzleCtx.strokeStyle = gameStateRef.current === 'PLAYING' ? '#9d4edd' : gameStateRef.current === 'COMPLETED' ? '#ff007f' : '#00f2fe';
      puzzleCtx.lineWidth = 4;
      puzzleCtx.strokeRect(0, 0, puzzleCanvas.width, puzzleCanvas.height);

      // Process Hand Landmarks
      const landmarks = latestLandmarksRef.current;
      if (landmarks) {
        setHandDetected(true);
        if (landmarkStyleRef.current !== 'hidden') {
          drawSkeleton(pCtx, landmarks, previewCanvas.width, previewCanvas.height, landmarkStyleRef.current);
        }

        const thumb = landmarks[4];
        const index = landmarks[8];

        // Euclidean 2D distance between Index and Thumb tips
        const dx = thumb.x - index.x;
        const dy = thumb.y - index.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Mirrored coordinates for grid cursor positioning
        const midX = 1 - (thumb.x + index.x) / 2;
        const midY = (thumb.y + index.y) / 2;

        const cursorX = midX * puzzleCanvas.width;
        const cursorY = midY * puzzleCanvas.height;

        const now = Date.now();
        const pinchThresh = pinchThresholdRef.current;
        const releaseThresh = pinchThresh + 0.025; // Deadzone threshold
        const isPinchingNow = distance < pinchThresh;

        let activePinch = hasPinchedRef.current;

        if (activePinch) {
          if (distance > releaseThresh) {
            hasPinchedRef.current = false;
            activePinch = false;
            playSound('release');
          }
        } else {
          if (isPinchingNow && (now - lastSwapTimeRef.current > 750)) {
            hasPinchedRef.current = true;
            activePinch = true;
            lastSwapTimeRef.current = now;
            playSound('pinch');

            // Trigger grid action
            const col = Math.floor(midX * size);
            const row = Math.floor(midY * size);
            if (col >= 0 && col < size && row >= 0 && row < size) {
              handleSwap(row * size + col);
            }
          }
        }

        setIsPinching(activePinch);

        // Direct DOM update of calibration HUD for zero React overhead
        if (hudBarRef.current && hudDistLabelRef.current) {
          const distPct = Math.min(100, Math.max(0, (1 - distance / 0.15) * 100));
          hudBarRef.current.style.width = `${distPct}%`;
          hudDistLabelRef.current.innerText = `Dist: ${(distance * 100).toFixed(1)}%`;
          if (activePinch) {
            hudBarRef.current.classList.add('pinched');
          } else {
            hudBarRef.current.classList.remove('pinched');
          }
        }

        // Draw Interactive cursor & trailing trail
        if (!disableVFXRef.current) {
          cursorTrailRef.current.push({ x: cursorX, y: cursorY, alpha: 1.0 });
          if (cursorTrailRef.current.length > 12) {
            cursorTrailRef.current.shift();
          }
        }

        if (cursorTrailRef.current.length > 0 && !disableVFXRef.current) {
          puzzleCtx.save();
          puzzleCtx.shadowBlur = 10;
          puzzleCtx.shadowColor = activePinch ? '#ff007f' : '#00f2fe';
          puzzleCtx.beginPath();
          for (let i = 0; i < cursorTrailRef.current.length; i++) {
            const pt = cursorTrailRef.current[i];
            if (i === 0) {
              puzzleCtx.moveTo(pt.x, pt.y);
            } else {
              puzzleCtx.lineTo(pt.x, pt.y);
            }
            pt.alpha -= 0.08;
          }
          puzzleCtx.strokeStyle = activePinch ? 'rgba(255, 0, 127, 0.4)' : 'rgba(0, 242, 254, 0.4)';
          puzzleCtx.lineWidth = 4;
          puzzleCtx.stroke();
          cursorTrailRef.current = cursorTrailRef.current.filter(p => p.alpha > 0);
          puzzleCtx.restore();
        }

        puzzleCtx.save();
        puzzleCtx.shadowBlur = 15;
        if (activePinch) {
          puzzleCtx.shadowColor = '#ff007f';
          puzzleCtx.fillStyle = '#ff007f';
          puzzleCtx.strokeStyle = '#ffffff';
          puzzleCtx.lineWidth = 3;
          const radius = 13 + Math.sin(now / 50) * 3;
          puzzleCtx.beginPath();
          puzzleCtx.arc(cursorX, cursorY, radius, 0, 2 * Math.PI);
          puzzleCtx.fill();
          puzzleCtx.stroke();
        } else {
          puzzleCtx.shadowColor = '#00f2fe';
          puzzleCtx.fillStyle = 'rgba(0, 242, 254, 0.75)';
          puzzleCtx.strokeStyle = '#ffffff';
          puzzleCtx.lineWidth = 2.5;
          puzzleCtx.beginPath();
          puzzleCtx.arc(cursorX, cursorY, 9, 0, 2 * Math.PI);
          puzzleCtx.fill();
          puzzleCtx.stroke();
        }
        puzzleCtx.restore();

        // Draw distance line in preview
        pCtx.save();
        pCtx.strokeStyle = activePinch ? '#ff007f' : '#00f2fe';
        pCtx.lineWidth = 2.5;
        pCtx.beginPath();
        pCtx.moveTo((1 - thumb.x) * previewCanvas.width, thumb.y * previewCanvas.height);
        pCtx.lineTo((1 - index.x) * previewCanvas.width, index.y * previewCanvas.height);
        pCtx.stroke();
        pCtx.restore();

      } else {
        setHandDetected(false);
        setIsPinching(false);
        if (hudBarRef.current && hudDistLabelRef.current) {
          hudBarRef.current.style.width = '0%';
          hudDistLabelRef.current.innerText = 'Dist: ---';
          hudBarRef.current.classList.remove('pinched');
        }
      }

      // Draw canvas VFX particles
      if (particlesRef.current.length > 0 && !disableVFXRef.current) {
        particlesRef.current.forEach((p) => {
          puzzleCtx.save();
          puzzleCtx.globalAlpha = p.alpha;
          puzzleCtx.fillStyle = p.color;
          puzzleCtx.shadowBlur = p.size * 1.5;
          puzzleCtx.shadowColor = p.color;
          
          puzzleCtx.beginPath();
          puzzleCtx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
          puzzleCtx.fill();
          puzzleCtx.restore();

          // update particle kinematics
          p.x += p.vx;
          p.y += p.vy;
          p.life--;
          p.alpha = Math.max(0, p.life / p.maxLife);
        });
        // cleanup dead particles
        particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      }

      animationFrameId.current = requestAnimationFrame(animate);
    };

    const initTracking = async () => {
      try {
        if (!window.Hands || !window.Camera) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!window.Hands || !window.Camera) {
            throw new Error('MediaPipe script tags not loaded or timed out.');
          }
        }

        const video = videoRef.current;
        if (!video) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          },
          audio: false
        });

        video.srcObject = stream;
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        await video.play();

        handsInstance = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        handsInstance.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6
        });

        handsInstance.onResults((results) => {
          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            latestLandmarksRef.current = results.multiHandLandmarks[0];
          } else {
            latestLandmarksRef.current = null;
          }
        });

        cameraInstance = new window.Camera(video, {
          onFrame: async () => {
            if (handsInstance) {
              await handsInstance.send({ image: video });
            }
          },
          width: 640,
          height: 480
        });

        cameraInstance.start();
        setWebcamReady(true);
        animationFrameId.current = requestAnimationFrame(animate);

      } catch (err) {
        console.error('Hand tracking setup failed:', err);
        setErrorMsg(err.message || 'Unable to access your webcam. Check permissions.');
      }
    };

    initTracking();

    const activeVideo = videoRef.current;
    return () => {
      if (cameraInstance) cameraInstance.stop();
      if (handsInstance) handsInstance.close();
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (activeVideo && activeVideo.srcObject) {
        activeVideo.srcObject.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-container">
      <header>
        <h1>AeroPinch</h1>
        <p>Interactive Cyberpunk Gesture-Controlled Sliding Puzzle</p>
        <div className="status-indicator">
          <div className={`indicator-dot ${webcamReady ? 'active' : ''}`} />
          <span>{webcamReady ? 'Webcam Tracker Connected' : 'Webcam Offline'}</span>
        </div>
      </header>

      {errorMsg && (
        <div className="error-message">
          <strong>Hardware Notice:</strong> {errorMsg}
          <br />
          <small>You can still play the game using standard mouse clicks on the puzzle board!</small>
        </div>
      )}

      <div className="game-layout">
        {/* Left Column: Side Navigation Panels */}
        <div className="sidebar">
          <div className="sidebar-tabs">
            <button 
              className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              Control Panel
            </button>
            <button 
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('settings');
                initAudio(); // Initialize audio context on first click
              }}
            >
              Configuration
            </button>
            <button 
              className={`tab-btn ${activeTab === 'leaderboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('leaderboard')}
            >
              High Scores
            </button>
          </div>

          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <>
              <div className="panel neon-cyan">
                <h2>Hand Tracker Live</h2>
                <div className="canvas-wrapper">
                  <canvas ref={previewCanvasRef} className="preview-canvas" />
                </div>
                <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
                
                {/* Gesture Debug HUD directly integrated under tracker feed */}
                <div className="hud-container">
                  <div className="hud-header">
                    <span>Tracker Input Feed</span>
                    <span ref={hudDistLabelRef}>Dist: ---</span>
                  </div>
                  <div className="hud-bar-wrapper">
                    <div ref={hudBarRef} className="hud-bar" />
                    <div 
                      className="hud-marker" 
                      style={{ left: `${(1 - pinchThreshold / 0.15) * 100}%` }}
                    />
                    <div 
                      className="hud-marker-label"
                      style={{ left: `calc(${(1 - pinchThreshold / 0.15) * 100}% - 14px)` }}
                    >
                      Pinch
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel neon-pink">
                <h2>Dashboard</h2>
                <div className="status-dashboard">
                  <div className="stat-card">
                    <div className="stat-label">Moves Made</div>
                    <div className="stat-value cyan">{moves}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Time Elapsed</div>
                    <div className="stat-value pink">{formatTime(timer)}</div>
                  </div>
                </div>

                <div className="badge-row">
                  <div className={`badge ${handDetected ? 'success' : ''}`}>
                    {handDetected ? 'Hand Tracked' : 'No Signal'}
                  </div>
                  <div className={`badge ${isPinching ? 'danger' : ''}`}>
                    {isPinching ? 'Pinching' : 'Open Hand'}
                  </div>
                </div>

                <div className="btn-group">
                  {gameState === 'LOBBY' ? (
                    <button className="btn" onClick={handleStartGame}>
                      Shuffle & Play
                    </button>
                  ) : (
                    <button className="btn btn-pink" onClick={handleResetGame}>
                      Reset Grid
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* TAB 2: CONFIGURATION */}
          {activeTab === 'settings' && (
            <div className="panel neon-cyan">
              <h2>Options</h2>
              
              <div className="form-group">
                <label>Difficulty Grid Size</label>
                <div className="difficulty-selector">
                  <button 
                    className={`diff-btn ${gridSize === 3 ? 'active' : ''}`}
                    onClick={() => setGridSize(3)}
                    disabled={gameState !== 'LOBBY'}
                  >
                    3x3 (Easy)
                  </button>
                  <button 
                    className={`diff-btn ${gridSize === 4 ? 'active' : ''}`}
                    onClick={() => setGridSize(4)}
                    disabled={gameState !== 'LOBBY'}
                  >
                    4x4 (Med)
                  </button>
                  <button 
                    className={`diff-btn ${gridSize === 5 ? 'active' : ''}`}
                    onClick={() => setGridSize(5)}
                    disabled={gameState !== 'LOBBY'}
                  >
                    5x5 (Hard)
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Puzzle Image Input</label>
                <div className="preset-grid">
                  <div 
                    className={`preset-card ${imageSource === 'webcam' ? 'active' : ''}`}
                    onClick={() => setImageSource('webcam')}
                  >
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0e0f18', color: '#00f2fe', fontSize: '1.5rem' }}>📷</div>
                    <div className="preset-label">Webcam Live</div>
                  </div>
                  <div 
                    className={`preset-card ${imageSource === 'cyberpunk_city' ? 'active' : ''}`}
                    onClick={() => setImageSource('cyberpunk_city')}
                  >
                    <img src={presetImages.cyberpunk_city} alt="Cyberpunk Preset" />
                    <div className="preset-label">Cyberpunk</div>
                  </div>
                  <div 
                    className={`preset-card ${imageSource === 'space_nebula' ? 'active' : ''}`}
                    onClick={() => setImageSource('space_nebula')}
                  >
                    <img src={presetImages.space_nebula} alt="Nebula Preset" />
                    <div className="preset-label">Nebula</div>
                  </div>
                  <div 
                    className={`preset-card ${imageSource === 'retro_arcade' ? 'active' : ''}`}
                    onClick={() => setImageSource('retro_arcade')}
                  >
                    <img src={presetImages.retro_arcade} alt="Arcade Preset" />
                    <div className="preset-label">Retro Room</div>
                  </div>
                </div>

                {/* Drag-and-drop / Custom file uploader */}
                {!customImageName ? (
                  <div className="upload-zone" onClick={() => document.getElementById('custom-img-upload').click()}>
                    <span className="upload-icon">📁</span>
                    <div className="upload-text">
                      <strong>Upload Custom Image</strong>
                      <br />Drag & drop or browse
                    </div>
                    <input 
                      id="custom-img-upload" 
                      type="file" 
                      accept="image/*" 
                      style={{ display: 'none' }} 
                      onChange={handleFileUpload} 
                    />
                  </div>
                ) : (
                  <div className="uploaded-preview">
                    <span>🖼️ {customImageName.slice(0, 18)}...</span>
                    <button className="remove-upload-btn" onClick={removeUploadedImage}>Remove</button>
                  </div>
                )}
              </div>

              <div className="form-group" style={{ marginTop: '1.5rem' }}>
                <label>Calibration Adjustments</label>
                <div className="slider-container">
                  <div className="slider-header">
                    <span>Pinch Threshold</span>
                    <span className="slider-val">{(pinchThreshold * 100).toFixed(1)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.02" 
                    max="0.10" 
                    step="0.005"
                    className="cyber-slider"
                    value={pinchThreshold}
                    onChange={(e) => setPinchThreshold(parseFloat(e.target.value))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Gameplay Features</label>
                <div className="toggle-row">
                  <span className="toggle-label">Enable SFX Audio</span>
                  <label className="toggle-switch">
                    <input 
                      type="checkbox" 
                      checked={!muteSound} 
                      onChange={(e) => setMuteSound(!e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="toggle-row">
                  <span className="toggle-label">Render Glow VFX</span>
                  <label className="toggle-switch">
                    <input 
                      type="checkbox" 
                      checked={!disableVFX} 
                      onChange={(e) => setDisableVFX(!e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label>Skeleton Overlay Style</label>
                <div className="difficulty-selector">
                  <button 
                    className={`diff-btn ${landmarkStyle === 'neon' ? 'active' : ''}`}
                    onClick={() => setLandmarkStyle('neon')}
                  >
                    Neon
                  </button>
                  <button 
                    className={`diff-btn ${landmarkStyle === 'minimal' ? 'active' : ''}`}
                    onClick={() => setLandmarkStyle('minimal')}
                  >
                    Minimal
                  </button>
                  <button 
                    className={`diff-btn ${landmarkStyle === 'hidden' ? 'active' : ''}`}
                    onClick={() => setLandmarkStyle('hidden')}
                  >
                    Hidden
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LEADERBOARD */}
          {activeTab === 'leaderboard' && (
            <div className="panel neon-pink">
              <h2>Leaderboard</h2>
              <div className="leaderboard-tabs">
                <button 
                  className={`leaderboard-tab-btn ${leaderboardTab === 3 ? 'active' : ''}`}
                  onClick={() => setLeaderboardTab(3)}
                >
                  3x3 Easy
                </button>
                <button 
                  className={`leaderboard-tab-btn ${leaderboardTab === 4 ? 'active' : ''}`}
                  onClick={() => setLeaderboardTab(4)}
                >
                  4x4 Med
                </button>
                <button 
                  className={`leaderboard-tab-btn ${leaderboardTab === 5 ? 'active' : ''}`}
                  onClick={() => setLeaderboardTab(5)}
                >
                  5x5 Hard
                </button>
              </div>

              {leaderboards[leaderboardTab].length === 0 ? (
                <div className="no-records">No scores logged yet for {leaderboardTab}x{leaderboardTab}.</div>
              ) : (
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th style={{ width: '15%' }}>Rank</th>
                      <th>Player</th>
                      <th>Moves</th>
                      <th>Time</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboards[leaderboardTab].map((entry, index) => (
                      <tr key={index}>
                        <td>
                          <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{entry.name}</td>
                        <td>{entry.moves}</td>
                        <td>{formatTime(entry.time)}</td>
                        <td>{entry.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* How to Play Card - Static details */}
          <div className="panel neon-cyan">
            <h2>Instructions</h2>
            <ul className="instructions-list">
              <li>Position your hand clearly in front of the camera (about 1.5 - 3 feet away).</li>
              <li>Pinch your <strong>Thumb & Index finger</strong> together to select/grab a tile.</li>
              <li>Release and separate your fingers to finish the move before making another.</li>
              <li>Slide tiles adjacent to the empty grid slot to sort numbers 1 to {gridSize * gridSize - 1}.</li>
              <li><em>Click tiles with your mouse/touchscreen as a fallback at any time.</em></li>
            </ul>
          </div>
        </div>

        {/* Right Column: Sliding Puzzle Canvas Area */}
        <div className="puzzle-area">
          <div className="panel neon-cyan board-container-card">
            <h2>Sliding Puzzle Board</h2>
            <div className={`puzzle-canvas-wrapper ${gameState === 'PLAYING' ? 'playing' : gameState === 'COMPLETED' ? 'completed' : ''}`}>
              <canvas 
                ref={puzzleCanvasRef} 
                className="puzzle-canvas" 
                onClick={handleCanvasClick}
              />
            </div>

            {/* Quick controls row beneath Board */}
            <div className="board-quick-controls">
              <button 
                className={`quick-btn ${hintMode ? 'active' : ''}`}
                onClick={() => setHintMode(!hintMode)}
                disabled={gameState !== 'PLAYING'}
              >
                {hintMode ? 'Hide Guides' : 'Show Guides (Hint)'}
              </button>
              <button 
                className="quick-btn"
                onClick={handleResetGame}
                disabled={gameState === 'LOBBY'}
              >
                Reset Board
              </button>
            </div>
          </div>

          <div className="info-row">
            <span className="info-icon">⚡</span>
            <span>Accessibility: Direct board mouse-clicking is enabled as fallback</span>
          </div>
        </div>
      </div>

      {/* Completion Modal Overlay */}
      {gameState === 'COMPLETED' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>System Calibrated!</h2>
            <p>Puzzle Solved successfully. Your gestures are fully registered.</p>
            
            <div className="final-stats">
              <div>
                <div className="stat-label">Moves</div>
                <div className="final-stat-val">{moves}</div>
              </div>
              <div>
                <div className="stat-label">Time</div>
                <div className="final-stat-val">{formatTime(timer)}</div>
              </div>
              <div>
                <div className="stat-label">Grid</div>
                <div className="final-stat-val">{gridSize}x{gridSize}</div>
              </div>
            </div>

            <form onSubmit={saveScore} className="modal-form">
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Save score for {gridSize}x{gridSize} Leaderboard:
              </label>
              <input
                type="text"
                className="modal-input"
                placeholder="Enter Cyber Name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
                maxLength={12}
                autoFocus
              />
              <button type="submit" className="btn btn-pink">
                Submit Record
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
