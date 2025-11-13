var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');

var playerNameInput = document.getElementById('playerNameInput');
var socket;

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    document.getElementById('startMenuWrapper').style.maxHeight = '0px';
    document.getElementById('gameAreaWrapper').style.opacity = 1;
    if (!socket) {
        socket = io({ query: "type=" + type });
        setupSocket(socket);
    }

    socket.emit('gotit', { 
    name: global.playerName, 
    balance: window.currentDeposit || 0,   // include deposit balance
    wallet: window.walletAddress || null,   // optional, if using wallet system
    displayBalance: 0
});
    
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;
}

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var regex = /^\w*$/;
    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null;
}

// At the top of your JS file (before window.onload)
window.socket = io({ query: "type=player" }); // or type="wallet" if you want a separate type
setupSocket(window.socket);


window.onload = function () {

    var btn = document.getElementById('startButton'),
        btnS = document.getElementById('spectateButton'),
        nickErrorText = document.querySelector('#startMenu .input-error');

    btnS.onclick = function () {
        startGame('spectator');
    };

    btn.onclick = function () {

        // Checks if the nick is valid.
        if (validNick()) {
            nickErrorText.style.opacity = 0;
            startGame('player');
        } else {
            nickErrorText.style.opacity = 1;
        }
    };

    var settingsMenu = document.getElementById('settingsButton');
    var settings = document.getElementById('settings');

    settingsMenu.onclick = function () {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
        } else {
            settings.style.maxHeight = '300px';
        }
    };

    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;

        if (key === global.KEY_ENTER) {
            if (validNick()) {
                nickErrorText.style.opacity = 0;
                startGame('player');
            } else {
                nickErrorText.style.opacity = 1;
            }
        }
    });
};

// TODO: Break out into GameControls.

var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

var player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var users = [];
var leaderboard = [];
var target = { x: player.x, y: player.y };
global.target = target;

window.canvas = new Canvas();
window.chat = new ChatClient();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = settings.toggleBorder;

var showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = settings.toggleMass;

var continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = settings.toggleContinuity;

var roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = settings.toggleRoundFood;

var c = window.canvas.cv;
var graph = c.getContext('2d');

$("#feed").click(function () {
    socket.emit('1');
    window.canvas.reenviar = false;
});

