const firebaseConfig={apiKey:"AIzaSyBXKcCv8eMhSSg56Z1P75rGPBpDVdH3LXQ",authDomain:"ies-chess.firebaseapp.com",databaseURL:"https://ies-chess-default-rtdb.europe-west1.firebasedatabase.app",projectId:"ies-chess",storageBucket:"ies-chess.firebasestorage.app",messagingSenderId:"877435867792",appId:"1:877435867792:web:1d8d6af8b05d1461957e15"};
firebase.initializeApp(firebaseConfig);
const db=firebase.database();
const auth=firebase.auth();
let firestore=null;
try{
  firestore=firebase.firestore();
}catch(e){
  console.warn('Firestore not available - email notifications will be disabled:',e);
}
const SUPER_ADMIN_EMAIL='barry.shaw.vasteras@engelska.se';
let currentUser=null,currentAdminData=null,adminUsers={},accessRequests={},matchRequests={};

// Smart school matching state
var matchedSchoolId = null;
var matchedSchoolName = null;
var schoolInputDebounceTimer = null;

// UI Navigation Functions
function showRequestAccess(){
  document.getElementById('loginForm').style.display='none';
  document.getElementById('requestAccessForm').style.display='block';
  
  // Clear form state
  document.getElementById('requestName').value='';
  document.getElementById('requestEmail').value='';
  document.getElementById('requestPassword').value='';
  document.getElementById('requestConfirmPassword').value='';
  document.getElementById('requestSchool').value='';
  document.getElementById('requestMessage').value='';
  document.getElementById('requestError').style.display='none';
  document.getElementById('requestSuccess').style.display='none';
  
  // Populate school dropdown from Firebase
  populateSchoolDropdown();
  updateRequestSchoolPreview();
}

function showLoginForm(){
  document.getElementById('requestAccessForm').style.display='none';
  document.getElementById('loginForm').style.display='block';
  
  // Clear error/success messages in request form
  document.getElementById('requestError').style.display='none';
  document.getElementById('requestSuccess').style.display='none';
}

function showForgotPassword(){
  const email=document.getElementById('adminEmail').value.trim();
  const errorEl=document.getElementById('loginError');
  
  if(!email){
    errorEl.textContent='Please enter your email address first.';
    errorEl.style.display='block';
    return;
  }
  
  // Send password reset email
  auth.sendPasswordResetEmail(email)
    .then(()=>{
      errorEl.style.color='var(--green)';
      errorEl.textContent='Password reset email sent! Check your inbox.';
      errorEl.style.display='block';
    })
    .catch((error)=>{
      errorEl.style.color='var(--red)';
      errorEl.textContent='Error: '+error.message;
      errorEl.style.display='block';
    });
}

// Helper Functions
function isValidAdminEmail(email){
  if(!email||!email.includes('@')){
    return {valid:false,error:'Please enter a valid email address.'};
  }
  
  // Must be @engelska.se or approved domain
  const validDomains=['engelska.se'];
  const domain=email.split('@')[1];
  
  if(!validDomains.includes(domain)){
    return {valid:false,error:'Admin access is restricted to @engelska.se email addresses.'};
  }
  
  return {valid:true};
}

function extractSchoolFromEmail(email){
  if(!email.endsWith('@engelska.se')){
    return 'Unknown';
  }
  
  const localPart=email.split('@')[0];
  const parts=localPart.split('.');
  
  // Email format is typically: firstname.lastname.schoolname@engelska.se
  if(parts.length>=3){
    const schoolPart=parts[parts.length-1];
    // Capitalize first letter
    return schoolPart.charAt(0).toUpperCase()+schoolPart.slice(1);
  }
  
  return 'Unknown';
}

function generateId(){
  return Date.now().toString(36)+Math.random().toString(36).slice(2,11);
}

function updateRequestSchoolPreview(){
  const email=document.getElementById('requestEmail').value.trim();
  const isEngelskaEmail=email.endsWith('@engelska.se');
  
  if(isEngelskaEmail){
    const schoolName=extractSchoolFromEmail(email);
    document.getElementById('requestSchoolPreviewText').textContent=schoolName;
    document.getElementById('requestSchoolPreview').style.display='block';
    document.getElementById('requestSchoolGroup').style.display='none';
  }else{
    document.getElementById('requestSchoolPreview').style.display='none';
    document.getElementById('requestSchoolGroup').style.display='block';
  }
}

// Resolve an engelska.se email address to a school key in the database.
// Email format: firstname.lastname.school@engelska.se
// Returns the matching school key string, or null if no match (HQ users, etc.).
function resolveEmailToSchoolKey(email, allSchools) {
  if (!email || !email.endsWith('@engelska.se')) return null;
  const localPart = email.split('@')[0];
  const parts = localPart.split('.');
  // Need at least 3 parts: firstname.lastname.school
  // Only 2 parts means HQ user — no school to auto-detect
  if (parts.length < 3) return null;
  const emailSchoolPart = parts[parts.length - 1].toLowerCase();
  for (const [schoolKey, schoolData] of Object.entries(allSchools)) {
    // School keys are generated as "ies-vasteras", "ies-arsta" etc.
    // Check if the key exactly equals or ends with the email school part.
    if (schoolKey === emailSchoolPart || schoolKey.endsWith('-' + emailSchoolPart)) {
      return schoolKey;
    }
    // Fallback: normalise the school name and check for a substring match.
    // This handles unusual naming where the key format differs.
    if (schoolData.name) {
      const normName = normalizeSwedish(schoolData.name).replace(/[^a-z0-9]/g, '');
      const normPart = emailSchoolPart.replace(/[^a-z0-9]/g, '');
      if (normPart.length >= 3 && normName.includes(normPart)) {
        return schoolKey;
      }
    }
  }
  return null;
}

function normalizeSwedish(str) {
  return str.toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/è/g, 'e')
    .replace(/ü/g, 'u')
    .trim();
}

function handleSchoolInputChange() {
  clearTimeout(schoolInputDebounceTimer);
  schoolInputDebounceTimer = setTimeout(() => {
    checkSchoolMatch();
  }, 300);
}

