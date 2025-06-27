// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Game state management
const gameState = {
  players: new Map(),
  rooms: new Map(),
  playerRooms: new Map(), // Maps playerId to roomId
};

// Yahtzee scoring categories
const CATEGORIES = {
  ones: { name: "Ones", type: "number", number: 1 },
  twos: { name: "Twos", type: "number", number: 2 },
  threes: { name: "Threes", type: "number", number: 3 },
  fours: { name: "Fours", type: "number", number: 4 },
  fives: { name: "Fives", type: "number", number: 5 },
  sixes: { name: "Sixes", type: "number", number: 6 },
  threeOfKind: { name: "Three of a Kind", type: "special" },
  fourOfKind: { name: "Four of a Kind", type: "special" },
  fullHouse: { name: "Full House", type: "special" },
  smallStraight: { name: "Small Straight", type: "special" },
  largeStraight: { name: "Large Straight", type: "special" },
  yahtzee: { name: "Yahtzee", type: "special" },
  chance: { name: "Chance", type: "special" },
};

// Middleware for static files
app.use(express.static("public"));

// Serve the Yahtzee game at the root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Yahtzee multiplayer server is running",
    timestamp: new Date().toISOString(),
    players: gameState.players.size,
    rooms: gameState.rooms.size,
  });
});

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log(`🎮 Player connected: ${socket.id}`);

  // Handle player registration
  socket.on("register_player", (data) => {
    const player = {
      id: socket.id,
      name: data.name,
      points: 0,
      socketId: socket.id,
    };

    gameState.players.set(socket.id, player);
    console.log(`👤 Player registered: ${player.name} (${socket.id})`);

    // Send current rooms list
    socket.emit("rooms_updated", Array.from(gameState.rooms.values()));
    socket.emit("player_registered", player);
  });

  // Handle room creation
  socket.on("create_room", (data) => {
    if (!gameState.players.has(socket.id)) {
      socket.emit("error", "Player not registered");
      return;
    }

    const roomId = "room_" + Date.now();
    const room = {
      id: roomId,
      name: data.roomName,
      players: [socket.id],
      maxPlayers: 4,
      gameStarted: false,
      gameData: null,
    };

    gameState.rooms.set(roomId, room);
    gameState.playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    console.log(
      `🏠 Room created: ${room.name} by ${
        gameState.players.get(socket.id).name
      }`
    );

    // Broadcast updated rooms list
    io.emit("rooms_updated", Array.from(gameState.rooms.values()));
    socket.emit("room_joined", room);
    updateRoomPlayers(roomId);
  });

  // Handle joining room
  socket.on("join_room", (data) => {
    if (!gameState.players.has(socket.id)) {
      socket.emit("error", "Player not registered");
      return;
    }

    const room = gameState.rooms.get(data.roomId);
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room is full");
      return;
    }

    if (room.gameStarted) {
      socket.emit("error", "Game already started");
      return;
    }

    // Leave current room if in one
    leaveCurrentRoom(socket.id);

    // Join new room
    room.players.push(socket.id);
    gameState.playerRooms.set(socket.id, data.roomId);
    socket.join(data.roomId);

    console.log(
      `🚪 ${gameState.players.get(socket.id).name} joined room: ${room.name}`
    );

    io.emit("rooms_updated", Array.from(gameState.rooms.values()));
    socket.emit("room_joined", room);
    updateRoomPlayers(data.roomId);
  });

  // Handle leaving room
  socket.on("leave_room", () => {
    leaveCurrentRoom(socket.id);
    socket.emit("left_room");
  });

  // Handle starting game
  socket.on("start_game", () => {
    const roomId = gameState.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room || room.players.length < 2) {
      socket.emit("error", "Need at least 2 players to start");
      return;
    }

    // Initialize game
    room.gameStarted = true;
    room.gameData = {
      players: room.players.map((playerId) => {
        const player = gameState.players.get(playerId);
        return {
          id: playerId,
          name: player.name,
          points: player.points,
          scores: {},
          totalScore: 0,
        };
      }),
      currentPlayerIndex: 0,
      dice: [1, 1, 1, 1, 1],
      selectedDice: [],
      rollsLeft: 3,
      gameOver: false,
    };

    // Initialize scores
    room.gameData.players.forEach((player) => {
      Object.keys(CATEGORIES).forEach((category) => {
        player.scores[category] = null;
      });
    });

    console.log(`🎮 Game started in room: ${room.name}`);
    io.to(roomId).emit("game_started", room.gameData);
    io.emit("rooms_updated", Array.from(gameState.rooms.values()));
  });

  // Handle dice roll
  socket.on("roll_dice", () => {
    const roomId = gameState.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const gameData = room.gameData;
    const currentPlayer = gameData.players[gameData.currentPlayerIndex];

    if (currentPlayer.id !== socket.id || gameData.rollsLeft <= 0) return;

    // Roll unselected dice
    for (let i = 0; i < 5; i++) {
      if (!gameData.selectedDice.includes(i)) {
        gameData.dice[i] = Math.floor(Math.random() * 6) + 1;
      }
    }

    gameData.rollsLeft--;

    io.to(roomId).emit("dice_rolled", {
      dice: gameData.dice,
      rollsLeft: gameData.rollsLeft,
    });
  });

  // Handle dice selection
  socket.on("select_dice", (data) => {
    const roomId = gameState.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const gameData = room.gameData;
    const currentPlayer = gameData.players[gameData.currentPlayerIndex];

    if (currentPlayer.id !== socket.id || gameData.rollsLeft === 3) return;

    const index = data.diceIndex;
    const selectedIndex = gameData.selectedDice.indexOf(index);

    if (selectedIndex > -1) {
      gameData.selectedDice.splice(selectedIndex, 1);
    } else {
      gameData.selectedDice.push(index);
    }

    io.to(roomId).emit("dice_selected", {
      selectedDice: gameData.selectedDice,
    });
  });

  // Handle extra roll purchase
  socket.on("buy_extra_roll", () => {
    const roomId = gameState.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const gameData = room.gameData;
    const currentPlayer = gameData.players[gameData.currentPlayerIndex];

    if (currentPlayer.id !== socket.id || currentPlayer.points < 5) return;

    currentPlayer.points -= 5;
    gameData.rollsLeft = 1;
    gameData.selectedDice = [];

    // Update player points in main state
    gameState.players.get(socket.id).points = currentPlayer.points;

    io.to(roomId).emit("extra_roll_bought", {
      rollsLeft: gameData.rollsLeft,
      selectedDice: gameData.selectedDice,
      playerPoints: currentPlayer.points,
    });
  });

  // Handle scoring
  socket.on("score_category", (data) => {
    const roomId = gameState.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const gameData = room.gameData;
    const currentPlayer = gameData.players[gameData.currentPlayerIndex];

    if (currentPlayer.id !== socket.id) return;

    const category = data.category;
    if (currentPlayer.scores[category] !== null) return;

    const score = calculateScore(category, gameData.dice);
    currentPlayer.scores[category] = score;

    // Award points
    if (score > 0) {
      currentPlayer.points += Math.floor(score / 10);
      gameState.players.get(socket.id).points = currentPlayer.points;
    }

    // Check if game is over
    const allCategoriesScored = gameData.players.every((player) =>
      Object.values(player.scores).every((score) => score !== null)
    );

    if (allCategoriesScored) {
      endGame(roomId);
    } else {
      nextTurn(roomId);
    }
  });

  // Handle forced end turn
  socket.on("end_turn", () => {
    const roomId = gameState.playerRooms.get(socket.id);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const gameData = room.gameData;
    const currentPlayer = gameData.players[gameData.currentPlayerIndex];

    if (currentPlayer.id !== socket.id) return;

    // Force score 0 in first available category
    const availableCategories = Object.keys(CATEGORIES).filter(
      (cat) => currentPlayer.scores[cat] === null
    );

    if (availableCategories.length > 0) {
      currentPlayer.scores[availableCategories[0]] = 0;
      nextTurn(roomId);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`👋 Player disconnected: ${socket.id}`);

    leaveCurrentRoom(socket.id);
    gameState.players.delete(socket.id);
    gameState.playerRooms.delete(socket.id);
  });

  // Helper functions
  function leaveCurrentRoom(playerId) {
    const roomId = gameState.playerRooms.get(playerId);
    if (!roomId) return;

    const room = gameState.rooms.get(roomId);
    if (!room) return;

    // Remove player from room
    room.players = room.players.filter((id) => id !== playerId);
    socket.leave(roomId);
    gameState.playerRooms.delete(playerId);

    // Delete room if empty
    if (room.players.length === 0) {
      gameState.rooms.delete(roomId);
      console.log(`🗑️ Room deleted: ${room.name}`);
    } else {
      updateRoomPlayers(roomId);
    }

    io.emit("rooms_updated", Array.from(gameState.rooms.values()));
  }

  function updateRoomPlayers(roomId) {
    const room = gameState.rooms.get(roomId);
    if (!room) return;

    const playersData = room.players.map((playerId) =>
      gameState.players.get(playerId)
    );
    io.to(roomId).emit("room_players_updated", playersData);
  }

  function nextTurn(roomId) {
    const room = gameState.rooms.get(roomId);
    const gameData = room.gameData;

    // Next player
    gameData.currentPlayerIndex =
      (gameData.currentPlayerIndex + 1) % gameData.players.length;

    // Reset turn
    gameData.rollsLeft = 3;
    gameData.selectedDice = [];
    gameData.dice = [1, 1, 1, 1, 1];

    io.to(roomId).emit("turn_changed", {
      currentPlayerIndex: gameData.currentPlayerIndex,
      rollsLeft: gameData.rollsLeft,
      selectedDice: gameData.selectedDice,
      dice: gameData.dice,
      scores: gameData.players.map((p) => ({ id: p.id, scores: p.scores })),
    });
  }

  function endGame(roomId) {
    const room = gameState.rooms.get(roomId);
    const gameData = room.gameData;

    // Calculate final scores
    gameData.players.forEach((player) => {
      player.totalScore = Object.values(player.scores).reduce(
        (sum, score) => sum + (score || 0),
        0
      );
    });

    // Sort by score
    const sortedPlayers = [...gameData.players].sort(
      (a, b) => b.totalScore - a.totalScore
    );

    gameData.gameOver = true;
    room.gameStarted = false;

    io.to(roomId).emit("game_over", {
      winner: sortedPlayers[0],
      finalScores: sortedPlayers,
    });

    console.log(
      `🏆 Game ended in room: ${room.name}. Winner: ${sortedPlayers[0].name}`
    );
  }
});

