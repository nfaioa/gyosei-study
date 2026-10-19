/* 行政書士の学び舎 v0.3 — オプトインのクラウド自動バックアップ。
   GitHub Pages に認証情報・学習記録を公開しません。
   Supabase REST Auth + PostgREST; ローカル保存は従来どおり維持。
*/
'use strict';
if(location.hash.includes('access_token=')||location.hash.includes('refresh_token=')){
  history.replaceState(null,'',location.pathname+location.search);
}
const CLOUD_CONF='gyosei-cloud-config-v1';
const CLOUD_SESSION='gyosei-cloud-session-v1';
const CLOUD_META='gyosei-cloud-meta-v1';
function getCloudItem(k,fallback){try{return JSON.parse(localStorage.getItem(k))||fallback}catch{return fallback}}
const cloud={
 config:getCloudItem(CLOUD_CONF,{url:'',key:''}),
 session:getCloudItem(CLOUD_SESSION,null),
 meta:getCloudItem(CLOUD_META,{armed:false,revision:null,userId:null,dirty:false,lastSavedAt:null}),
 remote:null,busy:false,timer:null,status:'',checked:false
};
function cloudSetStatus(msg){cloud.status=msg;if(ui.tab==='data')render()}
function cloudPersist(){localStorage.setItem(CLOUD_META,JSON.stringify(cloud.meta))}
function cloudSetSession(session){cloud.session=session; if(session)localStorage.setItem(CLOUD_SESSION,JSON.stringify(session));else localStorage.removeItem(CLOUD_SESSION)}
function cloudBase(){return String(cloud.config.url||'').replace(/\/$/,'')}
function validCloudConfig(){return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cloudBase()) && !!cloud.config.key}
function cloudReady(){return validCloudConfig()&&cloud.session?.access_token&&cloud.session?.user?.id}
function cloudLocalSummary(payload=data){return `${(payload.customQuestions||[]).length}件の追加問題・${(payload.history||[]).length}回の解答記録`}
function cloudSectionHTML(){
 const linked=cloudReady(),remote=cloud.remote;
 const current=remote?.updated_at?new Date(remote.updated_at).toLocaleString('ja-JP'):'まだありません';
 return `<section class="panel"><h2>クラウド自動バックアップ（Ver.0.3）</h2>
 <p class="small muted">Supabase無料枠を利用して学習データを保存します。端末内の保存は従来どおり続きます。<b>別端末への反映は「クラウドから復元」で手動操作</b>してください。</p>
 <div class="warning">はじめに「JSONバックアップをダウンロード」し、端末の外にも保管してください。Supabaseの無料プロジェクトは利用頻度によって一時停止する場合があります。</div>
 <form id="cloudConfigForm" style="margin-top:18px">
 <div class="field"><label for="cloudProjectUrl">Supabase Project URL</label><input class="control" type="url" id="cloudProjectUrl" required placeholder="https://xxxxx.supabase.co" value="${escapeHTML(cloud.config.url||'')}"></div>
 <div class="field"><label for="cloudPublishableKey">Publishable key（公開用キー。secret / service_role は禁止）</label><input class="control" id="cloudPublishableKey" required autocomplete="off" placeholder="sb_publishable_..." value="${escapeHTML(cloud.config.key||'')}"></div>
 <div class="actions"><button class="btn" type="submit">接続情報を保存</button></div></form>
 ${validCloudConfig()?linked?
 `<hr class="divider"><div class="small"><b>ログイン中：</b>${escapeHTML(cloud.session.user.email||'認証済み')}</div>
 <p class="small muted">クラウドの最新保存日時：${escapeHTML(current)}<br>この端末の自動保存：<b>${cloud.meta.armed?'有効':'無効（初回保存または復元が必要）'}</b><br>データ：${escapeHTML(cloudLocalSummary())}</p>
 <div class="actions"><button class="btn btn-primary" data-cloud="upload" ${cloud.busy?'disabled':''}>現在の記録をクラウドに保存</button><button class="btn" data-cloud="restore" ${cloud.busy?'disabled':''}>クラウドから復元</button><button class="btn" data-cloud="refresh" ${cloud.busy?'disabled':''}>保存状態を再確認</button></div>
 ${remote?.previous_payload?'<div class="actions"><button class="btn btn-mini" data-cloud="restorePrevious">1つ前のバックアップを復元</button></div>':''}
 <div class="actions"><button class="btn btn-mini" data-cloud="logout">ログアウト</button></div>`:
 `<hr class="divider"><h3>バックアップ用アカウント</h3><p class="small muted">Supabaseの認証用メールアドレスとパスワードを使います。アプリから新規登録した場合は、受信メールで本人確認後にログインしてください。</p>
 <form id="cloudAuthForm"><div class="field"><label for="cloudEmail">メールアドレス</label><input class="control" id="cloudEmail" type="email" required autocomplete="email"></div><div class="field"><label for="cloudPassword">パスワード（12文字以上）</label><input class="control" id="cloudPassword" type="password" required minlength="12" autocomplete="current-password"></div><div class="actions"><button class="btn btn-primary" type="submit" data-cloud-auth="login">ログイン</button><button class="btn" type="submit" data-cloud-auth="signup">初回登録</button></div></form>`:
 '<p class="small muted" style="margin-top:14px">まずSupabaseで無料プロジェクトを作成し、下の説明書に従ってSQLを登録してください。</p>'}
 <p class="small" role="status" aria-live="polite" style="margin-top:16px;color:var(--accent-dark)">${escapeHTML(cloud.status||'')}</p>
 <p class="tiny muted">送信する内容：問題データ・解答履歴・メモ・AIの会話履歴。AI接続用の合言葉とSupabaseのログインパスワードは送信しません。個人用データをSupabaseに保管することに同意した場合のみ利用してください。</p>
 </section>`;
}
function cloudQuestionDataValid(x){return x&&x.version===1&&x.records&&typeof x.records==='object'&&!Array.isArray(x.records)&&Array.isArray(x.customQuestions)&&x.customQuestions.every(validQuestion)&&Array.isArray(x.history)&&x.aiChats&&typeof x.aiChats==='object'&&!Array.isArray(x.aiChats)}
function cloudHeaders(auth){const h={'apikey':cloud.config.key,'Content-Type':'application/json'};if(auth&&cloud.session?.access_token)h.Authorization='Bearer '+cloud.session.access_token;return h}
async function cloudFetch(path,{method='GET',body,auth=true}={}){
 if(auth)await cloudRefreshSession();
 const response=await fetch(cloudBase()+path,{method,headers:cloudHeaders(auth),body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const raw=await response.text();let json;try{json=raw?JSON.parse(raw):null}catch{json=null}
 if(!response.ok){throw Error((json?.message||json?.msg||json?.error_description||json?.error||'接続エラー '+response.status).toString().slice(0,230))}
 return json;
}
async function cloudRefreshSession(){
 if(!cloud.session)throw Error('ログインしてください');
 if((cloud.session.expires_at||0)>Date.now()/1000+90)return;
 const r=await fetch(cloudBase()+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:cloudHeaders(false),body:JSON.stringify({refresh_token:cloud.session.refresh_token}),cache:'no-store'});
 const obj=await r.json().catch(()=>null);
 if(!r.ok||!obj?.access_token){cloudSetSession(null);cloud.meta.armed=false;cloudPersist();throw Error('認証の期限が切れました。再度ログインしてください')}
 cloudSetSession({...obj,expires_at:Math.floor(Date.now()/1000)+(obj.expires_in||3600)});
}
async function cloudRead(){const rows=await cloudFetch('/rest/v1/study_backups?select=revision,updated_at,payload,previous_payload&limit=1');const r=Array.isArray(rows)?rows[0]||null:null;cloud.remote=r;return r}
async function cloudCheck(){
 if(!cloudReady())return;
 cloud.busy=true;
 try{
 const row=await cloudRead();
 const account=cloud.session.user.id;
 if(cloud.meta.userId!==account){cloud.meta={armed:false,revision:null,userId:account,dirty:false,lastSavedAt:null};cloudPersist()}
 else if(cloud.meta.armed&&cloud.meta.revision!==(row?.revision||null)){
 cloud.meta.armed=false;cloudPersist();cloudSetStatus('クラウド側の更新を検出しました。自動保存を停止しています。内容を確認し、復元または手動保存してください。');
 }else if(cloud.meta.armed){cloudSetStatus('自動バックアップが有効です。記録が増えると自動で保存します。')}
 else if(row){cloudSetStatus('クラウドに既存のバックアップがあります。別端末なら「クラウドから復元」を選んでください。')}
 else{cloudSetStatus('クラウドは空です。「現在の記録をクラウドに保存」で初回バックアップできます。')}
 }catch(e){cloudSetStatus('クラウド状態の確認に失敗：'+e.message)}
 finally{cloud.busy=false;if(cloud.meta.armed&&cloud.meta.dirty)cloudSchedule();if(ui.tab==='data')render()}
}
function cloudSchedule(){if(cloud.timer)clearTimeout(cloud.timer);if(!cloudReady()||!cloud.meta.armed)return;cloud.timer=setTimeout(()=>cloudAutoBackup(),8000)}
window.gyoseiCloud={onLocalSave(){if(!cloud.meta.armed)return;cloud.meta.dirty=true;cloudPersist();cloudSchedule()}};
async function cloudSave({manual=false}={}){
 if(cloud.busy)throw Error('別の処理が進行中です');
 cloud.busy=true;
 try{
 let expected=cloud.meta.revision;
 if(manual){
   const row=await cloudRead();expected=row?.revision||null;
   if(row&&!confirm('既存のクラウドバックアップ（'+new Date(row.updated_at).toLocaleString('ja-JP')+'）を、現在の端末の記録で更新しますか？\n別端末の新しい履歴がある場合は失われる可能性があります。'))return;
 }
 if(!manual&&!cloud.meta.armed)return;
 const snapshot=JSON.stringify(data);
 const out=await cloudFetch('/rest/v1/rpc/save_study_backup',{method:'POST',body:{in_payload:JSON.parse(snapshot),expected_revision:expected}});
 const result=Array.isArray(out)?out[0]:out;
 if(!result||typeof result.new_revision!=='number')throw Error('サーバーが新しい保存番号を返しませんでした');
 cloud.meta.armed=true;cloud.meta.userId=cloud.session.user.id;cloud.meta.revision=result.new_revision;cloud.meta.lastSavedAt=result.saved_at||new Date().toISOString();cloud.meta.dirty=JSON.stringify(data)!==snapshot;cloudPersist();
 cloud.remote={revision:result.new_revision,updated_at:cloud.meta.lastSavedAt,previous_payload:cloud.remote?.payload||cloud.remote?.previous_payload||null,payload:JSON.parse(snapshot)};
 cloudSetStatus('クラウドに保存しました：'+new Date(cloud.meta.lastSavedAt).toLocaleString('ja-JP'));
 }catch(e){cloud.meta.dirty=true;cloudPersist();if(String(e.message).includes('backup_conflict')){cloud.meta.armed=false;cloudPersist();cloudSetStatus('保存競合：別端末で変更されています。自動保存を停止しました。クラウド内容を確認してください。')}
 else{cloudSetStatus('クラウド保存できませんでした（端末の記録は残っています）：'+e.message)}if(manual)alert(e.message)}
 finally{cloud.busy=false;if(cloud.meta.armed&&cloud.meta.dirty)cloudSchedule();if(ui.tab==='data')render()}
}
async function cloudAutoBackup(){cloud.timer=null;if(!navigator.onLine||!cloud.meta.armed||cloud.busy)return;await cloudSave()}
async function cloudRestore(previous=false){
 if(cloud.busy)return;
 if(!confirm('クラウドから復元すると、この端末の問題・解答履歴が置き換わります。先にJSONバックアップをダウンロードします。続けますか？'))return;
 download('gyosei-before-cloud-restore-'+new Date().toISOString().slice(0,10)+'.json',{app:'gyosei-self-study',version:1,exportedAt:new Date().toISOString(),data});
 cloud.busy=true;
 try{
   const row=await cloudRead();const restored=previous?row?.previous_payload:row?.payload;
   if(!cloudQuestionDataValid(restored))throw Error('復元できるデータがありません。または形式が不正です。');
   if(!confirm(`${cloudLocalSummary(restored)}を復元します。現在の端末内データを置き換えてよいですか？`))return;
   cloud.meta.armed=false;cloudPersist();
   data=JSON.parse(JSON.stringify(restored));if(!save())throw Error('端末への保存に失敗しました');
   cloud.meta={armed:!previous,revision:previous?null:row.revision,userId:cloud.session.user.id,dirty:false,lastSavedAt:previous?null:row.updated_at};cloudPersist();
   ui.current=null;ui.editId=null;
   cloudSetStatus(previous?'1つ前の記録を復元しました。自動バックアップは停止中です。内容を確認して手動保存してください。':'クラウドから復元しました。自動バックアップを再開しました。');
 }catch(e){cloudSetStatus('復元できませんでした：'+e.message);alert(e.message)}
 finally{cloud.busy=false;render()}
}
async function cloudAuth(mode,form){
 if(cloud.busy)return;
 cloud.busy=true;
 const email=form.querySelector('#cloudEmail').value.trim();const password=form.querySelector('#cloudPassword').value;
 try{
 if(password.length<12)throw Error('パスワードは12文字以上にしてください。');
 if(mode==='signup'){
   const addr=encodeURIComponent(location.origin+location.pathname);
   await cloudFetch('/auth/v1/signup?email_redirect_to='+addr,{method:'POST',body:{email,password},auth:false});
   cloudSetStatus('確認メールが送信されました。メール内のリンクで認証してから、この画面でログインしてください。');
 }else{
   const result=await cloudFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});
   if(!result?.access_token||!result.user?.id)throw Error('ログイン情報が取得できませんでした');
   cloudSetSession({...result,expires_at:Math.floor(Date.now()/1000)+(result.expires_in||3600)});
   cloud.meta.armed=false;cloudPersist();cloudSetStatus('ログインしました。クラウドの保存状況を確認中です。');
   await cloudCheck();
 }
 }catch(e){alert('クラウド認証エラー：'+e.message);cloudSetStatus('認証に失敗：'+e.message)}finally{cloud.busy=false;render()}
}
$('app').addEventListener('submit',async e=>{
 if(e.target.id==='cloudConfigForm'){
   e.preventDefault();const url=$('cloudProjectUrl').value.trim().replace(/\/$/,'');const key=$('cloudPublishableKey').value.trim();
   if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)){alert('Project URLは https://xxxxx.supabase.co の形式で入力してください');return}
   if(!(key.startsWith('sb_publishable_')||/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key))||key.startsWith('sb_secret_')){alert('Publishable key（公開用キー）を入力してください。secret / service_role キーは使えません。');return}
   if(key.startsWith('eyJ')){try{const role=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;if(role!=='anon')throw Error('anon以外のキー');}catch{alert('service_role キーは入力できません。anonキーをご確認ください。');return}}
   if(cloud.config.url!==url||cloud.config.key!==key){cloudSetSession(null);cloud.meta={armed:false,revision:null,userId:null,dirty:false,lastSavedAt:null};cloudPersist()}
   cloud.config={url,key};localStorage.setItem(CLOUD_CONF,JSON.stringify(cloud.config));cloudSetStatus('接続情報を保存しました。下からアカウントを作成またはログインしてください。');render();return;
 }
 if(e.target.id==='cloudAuthForm'){
   e.preventDefault();const mode=e.submitter?.dataset.cloudAuth||'login';await cloudAuth(mode,e.target);return;
 }
});
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-cloud]');if(!el)return;
 e.preventDefault();const action=el.dataset.cloud;
 if(action==='logout'){cloudSetSession(null);cloud.meta.armed=false;cloudPersist();cloudSetStatus('クラウドからログアウトしました。端末内の学習記録は残っています。');render();return}
 if(!cloudReady()){alert('まずクラウドにログインしてください');return}
 if(action==='refresh'){await cloudCheck();return}
 if(action==='upload'){await cloudSave({manual:true});return}
 if(action==='restore'){await cloudRestore(false);return}
 if(action==='restorePrevious'){await cloudRestore(true)}
});
window.addEventListener('online',()=>{if(cloud.meta.dirty&&cloud.meta.armed)cloudSchedule()});
window.addEventListener('pageshow',()=>{if(cloud.meta.dirty&&cloud.meta.armed)cloudSchedule()});
if(cloudReady())cloudCheck();
