// js/firebase-init.js
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBXKcCv8eMhSSg56Z1P75rGPBpDVdH3LXQ",
    authDomain: "ies-chess.firebaseapp.com",
    databaseURL: "https://ies-chess-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ies-chess",
    storageBucket: "ies-chess.firebasestorage.app",
    messagingSenderId: "877435867792",
    appId: "1:877435867792:web:1d8d6af8b05d1461957e15"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.db   = firebase.database();
  window.auth = typeof firebase.auth === 'function' ? firebase.auth() : null;
})();
