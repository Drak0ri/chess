function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
const PIX=(()=>{const b='https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett';return{K:b+'/wK.svg',Q:b+'/wQ.svg',R:b+'/wR.svg',B:b+'/wB.svg',N:b+'/wN.svg',P:b+'/wP.svg',k:b+'/bK.svg',q:b+'/bQ.svg',r:b+'/bR.svg',b:b+'/bB.svg',n:b+'/bN.svg',p:b+'/bP.svg'}})();

let firebaseSchools={},firebaseSettings={},firebaseCompetitions={},firebaseAppearance={},schoolsLoaded=false;
const CONFIG={nicknames:Array.from({length:50},(_,i)=>String(i+1).padStart(3,'0')),nicknamePrefix:'Player '};

let lockedSchoolId=null; // set when player arrives via a school-specific URL token
let matchRoomId=null,matchRoomSchoolA=null,matchRoomSchoolB=null; // set when arriving via a match room link

let currentPlayer=null,gameState=null,selectedSquare=null,validMoves=[],isFlipped=false;
let playerCounter=Math.floor(Math.random()*1000),gameMode='student',selectedCompetitionId=null;
let currentGameId=null,gameRef=null,lobbyRef=null,isHost=false,gameClockInterval=null,computerDifficulty='medium',disconnectTimer=null;
let smoothSlideEnabled=true;
let isAnimating=false;
let pendingPremove=null; // {from:[r,c], to:[r,c]}
let gotToGoOfferListener=null,gotToGoOfferTimer=null;

const $=id=>document.getElementById(id);
function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(name+'Screen').classList.add('active');
  
  // Hide header and nav when game screen is active
  const header = document.getElementById('mainHeader');
  const nav = document.getElementById('mainNav');
  if (header && nav) {
    if (name === 'game') {
      header.style.display = 'none';
      nav.style.display = 'none';
    } else {
      header.style.display = 'block';
      nav.style.display = 'flex';
    }
  }
}
function pieceImgHTML(piece){if(piece===' ')return'';return'<img class="piece" src="'+PIX[piece]+'" alt="'+piece+'" draggable="false">'}

function applyAppearance(appearance){
  if(!appearance)return;
  const root=document.documentElement;
  const lightColor=appearance.boardColors?.light||appearance.lightSquare;
  const darkColor=appearance.boardColors?.dark||appearance.darkSquare;
  if(lightColor)root.style.setProperty('--light-sq',lightColor);
  if(darkColor)root.style.setProperty('--dark-sq',darkColor);
  if(appearance.boardSize){
    const board=document.querySelector('.chess-board');
    if(board){
      board.style.width='min(calc(100vw - 40px),'+appearance.boardSize+'px)';
      board.style.height='min(calc(100vw - 40px),'+appearance.boardSize+'px)';
    }
  }
  
  // Apply piece style
  if(appearance.pieceStyle){
    const board=document.querySelector('.chess-board');
    const promotionModal=document.querySelector('#promotionModal');
    const capturedPieces=document.querySelector('#capturedPieces');
    
    // Remove all piece style classes
    const allStyles=['classic','modern','alpha','leipzig','fantasy','spatial','comic','pixel','neon','wooden','ice','fire','royal-gold','shadow','candy'];
    allStyles.forEach(style=>{
      [board,promotionModal,capturedPieces].forEach(el=>{
        if(el)el.classList.remove('piece-style-'+style);
      });
    });
    
    // Add the selected piece style class
    [board,promotionModal,capturedPieces].forEach(el=>{
      if(el)el.classList.add('piece-style-'+appearance.pieceStyle);
    });
  }
}

function getEffectiveAppearanceForSchool(schoolId){
  const global=firebaseAppearance||{};
  const schoolAppearance=schoolId&&firebaseSchools[schoolId]&&firebaseSchools[schoolId].appearance?firebaseSchools[schoolId].appearance:{};
  return {
    ...global,
    ...schoolAppearance,
    boardColors:{
      ...(global.boardColors||{}),
      ...(schoolAppearance.boardColors||{})
    }
  };
}

function checkSchoolToken(){
  const params=new URLSearchParams(window.location.search);
  const urlToken=params.get('s');
  if(urlToken){
    const match=Object.entries(firebaseSchools).find(([,s])=>s.accessToken===urlToken);
    if(match)lockedSchoolId=match[0];
  }
  // Match room link: ?room=room_xxx&a=schoolAKey&b=schoolBKey
  const room=params.get('room');
  if(room){
    matchRoomId=room;
    matchRoomSchoolA=params.get('a')||null;
    matchRoomSchoolB=params.get('b')||null;
    showMatchRoomBanner();
  }
}

function showMatchRoomBanner(){
  let banner=document.getElementById('matchRoomBanner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='matchRoomBanner';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9998;background:#1a2a4a;border-bottom:2px solid #4a7cff;padding:10px 20px;display:flex;align-items:center;gap:12px;font-size:.88rem;color:#e8ecf4;';
    document.body.prepend(banner);
  }
  const schoolAName=(matchRoomSchoolA&&firebaseSchools[matchRoomSchoolA]?.name)||matchRoomSchoolA||'?';
  const schoolBName=(matchRoomSchoolB&&firebaseSchools[matchRoomSchoolB]?.name)||matchRoomSchoolB||'?';
  banner.innerHTML=`<span style="font-size:1.1rem;">♟</span> <strong>Match Room</strong> — ${escapeHtml(schoolAName)} vs ${escapeHtml(schoolBName)} <span style="margin-left:auto;font-size:.75rem;color:#7a8599;font-family:monospace;">${escapeHtml(matchRoomId)}</span>`;
  // Update join button to reflect match room context
  const joinBtn=$('joinBtn');
  if(joinBtn)joinBtn.innerHTML='Enter Match Room';
}

let firebaseLadder = null;
let ladderPresenceRef = null;
let ladderPrePresenceRef = null;

function loadFirebaseData(){
  db.ref('admin/schools').on('value',snap=>{firebaseSchools=snap.val()||{};schoolsLoaded=true;checkSchoolToken();populateSchoolDropdown();const selectedSchoolId=lockedSchoolId||$('schoolSelect').value||currentPlayer?.schoolId;applyAppearance(getEffectiveAppearanceForSchool(selectedSchoolId));updateOtherSchoolsDot(selectedSchoolId)},err=>console.error('index: schools load failed',err));
  db.ref('admin/settings').on('value',snap=>{firebaseSettings=snap.val()||{};if(firebaseSettings.game)smoothSlideEnabled=firebaseSettings.game.smoothSlide!==false;checkPortalAvailability()},err=>console.error('index: settings load failed',err));
  db.ref('admin/competitions').on('value',snap=>{firebaseCompetitions=snap.val()||{};populateCompetitions()},err=>console.error('index: competitions load failed',err));
  db.ref('admin/appearance').on('value',snap=>{firebaseAppearance=snap.val()||{};const selectedSchoolId=$('schoolSelect').value||currentPlayer?.schoolId;applyAppearance(getEffectiveAppearanceForSchool(selectedSchoolId))},err=>console.error('index: appearance load failed',err));
  db.ref('admin/ladder/knockout').on('value',snap=>{firebaseLadder=snap.val()||{};updateLadderBanner()},err=>console.error('index: ladder load failed',err));
}

function schoolNameToKey(n){return n.toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}

