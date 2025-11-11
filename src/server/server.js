/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const SAT = require('sat');

const gameLogic = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");
// --- ADD THIS BLOCK AT THE TOP ---
const { Connection, PublicKey } = require('@solana/web3.js');
const GAME_WALLET = 'DQUW5V4YgGgu8cbvC8sxb62azeJjfydKepXSpSCet1B2';
// Connect to Devnet (for testing)
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const playerBalances = {};
const socketWallets = {};
const processedTxs = new Set();


let map = new mapUtils.Map(config);

let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

app.use(express.static(__dirname + '/../client'));

io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);

    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }

    // --- Add this inside the same connection scope ---
    socket.on('depositRequest', async ({ wallet, txSig }) => {
        try {
            if (!wallet || !txSig) {
                socket.emit('serverMSG', 'Missing wallet or txSig.');
                return;
            }

            if (processedTxs.has(txSig)) {
                socket.emit('serverMSG', 'Transaction already processed.');
                socket.emit('depositConfirmed', { balance: playerBalances[wallet] || 0 });
                return;
            }

            const tx = await connection.getTransaction(txSig, { commitment: 'confirmed' });
            if (!tx) {
                socket.emit('serverMSG', 'Transaction not found or not confirmed yet.');
                return;
            }

            const keys = tx.transaction.message.accountKeys.map(k => k.toBase58());
            const gameIndex = keys.indexOf(GAME_WALLET);
            if (gameIndex === -1) {
                socket.emit('serverMSG', 'Transaction does not send to game wallet.');
                return;
            }

            const pre = tx.meta.preBalances[gameIndex];
            const post = tx.meta.postBalances[gameIndex];
            const receivedLamports = post - pre;
            if (receivedLamports <= 0) {
                socket.emit('serverMSG', 'No funds received by game wallet in that transaction.');
                return;
            }

            const receivedSOL = receivedLamports / 1e9;

            if (!playerBalances[wallet]) playerBalances[wallet] = 0;
            playerBalances[wallet] += receivedSOL;

            processedTxs.add(txSig);

            socket.emit('depositConfirmed', { balance: playerBalances[wallet] });

            console.log(`[DEPOSIT] Verified ${receivedSOL} SOL from ${wallet} (tx ${txSig}). New balance:`, playerBalances[wallet]);
        } catch (err) {
            console.error('Error verifying deposit:', err);
            socket.emit('serverMSG', 'Error verifying deposit: ' + err.message);
        }
    });
});


/* function generateSpawnpoint() {
    let radius = util.massToRadius(config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data)
} */
function generateSpawnpoint() {
    // Test mode: spawn everyone near the center (or random cluster)
    const clusterCenterX = config.gameWidth / 2;
    const clusterCenterY = config.gameHeight / 2;

    // Small random offset so they don’t spawn inside each other exactly
    const offset = 100; // smaller = closer together
    const x = clusterCenterX + (Math.random() * offset - offset / 2);
    const y = clusterCenterY + (Math.random() * offset - offset / 2);

    return { x, y };
}

