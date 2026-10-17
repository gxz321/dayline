/** Local credential setup. Password never enters arguments, logs, or output files. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {hashPassword} from './auth.mjs';
const root=resolve(import.meta.dirname,'..'),destination=resolve(root,'.env.local');
async function hidden(prompt){
  if(!process.stdin.isTTY||!process.stdin.setRawMode)throw Error('Use an interactive terminal, or --stdin with a trusted pipe.');
  process.stderr.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((done,reject)=>{let value='';const restore=()=>{process.stdin.off('data',data);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');};const data=chunk=>{for(const character of chunk){if(character==='\u0003'){restore();reject(Error('Cancelled'));return;}if(character==='\r'||character==='\n'){restore();done(value);return;}if(character==='\u007f'||character==='\b')value=value.slice(0,-1);else if(character>=' '&&value.length<257)value+=character;}};process.stdin.on('data',data);});
}
async function piped(){let bytes=0,value='';for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>2048)throw Error('Input too long');value+=chunk.toString('utf8');}const lines=value.replace(/\r\n/g,'\n').split('\n');if(lines.at(-1)==='')lines.pop();if(lines.length!==1)throw Error('Provide one password line only');return lines[0];}
try{
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--stdin'))throw Error('Only --stdin is supported. Destination is the local .env.local file.');
  const password=args.includes('--stdin')?await piped():await hidden('Choose a private Dayline password (12+ characters): ');
  if(!args.includes('--stdin')&&password!==await hidden('Repeat password: '))throw Error('Passwords do not match');
  const hash=await hashPassword(password),secret=randomBytes(32).toString('base64url');let existing='';try{existing=await readFile(destination,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  // Preserve an existing API key and all unrelated local settings.
  existing=existing.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?STANDALONE_(?:PASSWORD_HASH|SESSION_SECRET)\s*=/.test(line)).join('\n').replace(/\n*$/,'');
  const content=existing+'\nSTANDALONE_PASSWORD_HASH='+hash+'\nSTANDALONE_SESSION_SECRET='+secret+'\n';
  const temporary=destination+'.'+randomBytes(12).toString('hex')+'.tmp';
  try{await writeFile(temporary,content,{flag:'wx',mode:0o600});await rename(temporary,destination);}finally{await unlink(temporary).catch(()=>{});}
  console.log('Private login configured in local .env.local. Existing API settings were preserved. Password and session secret were not printed.');
}catch(error){console.error(error.message==='Passwords do not match'||error.message==='Cancelled'||error.message.startsWith('Use a password')?error.message:'Setup could not finish. Use an interactive terminal or a trusted one-line stdin pipe; check local file permissions.');process.exitCode=1;}