async function checkSchoolMatch() {
  const townInput = document.getElementById('requestSchool').value.trim();
  const suggestionDiv = document.getElementById('school-match-suggestion');
  
  if (!townInput) {
    suggestionDiv.style.display = 'none';
    matchedSchoolId = null;
    matchedSchoolName = null;
    return;
  }
  
  // Construct full school name
  const fullSchoolName = 'IES ' + townInput;
  
  // Fetch all schools from Firebase
  try {
    const schoolsSnap = await db.ref('admin/schools').once('value');
    const allSchools = schoolsSnap.val() || {};
    
    // Check for exact match (case-insensitive)
    let exactMatch = null;
    let normalizedMatch = null;
    
    for (const [schoolKey, schoolData] of Object.entries(allSchools)) {
      const schoolName = schoolData.name || '';
      
      // Exact match (case-insensitive)
      if (schoolName.toLowerCase() === fullSchoolName.toLowerCase()) {
        exactMatch = { key: schoolKey, name: schoolName };
        break;
      }
      
      // Normalized match (for fuzzy matching)
      if (!exactMatch && normalizeSwedish(schoolName) === normalizeSwedish(fullSchoolName)) {
        normalizedMatch = { key: schoolKey, name: schoolName };
      }
    }
    
    if (exactMatch) {
      // Exact match found
      matchedSchoolId = exactMatch.key;
      matchedSchoolName = exactMatch.name;
      suggestionDiv.innerHTML = `✅ <strong>${escapeHtml(exactMatch.name)}</strong> found — you'll be associated with this school`;
      suggestionDiv.style.background = 'rgba(38, 222, 129, 0.1)';
      suggestionDiv.style.borderColor = 'rgba(38, 222, 129, 0.3)';
      suggestionDiv.style.display = 'block';
    } else if (normalizedMatch) {
      // Normalized/fuzzy match found
      matchedSchoolId = normalizedMatch.key;
      matchedSchoolName = normalizedMatch.name;
      suggestionDiv.innerHTML = `🔍 Did you mean <strong>${escapeHtml(normalizedMatch.name)}</strong>? This school already exists. <a href="#" data-school-name="${escapeHtml(normalizedMatch.name)}" onclick="useExistingSchool(this.getAttribute('data-school-name'));return false;" style="color:var(--accent);text-decoration:underline;margin-left:4px;">Use this school</a>`;
      suggestionDiv.style.background = 'rgba(255, 165, 0, 0.1)';
      suggestionDiv.style.borderColor = 'rgba(255, 165, 0, 0.3)';
      suggestionDiv.style.display = 'block';
    } else {
      // No match - new school will be created
      matchedSchoolId = null;
      matchedSchoolName = null;
      suggestionDiv.innerHTML = `🆕 A new school <strong>${escapeHtml(fullSchoolName)}</strong> will be created when your request is approved`;
      suggestionDiv.style.background = 'rgba(74, 124, 255, 0.1)';
      suggestionDiv.style.borderColor = 'rgba(74, 124, 255, 0.3)';
      suggestionDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('Error checking school match:', error);
    suggestionDiv.style.display = 'none';
  }
}

function useExistingSchool(schoolName) {
  // Extract town name from "IES TownName"
  const townName = schoolName.replace(/^IES\s+/i, '');
  document.getElementById('requestSchool').value = townName;
  // Trigger immediate check
  clearTimeout(schoolInputDebounceTimer);
  checkSchoolMatch();
}

async function populateSchoolDropdown(){
  try{
    const schoolsSnap=await db.ref('admin/schools').once('value');
    const schools=schoolsSnap.val();
    const select=document.getElementById('requestSchool');
    
    // Clear existing options except the first one
    select.innerHTML='<option value="">Select a school...</option>';
    
    if(schools){
      Object.entries(schools)
        .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'))
        .forEach(([key,school])=>{
          const option=document.createElement('option');
          option.value=key;
          option.textContent=school.name||key;
          select.appendChild(option);
        });
    }
  }catch(error){
    console.error('Error loading schools:',error);
  }
}

async function attemptLogin(){
  const email=document.getElementById('adminEmail').value.trim();
  const password=document.getElementById('adminPassword').value;
  const errorEl=document.getElementById('loginError');
  
  errorEl.style.display='none';
  
  if(!email||!password){
    errorEl.textContent='Please enter both email and password.';
    errorEl.style.display='block';
    return;
  }
  
  try{
    const userCredential=await auth.signInWithEmailAndPassword(email,password);
    currentUser=userCredential.user;
    
    // Auto-approve super admin
    if(currentUser.email.toLowerCase()===SUPER_ADMIN_EMAIL.toLowerCase()){
      const superAdminData={
        email:SUPER_ADMIN_EMAIL,
        role:'super_admin',
        approved:true,
        name:'Barry Shaw',
        approvedAt:Date.now()
      };
      await db.ref('admin/users').child(currentUser.uid).set(superAdminData);
      currentAdminData=superAdminData;
      document.getElementById('loginScreen').style.display='none';
      initAdmin();
      return;
    }
    
    // Check if user has admin access (for non-super-admin users)
    let adminSnap=await db.ref('admin/users').child(currentUser.uid).once('value');
    let adminData=adminSnap.val();

    // Fallback for legacy records keyed by previous UID (match by email)
    if(!adminData&&currentUser.email){
      const normalizedEmail=currentUser.email.toLowerCase();
      const emailMatchSnap=await db.ref('admin/users')
        .orderByChild('email')
        .equalTo(normalizedEmail)
        .once('value');

      let matchedByEmail=emailMatchSnap.val();

      // Extra fallback for historical mixed-case email values
      if(!matchedByEmail){
        const allAdminsSnap=await db.ref('admin/users').once('value');
        const allAdmins=allAdminsSnap.val()||{};
        for(const [legacyUid,legacyAdmin] of Object.entries(allAdmins)){
          if((legacyAdmin.email||'').toLowerCase()===normalizedEmail){
            matchedByEmail={[legacyUid]:legacyAdmin};
            break;
          }
        }
      }

      if(matchedByEmail){
        const legacyEntry=Object.values(matchedByEmail)[0];
        if(legacyEntry){
          adminData={...legacyEntry,email:normalizedEmail};
          await db.ref('admin/users').child(currentUser.uid).set(adminData);
        }
      }
    }

    const isApprovedAdmin=adminData&&(adminData.approved!==false);
    if(!isApprovedAdmin){
      await auth.signOut();
      errorEl.textContent='You do not have admin access. Please request access first.';
      errorEl.style.display='block';
      return;
    }
    
    currentAdminData=adminData;
    
    // Hide login screen and show admin interface
    document.getElementById('loginScreen').style.display='none';
    initAdmin();
    
  }catch(error){
    errorEl.textContent='Login failed: '+error.message;
    errorEl.style.display='block';
  }
}

async function submitAccessRequest(){
  const name=document.getElementById('requestName').value.trim();
  const email=document.getElementById('requestEmail').value.trim();
  const password=document.getElementById('requestPassword').value;
  const confirmPassword=document.getElementById('requestConfirmPassword').value;
  const school=document.getElementById('requestSchool').value;
  const message=document.getElementById('requestMessage').value.trim();
  const err=document.getElementById('requestError');
  const succ=document.getElementById('requestSuccess');
  
  err.style.display='none';
  succ.style.display='none';
  
  if(!name||!email||!password||!confirmPassword){
    err.textContent='Please fill in all required fields.';
    err.style.display='block';
    return;
  }
  
  // Validate password
  if(password.length<6){
    err.textContent='Password must be at least 6 characters long.';
    err.style.display='block';
    return;
  }
  
  if(password!==confirmPassword){
    err.textContent='Passwords do not match.';
    err.style.display='block';
    return;
  }
  
  const isEngelskaEmail=email.endsWith('@engelska.se');
  if(!isEngelskaEmail&&!school.trim()){
    err.textContent='Please enter a school name.';
    err.style.display='block';
    return;
  }
  
  const validation=isValidAdminEmail(email);
  if(!validation.valid){
    err.textContent=validation.error;
    err.style.display='block';
    return;
  }
  
  const reqSnap=await db.ref('admin/accessRequests').orderByChild('email').equalTo(email).once('value');
  const existing=reqSnap.val();
  if(existing){
    const pending=Object.values(existing).find(r=>r.status==='pending');
    if(pending){
      err.textContent='You already have a pending request.';
      err.style.display='block';
      return;
    }
  }
  
  let finalSchool;
  let finalSchoolName;
  let createNewSchool = false;
  
  if(isEngelskaEmail){
    finalSchoolName=extractSchoolFromEmail(email);
    finalSchool='auto';
  }else{
    // Construct full school name with proper capitalization
    const townName=school.trim();
    // Capitalize each word in the town name
    const capitalizedTown=townName.split(' ').map(word=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()).join(' ');
    finalSchoolName='IES '+capitalizedTown;
    
    // Use the matched school if available from the smart matching
    if(matchedSchoolId){
      finalSchool=matchedSchoolId;
      finalSchoolName=matchedSchoolName;
      createNewSchool=false;
    }else{
      // No match - mark for creation on approval
      finalSchool=null;
      createNewSchool=true;
    }
  }
  
  // Create Firebase Auth account (or reuse an existing one for re-applications)
  let uid;
  try{
    const userCredential=await auth.createUserWithEmailAndPassword(email,password);
    uid=userCredential.user.uid;
  }catch(authError){
    if(authError.code==='auth/email-already-in-use'){
      // User may already have an account from a previous approved/revoked admin role.
      // Allow re-application by verifying credentials and reusing existing uid.
      try{
        const existingUserCredential=await auth.signInWithEmailAndPassword(email,password);
        uid=existingUserCredential.user.uid;
      }catch(signInError){
        err.textContent='This email is already registered. Sign in with your existing account or reset your password, then try requesting access again.';
        err.style.display='block';
        return;
      }
    }else{
      err.textContent='Failed to create account: '+authError.message;
      err.style.display='block';
      return;
    }
  }
  
  const req={
    name,
    email,
    uid,
    school:finalSchool,
    schoolName:finalSchoolName,
    createNewSchool:createNewSchool,
    message,
    status:'pending',
    requestedAt:Date.now()
  };
  
  await db.ref('admin/accessRequests/'+generateId()).set(req);
  
  // Send email notification to ALL super admins
  if(firestore){
    try{
      // Collect all super admin email addresses from the database
      const allUsersSnap=await db.ref('admin/users').once('value');
      const allUsersData=allUsersSnap.val()||{};
      const superAdminEmails=Object.values(allUsersData)
        .filter(u=>u.role==='super_admin'&&u.email)
        .map(u=>u.email);

      // Always include the hardcoded super admin as a fallback
      if(!superAdminEmails.includes(SUPER_ADMIN_EMAIL)){
        superAdminEmails.push(SUPER_ADMIN_EMAIL);
      }

      const emailBody={
        subject: '🔐 New Admin Access Request - IES Chess',
        text: `New admin access request from ${name}

Email: ${email}
School: ${finalSchoolName}
Reason: ${message || 'Not provided'}

Review and approve at: https://iesv.se/chess/admin.html

---
NOTE: This is a global notification sent to all super admins. Another super admin may have already reviewed and acted on this request before you.`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4285f4;">🔐 New Admin Access Request</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>School:</strong> ${finalSchoolName}</p>
            <p><strong>Reason:</strong> ${message || 'Not provided'}</p>
          </div>
          <p>
            <a href="https://iesv.se/chess/admin.html"
               style="background: #4285f4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Review Request
            </a>
          </p>
          <div style="background: #fff8e1; border-left: 4px solid #f5c518; padding: 12px 16px; margin-top: 20px; border-radius: 4px;">
            <p style="margin:0; color: #555; font-size: 13px;">
              <strong>Global Notification:</strong> This email has been sent to all super admins.
              Another super admin may have already reviewed and approved or denied this request before you open it.
              Please check the Admin Portal to see the current status before taking action.
            </p>
          </div>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            This is an automated notification from IES Chess Admin Portal.
          </p>
        </div>
      `
      };

      // Queue one email per super admin so each gets a personalised copy in their inbox
      const emailPromises=superAdminEmails.map(toEmail=>
        firestore.collection('mail').add({to:toEmail,message:emailBody})
      );
      await Promise.all(emailPromises);
      console.log(`✅ Admin notification email queued for ${superAdminEmails.length} super admin(s)`);
    }catch(emailError){
      console.error('❌ Failed to queue admin notification email:',emailError);
      // Don't block the submission, but warn the user
      setTimeout(() => {
        alert(`Your request was saved, but the email notification may not have been sent. Please also contact ${SUPER_ADMIN_EMAIL} directly to follow up.`);
      }, 1000);
    }
  }else{
    console.warn('⚠️ Firestore not available - admin notification email cannot be sent');
    // Warn user but don't block submission
    setTimeout(() => {
      alert(`Your request was saved, but email notifications are not configured. Please also contact ${SUPER_ADMIN_EMAIL} directly to follow up.`);
    }, 1000);
  }
  
  // Sign out after all database operations so they can't access admin until approved
  await auth.signOut();
  
  document.getElementById('requestName').value='';
  document.getElementById('requestEmail').value='';
  document.getElementById('requestPassword').value='';
  document.getElementById('requestConfirmPassword').value='';
  document.getElementById('requestSchool').value='';
  document.getElementById('requestMessage').value='';
  updateRequestSchoolPreview();
  
  // Safe to use innerHTML here as the string is static with no user input interpolation
  succ.innerHTML='Your request has been submitted! An administrator will review it shortly.<br>Questions? Contact <a href="mailto:'+SUPER_ADMIN_EMAIL+'" style="color:var(--accent)">'+SUPER_ADMIN_EMAIL+'</a>';
  succ.style.display='block';
}

// ADMIN DASHBOARD INITIALIZATION AND LOGIC
let currentScope='global';
let currentSchool=null;
let superAdminImpersonating=false;
let competitions={},players={},matches={},settings={},news={},schools={};
let recentMatchesPage=0;
let editingCompId=null,editingNewsId=null;
let globalAppearanceSettings={},schoolAppearanceSettings={};
let schoolSettings={};
let schoolAdjustments={};
let adminLbViewMode='cross-school';
let dashboardSchoolFilter='';

// Helper function to escape HTML
function escapeHtml(text){
  const div=document.createElement('div');
  div.textContent=text;
  return div.innerHTML;
}

function getAdminSchools(){
  if(Array.isArray(currentAdminData.schools)&&currentAdminData.schools.length>0){
    return currentAdminData.schools;
  }
  if(currentAdminData.school)return[currentAdminData.school];
  return[];
}

function getEffectiveAppearanceSettings(){
  const global=globalAppearanceSettings||{};
  const school=schoolAppearanceSettings||{};
  return {
    boardColors:{
      ...(global.boardColors||{}),
      ...(school.boardColors||{})
    },
    pieceStyle:school.pieceStyle||global.pieceStyle||'classic'
  };
}

function refreshAppearanceEditor(){
  const effective=getEffectiveAppearanceSettings();
  selectedLightColor=effective.boardColors?.light||'#f0d9b5';
  selectedDarkColor=effective.boardColors?.dark||'#b58863';
  selectedPieceStyle=effective.pieceStyle||'classic';

  selectColor('light',selectedLightColor);
  selectColor('dark',selectedDarkColor);
  selectPieceStyle(selectedPieceStyle);
}

function initAdmin(){
  document.getElementById('adminApp').style.display='flex';
  document.getElementById('mobileHeader').style.display='flex';
  
  // Hide admin-user management and school management actions for non-super-admins
  if(currentAdminData.role!=='super_admin'){
    document.getElementById('adminUsersNav').style.display='none';
    document.getElementById('addSchoolBtn').style.display='none';
  }
  
  // Setup Firebase listeners
  setupFirebaseListeners();
  
  // Load initial data
  loadDashboardStats();
  loadSchoolsForScope();
  updateAdminSchoolLabel();
  
  // Lock regular admins to their assigned school(s)
  if(currentAdminData.role!=='super_admin'){
    // Use getAdminSchools() so both the 'schools' array and legacy 'school' field are handled
    const mySchools=getAdminSchools();
    if(mySchools.length>0){
      currentScope=mySchools[0];
      currentSchool=mySchools[0];
    }

    // Disable scope selector when admin has only one school
    const scopeSelect=document.getElementById('schoolScopeSelect');
    if(scopeSelect){
      scopeSelect.disabled=mySchools.length<=1;
      scopeSelect.style.opacity=mySchools.length<=1?'0.6':'1';
      scopeSelect.style.cursor=mySchools.length<=1?'not-allowed':'pointer';
    }
  }
}

function setupFirebaseListeners(){
  // Listen to competitions
  db.ref('admin/competitions').on('value',snap=>{
    competitions=snap.val()||{};
    renderCompetitions();
    updateDashboardStats();
  });
  
  // Listen to players
  db.ref('players').on('value',snap=>{
    players=snap.val()||{};
    renderLeaderboard();
    renderRecentMatches();
    updateDashboardStats();
  });
  
  // Listen to live games
  db.ref('games').on('value',snap=>{
    const all=snap.val()||{};
    const now=Date.now();
    const live=Object.entries(all).filter(([,g])=>{
      if(!g.host||!g.guest||!g.state||g.state.gameOver)return false;
      // Prefer presence signal: at least one player must be online
      const presence=g.presence||{};
      const presenceEntries=Object.values(presence);
      if(presenceEntries.length>0){
        // Presence data exists — only show if someone is actually connected
        return presenceEntries.some(p=>p&&p.online===true);
      }
      // No presence yet (very new pairing) — show briefly within 5-min grace window
      const createdAt=g.createdAt||0;
      return(now-createdAt)<5*60*1000;
    });
    const el=document.getElementById('liveGamesList');
    if(!el)return;
    if(live.length===0){el.innerHTML='<p style="color:var(--text-muted);font-size:.88rem;">No games in progress.</p>';return;}
    el.innerHTML=live.map(([gameId,g])=>{
      const wName=escapeHtml(g.host.nickname||g.host.id||'?');
      const bName=escapeHtml(g.guest.nickname||g.guest.id||'?');
      const wSchool=escapeHtml(g.host.school||'?');
      const bSchool=escapeHtml(g.guest.school||'?');
      const moves=Array.isArray(g.state.moves)?g.state.moves.length:0;
      const spectateUrl='spectate.html?game='+encodeURIComponent(gameId);
      return`<div class="lb-row" style="display:flex;align-items:center;gap:12px;">
        <a href="${escapeHtml(spectateUrl)}" target="_blank" class="btn btn-sm" style="flex-shrink:0;background:#e74c3c;border-color:#e74c3c;color:#fff;">📽 Live View</a>
        <div>
          <div class="lb-name" style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#e74c3c;display:inline-block;animation:pulse 1.5s infinite;"></span>${wName} <span style="color:var(--text-muted);">vs</span> ${bName}</div>
          <div class="lb-school">${wSchool} vs ${bSchool} &middot; ${moves} move${moves!==1?'s':''}</div>
        </div>
      </div>`;
    }).join('');
  });

  // Listen to matches
  db.ref('matches').on('value',snap=>{
    matches=snap.val()||{};
    // Delete matches older than 7 days
    const sevenDaysAgo=Date.now()-7*24*60*60*1000;
    Object.entries(matches).forEach(([id,m])=>{
      const ts=m.completedAt||m.startTime||m.timestamp||0;
      if(ts&&ts<sevenDaysAgo){
        db.ref('matches/'+id).remove().catch(()=>{});
        delete matches[id];
      }
    });
    recentMatchesPage=0;
    renderRecentMatches();
    renderLeaderboard();
    renderSuspiciousGames();
    updateDashboardStats();
    // Refresh ladder scores if that panel is open
    if (document.getElementById('panel-ladder') &&
        document.getElementById('panel-ladder').classList.contains('active') &&
        ladderData) {
      renderKnockoutPanel(ladderData);
    }
  });
  
  // Listen to settings
  db.ref('admin/settings').on('value',snap=>{
    settings=snap.val()||{};
    populateSettings();
    renderLeaderboard();
  });

  // Listen to appearance settings
  db.ref('admin/appearance').on('value',snap=>{
    globalAppearanceSettings=snap.val()||{};
    refreshAppearanceEditor();
  });

  if(currentAdminData.role!=='super_admin'){
    const mySchools=getAdminSchools();
    const primarySchool=mySchools[0];
    if(primarySchool){
      db.ref('admin/schools/'+primarySchool+'/appearance').on('value',snap=>{
        schoolAppearanceSettings=snap.val()||{};
        refreshAppearanceEditor();
      });
      db.ref('admin/schools/'+primarySchool+'/settings').on('value',snap=>{
        schoolSettings=snap.val()||{};
        populateSettings();
      });
    }
  }
  
  // Listen to school adjustments
  db.ref('admin/schoolAdjustments').on('value',snap=>{
    schoolAdjustments=snap.val()||{};
    renderLeaderboard();
  });

  // Listen to news
  db.ref('admin/news').on('value',snap=>{
    news=snap.val()||{};
    renderNews();
  });
  
  // Listen to schools
  let prevContactCounts = {};
  db.ref('admin/schools').on('value',snap=>{
    const newSchools=snap.val()||{};
    // Detect any school that just got its first contact and auto-add to round 1
    if(Object.keys(prevContactCounts).length>0){
      Object.entries(newSchools).forEach(([key,school])=>{
        const oldCount=prevContactCounts[key]||0;
        const newCount=Object.keys(school.contacts||{}).length;
        if(oldCount===0&&newCount>0){
          const schoolName=school.name;
          if(schoolName) maybeAddSchoolToRound1(schoolName);
        } else if(oldCount>0&&newCount===0){
          const schoolName=school.name;
          if(schoolName) maybeRemoveSchoolFromRound1(schoolName);
        }
      });
    }
    prevContactCounts={};
    Object.entries(newSchools).forEach(([key,school])=>{
      prevContactCounts[key]=Object.keys(school.contacts||{}).length;
    });
    schools=newSchools;
    updateDashboardStats();
    renderSchools();
    renderContactPrompt();
    if(currentAdminData.role!=='super_admin'){
      const mySchools=getAdminSchools();
      if(mySchools.length>0){
        currentScope=mySchools[0];
        currentSchool=mySchools[0];
        const scopeSelect=document.getElementById('schoolScopeSelect');
        if(scopeSelect){
          scopeSelect.disabled=mySchools.length<=1;
          scopeSelect.style.opacity=mySchools.length<=1?'0.6':'1';
          scopeSelect.style.cursor=mySchools.length<=1?'not-allowed':'pointer';
        }
      }
    }
    updateAdminSchoolLabel();
    renderLeaderboard();
    renderRecentMatches();
  });
  
  // Listen to match requests
  db.ref('admin/matchRequests').on('value',snap=>{
    matchRequests=snap.val()||{};
    renderMatchRequests();
    updateMatchRequestsBadge();
  });

  // Listen to admin users (super admin only)
  if(currentAdminData.role==='super_admin'){
    db.ref('admin/users').on('value',snap=>{
      adminUsers=snap.val()||{};
      renderAdminUsers();
    });
    
    db.ref('admin/accessRequests').on('value',snap=>{
      accessRequests=snap.val()||{};
      renderAccessRequests();
      updateAccessRequestsBadge();
    });
  }
  
  // Connection status
  db.ref('.info/connected').on('value',snap=>{
    const connected=snap.val();
    const dot=document.getElementById('statusDot');
    const text=document.getElementById('statusText');
    if(connected){
      dot.classList.remove('offline');
      text.textContent='Connected';
    }else{
      dot.classList.add('offline');
      text.textContent='Offline';
    }
  });
}

async function loadSchoolsForScope(){
  const schoolsSnap=await db.ref('admin/schools').once('value');
  const schoolsData=schoolsSnap.val()||{};
  const select=document.getElementById('schoolScopeSelect');
  
  // Regular admins can only see their assigned schools
  if(currentAdminData.role!=='super_admin'){
    const mySchools=getAdminSchools();
    select.innerHTML='';
    mySchools
      .filter(key=>schoolsData[key])
      .sort((a,b)=>(schoolsData[a].name||a).localeCompare(schoolsData[b].name||b,'sv'))
      .forEach(key=>{
        const school=schoolsData[key];
        const option=document.createElement('option');
        option.value=key;
        option.textContent=`🏫 ${school.name||key}`;
        select.appendChild(option);
      });
    if(mySchools.length>0){
      select.value=mySchools[0];
      currentScope=mySchools[0];
      currentSchool=mySchools[0];
    }
    const badge=document.getElementById('scopeBadge');
    if(mySchools.length>0){
      const firstName=schoolsData[mySchools[0]]?.name||mySchools[0]||'';
      badge.textContent=mySchools.length>1?`🏫 ${firstName} (+${mySchools.length-1} more)`:`🏫 ${firstName}`;
      badge.classList.remove('global');
    }
    select.disabled=mySchools.length<=1;
    select.style.opacity=mySchools.length<=1?'0.6':'1';
    select.style.cursor=mySchools.length<=1?'not-allowed':'pointer';
    updateAdminSchoolLabel();
  }else{
    // Super admins can see all schools
    select.innerHTML='<option value="global">🌍 Global — All Schools</option>';
    
    Object.entries(schoolsData)
      .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'))
      .forEach(([key,school])=>{
        const option=document.createElement('option');
        option.value=key;
        option.textContent=`🏫 ${school.name||key}`;
        select.appendChild(option);
      });
  }
}

function changeSchoolScope(){
  const select=document.getElementById('schoolScopeSelect');
  currentScope=select.value;
  currentSchool=currentScope==='global'?null:currentScope;

  const badge=document.getElementById('scopeBadge');
  const banner=document.getElementById('impersonationBanner');
  const impersonationSchoolName=document.getElementById('impersonationSchoolName');

  if(currentScope==='global'){
    badge.textContent='🌍 Viewing all schools';
    badge.classList.add('global');
    badge.classList.remove('impersonating');
    // Exit impersonation mode — restore super admin UI
    if(currentAdminData.role==='super_admin'){
      superAdminImpersonating=false;
      banner.classList.remove('visible');
      document.getElementById('adminUsersNav').style.display='';
      document.getElementById('addSchoolBtn').style.display='';
    }
  }else{
    const schoolName=schools[currentScope]?.name||currentScope;
    // Super admin entering school impersonation mode
    if(currentAdminData.role==='super_admin'){
      superAdminImpersonating=true;
      badge.textContent=`👁️ Impersonating ${schoolName}`;
      badge.classList.remove('global');
      badge.classList.add('impersonating');
      impersonationSchoolName.textContent=schoolName;
      banner.classList.add('visible');
      document.getElementById('adminUsersNav').style.display='none';
      document.getElementById('addSchoolBtn').style.display='none';
      // If currently on a super-admin-only panel, redirect to dashboard
      const activePanel=document.querySelector('.panel.active');
      if(activePanel&&activePanel.id==='panel-admin-users'){
        switchPanel('dashboard');
      }
    }else{
      badge.textContent=`🏫 Viewing ${schoolName}`;
      badge.classList.remove('global','impersonating');
    }
  }
  
  // Re-attach school settings listeners for all roles when a specific school is selected
  if(currentSchool){
    db.ref('admin/schools/'+currentSchool+'/settings').on('value',snap=>{
      schoolSettings=snap.val()||{};
      populateSettings();
    });
    db.ref('admin/schools/'+currentSchool+'/appearance').on('value',snap=>{
      schoolAppearanceSettings=snap.val()||{};
      refreshAppearanceEditor();
    });
  }else{
    // Returned to global view — clear school overrides and reload from global data
    schoolSettings={};
    schoolAppearanceSettings={};
    populateSettings();
    refreshAppearanceEditor();
  }
  updateSettingsScopeInfo();
  
  // Reload play times for the newly selected school
  loadPlayTimes();

  // Re-render all data with new scope
  renderLeaderboard();
  renderRecentMatches();
  renderSuspiciousGames();
  updateDashboardStats();
}

function switchPanel(panelName){
  // User management is super-admin only (and not available while impersonating a school)
  if((currentAdminData.role!=='super_admin'||superAdminImpersonating)&&panelName==='admin-users'){
    alert('Only super admins can access this panel. Switch to Global scope to manage admin users.');
    return;
  }

  // Hide all panels
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  
  // Show selected panel
  document.getElementById('panel-'+panelName).classList.add('active');
  document.querySelector(`.nav-item[data-panel="${panelName}"]`).classList.add('active');
  
  if(panelName==='settings'){
    updateSettingsScopeInfo();
    populateSettings();
  }

  // Initialize schedules panel
  if(panelName==='schedules'){
    initPlayTimesPanel();
    initSchedulesGrid();
  }

  if(panelName==='integrity'){
    renderSuspiciousGames();
  }

  if(panelName==='ladder'){
    initLadderPanel();
  }

  if(panelName==='audit-log'){
    loadAuditLog();
    // Always re-render when switching to audit-log panel so the latest local
    // entries are shown even if the Firebase listener hasn't fired yet.
    renderAuditTable();
  }

  if(panelName==='contact-directory'){
    cdInitPanel().then(()=>{cdUpdateStats();cdRenderDirectory();});
  }

  // Close sidebar on mobile
  if(window.innerWidth<=768){
    toggleSidebar();
  }
}

function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlayBg').classList.toggle('open');
}

function updateAdminSchoolLabel(){
  const labelEl=document.getElementById('adminSchoolLabel');
  if(!labelEl)return;
  if(currentAdminData.role==='super_admin'){
    labelEl.style.display='none';
    return;
  }
  const mySchools=getAdminSchools();
  if(mySchools.length===0){
    labelEl.textContent='⚠️ No school assigned';
    labelEl.style.display='block';
    return;
  }
  const names=mySchools.map(key=>schools[key]?.name||key).join(', ');
  labelEl.textContent=`🏫 Managing: ${names}`;
  labelEl.style.display='block';
}

function updateSettingsScopeInfo(){
  const isSuperAdmin=currentAdminData.role==='super_admin';

  const settingsInfo=document.getElementById('settingsScopeInfo');
  const settingsName=document.getElementById('settingsScopeSchoolName');
  if(settingsInfo&&settingsName){
    if(isSuperAdmin&&!currentSchool){
      settingsInfo.style.display='none';
    }else{
      const schoolName=schools[currentSchool]?.name||currentSchool||'your school';
      settingsName.textContent=schoolName;
      settingsInfo.style.display='block';
    }
  }

  const appearanceInfo=document.getElementById('appearanceScopeInfo');
  const appearanceName=document.getElementById('appearanceScopeSchoolName');
  if(appearanceInfo&&appearanceName){
    if(isSuperAdmin&&!currentSchool){
      appearanceInfo.style.display='none';
    }else{
      const schoolName=schools[currentSchool]?.name||currentSchool||'your school';
      appearanceName.textContent=schoolName;
      appearanceInfo.style.display='block';
    }
  }
}

function updateDashboardAccessControl(){
  const card=document.getElementById('dashboardAccessControlCard');
  if(!card)return;
  const hasSchoolScope=!!(currentSchool||(currentAdminData&&currentAdminData.role!=='super_admin'));
  card.style.display=hasSchoolScope?'':'none';
  if(!hasSchoolScope)return;

  const access=(schoolSettings&&schoolSettings.access)||{};
  const pinEnabled=!!access.pinEnabled;
  const tokenEnforced=!!access.enforceToken;

  const pinBadge=document.getElementById('dash-pin-badge');
  const pinIcon=document.getElementById('dash-pin-icon');
  const pinStatus=document.getElementById('dash-pin-status');
  const tokenBadge=document.getElementById('dash-token-badge');
  const tokenIcon=document.getElementById('dash-token-icon');
  const tokenStatus=document.getElementById('dash-token-status');

  if(pinEnabled){
    pinIcon.textContent='🔒';
    pinStatus.textContent='On';
    pinBadge.style.background='rgba(var(--accent-rgb,0,200,100),0.12)';
    pinBadge.style.borderColor='var(--accent)';
    pinBadge.style.color='var(--accent)';
  }else{
    pinIcon.textContent='🔓';
    pinStatus.textContent='Off';
    pinBadge.style.background='';
    pinBadge.style.borderColor='var(--border)';
    pinBadge.style.color='';
  }

  if(tokenEnforced){
    tokenIcon.textContent='🔒';
    tokenStatus.textContent='Enforced';
    tokenBadge.style.background='rgba(var(--accent-rgb,0,200,100),0.12)';
    tokenBadge.style.borderColor='var(--accent)';
    tokenBadge.style.color='var(--accent)';
  }else{
    tokenIcon.textContent='🔓';
    tokenStatus.textContent='Not enforced';
    tokenBadge.style.background='';
    tokenBadge.style.borderColor='var(--border)';
    tokenBadge.style.color='';
  }
}

function updateDashboardStats(){
  const schoolName=currentSchool?(schools[currentSchool]?.name||currentSchool):null;
  const filteredMatches=Object.values(matches).filter(m=>{
    if(!currentSchool)return true;
    // Check direct school fields
    const wsDirect = m.whiteSchool || m.white_school;
    const bsDirect = m.blackSchool || m.black_school;
    if (wsDirect === currentSchool || wsDirect === schoolName) return true;
    if (bsDirect === currentSchool || bsDirect === schoolName) return true;
    // Fall back to player lookup
    const ws=players[m.white]?.school || players[m.whiteId]?.school;
    const bs=players[m.black]?.school || players[m.blackId]?.school;
    return(ws===currentSchool||ws===schoolName)||(bs===currentSchool||bs===schoolName);
  });
  const activeGames=filteredMatches.filter(m=>m.status==='active').length;
  const activeComps=Object.values(competitions).filter(c=>c.status!=='stopped').length;
  // Scope school count: impersonating or regular admin sees only their school(s)
  const visibleSchoolIds=superAdminImpersonating&&currentSchool
    ?[currentSchool]
    :(currentAdminData.role!=='super_admin'?getAdminSchools():Object.keys(schools||{}));
  const schoolCount=visibleSchoolIds.length;
  
  document.getElementById('stat-active-games').textContent=activeGames;
  document.getElementById('stat-schools').textContent=schoolCount;
  document.getElementById('stat-competitions').textContent=activeComps;
  renderDashboardSchools();
  updateDashboardAccessControl();
}

function loadDashboardStats(){
  updateDashboardStats();
}

function renderDashboardSchools(){
  const container=document.getElementById('dashboardSchoolsList');
  if(!container)return;

  const isSuperAdmin=currentAdminData.role==='super_admin'&&!superAdminImpersonating;

  // Hide the "Your Schools" QR/URL list card for super admins — they use the dropdown instead
  const schoolsCard=document.getElementById('dashboardSchoolsCard');
  if(schoolsCard)schoolsCard.style.display=isSuperAdmin?'none':'block';

  // Populate the school dropdown filter for super admins
  populateDashboardSchoolFilter();
  // Show access requests card for super admins
  renderDashboardAccessRequests();

  // Determine which schools to show
  let schoolEntries;
  if(isSuperAdmin){
    // Super admin (non-impersonating) sees ALL schools
    schoolEntries=Object.entries(schools)
      .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'));
  }else if(superAdminImpersonating&&currentSchool){
    // Impersonating super admin sees only the selected school
    schoolEntries=schools[currentSchool]?[[currentSchool,schools[currentSchool]]]:[];
  }else{
    // Regular admin sees only their assigned schools
    const mySchools=getAdminSchools();
    schoolEntries=mySchools
      .filter(key=>schools[key])
      .map(key=>[key,schools[key]])
      .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'));
  }

  // Update card headings with school name for regular admins
  const schoolName=(!isSuperAdmin&&schoolEntries.length===1)
    ?(schoolEntries[0][1].name||schoolEntries[0][0])
    :null;
  const qrHeading=document.getElementById('dashboardSchoolsHeading');
  if(qrHeading) qrHeading.textContent=schoolName||'Your Schools';
  const lbHeading=document.getElementById('dashboardSchoolHeading');
  if(lbHeading) lbHeading.textContent=schoolName||'Your School';

  if(schoolEntries.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">🏫</div><p>No schools found</p></div>';
    return;
  }

  let html='';
  schoolEntries.forEach(([key,school])=>{
    const playerCount=Object.keys(players).filter(p=>players[p].school===key).length;
    const years=school.years||{};
    const yearList=Object.values(years).map(y=>y.name).sort((a,b)=>(parseInt(a)||0)-(parseInt(b)||0)).join(', ');
    const yearDisplay=yearList?`Years: ${yearList}`:'No years configured';
    const escapedKey=escapeHtml(key);

    if(!isSuperAdmin){
      // Regular admins: show QR + URL prominently
      const token=school.accessToken||null;
      const portalUrl=token?escapeHtml(getSchoolPortalUrl(token)):'';
      const qrUrl=token?`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getSchoolPortalUrl(token))}`:'';
      const accessSection=token
        ?`<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:12px;">
            <img src="${qrUrl}" alt="QR Code" style="width:100px;height:100px;border-radius:8px;background:#fff;padding:4px;flex-shrink:0;" title="Scan to open school portal">
            <div style="flex:1;min-width:0;">
              <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:8px;font-weight:700;">Student Access URL</div>
              <div style="font-family:monospace;font-size:1rem;color:var(--text);word-break:break-all;margin-bottom:10px;font-weight:500;">${portalUrl}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-outline" onclick="copySchoolUrl('${escapeHtml(token)}')">📋 Copy URL</button>
                <a href="${qrUrl.replace('200x200','400x400')}" target="_blank" class="btn btn-sm btn-outline" download="qr-${escapedKey}.png">⬇️ Download QR</a>
              </div>
            </div>
          </div>`
        :`<p style="margin-top:10px;color:var(--text-muted);font-size:.85rem;">No access URL yet — ask your super admin to generate one in the Schools panel.</p>`;
      html+=`<div style="padding:16px 0;">
        <div class="lb-name" style="font-size:1.1rem;margin-bottom:2px;">${escapeHtml(school.name||key)}</div>
        <div style="font-size:.8rem;color:var(--text-muted);">${escapeHtml(yearDisplay)} • ${playerCount} player${playerCount===1?'':'s'}</div>
        ${accessSection}
      </div>`;
    }else{
      html+=`<div class="lb-row">
        <div class="lb-info">
          <div class="lb-name">${escapeHtml(school.name||key)}</div>
          <div class="lb-school">${escapeHtml(yearDisplay)} • ${playerCount} player${playerCount===1?'':'s'}</div>
        </div>
      </div>`;
    }
  });
  container.innerHTML=html;
}

function renderDashboardAccessRequests(){
  const card=document.getElementById('dashboardAccessRequestsCard');
  const container=document.getElementById('dashboardAccessRequestsList');
  const isSuperAdmin=currentAdminData&&currentAdminData.role==='super_admin'&&!superAdminImpersonating;
  if(!card||!container)return;
  card.style.display=isSuperAdmin?'block':'none';
  if(!isSuperAdmin)return;

  const requests=Object.entries(accessRequests).filter(([id,r])=>r.status==='pending');
  const badge=document.getElementById('dashboardRequestsBadge');
  if(badge){
    if(requests.length>0){badge.textContent=requests.length;badge.style.display='inline-flex';}
    else{badge.style.display='none';}
  }

  if(requests.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">📫</div><p>No pending requests</p></div>';
    return;
  }
  let html='';
  requests.forEach(([id,r])=>{
    const date=new Date(r.requestedAt).toLocaleDateString();
    const escapedName=escapeHtml(r.name||'');
    const escapedEmail=escapeHtml(r.email||'');
    const escapedMessage=r.message?escapeHtml(r.message):'';
    const schoolLabel=r.createNewSchool?`${escapeHtml(r.schoolName||'')} <span style="color:var(--green);">(new)</span>`:`${escapeHtml(r.schoolName||'')} <span style="color:var(--text-dim);">(existing)</span>`;
    html+=`<div class="lb-row">
      <div class="lb-info">
        <div class="lb-name">${escapedName}</div>
        <div class="lb-school">${escapedEmail} • ${schoolLabel} • ${date}</div>
        ${r.message?`<div style="font-size:.8rem;color:var(--text-dim);margin-top:4px;">"${escapedMessage}"</div>`:''}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm btn-success" data-req-id="${id}" data-email="${escapedEmail}" data-name="${escapedName}" onclick="approveAccessRequestById(this)">✓ Approve</button>
        <button class="btn btn-sm btn-danger" data-req-id="${id}" onclick="denyAccessRequestById(this)">✗ Deny</button>
      </div>
    </div>`;
  });
  container.innerHTML=html;
}

function getSchoolDisplay(schoolId){
  if(!schoolId)return '';
  return schools[schoolId]?.name||schoolId;
}

function resolveSchoolKey(nameOrId){
  if(!nameOrId)return nameOrId;
  if(schools[nameOrId])return nameOrId;
  const entry=Object.entries(schools).find(([k,v])=>v.name===nameOrId);
  if(entry)return entry[0];
  const normalize=s=>String(s||'').toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const normalizedRef=normalize(nameOrId);
  if(!normalizedRef)return nameOrId;
  const normEntry=Object.entries(schools).find(([k,v])=>normalize(k)===normalizedRef||normalize(v.name)===normalizedRef);
  return normEntry?normEntry[0]:nameOrId;
}

function renderRecentMatches(){
  const container=document.getElementById('recentMatches');
  if(!container)return;
  const schoolName=currentSchool?(schools[currentSchool]?.name||currentSchool):null;

  // Helper: get school for a match side, handling both legacy and new formats
  function getMatchSchool(m, side) {
    // Direct school field on match (e.g. m.whiteSchool)
    const directSchool = side === 'white' ? (m.whiteSchool || m.white_school) : (m.blackSchool || m.black_school);
    if (directSchool) return directSchool;
    // Try player lookup by ID field first, then legacy field
    const playerId = side === 'white' ? (m.whiteId || m.white) : (m.blackId || m.black);
    const player = players[playerId];
    if (player?.school) return player.school;
    return null;
  }

  function getMatchName(m, side) {
    const directName = side === 'white' ? (m.whiteName || m.white_name) : (m.blackName || m.black_name);
    if (directName) return directName;
    const playerId = side === 'white' ? (m.whiteId || m.white) : (m.blackId || m.black);
    const player = players[playerId];
    if (player) return (player.firstName || player.first_name || '') + ' ' + (player.lastName || player.last_name || '');
    return null;
  }

  const PAGE_SIZE=20;
  const allFiltered=Object.entries(matches)
    .filter(([id,m])=>{
      if(!currentSchool)return true;
      const ws = getMatchSchool(m, 'white');
      const bs = getMatchSchool(m, 'black');
      return (ws===currentSchool||ws===schoolName)||(bs===currentSchool||bs===schoolName);
    })
    .sort((a,b)=>(b[1].startTime||b[1].timestamp||0)-(a[1].startTime||a[1].timestamp||0));

  const totalPages=Math.ceil(allFiltered.length/PAGE_SIZE)||1;
  if(recentMatchesPage>=totalPages)recentMatchesPage=totalPages-1;
  if(recentMatchesPage<0)recentMatchesPage=0;
  const filteredMatches=allFiltered.slice(recentMatchesPage*PAGE_SIZE,(recentMatchesPage+1)*PAGE_SIZE);

  if(allFiltered.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">♟️</div><p>No recent matches</p></div>';
    return;
  }

  let html='';
  filteredMatches.forEach(([id,m])=>{
    const whiteSchool=getSchoolDisplay(getMatchSchool(m,'white'));
    const blackSchool=getSchoolDisplay(getMatchSchool(m,'black'));
    const matchup=(whiteSchool&&blackSchool)?`${whiteSchool} vs ${blackSchool}`:'';
    const isAbandoned=m.resultType==='abandon'||m.resultType==='abandon_draw';
    const statusBadge=isAbandoned?'<span class="badge badge-red">Abandoned</span>':
                      m.result?'<span class="badge badge-blue">Finished</span>':
                      '<span class="badge badge-green">Active</span>';
    const result=m.result?` — ${escapeHtml(m.result)}`:'';
    const date=new Date(m.startTime||m.timestamp||0).toLocaleString();
    
    const safeId=id.replace(/'/g,"\\'");
    html+=`<div class="lb-row" style="cursor:pointer;" onclick="openMatchModal('${safeId}')">
      <div class="lb-info">
        ${matchup?`<div class="lb-name">${escapeHtml(matchup)}${result}</div>`:''}
        <div class="lb-school">${date} ${statusBadge}</div>
      </div>
    </div>`;
  });

  if(totalPages>1){
    html+=`<div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 0;margin-top:6px;">
      <button class="btn btn-sm btn-outline" onclick="recentMatchesPage--;renderRecentMatches();" ${recentMatchesPage===0?'disabled':''}>← Prev</button>
      <span style="font-size:.83rem;color:var(--text-muted);">Page ${recentMatchesPage+1} of ${totalPages} (${allFiltered.length} matches)</span>
      <button class="btn btn-sm btn-outline" onclick="recentMatchesPage++;renderRecentMatches();" ${recentMatchesPage>=totalPages-1?'disabled':''}>Next →</button>
    </div>`;
  }

  container.innerHTML=html;
}

function setAdminLbViewMode(mode){
  adminLbViewMode=mode;
  const btnCS=document.getElementById('adminBtnCrossSchool');
  const btnIH=document.getElementById('adminBtnInHouse');
  if(btnCS)btnCS.classList.toggle('active',mode==='cross-school');
  if(btnIH)btnIH.classList.toggle('active',mode==='in-house');
  renderLeaderboard();
}

function setDashboardSchoolFilter(value){
  dashboardSchoolFilter=value;
  renderLeaderboard();
}

function populateDashboardSchoolFilter(){
  const isSuperAdmin=currentAdminData&&currentAdminData.role==='super_admin'&&!superAdminImpersonating;
  const row=document.getElementById('dashboardSchoolFilterRow');
  if(!row)return;
  if(!isSuperAdmin){row.style.display='none';return;}
  row.style.display='block';
  const sel=document.getElementById('dashboardSchoolFilter');
  if(!sel)return;
  const currentVal=dashboardSchoolFilter;
  const sorted=Object.entries(schools).sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'));
  sel.innerHTML='<option value="">— Select a school to view stats —</option>'+
    sorted.map(([k,s])=>`<option value="${escapeHtml(k)}"${k===currentVal?' selected':''}>${escapeHtml(s.name||k)}</option>`).join('');
}

function renderLeaderboard(){
  const container=document.getElementById('leaderboardList');
  const schoolStats={};
  const pointsWin=Number(settings.pointsWin)||3;
  const pointsDraw=Number(settings.pointsDraw)||2;
  const pointsLoss=Number(settings.pointsLoss)||1;

  function canonicalSchoolKey(raw){
    if(!raw)return null;
    const resolved=resolveSchoolKey(raw);
    return schools[resolved]?resolved:null;
  }

  // Pre-seed ALL known schools so schools with 0 players still appear
  Object.entries(schools).forEach(([key, school])=>{
    if(currentSchool){
      const canonicalCurrent=canonicalSchoolKey(currentSchool)||currentSchool;
      if(key!==canonicalCurrent)return;
    }
    schoolStats[key]={
      id:key,
      name:school.name||key,
      players:0,
      wins:0,
      losses:0,
      draws:0,
      games:0
    };
  });

  // Count players per school (for display only)
  Object.values(players).forEach(player=>{
    const schoolKey=canonicalSchoolKey(player.school);
    if(!schoolKey)return;
    if(currentSchool){
      const canonicalCurrent=canonicalSchoolKey(currentSchool)||currentSchool;
      if(schoolKey!==canonicalCurrent)return;
    }
    if(!schoolStats[schoolKey]){
      schoolStats[schoolKey]={
        id:schoolKey,
        name:getSchoolDisplay(schoolKey)||'Unknown School',
        players:0,
        wins:0,
        losses:0,
        draws:0,
        games:0
      };
    }
    schoolStats[schoolKey].players+=1;
  });

  // Aggregate wins/losses/draws from actual match results (mirrors leaderboard.html logic)
  Object.values(matches).forEach(m=>{
    if(!m.result)return; // skip matches with no result yet
    if(m.scoreRemoved)return; // skip admin-voided matches
    if(m.suspicious&&!m.integrityApproved)return; // skip flagged games pending review
    const wId=m.whiteId||m.white;
    const bId=m.blackId||m.black;
    const wsRaw=m.whiteSchool||m.white_school||(players[wId]?.school)||null;
    const bsRaw=m.blackSchool||m.black_school||(players[bId]?.school)||null;
    const wsKey=canonicalSchoolKey(wsRaw);
    const bsKey=canonicalSchoolKey(bsRaw);

    if(!wsKey&&!bsKey)return;

    const canonicalCurrent=currentSchool?(canonicalSchoolKey(currentSchool)||currentSchool):null;
    if(canonicalCurrent){
      if(wsKey!==canonicalCurrent&&bsKey!==canonicalCurrent)return;
    }

    // Only create schoolStats entries for schools that are in scope.
    // Cross-school matches involving the current school must NOT leak the
    // opponent school into schoolStats — that would cause it to appear in
    // the leaderboard for a regular admin who has no access to it.
    if(wsKey&&!schoolStats[wsKey]&&(!canonicalCurrent||wsKey===canonicalCurrent))schoolStats[wsKey]={id:wsKey,name:getSchoolDisplay(wsKey)||'Unknown School',players:0,wins:0,losses:0,draws:0,games:0};
    if(bsKey&&!schoolStats[bsKey]&&(!canonicalCurrent||bsKey===canonicalCurrent))schoolStats[bsKey]={id:bsKey,name:getSchoolDisplay(bsKey)||'Unknown School',players:0,wins:0,losses:0,draws:0,games:0};

    const isSameSchool=wsKey&&bsKey&&wsKey===bsKey;

    if(adminLbViewMode==='in-house'){
      // In-house: only same-school matches; no losses recorded
      if(!isSameSchool)return;
      schoolStats[wsKey].games++;
      if(m.result==='draw'){schoolStats[wsKey].draws++;}
      else{schoolStats[wsKey].wins++;}
    }else{
      // Cross-school: skip same-school matches
      if(isSameSchool)return;
      if(wsKey&&schoolStats[wsKey])schoolStats[wsKey].games++;
      if(bsKey&&schoolStats[bsKey])schoolStats[bsKey].games++;
      if(m.result==='draw'){
        if(wsKey&&schoolStats[wsKey]){schoolStats[wsKey].draws++;}
        if(bsKey&&schoolStats[bsKey]){schoolStats[bsKey].draws++;}
      }else{
        const winKey=m.result==='white'?wsKey:bsKey;
        const loseKey=m.result==='white'?bsKey:wsKey;
        if(winKey&&schoolStats[winKey])schoolStats[winKey].wins++;
        if(loseKey&&schoolStats[loseKey])schoolStats[loseKey].losses++;
      }
    }
  });

  // Calculate points and apply mode-specific manual adjustments
  Object.values(schoolStats).forEach(s=>{
    const adjRoot=schoolAdjustments[s.id]||{};
    // Use the sub-object matching the current view mode; fall back to legacy
    // flat fields for cross-school view to preserve backward compatibility.
    const modeAdj=adminLbViewMode==='in-house'?(adjRoot.inHouse||{}):(adjRoot.crossSchool||{});
    const legacyBonus=adminLbViewMode==='cross-school'?(Number(adjRoot.bonusPoints)||0):0;
    const manualWins=Number(modeAdj.wins)||0;
    const manualLosses=Number(modeAdj.losses)||0;
    const manualDraws=Number(modeAdj.draws)||0;
    const manualGames=Number(modeAdj.games)||0;
    const bonusPoints=(Number(modeAdj.bonusPoints)||0)+legacyBonus;
    s.wins+=manualWins;
    s.losses+=manualLosses;
    s.draws+=manualDraws;
    s.games+=manualGames;
    s.points=s.wins*pointsWin+s.draws*pointsDraw+s.losses*pointsLoss+bonusPoints;
  });

  const isSuperAdminView=currentAdminData&&currentAdminData.role==='super_admin'&&!superAdminImpersonating;
  // Super admins use the dropdown to select a single school; prompt if none selected
  if(isSuperAdminView&&!dashboardSchoolFilter){
    container.innerHTML='<div class="empty-state"><div class="icon">🏫</div><p>Select a school from the dropdown above to view its stats</p></div>';
    return;
  }
  let rankedSchools=Object.values(schoolStats)
    .sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id,'sv'));
  if(isSuperAdminView&&dashboardSchoolFilter){
    rankedSchools=rankedSchools.filter(s=>s.id===dashboardSchoolFilter);
  }else{
    rankedSchools=rankedSchools.slice(0,20);
  }

  if(rankedSchools.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">🏫</div><p>No schools yet</p></div>';
    return;
  }
  
  let html='';
  rankedSchools.forEach((school,idx)=>{
    const rankClass='normal';
    const points=school.points;
    const mySchools=getAdminSchools();
    const resolvedId=resolveSchoolKey(school.id);
    const canAdjust=currentAdminData.role==='super_admin'||mySchools.includes(resolvedId)||mySchools.includes(school.id);
    const safeId=escapeHtml(school.id);
    function statCell(label,val,statKey){
      if(!canAdjust)return`<div><div class="lb-stat-val">${val}</div><div class="lb-stat-label">${label}</div></div>`;
      return`<div class="lb-stat-item"><button class="lb-stat-adj" onclick="adjustSchoolStat('${safeId}','${statKey}',1)" title="Add ${label.toLowerCase()}">▲</button><div class="lb-stat-val">${val}</div><button class="lb-stat-adj" onclick="adjustSchoolStat('${safeId}','${statKey}',-1)" title="Remove ${label.toLowerCase()}">▼</button><div class="lb-stat-label">${label}</div></div>`;
    }
    html+=`<div class="lb-row">
      <div class="lb-rank ${rankClass}">${idx+1}</div>
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(school.name)}</div>
        <div class="lb-school">${school.players} player${school.players===1?'':'s'}</div>
      </div>
      <div class="lb-stats">
        ${statCell('Points',points,'points')}
        ${statCell('Wins',school.wins,'wins')}
        ${statCell('Draws',school.draws,'draws')}
        ${statCell('Losses',school.losses,'losses')}
        ${statCell('Games',school.games,'games')}
      </div>
    </div>`;
  });
  
  container.innerHTML=html;
}

async function adjustSchoolStat(schoolId,stat,delta){
  const mySchools=getAdminSchools();
  const resolvedId=resolveSchoolKey(schoolId);
  if(currentAdminData.role!=='super_admin'&&!mySchools.includes(resolvedId)&&!mySchools.includes(schoolId)){
    alert('You can only adjust scores for your own school.');
    return;
  }

  // Require a reason for every manual adjustment
  const reason=prompt(`Reason for this ${delta>0?'+':''}${delta} ${stat} adjustment? (required)`);
  if(reason===null)return; // user cancelled
  if(!reason.trim()){alert('Please enter a reason for the adjustment.');return;}

  const keyToUse=schools[resolvedId]?resolvedId:schoolId;
  // 'points' maps to the bonusPoints field in the DB
  const dbField=stat==='points'?'bonusPoints':stat;
  // Write to mode-specific sub-object so cross-school and in-house adjustments are kept separate
  const modeKey=adminLbViewMode==='in-house'?'inHouse':'crossSchool';
  const ref=db.ref('admin/schoolAdjustments/'+keyToUse+'/'+modeKey+'/'+dbField);
  let previousValue=0;
  const txResult=await ref.transaction(current=>{
    previousValue=Number(current||0);
    return previousValue+delta;
  });
  if(!txResult.committed){
    alert('Unable to save score change. Please try again.');
    return;
  }
  const newValue=txResult.snapshot.val();
  // Immutable audit record via central helper
  await pushAuditEntry({
    eventType:     'stat_adjustment',
    schoolId:      keyToUse,
    schoolName:    (schools[keyToUse]||{}).name || keyToUse,
    stat:          stat,
    delta:         delta,
    previousValue: previousValue,
    newValue:      newValue,
    mode:          modeKey,
    reason:        reason.trim()
  });
}

async function adjustSchoolPoints(schoolId,delta){
  return adjustSchoolStat(schoolId,'points',delta);
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
let auditLogEntries = [];   // cached array, newest-first, each entry may have _key
let auditLogListener = null;
let auditCurrentPage = 0;
const AUDIT_PAGE_SIZE = 50;
const AUDIT_MAX_DATES = 90;
const AUDIT_LOAD_LIMIT = 5000;
const AUDIT_ANOMALY_DELTA = 20; // flag stat adjustments with |delta| >= this

function sortAuditEntriesNewestFirst(a,b){
  return Number(b?.ts||0)-Number(a?.ts||0);
}

// Central helper — every action that should be audited calls this.
async function pushAuditEntry(entry){
  const full={...entry, adminEmail:currentUser?.email||'', adminUid:currentUser?.uid||'', ts:Date.now()};
  const pushRef=await db.ref('admin/auditLog').push(full);
  if(!pushRef) console.warn('Audit log push may have failed',full);
  // Update local cache immediately (avoid duplicate when Firebase listener round-trips)
  const key=pushRef?.key||null;
  if(!auditLogEntries.some(e=>e._key===key)){
    auditLogEntries.unshift({...full,_key:key});
  }
  pruneAuditLog();
  renderAuditTable();
  renderAuditSummary();
}

async function loadAuditLog(){
  if(auditLogListener)return;
  const auditRef=db.ref('admin/auditLog').orderByChild('ts').limitToLast(AUDIT_LOAD_LIMIT);
  auditLogListener=snap=>{
    const next=[];
    snap.forEach(child=>{
      const val=child.val();
      if(val&&val.ts)next.push({...val,_key:child.key});
    });
    next.sort(sortAuditEntriesNewestFirst);
    auditLogEntries=next;
    renderAuditTable();
    renderAuditSummary();
    renderAuditAdminView();
  };
  auditRef.on('value',auditLogListener);
  loadAuditLog._ref=auditRef;
}

// Prune: keep only AUDIT_MAX_DATES unique calendar dates (oldest deleted first)
async function pruneAuditLog(){
  const byDate={};
  auditLogEntries.forEach(e=>{
    const date=new Date(e.ts).toISOString().slice(0,10);
    if(!byDate[date])byDate[date]=[];
    byDate[date].push(e);
  });
  const dates=Object.keys(byDate).sort(); // oldest first
  if(dates.length<=AUDIT_MAX_DATES)return;
  const toKeep=new Set(dates.slice(dates.length-AUDIT_MAX_DATES));
  const toDelete=auditLogEntries.filter(e=>!toKeep.has(new Date(e.ts).toISOString().slice(0,10)));
  const updates={};
  toDelete.forEach(e=>{if(e._key)updates[`admin/auditLog/${e._key}`]=null;});
  if(Object.keys(updates).length)await db.ref('/').update(updates);
  auditLogEntries=auditLogEntries.filter(e=>toKeep.has(new Date(e.ts).toISOString().slice(0,10)));
}

function isAnomalous(e){
  if(e.eventType==='stat_adjustment'||!e.eventType){
    if(Math.abs(e.delta||0)>=AUDIT_ANOMALY_DELTA)return true;
  }
  return false;
}

function getRelativeTime(ts){
  const diff=Date.now()-ts;
  if(diff<60000)return 'just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  return Math.floor(diff/86400000)+'d ago';
}

function getEventTypeCategory(eventType){
  if(!eventType||eventType==='stat_adjustment')return 'stat_adjustment';
  if(eventType.startsWith('news'))return 'news';
  if(eventType.startsWith('admin'))return 'admin';
  if(eventType.startsWith('school'))return 'school';
  if(eventType.startsWith('settings'))return 'settings';
  if(eventType.startsWith('ladder'))return 'ladder';
  return eventType;
}

function getEventLabel(e){
  const statLabel=s=>({points:'Bonus Points',wins:'Wins',draws:'Draws',losses:'Losses',games:'Games'}[s]||s);
  switch(e.eventType){
    case 'stat_adjustment': case undefined: case null: case '':{
      const isPos=e.delta>0;
      const chgColor=isPos?'var(--green)':'var(--red)';
      const deltaStr=`<span style="color:${chgColor};font-weight:700;">${isPos?'+':''}${e.delta}</span>`;
      return `${statLabel(e.stat)} ${deltaStr}`;
    }
    case 'news_created':           return '<span style="color:var(--green);">News posted</span>';
    case 'news_updated':           return '<span style="color:var(--primary);">News updated</span>';
    case 'news_deleted':           return '<span style="color:var(--red);">News deleted</span>';
    case 'admin_approved':         return '<span style="color:var(--green);">Admin access approved</span>';
    case 'admin_denied':           return '<span style="color:var(--red);">Admin access denied</span>';
    case 'admin_revoked':          return '<span style="color:var(--red);">Admin access revoked</span>';
    case 'admin_promoted':         return '<span style="color:var(--green);">Promoted to Super Admin</span>';
    case 'admin_demoted':          return '<span style="color:var(--orange,#f7b731);">Demoted from Super Admin</span>';
    case 'admin_schools_updated':  return '<span style="color:var(--primary);">Admin schools updated</span>';
    case 'school_created':         return '<span style="color:var(--green);">School created</span>';
    case 'school_updated':         return '<span style="color:var(--primary);">School updated</span>';
    case 'school_deleted':         return '<span style="color:var(--red);">School deleted</span>';
    case 'settings_portal':        return '<span style="color:var(--primary);">Portal settings saved</span>';
    case 'settings_game':          return '<span style="color:var(--primary);">Game settings saved</span>';
    case 'ladder_started':         return '<span style="color:var(--green);">Ladder started</span>';
    case 'ladder_paused':          return '<span style="color:var(--orange,#f7b731);">Ladder paused</span>';
    case 'ladder_resumed':         return '<span style="color:var(--green);">Ladder resumed</span>';
    case 'ladder_reset':           return '<span style="color:var(--orange,#f7b731);">Ladder reset</span>';
    case 'ladder_restarted':       return '<span style="color:var(--red);">Ladder fully restarted</span>';
    case 'ladder_scheduled':       return '<span style="color:var(--primary);">Ladder scheduled</span>';
    case 'ladder_schedule_cleared':return '<span style="color:var(--orange,#f7b731);">Ladder schedule cleared</span>';
    default: return escapeHtml(e.eventType||'Unknown');
  }
}

function renderAuditSummary(){
  const bar=document.getElementById('auditSummaryBar');
  if(!bar)return;
  const today=new Date().toISOString().slice(0,10);
  const todayCount=auditLogEntries.filter(e=>new Date(e.ts).toISOString().slice(0,10)===today).length;
  document.getElementById('auditStatToday').textContent=todayCount;

  const adminCounts={};
  auditLogEntries.forEach(e=>{if(e.adminEmail)adminCounts[e.adminEmail]=(adminCounts[e.adminEmail]||0)+1;});
  const topAdmin=Object.entries(adminCounts).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('auditStatTopAdmin').textContent=topAdmin?`${topAdmin[0]} (${topAdmin[1]})`:'—';

  const schoolCounts={};
  auditLogEntries.forEach(e=>{const s=e.schoolName||e.schoolId;if(s)schoolCounts[s]=(schoolCounts[s]||0)+1;});
  const topSchool=Object.entries(schoolCounts).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('auditStatTopSchool').textContent=topSchool?`${topSchool[0]} (${topSchool[1]})`:'—';

  document.getElementById('auditStatAnomalies').textContent=auditLogEntries.filter(isAnomalous).length;
  bar.style.display='';
}

function applyAuditFilters(entries){
  const emailFilter =(document.getElementById('auditFilterEmail')?.value ||'').toLowerCase();
  const schoolFilter=(document.getElementById('auditFilterSchool')?.value||'').toLowerCase();
  const dateFrom    = document.getElementById('auditFilterDateFrom')?.value||'';
  const dateTo      = document.getElementById('auditFilterDateTo')?.value  ||'';
  const typeFilter  = document.getElementById('auditFilterType')?.value    ||'';
  const modeFilter  = document.getElementById('auditFilterMode')?.value    ||'';
  const deltaMin    = parseInt(document.getElementById('auditFilterDeltaMin')?.value||'0')||0;
  return entries.filter(e=>{
    if(emailFilter  && !(e.adminEmail||'').toLowerCase().includes(emailFilter))return false;
    if(schoolFilter && !(e.schoolName||e.schoolId||e.targetName||e.targetEmail||'').toLowerCase().includes(schoolFilter))return false;
    if(dateFrom){const d=new Date(e.ts).toISOString().slice(0,10);if(d<dateFrom)return false;}
    if(dateTo)  {const d=new Date(e.ts).toISOString().slice(0,10);if(d>dateTo)  return false;}
    if(typeFilter && getEventTypeCategory(e.eventType)!==typeFilter)return false;
    if(modeFilter && e.mode!==modeFilter)return false;
    if(deltaMin>0  && Math.abs(e.delta||0)<deltaMin)return false;
    return true;
  });
}

function renderAuditTable(){
  const container=document.getElementById('auditLogTable');
  if(!container)return;

  const rows=applyAuditFilters(auditLogEntries);
  if(!rows.length){
    container.innerHTML='<p style="color:var(--text-dim);font-size:.9rem;padding:12px 0;">No entries found.</p>';
    document.getElementById('auditPagination').innerHTML='';
    return;
  }

  const totalPages=Math.ceil(rows.length/AUDIT_PAGE_SIZE);
  if(auditCurrentPage>=totalPages)auditCurrentPage=Math.max(0,totalPages-1);
  const pageRows=rows.slice(auditCurrentPage*AUDIT_PAGE_SIZE,(auditCurrentPage+1)*AUDIT_PAGE_SIZE);

  const today=new Date().toISOString().slice(0,10);
  const modeLabel=m=>m==='inHouse'?'In-House':m==='crossSchool'?'Cross-School':'—';

  const byDate={};
  pageRows.forEach(e=>{
    const date=new Date(e.ts).toISOString().slice(0,10);
    if(!byDate[date])byDate[date]=[];
    byDate[date].push(e);
  });
  const dates=Object.keys(byDate).sort().reverse();

  const tableHead=`<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr style="border-bottom:2px solid var(--border);color:var(--text-dim);text-align:left;">
      <th style="padding:10px 12px;white-space:nowrap;">Date &amp; Time</th>
      <th style="padding:10px 12px;">Admin</th>
      <th style="padding:10px 12px;">Target</th>
      <th style="padding:10px 12px;">Action</th>
      <th style="padding:10px 12px;white-space:nowrap;">Before → After</th>
      <th style="padding:10px 12px;">Mode</th>
      <th style="padding:10px 12px;">Reason</th>
    </tr></thead><tbody>`;

  let html='';
  dates.forEach(date=>{
    const entries=byDate[date];
    const isToday=date===today;
    const dateLabel=isToday?`Today — ${date}`:date;
    const sectionId=`audit-date-${date}`;
    let rowsHtml='';
    entries.forEach((e,i)=>{
      const fullTime=new Date(e.ts).toLocaleString('sv-SE');
      const relTime=getRelativeTime(e.ts);
      const anomaly=isAnomalous(e);
      const rowBg=anomaly?'background:rgba(255,50,50,0.07);':i%2===0?'':'background:rgba(255,255,255,0.02)';
      const anomalyFlag=anomaly?'<span title="Anomaly: large change" style="color:var(--red);margin-left:4px;">⚠</span>':'';
      let beforeAfter='—';
      if(e.eventType==='stat_adjustment'||!e.eventType){
        const isPos=e.delta>0;
        const chgColor=isPos?'var(--green)':'var(--red)';
        const chgArrow=isPos?'▲':'▼';
        const prevVal=e.previousValue!==undefined?e.previousValue:(e.newValue-e.delta);
        beforeAfter=`<span style="color:var(--text-dim)">${prevVal}</span> <span style="color:${chgColor}">${chgArrow}</span> <strong style="color:${chgColor}">${e.newValue}</strong>`;
      }
      const target=escapeHtml(e.schoolName||e.schoolId||e.targetEmail||e.targetName||'—');
      const reason=e.reason?`<span title="${escapeHtml(e.reason)}">${escapeHtml(e.reason.length>40?e.reason.slice(0,40)+'…':e.reason)}</span>`:'<span style="color:var(--text-dim);">—</span>';
      rowsHtml+=`<tr style="border-bottom:1px solid var(--border);${rowBg}">
        <td style="padding:10px 12px;white-space:nowrap;color:var(--text-dim);font-size:.78rem;" title="${relTime}">${fullTime}</td>
        <td style="padding:10px 12px;font-size:.8rem;">${escapeHtml(e.adminEmail||'—')}</td>
        <td style="padding:10px 12px;font-weight:700;color:var(--text);">${target}${anomalyFlag}</td>
        <td style="padding:10px 12px;">${getEventLabel(e)}</td>
        <td style="padding:10px 12px;">${beforeAfter}</td>
        <td style="padding:10px 12px;font-size:.78rem;color:var(--text-dim);">${e.mode?modeLabel(e.mode):'—'}</td>
        <td style="padding:10px 12px;font-size:.78rem;color:var(--text-dim);">${reason}</td>
      </tr>`;
    });
    html+=`<div style="margin-bottom:6px;">
      <div onclick="toggleAuditDate('${sectionId}')" style="cursor:pointer;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center;user-select:none;">
        <strong style="color:var(--text);">${dateLabel}</strong>
        <span style="color:var(--text-dim);font-size:.8rem;">${entries.length} event${entries.length!==1?'s':''} &nbsp;<span id="${sectionId}-arrow">${isToday?'▲':'▶'}</span></span>
      </div>
      <div id="${sectionId}" style="display:${isToday?'block':'none'};overflow-x:auto;">
        ${tableHead}${rowsHtml}</tbody></table>
      </div>
    </div>`;
  });

  container.innerHTML=html;
  renderAuditPagination(totalPages, rows.length);
}

function renderAuditPagination(totalPages, totalCount){
  const el=document.getElementById('auditPagination');
  if(!el)return;
  if(totalPages<=1){el.innerHTML='';return;}
  const btn=(label,page,disabled,active)=>{
    const s=active?'background:var(--primary);color:#fff;border-color:var(--primary);':'background:var(--bg-surface);color:var(--text);';
    const d=disabled?'opacity:.4;pointer-events:none;':'cursor:pointer;';
    return `<button onclick="auditGoPage(${page})" style="padding:5px 11px;border:1px solid var(--border);border-radius:6px;font-size:.8rem;${s}${d}">${label}</button>`;
  };
  let html=`<span style="font-size:.8rem;color:var(--text-dim);">Page ${auditCurrentPage+1}/${totalPages} · ${totalCount} events</span>`;
  html+=btn('«',0,auditCurrentPage===0,false);
  html+=btn('‹',auditCurrentPage-1,auditCurrentPage===0,false);
  for(let p=Math.max(0,auditCurrentPage-2);p<=Math.min(totalPages-1,auditCurrentPage+2);p++){
    html+=btn(p+1,p,false,p===auditCurrentPage);
  }
  html+=btn('›',auditCurrentPage+1,auditCurrentPage>=totalPages-1,false);
  html+=btn('»',totalPages-1,auditCurrentPage>=totalPages-1,false);
  el.innerHTML=html;
}

function auditGoPage(page){
  auditCurrentPage=page;
  renderAuditTable();
  document.getElementById('auditLogTable')?.scrollIntoView({behavior:'smooth',block:'start'});
}

function switchAuditTab(tab){
  const logPanel=document.getElementById('auditPanelLog');
  const adminsPanel=document.getElementById('auditPanelAdmins');
  const tabLog=document.getElementById('auditTabLog');
  const tabAdmins=document.getElementById('auditTabAdmins');
  if(tab==='log'){
    logPanel.style.display='';adminsPanel.style.display='none';
    tabLog.style.cssText+='border-bottom-color:var(--primary);color:var(--text);font-weight:600;';
    tabAdmins.style.cssText+='border-bottom-color:transparent;color:var(--text-dim);font-weight:400;';
  }else{
    logPanel.style.display='none';adminsPanel.style.display='';
    tabLog.style.cssText+='border-bottom-color:transparent;color:var(--text-dim);font-weight:400;';
    tabAdmins.style.cssText+='border-bottom-color:var(--primary);color:var(--text);font-weight:600;';
    renderAuditAdminView();
  }
}

function renderAuditAdminView(){
  const container=document.getElementById('auditAdminView');
  if(!container)return;
  const byAdmin={};
  auditLogEntries.forEach(e=>{
    const email=e.adminEmail||'Unknown';
    if(!byAdmin[email])byAdmin[email]={email,count:0,lastTs:0,schools:new Set(),anomalies:0};
    byAdmin[email].count++;
    if(e.ts>byAdmin[email].lastTs)byAdmin[email].lastTs=e.ts;
    const s=e.schoolName||e.schoolId||e.targetName;
    if(s)byAdmin[email].schools.add(s);
    if(isAnomalous(e))byAdmin[email].anomalies++;
  });
  const admins=Object.values(byAdmin).sort((a,b)=>b.count-a.count);
  if(!admins.length){container.innerHTML='<p style="color:var(--text-dim);font-size:.9rem;">No data yet.</p>';return;}
  let html=`<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr style="border-bottom:2px solid var(--border);color:var(--text-dim);text-align:left;">
      <th style="padding:10px 12px;">Admin</th>
      <th style="padding:10px 12px;">Total Actions</th>
      <th style="padding:10px 12px;">Schools Touched</th>
      <th style="padding:10px 12px;">Anomalies</th>
      <th style="padding:10px 12px;">Last Active</th>
    </tr></thead><tbody>`;
  admins.forEach((a,i)=>{
    const rowBg=i%2===0?'':'background:rgba(255,255,255,0.02)';
    const anomalyCell=a.anomalies>0?`<span style="color:var(--red);font-weight:700;">⚠ ${a.anomalies}</span>`:'<span style="color:var(--text-dim);">0</span>';
    const schoolList=[...a.schools].slice(0,3).map(escapeHtml).join(', ')+(a.schools.size>3?` +${a.schools.size-3} more`:'');
    html+=`<tr style="border-bottom:1px solid var(--border);${rowBg}">
      <td style="padding:10px 12px;font-weight:600;">${escapeHtml(a.email)}</td>
      <td style="padding:10px 12px;">${a.count}</td>
      <td style="padding:10px 12px;font-size:.78rem;color:var(--text-dim);">${schoolList||'—'}</td>
      <td style="padding:10px 12px;">${anomalyCell}</td>
      <td style="padding:10px 12px;font-size:.78rem;color:var(--text-dim);" title="${getRelativeTime(a.lastTs)}">${new Date(a.lastTs).toLocaleString('sv-SE')}</td>
    </tr>`;
  });
  html+='</tbody></table>';
  container.innerHTML=html;
}

function toggleAuditDate(sectionId){
  const el=document.getElementById(sectionId);
  const arrow=document.getElementById(sectionId+'-arrow');
  if(!el)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if(arrow)arrow.textContent=open?'▶':'▲';
}

function exportAuditLog(){
  const rows=applyAuditFilters(auditLogEntries);
  const modeLabel=m=>m==='inHouse'?'In-House':m==='crossSchool'?'Cross-School':'—';
  const statLabel=s=>({points:'Bonus Points',wins:'Wins',draws:'Draws',losses:'Losses',games:'Games'}[s]||s);
  const header='Date & Time            | Admin                                | Target                      | Action                    | Before | After | Mode         | Reason';
  const sep='-'.repeat(header.length);
  const lines=rows.map(e=>{
    const dt=new Date(e.ts).toLocaleString('sv-SE');
    let action='',before='',after='';
    if(e.eventType==='stat_adjustment'||!e.eventType){
      action=statLabel(e.stat)+' '+((e.delta>0?'+':'')+e.delta);
      const prev=e.previousValue!==undefined?e.previousValue:(e.newValue-e.delta);
      before=String(prev);after=String(e.newValue);
    }else{
      action=e.eventType;
    }
    const target=e.schoolName||e.schoolId||e.targetEmail||e.targetName||'—';
    return [dt.padEnd(22),(e.adminEmail||'—').padEnd(36),target.padEnd(28),action.padEnd(26),before.padEnd(6),after.padEnd(5),modeLabel(e.mode||'').padEnd(13),e.reason||''].join(' | ');
  });
  const txt=['IES Chess — Admin Audit Log',`Exported: ${new Date().toLocaleString('sv-SE')}`,sep,header,sep,...lines,sep].join('\n');
  const blob=new Blob([txt],{type:'text/plain'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`audit-log-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
}
// ── End Audit Log ──────────────────────────────────────────────────────────────

async function deleteAllScores(){
  if(currentAdminData.role!=='super_admin'){
    alert('Only super admins can delete all scores.');
    return;
  }

  const confirmed=confirm('Delete all player scores? This will reset wins, losses, draws, points, and rating for every player, and remove all matches and school adjustments.');
  if(!confirmed)return;

  try{
    const playersSnap=await db.ref('players').once('value');
    const updates={
      'matches':null,
      'admin/schoolAdjustments':null
    };
    playersSnap.forEach(child=>{
      const id=child.key;
      updates[`players/${id}/wins`]=0;
      updates[`players/${id}/losses`]=0;
      updates[`players/${id}/draws`]=0;
      updates[`players/${id}/points`]=0;
      updates[`players/${id}/rating`]=1200;
    });

    await db.ref('/').update(updates);
    alert('All player scores have been reset, and all matches and school adjustments have been removed.');
  }catch(error){
    alert('Failed to delete scores: '+error.message);
  }
}

async function purgeOldMoveData(){
  if(currentAdminData.role!=='super_admin'&&currentAdminData.role!=='admin'){
    alert('Only admins and super admins can purge move data.');
    return;
  }
  const ONE_WEEK_MS=7*24*60*60*1000;
  const cutoff=Date.now()-ONE_WEEK_MS;
  const eligible=Object.entries(matches).filter(([id,m])=>
    m.moves&&m.moves.length>0&&m.completedAt>0&&m.completedAt<cutoff
  );
  if(eligible.length===0){
    alert('No move data older than 1 week found. Nothing to purge.');
    return;
  }
  const confirmed=confirm(
    `This will remove the move history from ${eligible.length} match(es) completed more than 1 week ago.\n\nScores, results, and leaderboard data are NOT affected.\n\nContinue?`
  );
  if(!confirmed)return;
  try{
    const updates={};
    eligible.forEach(([id])=>{
      updates[`${id}/moves`]=null;
    });
    await db.ref('matches').update(updates);
    alert(`✅ Move data purged from ${eligible.length} match(es).`);
  }catch(err){
    alert('Failed to purge move data: '+err.message);
  }
}

function refreshAdminData(){
  loadDashboardStats();
  loadSchoolsForScope();
  renderCompetitions();
  renderLeaderboard();
  renderRecentMatches();
  updateDashboardStats();
}

async function logoutAdmin(){
  try{
    if(auditLogListener){
      const ref=loadAuditLog._ref||db.ref('admin/auditLog');
      ref.off('value',auditLogListener);
      auditLogListener=null;
    }
    await auth.signOut();
    window.location.reload();
  }catch(error){
    alert('Failed to log out: '+error.message);
  }
}

// COMPETITIONS
function renderCompetitions(){
  const container=document.getElementById('competitionsList');
  const comps=Object.entries(competitions);
  
  if(comps.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">🏆</div><h3>No competitions yet</h3><p>Create your first competition to get started</p></div>';
    return;
  }
  
  let html='<div class="comp-grid">';
  comps.forEach(([id,c])=>{
    const status=getCompStatus(c);
    const statusBadge=status==='live'?'<span class="badge badge-green">Live</span>':
                     status==='paused'?'<span class="badge badge-orange">Paused</span>':
                     status==='upcoming'?'<span class="badge badge-blue">Upcoming</span>':
                     '<span class="badge badge-red">Ended</span>';
    const start=new Date(c.startTime).toLocaleDateString();
    const end=c.openEnded?'Open-ended':new Date(c.endTime).toLocaleDateString();
    const rules=c.matchRules||{};
    const rulesBadges=[];
    if(rules.sameYear)rulesBadges.push('<span class="badge" style="background:#6c63ff;">Same Year</span>');
    if(rules.open)rulesBadges.push('<span class="badge" style="background:#1abc9c;">Cross-School</span>');
    const gameTime=c.gameTimeMinutes||10;
    
    html+=`<div class="comp-card">
      <div class="comp-card-top">
        <h4>${escapeHtml(c.name||'Untitled')}</h4>
        ${statusBadge}
      </div>
      <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:8px;">${escapeHtml(c.description||'')}</p>
      <div class="comp-card-meta">
        <span>📅 ${start}</span>
        <span>⏰ ${end}</span>
      </div>
      ${rulesBadges.length>0?`<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">${rulesBadges.join('')}</div>`:''}
      <div style="margin-top:4px;font-size:.8rem;color:var(--text-dim);">⏱️ ${gameTime} min per player</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">`;
    
    if(status==='live'){
      html+=`<button class="btn btn-sm btn-warning" onclick="pauseCompetition('${id}')">⏸ Pause</button>`;
      html+=`<button class="btn btn-sm btn-danger" onclick="stopCompetition('${id}')">⏹ Stop</button>`;
    }else if(status==='paused'){
      html+=`<button class="btn btn-sm btn-success" onclick="resumeCompetition('${id}')">▶ Resume</button>`;
      html+=`<button class="btn btn-sm btn-danger" onclick="stopCompetition('${id}')">⏹ Stop</button>`;
    }
    
    html+=`<button class="btn btn-sm btn-outline" onclick="editCompetition('${id}')">✏️ Edit</button>
      <button class="btn btn-sm btn-danger" onclick="deleteCompetition('${id}')">🗑️ Delete</button>
      </div>
    </div>`;
  });
  html+='</div>';
  container.innerHTML=html;
}

function getCompStatus(c){
  if(c.status==='stopped')return'ended';
  if(c.status==='paused')return'paused';
  const now=Date.now();
  const start=new Date(c.startTime).getTime();
  const isOpen=c.openEnded===true;
  const end=isOpen?Infinity:new Date(c.endTime).getTime();
  if(start>now)return'upcoming';
  if(end<now&&!isOpen)return'ended';
  return'live';
}

function toggleCompSchedule(){
  const enabled=document.getElementById('comp-schedule-enabled').checked;
  document.getElementById('comp-schedule-options').style.display=enabled?'block':'none';
}
function toggleCompYearRestrict(){
  const enabled=document.getElementById('comp-restrict-year').checked;
  document.getElementById('comp-year-restrict-options').style.display=enabled?'block':'none';
}

function showCreateCompetition(){
  editingCompId=null;
  document.getElementById('competitionModalTitle').textContent='Create Competition';
  document.getElementById('comp-name').value='';
  document.getElementById('comp-desc').value='';
  document.getElementById('comp-start').value='';
  document.getElementById('comp-end').value='';
  document.getElementById('comp-open-ended').checked=false;
  document.getElementById('comp-same-year').checked=false;
  document.getElementById('comp-cross-school').checked=false;
  document.getElementById('comp-game-time').value='10';
  document.getElementById('comp-rules').value='';
  document.getElementById('comp-schedule-enabled').checked=false;
  document.getElementById('comp-schedule-options').style.display='none';
  document.querySelectorAll('.comp-day-checkbox').forEach(cb=>cb.checked=false);
  document.getElementById('comp-available-from').value='';
  document.getElementById('comp-available-until').value='';
  document.getElementById('comp-restrict-year').checked=false;
  document.getElementById('comp-year-restrict-options').style.display='none';
  document.getElementById('comp-restricted-year').value='4';
  document.getElementById('competitionModal').classList.add('active');
}

function editCompetition(id){
  editingCompId=id;
  const c=competitions[id];
  document.getElementById('competitionModalTitle').textContent='Edit Competition';
  document.getElementById('comp-name').value=c.name||'';
  document.getElementById('comp-desc').value=c.description||'';
  document.getElementById('comp-start').value=c.startTime?new Date(c.startTime).toISOString().slice(0,10):'';
  document.getElementById('comp-end').value=c.endTime?new Date(c.endTime).toISOString().slice(0,10):'';
  document.getElementById('comp-open-ended').checked=c.openEnded||false;
  const rules=c.matchRules||{};
  document.getElementById('comp-same-year').checked=rules.sameYear||false;
  document.getElementById('comp-cross-school').checked=rules.open||false;
  document.getElementById('comp-game-time').value=c.gameTimeMinutes||10;
  document.getElementById('comp-rules').value=c.rules||'';
  const schedEnabled=c.scheduleEnabled||false;
  document.getElementById('comp-schedule-enabled').checked=schedEnabled;
  document.getElementById('comp-schedule-options').style.display=schedEnabled?'block':'none';
  const activeDays=c.availableDays||[];
  document.querySelectorAll('.comp-day-checkbox').forEach(cb=>{cb.checked=activeDays.includes(parseInt(cb.value))});
  document.getElementById('comp-available-from').value=c.availableFrom||'';
  document.getElementById('comp-available-until').value=c.availableUntil||'';
  const restrictedYear=(c.matchRules||{}).restrictedYear||null;
  document.getElementById('comp-restrict-year').checked=!!restrictedYear;
  document.getElementById('comp-year-restrict-options').style.display=restrictedYear?'block':'none';
  if(restrictedYear)document.getElementById('comp-restricted-year').value=restrictedYear;
  document.getElementById('competitionModal').classList.add('active');
}

async function saveCompetition(){
  const name=document.getElementById('comp-name').value.trim();
  const desc=document.getElementById('comp-desc').value.trim();
  const start=document.getElementById('comp-start').value;
  const end=document.getElementById('comp-end').value;
  const openEnded=document.getElementById('comp-open-ended').checked;
  const rules=document.getElementById('comp-rules').value.trim();
  
  if(!name||!start){
    alert('Please fill in required fields');
    return;
  }
  
  const scheduleEnabled=document.getElementById('comp-schedule-enabled').checked;
  const availableDays=scheduleEnabled?Array.from(document.querySelectorAll('.comp-day-checkbox:checked')).map(cb=>parseInt(cb.value)):[];
  const availableFrom=scheduleEnabled?(document.getElementById('comp-available-from').value||null):null;
  const availableUntil=scheduleEnabled?(document.getElementById('comp-available-until').value||null):null;

  const compData={
    name,
    description:desc,
    startTime:start,
    endTime:openEnded?null:end,
    openEnded,
    rules,
    matchRules:{
      sameYear:document.getElementById('comp-same-year').checked,
      open:document.getElementById('comp-cross-school').checked,
      restrictedYear:document.getElementById('comp-restrict-year').checked?(document.getElementById('comp-restricted-year').value||null):null
    },
    gameTimeMinutes:parseInt(document.getElementById('comp-game-time').value)||10,
    scheduleEnabled,
    availableDays,
    availableFrom,
    availableUntil,
    status:'active',
    createdBy:currentAdminData.email,
    createdAt:Date.now()
  };
  
  if(editingCompId){
    await db.ref('admin/competitions/'+editingCompId).update(compData);
  }else{
    await db.ref('admin/competitions').push(compData);
  }
  
  closeCompetitionModal();
}

async function pauseCompetition(id){
  await db.ref('admin/competitions/'+id+'/status').set('paused');
}

async function resumeCompetition(id){
  await db.ref('admin/competitions/'+id+'/status').set('active');
}

async function stopCompetition(id){
  if(confirm('Are you sure you want to stop this competition?')){
    await db.ref('admin/competitions/'+id+'/status').set('stopped');
  }
}

async function deleteCompetition(id){
  if(confirm('Are you sure you want to delete this competition? This cannot be undone.')){
    await db.ref('admin/competitions/'+id).remove();
  }
}

function closeCompetitionModal(){
  document.getElementById('competitionModal').classList.remove('active');
}

// NEWS
function renderNews(){
  const container=document.getElementById('newsList');
  const articles=Object.entries(news).sort((a,b)=>b[1].timestamp-a[1].timestamp);
  
  if(articles.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">📰</div><h3>No news articles yet</h3><p>Create your first article to get started</p></div>';
    return;
  }
  
  let html='';
  articles.forEach(([id,article])=>{
    const date=new Date(article.timestamp).toLocaleDateString();
    const imgHtml=article.image?`<img src="${escapeHtml(article.image)}" alt="" style="max-width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin:8px 0;">`:'' ;
    html+=`<div class="news-article">
      <h4>${escapeHtml(article.title||'Untitled')}</h4>
      <div class="news-meta">By ${escapeHtml(article.author||'Unknown')} • ${date}</div>
      ${imgHtml}
      <div class="news-body">${escapeHtml(article.body||'')}</div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn btn-sm btn-outline" onclick="editNews('${id}')">✏️ Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteNews('${id}')">🗑️ Delete</button>
      </div>
    </div>`;
  });
  
  container.innerHTML=html;
}

function setNewsSizeRadio(val){
  const radio=document.querySelector(`input[name="news-image-size"][value="${val||'full'}"]`);
  if(radio) radio.checked=true;
}

function getNewsSizeRadio(){
  const checked=document.querySelector('input[name="news-image-size"]:checked');
  return checked?checked.value:'full';
}

function showCreateNews(){
  editingNewsId=null;
  document.getElementById('newsModalTitle').textContent='Create News Article';
  document.getElementById('news-title').value='';
  document.getElementById('news-body').value='';
  document.getElementById('news-author').value=currentAdminData.name||'';
  document.getElementById('news-image').value='';
  setNewsSizeRadio('full');
  document.getElementById('newsModal').classList.add('active');
}

function editNews(id){
  editingNewsId=id;
  const article=news[id];
  document.getElementById('newsModalTitle').textContent='Edit News Article';
  document.getElementById('news-title').value=article.title||'';
  document.getElementById('news-body').value=article.body||'';
  document.getElementById('news-author').value=article.author||'';
  document.getElementById('news-image').value=article.image||'';
  setNewsSizeRadio(article.imageSize||'full');
  document.getElementById('newsModal').classList.add('active');
}

async function saveNews(){
  const title=document.getElementById('news-title').value.trim();
  const body=document.getElementById('news-body').value.trim();
  const author=document.getElementById('news-author').value.trim();
  const imageRaw=document.getElementById('news-image').value.trim();
  const imageSize=getNewsSizeRadio();

  if(!title||!body){
    alert('Please fill in title and content');
    return;
  }

  let image='';
  if(imageRaw){
    try{
      const u=new URL(imageRaw);
      if(u.protocol==='http:'||u.protocol==='https:') image=u.href;
      else{alert('Image URL must start with http:// or https://');return;}
    }catch{alert('Please enter a valid image URL');return;}
  }

  const articleData={
    title,
    body,
    author:author||'Admin',
    timestamp:Date.now()
  };
  if(image){
    articleData.image=image;
    articleData.imageSize=imageSize;
  }

  if(editingNewsId){
    await db.ref('admin/news/'+editingNewsId).update(articleData);
    pushAuditEntry({eventType:'news_updated', targetName:title});
  }else{
    await db.ref('admin/news').push(articleData);
    pushAuditEntry({eventType:'news_created', targetName:title});
  }

  closeNewsModal();
}

async function deleteNews(id){
  if(confirm('Are you sure you want to delete this article?')){
    const snap=await db.ref('admin/news/'+id+'/title').once('value');
    const title=snap.val()||id;
    await db.ref('admin/news/'+id).remove();
    pushAuditEntry({eventType:'news_deleted', targetName:title});
  }
}

function closeNewsModal(){
  document.getElementById('newsModal').classList.remove('active');
}

// SETTINGS
function populateSettings(){
  const isSuperAdmin=currentAdminData.role==='super_admin';
  let portalSettings,gameSettings;
  if(isSuperAdmin&&!currentSchool){
    // Global view: show global defaults only
    portalSettings=settings.portal||{};
    gameSettings=settings.game||{};
  }else{
    // School view (regular admin, or super admin with a school selected):
    // merge global defaults with school-specific overrides
    const globalPortal=settings.portal||{};
    const globalGame=settings.game||{};
    const schoolPortal=schoolSettings.portal||{};
    const schoolGame=schoolSettings.game||{};
    portalSettings={...globalPortal,...schoolPortal};
    gameSettings={...globalGame,...schoolGame};
  }
  
  document.getElementById('setting-play-enabled').checked=portalSettings.playEnabled!==false;
  
  // Use Schedule toggle (default to true for backwards compatibility)
  const useSchedule=portalSettings.useSchedule!==false;
  document.getElementById('setting-use-schedule').checked=useSchedule;
  toggleScheduleFields(useSchedule);
  
  // Active days
  const activeDays=portalSettings.activeDays||[1,2,3,4,5];
  document.querySelectorAll('.day-checkbox').forEach(cb=>{
    cb.checked=activeDays.includes(parseInt(cb.value));
  });
  
  document.getElementById('setting-start-time').value=portalSettings.startTime||'08:00';
  document.getElementById('setting-end-time').value=portalSettings.endTime||'17:00';
  
  document.getElementById('setting-default-time').value=gameSettings.defaultTime||10;
  document.getElementById('setting-increment').value=gameSettings.increment||0;
  document.getElementById('setting-same-year-only').checked=gameSettings.sameYearOnly||false;

  // Add event listener for use schedule toggle
  document.getElementById('setting-use-schedule').addEventListener('change',function(){
    toggleScheduleFields(this.checked);
  });

  // Access control settings — only visible when a school is in scope
  const hasSchoolScope=!!(currentSchool||(currentAdminData.role!=='super_admin'));
  document.getElementById('accessControlCard').style.display=hasSchoolScope?'':'none';
  if(hasSchoolScope){
    const accessSettings=schoolSettings.access||{};
    const pinEnabled=!!accessSettings.pinEnabled;
    document.getElementById('setting-pin-enabled').checked=pinEnabled;
    document.getElementById('setting-pin-code').value=accessSettings.pinCode||'';
    document.getElementById('setting-enforce-token').checked=!!accessSettings.enforceToken;
    togglePinFields(pinEnabled);
  }
  updateDashboardAccessControl();
}

function toggleScheduleFields(enabled){
  const scheduleFields=document.getElementById('schedule-fields');
  if(enabled){
    scheduleFields.style.opacity='1';
    scheduleFields.querySelectorAll('input').forEach(input=>input.disabled=false);
  }else{
    scheduleFields.style.opacity='0.5';
    scheduleFields.querySelectorAll('input').forEach(input=>input.disabled=true);
  }
}

function switchSettingsTab(tab,event){
  document.querySelectorAll('.settings-tab-content').forEach(t=>t.style.display='none');
  document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
  
  document.getElementById('settings-'+tab).style.display='block';
  if(event&&event.target){
    event.target.classList.add('active');
  }
}

async function savePortalSettings(){
  const isSuperAdmin=currentAdminData.role==='super_admin';
  const playEnabled=document.getElementById('setting-play-enabled').checked;
  const useSchedule=document.getElementById('setting-use-schedule').checked;
  const activeDays=Array.from(document.querySelectorAll('.day-checkbox:checked')).map(cb=>parseInt(cb.value));
  const startTime=document.getElementById('setting-start-time').value;
  const endTime=document.getElementById('setting-end-time').value;
  const data={playEnabled,useSchedule,activeDays,startTime,endTime};
  if(isSuperAdmin&&!currentSchool){
    // Super admin in global view — update the global defaults
    await db.ref('admin/settings/portal').set(data);
    pushAuditEntry({eventType:'settings_portal', targetName:'Global'});
  }else{
    // Super admin with a school selected, or regular admin — save per-school
    const school=currentSchool||getAdminSchools()[0];
    if(!school){alert('No school selected.');return;}
    await db.ref('admin/schools/'+school+'/settings/portal').set(data);
    pushAuditEntry({eventType:'settings_portal', schoolId:school, schoolName:(schools[school]||{}).name||school});
  }

  alert('Portal settings saved successfully!');
}

async function saveGameSettings(){
  const isSuperAdmin=currentAdminData.role==='super_admin';
  const defaultTime=parseInt(document.getElementById('setting-default-time').value);
  const increment=parseInt(document.getElementById('setting-increment').value);
  const sameYearOnly=document.getElementById('setting-same-year-only').checked;
  const data={defaultTime,increment,sameYearOnly};
  if(isSuperAdmin&&!currentSchool){
    // Super admin in global view — update the global defaults
    await db.ref('admin/settings/game').set(data);
    pushAuditEntry({eventType:'settings_game', targetName:'Global'});
  }else{
    // Super admin with a school selected, or regular admin — save per-school
    const school=currentSchool||getAdminSchools()[0];
    if(!school){alert('No school selected.');return;}
    await db.ref('admin/schools/'+school+'/settings/game').set(data);
    pushAuditEntry({eventType:'settings_game', schoolId:school, schoolName:(schools[school]||{}).name||school});
  }

  alert('Game settings saved successfully!');
}

function togglePinFields(enabled){
  document.getElementById('pinCodeFields').style.display=enabled?'block':'none';
}

async function saveAccessSettings(){
  const school=currentSchool||getAdminSchools()[0];
  if(!school){alert('No school selected.');return;}
  const pinEnabled=document.getElementById('setting-pin-enabled').checked;
  const enforceToken=document.getElementById('setting-enforce-token').checked;
  const pinCodeRaw=document.getElementById('setting-pin-code').value.trim();
  if(pinEnabled){
    if(!/^\d{4}$/.test(pinCodeRaw)){alert('PIN must be exactly 4 digits (0-9).');return;}
  }
  const data={pinEnabled,enforceToken,pinCode:pinEnabled?pinCodeRaw:''};
  try{
    await db.ref('admin/schools/'+school+'/settings/access').set(data);
    pushAuditEntry({eventType:'settings_access', schoolId:school, schoolName:(schools[school]||{}).name||school});
    alert('Access settings saved successfully!');
  }catch(e){alert('Error saving access settings: '+e.message);}
}

// APPEARANCE
let selectedLightColor='#f0d9b5';
let selectedDarkColor='#b58863';
let selectedPieceStyle='classic';

function selectColor(type,color){
  if(type==='light'){
    selectedLightColor=color;
    document.querySelectorAll('.color-options[data-type="light"] .color-swatch').forEach(s=>{
      if(s.dataset.color===color){
        s.classList.add('selected');
      }else{
        s.classList.remove('selected');
      }
    });
  }else{
    selectedDarkColor=color;
    document.querySelectorAll('.color-options[data-type="dark"] .color-swatch').forEach(s=>{
      if(s.dataset.color===color){
        s.classList.add('selected');
      }else{
        s.classList.remove('selected');
      }
    });
  }
  updateBoardPreview();
}

function updateBoardPreview(){
  const preview=document.getElementById('boardPreview');
  let html='';
  for(let i=0;i<64;i++){
    const row=Math.floor(i/8);
    const col=i%8;
    const isLight=(row+col)%2===0;
    const color=isLight?selectedLightColor:selectedDarkColor;
    html+=`<div class="sq" style="background:${color};"></div>`;
  }
  preview.innerHTML=html;
}

async function saveBoardColors(){
  let targetPath='admin/appearance/boardColors';

  if(currentAdminData.role!=='super_admin'||currentSchool){
    // Regular admin, or super admin with a school selected — save per-school
    const school=currentSchool||getAdminSchools()[0];
    if(!school){
      alert('Your admin account is missing a school assignment.');
      return;
    }
    targetPath='admin/schools/'+school+'/appearance/boardColors';
  }

  await db.ref(targetPath).set({
    light:selectedLightColor,
    dark:selectedDarkColor
  });
  alert('Board colors saved successfully!');
}

function selectPieceStyle(style){
  selectedPieceStyle=style;
  document.querySelectorAll('.piece-style-option').forEach(opt=>{
    if(opt.dataset.style===style){
      opt.classList.add('selected');
    }else{
      opt.classList.remove('selected');
    }
  });
}

async function savePieceStyle(){
  let targetPath='admin/appearance/pieceStyle';

  if(currentAdminData.role!=='super_admin'||currentSchool){
    // Regular admin, or super admin with a school selected — save per-school
    const school=currentSchool||getAdminSchools()[0];
    if(!school){
      alert('Your admin account is missing a school assignment.');
      return;
    }
    targetPath='admin/schools/'+school+'/appearance/pieceStyle';
  }

  await db.ref(targetPath).set(selectedPieceStyle);
  alert('Piece style saved successfully!');
}

// Initialize board preview on appearance panel
setTimeout(()=>{
  refreshAppearanceEditor();
},500);

// ADMIN USERS
function renderAdminUsers(){
  const container=document.getElementById('adminUsersList');
  const users=Object.entries(adminUsers).filter(([id,u])=>u.approved);

  if(users.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">🔐</div><p>No admin users</p></div>';
    return;
  }

  const currentUid=currentUser?currentUser.uid:null;

  let html='';
  users.forEach(([id,u])=>{
    const roleBadge=u.role==='super_admin'?'<span class="badge badge-gold">Super Admin</span>':'<span class="badge badge-blue">Admin</span>';
    const date=u.approvedAt?new Date(u.approvedAt).toLocaleDateString():'N/A';
    const isSelf=id===currentUid;
    const isHardcodedSuperAdmin=(u.email||'').toLowerCase()===SUPER_ADMIN_EMAIL.toLowerCase();

    // Schools button — only for regular admins
    const editSchoolsBtn=u.role!=='super_admin'?`<button class="btn btn-sm btn-outline" onclick="openEditAdminSchoolsModal('${escapeHtml(id)}','${escapeHtml(u.name||u.email||'Admin')}')">🏫 Schools</button>`:'';

    // Promote / Demote button — super admins can promote regular admins, or demote other super admins
    // Cannot demote yourself or the hardcoded super admin
    let promoteBtn='';
    if(currentAdminData.role==='super_admin'){
      if(u.role!=='super_admin'){
        promoteBtn=`<button class="btn btn-sm btn-outline" style="color:var(--gold,#f5c518);border-color:var(--gold,#f5c518);" onclick="promoteToSuperAdmin('${escapeHtml(id)}','${escapeHtml(u.name||u.email||'Admin')}')">&#11014; Promote</button>`;
      }else if(!isSelf&&!isHardcodedSuperAdmin){
        promoteBtn=`<button class="btn btn-sm btn-outline" onclick="demoteFromSuperAdmin('${escapeHtml(id)}','${escapeHtml(u.name||u.email||'Admin')}')">&#11015; Demote</button>`;
      }
    }

    html+=`<div class="lb-row">
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(u.name||u.email||'Unknown')}${isSelf?' <span style="color:var(--text-dim);font-size:.75rem;">(you)</span>':''}</div>
        <div class="lb-school">${escapeHtml(u.email||'')} • Approved ${date}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        ${roleBadge}
        ${promoteBtn}
        ${editSchoolsBtn}
        ${u.role!=='super_admin'?`<button class="btn btn-sm btn-danger" onclick="revokeAdminAccess('${escapeHtml(id)}')">Revoke</button>`:''}
      </div>
    </div>`;
  });

  container.innerHTML=html;
}

async function promoteToSuperAdmin(uid,adminName){
  if(currentAdminData.role!=='super_admin'){
    alert('Only super admins can promote users.');
    return;
  }
  if(!confirm(`Promote ${adminName} to Super Admin?\n\nSuper admins have full access to all schools, settings, and user management.`))return;
  await db.ref('admin/users/'+uid+'/role').set('super_admin');
  pushAuditEntry({eventType:'admin_promoted', targetEmail:adminName, targetUid:uid});
  alert(`${adminName} has been promoted to Super Admin.`);
}

async function demoteFromSuperAdmin(uid,adminName){
  if(currentAdminData.role!=='super_admin'){
    alert('Only super admins can demote users.');
    return;
  }
  if(!confirm(`Demote ${adminName} from Super Admin to regular Admin?\n\nThey will lose access to all schools and global settings.`))return;
  await db.ref('admin/users/'+uid+'/role').set('admin');
  pushAuditEntry({eventType:'admin_demoted', targetEmail:adminName, targetUid:uid});
  alert(`${adminName} has been demoted to Admin.`);
}

function renderAccessRequests(){
  const container=document.getElementById('accessRequestsList');
  const requests=Object.entries(accessRequests).filter(([id,r])=>r.status==='pending');
  
  if(requests.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">📫</div><p>No pending requests</p></div>';
    return;
  }
  
  let html='';
  requests.forEach(([id,r])=>{
    const date=new Date(r.requestedAt).toLocaleDateString();
    const escapedName=escapeHtml(r.name||'');
    const escapedEmail=escapeHtml(r.email||'');
    const escapedMessage=r.message?escapeHtml(r.message):'';
    const schoolLabel=r.createNewSchool?`${escapeHtml(r.schoolName||'')} <span style="color:var(--green);">(new — will be created on approval)</span>`:`${escapeHtml(r.schoolName||'')} <span style="color:var(--text-dim);">(existing)</span>`;
    html+=`<div class="lb-row">
      <div class="lb-info">
        <div class="lb-name">${escapedName}</div>
        <div class="lb-school">${escapedEmail} • ${schoolLabel} • ${date}</div>
        ${r.message?`<div style="font-size:.8rem;color:var(--text-dim);margin-top:4px;">"${escapedMessage}"</div>`:''}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm btn-success" data-req-id="${id}" data-email="${escapedEmail}" data-name="${escapedName}" onclick="approveAccessRequestById(this)">✓ Approve</button>
        <button class="btn btn-sm btn-danger" data-req-id="${id}" onclick="denyAccessRequestById(this)">✗ Deny</button>
      </div>
    </div>`;
  });
  
  container.innerHTML=html;
}

function updateAccessRequestsBadge(){
  const pending=Object.values(accessRequests).filter(r=>r.status==='pending').length;
  // Badge on the Access Requests tab inside Admin Users panel
  const badge=document.getElementById('requestsBadge');
  if(badge){
    if(pending>0){badge.textContent=pending;badge.style.display='inline-flex';}
    else{badge.style.display='none';}
  }
  // Badge on the Admin Users nav item
  const navBadge=document.getElementById('adminUsersNavBadge');
  if(navBadge){
    if(pending>0){navBadge.textContent=pending;navBadge.style.display='inline-flex';}
    else{navBadge.style.display='none';}
  }
  // Update the dashboard access requests card
  renderDashboardAccessRequests();
}

function switchAdminTab(tab,event){
  document.querySelectorAll('.admin-tab-content').forEach(t=>t.style.display='none');
  document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
  
  document.getElementById('admin-'+tab+'-content').style.display='block';
  if(event&&event.target){
    event.target.classList.add('active');
  }
}

// ── Pending approval context (set when the modal is opened) ─────────────────
let pendingApprovalReqId=null;
let pendingApprovalReqData=null;

// Step 1: fetch data, auto-detect school, open the confirmation modal.
async function approveAccessRequest(reqId,email,name){
  const reqSnap=await db.ref('admin/accessRequests/'+reqId).once('value');
  const reqData=reqSnap.val();

  if(!reqData){
    alert('❌ Request not found. It may have been deleted or already processed. Please refresh.');
    return;
  }
  if(!reqData.uid){
    alert('❌ Request is missing a user ID. Ask the applicant to submit a new request.');
    return;
  }

  // Load all schools so we can build the checklist and auto-detect.
  const schoolsSnap=await db.ref('admin/schools').once('value');
  const allSchools=schoolsSnap.val()||{};

  // Auto-detect which school this email belongs to.
  const autoKey=resolveEmailToSchoolKey(email,allSchools);
  const preSelected=autoKey?[autoKey]:[];

  openApproveWithSchoolsModal(reqId,reqData,allSchools,preSelected);
}

// Step 2: render the modal.
function openApproveWithSchoolsModal(reqId,reqData,allSchools,preSelectedKeys){
  pendingApprovalReqId=reqId;
  pendingApprovalReqData=reqData;

  const escapedName=escapeHtml(reqData.name||'');
  const escapedEmail=escapeHtml(reqData.email||'');

  // Info banner showing who is being approved and what was detected.
  let infoHtml=`<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;">
    <div style="font-weight:600;margin-bottom:4px;">${escapedName}</div>
    <div style="color:var(--text-dim);font-size:.875rem;">${escapedEmail}</div>`;

  if(preSelectedKeys.length>0){
    const detectedName=escapeHtml(allSchools[preSelectedKeys[0]]?.name||preSelectedKeys[0]);
    infoHtml+=`<div style="margin-top:8px;color:var(--green,#26de81);font-size:.875rem;">🔍 Auto-detected school: <strong>${detectedName}</strong></div>`;
  }else{
    const localPart=(reqData.email||'').split('@')[0];
    const parts=localPart.split('.');
    if(parts.length<3){
      infoHtml+=`<div style="margin-top:8px;color:#f5c518;font-size:.875rem;">ℹ️ No school found in email — likely an HQ user. Please select school(s) manually below.</div>`;
    }else{
      const emailSchoolPart=escapeHtml(parts[parts.length-1]);
      infoHtml+=`<div style="margin-top:8px;color:#f5c518;font-size:.875rem;">⚠️ Could not match "<strong>${emailSchoolPart}</strong>" to any existing school. Please assign manually below.</div>`;
    }
  }
  infoHtml+=`</div>`;
  document.getElementById('approveWithSchoolsInfo').innerHTML=infoHtml;

  // Build school checklist (sorted Swedish-alphabetically).
  const checklist=document.getElementById('approveWithSchoolsChecklist');
  if(Object.keys(allSchools).length===0){
    checklist.innerHTML='<div style="color:var(--text-dim);font-size:.875rem;">No schools found. You can assign schools later from the Admin Users tab.</div>';
  }else{
    checklist.innerHTML=Object.entries(allSchools)
      .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'))
      .map(([key,school])=>`
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 10px;background:var(--bg-surface);border-radius:6px;border:1px solid var(--border);">
          <input type="checkbox" value="${escapeHtml(key)}" ${preSelectedKeys.includes(key)?'checked':''}>
          🏫 ${escapeHtml(school.name||key)}
        </label>
      `).join('');
  }

  document.getElementById('approveWithSchoolsModal').classList.add('active');
}

function closeApproveWithSchoolsModal(){
  document.getElementById('approveWithSchoolsModal').classList.remove('active');
  pendingApprovalReqId=null;
  pendingApprovalReqData=null;
}

// Step 3: user clicks "Approve & Assign" — collect checked schools and execute.
async function confirmApproveWithSchools(){
  if(!pendingApprovalReqId||!pendingApprovalReqData)return;
  const selectedSchools=Array.from(
    document.querySelectorAll('#approveWithSchoolsChecklist input:checked')
  ).map(cb=>cb.value);
  await executeApproval(pendingApprovalReqId,pendingApprovalReqData,selectedSchools);
  closeApproveWithSchoolsModal();
}

// Step 4: write admin user record, update request status, send email.
async function executeApproval(reqId,reqData,schoolKeys){
  const {uid,email,name}=reqData;

  // Create new school on-the-fly if the applicant flagged one.
  let newSchoolKey=null;
  if(reqData.createNewSchool&&reqData.schoolName){
    const sk=generateSchoolKey(reqData.schoolName);
    const schoolSnap=await db.ref('admin/schools/'+sk).once('value');
    if(!schoolSnap.val()){
      await db.ref('admin/schools/'+sk).set({
        name:reqData.schoolName,
        years:{y4:{name:'4'},y5:{name:'5'},y6:{name:'6'},y7:{name:'7'},y8:{name:'8'},y9:{name:'9'}},
        createdAt:Date.now(),
        updatedAt:Date.now()
      });
      console.log('Created new school:',reqData.schoolName,'→',sk);
    }
    newSchoolKey=sk;
    if(!schoolKeys.includes(sk)) schoolKeys=[sk,...schoolKeys];
  }

  // Persist admin user with full multi-school array.
  const adminUserData={
    email,
    name,
    role:'admin',
    approved:true,
    approvedBy:currentAdminData.email,
    approvedAt:Date.now(),
    schools:schoolKeys,
    school:schoolKeys.length>0?schoolKeys[0]:(newSchoolKey||null)
  };

  await db.ref('admin/users/'+uid).set(adminUserData);
  await db.ref('admin/accessRequests/'+reqId+'/status').set('approved');
  pushAuditEntry({eventType:'admin_approved', targetEmail:email, targetName:name, targetUid:uid});

  // Send approval email.
  if(firestore){
    try{
      await firestore.collection('mail').add({
        to:email,
        message:{
          subject:'✅ Admin Access Approved - IES Chess',
          text:`Your admin access request has been approved! You can now sign in at https://iesv.se/chess/admin.html`,
          html:`
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #26de81;">✅ Access Approved!</h2>
            <p>Good news! Your admin access request for IES Chess has been approved.</p>
            <p>
              <a href="https://iesv.se/chess/admin.html"
                 style="background: #4285f4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Sign In to Admin Portal
              </a>
            </p>
          </div>
          `
        }
      });
      alert('✅ Access approved! An email notification has been queued for the applicant.');
    }catch(emailError){
      console.error('Failed to send email notification:',emailError);
      alert('✅ Access approved! However, the email notification may not have been sent. Please notify the applicant directly.');
    }
  }else{
    alert('✅ Access approved! Email notifications are not configured. Please notify the applicant directly at: '+email);
  }
}

async function denyAccessRequest(reqId){
  if(!confirm('Deny this access request?'))return;
  const snap=await db.ref('admin/accessRequests/'+reqId).once('value');
  const req=snap.val()||{};
  await db.ref('admin/accessRequests/'+reqId+'/status').set('denied');
  pushAuditEntry({eventType:'admin_denied', targetEmail:req.email||reqId, targetName:req.name||''});
}

async function revokeAdminAccess(uid){
  if(!confirm('Revoke admin access for this user?'))return;
  const snap=await db.ref('admin/users/'+uid+'/email').once('value');
  const targetEmail=snap.val()||uid;
  await db.ref('admin/users/'+uid).remove();
  pushAuditEntry({eventType:'admin_revoked', targetEmail, targetUid:uid});
}

// Wrapper functions for data-attribute based event handlers
function approveAccessRequestById(btn){
  const reqId=btn.dataset.reqId;
  const email=btn.dataset.email;
  const name=btn.dataset.name;
  approveAccessRequest(reqId,email,name);
}

function denyAccessRequestById(btn){
  const reqId=btn.dataset.reqId;
  denyAccessRequest(reqId);
}

// SCHOOLS MANAGEMENT FUNCTIONS

function generateAccessToken(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token='';
  const arr=new Uint8Array(20);
  crypto.getRandomValues(arr);
  arr.forEach(b=>{token+=chars[b%chars.length]});
  return token;
}

function getSchoolPortalUrl(token){
  return window.location.origin+window.location.pathname.replace('admin.html','index.html')+'?s='+token;
}

function renderSchools(){
  const container=document.getElementById('schoolsList');
  const isSuperAdmin=currentAdminData.role==='super_admin'&&!superAdminImpersonating;
  const adminSchoolIds=isSuperAdmin?null:
    superAdminImpersonating&&currentSchool?[currentSchool]:getAdminSchools();

  let schoolEntries=Object.entries(schools)
    .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'));

  if(!isSuperAdmin&&adminSchoolIds){
    schoolEntries=schoolEntries.filter(([key])=>adminSchoolIds.includes(key));
  }

  if(schoolEntries.length===0){
    container.innerHTML='<div class="empty-state"><div class="icon">🏫</div><h3>No schools yet</h3><p>Click "Add School" to create your first school</p></div>';
    return;
  }

  const myUid=currentUser?currentUser.uid:null;

  let html='';
  schoolEntries.forEach(([key,school])=>{
    const escapedName=escapeHtml(school.name||key);
    const escapedKey=escapeHtml(key);
    const playerCount=Object.keys(players).filter(p=>players[p].school===key).length;

    // Get year levels for this school
    const years=school.years||{};
    const yearList=Object.values(years).map(y=>y.name).sort((a,b)=>{
      const numA=parseInt(a)||0;
      const numB=parseInt(b)||0;
      return numA-numB;
    }).join(', ');
    const yearDisplay=yearList?`Years: ${yearList}`:'No years configured';

    // School contacts
    const contacts=school.contacts||{};
    const contactList=Object.values(contacts);
    const hasContacts=contactList.length>0;
    const isMyContact=myUid&&!!contacts[myUid];
    const contactBadge=hasContacts
      ?`<span class="contact-ok">✓ ${contactList.length} contact${contactList.length===1?'':'s'}</span>`
      :`<span class="contact-warning">⚠ No contact set</span>`;
    const contactNames=hasContacts?contactList.map(c=>escapeHtml(c.name||c.email||'?')).join(', '):'';
    const myContactToggle=`<button class="contact-toggle-btn${isMyContact?' is-contact':''}" data-school-key="${escapedKey}" onclick="toggleSchoolContact(this)">${isMyContact?'✓ I am a School Contact':'+ Be a School Contact'}</button>`;

    // Access token / QR section
    const token=school.accessToken||null;
    const portalUrl=token?escapeHtml(getSchoolPortalUrl(token)):'';
    const qrUrl=token?`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(getSchoolPortalUrl(token))}`:'';
    const manageButtons=isSuperAdmin
      ?`<button class="btn btn-sm btn-outline" data-school-key="${escapedKey}" onclick="editSchoolByKey(this)">✏️ Edit</button>
         <button class="btn btn-sm btn-danger" data-school-key="${escapedKey}" onclick="deleteSchoolByKey(this)">🗑️ Delete</button>`
      :'';
    const regenerateBtn=isSuperAdmin
      ?`<button class="btn btn-sm btn-outline" style="color:var(--orange);border-color:var(--orange);" data-school-key="${escapedKey}" onclick="regenerateTokenByKey(this)">🔄 Regenerate</button>`
      :'';
    const generateBtn=isSuperAdmin
      ?`<div style="margin-top:10px;"><button class="btn btn-sm btn-outline" data-school-key="${escapedKey}" onclick="generateTokenByKey(this)">🔑 Generate Access URL</button></div>`
      :'<div style="margin-top:10px;color:var(--text-muted);font-size:.8rem;">No access URL set — ask your super admin to generate one.</div>';
    const tokenSection=token
      ?`<div style="margin-top:12px;padding:12px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">
          <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:8px;font-weight:700;">School Access URL</div>
          <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <img src="${qrUrl}" alt="QR Code" style="width:100px;height:100px;border-radius:6px;background:#fff;padding:4px;flex-shrink:0;" title="Scan to open school portal">
            <div style="flex:1;min-width:0;">
              <div style="font-family:monospace;font-size:1rem;color:var(--text);word-break:break-all;margin-bottom:8px;font-weight:500;">${portalUrl}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-outline" onclick="copySchoolUrl('${escapeHtml(token)}')">📋 Copy URL</button>
                <a href="${qrUrl.replace('160x160','400x400')}" target="_blank" class="btn btn-sm btn-outline" download="qr-${escapedKey}.png">⬇️ QR Code</a>
                ${regenerateBtn}
              </div>
            </div>
          </div>
        </div>`
      :generateBtn;

    html+=`<div class="lb-row" style="flex-direction:column;align-items:stretch;padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div class="lb-info">
          <div class="lb-name">${escapedName}</div>
          <div class="lb-school" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="color:var(--text-muted)">${escapedKey}</span>
            <span class="badge badge-purple">${yearDisplay}</span>
            <span class="badge badge-blue">${playerCount} player${playerCount===1?'':'s'}</span>
            ${contactBadge}
          </div>
          ${hasContacts?`<div style="font-size:.78rem;color:var(--text-dim);margin-top:4px;">Contacts: ${contactNames}</div>`:''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          ${myContactToggle}
          ${manageButtons}
        </div>
      </div>
      ${tokenSection}
    </div>`;
  });

  container.innerHTML=html;
}

async function generateTokenByKey(btn){
  const key=btn.dataset.schoolKey;
  const token=generateAccessToken();
  try{
    await db.ref('admin/schools/'+key+'/accessToken').set(token);
  }catch(e){
    alert('Error generating token: '+e.message);
  }
}

async function regenerateTokenByKey(btn){
  const key=btn.dataset.schoolKey;
  const name=schools[key]?.name||key;
  if(!confirm(`Regenerate access URL for "${name}"?\n\nThe old QR code / URL will stop working immediately. You will need to redistribute the new one.`))return;
  const token=generateAccessToken();
  try{
    await db.ref('admin/schools/'+key+'/accessToken').set(token);
  }catch(e){
    alert('Error regenerating token: '+e.message);
  }
}

function copySchoolUrl(token){
  const url=getSchoolPortalUrl(token);
  navigator.clipboard.writeText(url).then(()=>{
    // Brief visual feedback — find the button that was clicked
    const btns=document.querySelectorAll('[onclick*="copySchoolUrl"]');
    btns.forEach(b=>{if(b.getAttribute('onclick').includes(token)){const orig=b.textContent;b.textContent='✅ Copied!';setTimeout(()=>{b.textContent=orig},1500)}});
  }).catch(()=>{prompt('Copy this URL:',url)});
}

let currentEditingSchoolKey=null;

// Helper function to generate school key from name
function generateSchoolKey(name){
  return name.toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function showAddSchoolModal(){
  currentEditingSchoolKey=null;
  document.getElementById('schoolModalTitle').textContent='Add School';
  document.getElementById('school-name').value='';
  
  // Uncheck all year checkboxes
  document.querySelectorAll('.year-checkbox').forEach(cb=>cb.checked=false);
  
  document.getElementById('schoolModal').classList.add('active');
}

function editSchool(key){
  currentEditingSchoolKey=key;
  const school=schools[key];
  document.getElementById('schoolModalTitle').textContent='Edit School';
  document.getElementById('school-name').value=school.name||'';
  
  // Set year checkboxes based on school's years
  const schoolYears=school.years||{};
  // Extract year names as strings (e.g., "4", "5", "6")
  const yearNumbers=Object.values(schoolYears).map(y=>String(y.name));
  document.querySelectorAll('.year-checkbox').forEach(cb=>{
    // cb.value is a string from the checkbox value attribute
    cb.checked=yearNumbers.includes(cb.value);
  });
  
  document.getElementById('schoolModal').classList.add('active');
}

function closeSchoolModal(){
  document.getElementById('schoolModal').classList.remove('active');
  currentEditingSchoolKey=null;
}

async function saveSchool(){
  const name=document.getElementById('school-name').value.trim();
  
  if(!name){
    alert('Please enter a school name');
    return;
  }
  
  // Auto-generate key from name using helper function
  const generatedKey=generateSchoolKey(name);
  
  if(!generatedKey){
    alert('Please enter a valid school name');
    return;
  }
  
  // Get selected years
  const selectedYears={};
  document.querySelectorAll('.year-checkbox:checked').forEach(cb=>{
    const yearNum=cb.value;
    selectedYears['y'+yearNum]={name:yearNum};
  });
  
  const schoolData={
    name,
    years:selectedYears,
    updatedAt:Date.now()
  };

  if(!currentEditingSchoolKey){
    schoolData.createdAt=Date.now();
    schoolData.accessToken=generateAccessToken();
  }
  
  const schoolKey=currentEditingSchoolKey||generatedKey;
  
  // Check if key already exists (only for new schools)
  if(!currentEditingSchoolKey&&schools[schoolKey]){
    alert('A school with this name already exists. Please choose a different name.');
    return;
  }
  
  try{
    const schoolRef=db.ref('admin/schools/'+schoolKey);
    if(currentEditingSchoolKey){
      // Update only the edited fields so contacts, accessToken, settings, etc. are preserved
      await schoolRef.update(schoolData);
      pushAuditEntry({eventType:'school_updated', schoolId:schoolKey, schoolName:name});
    }else{
      await schoolRef.set(schoolData);
      pushAuditEntry({eventType:'school_created', schoolId:schoolKey, schoolName:name});
    }
    closeSchoolModal();

    // Refresh the school scope selector
    loadSchoolsForScope();
  }catch(error){
    alert('Error saving school: '+error.message);
  }
}

async function deleteSchool(key){
  const schoolName=schools[key]?.name||key;
  if(!confirm(`Delete school "${schoolName}"? This action cannot be undone.`)){
    return;
  }

  try{
    await db.ref('admin/schools/'+key).remove();
    pushAuditEntry({eventType:'school_deleted', schoolId:key, schoolName});
    // Refresh the school scope selector
    loadSchoolsForScope();
  }catch(error){
    alert('Error deleting school: '+error.message);
  }
}

// Wrapper functions for data-attribute based event handlers
function editSchoolByKey(btn){
  const key=btn.dataset.schoolKey;
  editSchool(key);
}

function deleteSchoolByKey(btn){
  const key=btn.dataset.schoolKey;
  deleteSchool(key);
}

// ─── SCHOOL CONTACT FUNCTIONS ───────────────────────────────────────────────

async function toggleSchoolContact(btn){
  const key=btn.dataset.schoolKey;
  const uid=currentUser.uid;
  const contactRef=db.ref('admin/schools/'+key+'/contacts/'+uid);
  const snap=await contactRef.once('value');
  if(snap.exists()){
    await contactRef.remove();
  }else{
    const name=currentAdminData.name||currentAdminData.email||'Unknown';
    const email=currentAdminData.email||'';
    await contactRef.set({name,email,setAt:Date.now()});
  }
  // renderSchools will re-run from the schools listener
}

// ─── MATCH REQUEST FUNCTIONS ─────────────────────────────────────────────────

function generateMatchRoomId(){
  const chars='abcdefghijklmnopqrstuvwxyz0123456789';
  let id='room_';
  const arr=new Uint8Array(8);
  crypto.getRandomValues(arr);
  arr.forEach(b=>{id+=chars[b%chars.length]});
  return id;
}

function getMatchLink(roomId,schoolAKey,schoolBKey){
  const base=window.location.origin+window.location.pathname.replace('admin.html','index.html');
  return base+'?room='+encodeURIComponent(roomId)+'&a='+encodeURIComponent(schoolAKey)+'&b='+encodeURIComponent(schoolBKey);
}

let currentMatchRoomId=null;
let currentMatchLink=null;

function showMatchRequestModal(){
  currentMatchRoomId=generateMatchRoomId();
  const isSuperAdmin=currentAdminData.role==='super_admin'&&!superAdminImpersonating;
  const mySchools=isSuperAdmin?Object.keys(schools):getAdminSchools();
  const allSchoolList=Object.entries(schools).sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'));

  const fromSel=document.getElementById('mrFromSchool');
  fromSel.innerHTML=mySchools.map(k=>{
    const s=schools[k];
    return `<option value="${escapeHtml(k)}">${escapeHtml(s?s.name:k)}</option>`;
  }).join('');

  // Super admins can challenge ANY school (same-school is blocked at submit time).
  // Regular admins only see schools outside their own.
  const toSel=document.getElementById('mrToSchool');
  toSel.innerHTML=allSchoolList
    .filter(([k])=>isSuperAdmin?true:!mySchools.includes(k))
    .map(([k,s])=>{
      const contactCount=Object.keys(s.contacts||{}).length;
      const warn=contactCount===0?' ⚠ no contact':'';
      return `<option value="${escapeHtml(k)}">${escapeHtml(s.name||k)}${warn}</option>`;
    }).join('');

  // Reset time slots to one
  const slotsDiv=document.getElementById('mrTimeSlots');
  slotsDiv.innerHTML='<div class="mr-time-slot"><input type="datetime-local" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-family:inherit;font-size:.88rem;flex:1;"></div>';

  document.getElementById('mrMessage').value='';
  document.getElementById('mrError').style.display='none';
  updateMrSendAsOptions();
  updateMrContactPreview();
  updateMrLinkPreview();
  document.getElementById('matchRequestModal').classList.add('active');
}

function closeMatchRequestModal(){
  document.getElementById('matchRequestModal').classList.remove('active');
}

function addMrTimeSlot(){
  const slotsDiv=document.getElementById('mrTimeSlots');
  if(slotsDiv.children.length>=3)return;
  const div=document.createElement('div');
  div.className='mr-time-slot';
  div.innerHTML='<input type="datetime-local" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-family:inherit;font-size:.88rem;flex:1;">';
  slotsDiv.appendChild(div);
}

function updateMrSendAsOptions(){
  const fromKey=document.getElementById('mrFromSchool').value;
  const sendAsGroup=document.getElementById('mrSendAsGroup');
  const sendAsSel=document.getElementById('mrSendAs');
  if(!sendAsGroup||!sendAsSel)return;

  if(!fromKey){sendAsGroup.style.display='none';return;}

  const isSuperAdmin=currentAdminData.role==='super_admin'&&!superAdminImpersonating;

  // Build candidate list — always start with the current user
  const options=[];
  options.push({
    uid:currentUser.uid,
    name:currentAdminData.name||currentAdminData.email||'You',
    email:currentAdminData.email||'',
    label:(currentAdminData.name||currentAdminData.email||'You')+(isSuperAdmin?' (you — super admin)':' (you)')
  });

  // For super admins, add every approved admin assigned to the chosen "from" school
  if(isSuperAdmin){
    Object.entries(adminUsers).forEach(([uid,admin])=>{
      if(uid===currentUser.uid)return;
      if(!admin.approved)return;
      const assignedSchools=Array.isArray(admin.schools)?admin.schools:(admin.school?[admin.school]:[]);
      if(!assignedSchools.includes(fromKey))return;
      options.push({
        uid,
        name:admin.name||admin.email||uid,
        email:admin.email||'',
        label:admin.name||admin.email||uid
      });
    });
  }

  // Show for super admins (always) or any time there are multiple options
  if(isSuperAdmin||options.length>1){
    sendAsSel.innerHTML=options.map(o=>
      `<option value="${escapeHtml(o.uid)}" data-name="${escapeHtml(o.name)}" data-email="${escapeHtml(o.email)}">${escapeHtml(o.label)}</option>`
    ).join('');
    sendAsGroup.style.display='';
  }else{
    sendAsGroup.style.display='none';
  }
}

function updateMrContactPreview(){
  const toKey=document.getElementById('mrToSchool').value;
  const school=schools[toKey];
  const contacts=school?Object.values(school.contacts||{}):[];
  const preview=document.getElementById('mrContactPreview');
  if(contacts.length===0){
    preview.innerHTML='<span style="color:var(--orange);">⚠ This school has no contact set — request will still be saved but no email can be sent.</span>';
  }else{
    preview.innerHTML='Contacts: '+contacts.map(c=>`<strong>${escapeHtml(c.name||c.email)}</strong>`).join(', ');
  }
  updateMrLinkPreview();
}

function updateMrLinkPreview(){
  const fromKey=document.getElementById('mrFromSchool').value;
  const toKey=document.getElementById('mrToSchool').value;
  if(!fromKey||!toKey||fromKey===toKey){
    document.getElementById('mrLinkPreview').textContent='—';
    currentMatchLink=null;
    return;
  }
  currentMatchLink=getMatchLink(currentMatchRoomId,fromKey,toKey);
  document.getElementById('mrLinkPreview').textContent=currentMatchLink;
}

function copyMrLink(){
  if(!currentMatchLink)return;
  navigator.clipboard.writeText(currentMatchLink).then(()=>{
    const btn=document.querySelector('#matchRequestModal button[onclick="copyMrLink()"]');
    if(btn){const orig=btn.textContent;btn.textContent='✅ Copied!';setTimeout(()=>{btn.textContent=orig},1500);}
  }).catch(()=>{prompt('Copy this match link:',currentMatchLink)});
}

function formatDateTimeLocal(val) {
  if (!val) return '';
  try {
    const [datePart, timePart = ''] = val.split('T');
    const parts = datePart.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')} ${timePart}`;
    }
  } catch (e) {}
  return val.replace('T', ' ');
}

async function sendMatchRequest(){
  const fromKey=document.getElementById('mrFromSchool').value;
  const toKey=document.getElementById('mrToSchool').value;
  const message=document.getElementById('mrMessage').value.trim();
  const errDiv=document.getElementById('mrError');

  if(!fromKey||!toKey||fromKey===toKey){
    errDiv.textContent='Please select two different schools.';errDiv.style.display='';return;
  }

  const timeInputs=Array.from(document.querySelectorAll('#mrTimeSlots input')).map(i=>i.value).filter(Boolean);
  if(timeInputs.length===0){
    errDiv.textContent='Please add at least one proposed time.';errDiv.style.display='';return;
  }
  errDiv.style.display='none';

  const fromSchool=schools[fromKey];
  const toSchool=schools[toKey];
  // Always generate a fresh unique room ID at submission time
  currentMatchRoomId=generateMatchRoomId();
  const link=getMatchLink(currentMatchRoomId,fromKey,toKey);

  // Use the "Send as" selection if shown, otherwise fall back to current user
  let fromContact={uid:currentUser.uid,name:currentAdminData.name||currentAdminData.email,email:currentAdminData.email};
  const sendAsGroup=document.getElementById('mrSendAsGroup');
  const sendAsSel=document.getElementById('mrSendAs');
  if(sendAsGroup&&sendAsGroup.style.display!=='none'&&sendAsSel&&sendAsSel.value){
    const opt=sendAsSel.options[sendAsSel.selectedIndex];
    fromContact={uid:sendAsSel.value,name:opt.dataset.name||opt.text,email:opt.dataset.email||''};
  }

  const request={
    fromSchool:fromKey,
    fromSchoolName:fromSchool?fromSchool.name:fromKey,
    fromContact,
    toSchool:toKey,
    toSchoolName:toSchool?toSchool.name:toKey,
    proposedTimes:timeInputs,
    matchRoomId:currentMatchRoomId,
    matchLink:link,
    message:message||null,
    status:'pending',
    createdAt:Date.now()
  };

  const reqRef=await db.ref('admin/matchRequests').push(request);

  // Email all contacts of the target school
  const contacts=Object.values(toSchool?toSchool.contacts||{}:{});
  if(firestore&&contacts.length>0){
    const timesHtml=timeInputs.map(t=>`<li><strong>${formatDateTimeLocal(t)}</strong></li>`).join('');
    const emailBody={
      subject:`♟ Match Request from ${request.fromSchoolName} — IES Chess`,
      html:`<h2 style="color:#4a7cff;">Match Request!</h2>
<p><strong>${escapeHtml(request.fromContact.name)}</strong> from <strong>${escapeHtml(request.fromSchoolName)}</strong> wants to arrange an online chess match.</p>
${message?`<blockquote style="border-left:3px solid #4a7cff;padding-left:12px;color:#888;">${escapeHtml(message)}</blockquote>`:''}
<p><strong>Proposed times:</strong></p><ul>${timesHtml}</ul>
<p>Reply to <a href="mailto:${escapeHtml(request.fromContact.email)}">${escapeHtml(request.fromContact.email)}</a> to confirm a time, then use the match link below.</p>
<p style="margin-top:20px;"><a href="${link}" style="background:#4a7cff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Open Match Room</a></p>
<p style="margin-top:8px;font-size:.85em;color:#888;">Or copy: ${link}</p>
<p>You can also accept or decline this request in the <a href="${window.location.href}">IES Chess Admin Portal</a>.</p>`,
      text:`Match Request from ${request.fromSchoolName}\n\nProposed times:\n${timeInputs.map(t=>formatDateTimeLocal(t)).join('\n')}\n\nMatch link: ${link}\n\nContact: ${request.fromContact.email}`
    };
    const emailPromises=contacts.map(c=>
      firestore.collection('mail').add({to:c.email,message:emailBody})
    );
    await Promise.all(emailPromises).catch(e=>console.warn('Email send failed:',e));
  }

  closeMatchRequestModal();
  switchPanel('match-requests');
  alert('✅ Match request sent! '+(contacts.length>0?`Email sent to ${contacts.length} contact${contacts.length===1?'':'s'} at ${toSchool?.name||toKey}.`:'No contacts found — request saved, please share the match link manually.')+'\n\nMatch link: '+link);
}

function updateMatchRequestsBadge(){
  const mySchools=currentAdminData.role==='super_admin'&&!superAdminImpersonating
    ?Object.keys(schools)
    :getAdminSchools();
  const pending=Object.values(matchRequests).filter(r=>r.status==='pending'&&mySchools.includes(r.toSchool));
  const badge=document.getElementById('matchRequestsBadge');
  const incomingBadge=document.getElementById('incomingRequestsBadge');
  if(pending.length>0){
    badge.textContent=pending.length;badge.style.display='';
    if(incomingBadge){incomingBadge.textContent=pending.length+' pending';incomingBadge.style.display='';}
  }else{
    badge.style.display='none';
    if(incomingBadge)incomingBadge.style.display='none';
  }
}

function renderMatchRequests(){
  const mySchools=currentAdminData.role==='super_admin'&&!superAdminImpersonating
    ?Object.keys(schools)
    :getAdminSchools();

  const isSuperAdminGlobal=currentAdminData.role==='super_admin'&&!superAdminImpersonating;
  const entries=Object.entries(matchRequests).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
  const incoming=entries.filter(([,r])=>mySchools.includes(r.toSchool));
  const outgoing=entries.filter(([,r])=>mySchools.includes(r.fromSchool)&&(isSuperAdminGlobal||!mySchools.includes(r.toSchool)));

  const incomingDiv=document.getElementById('incomingMatchRequests');
  const outgoingDiv=document.getElementById('outgoingMatchRequests');
  if(!incomingDiv||!outgoingDiv)return;

  function requestCardHtml([id,r],isIncoming){
    const date=r.createdAt?new Date(r.createdAt).toLocaleDateString():'';
    const statusBadge=r.status==='pending'?'<span class="badge badge-orange">Pending</span>':r.status==='confirmed'?'<span class="badge badge-green">Confirmed</span>':'<span class="badge badge-red">Declined</span>';
    const timesHtml=Array.isArray(r.proposedTimes)&&r.proposedTimes.length>0
      ?r.proposedTimes.map(t=>`<span style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:.8rem;margin:2px;">${escapeHtml(formatDateTimeLocal(t))}</span>`).join('')
      :'<span style="color:var(--text-muted);font-size:.82rem;">No times proposed</span>';
    const confirmedTime=r.confirmedTime?`<div style="margin-top:6px;font-size:.82rem;color:var(--green);">✓ Confirmed: <strong>${escapeHtml(formatDateTimeLocal(r.confirmedTime))}</strong></div>`:'';
    const linkSection=r.matchLink?`<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-family:monospace;font-size:.75rem;color:var(--accent);word-break:break-all;flex:1;">${escapeHtml(r.matchLink)}</span><button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText('${escapeHtml(r.matchLink)}').then(()=>{this.textContent='✅';setTimeout(()=>{this.textContent='📋 Copy';},1200)})">📋 Copy</button><a href="${escapeHtml(r.matchLink)}" target="_blank" class="btn btn-sm btn-outline">🔗 Open</a></div>`:'';
    const actions=isIncoming&&r.status==='pending'
      ?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <select id="confirmTime_${id}" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.82rem;">
            ${Array.isArray(r.proposedTimes)?r.proposedTimes.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(formatDateTimeLocal(t))}</option>`).join(''):''}
          </select>
          <button class="btn btn-sm btn-success" onclick="acceptMatchRequest('${escapeHtml(id)}')">✓ Accept</button>
          <button class="btn btn-sm btn-danger" onclick="declineMatchRequest('${escapeHtml(id)}')">✗ Decline</button>
        </div>`
      :(r.status==='pending'&&!isIncoming
        ?`<button class="btn btn-sm btn-danger" style="margin-top:8px;" onclick="cancelMatchRequest('${escapeHtml(id)}')">✗ Cancel</button>`
        :`<button class="btn btn-sm btn-outline" style="margin-top:8px;opacity:.7;" onclick="deleteMatchRequest('${escapeHtml(id)}')">🗑 Delete</button>`);
    const fromTo=`<strong>${escapeHtml(r.fromSchoolName||r.fromSchool)}</strong> → <strong>${escapeHtml(r.toSchoolName||r.toSchool)}</strong>`;
    return `<div style="padding:14px;border-radius:8px;background:var(--bg-surface);border:1px solid var(--border);margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <span style="font-weight:700;font-size:.95rem;">${fromTo}</span>
        ${statusBadge}
        <span style="font-size:.78rem;color:var(--text-muted);margin-left:auto;">${date}</span>
      </div>
      ${r.message?`<div style="font-size:.83rem;color:var(--text-dim);margin-bottom:8px;font-style:italic;">"${escapeHtml(r.message)}"</div>`:''}
      <div style="margin-bottom:6px;">${timesHtml}</div>
      ${confirmedTime}
      ${linkSection}
      ${actions}
    </div>`;
  }

  incomingDiv.innerHTML=incoming.length===0
    ?'<div class="empty-state" style="padding:24px;"><div class="icon">📭</div><p>No incoming requests</p></div>'
    :incoming.map(e=>requestCardHtml(e,true)).join('');

  outgoingDiv.innerHTML=outgoing.length===0
    ?'<div class="empty-state" style="padding:24px;"><div class="icon">📤</div><p>No sent requests</p></div>'
    :outgoing.map(e=>requestCardHtml(e,false)).join('');
}

async function acceptMatchRequest(reqId){
  const r=matchRequests[reqId];
  if(!r)return;
  const sel=document.getElementById('confirmTime_'+reqId);
  const confirmedTime=sel?sel.value:r.proposedTimes?.[0]||'';
  await db.ref('admin/matchRequests/'+reqId).update({status:'confirmed',confirmedTime,confirmedAt:Date.now()});

  // Email the requesting school's contact
  if(firestore&&r.fromContact?.email&&r.matchLink){
    const emailBody={
      subject:`✅ Match Confirmed — ${r.toSchoolName||r.toSchool} vs ${r.fromSchoolName||r.fromSchool}`,
      html:`<h2 style="color:#26de81;">Match Confirmed!</h2>
<p>Your match request has been accepted by <strong>${escapeHtml(r.toSchoolName||r.toSchool)}</strong>.</p>
<p><strong>Confirmed time:</strong> ${escapeHtml(formatDateTimeLocal(confirmedTime))}</p>
<p style="margin-top:20px;"><a href="${r.matchLink}" style="background:#4a7cff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Open Match Room</a></p>
<p style="font-size:.85em;color:#888;">Share this link with your students: ${r.matchLink}</p>`,
      text:`Match confirmed by ${r.toSchoolName||r.toSchool}\nTime: ${formatDateTimeLocal(confirmedTime)}\nMatch link: ${r.matchLink}`
    };
    firestore.collection('mail').add({to:r.fromContact.email,message:emailBody}).catch(e=>console.warn('Email failed:',e));
  }
  alert('✅ Match confirmed! A confirmation email has been sent to the requesting school.\n\nMatch link: '+(r.matchLink||''));
}

async function declineMatchRequest(reqId){
  if(!confirm('Decline this match request?'))return;
  await db.ref('admin/matchRequests/'+reqId+'/status').set('declined');
}

async function cancelMatchRequest(reqId){
  if(!confirm('Cancel this match request?'))return;
  await db.ref('admin/matchRequests/'+reqId).remove();
}

async function deleteMatchRequest(reqId){
  if(!confirm('Delete this match request?'))return;
  await db.ref('admin/matchRequests/'+reqId).remove();
}

// ─── DASHBOARD CONTACT PROMPT ────────────────────────────────────────────────

function renderContactPrompt(){
  const card=document.getElementById('contactPromptCard');
  const promptSchools=document.getElementById('contactPromptSchools');
  if(!card||!promptSchools)return;

  // Only show for regular admins who have assigned schools; super admins see all schools and don't need this nudge
  if(currentAdminData.role==='super_admin'&&!superAdminImpersonating)return;
  if(sessionStorage.getItem('contactPromptDismissed')==='1'){card.style.display='none';return;}

  const mySchools=getAdminSchools();
  if(mySchools.length===0){card.style.display='none';return;}

  const myUid=currentUser?currentUser.uid:null;

  // Check which schools the admin is NOT yet a contact for
  const notContact=mySchools.filter(key=>{
    const s=schools[key];
    return s&&!(s.contacts&&s.contacts[myUid]);
  });

  if(notContact.length===0){card.style.display='none';return;}

  card.style.display='';

  promptSchools.innerHTML=notContact.map(key=>{
    const s=schools[key];
    const name=escapeHtml(s?s.name:key);
    return `<div class="contact-school-row">
      <span class="contact-school-name">${name}</span>
      <div class="contact-radio-group">
        <label class="contact-radio-label">
          <input type="radio" name="cpContact_${escapeHtml(key)}" value="yes" onchange="setContactFromPrompt('${escapeHtml(key)}',true)">
          Yes, I'm a contact
        </label>
        <label class="contact-radio-label">
          <input type="radio" name="cpContact_${escapeHtml(key)}" value="no" onchange="setContactFromPrompt('${escapeHtml(key)}',false)">
          Not me
        </label>
      </div>
    </div>`;
  }).join('');
}

async function setContactFromPrompt(schoolKey,isContact){
  const myUid=currentUser?currentUser.uid:null;
  if(!myUid)return;
  const contactRef=db.ref('admin/schools/'+schoolKey+'/contacts/'+myUid);
  if(isContact){
    const name=currentAdminData.name||currentAdminData.email||'Unknown';
    const email=currentAdminData.email||'';
    await contactRef.set({name,email,setAt:Date.now()});
  }else{
    await contactRef.remove();
  }
  // Re-render after a short delay to let the listener update schools{}
  setTimeout(renderContactPrompt,600);
}

function dismissContactPrompt(){
  sessionStorage.setItem('contactPromptDismissed','1');
  document.getElementById('contactPromptCard').style.display='none';
}

let editingAdminSchoolsUid=null;

function openEditAdminSchoolsModal(uid,adminName){
  editingAdminSchoolsUid=uid;
  document.getElementById('editAdminSchoolsTitle').textContent=`Assign Schools — ${adminName}`;
  const checklist=document.getElementById('editAdminSchoolsChecklist');
  const adminData=adminUsers[uid];
  const assigned=Array.isArray(adminData.schools)?adminData.schools:(adminData.school?[adminData.school]:[]);
  checklist.innerHTML=Object.entries(schools)
    .sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0],'sv'))
    .map(([key,school])=>`
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 10px;background:var(--bg-surface);border-radius:6px;border:1px solid var(--border);">
      <input type="checkbox" value="${escapeHtml(key)}" ${assigned.includes(key)?'checked':''}>
      🏫 ${escapeHtml(school.name||key)}
    </label>
  `).join('');
  document.getElementById('editAdminSchoolsModal').classList.add('active');
}