const addPlayer = (socket) => {
    const currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    // === Wallet Connection ===
    socket.on('walletConnected', ({ wallet }) => {
    if (!wallet) return;

    socket.wallet = wallet;
    socketWallets[socket.id] = wallet;

    if (!playerBalances[wallet]) playerBalances[wallet] = 0;

    console.log(`[WALLET] Player ${socket.id} connected wallet: ${wallet}`);
});


    // === Deposit Request ===
    /* socket.on('depositRequest', ({ wallet, amount }) => {
    if (!wallet || amount < 1 || amount > 5) {
        socket.emit('serverMSG', 'Invalid deposit amount.');
        return;
    }

    if (!playerBalances[wallet]) playerBalances[wallet] = 0;

    playerBalances[wallet] += amount; // add deposit

    console.log(`[DEPOSIT] ${wallet} deposited $${amount}. New balance: ${playerBalances[wallet]}`);

    // Confirm to client
    socket.emit('depositConfirmed', { balance: playerBalances[wallet] });
}); */


    // === Player Join (gotit) ===
    socket.on('gotit', (clientPlayerData) => {
    console.log(`[INFO] Player ${clientPlayerData.name} connecting!`);
    currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);

    // Apply wallet balance if provided
    if (clientPlayerData.wallet) {
        socket.wallet = clientPlayerData.wallet; // store wallet on socket
        currentPlayer.walletAddress = clientPlayerData.wallet; // <--- assign it
        if (!playerBalances[socket.wallet]) playerBalances[socket.wallet] = 0;
        currentPlayer.balance = playerBalances[socket.wallet];
        console.log(`[INFO] Applied wallet balance ${currentPlayer.balance} for ${clientPlayerData.name}`);
    } else if (clientPlayerData.balance) {
        currentPlayer.balance = clientPlayerData.balance; // fallback from client
    } else {
        currentPlayer.balance = 0; // default
    }

    // Feed client data and add to map
    currentPlayer.clientProvidedData(clientPlayerData);
    map.players.pushNew(currentPlayer);

    io.emit('playerJoin', { 
        name: currentPlayer.name,
        balance: currentPlayer.balance
    });

    console.log(`I run ${currentPlayer.balance}`);
    console.log(`Total players: ${map.players.data.length}`);
});


    // === Other socket events with safe emit ===
    socket.on('pingcheck', () => socket.emit('pongcheck'));
    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    
    socket.on('respawn', () => {
    map.players.removePlayerByID(currentPlayer.id);
    currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);
    map.players.pushNew(currentPlayer);
    sockets[socket.id] = socket;
    socket.emit('welcome', currentPlayer, { width: config.gameWidth, height: config.gameHeight });
    console.log('[INFO] User ' + currentPlayer.name + ' has respawned');
    });

    socket.on('disconnect', () => {
    const wallet = socketWallets[socket.id];
    if (wallet) {
        console.log(`[INFO] Player with wallet ${wallet} disconnected.`);
        delete socketWallets[socket.id];
    }
});


    socket.on('playerChat', (data) => {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        if (config.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: currentPlayer.name,
            message: _message.substring(0, 35)
        });

        chatRepository.logChatMessage(_sender, _message, currentPlayer.ipAddress)
            .catch((err) => console.error("Error when attempting to log chat message", err));
    });

    socket.on('pass', async (data) => {
        const password = data[0];
        if (password === config.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.name + ' just logged in as an admin.');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.name);
            socket.broadcast.emit('serverMSG', currentPlayer.name + ' just logged in as an admin.');
            currentPlayer.admin = true;
        } else {
            console.log('[ADMIN] ' + currentPlayer.name + ' attempted to log in with the incorrect password: ' + password);

            socket.emit('serverMSG', 'Password incorrect, attempt logged.');

            loggingRepositry.logFailedLoginAttempt(currentPlayer.name, currentPlayer.ipAddress)
                .catch((err) => console.error("Error when attempting to log failed login attempt", err));
        }
    });

    socket.on('kick', (data) => {
        if (!currentPlayer.admin) {
            socket.emit('serverMSG', 'You are not permitted to use this command.');
            return;
        }

        var reason = '';
        var worked = false;
        for (let playerIndex in map.players.data) {
            let player = map.players.data[playerIndex];
            if (player.name === data[0] && !player.admin && !worked) {
                if (data.length > 1) {
                    for (var f = 1; f < data.length; f++) {
                        if (f === data.length) {
                            reason = reason + data[f];
                        }
                        else {
                            reason = reason + data[f] + ' ';
                        }
                    }
                }
                if (reason !== '') {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name + ' for reason ' + reason);
                }
                else {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name);
                }
                socket.emit('serverMSG', 'User ' + player.name + ' was kicked by ' + currentPlayer.name);
                sockets[player.id].emit('kick', reason);
                sockets[player.id].disconnect();
                map.players.removePlayerByIndex(playerIndex);
                worked = true;
            }
        }
        if (!worked) {
            socket.emit('serverMSG', 'Could not locate user or user is an admin.');
        }
    });

    // Heartbeat function, update everytime.
    socket.on('0', (target) => {
    currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });


    socket.on('1', function () {
        // Fire food.
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            if (currentPlayer.cells[i].mass >= minCellMass) {
                currentPlayer.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(currentPlayer, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        spectators.push(socket.id);
        io.emit('playerJoin', { name: '' });
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

const tickPlayer = (currentPlayer) => {
    if (currentPlayer.lastHeartbeat < new Date().getTime() - config.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit('kick', 'Last heartbeat received over ' + config.maxHeartbeatInterval + ' ago.');
        sockets[currentPlayer.id].disconnect();
    }

    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);

    const isEntityInsideCircle = (point, circle) => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell, cellCircle, cellIndex, mass) => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)
                return false;
            if (cell.mass > mass.mass * 1.1)
                return true;
        }

        return false;
    };

    const canEatVirus = (cell, cellCircle, virus) => {
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle)
    }

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];

        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes)
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (eatenFoodIndexes.length * config.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.limitSplit, config.defaultPlayerMass);
};