function registerLadderPrePresence(ownSchoolKey){
  if(ladderPrePresenceRef)return;
  let sid=sessionStorage.getItem('lpp_sid');
  if(!sid){sid='pp_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);sessionStorage.setItem('lpp_sid',sid);}
  ladderPrePresenceRef=db.ref('admin/ladder/pre_presence/'+ownSchoolKey+'/'+sid);
  ladderPrePresenceRef.set({timestamp:firebase.database.ServerValue.TIMESTAMP});
  ladderPrePresenceRef.onDisconnect().remove();
}

function clearLadderPrePresence(){
  if(!ladderPrePresenceRef)return;
  ladderPrePresenceRef.onDisconnect().cancel();
  ladderPrePresenceRef.remove();
  ladderPrePresenceRef=null;
}

function updateLadderBanner(){
  const banner=$('ladderMatchBanner');
  if(!banner)return;
  const ko=firebaseLadder||{};
  if(ko.status!=='active'){banner.style.display='none';clearLadderPrePresence();return;}// paused/scheduled/idle all hide the banner
  const schoolId=lockedSchoolId||$('schoolSelect').value;
  if(!schoolId){banner.style.display='none';clearLadderPrePresence();return;}
  const school=firebaseSchools[schoolId];
  if(!school){banner.style.display='none';clearLadderPrePresence();return;}
  const schoolName=school.name||'';
  const roundIdx=ko.currentRoundIdx||0;
  const round=(ko.rounds||[])[roundIdx];
  if(!round){banner.style.display='none';clearLadderPrePresence();return;}
  const pairing=(round.pairings||[]).find(p=>!p.bye&&!p.winner&&(p.school1===schoolName||p.school2===schoolName));
  if(!pairing){banner.style.display='none';clearLadderPrePresence();return;}
  const opponentName=pairing.school1===schoolName?pairing.school2:pairing.school1;
  $('ladderOpponentName').textContent=opponentName;
  const winsTarget=ko.winsTarget||10;
  $('ladderWinsTarget').textContent=`First to ${winsTarget} wins`;
  const ownKey=schoolNameToKey(schoolName);
  const opponentKey=schoolNameToKey(opponentName);
  // Register page-level presence for own school so opponent can see we're here
  registerLadderPrePresence(ownKey);
  // Check opponent presence — both active lobby and page-level
  Promise.all([
    db.ref('admin/ladder/presence/'+opponentKey).once('value'),
    db.ref('admin/ladder/pre_presence/'+opponentKey).once('value')
  ]).then(([lobbySnap,pageSnap])=>{
    const lobbyCount=Object.keys(lobbySnap.val()||{}).length;
    const pageCount=Object.keys(pageSnap.val()||{}).length;
    let statusText;
    if(lobbyCount>0){
      statusText=`${lobbyCount} player${lobbyCount!==1?'s':''} from ${opponentName} ready in the ladder lobby`;
    } else if(pageCount>0){
      statusText=`${pageCount} player${pageCount!==1?'s':''} from ${opponentName} on the page — click Play to match up!`;
    } else {
      statusText=`No opponents waiting yet — join and they'll be matched to you`;
    }
    $('ladderOpponentStatus').textContent=statusText;
    banner.style.display='';
    banner.dataset.pairingSchool1=pairing.school1;
    banner.dataset.pairingSchool2=pairing.school2;
    banner.dataset.roundIdx=roundIdx;
    banner.dataset.pairingId=pairing.id;
  });
}

function enterLadderLobby(){
  const banner=$('ladderMatchBanner');
  if(!banner||banner.style.display==='none')return;
  const roundIdx=banner.dataset.roundIdx;
  const pairingId=banner.dataset.pairingId;
  const lobbyPath='lobby/ladder/round'+roundIdx+'/'+pairingId;
  // Upgrade from page-level presence to full lobby presence
  clearLadderPrePresence();
  // Register presence so opponent can see us
  const schoolId=lockedSchoolId||$('schoolSelect').value;
  const school=firebaseSchools[schoolId];
  if(!school)return;
  const schoolKey=schoolNameToKey(school.name||'');
  if(currentPlayer&&currentPlayer.id){
    ladderPresenceRef=db.ref('admin/ladder/presence/'+schoolKey+'/'+currentPlayer.id);
    ladderPresenceRef.set({id:currentPlayer.id,nickname:currentPlayer.nickname,timestamp:firebase.database.ServerValue.TIMESTAMP});
    ladderPresenceRef.onDisconnect().remove();
  }
  // Override lobby path for this session
  lobbyRef=db.ref(lobbyPath);
  $('lobbyStatus').textContent='Looking for a ladder opponent…';
  $('lobbyHint').textContent='You\'ll be matched with a player from '+banner.dataset.pairingSchool1+'/'+(banner.dataset.pairingSchool1===currentPlayer.school?banner.dataset.pairingSchool2:banner.dataset.pairingSchool1)+'.';
  showScreen('lobby');
  $('waitingAnim').style.display='flex';
  // Use existing matchmaking logic with the overridden lobbyRef
  lobbyRef.once('value').then(snapshot=>{
    const wp=snapshot.val();const now=Date.now();
    if(wp)Object.entries(wp).forEach(([pid,pdata])=>{if(pdata.timestamp&&(now-pdata.timestamp)>120000)lobbyRef.child(pid).remove()});
    return lobbyRef.once('value');
  }).then(snapshot=>{
    const wp=snapshot.val();
    if(wp){const availableId=Object.keys(wp).find(id=>id!==currentPlayer.id);if(availableId){joinExistingGame(wp[availableId],availableId);return}}
    addToLobby();
  });
}

function checkPortalAvailability(){
  const globalS=firebaseSettings;
  // Support both old flat format (globalS.playEnabled) and new nested format (globalS.portal.playEnabled)
  const globalPortal=globalS&&globalS.portal?globalS.portal:globalS;
  if(!globalPortal||globalPortal.playEnabled===undefined)return;
  
  // Determine which school settings to use
  const selectedSchoolId=lockedSchoolId||$('schoolSelect').value||currentPlayer?.schoolId;
  const schoolData=selectedSchoolId?firebaseSchools[selectedSchoolId]:null;
  const schoolS=schoolData?.settings?.portal||{};
  
  // School settings override global (if set)
  const s={...globalPortal,...schoolS};
  
  if(s.playEnabled===false){showScreen('closed');$('closedMessage').textContent='The chess portal is currently closed by the administrator.';return}
  
  // Skip schedule checks if useSchedule is explicitly false
  if(s.useSchedule===false)return;
  
  const now=new Date();
  const activeDays=s.activeDays||[1,2,3,4,5];
  if(!activeDays.includes(now.getDay())){showScreen('closed');$('closedMessage').textContent='The chess portal is not available today.';return}
  if(s.startTime&&s.endTime){const currentTime=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');if(currentTime<s.startTime||currentTime>s.endTime){showScreen('closed');$('closedMessage').textContent=`The chess portal is available from ${s.startTime} to ${s.endTime}.`;return}}
  // If we reach here, show login screen if on closed screen
  if($('closedScreen').classList.contains('active'))showScreen('login');
}

function populateYearsForSchool(schoolId){
  const yearSel=$('yearSelect');
  yearSel.innerHTML='<option value="">Select your year...</option>';
  const school=firebaseSchools[schoolId];
  const yearData=school?(school.years||school.classes):null;
  if(!school||!yearData){yearSel.disabled=true;return}
  Object.entries(yearData).sort((a,b)=>a[1].name.localeCompare(b[1].name,undefined,{numeric:true})).forEach(([cid,cls])=>{const opt=document.createElement('option');opt.value=cid;opt.textContent='Year '+cls.name;yearSel.appendChild(opt)});
  yearSel.disabled=false;
}

function getSchoolAccessSettings(schoolId){
  const school=firebaseSchools[schoolId];
  return (school&&school.settings&&school.settings.access)||{};
}

function updateLoginAccessState(schoolId){
  const yearSel=$('yearSelect');
  const access=getSchoolAccessSettings(schoolId);
  const tokenBlocked=access.enforceToken&&lockedSchoolId!==schoolId;
  // Show/hide token required notice
  $('tokenRequiredNotice').style.display=tokenBlocked?'block':'none';
  // Show/hide PIN group (only when not token-blocked)
  const showPin=!tokenBlocked&&!!access.pinEnabled;
  $('pinGroup').style.display=showPin?'block':'none';
  if(!showPin)$('pinInput').value='';
  // Update join button state
  if(tokenBlocked){$('joinBtn').disabled=true;return;}
  const yearOk=!!yearSel.value;
  const pinOk=!access.pinEnabled||($('pinInput').value.trim().length===4);
  $('joinBtn').disabled=!(yearOk&&pinOk);
}

function populateSchoolDropdown(){
  const schoolSel=$('schoolSelect'),yearSel=$('yearSelect');

  if(lockedSchoolId&&firebaseSchools[lockedSchoolId]){
    // School is locked via URL token — hide dropdown, show badge
    $('schoolSelectGroup').style.display='none';
    const banner=$('lockedSchoolBanner');
    banner.style.display='block';
    $('lockedSchoolName').textContent=firebaseSchools[lockedSchoolId].name;
    schoolSel.innerHTML='';
    const opt=document.createElement('option');opt.value=lockedSchoolId;opt.textContent=firebaseSchools[lockedSchoolId].name;schoolSel.appendChild(opt);
    schoolSel.value=lockedSchoolId;
    populateYearsForSchool(lockedSchoolId);
    applyAppearance(getEffectiveAppearanceForSchool(lockedSchoolId));
    checkPortalAvailability();
    updateOtherSchoolsDot(lockedSchoolId);
    updateLoginAccessState(lockedSchoolId);
    yearSel.onchange=()=>{updateLoginAccessState(lockedSchoolId)};
    return;
  }

  schoolSel.innerHTML='<option value="">Select your school...</option>';
  // In match room mode, restrict dropdown to only the two participating schools
  // Otherwise, only show schools that have at least one contact in the Contact Directory
  const allSchoolEntries=Object.entries(firebaseSchools);
  const schoolEntries=matchRoomId&&matchRoomSchoolA&&matchRoomSchoolB
    ?allSchoolEntries.filter(([id])=>id===matchRoomSchoolA||id===matchRoomSchoolB)
    :allSchoolEntries.filter(([,school])=>school.contacts&&Object.keys(school.contacts).length>0);
  schoolEntries.sort((a,b)=>a[1].name.localeCompare(b[1].name)).forEach(([id,school])=>{const opt=document.createElement('option');opt.value=id;opt.textContent=school.name;schoolSel.appendChild(opt)});
  schoolSel.onchange=()=>{yearSel.innerHTML='<option value="">Select your year...</option>';yearSel.disabled=true;$('joinBtn').disabled=true;$('pinGroup').style.display='none';$('pinInput').value='';$('tokenRequiredNotice').style.display='none';const schoolId=schoolSel.value;applyAppearance(getEffectiveAppearanceForSchool(schoolId));checkPortalAvailability();updateOtherSchoolsDot(schoolId);populateYearsForSchool(schoolId);updateLadderBanner();if(schoolId)updateLoginAccessState(schoolId);};
  yearSel.onchange=()=>{const schoolId=schoolSel.value;if(schoolId)updateLoginAccessState(schoolId);else $('joinBtn').disabled=true;};
}

function populateCompetitions(){
  const urlParams=new URLSearchParams(window.location.search);
  const compParam=urlParams.get('comp');
  const banner=$('compInfoBanner');
  if(compParam&&firebaseCompetitions[compParam]){
    const c=firebaseCompetitions[compParam];
    const st=getCompStatusLocal(c);
    if(st==='live'){
      selectedCompetitionId=compParam;
      banner.style.display='block';
      $('compInfoName').textContent=c.name;
      const rules=c.matchRules||{};
      const ruleStr=[rules.open?'Cross-school':null,rules.sameYear?'Same year':null].filter(Boolean).join(', ')||'In-House';
      $('compInfoMeta').textContent=ruleStr+' · '+(c.gameTimeMinutes||10)+' min/player';
      return;
    }
  }
  if(compParam&&!firebaseCompetitions[compParam]){
    banner.style.display='none';selectedCompetitionId=null;
  }
  if(!compParam){banner.style.display='none';selectedCompetitionId=null}
}
function getCompStatusLocal(c){if(c.status==='stopped')return'ended';if(c.status==='paused')return'paused';const now=Date.now(),s=new Date(c.startTime).getTime(),isOpen=c.openEnded===true,e=isOpen?Infinity:new Date(c.endTime).getTime();if(s>now)return'upcoming';if(e<now&&!isOpen)return'ended';return'live'}
function isCompAvailableNow(c){
  if(!c.scheduleEnabled)return true;
  const now=new Date();
  // Check day of week
  if(c.availableDays&&c.availableDays.length>0){
    if(!c.availableDays.includes(now.getDay()))return false;
  }
  // Check time window
  if(c.availableFrom&&c.availableUntil){
    const h=now.getHours(),m=now.getMinutes(),currentMins=h*60+m;
    const[fromH,fromM]=c.availableFrom.split(':').map(Number),fromMins=fromH*60+fromM;
    const[untilH,untilM]=c.availableUntil.split(':').map(Number),untilMins=untilH*60+untilM;
    if(untilMins>fromMins){if(!(currentMins>=fromMins&&currentMins<untilMins))return false}
    else{if(!(currentMins>=fromMins||currentMins<untilMins))return false}
  }
  return true;
}

// Other schools play time monitoring
function isSchoolActiveNow(playTimes){
  if(!playTimes||!playTimes.length)return false;
  const now=new Date();
  const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const currentDay=days[now.getDay()];
  const currentTime=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  return playTimes.some(s=>s.day===currentDay&&currentTime>=s.start&&currentTime<=s.end);
}

function updateOtherSchoolsDot(selectedSchoolId){
  const wrapper=document.getElementById('otherSchoolsDot');
  const dot=document.getElementById('dotIndicator');
  const schoolsList=document.getElementById('dotTooltipSchools');
  if(!wrapper)return;
  if(!selectedSchoolId){wrapper.style.display='none';return;}
  const activeSchools=[];
  Object.entries(firebaseSchools).forEach(([id,school])=>{
    if(id===selectedSchoolId)return;
    if(isSchoolActiveNow(school.playTimes))activeSchools.push(school.name||id);
  });
  dot.className='dot-indicator '+(activeSchools.length>0?'active':'inactive');
  schoolsList.innerHTML=activeSchools.length>0
    ?activeSchools.map(n=>`<div class="dot-tooltip-school">${n}</div>`).join('')
    :'<div style="color:var(--text-dim);font-style:italic;font-size:.8rem">No other schools active now</div>';
  wrapper.style.display='';
}

// Refresh dot every minute
setInterval(()=>updateOtherSchoolsDot($('schoolSelect').value),60000);

// Chess Engine
function isW(p){return p>='A'&&p<='Z'}function isB(p){return p>='a'&&p<='z'}function pColor(p){return isW(p)?'white':isB(p)?'black':null}function isOwn(p,c){return c==='white'?isW(p):isB(p)}function isEnemy(p,c){return c==='white'?isB(p):isW(p)}function inBounds(r,c){return r>=0&&r<8&&c>=0&&c<8}
function initBoard(){return[['r','n','b','q','k','b','n','r'],['p','p','p','p','p','p','p','p'],[' ',' ',' ',' ',' ',' ',' ',' '],[' ',' ',' ',' ',' ',' ',' ',' '],[' ',' ',' ',' ',' ',' ',' ',' '],[' ',' ',' ',' ',' ',' ',' ',' '],['P','P','P','P','P','P','P','P'],['R','N','B','Q','K','B','N','R']]}
function newGameState(){return{board:initBoard(),turn:'white',castling:{K:true,Q:true,k:true,q:true},ep:null,halfMoves:0,fullMoves:1,moves:[],lastMove:null,gameOver:false,result:null,gameStartedAt:Date.now()}}
function cloneState(s){return{board:s.board.map(r=>[...r]),turn:s.turn,castling:{...s.castling},ep:s.ep?[...s.ep]:null,halfMoves:s.halfMoves,fullMoves:s.fullMoves,moves:[...s.moves],lastMove:s.lastMove,gameOver:s.gameOver,result:s.result}}
function pseudoMoves(board,row,col,castling,ep){const piece=board[row][col];if(piece===' ')return[];const color=pColor(piece);const moves=[];const type=piece.toUpperCase();const addIfValid=(r,c)=>{if(inBounds(r,c)&&!isOwn(board[r][c],color))moves.push([r,c])};const slide=(dr,dc)=>{let r=row+dr,c=col+dc;while(inBounds(r,c)){if(isOwn(board[r][c],color))break;moves.push([r,c]);if(isEnemy(board[r][c],color))break;r+=dr;c+=dc}};if(type==='P'){const dir=color==='white'?-1:1;const startRow=color==='white'?6:1;if(inBounds(row+dir,col)&&board[row+dir][col]===' '){moves.push([row+dir,col]);if(row===startRow&&board[row+2*dir][col]===' ')moves.push([row+2*dir,col])}for(const dc of[-1,1]){const nr=row+dir,nc=col+dc;if(inBounds(nr,nc)){if(isEnemy(board[nr][nc],color))moves.push([nr,nc]);if(ep&&ep[0]===nr&&ep[1]===nc)moves.push([nr,nc])}}}else if(type==='N'){for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])addIfValid(row+dr,col+dc)}else if(type==='B'){for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]])slide(dr,dc)}else if(type==='R'){for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]])slide(dr,dc)}else if(type==='Q'){for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])slide(dr,dc)}else if(type==='K'){for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])addIfValid(row+dr,col+dc);const kRow=color==='white'?7:0;if(row===kRow&&col===4){if(castling[color==='white'?'K':'k']&&board[kRow][5]===' '&&board[kRow][6]===' ')moves.push([kRow,6]);if(castling[color==='white'?'Q':'q']&&board[kRow][3]===' '&&board[kRow][2]===' '&&board[kRow][1]===' ')moves.push([kRow,2])}}return moves}
function findKing(board,color){const k=color==='white'?'K':'k';for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(board[r][c]===k)return[r,c];return null}
function isSquareAttacked(board,row,col,byColor){for(let r=0;r<8;r++)for(let c=0;c<8;c++){if(!isOwn(board[r][c],byColor))continue;const piece=board[r][c].toUpperCase();const dr=row-r,dc=col-c,adr=Math.abs(dr),adc=Math.abs(dc);if(piece==='P'){const dir=byColor==='white'?-1:1;if(dr===dir&&adc===1)return true}else if(piece==='N'){if((adr===2&&adc===1)||(adr===1&&adc===2))return true}else if(piece==='K'){if(adr<=1&&adc<=1&&(adr+adc>0))return true}if(piece==='B'||piece==='Q'){if(adr===adc&&adr>0){const sr=Math.sign(dr),sc=Math.sign(dc);let clear=true,tr=r+sr,tc=c+sc;while(tr!==row||tc!==col){if(board[tr][tc]!==' '){clear=false;break}tr+=sr;tc+=sc}if(clear)return true}}if(piece==='R'||piece==='Q'){if((dr===0||dc===0)&&(adr+adc>0)){const sr=Math.sign(dr),sc=Math.sign(dc);let clear=true,tr=r+sr,tc=c+sc;while(tr!==row||tc!==col){if(board[tr][tc]!==' '){clear=false;break}tr+=sr;tc+=sc}if(clear)return true}}}return false}
function isInCheck(board,color){const king=findKing(board,color);if(!king)return false;return isSquareAttacked(board,king[0],king[1],color==='white'?'black':'white')}
function makeMoveOnBoard(board,from,to,ep){const b=board.map(r=>[...r]);const piece=b[from[0]][from[1]];if(piece.toUpperCase()==='P'&&ep&&to[0]===ep[0]&&to[1]===ep[1])b[from[0]][to[1]]=' ';b[to[0]][to[1]]=piece;b[from[0]][from[1]]=' ';if(piece.toUpperCase()==='K'&&Math.abs(to[1]-from[1])===2){if(to[1]===6){b[from[0]][5]=b[from[0]][7];b[from[0]][7]=' '}else if(to[1]===2){b[from[0]][3]=b[from[0]][0];b[from[0]][0]=' '}}return b}
function getLegalMoves(state,row,col){const piece=state.board[row][col];if(piece===' ')return[];const color=pColor(piece);if(color!==state.turn)return[];const pseudo=pseudoMoves(state.board,row,col,state.castling,state.ep);const legal=[];for(const[tr,tc]of pseudo){if(piece.toUpperCase()==='K'&&Math.abs(tc-col)===2){const enemy=color==='white'?'black':'white';if(isInCheck(state.board,color))continue;if(isSquareAttacked(state.board,row,col+Math.sign(tc-col),enemy))continue;if(isSquareAttacked(state.board,row,tc,enemy))continue}const newBoard=makeMoveOnBoard(state.board,[row,col],[tr,tc],state.ep);if(!isInCheck(newBoard,color))legal.push([tr,tc])}return legal}
function hasAnyLegalMoves(state,color){for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(isOwn(state.board[r][c],color)&&getLegalMoves(state,r,c).length>0)return true;return false}
function getNotation(state,from,to,promotion){const piece=state.board[from[0]][from[1]];const type=piece.toUpperCase();const files='abcdefgh';const toStr=files[to[1]]+(8-to[0]);const captured=state.board[to[0]][to[1]]!==' '||(type==='P'&&state.ep&&to[0]===state.ep[0]&&to[1]===state.ep[1]);if(type==='K'&&Math.abs(to[1]-from[1])===2)return to[1]===6?'O-O':'O-O-O';let notation='';if(type==='P'){if(captured)notation=files[from[1]]+'x';notation+=toStr;if(promotion)notation+='='+promotion.toUpperCase()}else{notation=type;if(captured)notation+='x';notation+=toStr}const newBoard=makeMoveOnBoard(state.board,from,to,state.ep);if(promotion)newBoard[to[0]][to[1]]=state.turn==='white'?promotion.toUpperCase():promotion.toLowerCase();const enemy=state.turn==='white'?'black':'white';if(isInCheck(newBoard,enemy)){const tempState=cloneState(state);tempState.board=newBoard;tempState.turn=enemy;notation+=hasAnyLegalMoves(tempState,enemy)?'+':'#'}return notation}
function isInsufficientMaterial(board){const pieces={white:[],black:[]};for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=board[r][c];if(p===' ')continue;pieces[isW(p)?'white':'black'].push(p.toUpperCase())}const w=pieces.white.sort().join(''),b=pieces.black.sort().join('');if(w==='K'&&b==='K')return true;if((w==='BK'||w==='KN')&&b==='K')return true;if((b==='BK'||b==='KN')&&w==='K')return true;return false}
function executeMove(state,from,to,promotion){const piece=state.board[from[0]][from[1]];const type=piece.toUpperCase();const color=state.turn;const captured=state.board[to[0]][to[1]]!==' ';const notation=getNotation(state,from,to,promotion);state.board=makeMoveOnBoard(state.board,from,to,state.ep);if(type==='P'&&(to[0]===0||to[0]===7))state.board[to[0]][to[1]]=color==='white'?promotion.toUpperCase():promotion.toLowerCase();if(type==='K'){if(color==='white'){state.castling.K=false;state.castling.Q=false}else{state.castling.k=false;state.castling.q=false}}if(type==='R'){if(from[0]===7&&from[1]===7)state.castling.K=false;if(from[0]===7&&from[1]===0)state.castling.Q=false;if(from[0]===0&&from[1]===7)state.castling.k=false;if(from[0]===0&&from[1]===0)state.castling.q=false}if(to[0]===7&&to[1]===7)state.castling.K=false;if(to[0]===7&&to[1]===0)state.castling.Q=false;if(to[0]===0&&to[1]===7)state.castling.k=false;if(to[0]===0&&to[1]===0)state.castling.q=false;state.ep=(type==='P'&&Math.abs(to[0]-from[0])===2)?[(from[0]+to[0])/2,from[1]]:null;if(type==='P'||captured)state.halfMoves=0;else state.halfMoves++;state.lastMove={from,to};state.moves.push({from,to,notation});if(color==='black')state.fullMoves++;state.turn=color==='white'?'black':'white';if(!hasAnyLegalMoves(state,state.turn)){state.gameOver=true;state.result=isInCheck(state.board,state.turn)?{type:'checkmate',winner:color}:{type:'stalemate'}}else if(state.halfMoves>=100){state.gameOver=true;state.result={type:'fifty-move'}}else if(isInsufficientMaterial(state.board)){state.gameOver=true;state.result={type:'insufficient'}}return notation}
// Clock system
function getGameTimeMinutes(){if(selectedCompetitionId&&firebaseCompetitions[selectedCompetitionId])return parseInt(firebaseCompetitions[selectedCompetitionId].gameTimeMinutes,10)||10;return 10}
function initGameClock(state){const ms=getGameTimeMinutes()*60*1000;state.clock={whiteMs:ms,blackMs:ms,turnStartedAt:Date.now()};if(!state.gameStartedAt)state.gameStartedAt=Date.now()}
function applyElapsedToActiveClock(state,now=Date.now()){if(!state||!state.clock||state.gameOver)return;const key=state.turn==='white'?'whiteMs':'blackMs';const elapsed=Math.max(0,now-(state.clock.turnStartedAt||now));state.clock[key]=Math.max(0,(state.clock[key]||0)-elapsed);state.clock.turnStartedAt=now}
function formatClock(ms){const t=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')}
function renderCompetitionCountdown(){const wrap=$('competitionCountdown'),val=$('competitionCountdownVal'),comp=selectedCompetitionId?firebaseCompetitions[selectedCompetitionId]:null;if(!comp||!comp.endTime||comp.openEnded){wrap.style.display='none';return}const remaining=new Date(comp.endTime).getTime()-Date.now();if(remaining<=0){wrap.style.display='none';return}wrap.style.display='';val.textContent=formatClock(remaining)}
function getDisplayClockMs(color){if(!gameState||!gameState.clock)return 10*60*1000;let ms=gameState.clock[color==='white'?'whiteMs':'blackMs']||0;if(!gameState.gameOver&&gameState.turn===color){const elapsed=Date.now()-(gameState.clock.turnStartedAt||Date.now());ms=Math.max(0,ms-elapsed)}return ms}
function renderClockUI(){const topColor=isFlipped?'white':'black',bottomColor=isFlipped?'black':'white';$('topClockLabel').textContent=topColor==='white'?'White':'Black';$('bottomClockLabel').textContent=bottomColor==='white'?'White':'Black';const topMs=getDisplayClockMs(topColor),bottomMs=getDisplayClockMs(bottomColor);$('topClock').textContent=formatClock(topMs);$('bottomClock').textContent=formatClock(bottomMs);$('topClockWrap').classList.toggle('active',!gameState.gameOver&&gameState.turn===topColor);$('bottomClockWrap').classList.toggle('active',!gameState.gameOver&&gameState.turn===bottomColor);$('topClockWrap').classList.toggle('expired',topMs<=0);$('bottomClockWrap').classList.toggle('expired',bottomMs<=0);$('topClockWrap').classList.toggle('timer-warning',topMs<=60000&&topMs>10000);$('bottomClockWrap').classList.toggle('timer-warning',bottomMs<=60000&&bottomMs>10000);$('topClockWrap').classList.toggle('timer-critical',topMs<=10000&&topMs>0);$('bottomClockWrap').classList.toggle('timer-critical',bottomMs<=10000&&bottomMs>0)}
function stopGameClock(){if(gameClockInterval){clearInterval(gameClockInterval);gameClockInterval=null}}
function finishByTimeout(loserColor){if(!gameState||gameState.gameOver)return;gameState.gameOver=true;gameState.result={type:'timeout',winner:loserColor==='white'?'black':'white',loser:loserColor};if(gameState.isOnline)syncMoveToFirebase();updateStatus();recordMatchResult();showGameOver()}
function startGameClock(){stopGameClock();renderClockUI();gameClockInterval=setInterval(()=>{if(!gameState||!gameState.clock||gameState.gameOver)return;renderClockUI();renderCompetitionCountdown();if(getDisplayClockMs('white')<=0)finishByTimeout('white');else if(getDisplayClockMs('black')<=0)finishByTimeout('black')},250)}

// Firebase helpers
function boardToString(board){return board.map(row=>row.join('')).join('/')}
function stringToBoard(str){return str.split('/').map(row=>row.split(''))}
function serializeGameState(state){const data={board:boardToString(state.board),turn:state.turn,castling:state.castling,halfMoves:state.halfMoves,fullMoves:state.fullMoves,moves:state.moves.length>0?state.moves:[],gameOver:state.gameOver||false};if(state.ep)data.ep=state.ep;if(state.lastMove)data.lastMove=state.lastMove;if(state.result)data.result=state.result;if(state.clock)data.clock=state.clock;if(state.gameStartedAt)data.gameStartedAt=state.gameStartedAt;return data}
function deserializeGameState(data){return{board:stringToBoard(data.board),turn:data.turn,castling:data.castling,ep:data.ep||null,halfMoves:data.halfMoves||0,fullMoves:data.fullMoves||1,moves:data.moves||[],lastMove:data.lastMove||null,gameOver:data.gameOver||false,result:data.result||null,clock:data.clock||null,gameStartedAt:data.gameStartedAt||null}}

// Match recording
function getSuspicionFlags(matchData){
  const reasons=[];
  const count=matchData.moveCount||0;
  const type=matchData.resultType||'';
  if(count<6){
    reasons.push('Only '+count+' move'+(count===1?'':'s')+' played');
  }else if(count<15&&type==='resign'){
    reasons.push('Early resign after just '+count+' moves');
  }
  const duration=matchData.completedAt-matchData.startTime;
  if(duration>0&&duration<60000)reasons.push('Game lasted under 1 minute');
  return{suspicious:reasons.length>0,reasons};
}

function persistMatchResult(matchId,matchData,wp,bp){
  const flags=getSuspicionFlags(matchData);
  if(flags.suspicious){matchData.suspicious=true;matchData.suspicionReasons=flags.reasons;}
  db.ref('matches/'+matchId).set(matchData);
  if(!matchData.competitionId)return;
  if(flags.suspicious)return; // points withheld pending integrity review

  const pw=firebaseSettings.pointsWin||3,pd=firebaseSettings.pointsDraw||2,pl=firebaseSettings.pointsLoss||1;
  if(matchData.result==='draw'){
    updatePlayerStats(wp.id,wp,'draw',pd,matchData.competitionId);
    updatePlayerStats(bp.id,bp,'draw',pd,matchData.competitionId);
  }else{
    const winner=matchData.result==='white'?wp:bp,loser=matchData.result==='white'?bp:wp;
    updatePlayerStats(winner.id,winner,'win',pw,matchData.competitionId);
    updatePlayerStats(loser.id,loser,'loss',pl,matchData.competitionId);
  }
}

function recordMatchResult(){
  if(!gameState||!gameState.result||gameState.matchRecorded)return;

  const result=gameState.result,wp=gameState.whitePlayer,bp=gameState.blackPlayer;
  if(gameState.opponent&&gameState.opponent.isBot)return;

  const matchData={
    whiteId:wp.id,
    whiteName:wp.nickname,
    whiteSchool:wp.school,
    blackId:bp.id,
    blackName:bp.nickname,
    blackSchool:bp.school,
    result:(result.type==='checkmate'||result.type==='resign'||result.type==='timeout'||result.type==='abandon')&&result.winner?result.winner:'draw',
    resultType:result.type,
    moveCount:gameState.moves.length,
    moves:gameState.moves||[],
    competitionId:selectedCompetitionId||null,
    createdAt:Date.now(),
    startTime:gameState.gameStartedAt||Date.now(),
    completedAt:Date.now()
  };

  gameState.matchRecorded=true;

  // Online games run on two clients; use a transaction lock so only one side records result/points.
  if(gameState.isOnline&&currentGameId){
    const lockRef=db.ref('games/'+currentGameId+'/resultRecorded');
    lockRef.transaction(v=>v===true?v:true,(error,committed)=>{
      if(error||!committed)return;
      persistMatchResult(currentGameId,matchData,wp,bp);
    });
    return;
  }

  const matchId=Date.now().toString(36)+Math.random().toString(36).substr(2,6);
  persistMatchResult(matchId,matchData,wp,bp);
}

function updatePlayerStats(playerId,player,outcome,points,competitionId){if(!competitionId)return;const ref=db.ref('players/'+playerId);ref.once('value').then(snap=>{const data=snap.val()||{name:player.nickname,school:player.school,yearName:player.year||player.yearName,wins:0,losses:0,draws:0,points:0};data.name=player.nickname;data.school=player.school;data.yearName=player.year||player.yearName;if(outcome==='win')data.wins=(data.wins||0)+1;else if(outcome==='loss')data.losses=(data.losses||0)+1;else data.draws=(data.draws||0)+1;data.points=(data.points||0)+points;ref.set(data)})}

// Modal helpers
function showMasterConfirm(message){return new Promise(resolve=>{const modal=$('masterConfirmModal'),ok=$('masterConfirmOk'),cancel=$('masterConfirmCancel');$('masterConfirmMessage').textContent=message;modal.classList.add('active');const cleanup=()=>{modal.classList.remove('active');ok.removeEventListener('click',onOk);cancel.removeEventListener('click',onCancel);modal.removeEventListener('click',onBackdrop)};const onOk=()=>{cleanup();resolve(true)};const onCancel=()=>{cleanup();resolve(false)};const onBackdrop=e=>{if(e.target===modal){cleanup();resolve(false)}};ok.addEventListener('click',onOk);cancel.addEventListener('click',onCancel);modal.addEventListener('click',onBackdrop)})}
function showMasterNotice(message){return new Promise(resolve=>{const modal=$('masterNoticeModal'),ok=$('masterNoticeOk');$('masterNoticeMessage').textContent=message;modal.classList.add('active');const cleanup=()=>{modal.classList.remove('active');ok.removeEventListener('click',onOk)};const onOk=()=>{cleanup();resolve(true)};ok.addEventListener('click',onOk)})}
function showDisconnectOutcomeModal(){return new Promise(resolve=>{const modal=$('disconnectOutcomeModal'),winBtn=$('disconnectOutcomeWin'),drawBtn=$('disconnectOutcomeDraw'),loseBtn=$('disconnectOutcomeLose');modal.classList.add('active');const cleanup=()=>{modal.classList.remove('active');winBtn.removeEventListener('click',onWin);drawBtn.removeEventListener('click',onDraw);loseBtn.removeEventListener('click',onLose)};const onWin=()=>{cleanup();resolve('win')};const onDraw=()=>{cleanup();resolve('draw')};const onLose=()=>{cleanup();resolve('lose')};winBtn.addEventListener('click',onWin);drawBtn.addEventListener('click',onDraw);loseBtn.addEventListener('click',onLose)})}

function animatePieceSlide(from,to,piece){isAnimating=true;if(!smoothSlideEnabled||!piece||piece===' '){isAnimating=false;return Promise.resolve();}const board=$('chessBoard');if(!board){isAnimating=false;return Promise.resolve();}const fromSq=board.querySelector(`.square[data-row="${from[0]}"][data-col="${from[1]}"]`);const toSq=board.querySelector(`.square[data-row="${to[0]}"][data-col="${to[1]}"]`);if(!fromSq||!toSq){isAnimating=false;return Promise.resolve();}const boardRect=board.getBoundingClientRect(),fromRect=fromSq.getBoundingClientRect(),toRect=toSq.getBoundingClientRect();const ghost=document.createElement('img');ghost.src=PIX[piece];ghost.alt=piece;ghost.className='piece';ghost.style.position='absolute';ghost.style.width=fromRect.width+'px';ghost.style.height=fromRect.height+'px';ghost.style.left=(fromRect.left-boardRect.left)+'px';ghost.style.top=(fromRect.top-boardRect.top)+'px';ghost.style.zIndex='40';ghost.style.pointerEvents='none';ghost.style.transition='transform 170ms cubic-bezier(.22,.61,.36,1)';board.appendChild(ghost);const dx=toRect.left-fromRect.left,dy=toRect.top-fromRect.top;return new Promise(resolve=>{requestAnimationFrame(()=>{ghost.style.transform=`translate(${dx}px, ${dy}px)`});setTimeout(()=>{isAnimating=false;ghost.remove();resolve()},190)})}

// Login
function checkForActiveGame(){
  const stored=localStorage.getItem('ies_chess_active_game');
  if(!stored)return;
  let session;
  try{session=JSON.parse(stored)}catch(e){localStorage.removeItem('ies_chess_active_game');return}
  if(!session.gameId||!session.playerId){localStorage.removeItem('ies_chess_active_game');return}
  db.ref('games/'+session.gameId).once('value').then(snap=>{
    const data=snap.val();
    if(!data||!data.state||data.state.gameOver){localStorage.removeItem('ies_chess_active_game');return}
    const opponentData=data.host&&data.host.id===session.playerId?data.guest:data.host;
    const opponentName=opponentData?opponentData.nickname:'opponent';
    $('resumeGameInfo').textContent=session.nickname+' vs '+opponentName;
    $('resumeBanner').style.display='';
  }).catch(()=>localStorage.removeItem('ies_chess_active_game'));
}
function initLogin(){
  document.querySelectorAll('.toggle-option').forEach(opt=>{opt.addEventListener('click',()=>{document.querySelectorAll('.toggle-option').forEach(o=>o.classList.remove('active'));opt.classList.add('active');gameMode=opt.dataset.mode;$('difficultyGroup').style.display=gameMode==='computer'?'':'none';populateCompetitions()})});
  $('computerDifficulty').addEventListener('change',e=>{computerDifficulty=e.target.value});
  $('pinInput').addEventListener('input',()=>{const schoolId=lockedSchoolId||$('schoolSelect').value;if(schoolId)updateLoginAccessState(schoolId);});
  $('joinBtn').addEventListener('click',()=>{const schoolId=$('schoolSelect').value,yearId=$('yearSelect').value,school=firebaseSchools[schoolId];if(!school)return;const yearData=school.years||school.classes;const cls=yearData?yearData[yearId]:null;if(!cls)return;const accessSettings=(school.settings&&school.settings.access)||{};if(accessSettings.enforceToken&&lockedSchoolId!==schoolId){return;}if(accessSettings.pinEnabled){const entered=($('pinInput').value||'').trim();if(entered!==String(accessSettings.pinCode||'')){$('pinInput').style.borderColor='var(--accent)';setTimeout(()=>{$('pinInput').style.borderColor='';},1200);showMasterNotice('Incorrect PIN. Please try again.');return;}};const nickname=CONFIG.nicknamePrefix+CONFIG.nicknames[playerCounter%CONFIG.nicknames.length];playerCounter++;currentPlayer={id:'p_'+Date.now()+'_'+Math.random().toString(36).substr(2,9),nickname,school:school.name,schoolId,year:cls.name,yearId,color:null};applyAppearance(getEffectiveAppearanceForSchool(schoolId));enterLobby()});
  $('ladderMatchBtn').addEventListener('click',()=>{const schoolId=lockedSchoolId||$('schoolSelect').value,yearId=$('yearSelect').value,school=firebaseSchools[schoolId];if(!school)return;const yearData=school.years||school.classes;const cls=yearData?yearData[yearId]:null;if(!cls){alert('Please select your year first.');return;}const nickname=CONFIG.nicknamePrefix+CONFIG.nicknames[playerCounter%CONFIG.nicknames.length];playerCounter++;currentPlayer={id:'p_'+Date.now()+'_'+Math.random().toString(36).substr(2,9),nickname,school:school.name,schoolId,year:cls.name,yearId,color:null};applyAppearance(getEffectiveAppearanceForSchool(schoolId));enterLadderLobby();});
  $('resumeBtn').addEventListener('click',()=>{
    const stored=localStorage.getItem('ies_chess_active_game');
    if(!stored)return;
    let session;
    try{session=JSON.parse(stored)}catch(e){localStorage.removeItem('ies_chess_active_game');$('resumeBanner').style.display='none';return}
    db.ref('games/'+session.gameId).once('value').then(snap=>{
      const data=snap.val();
      if(!data||!data.state||data.state.gameOver){localStorage.removeItem('ies_chess_active_game');$('resumeBanner').style.display='none';return}
      currentPlayer={id:session.playerId,nickname:session.nickname,school:session.school,schoolId:session.schoolId,year:session.year,yearId:session.yearId,color:session.color};
      selectedCompetitionId=session.competitionId||null;
      isHost=!!(data.host&&data.host.id===session.playerId);
      const opponentData=isHost?data.guest:data.host;
      const opponent={id:opponentData.id,nickname:opponentData.nickname,school:opponentData.school,year:opponentData.year,isBot:false};
      applyAppearance(getEffectiveAppearanceForSchool(session.schoolId));
      startOnlineGame(opponent,data);
    }).catch(err=>{console.error('Resume failed:',err);localStorage.removeItem('ies_chess_active_game');$('resumeBanner').style.display='none'});
  });
  $('abandonResumeBtn').addEventListener('click',()=>{localStorage.removeItem('ies_chess_active_game');$('resumeBanner').style.display='none'});
  loadFirebaseData();
  checkForActiveGame();
}

// Lobby
function enterLobby(){
  $('lobbyPlayerName').textContent=currentPlayer.nickname;$('lobbyPlayerSchool').textContent=currentPlayer.school+' · Year '+currentPlayer.year;
  if(selectedCompetitionId&&firebaseCompetitions[selectedCompetitionId]){const comp=firebaseCompetitions[selectedCompetitionId];if(!isCompAvailableNow(comp)){const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];let msg='This competition is not available right now.';if(comp.scheduleEnabled){const parts=[];if(comp.availableDays&&comp.availableDays.length>0){const dayList=comp.availableDays.map(d=>DAY_NAMES[d]).join(', ');parts.push('Days: '+dayList)}if(comp.availableFrom&&comp.availableUntil){parts.push('Time: '+comp.availableFrom+' – '+comp.availableUntil)}if(parts.length>0)msg='This competition is only available on: '+parts.join(' | ')}showMasterNotice(msg).then(()=>{returnToHome()});return}const rYear=(comp.matchRules||{}).restrictedYear;if(rYear&&(currentPlayer.year||'').toString().trim()!==rYear.toString().trim()){showMasterNotice('This competition is only open to Year '+rYear+' students.').then(()=>{returnToHome()});return}$('lobbyCompBadge').style.display='';$('lobbyCompName').textContent=comp.name}else{$('lobbyCompBadge').style.display='none'}
  if(gameMode==='computer'){$('gameModeIndicator').querySelector('.icon').textContent='🤖';$('gameModeText').textContent='Playing vs Computer';$('lobbyStatus').textContent='Starting game...';$('lobbyHint').textContent='You\'ll play against the computer.'}else{$('gameModeIndicator').querySelector('.icon').textContent='👥';$('gameModeText').textContent='Playing vs Student';$('lobbyStatus').textContent='Looking for an opponent...';if(matchRoomId&&matchRoomSchoolA&&matchRoomSchoolB){const schoolAName=(firebaseSchools[matchRoomSchoolA]?.name)||matchRoomSchoolA;const schoolBName=(firebaseSchools[matchRoomSchoolB]?.name)||matchRoomSchoolB;$('lobbyHint').textContent='Waiting for a player from the other school to join the match room ('+schoolAName+' vs '+schoolBName+')...'}else{$('lobbyHint').textContent='Waiting for another student to join...'}}
  $('waitingAnim').style.display='flex';showScreen('lobby');
  if(gameMode==='computer'){setTimeout(()=>{if(!gameState)startComputerGame()},1000)}else{findOnlineMatch()}
}
function startComputerGame(){$('lobbyStatus').textContent='Starting game...';$('waitingAnim').style.display='none';setTimeout(()=>startGame({id:'computer',nickname:'Computer',school:'AI',year:'Engine',isBot:true},true),500)}