function closeEditAdminSchoolsModal(){
  document.getElementById('editAdminSchoolsModal').classList.remove('active');
  editingAdminSchoolsUid=null;
}

async function saveAdminSchools(){
  if(!editingAdminSchoolsUid)return;
  const checked=Array.from(document.querySelectorAll('#editAdminSchoolsChecklist input:checked')).map(cb=>cb.value);
  const snap=await db.ref('admin/users/'+editingAdminSchoolsUid+'/email').once('value');
  const targetEmail=snap.val()||editingAdminSchoolsUid;
  // Update both 'schools' (array) and normalise legacy 'school' (string) field so they stay in sync.
  // Setting 'school' to null removes it from Firebase, preventing stale data from causing incorrect school visibility.
  await db.ref('admin/users/'+editingAdminSchoolsUid).update({
    schools: checked,
    school: checked.length>0 ? checked[0] : null
  });
  pushAuditEntry({eventType:'admin_schools_updated', targetEmail, targetUid:editingAdminSchoolsUid, targetName:checked.map(k=>(schools[k]||{}).name||k).join(', ')});
  closeEditAdminSchoolsModal();
  alert('Schools updated successfully!');
}

// Play Times Management
let currentPlayTimes = [];

function updatePlayTimesScopeInfo() {
  const isSuperAdmin = currentAdminData.role === 'super_admin';
  const playtimesInfo = document.getElementById('playtimesScopeInfo');
  const playtimesName = document.getElementById('playtimesScopeSchoolName');
  
  if (playtimesInfo && playtimesName) {
    if (isSuperAdmin && !currentSchool) {
      playtimesInfo.style.display = 'none';
    } else {
      const schoolName = schools[currentSchool]?.name || currentSchool || 'your school';
      playtimesName.textContent = schoolName;
      playtimesInfo.style.display = 'block';
    }
  }
}

