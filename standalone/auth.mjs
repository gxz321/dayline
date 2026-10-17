import {scrypt as nativeScrypt,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(nativeScrypt),TTL=7*24*60*60*1000;
const PARAMETERS={N:32768,r:8,p:1,maxmem:64*1024*1024};
export async function hashPassword(password){
  if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Use a password between 12 and 256 characters');
  const salt=randomBytes(16).toString('hex'),key=await scrypt(password,salt,64,PARAMETERS);
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}
export function validPasswordHash(value){return typeof value==='string'&&/^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(value);}
export async function verifyPassword(password,hash){
  if(!validPasswordHash(hash)||typeof password!=='string'||password.length>256)return false;
  const [,N,r,p,salt,expected]=hash.split('$');const actual=await scrypt(password,salt,64,PARAMETERS);
  return timingSafeEqual(actual,Buffer.from(expected,'hex'));
}
export function createAuth({passwordHash,sessionSecret,secure,now=Date.now}){
  const configured=validPasswordHash(passwordHash)&&typeof sessionSecret==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(sessionSecret);
  const sessions=new Map(),attempts=new Map();let inFlight=0;
  const name=secure?'__Host-dayline_session':'dayline_session';
  const sign=value=>createHmac('sha256',sessionSecret||'disabled').update(value).digest('base64url');
  const expire=()=>{const at=now();for(const[id,until]of sessions)if(until<=at)sessions.delete(id);for(const[key,row]of attempts)if(row.until<=at)attempts.delete(key);};
  function token(headers){const cookie=headers.get('cookie')||'';if(cookie.length>8192)return null;const rows=cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));if(rows.length!==1)return null;const raw=rows[0].slice(name.length+1);if(!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(raw))return null;const [id,signature]=raw.split('.'),expected=sign(id);return timingSafeEqual(Buffer.from(signature),Buffer.from(expected))&&sessions.get(id)>now()?id:null;}
  const cookie=(value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
  return {configured,authenticated(headers){expire();return configured&&!!token(headers);},logout(headers){const id=token(headers);if(id)sessions.delete(id);return cookie('',0);},async login(password,address){
    if(!configured)return {status:503,code:'not_configured'};expire();const at=now(),keys=['global','ip:'+address];
    if(keys.some(key=>(attempts.get(key)?.count||0)>=(key==='global'?50:5))||inFlight>=2)return {status:429,code:'rate_limit'};
    // Bounded map: reverse-proxy headers are deliberately ignored.
    if(attempts.size>=1000&&!attempts.has(keys[1]))return {status:429,code:'rate_limit'};
    for(const key of keys){const old=attempts.get(key);attempts.set(key,{count:(old?.count||0)+1,until:old?.until||at+15*60*1000});}
    inFlight++;let verified=false;try{verified=await verifyPassword(password,passwordHash);}finally{inFlight--;}
    if(!verified)return {status:401,code:'invalid_credentials'};
    const id=randomBytes(32).toString('base64url');if(sessions.size>=32)sessions.delete(sessions.keys().next().value);sessions.set(id,at+TTL);
    return {status:200,cookie:cookie(id+'.'+sign(id),TTL/1000)};
  }};
}
