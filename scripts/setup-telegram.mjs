/** Explicit operator actions only. Never sends messages and never writes credential files. */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

function setupError(code){return Object.assign(new Error(code),{code});}
function setupToken(env){const token=env.TELEGRAM_BOT_TOKEN;if(typeof token!=='string'||!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token))throw setupError('TELEGRAM_BOT_TOKEN_missing_or_invalid');return token;}
function setupID(value){return /^[1-9]\d{0,15}$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)<=4503599627370495;}
function setupIDs(value){return typeof value==='string'&&value.trim().split(/[\s,]+/).filter(Boolean).length>=1&&value.trim().split(/[\s,]+/).filter(Boolean).length<=5&&value.trim().split(/[\s,]+/).filter(Boolean).every(setupID);}
function setupURL(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.search||url.hash||url.pathname!=='/api/telegram/webhook')throw Error();return url.href;}catch{throw setupError('TELEGRAM_WEBHOOK_URL_must_be_exact_https_webhook_route');}}
async function setupAPI(token,method,body,fetcher){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);let reader;
  try{
    const response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{}),redirect:'error',signal:controller.signal});
    if(Number(response.headers.get('content-length'))>131072)throw setupError('Telegram_response_too_large');
    reader=response.body?.getReader();if(!reader)throw setupError('Telegram_response_invalid');const chunks=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>131072){await reader.cancel();throw setupError('Telegram_response_too_large');}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const data=JSON.parse(new TextDecoder().decode(bytes));if(!response.ok||data?.ok!==true)throw setupError(`Telegram_API_failed_${Number.isSafeInteger(data?.error_code)?data.error_code:response.status}`);return data.result;
  }catch(error){if(error.code)throw error;throw setupError(controller.signal.aborted?'Telegram_request_timeout':'Telegram_request_failed');}
  finally{clearTimeout(timer);controller.abort();try{reader?.releaseLock();}catch{}}
}
export async function runTelegramSetup(args,env,fetcher=fetch){
  if(args.length!==1||args[0]==='--help')return {help:'node scripts/setup-telegram.mjs --status | --ids | --set | --delete；仅从当前进程环境读取配置。--ids 要求 TELEGRAM_PAIR_CODE，并只显示匹配你发送的 /start 配对码的私人聊天。脚本不会发送消息、创建机器人、保存密钥或修改站点环境。'};
  const action=args[0];if(!['--status','--ids','--set','--delete'].includes(action))throw setupError('Unknown_action');
  const token=setupToken(env);
  if(action==='--status'){
    const bot=await setupAPI(token,'getMe',{},fetcher);const info=await setupAPI(token,'getWebhookInfo',{},fetcher);
    let safeURL=null;try{safeURL=setupURL(info?.url);}catch{}
    return {botUsername:typeof bot?.username==='string'&&/^[A-Za-z0-9_]{5,32}$/.test(bot.username)?bot.username:null,botId:setupID(bot?.id)?bot.id:null,webhook:{registered:!!info?.url,url:safeURL,pendingUpdates:Number.isSafeInteger(info?.pending_update_count)?info.pending_update_count:0,hasDeliveryError:!!info?.last_error_date,allowedUpdates:Array.isArray(info?.allowed_updates)?info.allowed_updates.filter(value=>typeof value==='string'&&/^[a-z_]{1,40}$/.test(value)):[]},note:'注册成功不代表消息链路已经验证；由你在私人聊天发送 /help 后确认回复。非规范现有 webhook 地址不会原样输出，避免泄露路径或查询凭据。'};
  }
  if(action==='--ids'){
    const code=env.TELEGRAM_PAIR_CODE;if(typeof code!=='string'||! /^[A-Za-z0-9_-]{16,64}$/.test(code))throw setupError('TELEGRAM_PAIR_CODE_missing_or_invalid');
    const info=await setupAPI(token,'getWebhookInfo',{},fetcher);if(info?.url)throw setupError('Webhook_already_registered_getUpdates_unavailable_use_known_own_ids');
    // No offset: do not confirm/forget messages; no webhook deletion or queue dropping.
    const updates=await setupAPI(token,'getUpdates',{limit:20,timeout:0,allowed_updates:['message']},fetcher);if(!Array.isArray(updates))throw setupError('Telegram_updates_invalid');
    const matching=[];for(const update of updates){const message=update.message;if(message?.chat?.type!=='private'||message?.from?.is_bot!==false||message.text!==`/start ${code}`||!setupID(message.chat.id)||!setupID(message.from.id)||message.business_connection_id||message.guest_query_id||message.sender_chat)continue;const pair={chatId:String(message.chat.id),userId:String(message.from.id)};if(!matching.some(item=>item.chatId===pair.chatId&&item.userId===pair.userId))matching.push(pair);}
    if(matching.length>1)throw setupError('Multiple_matching_private_chats_use_a_new_pair_code');
    return {matchingPrivateChats:matching,note:matching.length?'请核对这是你刚发送的私人聊天，再填入白名单。未输出消息内容或他人身份。':'没有找到配对消息；请给自己的机器人发送完全匹配的 /start 配对码，然后再运行。'};
  }
  if(action==='--set'){
    const url=setupURL(env.TELEGRAM_WEBHOOK_URL);const secret=env.TELEGRAM_WEBHOOK_SECRET;
    if(typeof secret!=='string'||! /^[A-Za-z0-9_-]{32,256}$/.test(secret))throw setupError('TELEGRAM_WEBHOOK_SECRET_missing_or_invalid');
    if(!setupIDs(env.TELEGRAM_ALLOWED_CHAT_IDS)||!setupIDs(env.TELEGRAM_ALLOWED_USER_IDS)||env.TELEGRAM_ENABLED!=='true')throw setupError('Private_allowlists_and_explicit_TELEGRAM_ENABLED_required');
    const result=await setupAPI(token,'setWebhook',{url,secret_token:secret,allowed_updates:['message'],max_connections:1,drop_pending_updates:false},fetcher);if(result!==true)throw setupError('Telegram_registration_not_confirmed');
    return {webhookRegistered:true,url,note:'仅登记了 Telegram webhook；站点需配置相同服务端密钥和白名单。请由你主动发送 /help 验证，GPT 仍需另行配置 OpenAI API 密钥。'};
  }
  const result=await setupAPI(token,'deleteWebhook',{drop_pending_updates:false},fetcher);if(result!==true)throw setupError('Telegram_deletion_not_confirmed');return {webhookRemoved:true,pendingUpdatesPreserved:true};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{console.log(JSON.stringify(await runTelegramSetup(process.argv.slice(2),process.env),null,2));}
  catch(error){console.error(JSON.stringify({error:error.code||'Setup_failed',note:'错误输出不会包含 token、API 密钥或上游原始响应。'}));process.exitCode=1;}
}