const tickGame = () => {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.gameWidth, config.gameHeight);

    map.players.handleCollisions(function (gotEaten, eater) {
    const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);

    const eaterPlayer = map.players.data[eater.playerIndex];
    const playerGotEaten = map.players.data[gotEaten.playerIndex];

    // Transfer mass to eater
    eaterPlayer.changeCellMass(eater.cellIndex, cellGotEaten.mass);

    // Transfer balance if exists
    if (playerGotEaten && playerGotEaten.balance) {
        eaterPlayer.balance = (eaterPlayer.balance || 0) + playerGotEaten.balance;
        playerGotEaten.balance = 0; // reset eaten player balance
        console.log("Player got eaten: ",playerGotEaten)
        console.log("Player that eat: ",eaterPlayer)
    }

    const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);

if (playerDied && playerGotEaten) {
    io.emit('playerDied', { playerEatenName: playerGotEaten.name });

    const sock = sockets[playerGotEaten.id];
    if (sock) sock.emit('RIP');

    // --- Minimal fix: reset only the eaten player's wallet balance ---
    if (playerGotEaten.walletAddress) {
        playerBalances[playerGotEaten.walletAddress] = 0;
    }

    // Remove player fully
    map.players.removePlayerByIndex(gotEaten.playerIndex);
}

});



};

const calculateLeaderboard = () => {
    const topPlayers = map.players.getTopPlayers().map(p => ({
        id: p.id,
        name: p.name,      // <- include name
        massTotal: p.massTotal
    }));

    if (leaderboard.length !== topPlayers.length) {
        leaderboard = topPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== topPlayers[i].id) {
                leaderboard = topPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
};

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};


const sendUpdates = () => {
    // Update spectators safely
    spectators.forEach(socketID => {
        const sock = sockets[socketID];
        if (sock) updateSpectator(socketID);
    });

    // Update players safely
    map.enumerateWhatPlayersSee((playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) => {
        const sock = sockets[playerData.id];
        if (sock) {  // Only emit if socket exists
            sock.emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses);
            if (leaderboardChanged) sendLeaderboard(sock);
        }
    });

    leaderboardChanged = false;
};

const sendLeaderboard = (socket) => {
    if (!socket) return; // safety check
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
};

const updateSpectator = (socketID) => {
    const sock = sockets[socketID];
    if (!sock) return; // Exit if socket is gone

    const playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };

    sock.emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data);
    if (leaderboardChanged) sendLeaderboard(sockets[socketID]);
};


setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));