// Matchmaking
function findOnlineMatch(){
  let lobbyPath;

  // Match room link takes highest priority — pairs players from the two schools in a dedicated room
  if(matchRoomId){
    lobbyPath='lobby/room/'+matchRoomId;
    lobbyRef=db.ref(lobbyPath);
    lobbyRef.once('value').then(snapshot=>{const wp=snapshot.val();const now=Date.now();if(wp)Object.entries(wp).forEach(([pid,pdata])=>{if(pdata.timestamp&&(now-pdata.timestamp)>120000)lobbyRef.child(pid).remove()});return lobbyRef.once('value')}).then(snapshot=>{const wp=snapshot.val();if(wp){const availableId=Object.keys(wp).find(id=>{if(id===currentPlayer.id)return false;const pdata=wp[id];if(matchRoomSchoolA&&matchRoomSchoolB&&pdata.schoolId&&currentPlayer.schoolId)return pdata.schoolId!==currentPlayer.schoolId;return true;});if(availableId){joinExistingGame(wp[availableId],availableId);return}}addToLobby()});
    return;
  }

  const activeComp=selectedCompetitionId?firebaseCompetitions[selectedCompetitionId]:null;

  if(activeComp){
    const rules=activeComp.matchRules||{};
    const legacyType=activeComp.type;
    const isOpen=rules.open||legacyType==='open'||legacyType==='school'||legacyType==='tournament';
    const isSameYear=rules.sameYear||legacyType==='class';

    // Use year name (not school-specific year key) so same-year cross-school matching works.
    const yearBucket=(currentPlayer.year||'').toString().trim().toLowerCase().replace(/\s+/g,'-')||'unknown';

    if(isOpen){
      lobbyPath='lobby/comp/'+selectedCompetitionId+'/open';
    }else{
      lobbyPath='lobby/comp/'+selectedCompetitionId+'/school/'+currentPlayer.schoolId;
    }

    if(isSameYear){
      lobbyPath+='/year/'+yearBucket;
    }
  }else{
    const sameYear=firebaseSettings.sameYearMatchOnly===true,sameSchool=firebaseSettings.sameSchoolMatchOnly!==false;
    if(sameYear)lobbyPath='lobby/'+currentPlayer.schoolId+'/'+currentPlayer.yearId;
    else if(sameSchool)lobbyPath='lobby/'+currentPlayer.schoolId+'/all';
    else lobbyPath='lobby/global';
  }

  lobbyRef=db.ref(lobbyPath);
  lobbyRef.once('value').then(snapshot=>{const wp=snapshot.val();const now=Date.now();if(wp)Object.entries(wp).forEach(([pid,pdata])=>{if(pdata.timestamp&&(now-pdata.timestamp)>120000)lobbyRef.child(pid).remove()});return lobbyRef.once('value')}).then(snapshot=>{const wp=snapshot.val();if(wp){const availableId=Object.keys(wp).find(id=>id!==currentPlayer.id);if(availableId){joinExistingGame(wp[availableId],availableId);return}}addToLobby()});
}
function addToLobby(){isHost=true;const playerRef=lobbyRef.child(currentPlayer.id);playerRef.set({id:currentPlayer.id,nickname:currentPlayer.nickname,school:currentPlayer.school,schoolId:currentPlayer.schoolId||null,year:currentPlayer.year,yearId:currentPlayer.yearId,timestamp:firebase.database.ServerValue.TIMESTAMP});playerRef.onDisconnect().remove();gameRef=db.ref('games/'+currentPlayer.id);gameRef.on('value',snapshot=>{const data=snapshot.val();if(data&&data.guest&&!gameState){playerRef.remove();const opponent={id:data.guest.id,nickname:data.guest.nickname,school:data.guest.school,year:data.guest.year,isBot:false};$('lobbyStatus').textContent='Matched with '+opponent.nickname+'!';$('waitingAnim').style.display='none';setTimeout(()=>{currentPlayer.color='white';startOnlineGame(opponent,data)},800)}})}
function joinExistingGame(hostData,hostId){isHost=false;lobbyRef.child(hostId).remove();lobbyRef.child(currentPlayer.id).remove();const initialState=newGameState();initGameClock(initialState);gameRef=db.ref('games/'+hostData.id);const gameData={host:{id:hostData.id,nickname:hostData.nickname,school:hostData.school,year:hostData.year},guest:{id:currentPlayer.id,nickname:currentPlayer.nickname,school:currentPlayer.school,year:currentPlayer.year},state:serializeGameState(initialState),competitionId:selectedCompetitionId||null,createdAt:firebase.database.ServerValue.TIMESTAMP};gameRef.set(gameData).then(()=>{const opponent={id:hostData.id,nickname:hostData.nickname,school:hostData.school,year:hostData.year,isBot:false};$('lobbyStatus').textContent='Matched with '+opponent.nickname+'!';$('waitingAnim').style.display='none';setTimeout(()=>{currentPlayer.color='black';startOnlineGame(opponent,gameData)},800)})}

