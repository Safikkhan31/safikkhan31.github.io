// ---------------------------------------------------------------------------
// Ascent — Auth module
// Handles signup/login UI, JWT storage, and talking to the backend API.
// Exposes window.AscentAuth for the game script to use.
// ---------------------------------------------------------------------------
(function(){
  "use strict";

  // Change this to your deployed backend URL when you host it.
  const API_BASE_URL = window.ASCENT_API_BASE_URL || 'http://localhost:5000/api';

  const TOKEN_KEY = 'ascent_token';
  let currentUser = null;

  function getToken(){
    try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; }
  }
  function setToken(token){
    try{ localStorage.setItem(TOKEN_KEY, token); }catch(e){}
  }
  function clearToken(){
    try{ localStorage.removeItem(TOKEN_KEY); }catch(e){}
  }

  async function apiFetch(path, options){
    const opts = options || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_BASE_URL + path, Object.assign({}, opts, { headers }));
    let data = null;
    try{ data = await res.json(); }catch(e){ /* no body */ }

    if (!res.ok){
      const message = (data && data.message) || ('Request failed (' + res.status + ')');
      throw new Error(message);
    }
    return data;
  }

  function dispatchReady(user){
    currentUser = user || null;
    renderUserBar();
    window.dispatchEvent(new CustomEvent('ascent:authready', { detail: { user: currentUser } }));
  }

  function renderUserBar(){
    const bar = document.getElementById('userBar');
    if (!bar) return;
    if (currentUser){
      bar.innerHTML = 'Playing as <strong style="color:var(--ink)">' + escapeHtml(currentUser.username) +
        '</strong> &nbsp;·&nbsp; <span id="logoutBtn">Log out</span>';
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) logoutBtn.addEventListener('click', logout);
    } else {
      bar.innerHTML = '';
    }
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function logout(){
    clearToken();
    currentUser = null;
    window.location.reload();
  }

  // ---------------- Public API used by the game script ----------------
  window.AscentAuth = {
    getUser: () => currentUser,
    getToken,
    logout,
    submitScore: async (height, bounces) => {
      return apiFetch('/scores', {
        method: 'POST',
        body: JSON.stringify({ height, bounces, final: true }),
      });
    },
    reportProgress: async (height) => {
      return apiFetch('/scores', {
        method: 'POST',
        body: JSON.stringify({ height, final: false }),
      });
    },
    getLeaderboard: async (limit) => {
      return apiFetch('/scores/leaderboard' + (limit ? ('?limit=' + limit) : ''), { method: 'GET' });
    },
  };

  // ---------------- UI wiring ----------------
  function showFormError(id, message){
    const el = document.getElementById(id);
    if (el) el.textContent = message || '';
  }

  function setSubmitting(formId, isSubmitting){
    const form = document.getElementById(formId);
    if (!form) return;
    form.classList.toggle('authSpinner', isSubmitting);
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.textContent = isSubmitting ? 'Please wait…' : (formId === 'loginForm' ? 'Log in' : 'Sign up');
  }

  function initUI(){
    const authOverlay = document.getElementById('authOverlay');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const authTitle = document.getElementById('authTitle');
    const toSignup = document.getElementById('toSignup');
    const toLogin = document.getElementById('toLogin');
    const toSignupWrap = document.getElementById('toSignupWrap');
    const toLoginWrap = document.getElementById('toLoginWrap');

    if (!authOverlay || !loginForm || !signupForm) return; // markup not present

    toSignup.addEventListener('click', ()=>{
      authTitle.textContent = 'Create an account';
      loginForm.classList.add('hidden');
      signupForm.classList.remove('hidden');
      toSignupWrap.classList.add('hidden');
      toLoginWrap.classList.remove('hidden');
    });
    toLogin.addEventListener('click', ()=>{
      authTitle.textContent = 'Log in';
      signupForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      toLoginWrap.classList.add('hidden');
      toSignupWrap.classList.remove('hidden');
    });

    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      showFormError('loginError', '');
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      setSubmitting('loginForm', true);
      try{
        const data = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        setToken(data.token);
        authOverlay.classList.add('hidden');
        dispatchReady(data.user);
      }catch(err){
        showFormError('loginError', err.message);
      }finally{
        setSubmitting('loginForm', false);
      }
    });

    signupForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      showFormError('signupError', '');
      const username = document.getElementById('signupUsername').value.trim();
      const password = document.getElementById('signupPassword').value;
      setSubmitting('signupForm', true);
      try{
        const data = await apiFetch('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        setToken(data.token);
        authOverlay.classList.add('hidden');
        dispatchReady(data.user);
      }catch(err){
        showFormError('signupError', err.message);
      }finally{
        setSubmitting('signupForm', false);
      }
    });
  }

  async function boot(){
    initUI();
    const token = getToken();
    if (!token){
      return; // authOverlay stays visible; user must log in or sign up
    }
    try{
      const data = await apiFetch('/auth/me', { method: 'GET' });
      const authOverlay = document.getElementById('authOverlay');
      if (authOverlay) authOverlay.classList.add('hidden');
      dispatchReady(data.user);
    }catch(e){
      // token invalid/expired — clear it and let the player log in again
      clearToken();
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
