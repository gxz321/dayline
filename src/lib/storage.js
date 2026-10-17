import {storageKey} from './deployment.js';
import {useCallback,useEffect,useRef,useState} from 'react';
import {initialState,validateImport,todayISO} from './calendar.js';
const KEY=storageKey('dayline:state:v1');
export function usePlannerStorage(seed){
 const [initial]=useState(()=>{let raw=null;try{raw=localStorage.getItem(KEY);return {data:raw!==null?validateImport(JSON.parse(raw)):initialState(seed),error:'',rawRecovery:null}}catch{return {data:initialState(seed),error:typeof raw==='string'?'原有本地记录无法读取，已保留原始记录并暂停保存。当前显示初始计划；普通导出仅包含当前显示数据，请先在设置下载原始恢复记录。':'浏览器本地存储暂不可读取。当前显示初始计划；普通导出仅包含当前显示数据，修改可能无法保存。',rawRecovery:raw}}});
 const [state,setState]=useState(initial.data);const [storageError,setStorageError]=useState(initial.error);const [rawRecovery,setRawRecovery]=useState(initial.rawRecovery);const blocked=useRef(!!initial.error);
 useEffect(()=>{if(blocked.current)return;try{localStorage.setItem(KEY,JSON.stringify(state));setStorageError('')}catch{setStorageError('浏览器没有成功保存。请导出备份后再离开此页。')}},[state]);
 useEffect(()=>{const fn=e=>{if(e.key===KEY&&typeof e.newValue==='string'){try{const next=validateImport(JSON.parse(e.newValue));blocked.current=false;setRawRecovery(null);setStorageError('');setState(next)}catch{blocked.current=true;setRawRecovery(e.newValue);setStorageError('另一个页面的本地记录无法读取，已保留原始记录并暂停保存。普通导出只包含当前显示的计划；请在设置下载原始恢复记录。')}}};window.addEventListener('storage',fn);return()=>window.removeEventListener('storage',fn)},[]);
 const replaceState=useCallback(data=>{blocked.current=false;setRawRecovery(null);setStorageError('');setState(data)},[]);
 return {state,setState,storageError,rawRecovery,replaceState};
}
export function downloadJSON(state){download(JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2),`dayline-${todayISO()}.json`,'application/json')}
export function downloadRawRecovery(raw){if(typeof raw!=='string')throw new Error('没有可下载的原始恢复记录。');download(raw,`dayline-recovery-${todayISO()}.txt`,'text/plain;charset=utf-8')}
export function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