$("#split").click(function () {
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect() {
    if (window.socket) {
        window.socket.close();
    }
    if (!global.kicked) { 
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}
// socket stuff.
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    // Handle error.
    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    // Handle connection.
    socket.on('welcome', function (playerSettings, gameSizes) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        global.player = player;
        window.chat.player = player;
        // socket.emit('gotit', player);
        global.gameStart = true;
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
    });

    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        //const killer = isUnnamedCell(data.playerWhoAtePlayerName) ? 'An unnamed cell' : data.playerWhoAtePlayerName;

        //window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten by <b>' + (killer) + '</b>');
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        if (!users || !Array.isArray(users)) return
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id == player.id) {
                if (leaderboard[i].name.length !== 0)
                    status += '<span class="me">' + (i + 1) + '. ' + leaderboard[i].name + "</span>";
                else
                    status += '<span class="me">' + (i + 1) + ". An unnamed cell</span>";
            } else {
                if (leaderboard[i].name.length !== 0)
                    status += (i + 1) + '. ' + leaderboard[i].name;
                else
                    status += (i + 1) + '. An unnamed cell';
            }
        }
        //status += '<br />Players: ' + data.players;
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    // Chat.
    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    // Handle movement.
    socket.on('serverTellPlayerMove', function (playerData, userData, foodsList, massList, virusList) {
        console.log(userData);
        if (global.playerType == 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            player.cells = playerData.cells;
            player.balance = playerData.balance;
            player.displayBalance = playerData.displayBalance;
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
    });

    // Death.
    socket.on('RIP', function () {
    global.gameStart = false;
    render.drawErrorMessage('You died!', graph, global.screen);

    // --- Minimal reset of all player data ---
    window.currentDeposit = 0;
    window.walletAddress = null;
    global.player = null;
    global.playerName = ''; // reset name so startMenu doesn't reuse old data
    window.displayBalance = 0;

    const showBalance = document.getElementById('balanceStatus');
    if (showBalance) showBalance.innerText = `Balance: 0`;

    const walletStatus = document.getElementById('walletStatus');
    if (walletStatus) walletStatus.innerText = `Wallet: Not connected`;

    const startButton = document.getElementById('startButton');
    if (startButton) startButton.disabled = true;

    window.setTimeout(() => {
        document.getElementById('gameAreaWrapper').style.opacity = 0;
        document.getElementById('startMenuWrapper').style.maxHeight = '1000px';

        if (global.animLoopHandle) {
            window.cancelAnimationFrame(global.animLoopHandle);
            global.animLoopHandle = undefined;
        }
    }, 2500);
});


    socket.on('kick', function (reason) {
        global.gameStart = false;
        global.kicked = true;
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        }
        else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });
    socket.on('depositConfirmed', ({ balance }) => {
    console.log(`[CLIENT] Deposit confirmed! Balance: ${balance}`);
    window.hasDeposited = true;
    window.currentDeposit = balance; // store it globally
    player.displayBalance = window.currentDeposit > 0 ? 1 : 0;


    const walletStatus = document.getElementById('walletStatus');
    //if (walletStatus) walletStatus.innerText = `Balance: ${balance}`;
    showBalance = document.getElementById('balanceStatus');
     if (showBalance) {
        const displayBalance = 1; // always $1
        showBalance.innerText = `Balance: $${displayBalance}`;
    }

    const startButton = document.getElementById('startButton');
    if (balance > 0 && startButton) {
        startButton.disabled = false;
    }

    // Build a proper player object to join
    if (global.playerName && window.socket && window.socket.connected) {
        console.log("[CLIENT] Joining game after deposit...");

        const playerData = {
            name: global.playerName,
            id: -1,                      // server assigns real ID
            x: global.screen.width / 2,
            y: global.screen.height / 2,
            screenWidth: global.screen.width,
            screenHeight: global.screen.height,
            target: { x: global.screen.width / 2, y: global.screen.height / 2 },
            cells: [], 
            balance: window.currentDeposit || 0, // track deposited amount
            displayBalance: 1
    };

        window.socket.emit('gotit', playerData);
        global.player = playerData; // update global
    }
});


}

const isUnnamedCell = (name) => name.length < 1;

const getPosition = (entity, player, screen) => {
    return {
        x: entity.x - player.x + screen.width / 2,
        y: entity.y - player.y + screen.height / 2
    }
}

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function (handle) {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);
        foods.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });
        fireFood.forEach(fireFood => {
            let position = getPosition(fireFood, player, global.screen);
            render.drawFireFood(position, fireFood, playerConfig, graph);
        });
        viruses.forEach(virus => {
            let position = getPosition(virus, player, global.screen);
            render.drawVirus(position, virus, graph);
        });


        let borders = { // Position of the borders on the screen
            left: global.screen.width / 2 - player.x,
            right: global.screen.width / 2 + global.game.width - player.x,
            top: global.screen.height / 2 - player.y,
            bottom: global.screen.height / 2 + global.game.height - player.y
        }
        if (global.borderDraw) {
            render.drawBorder(borders, graph);
        }

        var cellsToDraw = [];
        for (var i = 0; i < users.length; i++) {
            let color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            for (var j = 0; j < users[i].cells.length; j++) {
                cellsToDraw.push({
                    color: color,
                    borderColor: borderColor,
                    mass: users[i].cells[j].mass,
                    name: users[i].name,
                    radius: users[i].cells[j].radius,
                    x: users[i].cells[j].x - player.x + global.screen.width / 2,
                    y: users[i].cells[j].y - player.y + global.screen.height / 2,
                    balance: users[i].balance || 0,
                    displayBalance: users[i].displayBalance || 0
                });
            }
        }
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

