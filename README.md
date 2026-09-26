# PhoneFight

Swing your phone as a sword: deflect arrows and slice what's thrown at you. It runs entirely in the browser, with no app and no install.

- **Game** (`index.html`): the Three.js arena. Open it on a computer.
- **Controller** (`controller.html`): the page your phone opens from the Game's QR code. It streams orientation and gyroscope data to the Game over WebRTC (PeerJS).

## Run it

```sh
npm install
npm run share     # public HTTPS tunnel + dev server; opens the Game in your browser when the link is live
```

Phones only hand out motion sensors on HTTPS pages, so plain `npm run dev` on your LAN won't work for the phone. Under `npm run share` the QR code always points at the tunnel, even if you open the Game at `localhost`. `npm run share` uses cloudflared: from `PATH`, or the copy pocketwand's `pycloudflared` downloads into `.venv`.

## Play

1. Scan the QR code, tap **Enable motion**, and hold the phone like a sword grip: the top of the phone is the blade and the screen faces sideways.
2. Point at the screen and hold still. The Game Recentres and starts.
3. Hit a Projectile with the **Flat** (the screen side) to Deflect it. Swing an **Edge** (the phone's long sides) through it fast to Slice it.
4. You have 3 Lives. Slice = 2 points, Deflect = 1.

Keys on the Game: **R** recentres, and **Enter** restarts after a game over.

## Deploy

Every push to `main` builds and publishes the site to GitHub Pages (`.github/workflows/deploy.yml`). `npm run build` writes the same static site to `dist/` if you want to host it elsewhere; paths are relative, so a subfolder works.

Connections go peer to peer, brokered by the free public PeerJS server. Networks that block peer-to-peer traffic won't connect; a relay fallback is planned.