// Scoring calculation function
function calculateScore(category, dice) {
  const counts = {};
  dice.forEach((die) => {
    counts[die] = (counts[die] || 0) + 1;
  });

  const cat = CATEGORIES[category];

  if (cat.type === "number") {
    return (counts[cat.number] || 0) * cat.number;
  }

  switch (category) {
    case "threeOfKind":
      return Object.values(counts).some((count) => count >= 3)
        ? dice.reduce((a, b) => a + b)
        : 0;
    case "fourOfKind":
      return Object.values(counts).some((count) => count >= 4)
        ? dice.reduce((a, b) => a + b)
        : 0;
    case "fullHouse":
      const values = Object.values(counts).sort();
      return values.length === 2 && values[0] === 2 && values[1] === 3 ? 25 : 0;
    case "smallStraight":
      const sortedDice = [...new Set(dice)].sort();
      const straights = [
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [3, 4, 5, 6],
      ];
      return straights.some((straight) =>
        straight.every((num) => sortedDice.includes(num))
      )
        ? 30
        : 0;
    case "largeStraight":
      const sortedUnique = [...new Set(dice)].sort();
      return sortedUnique.length === 5 &&
        (sortedUnique.join("") === "12345" || sortedUnique.join("") === "23456")
        ? 40
        : 0;
    case "yahtzee":
      return Object.values(counts).some((count) => count === 5) ? 50 : 0;
    case "chance":
      return dice.reduce((a, b) => a + b);
    default:
      return 0;
  }
}