function loadPlayTimes() {
  const school = currentSchool || getAdminSchools()[0];
  if (!school) {
    document.getElementById('playtimesList').innerHTML = '<div class="empty-state"><p>No school selected</p></div>';
    return;
  }
  
  db.ref('admin/schools/' + school + '/playTimes').on('value', snap => {
    currentPlayTimes = snap.val() || [];
    renderPlayTimes();
  });
}

function renderPlayTimes() {
  const container = document.getElementById('playtimesList');
  
  if (!Array.isArray(currentPlayTimes) || currentPlayTimes.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⏰</div><h3>No play times yet</h3><p>Add your first play time slot above</p></div>';
    return;
  }
  
  const byDay = {};
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  currentPlayTimes.forEach((slot, index) => {
    const day = slot.day || 'unknown';
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push({ ...slot, index });
  });
  
  let html = '<div style="display:flex;flex-direction:column;gap:16px">';
  
  days.forEach((day, dayIndex) => {
    const slots = byDay[day];
    if (!slots || slots.length === 0) return;
    
    html += `<div style="background:var(--bg-surface);padding:16px;border-radius:10px;border:1px solid var(--border)">
      <div style="font-weight:700;font-size:1.05rem;color:var(--gold);margin-bottom:12px">${dayNames[dayIndex]}</div>`;
    
    slots.forEach(slot => {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg-card);border-radius:8px;margin-bottom:8px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:16px">
          <span style="font-family:'Courier New',monospace;font-size:1rem;font-weight:700">${escapeHtml(slot.start)} - ${escapeHtml(slot.end)}</span>
        </div>
        <button class="btn btn-sm btn-danger" onclick="deletePlayTime(${slot.index})">🗑️ Delete</button>
      </div>`;
    });
    
    html += `</div>`;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

async function addPlayTime() {
  const school = currentSchool || getAdminSchools()[0];
  if (!school) {
    alert('No school selected');
    return;
  }
  
  const day = document.getElementById('playtime-day').value;
  const start = document.getElementById('playtime-start').value;
  const end = document.getElementById('playtime-end').value;
  
  if (!start || !end) {
    alert('Please fill in both start and end times');
    return;
  }
  
  if (start >= end) {
    alert('Start time must be before end time');
    return;
  }
  
  const newSlot = { day, start, end };
  const updatedTimes = [...currentPlayTimes, newSlot];
  
  await db.ref('admin/schools/' + school + '/playTimes').set(updatedTimes);
  
  document.getElementById('playtime-day').value = 'monday';
  document.getElementById('playtime-start').value = '11:10';
  document.getElementById('playtime-end').value = '11:35';
}

async function deletePlayTime(index) {
  const school = currentSchool || getAdminSchools()[0];
  if (!school) return;
  
  if (!confirm('Delete this play time?')) return;
  
  const updatedTimes = currentPlayTimes.filter((_, i) => i !== index);
  await db.ref('admin/schools/' + school + '/playTimes').set(updatedTimes);
}

function initPlayTimesPanel() {
  updatePlayTimesScopeInfo();
  loadPlayTimes();
}

// ── Schedules: School Availability Grid ────────────────────────────────────
let schedulesLobbyData = {};

const SCHED_DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const SCHED_DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function updateSchedulesTime() {
  const now = new Date();
  const dayEl = document.getElementById('scheduleCurrentDay');
  const timeEl = document.getElementById('scheduleCurrentTime');
  if (!dayEl || !timeEl) return;
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  dayEl.textContent = SCHED_DAY_NAMES[now.getDay()];
  timeEl.textContent = `${h}:${m}`;
}

function renderSchedulesGrid() {
  const grid = document.getElementById('schedulesSchoolGrid');
  const empty = document.getElementById('schedulesEmptyState');
  if (!grid) return;

  const now = new Date();
  const dayIndex = now.getDay();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const currentTime = `${h}:${m}`;
  const currentDayName = SCHED_DAYS[dayIndex];

  const entries = Object.entries(schools);
  if (entries.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  let html = '';
  entries.forEach(([schoolId, school]) => {
    const name = escapeHtml(school.name || schoolId);
    const times = Array.isArray(school.playTimes) ? school.playTimes : Object.values(school.playTimes || {});

    // Count lobby players
    let playerCount = 0;
    Object.values(schedulesLobbyData).forEach(path => {
      if (path && typeof path === 'object') {
        Object.values(path).forEach(p => { if (p && p.schoolId === schoolId) playerCount++; });
      }
    });

    // Group by day
    const byDay = {};
    times.forEach(slot => {
      const d = slot.day || '';
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(slot);
    });

    // Check available now
    let availableNow = false;
    (byDay[currentDayName] || []).forEach(slot => {
      if (currentTime >= slot.start && currentTime <= slot.end) availableNow = true;
    });

    const cardBorder = availableNow ? 'border:1px solid var(--green);box-shadow:0 0 16px rgba(38,222,129,.15);' : 'border:1px solid var(--border);';
    const badgeStyle = playerCount > 0
      ? 'background:rgba(38,222,129,.15);color:var(--green);'
      : 'background:rgba(122,133,153,.15);color:var(--text-dim);';
    const badgeText = playerCount > 0 ? `● ${playerCount} Online` : '● Offline';

    html += `<div class="card" style="margin:0;${cardBorder}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:1.1rem;font-weight:700;color:var(--gold);">${name}</div>
        <span style="padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:700;${badgeStyle}">${badgeText}</span>
      </div>`;

    if (availableNow) {
      html += `<div style="color:var(--green);font-weight:700;font-size:.85rem;margin-bottom:10px;">✓ Available to play now!</div>`;
    }

    if (times.length === 0) {
      html += `<div style="color:var(--text-dim);font-style:italic;font-size:.85rem;">No play times scheduled yet</div>`;
    } else {
      html += `<div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:8px;font-weight:600;">Weekly Schedule</div>`;
      SCHED_DAYS.forEach((day, idx) => {
        if (idx === 0) return;
        const slots = byDay[day] || [];
        if (!slots.length) return;
        html += `<div style="margin-bottom:8px;"><div style="font-size:.85rem;font-weight:700;color:var(--gold);margin-bottom:4px;">${SCHED_DAY_NAMES[idx]}</div>`;
        slots.forEach(slot => {
          const isActive = day === currentDayName && currentTime >= slot.start && currentTime <= slot.end;
          const slotStyle = isActive
            ? 'background:rgba(38,222,129,.15);border:1px solid var(--green);color:var(--green);font-weight:700;'
            : 'background:rgba(240,192,64,.08);border:1px solid rgba(240,192,64,.2);';
          html += `<span style="display:inline-block;padding:4px 10px;margin:2px 4px 2px 0;border-radius:6px;font-size:.8rem;font-family:'Courier New',monospace;${slotStyle}">${escapeHtml(slot.start)} – ${escapeHtml(slot.end)}</span>`;
        });
        html += `</div>`;
      });
    }
    html += `</div>`;
  });

  grid.innerHTML = html;
}

