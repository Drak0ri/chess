# ♟️ Student Chess Arena

A simple, real-time chess platform where students can challenge each other and play chess online.

## ✨ Features

- 🎯 **Simple Login** - Username and password (no email required)
- 🌐 **Online Players** - See who's online and ready to play
- ⚔️ **Challenge System** - Challenge any online player to a game
- ♟️ **Real-time Chess** - Play chess with instant move updates
- 📊 **Stats Tracking** - Track wins, losses, and draws
- 📱 **Chromebook Ready** - Works perfectly on school Chromebooks
- 🎨 **Beautiful UI** - Modern, colorful interface

## 🚀 Quick Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Name it something like "student-chess"
4. Disable Google Analytics (not needed)
5. Click "Create project"

### 2. Enable Authentication

1. In your Firebase project, click "Authentication" in the sidebar
2. Click "Get started"
3. Click on "Email/Password"
4. Enable it (toggle switch)
5. Click "Save"

### 3. Enable Realtime Database

1. Click "Realtime Database" in the sidebar
2. Click "Create Database"
3. Choose a location (closest to your school)
4. Start in **test mode** (we'll secure it later)
5. Click "Enable"

### 4. Get Your Firebase Config

1. Click the gear icon ⚙️ next to "Project Overview"
2. Click "Project settings"
3. Scroll down to "Your apps"
4. Click the web icon `</>`
5. Register your app (name it "Chess App")
6. Copy the `firebaseConfig` object

### 5. Update the Code

Replace the Firebase config in **all three HTML files** (`index.html`, `lobby.html`, `game.html`):

```javascript
const firebaseConfig = {
    apiKey: "YOUR_ACTUAL_API_KEY_HERE",
    authDomain: "your-project.firebaseapp.com",
    databaseURL: "https://your-project.firebaseio.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
};
```

### 6. Deploy to GitHub Pages

1. Create a new repo on GitHub called `chess`
2. Upload these files to the repo
3. Go to Settings → Pages
4. Select "main" branch as source
5. Save

Your chess site will be live at: `https://YOUR_USERNAME.github.io/chess/`

## 🎮 How to Use

### For Students

1. **Sign Up**
   - Go to the chess website
   - Click "Create one"
   - Choose a username (3-20 characters)
   - Choose a password (6+ characters)

2. **Login**
   - Enter your username and password
   - Click "Login"

3. **Challenge Someone**
   - You'll see a list of online players
   - Click "Challenge" next to any player
   - Wait for them to accept

4. **Play Chess**
   - Drag and drop pieces to move
   - Game follows standard chess rules
   - Checkmate or resign to end the game

5. **View Stats**
   - Your wins, draws, and losses show in the header
   - Track your progress!

## 🔒 Security (Important!)

### Before going live in school:

1. **Secure Firebase Database**

Go to Realtime Database → Rules and paste this:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": true,
        ".write": "$uid === auth.uid"
      }
    },
    "challenges": {
      ".read": "auth != null",
      ".write": "auth != null",
      "$challengeId": {
        ".validate": "newData.hasChildren(['challenger', 'opponent', 'status'])"
      }
    },
    "games": {
      ".read": "auth != null",
      "$gameId": {
        ".write": "
          auth.uid === data.child('white').val() || 
          auth.uid === data.child('black').val()
        "
      }
    }
  }
}
```

2. **Restrict Auth Domain**

In Firebase Console → Authentication → Settings:
- Add your GitHub Pages domain to authorized domains
- Remove unauthorized domains

## 📁 File Structure

```
chess-simple/
├── index.html      # Login/Register page
├── lobby.html      # Player list and challenges
├── game.html       # Chess game board
└── README.md       # This file
```

## 🎨 Customization

### Change Colors

Edit the gradients in the `<style>` sections:

```css
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```

Try these color combos:
- Blue/Purple: `#667eea` → `#764ba2` (current)
- Green/Teal: `#11998e` → `#38ef7d`
- Orange/Pink: `#f12711` → `#f5af19`
- Red/Orange: `#eb3349` → `#f45c43`

### Add School Logo

In `lobby.html`, add before the header:

```html
<img src="school-logo.png" alt="Logo" style="position: fixed; top: 20px; left: 20px; height: 50px;">
```

## 🐛 Troubleshooting

### "Firebase not configured"
- Make sure you replaced the Firebase config in ALL three HTML files
- Check that your Firebase project is active

### "Players not showing up"
- Check Firebase Realtime Database rules
- Make sure both players are logged in
- Check browser console for errors (F12)

### "Moves not working"
- Verify you're logged in as one of the players
- Check it's your turn (white moves first)
- Try refreshing the page

### "Can't create account"
- Check Firebase Authentication is enabled
- Verify Email/Password provider is turned on
- Password must be 6+ characters

## 📝 Future Ideas

Want to add more features? Here are some ideas:

- ⏰ **Time Controls** - Add chess clocks for timed games
- 🏆 **Leaderboards** - Rank players by wins
- 💬 **Chat** - Add in-game chat
- 🎯 **Tournaments** - Create tournament brackets
- 📊 **ELO Ratings** - Calculate skill ratings
- 🎭 **Avatars** - Let players choose profile pictures
- 📜 **Move History** - Show list of moves made
- ↩️ **Undo Move** - Request to take back a move

## 📞 Support

If students have issues:
1. Check they're using a modern browser (Chrome, Firefox, Edge)
2. Clear browser cache and reload
3. Check Firebase Console for errors
4. Make sure they're on the correct URL

## 📄 License

Free to use for educational purposes! 🎓

---

**Built by Shadow 🌑 for Drak0ri 🐉**

*Simple chess for students. No complexity, just chess.* ♟️
