import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4174);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente do servidor.');
const db = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });

const allowedSlots = new Set(['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00','17:00']);
const brazilToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml' };
const loginAttempts = new Map();
const getCookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
const hash = token => createHash('sha256').update(token).digest('hex');
const json = (res, status, data, headers = {}) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers }); res.end(JSON.stringify(data)); };
const readBody = req => new Promise((resolve, reject) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('Corpo muito grande')); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON inválido')); } }); req.on('error', reject);
});
const isValidDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
function easterSunday(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year, month - 1, day));
}
function closedDay(iso) {
  const date = new Date(`${iso}T12:00:00Z`), year = date.getUTCFullYear(), weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  const fixed = new Set([`${year}-01-01`,`${year}-04-21`,`${year}-05-01`,`${year}-09-07`,`${year}-10-12`,`${year}-11-02`,`${year}-11-15`,`${year}-11-20`,`${year}-12-25`]);
  if (fixed.has(iso)) return true;
  const easter = easterSunday(year);
  for (const offset of [-48,-47,-2,60]) { const d = new Date(easter); d.setUTCDate(d.getUTCDate() + offset); if (d.toISOString().slice(0,10) === iso) return true; }
  return false;
}
function requireOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const expected = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  if (origin === expected) return true;
  json(res, 403, { error:'Origem não autorizada.' }); return false;
}
function dbError(error) {
  if (error?.code === '23505') return { status:409, message:'Este horário já foi reservado.' };
  if (error?.code === '23503') return { status:400, message:'A cliente selecionada não foi encontrada.' };
  if (error?.code === '23514' || error?.code === '22P02') return { status:400, message:'Confira os dados informados.' };
  console.error('Falha ao acessar o Supabase:', error?.message || error);
  return { status:500, message:'Não foi possível concluir. Tente novamente.' };
}
async function signedSession(req) {
  const token = getCookie(req, 'samara_agenda');
  if (!token) return false;
  const tokenHash = hash(token);
  const { data, error } = await db.from('sessions').select('expires_at').eq('token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || Number(data.expires_at) < Date.now()) {
    if (data) { const removed = await db.from('sessions').delete().eq('token_hash', tokenHash); if (removed.error) throw removed.error; }
    return false;
  }
  return true;
}
function clientPayload(body) {
  return {
    full_name: body.full_name.trim(), phone: body.phone.trim(), first_contact: body.first_contact || null,
    regions: Array.isArray(body.regions) ? body.regions.map(String) : [],
    treatment_type: body.treatment_type, notes: String(body.notes || '').trim()
  };
}
function normalizeAppointment(row) {
  const { clients, ...appointment } = row;
  return { ...appointment, time: String(appointment.time).slice(0,5), full_name: clients?.full_name || '', phone: clients?.phone || '' };
}
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    if (!requireOrigin(req, res)) return;
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const now=Date.now(), ip=req.socket.remoteAddress || 'local', recent=(loginAttempts.get(ip)||[]).filter(t=>now-t<600_000);
      if (recent.length >= 8) return json(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'});
      let body; try { body=await readBody(req); } catch { return json(res,400,{error:'Dados inválidos.'}); }
      const username = process.env.AGENDA_USERNAME || 'samarafkrevei', password = process.env.AGENDA_PASSWORD, sessionSecret=process.env.SESSION_SECRET;
      if (!password || !sessionSecret || sessionSecret.length < 32) return json(res,503,{error:'Configure a senha e uma chave de sessão segura no ambiente do servidor antes de entrar.'});
      const supplied = String(body.username || ''), suppliedPass = String(body.password || '');
      const compare = (a,b) => { const aa=createHmac('sha256',sessionSecret).update(a).digest(), bb=createHmac('sha256',sessionSecret).update(b).digest(); return timingSafeEqual(aa,bb); };
      if (!compare(supplied, username) || !compare(suppliedPass, password)) { recent.push(now); loginAttempts.set(ip,recent); return json(res,401,{error:'Usuário ou senha incorretos.'}); }
      loginAttempts.delete(ip);
      const token=randomBytes(32).toString('base64url'), expires=Date.now()+12*60*60*1000;
      const saved = await db.from('sessions').insert({ token_hash:hash(token), expires_at:expires });
      if (saved.error) { const failure=dbError(saved.error); return json(res,failure.status,{error:failure.message}); }
      const secure=req.headers['x-forwarded-proto']==='https'?' Secure;':'';
      return json(res,200,{ok:true,user:username},{'set-cookie':`samara_agenda=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200;${secure}`});
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token=getCookie(req,'samara_agenda');
      if(token) { const removed=await db.from('sessions').delete().eq('token_hash',hash(token)); if(removed.error) { const failure=dbError(removed.error); return json(res,failure.status,{error:failure.message}); } }
      return json(res,200,{ok:true},{'set-cookie':'samara_agenda=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    }
    if (url.pathname === '/api/session' && req.method === 'GET') {
      try { return json(res,200,{authenticated:await signedSession(req)}); }
      catch(e) { const failure=dbError(e); return json(res,failure.status,{error:failure.message}); }
    }
    try {
      if (!await signedSession(req)) return json(res,401,{error:'Faça login para continuar.'});
      if (url.pathname === '/api/clients' && req.method === 'GET') {
        const { data,error } = await db.from('clients').select('*').order('full_name',{ascending:true});
        if(error) throw error; return json(res,200,data);
      }
      if (url.pathname === '/api/clients' && req.method === 'POST') {
        let b; try { b=await readBody(req); } catch { return json(res,400,{error:'Dados inválidos.'}); }
        if (!b.full_name?.trim() || !b.phone?.trim() || !['Estrias','Cicatriz'].includes(b.treatment_type)) return json(res,400,{error:'Preencha nome, WhatsApp e tipo de tratamento.'});
        const { data,error }=await db.from('clients').insert(clientPayload(b)).select('id').single();
        if(error) throw error; return json(res,201,{id:data.id});
      }
      const clientMatch=url.pathname.match(/^\/api\/clients\/(\d+)$/);
      if (clientMatch && req.method === 'PATCH') {
        let b; try { b=await readBody(req); } catch { return json(res,400,{error:'Dados inválidos.'}); }
        if (!b.full_name?.trim() || !b.phone?.trim() || !['Estrias','Cicatriz'].includes(b.treatment_type)) return json(res,400,{error:'Preencha os campos obrigatórios.'});
        const { data,error }=await db.from('clients').update(clientPayload(b)).eq('id',clientMatch[1]).select('id').maybeSingle();
        if(error) throw error; return data?json(res,200,{ok:true}):json(res,404,{error:'Cliente não encontrada.'});
      }
      if (clientMatch && req.method === 'GET') {
        const { data,error }=await db.from('clients').select('*').eq('id',clientMatch[1]).maybeSingle();
        if(error) throw error; return data?json(res,200,data):json(res,404,{error:'Cliente não encontrada.'});
      }
      if (url.pathname === '/api/appointments' && req.method === 'GET') {
        const from=url.searchParams.get('from')||'0000-01-01',to=url.searchParams.get('to')||'9999-12-31';
        const { data,error }=await db.from('appointments').select('*, clients(full_name,phone)').gte('date',from).lte('date',to).neq('status','cancelled').order('date').order('time');
        if(error) throw error; return json(res,200,data.map(normalizeAppointment));
      }
      if (url.pathname === '/api/appointments' && req.method === 'POST') {
        let b; try { b=await readBody(req); } catch { return json(res,400,{error:'Dados inválidos.'}); }
        if (!b.client_id || !isValidDate(b.date) || !allowedSlots.has(String(b.time).slice(0,5)) || closedDay(b.date) || b.date<brazilToday() || !Number.isInteger(b.amount_cents) || b.amount_cents<=0) return json(res,400,{error:'Confira cliente, data, horário e valor. Finais de semana e feriados não têm atendimento.'});
        const parts=Number(b.installments)===2?2:1;
        if(parts===2 && (!isValidDate(b.second_due_date)||b.second_due_date<=b.date||!Number.isInteger(b.second_amount_cents)||b.second_amount_cents<=0)) return json(res,400,{error:'Informe uma data posterior à consulta e um valor válido para a segunda parcela.'});
        const payload={client_id:Number(b.client_id),date:b.date,time:`${String(b.time).slice(0,5)}:00`,amount_cents:b.amount_cents,installments:parts,second_due_date:parts===2?b.second_due_date:null,second_amount_cents:parts===2?b.second_amount_cents:null};
        const { data,error }=await db.from('appointments').insert(payload).select('id').single();
        if(error) { const failure=dbError(error); return json(res,failure.status,{error:failure.message}); }
        return json(res,201,{id:data.id});
      }
      const appointmentMatch=url.pathname.match(/^\/api\/appointments\/(\d+)$/);
      if(appointmentMatch && req.method==='PATCH') {
        let b; try { b=await readBody(req); } catch { return json(res,400,{error:'Dados inválidos.'}); }
        if(!['scheduled','completed','cancelled'].includes(b.status)) return json(res,400,{error:'Status inválido.'});
        const { data,error }=await db.from('appointments').update({status:b.status}).eq('id',appointmentMatch[1]).select('id').maybeSingle();
        if(error) throw error; return data?json(res,200,{ok:true}):json(res,404,{error:'Consulta não encontrada.'});
      }
      if(url.pathname==='/api/finance'&&req.method==='GET') {
        const today=brazilToday(), firstMonth=new Date(`${today.slice(0,7)}-01T12:00:00`); firstMonth.setMonth(firstMonth.getMonth()-5);
        const from=`${firstMonth.getFullYear()}-${String(firstMonth.getMonth()+1).padStart(2,'0')}-01`;
        const [pastResult,upcomingResult,debtsResult]=await Promise.all([
          db.from('appointments').select('date,amount_cents').neq('status','cancelled').gte('date',from).lt('date',today),
          db.from('appointments').select('id,date,time,amount_cents,status,clients(full_name)').gte('date',today).eq('status','scheduled').order('date').order('time').limit(30),
          db.from('appointments').select('id,second_due_date,second_amount_cents,clients(full_name)').eq('installments',2).neq('status','cancelled').gte('second_due_date',today).order('second_due_date').limit(500)
        ]);
        if(pastResult.error) throw pastResult.error; if(upcomingResult.error) throw upcomingResult.error; if(debtsResult.error) throw debtsResult.error;
        const grouped=new Map();
        for(const row of pastResult.data) { const month=row.date.slice(0,7), current=grouped.get(month)||{month,total_cents:0,count:0}; current.total_cents+=row.amount_cents; current.count++; grouped.set(month,current); }
        const months=[]; for(let i=0;i<6;i++){const d=new Date(firstMonth);d.setMonth(firstMonth.getMonth()+i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;months.push(grouped.get(key)||{month:key,total_cents:0,count:0});}
        const upcoming=upcomingResult.data.map(row=>{const {clients,...a}=row;return {...a,time:String(a.time).slice(0,5),full_name:clients?.full_name||''};});
        const debts=debtsResult.data.map(row=>({id:row.id,due_date:row.second_due_date,amount_cents:row.second_amount_cents,full_name:row.clients?.full_name||''}));
        return json(res,200,{months,upcoming,debts});
      }
      if(url.pathname==='/api/settings'&&req.method==='GET') {
        const {data,error}=await db.from('settings').select('key,value'); if(error) throw error;
        return json(res,200,Object.fromEntries(data.map(x=>[x.key,x.value])));
      }
      if(url.pathname==='/api/settings'&&req.method==='PUT') {
        let b; try { b=await readBody(req); } catch { return json(res,400,{error:'Dados inválidos.'}); }
        const rows=['address','pix_key'].map(key=>({key,value:String(b[key]||'').trim()}));
        const {error}=await db.from('settings').upsert(rows,{onConflict:'key'}); if(error) throw error;
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Rota não encontrada.'});
    } catch(e) { const failure=dbError(e); return json(res,failure.status,{error:failure.message}); }
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'allow':'GET, HEAD'});return res.end('Método não permitido');}
  let relative;
  try { relative=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1)); } catch { res.writeHead(400); return res.end('Endereço inválido'); }
  if(relative.split(/[\\/]/).some(part=>part.startsWith('.'))||relative==='data'||relative.startsWith('data/')){res.writeHead(404);return res.end('Não encontrado');}
  const filePath=normalize(join(root, relative));
  if(!filePath.startsWith(root)) { res.writeHead(403); return res.end('Acesso negado'); }
  try { const data=await readFile(filePath); res.writeHead(200,{'content-type':mime[extname(filePath)]||'application/octet-stream','cache-control':'no-cache'}); res.end(data); }
  catch { res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}); res.end('Não encontrado'); }
}
createServer((req,res)=>route(req,res).catch(err=>{const failure=dbError(err);if(!res.headersSent)json(res,failure.status,{error:failure.message});})).listen(port,'0.0.0.0',()=>console.log(`Agenda ativa na porta ${port}`));
