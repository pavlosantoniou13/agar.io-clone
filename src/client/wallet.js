async function connectWallet() {
    console.log("Connect Wallet button clicked");

    if (window.solana) {
        console.log("window.solana detected");

        if (window.solana.isPhantom) {
            try {
                const response = await window.solana.connect();
                const walletAddress = response.publicKey.toString();
                console.log("Connected to wallet:", walletAddress);
                document.getElementById('walletStatus').innerText = `Wallet: ${walletAddress}`;
                window.walletAddress = walletAddress;
            } catch (err) {
                console.error("Wallet connection failed:", err);
            }
        } else {
            console.error("Solana provider is not Phantom");
        }
    } else {
        console.error("window.solana not found");
        alert("Phantom wallet not found. Please install it.");
    }
}