window.addEventListener('resize', resize);

function resize() {
    if (!window.socket) {
    window.socket = io({ query: "type=player" });
    setupSocket(window.socket);
    }   

    player.screenWidth = c.width = global.screen.width = global.playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType == 'player' ? window.innerHeight : global.game.height;

    if (global.playerType == 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
    }

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}

window.connectWallet = async function () {
    console.log("Connect Wallet button clicked");

    if (window.solana && window.solana.isPhantom) {
        try {
            const response = await window.solana.connect();
            const walletAddress = response.publicKey.toString();
            console.log("Connected to wallet:", walletAddress);

            window.walletAddress = walletAddress;
            document.getElementById('walletStatus').innerText = `Wallet: ${walletAddress}`;

            if (window.socket) {
                window.socket.emit('walletConnected', { wallet: walletAddress });
            }

            // Enable deposit button if you disabled it initially
            const depositBtn = document.getElementById('depositBtn');
            if (depositBtn) depositBtn.disabled = false;

        } catch (err) {
            console.error("Wallet connection failed:", err);
        }
    } else {
        alert("Phantom wallet not found. Please install it.");
    }
};

window.sendDeposit = async function () {
    const priceUSD = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
  .then(res => res.json())
  .then(data => data.solana.usd);

if (!priceUSD || isNaN(priceUSD)) {
    alert("Could not fetch SOL price. Try again.");
    return;
}

const amountSOL = 1 / priceUSD; // $1 worth of SOL

    if (!window.walletAddress) {
        alert("Connect your wallet first.");
        return;
    }

    const GAME_WALLET = 'DQUW5V4YgGgu8cbvC8sxb62azeJjfydKepXSpSCet1B2'; // same as server


    try {
        const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
const fromPubkey = window.solana.publicKey;
const toPubkey = new solanaWeb3.PublicKey(GAME_WALLET);
const lamports = Math.floor(amountSOL * solanaWeb3.LAMPORTS_PER_SOL);

// 1. Create a transfer instruction
const instruction = solanaWeb3.SystemProgram.transfer({
  fromPubkey,
  toPubkey,
  lamports
});

// 2. Build a transaction
const transaction = new solanaWeb3.Transaction().add(instruction);

// 3. Get a recent blockhash
transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
transaction.feePayer = fromPubkey;

// 4. Send the transaction to Phantom
const signedTx = await window.solana.signTransaction(transaction);
const txid = await connection.sendRawTransaction(signedTx.serialize());
await connection.confirmTransaction(txid, 'confirmed');

console.log("Deposit tx sent:", txid);
window.socket.emit('depositRequest', {
  wallet: window.walletAddress,
  txSig: txid
});


    } catch (err) {
        console.error("Deposit failed:", err);
        alert("Deposit failed: " + err.message);
    }
};

// Called when user clicks the in-game Cashout button
window.sendCashout = function () {
    if (!window.walletAddress) {
        alert('Connect wallet first.');
        return;
    }
    // disable button while request is processed
    const btn = document.getElementById('cashoutBtn');
    if (btn) btn.disabled = true;

    window.socket.emit('cashoutRequest', { wallet: window.walletAddress });
};

const cashoutBtn = document.getElementById('cashoutBtn');
const loader = document.getElementById('cashoutLoader');
const progressCircle = document.getElementById('progressCircle');
const HOLD_TIME = 3000; // 3 seconds
let holdStart = null;
let animationFrame = null;

function updateProgress() {
    if (!holdStart) return;
    const elapsed = Date.now() - holdStart;
    const progress = Math.min(elapsed / HOLD_TIME, 1);
    const offset = 113.097 * (1 - progress); // stroke-dashoffset
    progressCircle.setAttribute('stroke-dashoffset', offset);

    if (progress < 1) {
        animationFrame = requestAnimationFrame(updateProgress);
    } else {
        triggerCashout();
    }
}