function initSchedulesGrid() {
  updateSchedulesTime();
  renderSchedulesGrid();

  // Subscribe to lobby once
  if (!schedulesLobbyData._subscribed) {
    db.ref('lobby').on('value', snap => {
      schedulesLobbyData = snap.val() || {};
      schedulesLobbyData._subscribed = true;
      renderSchedulesGrid();
    });
  }
}

// ── Integrity: Board Replay & Match Detail ─────────────────────────────────
const PIECE_IMGS=(()=>{const b='https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett';return{K:b+'/wK.svg',Q:b+'/wQ.svg',R:b+'/wR.svg',B:b+'/wB.svg',N:b+'/wN.svg',P:b+'/wP.svg',k:b+'/bK.svg',q:b+'/bQ.svg',r:b+'/bR.svg',b:b+'/bB.svg',n:b+'/bN.svg',p:b+'/bP.svg'}})();

function getInitialBoard(){
  return[
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    [' ',' ',' ',' ',' ',' ',' ',' '],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R']
  ];
}

function applyMoveOnBoard(board,move){
  if(!move||!move.from||!move.to)return;
  const[fr,fc]=move.from,[tr,tc]=move.to;
  const piece=board[fr][fc];
  if(!piece||piece===' ')return;
  const type=piece.toUpperCase();
  const color=(piece===piece.toUpperCase())?'white':'black';
  // Castling: king moves 2 squares laterally
  if(type==='K'&&Math.abs(tc-fc)===2){
    board[tr][tc]=piece;board[fr][fc]=' ';
    if(tc===6){board[tr][5]=board[tr][7];board[tr][7]=' ';}
    else{board[tr][3]=board[tr][0];board[tr][0]=' ';}
    return;
  }
  // En passant: pawn captures diagonally to empty square
  if(type==='P'&&fc!==tc&&board[tr][tc]===' '){
    board[fr][tc]=' '; // remove the captured pawn
  }
  board[tr][tc]=piece;
  board[fr][fc]=' ';
  // Promotion: pawn reaches last rank
  if(type==='P'&&(tr===0||tr===7)){
    const promoMatch=move.notation&&move.notation.match(/=([QRBN])/i);
    const promoPiece=promoMatch?promoMatch[1]:'Q';
    board[tr][tc]=color==='white'?promoPiece.toUpperCase():promoPiece.toLowerCase();
  }
}