// Handle 404 errors
app.use((req, res) => {
  res.status(404).send(`
        <html>
            <head><title>404 - Not Found</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>404 - Page Not Found</h1>
                <p>The page you're looking for doesn't exist.</p>
                <a href="/" style="color: #667eea; text-decoration: none;">← Back to Yahtzee Game</a>
            </body>
        </html>
    `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  res.status(500).send(`
        <html>
            <head><title>500 - Server Error</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>500 - Internal Server Error</h1>
                <p>Something went wrong on our end.</p>
                <a href="/" style="color: #667eea; text-decoration: none;">← Back to Yahtzee Game</a>
            </body>
        </html>
    `);
});

// Start the server
server.listen(PORT, () => {
  console.log(`🎲 Yahtzee Multiplayer Server is running!`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌐 Network: http://0.0.0.0:${PORT}`);
  console.log(`⚡ Environment: ${process.env.NODE_ENV || "development"}`);

  // Check if index.html exists
  const indexPath = path.join(__dirname, "public", "index.html");
  if (!fs.existsSync(indexPath)) {
    console.log("⚠️  WARNING: index.html not found in public/ directory");
    console.log(
      "📁 Please make sure to place your updated index.html file in the public/ folder"
    );
  } else {
    console.log("✅ index.html found and ready to serve");
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("👋 Received SIGTERM, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("👋 Received SIGINT, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});