function triggerCashout() {
    window.sendCashout();
    stopHold();
}

function startHold() {
    holdStart = Date.now();
    loader.style.display = 'block';
    updateProgress();
}

function stopHold() {
    loader.style.display = 'none';
    holdStart = null;
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    // reset progress
    progressCircle.setAttribute('stroke-dashoffset', '113.097');
}

// Desktop events
cashoutBtn.addEventListener('mousedown', startHold);
cashoutBtn.addEventListener('mouseup', stopHold);
cashoutBtn.addEventListener('mouseleave', stopHold);

// Mobile events
cashoutBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); });
cashoutBtn.addEventListener('touchend', stopHold);
cashoutBtn.addEventListener('touchcancel', stopHold);

// --- Add this after your existing cashoutBtn mouse/touch events ---

// Keyboard shortcut: Press and hold Q to cashout
let qHeld = false;

window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'q' && !qHeld) {
        qHeld = true;
        startHold();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'q') {
        qHeld = false;
        stopHold();
    }
});

 const infoBtn = document.getElementById('infoBtn');
    const infoBox = document.getElementById('infoBox');
    const closeInfo = document.getElementById('closeInfo');

    if (infoBtn && infoBox && closeInfo) {
        // Show modal when "Information" is clicked
        infoBtn.addEventListener('click', () => {
            infoBox.style.display = 'block';
        });

        // Close modal when "X" is clicked
        closeInfo.addEventListener('click', () => {
            infoBox.style.display = 'none';
        });

        // Close modal when clicking outside the popup
        window.addEventListener('click', (e) => {
            if (e.target === infoBox) {
                infoBox.style.display = 'none';
            }
        });
    }


// Listen for confirmation from server
window.socket.on('cashoutConfirmed', ({ balance, txSig }) => {
    console.log('Cashout confirmed:', txSig);
    window.currentDeposit = balance || 0;
    const showBalance = document.getElementById('balanceStatus');
    if (showBalance) showBalance.innerText = `Balance: ${window.currentDeposit}`;

    const btn = document.getElementById('cashoutBtn');
    if (btn) btn.disabled = (window.currentDeposit <= 0);
    alert('Cashout sent! Tx: ' + txSig);
});

// Optional: server messages (errors, logs)
window.socket.on('serverMSG', (msg) => {
    window.chat.addSystemLine(msg);
    const btn = document.getElementById('cashoutBtn');
    if (btn) btn.disabled = (window.currentDeposit <= 0);
});

// Prevent accidental reload while in game
window.addEventListener('beforeunload', function (e) {
    if (global.gameStart) { // only warn if the game is active
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to be set
    }
});







/* window.deposit = function () {
    const amount = parseInt(document.getElementById('depositAmount').value);
    if (isNaN(amount) || amount < 1 || amount > 5) {
        alert("Please enter a valid amount between 1 and 5.");
        return;
    }

    if (window.socket && window.walletAddress) {
        window.socket.emit('depositRequest', {
            wallet: window.walletAddress,
            amount: amount
        });
    } else {
        alert("Connect your wallet first.");
        console.log("Wallet address at deposit:", window.walletAddress);
    }
}; */

window.simulateDeposit = function () {
    const amount = Number(document.getElementById('depositAmountSim').value);
    console.log("Deposit amount entered:", amount);

    if (isNaN(amount) || amount < 1 || amount > 5) {
        alert("Please enter a valid amount between 1 and 5.");
        return;
    }

    if (window.socket && window.walletAddress) {
        window.socket.emit('depositRequest', {
            wallet: window.walletAddress,
            amount: amount
        });
    } else {
        alert("Connect your wallet first.");
    }
};