function replayMovesToFinalBoard(moves){
  const board=getInitialBoard();
  if(Array.isArray(moves))moves.forEach(m=>applyMoveOnBoard(board,m));
  return board;
}

function seekMatchReplay(step){
  const m=currentMatchDetailKey?matches[currentMatchDetailKey]:null;
  if(!m)return;
  const movesArr=Array.isArray(m.moves)?m.moves:[];
  const clamped=Math.max(0,Math.min(step,movesArr.length));
  const slider=document.getElementById('matchDetailSlider');
  if(slider)slider.value=clamped;
  const board=getInitialBoard();
  for(let i=0;i<clamped;i++)applyMoveOnBoard(board,movesArr[i]);
  renderStaticBoard(board,'matchDetailBoard');
  const noteEl=document.getElementById('matchDetailBoardNote');
  if(noteEl)noteEl.textContent=clamped===0?'Starting position':('Move '+clamped+' of '+movesArr.length);
  // Highlight active move in move list
  const grid=document.querySelector('#matchDetailMoves .move-history-grid');
  if(grid){
    grid.querySelectorAll('.move-white,.move-black').forEach((el,i)=>el.classList.toggle('active-move',i===clamped-1));
    const active=grid.querySelectorAll('.move-white,.move-black')[clamped-1];
    if(active)active.scrollIntoView({block:'nearest'});
  }
}

function renderStaticBoard(board,containerId){
  const container=document.getElementById(containerId);
  if(!container)return;
  const files=['a','b','c','d','e','f','g','h'];
  const ranks=['8','7','6','5','4','3','2','1'];
  let html='<div class="mini-board">';
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const isLight=(r+c)%2===0;
      const piece=board[r][c];
      const coord=files[c]+ranks[r];
      html+=`<div class="mini-sq ${isLight?'mini-light':'mini-dark'}" title="${coord}">`;
      if(piece&&piece!==' ')html+=`<img src="${PIECE_IMGS[piece]}" alt="${piece}">`;
      html+='</div>';
    }
  }
  html+='</div>';
  container.innerHTML=html;
}