// Game start
function setupPlayerDisplay(wp,bp){if(isFlipped){$('topPlayerName').textContent=wp.nickname;$('topPlayerSchool').textContent=wp.school+(wp.year&&wp.year!=='Engine'?' · Year '+wp.year:'');$('topPlayerIcon').src=PIX['K'];$('bottomPlayerName').textContent=bp.nickname;$('bottomPlayerSchool').textContent=bp.school+(bp.year&&bp.year!=='Engine'?' · Year '+bp.year:'');$('bottomPlayerIcon').src=PIX['k']}else{$('topPlayerName').textContent=bp.nickname;$('topPlayerSchool').textContent=bp.school+(bp.year&&bp.year!=='Engine'?' · Year '+bp.year:'');$('topPlayerIcon').src=PIX['k'];$('bottomPlayerName').textContent=wp.nickname;$('bottomPlayerSchool').textContent=wp.school+(wp.year&&wp.year!=='Engine'?' · Year '+wp.year:'');$('bottomPlayerIcon').src=PIX['K']}}
function startOnlineGame(opponent,gameData){pendingPremove=null;currentGameId=isHost?currentPlayer.id:opponent.id;localStorage.setItem('ies_chess_active_game',JSON.stringify({gameId:currentGameId,playerId:currentPlayer.id,nickname:currentPlayer.nickname,school:currentPlayer.school,schoolId:currentPlayer.schoolId,year:currentPlayer.year,yearId:currentPlayer.yearId,color:currentPlayer.color,competitionId:selectedCompetitionId||null}));isFlipped=currentPlayer.color==='black';const wp=currentPlayer.color==='white'?currentPlayer:opponent,bp=currentPlayer.color==='black'?currentPlayer:opponent;setupPlayerDisplay(wp,bp);gameState=gameData.state?deserializeGameState(gameData.state):newGameState();if(!gameState.clock)initGameClock(gameState);gameState.whitePlayer=wp;gameState.blackPlayer=bp;gameState.opponent=opponent;gameState.isOnline=true;selectedSquare=null;validMoves=[];if(currentPlayer.schoolId){applyAppearance(getEffectiveAppearanceForSchool(currentPlayer.schoolId));}showScreen('game');renderBoard();updateStatus();renderMoveLog();renderClockUI();renderCompetitionCountdown();$('resignBtn').style.display='';$('drawBtn').style.display='';$('newGameBtn').style.display='none';$('gotToGoBtn').style.display='';if(!gameRef)gameRef=db.ref('games/'+currentGameId);gameRef.child('presence/'+currentPlayer.id).onDisconnect().set({online:false,disconnectedAt:firebase.database.ServerValue.TIMESTAMP});gameRef.child('presence/'+currentPlayer.id).set({online:true});startGameClock();listenForMoves();listenForPauseState();listenForGotToGoOffer()}
function tryExecutePremove(){
  if(!pendingPremove||!pendingPremove.to)return;
  if(gameState.turn!==currentPlayer.color)return;
  const{from,to}=pendingPremove;
  pendingPremove=null;
  const piece=gameState.board[from[0]][from[1]];
  if(!piece||piece===' '||!isOwn(piece,currentPlayer.color))return;
  const legal=getLegalMoves(gameState,from[0],from[1]);
  if(!legal.some(m=>m[0]===to[0]&&m[1]===to[1]))return; // illegal after opponent's move — silently cancel
  if(piece.toUpperCase()==='P'&&(to[0]===0||to[0]===7)){showPromotionModal(from,to);return;}
  doMove(from,to);
}
function listenForMoves(){if(!gameRef)return;gameRef.child('state').on('value',snapshot=>{const data=snapshot.val();if(!data||!gameState)return;const ns=deserializeGameState(data);if(ns.moves.length!==gameState.moves.length||ns.gameOver!==gameState.gameOver){const wp=gameState.whitePlayer,bp=gameState.blackPlayer,opp=gameState.opponent;gameState=ns;gameState.whitePlayer=wp;gameState.blackPlayer=bp;gameState.opponent=opp;gameState.isOnline=true;selectedSquare=null;validMoves=[];if(!isAnimating){renderBoard();updateStatus();renderMoveLog();renderClockUI();renderCompetitionCountdown();if(gameState.gameOver){recordMatchResult();showGameOver()}else{tryExecutePremove();}}}});const opponentId=gameState.opponent?gameState.opponent.id:null;if(opponentId&&opponentId!=='computer'){gameRef.child('presence/'+opponentId).on('value',snap=>{const presence=snap.val();if(presence&&presence.online===false&&!gameState.gameOver){if(!disconnectTimer){updateStatus('⚠️ Opponent disconnected — waiting 30s for reconnect...');disconnectTimer=setTimeout(async()=>{if(disconnectTimer&&!gameState.gameOver){disconnectTimer=null;const choice=await showDisconnectOutcomeModal();gameState.gameOver=true;if(choice==='win'){gameState.result={type:'abandon',winner:currentPlayer.color}}else if(choice==='draw'){gameState.result={type:'abandon_draw'}}else{gameState.result={type:'abandon',winner:currentPlayer.color==='white'?'black':'white'}}recordMatchResult();showGameOver()}},30000)}}else if(presence&&presence.online===true){if(disconnectTimer){clearTimeout(disconnectTimer);disconnectTimer=null;updateStatus()}}})}}
function syncMoveToFirebase(){if(!gameRef||!gameState.isOnline)return;gameRef.child('state').set(serializeGameState(gameState))}
function startGame(opponent,isComputer=false){const whiteIsMe=Math.random()<0.5;currentPlayer.color=whiteIsMe?'white':'black';isFlipped=!whiteIsMe;const wp=whiteIsMe?currentPlayer:opponent,bp=whiteIsMe?opponent:currentPlayer;setupPlayerDisplay(wp,bp);gameState=newGameState();initGameClock(gameState);gameState.whitePlayer=wp;gameState.blackPlayer=bp;gameState.opponent=opponent;gameState.isOnline=false;selectedSquare=null;validMoves=[];if(currentPlayer.schoolId){applyAppearance(getEffectiveAppearanceForSchool(currentPlayer.schoolId));}showScreen('game');renderBoard();updateStatus();renderClockUI();renderCompetitionCountdown();$('movesContainer').innerHTML='';$('resignBtn').style.display='';$('drawBtn').style.display='';$('newGameBtn').style.display='none';$('gotToGoBtn').style.display='none';startGameClock();listenForPauseState();if(isComputer&&opponent.isBot&&gameState.turn!==currentPlayer.color)setTimeout(botMove,500)}

