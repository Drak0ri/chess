// ...
// Previous lines remain unchanged
}else if(offer.from===currentPlayer.id&&offer.accepted){
  // Our offer was responded to
  $('masterNoticeModal').classList.remove('active');
  $('masterNoticeOk').textContent='OK';
  $('gotToGoModal').classList.remove('active');
  if(gotToGoOfferTimer){clearTimeout(gotToGoOfferTimer);gotToGoOfferTimer=null}
  if(gameState.gameOver)return;
  gameState.gameOver=true;
  if(offer.accepted==='win'){
    // Opponent accepted the win — they win, we lose
    const opponentColor=currentPlayer.color==='white'?'black':'white';
    gameState.result={type:'got_to_go',winner:opponentColor};
  }else{
    // Opponent accepted a draw
    gameState.result={type:'got_to_go_draw',offeredBy:currentPlayer.color};
  }
  syncMoveToFirebase();
  updateStatus();
  recordMatchResult();
  showGameOver();
}
// ...
// Remaining lines remain unchanged