let currentMatchDetailKey=null;

function openMatchModal(matchKey){
  const m=matches[matchKey];
  if(!m)return;
  currentMatchDetailKey=matchKey;

  const wn=escapeHtml(m.whiteName||m.whiteId||'?');
  const bn=escapeHtml(m.blackName||m.blackId||'?');
  const ws=escapeHtml(m.whiteSchool||'?');
  const bs=escapeHtml(m.blackSchool||'?');
  const date=new Date(m.completedAt||m.startTime||0).toLocaleString();
  const duration=m.completedAt&&m.startTime?(Math.round((m.completedAt-m.startTime)/1000)):null;
  const durationStr=duration!==null?(duration>=60?Math.floor(duration/60)+'m '+(duration%60)+'s':duration+'s'):'—';
  const rt=escapeHtml(m.resultType||m.result||'?');
  const mc=m.moveCount||(Array.isArray(m.moves)?m.moves.length:0);

  document.getElementById('matchDetailTitle').textContent=wn+' vs '+bn;
  document.getElementById('matchDetailSubtitle').textContent=ws+' vs '+bs;

  // Suspicion reasons
  const reasonsEl=document.getElementById('matchDetailReasons');
  const reasons=(m.suspicionReasons||[]);
  reasonsEl.innerHTML=reasons.map(r=>'<span class="badge badge-red">'+escapeHtml(r)+'</span>').join(' ');

  // Meta info grid
  document.getElementById('matchDetailInfo').innerHTML=`
    <div><strong>Result:</strong> ${rt}</div>
    <div><strong>Date:</strong> ${date}</div>
    <div><strong>Moves played:</strong> ${mc}</div>
    <div><strong>Duration:</strong> ${durationStr}</div>
    <div><strong>White:</strong> ${wn} (${ws})</div>
    <div><strong>Black:</strong> ${bn} (${bs})</div>
  `;

  // Move count badge
  document.getElementById('matchDetailMoveCount').textContent=mc+' moves';

  // Move history
  const movesEl=document.getElementById('matchDetailMoves');
  const movesArr=Array.isArray(m.moves)?m.moves:[];
  if(movesArr.length===0){
    movesEl.innerHTML='<div style="color:var(--text-muted);font-size:.82rem;">No move data recorded for this game.</div>';
  }else{
    let mhtml='<div class="move-history-grid">';
    for(let i=0;i<movesArr.length;i+=2){
      const moveNum=Math.floor(i/2)+1;
      const wMove=movesArr[i]?.notation||'?';
      const bMove=movesArr[i+1]?.notation||'';
      const wIdx=i+1,bIdx=i+2; // 1-based ply index for seekMatchReplay
      mhtml+=`<span class="move-num">${moveNum}.</span>`
           +`<span class="move-white" style="cursor:pointer;" onclick="seekMatchReplay(${wIdx})">${escapeHtml(wMove)}</span>`
           +`<span class="move-black" style="cursor:pointer;" onclick="seekMatchReplay(${bIdx})">${escapeHtml(bMove)}</span>`;
    }
    mhtml+='</div>';
    movesEl.innerHTML=mhtml;
  }

  // Board snapshot with slider
  const sliderWrap=document.getElementById('matchDetailSliderWrap');
  const slider=document.getElementById('matchDetailSlider');
  const noteEl=document.getElementById('matchDetailBoardNote');
  if(movesArr.length===0){
    renderStaticBoard(getInitialBoard(),'matchDetailBoard');
    noteEl.textContent='Board shown in starting position — no moves recorded.';
    sliderWrap.style.display='none';
  }else{
    slider.max=movesArr.length;
    slider.value=movesArr.length;
    sliderWrap.style.display='block';
    seekMatchReplay(movesArr.length);
  }

  // Verdict buttons
  const actionsEl=document.getElementById('matchDetailActions');
  const alreadyApproved=!!m.integrityApproved;
  const alreadyRemoved=!!m.scoreRemoved;
  if(alreadyApproved){
    actionsEl.innerHTML='<span class="badge badge-green" style="font-size:.85rem;padding:8px 14px;">✅ Score kept — game approved</span>';
  }else if(alreadyRemoved){
    actionsEl.innerHTML='<span class="badge badge-red" style="font-size:.85rem;padding:8px 14px;">🗑 Score removed</span>';
  }else{
    actionsEl.innerHTML=`
      <button class="btn btn-danger" onclick="removeScore('${escapeHtml(matchKey)}')">🗑 Remove Score</button>
      <button class="btn btn-success" onclick="keepScore('${escapeHtml(matchKey)}')">✅ Keep Score</button>
    `;
  }

  document.getElementById('matchDetailModal').classList.add('active');
}

function closeMatchDetail(){
  document.getElementById('matchDetailModal').classList.remove('active');
  currentMatchDetailKey=null;
}

async function keepScore(matchKey){
  if(!confirm('Mark this game as legitimate and keep the score? It will be removed from the flagged list.'))return;
  try{
    await db.ref('matches/'+matchKey).update({integrityApproved:true,integrityReviewedBy:currentUser?.email||'',integrityReviewedAt:Date.now()});
    closeMatchDetail();
    renderSuspiciousGames();
    // Points now count for this approved game — refresh leaderboard
    renderLeaderboard();
    updateDashboardStats();
  }catch(err){
    alert('Failed to update match: '+err.message);
  }
}

async function removeScore(matchKey){
  if(!confirm('Remove the score for this game? The match will be excluded from leaderboard calculations and removed from the flagged list.'))return;
  try{
    await db.ref('matches/'+matchKey).update({scoreRemoved:true,integrityReviewedBy:currentUser?.email||'',integrityReviewedAt:Date.now()});
    closeMatchDetail();
    renderSuspiciousGames();
    // Refresh leaderboard so the removed match no longer counts
    renderLeaderboard();
    updateDashboardStats();
  }catch(err){
    alert('Failed to update match: '+err.message);
  }
}
// ── End Integrity: Board Replay & Match Detail ────────────────────────────────

function renderSuspiciousGames(){
  const flaggedEl=document.getElementById('integrityFlaggedList');
  const repeatEl=document.getElementById('integrityRepeatList');
  if(!flaggedEl||!repeatEl)return;

  const schoolName=currentSchool?(schools[currentSchool]?.name||currentSchool):null;
  function inScope(m){
    if(!currentSchool)return true;
    const ws=m.whiteSchool||m.white_school;
    const bs=m.blackSchool||m.black_school;
    return ws===currentSchool||ws===schoolName||bs===currentSchool||bs===schoolName;
  }

  const allMatches=Object.entries(matches).filter(([,m])=>inScope(m));

  // --- Flagged matches (marked suspicious at record time; exclude resolved) ---
  const flagged=allMatches
    .filter(([,m])=>m.suspicious&&!m.integrityApproved&&!m.scoreRemoved)
    .sort((a,b)=>(b[1].completedAt||b[1].startTime||0)-(a[1].completedAt||a[1].startTime||0));

  document.getElementById('integrity-flagged-count').textContent=flagged.length;
  document.getElementById('integrity-flagged-badge').textContent=flagged.length+' game'+(flagged.length!==1?'s':'');
  const integrityNavBadge=document.getElementById('integrityBadge');
  if(integrityNavBadge){integrityNavBadge.textContent=flagged.length;integrityNavBadge.style.display=flagged.length>0?'':'none';}

  if(flagged.length===0){
    flaggedEl.innerHTML='<div class="empty-state"><div class="icon">✅</div><p>No flagged games detected</p></div>';
  }else{
    let html='';
    flagged.forEach(([matchKey,m])=>{
      const wn=escapeHtml(m.whiteName||m.whiteId||'?');
      const bn=escapeHtml(m.blackName||m.blackId||'?');
      const ws=escapeHtml(m.whiteSchool||'');
      const bs=escapeHtml(m.blackSchool||'');
      const date=new Date(m.completedAt||m.startTime||0).toLocaleString();
      const reasons=(m.suspicionReasons||[]).map(r=>'<span class="badge badge-red">'+escapeHtml(r)+'</span>').join(' ');
      const rt=escapeHtml(m.resultType||m.result||'?');
      const mc=m.moveCount||(Array.isArray(m.moves)?m.moves.length:0);
      const safeKey=escapeHtml(matchKey);
      html+='<div class="lb-row integrity-flagged-row" style="flex-direction:column;align-items:flex-start;gap:8px;border-left:3px solid var(--red);padding-left:14px;margin-bottom:8px;padding-top:10px;padding-bottom:10px;" onclick="openMatchModal(\''+safeKey+'\')">'
        +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;">'
        +'<span class="lb-name">'+wn+' vs '+bn+'</span>'
        +'<span style="color:var(--text-dim);font-size:.78rem;">'+ws+' vs '+bs+'</span>'
        +'<span class="badge badge-orange">'+rt+'</span>'
        +'<span style="color:var(--text-dim);font-size:.8rem;">'+mc+' moves &middot; '+date+'</span>'
        +'<span style="margin-left:auto;color:var(--accent);font-size:.78rem;">Click to review →</span>'
        +'</div>'
        +'<div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:10px;flex-wrap:wrap;">'
        +'<div style="display:flex;gap:6px;flex-wrap:wrap;">'+reasons+'</div>'
        +'<div style="display:flex;gap:6px;" onclick="event.stopPropagation()">'
        +'<button class="btn btn-danger btn-sm" onclick="removeScore(\''+safeKey+'\')">🗑 Remove Score</button>'
        +'<button class="btn btn-success btn-sm" onclick="keepScore(\''+safeKey+'\')">✅ Keep Score</button>'
        +'</div>'
        +'</div>'
        +'</div>';
    });
    flaggedEl.innerHTML=html;
  }

  // --- Repeat pair analysis (computed from all matches) ---
  const pairMap={};
  allMatches.forEach(([,m])=>{
    const n1=m.whiteName||m.whiteId||'?';
    const n2=m.blackName||m.blackId||'?';
    const key=[n1,n2].sort().join('\u0000');
    if(!pairMap[key])pairMap[key]={games:[],sorted:[n1,n2].sort()};
    pairMap[key].games.push(m);
  });

  const repeatPairs=Object.entries(pairMap)
    .filter(([,p])=>p.games.length>=3)
    .sort((a,b)=>b[1].games.length-a[1].games.length);

  document.getElementById('integrity-pairs-count').textContent=repeatPairs.length;

  if(repeatPairs.length===0){
    repeatEl.innerHTML='<div class="empty-state"><div class="icon">✅</div><p>No repeat pairs detected</p></div>';
  }else{
    let html='';
    repeatPairs.forEach(([,pair])=>{
      const [na,nb]=pair.sorted;
      let aWins=0,bWins=0,draws=0;
      pair.games.forEach(m=>{
        if(m.result==='draw')draws++;
        else{
          const winner=m.result==='white'?(m.whiteName||m.whiteId):(m.blackName||m.blackId);
          if(winner===na)aWins++;else bWins++;
        }
      });
      // Check if wins alternate (suspicious pattern)
      const sorted=[...pair.games].sort((a,b)=>(a.completedAt||a.startTime||0)-(b.completedAt||b.startTime||0));
      let alternating=sorted.length>=4;
      for(let i=1;i<sorted.length&&alternating;i++){
        if(sorted[i].result===sorted[i-1].result)alternating=false;
      }
      const lastDate=new Date(Math.max(...pair.games.map(g=>g.completedAt||g.startTime||0))).toLocaleString();
      const altBadge=alternating?'<span class="badge badge-purple">Alternating wins</span>':'';
      const oneSided=(aWins>0||bWins>0)&&(aWins===0||bWins===0);
      const oneSidedBadge=oneSided?'<span class="badge badge-orange">One-sided</span>':'';
      html+='<div class="lb-row" style="flex-direction:column;align-items:flex-start;gap:6px;border-left:3px solid var(--orange);padding-left:14px;margin-bottom:8px;">'
        +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
        +'<span class="lb-name">'+escapeHtml(na)+' vs '+escapeHtml(nb)+'</span>'
        +'<span class="badge badge-orange">'+pair.games.length+' games</span>'
        +altBadge+oneSidedBadge
        +'<span style="color:var(--text-dim);font-size:.8rem;">Last: '+lastDate+'</span>'
        +'</div>'
        +'<div style="color:var(--text-dim);font-size:.82rem;">'
        +escapeHtml(na)+': '+aWins+'W&nbsp;&nbsp;'
        +escapeHtml(nb)+': '+bWins+'W&nbsp;&nbsp;'
        +'Draws: '+draws
        +'</div>'
        +'</div>';
    });
    repeatEl.innerHTML=html;
  }
}