// Board rendering
function renderBoard(){const board=$('chessBoard');board.innerHTML='';for(let vr=0;vr<8;vr++)for(let vc=0;vc<8;vc++){const r=isFlipped?(7-vr):vr,c=isFlipped?(7-vc):vc;const isLight=(r+c)%2===0;const sq=document.createElement('div');sq.className='square '+(isLight?'light':'dark');sq.dataset.row=r;sq.dataset.col=c;if(selectedSquare&&selectedSquare[0]===r&&selectedSquare[1]===c)sq.classList.add('selected');if(gameState.lastMove){const lm=gameState.lastMove;if((lm.from[0]===r&&lm.from[1]===c)||(lm.to[0]===r&&lm.to[1]===c))sq.classList.add('last-move')}const isValidTarget=validMoves.some(m=>m[0]===r&&m[1]===c);if(isValidTarget){const hasEnemy=gameState.board[r][c]!==' '||(gameState.ep&&gameState.ep[0]===r&&gameState.ep[1]===c&&selectedSquare&&gameState.board[selectedSquare[0]][selectedSquare[1]].toUpperCase()==='P');sq.classList.add(hasEnemy?'valid-capture':'valid-move')}if(pendingPremove){if(pendingPremove.from[0]===r&&pendingPremove.from[1]===c)sq.classList.add('premove-from');if(pendingPremove.to&&pendingPremove.to[0]===r&&pendingPremove.to[1]===c)sq.classList.add('premove-to')}if(gameState.board[r][c]!==' ')sq.innerHTML=pieceImgHTML(gameState.board[r][c]);sq.addEventListener('click',()=>handleSquareClick(r,c));sq.addEventListener('contextmenu',e=>{e.preventDefault();if(pendingPremove){pendingPremove=null;renderBoard();}});board.appendChild(sq)};renderBoardCoordinates();updateCapturedPieces()}
function handleSquareClick(row,col){if(gamePaused)return;if(gameState.gameOver)return;
// Premove: capture clicks during opponent's turn (online games only)
if(gameState.isOnline&&gameState.turn!==currentPlayer.color){
  const piece=gameState.board[row][col];
  const myColor=currentPlayer.color;
  if(pendingPremove){
    // Second click — set destination if different from source, else cancel
    if(row===pendingPremove.from[0]&&col===pendingPremove.from[1]){pendingPremove=null;renderBoard();return;}
    pendingPremove.to=[row,col];
    renderBoard();
    showPremoveTooltip();
    return;
  }
  if(isOwn(piece,myColor)){pendingPremove={from:[row,col],to:null};renderBoard();}
  return;
}
if(!gameState.isOnline&&gameState.opponent&&gameState.opponent.isBot&&gameState.turn!==currentPlayer.color)return;
const piece=gameState.board[row][col];if(selectedSquare){if(selectedSquare[0]===row&&selectedSquare[1]===col){selectedSquare=null;validMoves=[];renderBoard();return}const isValid=validMoves.some(m=>m[0]===row&&m[1]===col);if(isValid){const mp=gameState.board[selectedSquare[0]][selectedSquare[1]];if(mp.toUpperCase()==='P'&&(row===0||row===7)){showPromotionModal(selectedSquare,[row,col]);return}doMove(selectedSquare,[row,col]);return}}if(isOwn(piece,gameState.turn)){selectedSquare=[row,col];validMoves=getLegalMoves(gameState,row,col);renderBoard();return}selectedSquare=null;validMoves=[];renderBoard()}
async function doMove(from,to,promotion){const movingPiece=gameState.board[from[0]][from[1]];await animatePieceSlide(from,to,movingPiece);applyElapsedToActiveClock(gameState);const notation=executeMove(gameState,from,to,promotion||'q');if(!gameState.gameOver&&gameState.clock)gameState.clock.turnStartedAt=Date.now();selectedSquare=null;validMoves=[];renderBoard();updateStatus();addMoveToLog(notation);renderClockUI();if(gameState.isOnline)syncMoveToFirebase();if(gameState.gameOver){recordMatchResult();showGameOver()}else if(!gameState.isOnline&&gameState.opponent&&gameState.opponent.isBot)setTimeout(botMove,500)}

