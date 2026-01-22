// Real-time Chess Game
const API_URL = window.location.origin;
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user'));

if (!token || !user) {
  window.location.href = '/';
}

// Get game ID from URL
const gameId = window.location.pathname.split('/').pop();

// Socket.io connection
const socket = io(API_URL, {
  auth: { token }
});

// Chess.js instance for game logic
const chess = new Chess();

// Game state
let myColor = null;
let opponentName = null;
let gameActive = false;
let myTimeMs = 0;
let opponentTimeMs = 0;
let timerInterval = null;
let lastMoveTime = Date.now();

// Set user info
document.getElementById('userName').textContent = `${user.firstName} ${user.lastName}`;
document.getElementById('myName').textContent = `${user.firstName} ${user.lastName}`;

// Back button
document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/student';
});

// Initialize chessboard
const board = Chessboard('chessboard', {
  draggable: true,
  position: 'start',
  onDragStart: onDragStart,
  onDrop: onDrop,
  onSnapEnd: onSnapEnd
});

// Load game data
async function loadGameData() {
  try {
    const response = await fetch(`${API_URL}/api/game/${gameId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      myColor = data.game.myColor;
      opponentName = myColor === 'white' ? data.game.black_player_name : data.game.white_player_name;
      myTimeMs = myColor === 'white' ? data.game.white_time_remaining : data.game.black_time_remaining;
      opponentTimeMs = myColor === 'white' ? data.game.black_time_remaining : data.game.white_time_remaining;

      // Set opponent info
      document.getElementById('opponentName').textContent = opponentName;
      document.getElementById('opponentElo').textContent = `ELO: ${myColor === 'white' ? data.game.black_elo : data.game.white_elo}`;
      document.getElementById('myElo').textContent = `ELO: ${myColor === 'white' ? data.game.white_elo : data.game.black_elo}`;

      // Set game title
      document.getElementById('gameTitle').textContent = data.game.tournament_name || 'Chess Game';

      // Load moves
      if (data.moves && data.moves.length > 0) {
        data.moves.forEach(move => {
          chess.move(move.move_san);
        });
      }

      // Update board
      board.position(chess.fen());

      // Flip board if playing black
      if (myColor === 'black') {
        board.flip();
      }

      // Check if game is still active
      if (data.game.result === 'ongoing') {
        gameActive = true;
        updateStatus();
        startTimer();
      } else {
        gameActive = false;
        showGameResult(data.game.result);
      }
    } else {
      alert('Failed to load game');
      window.location.href = '/student';
    }
  } catch (error) {
    console.error('Error loading game:', error);
    alert('Error loading game');
  }
}

// Join game via Socket.io
socket.emit('join-game', gameId);

// Socket.io event handlers
socket.on('game-state', (data) => {
  console.log('Game state received:', data);
});

socket.on('player-joined', (data) => {
  console.log('Player joined:', data);
  updateStatus();
});

socket.on('move-made', (data) => {
  // Update chess instance
  chess.move(data.move);

  // Update board
  board.position(chess.fen());

  // Update move history
  updateMoveHistory();

  // Update opponent's time
  if (data.playerId !== user.id) {
    opponentTimeMs = data.timeRemaining;
  }

  // Reset move timer
  lastMoveTime = Date.now();

  // Update status
  updateStatus();

  // Check for game end
  if (chess.game_over()) {
    handleGameOver();
  }
});

socket.on('game-ended', (data) => {
  gameActive = false;
  stopTimer();
  showGameResult(data.result);
});

socket.on('player-disconnected', (data) => {
  console.log('Player disconnected:', data);
  updateStatus();
});

socket.on('error', (data) => {
  console.error('Socket error:', data);
  alert(data.message);
});

// Drag and drop handlers
function onDragStart(source, piece, position, orientation) {
  // Don't allow moves if game is over
  if (!gameActive) return false;

  // Don't allow moves if it's not your turn
  if ((chess.turn() === 'w' && myColor === 'black') ||
      (chess.turn() === 'b' && myColor === 'white')) {
    return false;
  }

  // Only pick up pieces for the side to move
  if ((chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
      (chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
    return false;
  }
}

function onDrop(source, target) {
  const moveStartTime = Date.now();

  // See if the move is legal
  const move = chess.move({
    from: source,
    to: target,
    promotion: 'q' // Always promote to queen for simplicity
  });

  // Illegal move
  if (move === null) return 'snapback';

  // Calculate time taken
  const timeTaken = moveStartTime - lastMoveTime;
  lastMoveTime = moveStartTime;

  // Update my time
  myTimeMs -= timeTaken;

  // Update move history
  updateMoveHistory();

  // Send move to server via Socket.io
  socket.emit('make-move', {
    gameId: gameId,
    move: move,
    fen: chess.fen(),
    pgn: chess.pgn(),
    timeTaken: timeTaken,
    timeRemaining: myTimeMs
  });

  // Check for game end
  if (chess.game_over()) {
    handleGameOver();
  }
}

function onSnapEnd() {
  board.position(chess.fen());
}

// Update move history
function updateMoveHistory() {
  const moves = chess.history();
  const moveList = document.getElementById('moveList');

  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNumber = Math.floor(i / 2) + 1;
    const whiteMove = moves[i];
    const blackMove = moves[i + 1] || '';

    html += `<div>${moveNumber}. ${whiteMove} ${blackMove}</div>`;
  }

  moveList.innerHTML = html;

  // Scroll to bottom
  moveList.scrollTop = moveList.scrollHeight;
}

// Update status
function updateStatus() {
  let status = '';

  if (!gameActive) {
    status = 'Game Over';
  } else if (chess.in_checkmate()) {
    status = 'Checkmate!';
  } else if (chess.in_draw()) {
    status = 'Draw';
  } else if (chess.in_stalemate()) {
    status = 'Stalemate';
  } else if (chess.in_threefold_repetition()) {
    status = 'Draw (Threefold Repetition)';
  } else if (chess.insufficient_material()) {
    status = 'Draw (Insufficient Material)';
  } else if (chess.in_check()) {
    status = 'Check!';
  } else {
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const isMyTurn = (chess.turn() === 'w' && myColor === 'white') ||
                     (chess.turn() === 'b' && myColor === 'black');

    status = isMyTurn ? 'Your turn' : `${opponentName}'s turn`;
  }

  document.getElementById('gameStatus').textContent = status;
}

// Timer
function startTimer() {
  stopTimer();

  timerInterval = setInterval(() => {
    const isMyTurn = (chess.turn() === 'w' && myColor === 'white') ||
                     (chess.turn() === 'b' && myColor === 'black');

    if (isMyTurn && gameActive) {
      myTimeMs -= 1000;

      if (myTimeMs <= 0) {
        myTimeMs = 0;
        handleTimeout();
      }
    }

    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  document.getElementById('myTime').textContent = formatTime(myTimeMs);
  document.getElementById('opponentTime').textContent = formatTime(opponentTimeMs);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Handle timeout
function handleTimeout() {
  stopTimer();
  gameActive = false;

  const result = myColor === 'white' ? 'black_win' : 'white_win';

  socket.emit('end-game', {
    gameId: gameId,
    result: result,
    reason: 'timeout',
    pgn: chess.pgn()
  });

  showGameResult(result);
}

// Handle game over (checkmate, stalemate, etc.)
function handleGameOver() {
  stopTimer();
  gameActive = false;

  let result;

  if (chess.in_checkmate()) {
    // The side whose turn it is has been checkmated
    result = chess.turn() === 'w' ? 'black_win' : 'white_win';
  } else if (chess.in_draw() || chess.in_stalemate() ||
             chess.in_threefold_repetition() || chess.insufficient_material()) {
    result = 'draw';
  }

  socket.emit('end-game', {
    gameId: gameId,
    result: result,
    reason: chess.in_checkmate() ? 'checkmate' : 'draw',
    pgn: chess.pgn()
  });

  showGameResult(result);
}

// Show game result
function showGameResult(result) {
  const resultDiv = document.getElementById('gameResult');
  let message = '';
  let className = '';

  if (result === 'white_win') {
    if (myColor === 'white') {
      message = 'You Won!';
      className = 'won';
    } else {
      message = 'You Lost';
      className = 'lost';
    }
  } else if (result === 'black_win') {
    if (myColor === 'black') {
      message = 'You Won!';
      className = 'won';
    } else {
      message = 'You Lost';
      className = 'lost';
    }
  } else if (result === 'draw') {
    message = 'Draw';
    className = 'draw';
  }

  resultDiv.textContent = message;
  resultDiv.className = `game-result show ${className}`;

  // Disable controls
  document.getElementById('resignBtn').disabled = true;
  document.getElementById('offerDrawBtn').disabled = true;
}

// Resign button
document.getElementById('resignBtn').addEventListener('click', () => {
  if (!confirm('Are you sure you want to resign?')) {
    return;
  }

  stopTimer();
  gameActive = false;

  const result = myColor === 'white' ? 'black_win' : 'white_win';

  socket.emit('end-game', {
    gameId: gameId,
    result: result,
    reason: 'resignation',
    pgn: chess.pgn()
  });

  showGameResult(result);
});

// Offer draw button
document.getElementById('offerDrawBtn').addEventListener('click', () => {
  // TODO: Implement draw offer functionality
  alert('Draw offer feature coming soon!');
});

// Initialize
loadGameData();
updateTimerDisplay();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopTimer();
  socket.disconnect();
});