function showAdminToast(msg) {
  // Reuse existing alert or create simple toast
  let toast = document.getElementById('adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#26de81;color:#000;padding:10px 20px;border-radius:8px;font-weight:700;font-size:.85rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.4);opacity:0;transition:opacity .3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ══════════════════════════════════════════════════════
// KNOCKOUT LADDER
// ══════════════════════════════════════════════════════
let ladderData = null;
let ladderCountdownInterval = null;
const ROUND_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function initLadderPanel() {
  db.ref('admin/ladder/knockout').once('value').then(snap => {
    ladderData = snap.val() || {};
    renderKnockoutPanel(ladderData);
  });
  initCustomLadder();
}

function renderKnockoutPanel(ko) {
  const status     = ko.status || 'idle';
  const winsTarget = ko.winsTarget || 10;
  document.getElementById('ld-ko-target').value = winsTarget;

  const statusMap = {
    idle:      { color: 'var(--text-muted)', text: '⭕ No ladder running — configure wins target and click Start Ladder.' },
    active:    { color: 'var(--green)',      text: `🟢 Active — Round ${(ko.currentRoundIdx || 0) + 1} in progress` },
    paused:    { color: 'var(--orange)',     text: `⏸ Paused — Round ${(ko.currentRoundIdx || 0) + 1} on hold (round timer frozen)` },
    scheduled: { color: '#4a7cff',           text: `📅 Scheduled — ladder will auto-start on ${ko.scheduledStart ? new Date(ko.scheduledStart).toLocaleString() : '—'}` },
    completed: { color: 'var(--gold)',       text: `🏆 Completed — ${ko.champion} is the champion!` }
  };
  const s = statusMap[status] || statusMap.idle;
  document.getElementById('ld-ko-status-bar').innerHTML =
    `<span style="font-weight:700;color:${s.color};">${s.text}</span>`;

  document.getElementById('ld-ko-start-btn').style.display       = (status === 'idle' || status === 'scheduled') ? '' : 'none';
  document.getElementById('ld-ko-pause-btn').style.display        = status === 'active'    ? '' : 'none';
  document.getElementById('ld-ko-resume-btn').style.display       = status === 'paused'    ? '' : 'none';
  document.getElementById('ld-ko-reset-btn').style.display        = status === 'completed' ? '' : 'none';
  document.getElementById('ld-ko-fullrestart-btn').style.display  = (status === 'active' || status === 'paused') ? '' : 'none';
  document.getElementById('ld-ko-schedule-row').style.display     = (status === 'idle' || status === 'scheduled') ? '' : 'none';

  // Schedule UI
  const clearSchedBtn = document.getElementById('ld-ko-clear-schedule-btn');
  const schedStatus   = document.getElementById('ld-ko-schedule-status');
  if (status === 'scheduled' && ko.scheduledStart) {
    clearSchedBtn.style.display = '';
    schedStatus.textContent     = `Auto-start scheduled for ${new Date(ko.scheduledStart).toLocaleString()}`;
    document.getElementById('ld-ko-schedule-dt').value = new Date(ko.scheduledStart - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } else {
    clearSchedBtn.style.display = 'none';
    schedStatus.textContent     = '';
  }

  const champEl = document.getElementById('ld-ko-champion');
  if (status === 'completed' && ko.champion) {
    champEl.innerHTML = `
      <div style="margin-top:12px;background:rgba(240,192,64,.1);border:1px solid rgba(240,192,64,.35);border-radius:10px;padding:14px;text-align:center;">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:4px;">Champion</div>
        <div style="font-family:'Playfair Display',serif;font-size:1.5rem;font-weight:900;color:var(--gold);">🏆 ${ko.champion}</div>
      </div>`;
  } else {
    champEl.innerHTML = '';
  }

  const currentCard = document.getElementById('ld-ko-current-card');
  if ((status === 'active' || status === 'paused') && ko.rounds) {
    const roundIdx = ko.currentRoundIdx || 0;
    const round    = ko.rounds[roundIdx];
    if (round) {
      currentCard.style.display = '';
      const pairings = round.pairings || [];
      const nonBye   = pairings.filter(p => !p.bye).length;
      document.getElementById('ld-ko-round-title').textContent =
        `Round ${round.roundNumber} · ${nonBye} matchup${nonBye !== 1 ? 's' : ''} · First to ${winsTarget} wins`;

      if (ladderCountdownInterval) clearInterval(ladderCountdownInterval);
      const cdEl = document.getElementById('ld-ko-countdown');
      if (status === 'paused') {
        const remMs = ko.pauseRemainingMs || 0;
        const d = Math.floor(remMs / 86400000);
        const h = Math.floor((remMs % 86400000) / 3600000);
        const m = Math.floor((remMs % 3600000) / 60000);
        cdEl.textContent = `⏸ Paused — ${d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`} remaining when resumed`;
      } else {
        const updateCountdown = () => {
          const rem = round.endTime - Date.now();
          if (!document.getElementById('ld-ko-countdown')) { clearInterval(ladderCountdownInterval); return; }
          if (rem <= 0) {
            cdEl.textContent = 'Round ended — resolving…';
            clearInterval(ladderCountdownInterval);
            checkAndAdvanceLadder();
          } else {
            const d = Math.floor(rem / 86400000);
            const h = Math.floor((rem % 86400000) / 3600000);
            const m = Math.floor((rem % 3600000) / 60000);
            cdEl.textContent = d > 0 ? `⏱ ${d}d ${h}h remaining` : h > 0 ? `⏱ ${h}h ${m}m remaining` : `⏱ ${m}m remaining`;
          }
        };
        updateCountdown();
        ladderCountdownInterval = setInterval(updateCountdown, 30000);
      }

      if (status === 'active') {
        if (round.endTime <= Date.now()) {
          checkAndAdvanceLadder();
        } else {
          checkAndPersistKnockoutWinners(pairings, winsTarget, roundIdx);
        }
      }

      const grid = document.createElement('div');
      grid.className = 'ld-pairs-grid';
      pairings.forEach(p => grid.appendChild(buildLadderPairCard(p, winsTarget)));
      const pairingsEl = document.getElementById('ld-ko-pairings');
      pairingsEl.innerHTML = '';
      pairingsEl.appendChild(grid);
    }
  } else {
    currentCard.style.display = 'none';
    if (ladderCountdownInterval) { clearInterval(ladderCountdownInterval); ladderCountdownInterval = null; }
  }

  renderKnockoutHistory(ko);

  // Re-arm scheduled auto-start if page loads with a scheduled ladder
  if (status === 'scheduled' && ko.scheduledStart && ko.scheduledStart > Date.now()) {
    scheduleLadderAutoStart(ko.scheduledStart, ko.winsTarget || 10);
  }
}

function renderKnockoutHistory(ko) {
  const histCard = document.getElementById('ld-ko-history-card');
  const histEl   = document.getElementById('ld-ko-history');
  const rounds   = ko.rounds || [];
  const currentRoundIdx = ko.currentRoundIdx || 0;
  const done = rounds.filter((r, i) =>
    r.status === 'completed' || (ko.status === 'completed' && i <= currentRoundIdx)
  );
  if (!done.length) { histCard.style.display = 'none'; return; }
  histCard.style.display = '';
  histEl.innerHTML = '';
  done.forEach(r => {
    const winners = (r.pairings || []).map(p => p.winner).filter(Boolean);
    const row = document.createElement('div');
    row.className = 'ld-history-row';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="badge badge-blue" style="min-width:80px;justify-content:center;">Round ${r.roundNumber}</span>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${winners.map(w => `<span class="badge badge-gold">🏆 ${w}</span>`).join('')}
        </div>
        <span style="font-size:.73rem;color:var(--text-muted);margin-left:auto;">First to ${ko.winsTarget || 10} wins</span>
      </div>`;
    histEl.appendChild(row);
  });
}

function calcLadderPairScore(pairing) {
  if (!pairing || pairing.bye || !pairing.startTime || !pairing.school1 || !pairing.school2)
    return { s1: 0, s2: 0, totalGames1: 0, totalGames2: 0 };
  let s1 = 0, s2 = 0, totalGames1 = 0, totalGames2 = 0;
  const t1 = pairing.school1, t2 = pairing.school2;
  const endCutoff = pairing.endTime || Infinity;
  Object.values(matches || {}).forEach(m => {
    if (m.scoreRemoved || !m.result || !m.createdAt) return;
    if (m.createdAt < pairing.startTime) return;
    if (m.createdAt > endCutoff) return;
    // Total games tiebreak: any game the school participated in during the round window
    if (m.whiteSchool === t1 || m.blackSchool === t1) totalGames1++;
    if (m.whiteSchool === t2 || m.blackSchool === t2) totalGames2++;
    const isT1w = (m.whiteSchool === t1 && m.blackSchool === t2);
    const isT2w = (m.whiteSchool === t2 && m.blackSchool === t1);
    if (!isT1w && !isT2w) return;
    if (m.result === 'draw') return;
    if (isT1w && m.result === 'white') s1++;
    else if (isT1w && m.result === 'black') s2++;
    else if (isT2w && m.result === 'white') s2++;
    else if (isT2w && m.result === 'black') s1++;
  });
  return { s1, s2, totalGames1, totalGames2 };
}

function buildLadderPairCard(p, winsTarget) {
  const t    = winsTarget || 10;
  const card = document.createElement('div');
  card.className = 'ld-pair-card' + (p.winner ? ' ld-pair-done' : '');

  if (p.bye) {
    card.innerHTML = `
      <div class="ld-pair-row">
        <span class="ld-school-name ld-winner">${p.school1}</span>
        <span class="badge badge-gold" style="margin-left:auto;">BYE — Auto-Win</span>
      </div>`;
    return card;
  }

  const sc   = calcLadderPairScore(p);
  let { s1, s2 } = sc;
  let winner = p.winner;
  if (!winner) {
    if (s1 >= t) winner = p.school1;
    else if (s2 >= t) winner = p.school2;
  }
  const w1pct  = Math.min(100, Math.round((s1 / t) * 100));
  const w2pct  = Math.min(100, Math.round((s2 / t) * 100));
  const s1Lead = s1 > s2, s2Lead = s2 > s1;
  const w1 = winner === p.school1, w2 = winner === p.school2;

  card.innerHTML = `
    <div class="ld-pair-row">
      <span class="ld-school-name ${w1 ? 'ld-winner' : ''}">${p.school1}</span>
      <span class="ld-score ${s1Lead ? 'ld-score-lead' : ''}">${s1}</span>
    </div>
    <div class="ld-progress-bar">
      <div class="ld-progress-fill" style="width:${w1pct}%;background:${w1 ? 'var(--gold)' : 'var(--accent)'};"></div>
    </div>
    <div class="ld-vs-row">
      <span style="font-size:.63rem;color:var(--text-muted);">First to ${t} wins</span>
      ${winner
        ? `<span class="badge badge-gold">🏆 ${winner} advances</span>`
        : `<span style="font-size:.72rem;color:var(--text-muted);">${s1} – ${s2}</span>`}
    </div>
    <div class="ld-progress-bar" style="transform:scaleX(-1);">
      <div class="ld-progress-fill" style="width:${w2pct}%;background:${w2 ? 'var(--gold)' : 'var(--orange)'};"></div>
    </div>
    <div class="ld-pair-row" style="margin-top:3px;">
      <span class="ld-school-name ${w2 ? 'ld-winner' : ''}">${p.school2}</span>
      <span class="ld-score ${s2Lead ? 'ld-score-lead' : ''}">${s2}</span>
    </div>`;
  return card;
}

function resolveExpiredPairing(p, sc) {
  const { s1, s2, totalGames1, totalGames2 } = sc;
  if (s1 === 0 && s2 >= 1) return p.school2;                                          // forfeit
  if (s2 === 0 && s1 >= 1) return p.school1;                                          // forfeit
  if (s1 === 0 && s2 === 0) return Math.random() < 0.5 ? p.school1 : p.school2;      // both absent
  if (s1 > s2) return p.school1;                                                      // clear leader
  if (s2 > s1) return p.school2;
  if (totalGames1 > totalGames2) return p.school1;                                    // tied wins: more games played
  if (totalGames2 > totalGames1) return p.school2;
  return Math.random() < 0.5 ? p.school1 : p.school2;                                // coin flip
}

function generateRound(schoolNames, roundNumber, startTime) {
  const endTime  = startTime + ROUND_DURATION_MS;
  const shuffled = [...schoolNames].sort(() => Math.random() - 0.5);
  const pairings = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairings.push({ id: 'pair-' + Math.floor(i / 2), school1: shuffled[i], school2: shuffled[i + 1], winner: null, startTime, endTime });
  }
  if (shuffled.length % 2 === 1) {
    const byeSchool = shuffled[shuffled.length - 1];
    pairings.push({ id: 'pair-bye', school1: byeSchool, bye: true, winner: byeSchool, startTime, endTime });
  }
  return { roundNumber, startTime, endTime, status: 'active', pairings };
}

function startKnockoutLadder() {
  const schoolNames = Object.values(schools || {}).filter(s => Object.keys(s.contacts || {}).length > 0).map(s => s.name || s).filter(Boolean);
  if (schoolNames.length < 2) { alert('Need at least 2 schools with contacts assigned to start a ladder.'); return; }
  if (!confirm(`Start a knockout ladder with ${schoolNames.length} school${schoolNames.length !== 1 ? 's' : ''}? Only schools with a contact assigned are included. The tournament runs until one champion remains.`)) return;
  const winsTarget = parseInt(document.getElementById('ld-ko-target').value) || 10;
  const now        = Date.now();
  const round1     = generateRound(schoolNames, 1, now);
  db.ref('admin/ladder/knockout').set({ status: 'active', winsTarget, startTime: now, currentRoundIdx: 0, champion: null, rounds: [round1] })
    .then(() => { initLadderPanel(); showAdminToast('Knockout ladder started!'); pushAuditEntry({eventType:'ladder_started', targetName:`${schoolNames.length} schools, target ${winsTarget} wins`}); });
}

function resetKnockoutLadder() {
  const ko = ladderData || {};
  if (ko.status !== 'completed') { alert('Ladder can only be reset after a champion is crowned.'); return; }
  if (!confirm(`Reset the ladder? ${ko.champion ? ko.champion + ' will no longer be champion. ' : ''}This cannot be undone.`)) return;
  db.ref('admin/ladder/knockout').set({ status: 'idle' })
    .then(() => { ladderData = { status: 'idle' }; initLadderPanel(); showAdminToast('Ladder reset. Ready for a new tournament.'); pushAuditEntry({eventType:'ladder_reset', targetName:ko.champion?`Champion was: ${ko.champion}`:''}); });
}

function pauseKnockoutLadder() {
  const ko = ladderData || {};
  if (ko.status !== 'active') { alert('Ladder must be active to pause.'); return; }
  if (!confirm('Pause the ladder? The round timer will be frozen until you resume. Players will not be able to join ladder matches while paused.')) return;
  const roundIdx = ko.currentRoundIdx || 0;
  const round    = (ko.rounds || [])[roundIdx];
  const pauseRemainingMs = round ? Math.max(0, round.endTime - Date.now()) : 0;
  db.ref('admin/ladder/knockout').update({ status: 'paused', pausedAt: Date.now(), pauseRemainingMs })
    .then(() => { initLadderPanel(); showAdminToast('Ladder paused. Resume when ready.'); pushAuditEntry({eventType:'ladder_paused', targetName:`Round ${roundIdx+1}`}); });
}

function resumeKnockoutLadder() {
  const ko = ladderData || {};
  if (ko.status !== 'paused') { alert('Ladder is not paused.'); return; }
  if (!confirm('Resume the ladder? The round timer will continue from where it was paused.')) return;
  const roundIdx       = ko.currentRoundIdx || 0;
  const round          = (ko.rounds || [])[roundIdx];
  const remainingMs    = ko.pauseRemainingMs || ROUND_DURATION_MS;
  const newEndTime     = Date.now() + remainingMs;
  const updates        = {
    'admin/ladder/knockout/status':          'active',
    'admin/ladder/knockout/pausedAt':        null,
    'admin/ladder/knockout/pauseRemainingMs': null,
  };
  if (round) updates[`admin/ladder/knockout/rounds/${roundIdx}/endTime`] = newEndTime;
  db.ref().update(updates)
    .then(() => { initLadderPanel(); showAdminToast('Ladder resumed!'); pushAuditEntry({eventType:'ladder_resumed', targetName:`Round ${roundIdx+1}`}); });
}

function fullRestartKnockoutLadder() {
  const ko = ladderData || {};
  if (ko.status !== 'active' && ko.status !== 'paused') { alert('Full restart is only available while the ladder is active or paused.'); return; }
  if (!confirm('Full Restart: this will WIPE all current round progress and restart the tournament from scratch with all schools. This cannot be undone. Continue?')) return;
  if (!confirm('Are you sure? All match history in the current tournament will be lost.')) return;
  const schoolNames = Object.values(schools || {}).filter(s => Object.keys(s.contacts || {}).length > 0).map(s => s.name || s).filter(Boolean);
  if (schoolNames.length < 2) { alert('Need at least 2 schools with contacts assigned to restart.'); return; }
  const winsTarget = ko.winsTarget || parseInt(document.getElementById('ld-ko-target').value) || 10;
  const now        = Date.now();
  const round1     = generateRound(schoolNames, 1, now);
  db.ref('admin/ladder/knockout').set({ status: 'active', winsTarget, startTime: now, currentRoundIdx: 0, champion: null, rounds: [round1] })
    .then(() => { initLadderPanel(); showAdminToast('Ladder fully restarted from Round 1!'); pushAuditEntry({eventType:'ladder_restarted', targetName:`${schoolNames.length} schools`}); });
}

function scheduleKnockoutLadder() {
  const dtInput = document.getElementById('ld-ko-schedule-dt').value;
  if (!dtInput) { alert('Please select a date and time for the scheduled start.'); return; }
  const scheduledStart = new Date(dtInput).getTime();
  if (isNaN(scheduledStart) || scheduledStart <= Date.now()) { alert('Please choose a future date and time.'); return; }
  const schoolNames = Object.values(schools || {}).map(s => s.name || s).filter(Boolean);
  if (schoolNames.length < 2) { alert('Need at least 2 schools to schedule a ladder.'); return; }
  const winsTarget = parseInt(document.getElementById('ld-ko-target').value) || 10;
  db.ref('admin/ladder/knockout').set({ status: 'scheduled', winsTarget, scheduledStart, champion: null })
    .then(() => { initLadderPanel(); showAdminToast(`Ladder scheduled for ${new Date(scheduledStart).toLocaleString()}`); pushAuditEntry({eventType:'ladder_scheduled', targetName:new Date(scheduledStart).toLocaleString('sv-SE')}); });
  // Start a check loop for auto-start
  scheduleLadderAutoStart(scheduledStart, winsTarget);
}

function clearLadderSchedule() {
  if (!confirm('Clear the scheduled start?')) return;
  db.ref('admin/ladder/knockout').set({ status: 'idle' })
    .then(() => { ladderData = { status: 'idle' }; initLadderPanel(); showAdminToast('Schedule cleared.'); pushAuditEntry({eventType:'ladder_schedule_cleared'}); });
}

let _scheduleAutoStartTimeout = null;
function scheduleLadderAutoStart(scheduledStart, winsTarget) {
  if (_scheduleAutoStartTimeout) clearTimeout(_scheduleAutoStartTimeout);
  const delay = scheduledStart - Date.now();
  if (delay <= 0) return;
  _scheduleAutoStartTimeout = setTimeout(() => {
    db.ref('admin/ladder/knockout').once('value').then(snap => {
      const ko = snap.val() || {};
      if (ko.status !== 'scheduled') return; // cancelled or changed
      const names = Object.values(schools || {}).map(s => s.name || s).filter(Boolean);
      if (names.length < 2) return;
      const now    = Date.now();
      const round1 = generateRound(names, 1, now);
      db.ref('admin/ladder/knockout').set({ status: 'active', winsTarget: ko.winsTarget || winsTarget, startTime: now, currentRoundIdx: 0, champion: null, rounds: [round1] })
        .then(() => { initLadderPanel(); showAdminToast('Ladder auto-started as scheduled!'); });
    });
  }, delay);
}

function checkAndPersistKnockoutWinners(pairings, winsTarget, roundIdx) {
  const updates = {};
  let dirty = false;
  (pairings || []).forEach((p, i) => {
    if (p.bye || p.winner) return;
    const sc = calcLadderPairScore(p);
    if (sc.s1 >= winsTarget) { updates[`admin/ladder/knockout/rounds/${roundIdx}/pairings/${i}/winner`] = p.school1; dirty = true; }
    else if (sc.s2 >= winsTarget) { updates[`admin/ladder/knockout/rounds/${roundIdx}/pairings/${i}/winner`] = p.school2; dirty = true; }
  });
  if (dirty) {
    db.ref().update(updates).then(() => {
      db.ref('admin/ladder/knockout').once('value').then(snap => {
        const freshKo = snap.val() || {};
        const round   = (freshKo.rounds || [])[roundIdx];
        if (round && (round.pairings || []).every(p => p.bye || p.winner)) {
          advanceKnockoutRound(freshKo, roundIdx);
        }
      });
    });
  }
}

function checkAndAdvanceLadder() {
  db.ref('admin/ladder/knockout').once('value').then(snap => {
    const ko = snap.val() || {};
    if (ko.status !== 'active') return;
    const roundIdx = ko.currentRoundIdx || 0;
    const round    = (ko.rounds || [])[roundIdx];
    if (!round || round.status === 'completed') return;
    const winsTarget  = ko.winsTarget || 10;
    const roundEnded  = round.endTime <= Date.now();
    const updates     = {};
    const resolvedPairings = (round.pairings || []).map((p, i) => {
      if (p.bye || p.winner) return p;
      const sc = calcLadderPairScore(p);
      let winner = null;
      if (sc.s1 >= winsTarget) winner = p.school1;
      else if (sc.s2 >= winsTarget) winner = p.school2;
      else if (roundEnded) winner = resolveExpiredPairing(p, sc);
      if (winner) updates[`admin/ladder/knockout/rounds/${roundIdx}/pairings/${i}/winner`] = winner;
      return winner ? { ...p, winner } : p;
    });
    const allResolved = resolvedPairings.every(p => p.bye || p.winner);
    const proceed = () => {
      if (allResolved) {
        const updatedKo = { ...ko, rounds: (ko.rounds || []).map((r, i) => i === roundIdx ? { ...r, pairings: resolvedPairings } : r) };
        advanceKnockoutRound(updatedKo, roundIdx);
      }
    };
    if (Object.keys(updates).length) {
      db.ref().update(updates).then(proceed);
    } else {
      proceed();
    }
  });
}

function advanceKnockoutRound(ko, roundIdx) {
  const round   = (ko.rounds || [])[roundIdx];
  if (!round) return;
  const winners = (round.pairings || []).map(p => p.winner).filter(Boolean);
  const now     = Date.now();
  const updates = {};
  updates[`admin/ladder/knockout/rounds/${roundIdx}/status`] = 'completed';
  if (winners.length <= 1) {
    updates['admin/ladder/knockout/status']   = 'completed';
    updates['admin/ladder/knockout/champion'] = winners[0] || null;
    db.ref().update(updates).then(() => {
      ladderData = null;
      initLadderPanel();
      showAdminToast('🏆 Champion crowned: ' + (winners[0] || 'Unknown'));
    });
  } else {
    const nextRoundIdx = roundIdx + 1;
    const nextRound    = generateRound(winners, round.roundNumber + 1, now);
    updates[`admin/ladder/knockout/rounds/${nextRoundIdx}`] = nextRound;
    updates['admin/ladder/knockout/currentRoundIdx']        = nextRoundIdx;
    db.ref().update(updates).then(() => {
      ladderData = null;
      initLadderPanel();
      showAdminToast(`Round ${round.roundNumber} complete — Round ${round.roundNumber + 1} started!`);
    });
  }
}

function maybeAddSchoolToRound1(schoolName) {
  db.ref('admin/ladder/knockout').once('value').then(snap => {
    const ko = snap.val() || {};
    if (ko.status !== 'active' && ko.status !== 'paused') return;
    if ((ko.currentRoundIdx || 0) !== 0) return;                      // only round 1
    const roundsRaw = ko.rounds || {};
    const round = Array.isArray(roundsRaw) ? roundsRaw[0] : roundsRaw[0];
    if (!round || round.status === 'completed') return;

    // Use Object.entries so this works whether Firebase returned an array or object
    const pairingsEntries = Object.entries(round.pairings || {});
    const alreadyIn = pairingsEntries.some(([, p]) => p.school1 === schoolName || p.school2 === schoolName);
    if (alreadyIn) return;

    const updates = {};
    const byeEntry = pairingsEntries.find(([, p]) => p.bye);

    if (byeEntry) {
      // Replace the bye with a real match against the incoming school
      const byeKey = byeEntry[0];
      updates[`admin/ladder/knockout/rounds/0/pairings/${byeKey}/school2`] = schoolName;
      updates[`admin/ladder/knockout/rounds/0/pairings/${byeKey}/bye`]     = null;
      updates[`admin/ladder/knockout/rounds/0/pairings/${byeKey}/winner`]  = null;
    } else {
      // No bye — add new school as a bye so it auto-advances if still unmatched
      const maxKey = pairingsEntries.reduce((m, [k]) => Math.max(m, parseInt(k, 10)), -1);
      updates[`admin/ladder/knockout/rounds/0/pairings/${maxKey + 1}`] = {
        id: 'pair-bye-late-' + Date.now(),
        school1: schoolName,
        bye: true,
        winner: schoolName,
        startTime: round.startTime,
        endTime:   round.endTime
      };
    }

    db.ref().update(updates).then(() => {
      initLadderPanel();
      showAdminToast(`${schoolName} added to Round 1!`);
      pushAuditEntry({ eventType: 'ladder_school_added_r1', targetName: schoolName });
    });
  });
}

function maybeRemoveSchoolFromRound1(schoolName) {
  db.ref('admin/ladder/knockout').once('value').then(snap => {
    const ko = snap.val() || {};
    if (ko.status !== 'active' && ko.status !== 'paused') return;
    if ((ko.currentRoundIdx || 0) !== 0) return;
    const roundsRaw = ko.rounds || {};
    const round = Array.isArray(roundsRaw) ? roundsRaw[0] : roundsRaw[0];
    if (!round || round.status === 'completed') return;

    const pairingsEntries = Object.entries(round.pairings || {});
    const entry = pairingsEntries.find(([, p]) => p.school1 === schoolName || p.school2 === schoolName);
    if (!entry) return;

    const [, pairing] = entry;
    if (!pairing.bye && pairing.winner) return; // match already decided

    let newPairings;
    if (pairing.bye) {
      // School was a bye — remove that pairing entirely
      newPairings = pairingsEntries
        .filter(([, p]) => p.school1 !== schoolName && p.school2 !== schoolName)
        .map(([, p]) => p);
    } else {
      // School was in a real match — give the opponent a bye instead
      const otherSchool = pairing.school1 === schoolName ? pairing.school2 : pairing.school1;
      newPairings = pairingsEntries.map(([, p]) => {
        if (p.school1 === schoolName || p.school2 === schoolName) {
          return { id: p.id, school1: otherSchool, bye: true, winner: otherSchool, startTime: p.startTime, endTime: p.endTime };
        }
        return p;
      });
    }

    db.ref('admin/ladder/knockout/rounds/0/pairings').set(newPairings).then(() => {
      initLadderPanel();
      showAdminToast(`${schoolName} removed from Round 1.`);
      pushAuditEntry({ eventType: 'ladder_school_removed_r1', targetName: schoolName });
    });
  });
}

// ══════════════════════════════════════════════════════
// CUSTOM LADDER
// ══════════════════════════════════════════════════════
let customLadderData = null;

function initCustomLadder() {
  db.ref('admin/ladder/custom').once('value').then(snap => {
    customLadderData = snap.val() || {};
    renderCustomLadderPanel(customLadderData);
  });
}

function renderCustomLadderPanel(custom) {
  const status     = custom.status || 'idle';
  const winsTarget = custom.winsTarget || 10;

  const setupDiv    = document.getElementById('ld-custom-setup');
  const statusBar   = document.getElementById('ld-custom-status-bar');
  const controlsDiv = document.getElementById('ld-custom-controls');
  const pairingsDiv = document.getElementById('ld-custom-pairings');
  const pauseBtn    = document.getElementById('ld-custom-pause-btn');
  const resumeBtn   = document.getElementById('ld-custom-resume-btn');
  const badge       = document.getElementById('ld-custom-badge');

  if (status === 'idle') {
    setupDiv.style.display    = '';
    statusBar.style.display   = 'none';
    controlsDiv.style.display = 'none';
    if (custom.name)       document.getElementById('ld-custom-name').value   = custom.name;
    if (custom.winsTarget) document.getElementById('ld-custom-target').value = custom.winsTarget;
    pairingsDiv.innerHTML  = '<p style="color:var(--text-muted);font-size:.9rem;">No custom ladder active. Enter a name and click Create.</p>';
    badge.textContent = 'Separate from knockout';
    badge.className   = 'badge badge-purple';
    return;
  }

  setupDiv.style.display    = 'none';
  statusBar.style.display   = '';
  controlsDiv.style.display = 'flex';

  if (status === 'active') {
    statusBar.innerHTML      = `<span style="font-weight:700;color:var(--green);">🟢 Active — ${custom.name || 'Custom Ladder'} · First to ${winsTarget} wins</span>`;
    badge.textContent        = 'Active';
    badge.className          = 'badge badge-green';
    pauseBtn.style.display   = '';
    resumeBtn.style.display  = 'none';
  } else if (status === 'paused') {
    statusBar.innerHTML      = `<span style="font-weight:700;color:var(--orange);">⏸ Paused — ${custom.name || 'Custom Ladder'}</span>`;
    badge.textContent        = 'Paused';
    badge.className          = 'badge badge-warning';
    pauseBtn.style.display   = 'none';
    resumeBtn.style.display  = '';
  }

  const pairings = custom.pairings || [];
  if (!pairings.length) {
    pairingsDiv.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;">No pairings available.</p>';
    return;
  }

  if (status === 'active') checkAndPersistCustomWinners(pairings, winsTarget);

  const grid = document.createElement('div');
  grid.className = 'ld-pairs-grid';
  pairings.forEach(p => grid.appendChild(buildLadderPairCard(p, winsTarget)));
  pairingsDiv.innerHTML = '';
  pairingsDiv.appendChild(grid);
}

function checkAndPersistCustomWinners(pairings, winsTarget) {
  const updates = {};
  (pairings || []).forEach((p, i) => {
    if (p.bye || p.winner) return;
    const sc = calcLadderPairScore(p);
    if (sc.s1 >= winsTarget)      updates[`admin/ladder/custom/pairings/${i}/winner`] = p.school1;
    else if (sc.s2 >= winsTarget) updates[`admin/ladder/custom/pairings/${i}/winner`] = p.school2;
  });
  if (Object.keys(updates).length) db.ref().update(updates);
}

function setupCustomLadder() {
  const name       = document.getElementById('ld-custom-name').value.trim() || 'Custom Ladder';
  const winsTarget = parseInt(document.getElementById('ld-custom-target').value) || 10;
  const schoolNames = Object.values(schools || {}).filter(s => Object.keys(s.contacts || {}).length > 0).map(s => s.name || s).filter(Boolean);
  if (schoolNames.length < 2) { alert('Need at least 2 schools with contacts assigned.'); return; }
  if (!confirm(`Create custom ladder "${name}" with ${schoolNames.length} schools (only schools with a contact assigned) — first to ${winsTarget} wins?`)) return;

  const now      = Date.now();
  const shuffled = [...schoolNames].sort(() => Math.random() - 0.5);
  const pairings = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairings.push({ id: 'pair-' + Math.floor(i / 2), school1: shuffled[i], school2: shuffled[i + 1], winner: null, startTime: now, endTime: null });
  }
  if (shuffled.length % 2 === 1) {
    const bye = shuffled[shuffled.length - 1];
    pairings.push({ id: 'pair-bye', school1: bye, bye: true, winner: bye, startTime: now });
  }
  db.ref('admin/ladder/custom').set({ name, winsTarget, status: 'active', pairings, createdAt: now })
    .then(() => { initCustomLadder(); showAdminToast(`Custom ladder "${name}" created!`); });
}

function pauseCustomLadder() {
  if (!customLadderData || customLadderData.status !== 'active') return;
  if (!confirm('Pause the custom ladder? New game results will not count toward scores until resumed.')) return;
  const now      = Date.now();
  const pairings = customLadderData.pairings || [];
  const updates  = { 'admin/ladder/custom/status': 'paused', 'admin/ladder/custom/pausedAt': now };
  pairings.forEach((p, i) => { if (!p.bye && !p.winner) updates[`admin/ladder/custom/pairings/${i}/endTime`] = now; });
  db.ref().update(updates).then(() => { initCustomLadder(); showAdminToast('Custom ladder paused.'); });
}

function resumeCustomLadder() {
  if (!customLadderData || customLadderData.status !== 'paused') return;
  if (!confirm('Resume the custom ladder? Scores will continue from where they were.')) return;
  const pairings = customLadderData.pairings || [];
  const updates  = { 'admin/ladder/custom/status': 'active', 'admin/ladder/custom/pausedAt': null };
  pairings.forEach((p, i) => { if (!p.bye && !p.winner) updates[`admin/ladder/custom/pairings/${i}/endTime`] = null; });
  db.ref().update(updates).then(() => { initCustomLadder(); showAdminToast('Custom ladder resumed!'); });
}

function restartCustomLadder() {
  if (!customLadderData || (customLadderData.status !== 'active' && customLadderData.status !== 'paused')) return;
  if (!confirm(`Restart "${customLadderData.name || 'Custom Ladder'}" with new random pairings? All current scores will be reset.`)) return;
  const schoolNames = Object.values(schools || {}).map(s => s.name || s).filter(Boolean);
  if (schoolNames.length < 2) { alert('Need at least 2 schools.'); return; }
  const now      = Date.now();
  const shuffled = [...schoolNames].sort(() => Math.random() - 0.5);
  const pairings = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairings.push({ id: 'pair-' + Math.floor(i / 2), school1: shuffled[i], school2: shuffled[i + 1], winner: null, startTime: now, endTime: null });
  }
  if (shuffled.length % 2 === 1) {
    const bye = shuffled[shuffled.length - 1];
    pairings.push({ id: 'pair-bye', school1: bye, bye: true, winner: bye, startTime: now });
  }
  db.ref('admin/ladder/custom').update({ status: 'active', pairings, createdAt: now, pausedAt: null })
    .then(() => { initCustomLadder(); showAdminToast('Custom ladder restarted with new pairings!'); });
}

function clearCustomLadder() {
  if (!confirm('Clear the custom ladder? This cannot be undone.')) return;
  db.ref('admin/ladder/custom').remove().then(() => {
    customLadderData = {};
    renderCustomLadderPanel({});
    showAdminToast('Custom ladder cleared.');
  });
}

// ─── Contact Directory Panel ──────────────────────────────────────────────────

let cdFilterMode = 'all';
let cdAllAdminUsers = {};
let cdManagingSchoolKey = null;
let cdInitialized = false;

function cdInitials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function cdSetFilter(mode) {
  cdFilterMode = mode;
  const map = { all: 'cdFilterAll', contact: 'cdFilterContact', 'no-contact': 'cdFilterNoContact' };
  document.querySelectorAll('.cd-filter-chip').forEach(c => c.classList.remove('active'));
  document.getElementById(map[mode]).classList.add('active');
  cdRenderDirectory();
}

function cdUpdateStats() {
  const entries = Object.values(schools);
  const total = entries.length;
  const withContact = entries.filter(s => Object.keys(s.contacts || {}).length > 0).length;
  document.getElementById('cdStatTotal').textContent = total;
  document.getElementById('cdStatWithContact').textContent = withContact;
  document.getElementById('cdStatNoContact').textContent = total - withContact;
}

function cdRenderDirectory() {
  const query = (document.getElementById('cdSearchInput').value || '').toLowerCase().trim();
  const mySchools = currentAdminData.role === 'super_admin'
    ? Object.keys(schools)
    : getAdminSchools();

  let entries = Object.entries(schools)
    .sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0], 'sv'));

  if (cdFilterMode === 'contact') entries = entries.filter(([, s]) => Object.keys(s.contacts || {}).length > 0);
  if (cdFilterMode === 'no-contact') entries = entries.filter(([, s]) => Object.keys(s.contacts || {}).length === 0);

  if (query) {
    entries = entries.filter(([key, s]) => {
      const nameMatch = (s.name || key).toLowerCase().includes(query);
      const contactMatch = Object.values(s.contacts || {}).some(c =>
        (c.name || '').toLowerCase().includes(query) || (c.email || '').toLowerCase().includes(query)
      );
      return nameMatch || contactMatch;
    });
  }

  const grid = document.getElementById('cdSchoolGrid');
  if (!grid) return;

  if (entries.length === 0) {
    grid.innerHTML = '<div class="empty"><div class="icon">🔍</div><h3>No schools found</h3><p>Try a different search or filter</p></div>';
    return;
  }

  grid.innerHTML = entries.map(([key, school]) => {
    const contacts = Object.values(school.contacts || {});
    const hasContacts = contacts.length > 0;
    const isMine = currentAdminData.role !== 'super_admin' && mySchools.includes(key);
    const years = school.years || {};
    const yearList = Object.values(years).map(y => 'Y' + y.name).sort().join(' ');

    const contactsHtml = hasContacts
      ? contacts.map(c => `
          <div class="contact-item">
            <div class="contact-avatar">${escapeHtml(cdInitials(c.name || c.email))}</div>
            <div class="contact-info">
              <div class="contact-name">${escapeHtml(c.name || c.email || 'Unknown')}</div>
              <div class="contact-email">${escapeHtml(c.email || '')}</div>
            </div>
          </div>`).join('')
      : `<div class="no-contact-badge">⚠ No contact person set</div>`;

    const emailLinks = hasContacts
      ? contacts.map(c => c.email
          ? `<a href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent('Chess match request — ' + (school.name || key))}" class="btn btn-sm btn-outline">✉ Email ${escapeHtml(c.name ? c.name.split(' ')[0] : c.email)}</a>`
          : '').filter(Boolean).join('')
      : '';

    const manageBtn = isMine
      ? `<button class="manage-btn" onclick="cdOpenContactModal('${escapeHtml(key)}')">⚙ Manage Contacts for this school</button>`
      : '';

    const mineTag = isMine ? `<div class="mine-tag">Your school</div>` : '';

    return `<div class="school-card${hasContacts ? '' : ' no-contact'}${isMine ? ' mine' : ''}">
      ${mineTag}
      <div class="school-name">${escapeHtml(school.name || key)}</div>
      <div class="school-meta">${yearList || 'No years set'}</div>
      ${contactsHtml}
      ${emailLinks ? `<div class="card-actions">${emailLinks}</div>` : ''}
      ${manageBtn}
    </div>`;
  }).join('');
}

async function cdInitPanel() {
  if (cdInitialized) return;
  cdInitialized = true;
  // Load all admin users for the manage-contacts modal
  const snap = await db.ref('admin/users').once('value');
  cdAllAdminUsers = snap.val() || {};
  cdUpdateStats();
  cdRenderDirectory();
}

// Re-render whenever schools data updates and the panel is visible
const _origSchoolsListener = db.ref('admin/schools');
_origSchoolsListener.on('value', () => {
  const panel = document.getElementById('panel-contact-directory');
  if (panel && panel.classList.contains('active')) {
    cdUpdateStats();
    cdRenderDirectory();
  }
});

function cdOpenContactModal(schoolKey) {
  const mySchools = currentAdminData.role === 'super_admin'
    ? Object.keys(schools)
    : getAdminSchools();
  if (!mySchools.includes(schoolKey)) return;
  cdManagingSchoolKey = schoolKey;
  const school = schools[schoolKey];
  const currentContacts = school ? (school.contacts || {}) : {};

  document.getElementById('cdContactModalTitle').textContent = 'Manage Contacts — ' + (school ? school.name || schoolKey : schoolKey);

  const adminsForSchool = Object.entries(cdAllAdminUsers)
    .filter(([uid, u]) => {
      if (!u.approved) return false;
      if (u.role === 'super_admin') return false;
      const userSchools = Array.isArray(u.schools) ? u.schools : (u.school ? [u.school] : []);
      return userSchools.includes(schoolKey);
    })
    .sort((a, b) => (a[1].name || a[1].email || '').localeCompare(b[1].name || b[1].email || ''));

  const checklist = document.getElementById('cdAdminChecklist');
  if (adminsForSchool.length === 0) {
    checklist.innerHTML = '<div class="no-admins">No staff admins are assigned to this school yet.<br>Assign admins via the Admin Users panel.</div>';
  } else {
    checklist.innerHTML = adminsForSchool.map(([uid, u]) => {
      const isChecked = !!currentContacts[uid];
      const name = u.name || u.email || 'Unknown';
      const email = u.email || '';
      return `<label class="admin-check-row${isChecked ? ' checked' : ''}" id="cdrow_${escapeHtml(uid)}">
        <input type="checkbox" value="${escapeHtml(uid)}" ${isChecked ? 'checked' : ''}
          onchange="document.getElementById('cdrow_${escapeHtml(uid)}').classList.toggle('checked',this.checked)">
        <div class="admin-check-avatar">${escapeHtml(cdInitials(name))}</div>
        <div class="admin-check-info">
          <div class="admin-check-name">${escapeHtml(name)}</div>
          <div class="admin-check-email">${escapeHtml(email)}</div>
        </div>
      </label>`;
    }).join('');
  }

  document.getElementById('cdContactModal').classList.add('active');
}

function cdCloseContactModal() {
  document.getElementById('cdContactModal').classList.remove('active');
  cdManagingSchoolKey = null;
}

async function cdSaveContactSelections() {
  if (!cdManagingSchoolKey) return;
  const checkboxes = document.querySelectorAll('#cdAdminChecklist input[type=checkbox]');
  const contactsRef = db.ref('admin/schools/' + cdManagingSchoolKey + '/contacts');

  const newContacts = {};
  checkboxes.forEach(cb => {
    if (cb.checked) {
      const uid = cb.value;
      const u = cdAllAdminUsers[uid];
      if (u) {
        newContacts[uid] = {
          name: u.name || u.email || 'Unknown',
          email: u.email || '',
          setAt: Date.now()
        };
      }
    }
  });

  await contactsRef.set(Object.keys(newContacts).length > 0 ? newContacts : null);
  cdCloseContactModal();
  showAdminToast('Contacts updated.');
}