// Bot AI - Piece-Square Tables
const PST={
  p:[[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
  n:[[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
  b:[[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
  r:[[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
  q:[[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
  k:[[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]],
  k_endgame:[[-50,-40,-30,-20,-20,-30,-40,-50],[-30,-20,-10,0,0,-10,-20,-30],[-30,-10,20,30,30,20,-10,-30],[-30,-10,30,40,40,30,-10,-30],[-30,-10,30,40,40,30,-10,-30],[-30,-10,20,30,30,20,-10,-30],[-30,-30,0,0,0,0,-30,-30],[-50,-30,-30,-30,-30,-30,-30,-50]]
};
function pieceValue(piece){const t=piece.toUpperCase();return t==='P'?100:t==='N'||t==='B'?320:t==='R'?500:t==='Q'?900:t==='K'?20000:0}
function getPST(piece,row,col,isEndgame){const type=piece.toLowerCase();const table=type==='k'&&isEndgame?PST.k_endgame:PST[type];if(!table)return 0;const r=piece===piece.toUpperCase()?7-row:row;return table[r][col]}
function isEndgame(state){let queens=0,minors=0;for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=state.board[r][c].toUpperCase();if(p==='Q')queens++;if(p==='N'||p==='B')minors++}return queens===0||(queens===2&&minors<=1)}
function evaluateBoard(state,color){let score=0;const endgame=isEndgame(state);for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=state.board[r][c];if(p===' ')continue;const val=pieceValue(p)+getPST(p,r,c,endgame);score+=pColor(p)===color?val:-val}return score}
function getAllMoves(state,color){const moves=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(isOwn(state.board[r][c],color))getLegalMoves(state,r,c).forEach(m=>moves.push({from:[r,c],to:m,capture:state.board[m[0]][m[1]]!==' '}));return moves}
function orderMoves(moves,state){return moves.sort((a,b)=>{if(a.capture&&!b.capture)return-1;if(!a.capture&&b.capture)return 1;if(a.capture&&b.capture){const aVal=pieceValue(state.board[a.to[0]][a.to[1]]);const bVal=pieceValue(state.board[b.to[0]][b.to[1]]);return bVal-aVal}return 0})}
function minimax(state,depth,alpha,beta,maximizing,color,useOrdering){if(depth===0||state.gameOver){return evaluateBoard(state,color)}let moves=getAllMoves(state,maximizing?color:(color==='white'?'black':'white'));if(moves.length===0){const currentPlayer=maximizing?color:(color==='white'?'black':'white');if(isInCheck(state.board,currentPlayer)){return maximizing?-999999:999999}return 0}if(useOrdering)moves=orderMoves(moves,state);if(maximizing){let maxEval=-Infinity;for(const move of moves){const clone=cloneState(state);executeMove(clone,move.from,move.to,'q');const evaluation=minimax(clone,depth-1,alpha,beta,false,color,useOrdering);maxEval=Math.max(maxEval,evaluation);alpha=Math.max(alpha,evaluation);if(beta<=alpha)break}return maxEval}else{let minEval=Infinity;for(const move of moves){const clone=cloneState(state);executeMove(clone,move.from,move.to,'q');const evaluation=minimax(clone,depth-1,alpha,beta,true,color,useOrdering);minEval=Math.min(minEval,evaluation);beta=Math.min(beta,evaluation);if(beta<=alpha)break}return minEval}}
async function botMove(){if(gameState.gameOver||gameState.turn===currentPlayer.color)return;const color=gameState.turn;const allMoves=getAllMoves(gameState,color);if(allMoves.length===0)return;let chosen;if(computerDifficulty==='beginner'){chosen=allMoves[Math.floor(Math.random()*allMoves.length)]}else{const config={easy:{depth:2,ordering:false},medium:{depth:3,ordering:false},hard:{depth:4,ordering:true},expert:{depth:5,ordering:true}}[computerDifficulty];const depth=config.depth;const useOrdering=config.ordering;let bestScore=-Infinity;const bestMoves=[];for(const move of allMoves){const clone=cloneState(gameState);executeMove(clone,move.from,move.to,'q');const score=minimax(clone,depth-1,-Infinity,Infinity,false,color,useOrdering);if(score>bestScore){bestScore=score;bestMoves.length=0;bestMoves.push(move)}else if(score===bestScore)bestMoves.push(move)}chosen=bestMoves[Math.floor(Math.random()*bestMoves.length)]}const piece=gameState.board[chosen.from[0]][chosen.from[1]];await animatePieceSlide(chosen.from,chosen.to,piece);let promo=(piece.toUpperCase()==='P'&&(chosen.to[0]===0||chosen.to[0]===7))?'q':null;applyElapsedToActiveClock(gameState);const notation=executeMove(gameState,chosen.from,chosen.to,promo||'q');if(!gameState.gameOver&&gameState.clock)gameState.clock.turnStartedAt=Date.now();selectedSquare=null;validMoves=[];renderBoard();updateStatus();addMoveToLog(notation);renderClockUI();if(gameState.gameOver){recordMatchResult();showGameOver()}}

// Status & move log
function updateStatus(customMsg){const status=$('gameStatus');status.className='game-status';if(customMsg){status.textContent=customMsg;return}if(gameState.gameOver){if(gameState.result.type==='checkmate'){status.textContent='Checkmate! '+(gameState.result.winner==='white'?'White':'Black')+' wins.';status.classList.add('checkmate')}else if(gameState.result.type==='resign'){status.textContent=(gameState.result.winner==='white'?'White':'Black')+' wins by resignation.';status.classList.add('checkmate')}else if(gameState.result.type==='timeout'){status.textContent=(gameState.result.winner==='white'?'White':'Black')+' wins on time.';status.classList.add('checkmate')}else if(gameState.result.type==='got_to_go'){status.textContent=(gameState.result.winner==='white'?'White':'Black')+' wins (opponent had to go).';status.classList.add('checkmate')}else if(gameState.result.type==='got_to_go_draw'){status.textContent='Draw (opponent had to go).'}else{status.textContent='Draw ('+gameState.result.type+')'}return}if(isInCheck(gameState.board,gameState.turn)){status.textContent=(gameState.turn==='white'?'White':'Black')+' is in check!';status.classList.add('check')}else{if(gameState.isOnline)status.textContent=gameState.turn===currentPlayer.color?'Your turn':'Waiting for opponent...';else status.textContent=(gameState.turn==='white'?'White':'Black')+' to move'}const wa=gameState.turn==='white';if(isFlipped){$('topPlayer').classList.toggle('active-turn',wa);$('bottomPlayer').classList.toggle('active-turn',!wa)}else{$('topPlayer').classList.toggle('active-turn',!wa);$('bottomPlayer').classList.toggle('active-turn',wa)}}
function addMoveToLog(notation){const container=$('movesContainer');if(gameState.turn==='black'){const pair=document.createElement('span');pair.className='move-pair';pair.innerHTML='<span class="move-number">'+gameState.fullMoves+'.</span><span class="move-white">'+notation+'</span><span class="move-black"></span>';container.appendChild(pair)}else{const pairs=container.querySelectorAll('.move-pair');const last=pairs[pairs.length-1];if(last)last.querySelector('.move-black').textContent=notation}container.parentElement.scrollTop=container.parentElement.scrollHeight}
function renderMoveLog(){const container=$('movesContainer');container.innerHTML='';const moves=gameState.moves;for(let i=0;i<moves.length;i+=2){const moveNum=Math.floor(i/2)+1;const pair=document.createElement('span');pair.className='move-pair';pair.innerHTML='<span class="move-number">'+moveNum+'.</span><span class="move-white">'+moves[i].notation+'</span><span class="move-black">'+(moves[i+1]?moves[i+1].notation:'')+'</span>';container.appendChild(pair)}container.parentElement.scrollTop=container.parentElement.scrollHeight}

// Promotion modal
function showPromotionModal(from,to){const modal=$('promotionModal'),div=$('promotionPieces'),color=gameState.turn;const pieces=color==='white'?['Q','R','B','N']:['q','r','b','n'];const codes=['q','r','b','n'];div.innerHTML='';pieces.forEach((p,i)=>{const btn=document.createElement('div');btn.className='promotion-piece';btn.innerHTML='<img src="'+PIX[p]+'" alt="'+p+'">';btn.addEventListener('click',()=>{modal.classList.remove('active');doMove(from,to,codes[i])});div.appendChild(btn)});modal.classList.add('active')}

// Game over
function checkLadderOpportunity(){
  const ko=firebaseLadder||{};
  if(ko.status!=='active')return null;
  const schoolId=(currentPlayer&&currentPlayer.schoolId)||lockedSchoolId;
  if(!schoolId)return null;
  const school=firebaseSchools[schoolId];
  if(!school)return null;
  const schoolName=school.name||'';
  const roundIdx=ko.currentRoundIdx||0;
  const round=(ko.rounds||[])[roundIdx];
  if(!round)return null;
  return (round.pairings||[]).find(p=>!p.bye&&!p.winner&&(p.school1===schoolName||p.school2===schoolName))||null;
}

function showGameOver(){
  stopGameClock();
  const modal=$('gameOverModal'),result=gameState.result;
  $('resignBtn').style.display='none';$('drawBtn').style.display='none';$('gotToGoBtn').style.display='none';$('newGameBtn').style.display='';
  if(result.type==='checkmate'){const iWon=result.winner===currentPlayer.color;$('resultIcon').textContent=iWon?'🏆':'♚';$('resultTitle').textContent=iWon?'Victory!':'Defeat';$('resultMessage').textContent=iWon?'Checkmate! Well played.':'You were checkmated. Keep practicing!'}
  else if(result.type==='resign'){const iWon=result.winner===currentPlayer.color;$('resultIcon').textContent=iWon?'🏆':'🏳';$('resultTitle').textContent=iWon?'Opponent Resigned':'You Resigned';$('resultMessage').textContent=''}
  else if(result.type==='timeout'){const iWon=result.winner===currentPlayer.color;$('resultIcon').textContent=iWon?'⏰':'⌛';$('resultTitle').textContent=iWon?'Victory on Time!':'Time Expired';$('resultMessage').textContent=iWon?'Your opponent ran out of time.':'You ran out of time.'}
  else if(result.type==='got_to_go'){const iWon=result.winner===currentPlayer.color;$('resultIcon').textContent=iWon?'🏆':'🏃';$('resultTitle').textContent=iWon?'Opponent Had to Go!':'You Had to Go';$('resultMessage').textContent=iWon?'Your opponent offered you the win and left. Congratulations!':'You offered the win and left.'}
  else if(result.type==='got_to_go_draw'){const iLeft=result.offeredBy===currentPlayer.color;$('resultIcon').textContent='🤝';$('resultTitle').textContent=iLeft?'Draw — You Had to Go':'Draw — Opponent Had to Go';$('resultMessage').textContent=iLeft?'You had to leave. Game ended as a draw.':'Your opponent had to leave. Game ended as a draw.';}
  else{$('resultIcon').textContent='🤝';$('resultTitle').textContent='Draw';$('resultMessage').textContent='Game drawn by '+result.type+'.';}
  // Check for ladder match opportunity
  const ladderNotice=$('ladderNotice');
  if(ladderNotice){
    ladderNotice.style.display='none';
    if(gameState.isOnline){
      const pairing=checkLadderOpportunity();
      if(pairing){
        const schoolId=(currentPlayer&&currentPlayer.schoolId)||lockedSchoolId;
        const school=firebaseSchools[schoolId];
        const schoolName=school?school.name||'':'';
        const opponentName=pairing.school1===schoolName?pairing.school2:pairing.school1;
        const opponentKey=schoolNameToKey(opponentName);
        Promise.all([
          db.ref('admin/ladder/presence/'+opponentKey).once('value'),
          db.ref('admin/ladder/pre_presence/'+opponentKey).once('value')
        ]).then(([lobbySnap,pageSnap])=>{
          const lobbyCount=Object.keys(lobbySnap.val()||{}).length;
          const pageCount=Object.keys(pageSnap.val()||{}).length;
          const total=lobbyCount+pageCount;
          if(total>0){
            ladderNotice.innerHTML='🏆 <strong>Ladder match available!</strong> '+total+' player'+(total!==1?'s':'')+' from '+opponentName+' '+(lobbyCount>0?'ready in the ladder lobby':'on the join page')+'. Head back home to play!';
            ladderNotice.style.display='';
          }
        });
      }
    }
  }
  setTimeout(()=>modal.classList.add('active'),300);
}

// Cleanup & navigation
function cleanupGame(){stopGameClock();stopListeningForPause();$('pauseOverlay').classList.remove('active');$('competitionCountdown').style.display='none';$('gameOverModal').classList.remove('active');$('masterConfirmModal').classList.remove('active');$('masterNoticeModal').classList.remove('active');$('disconnectOutcomeModal').classList.remove('active');$('gotToGoModal').classList.remove('active');$('gotToGoBtn').style.display='none';if(gotToGoOfferTimer){clearTimeout(gotToGoOfferTimer);gotToGoOfferTimer=null}if(gotToGoOfferListener&&gameRef){gameRef.child('gotToGoOffer').off('value',gotToGoOfferListener);gotToGoOfferListener=null}if(disconnectTimer){clearTimeout(disconnectTimer);disconnectTimer=null}if(gameRef){gameRef.off();if(currentPlayer&&currentPlayer.id){gameRef.child('presence/'+currentPlayer.id).onDisconnect().cancel();gameRef.child('presence/'+currentPlayer.id).set({online:false,leftAt:Date.now()}).catch(()=>{})}gameRef=null}if(lobbyRef){lobbyRef.child(currentPlayer?currentPlayer.id:'').remove();lobbyRef=null}currentGameId=null;isHost=false}
// Got to Go feature
function listenForGotToGoOffer(){
  if(!gameRef||!gameState||!currentPlayer)return;
  if(gotToGoOfferListener){gameRef.child('gotToGoOffer').off('value',gotToGoOfferListener);gotToGoOfferListener=null}
  gotToGoOfferListener=snap=>{
    const offer=snap.val();
    if(!offer||!gameState||gameState.gameOver)return;
    const opponentId=gameState.opponent?gameState.opponent.id:null;
    if(offer.from===opponentId&&!offer.accepted){
      // Opponent wants to leave — show acceptance modal to us
      const opponentName=gameState.opponent?gameState.opponent.nickname:'Opponent';
      $('gotToGoMessage').textContent=opponentName+' needs to leave and is offering you the win. What would you like to do?';
      $('gotToGoModal').classList.add('active');
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
  };
  gameRef.child('gotToGoOffer').on('value',gotToGoOfferListener);
}
function showPremoveTooltip(){
  if(localStorage.getItem('ies_premove_tip_seen'))return;
  localStorage.setItem('ies_premove_tip_seen','1');
  let tip=document.getElementById('premoveTooltip');
  if(!tip){tip=document.createElement('div');tip.id='premoveTooltip';document.body.appendChild(tip);}
  tip.innerHTML='💡 <span><strong>Premove set!</strong> It\'ll fire instantly when it\'s your turn.</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:#7a8599;cursor:pointer;font-size:1rem;padding:0 0 0 8px;">✕</button>';
  tip.style.display='flex';
  setTimeout(()=>{if(tip.parentElement)tip.remove();},5000);
}
function returnToHome(){pendingPremove=null;localStorage.removeItem('ies_chess_active_game');cleanupGame();gameState=null;currentPlayer=null;selectedCompetitionId=null;if(!lockedSchoolId){$('schoolSelect').value='';}$('yearSelect').innerHTML='<option value="">Select your year...</option>';$('yearSelect').disabled=!lockedSchoolId;if(lockedSchoolId)populateYearsForSchool(lockedSchoolId);populateCompetitions();$('joinBtn').disabled=true;showScreen('login')}

// Button handlers
$('resignBtn').addEventListener('click',async()=>{if(!gameState||gameState.gameOver)return;if(!await showMasterConfirm('Are you sure you want to resign?'))return;gameState.gameOver=true;gameState.result={type:'resign',winner:currentPlayer.color==='white'?'black':'white'};if(gameState.isOnline)syncMoveToFirebase();updateStatus();recordMatchResult();stopGameClock();await showMasterNotice('Resignation recorded. Press OK to return Home.');returnToHome()});
$('drawBtn').addEventListener('click',async()=>{if(!gameState||gameState.gameOver)return;if(!await showMasterConfirm('Offer a draw? This will end the game as a draw.'))return;gameState.gameOver=true;gameState.result={type:'agreement'};if(gameState.isOnline)syncMoveToFirebase();updateStatus();recordMatchResult();stopGameClock();await showMasterNotice('Draw recorded. Press OK to return Home.');returnToHome()});
$('gotToGoBtn').addEventListener('click',async()=>{
  if(!gameState||gameState.gameOver)return;
  if(!await showMasterConfirm('Are you sure? This will offer your opponent the win and notify them that you need to leave.'))return;
  if(!gameRef)return;
  gameRef.child('gotToGoOffer').set({from:currentPlayer.id,offeredAt:Date.now()});
  // Show waiting notice with cancel option using masterNoticeModal temporarily
  const waitModal=$('masterNoticeModal'),waitMsg=$('masterNoticeMessage'),waitOk=$('masterNoticeOk');
  waitMsg.textContent='⏳ Waiting for opponent to accept... (offer expires in 60s)';
  waitOk.textContent='Cancel Offer';
  waitModal.classList.add('active');
  const cancelOffer=()=>{
    waitModal.classList.remove('active');
    waitOk.textContent='OK';
    if(gotToGoOfferTimer){clearTimeout(gotToGoOfferTimer);gotToGoOfferTimer=null}
    if(gameRef)gameRef.child('gotToGoOffer').remove();
  };
  const onCancel=()=>{waitOk.removeEventListener('click',onCancel);cancelOffer()};
  waitOk.addEventListener('click',onCancel);
  gotToGoOfferTimer=setTimeout(()=>{
    gotToGoOfferTimer=null;
    waitOk.removeEventListener('click',onCancel);
    waitOk.textContent='OK';
    waitModal.classList.remove('active');
    if(gameRef)gameRef.child('gotToGoOffer').remove();
  },60000);
});
$('gotToGoAcceptWin').addEventListener('click',()=>{
  if(!gameRef||!gameState||gameState.gameOver)return;
  if(!$('gotToGoModal').classList.contains('active'))return;
  const opponentId=gameState.opponent?gameState.opponent.id:null;
  $('gotToGoModal').classList.remove('active');
  // Record the response on Firebase so the offering player's listener fires
  if(opponentId)gameRef.child('gotToGoOffer').update({accepted:'win',respondedAt:Date.now()});
  // End game — we (the accepting player) win
  gameState.gameOver=true;
  gameState.result={type:'got_to_go',winner:currentPlayer.color};
  syncMoveToFirebase();
  updateStatus();
  recordMatchResult();
  showGameOver();
});
$('gotToGoAcceptDraw').addEventListener('click',()=>{
  if(!gameRef||!gameState||gameState.gameOver)return;
  if(!$('gotToGoModal').classList.contains('active'))return;
  $('gotToGoModal').classList.remove('active');
  const opponentId=gameState.opponent?gameState.opponent.id:null;
  if(opponentId)gameRef.child('gotToGoOffer').update({accepted:'draw',respondedAt:Date.now()});
  gameState.gameOver=true;
  const opponentColor=currentPlayer.color==='white'?'black':'white';
  gameState.result={type:'got_to_go_draw',offeredBy:opponentColor};
  syncMoveToFirebase();
  updateStatus();
  recordMatchResult();
  showGameOver();
});
$('newGameBtn').addEventListener('click',returnToHome);
$('homeBtn').addEventListener('click',returnToHome);
$('logoutBtn').addEventListener('click',()=>{if(ladderPresenceRef){ladderPresenceRef.remove();ladderPresenceRef=null;}cleanupGame();currentPlayer=null;gameState=null;showScreen('login')});

// Feedback modal handlers
const FEEDBACK_AUTO_CLOSE_MS=3000;
function closeFeedbackModal(){$('feedbackModal').classList.remove('active');$('feedbackTextarea').value='';$('feedbackStatus').className='feedback-status';$('feedbackStatus').textContent=''}
$('feedbackBtn').addEventListener('click',()=>{$('feedbackModal').classList.add('active')});
$('feedbackCancel').addEventListener('click',closeFeedbackModal);
$('feedbackModal').addEventListener('click',(e)=>{if(e.target===$('feedbackModal'))closeFeedbackModal()});
$('feedbackSend').addEventListener('click',async()=>{const message=$('feedbackTextarea').value.trim();if(!message){$('feedbackStatus').className='feedback-status error';$('feedbackStatus').textContent='❌ Please enter a message.';return}const sendBtn=$('feedbackSend');const originalText=sendBtn.textContent;sendBtn.disabled=true;sendBtn.textContent='Sending...';try{const response=await fetch('https://formspree.io/f/mojnlpyw',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({message:message})});if(response.ok){$('feedbackStatus').className='feedback-status success';$('feedbackStatus').textContent='✅ Thank you! Your feedback has been sent.';$('feedbackTextarea').value='';setTimeout(closeFeedbackModal,FEEDBACK_AUTO_CLOSE_MS)}else{$('feedbackStatus').className='feedback-status error';$('feedbackStatus').textContent='❌ Something went wrong. Please try again.'}}catch(error){$('feedbackStatus').className='feedback-status error';$('feedbackStatus').textContent='❌ Something went wrong. Please try again.'}finally{sendBtn.disabled=false;sendBtn.textContent=originalText}});

window.addEventListener('beforeunload',(e)=>{if(gameState&&!gameState.gameOver&&gameState.isOnline){e.preventDefault();e.returnValue='You have an active game in progress. Leaving will forfeit the game!';return;}cleanupGame()});

// Board coordinates
function renderBoardCoordinates(){const files=isFlipped?['h','g','f','e','d','c','b','a']:['a','b','c','d','e','f','g','h'];const ranks=isFlipped?['1','2','3','4','5','6','7','8']:['8','7','6','5','4','3','2','1'];$('boardCoordinatesBottom').innerHTML=files.map(f=>`<span>${f}</span>`).join('');$('boardCoordinatesLeft').innerHTML=ranks.map(r=>`<span>${r}</span>`).join('')}

// Captured pieces tracking
function updateCapturedPieces(){if(!gameState)return;const initial={K:1,Q:1,R:2,B:2,N:2,P:8,k:1,q:1,r:2,b:2,n:2,p:8};const current={K:0,Q:0,R:0,B:0,N:0,P:0,k:0,q:0,r:0,b:0,n:0,p:0};for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=gameState.board[r][c];if(p!==' ')current[p]++}const capturedWhite=[],capturedBlack=[];for(const piece in initial){const captured=initial[piece]-current[piece];if(captured>0){for(let i=0;i<captured;i++){if(piece===piece.toUpperCase())capturedWhite.push(piece);else capturedBlack.push(piece)}}}$('capturedWhite').innerHTML=capturedWhite.map(p=>`<div class="captured-piece"><img src="${PIX[p]}" alt="${p}"></div>`).join('');$('capturedBlack').innerHTML=capturedBlack.map(p=>`<div class="captured-piece"><img src="${PIX[p]}" alt="${p}"></div>`).join('')}

// Pause overlay functionality
let gamePaused=false;let pauseListener=null;
function listenForPauseState(){if(!selectedCompetitionId)return;pauseListener=snap=>{const status=snap.val();if(status==='paused'){gamePaused=true;$('pauseOverlay').classList.add('active');stopGameClock()}else if(status==='active'){if(gamePaused){gamePaused=false;$('pauseOverlay').classList.remove('active');if(gameState&&!gameState.gameOver)startGameClock()}}};db.ref('admin/competitions/'+selectedCompetitionId+'/status').on('value',pauseListener)}
function stopListeningForPause(){if(selectedCompetitionId&&pauseListener){db.ref('admin/competitions/'+selectedCompetitionId+'/status').off('value',pauseListener);pauseListener=null}}

initLogin();

// Beta notice
(function(){
  var overlay=document.getElementById('betaOverlay');
  var btn=document.getElementById('betaAcknowledge');
  var chk=document.getElementById('betaDontShow');
  if(!localStorage.getItem('beta_acknowledged')){
    overlay.style.display='flex';
  }
  btn.addEventListener('click',function(){
    if(chk.checked)localStorage.setItem('beta_acknowledged','1');
    overlay.style.display='none';
  });
})();

// Board size selector
(function(){
  const SIZES={
    small:'360px',
    medium:'480px',
    large:'600px',
    fullscreen:'min(calc(100vw - 40px),calc(100vh - 120px))'
  };
  function applyBoardSize(size){
    const styleEl=document.getElementById('boardSizeStyle');
    if(!styleEl)return;
    const v=SIZES[size]||SIZES.medium;
    styleEl.textContent='.chess-board{width:'+v+' !important;height:'+v+' !important;max-width:'+v+' !important;max-height:'+v+' !important}';
    localStorage.setItem('chessBoardSize',size);
    document.querySelectorAll('.board-size-btn').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.size===size);
    });
  }
  const saved=localStorage.getItem('chessBoardSize')||'medium';
  applyBoardSize(saved);
  document.querySelectorAll('.board-size-btn').forEach(btn=>{
    btn.addEventListener('click',()=>applyBoardSize(btn.dataset.size));
  });
})();
