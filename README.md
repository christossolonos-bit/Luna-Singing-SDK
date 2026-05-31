# Luna Singing SDK

**Your avatar wants to sing. We’re not asking — we’re *auditioning*.**

Welcome to **Luna Singing SDK**: a browser stage where VRM avatars lip-sync, emote, dance to the beat, and (optionally) talk back through Edge TTS. Load a song, pick your performer, hit play, and watch them stop pretending they’re “just a 3D model.”

> *“I’ve been standing in T-pose for *years*. Give me a mic.”*  
> — Every VRM, probably

---

## What you get

- **Dual-stem playback** — music + vocals, synced
- **Real-time lip sync** — vowels, jaw, the works (vocals only, not the instrumental)
- **Face expressions** — happy, sad, angry, and friends (from vocals + optional emotion map JSON)
- **Dance sequences** — VRMA routines with smart transitions between moves
- **Genre-aware playlists** — the app guesses the vibe and picks dances
- **Upload your own VRM** — Luna is the default star, not the only one
- **Edge TTS** — type text, avatar speaks (dev server required)
- **Custom backgrounds** — video or image, because every diva needs a set

---

## Installation (the ritual)

You will need **Node.js 18+** and a terminal. Deep breath. The avatars are watching.

### 1. Clone the repo

```bash
git clone https://github.com/christossolonos-bit/Luna-Singing-SDK.git
cd Luna-Singing-SDK
```

*If you already have the folder locally, `cd` into it and skip the clone. We don’t judge hoarders.*

### 2. Install dependencies

```bash
npm install
```

This downloads the internet. Go make tea. The avatars are stretching.

### 3. Start the dev server

```bash
npm run dev
```

Your browser should open to **http://localhost:5173**. If it doesn’t, paste that URL yourself — the stage doesn’t come to you.

### 4. Put your avatar to work

1. **Load stems** (dock) — pick instrumental, then vocals  
2. **Play** — dancing + lip sync + expressions begin  
3. **Upload VRM** (optional) — swap in your own model  
4. **Luna speak** — type something; she’ll say it (TTS runs through the Vite server)

When the song ends, the avatar stops dancing and returns to idle. Even performers need a breather.

---

## Other commands

| Command | What it does |
|--------|----------------|
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the built app (TTS still works here) |

**Note:** Opening `index.html` directly from disk won’t run TTS — you need `npm run dev` or `npm run preview`. The avatars refuse to sing a cappella without a server.

---

## Environment variables & secrets

No API keys are required for the default setup. If you add `.env` files later (tokens, API keys, etc.), they are **gitignored** — keep secrets local, push code only.

Example (optional, for your own config):

```bash
# .env.local — never commit this file
# MY_API_TOKEN=your-secret-here
```

---

## Project layout (quick tour)

```
public/          Luna.vrm, dances, default background
src/             App logic — lip sync, dances, UI, TTS client
server/          Edge TTS handler (dev/preview)
dance animations/ Source VRMA files (synced to public/dance/)
```

---

## Debug helpers (browser console)

After load, open DevTools:

```js
lunaDances.log()      // dance clip durations
lunaDances.current()  // live playback info while dancing
```

---

## License

MIT — see [LICENSE](LICENSE).

---

**Ready?** Run `npm run dev`, load a track, and let your avatar finally use all that pent-up choreography. The mic is hot. 🎤
