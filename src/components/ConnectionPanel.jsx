import {useEffect,useRef,useState} from 'react';
import Modal from './Modal.jsx';
import './ConnectionPanel.css';

export default function ConnectionPanel({session,status,onCheck,onClose}) {
  const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function submit(event,logout=false) {
    event?.preventDefault(); if(request.current) return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    const timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(logout?'/api/logout':'/api/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(logout?{}:{password}),signal:controller.signal});
      if(!response.ok) {setError(response.status===429?'尝试次数较多，请稍后再登录。':response.status===401?'访问密码不正确。':response.status===503?'此站点尚未完成登录配置。':'登录未完成，请检查网络后再试。');return;}
      await onCheck({force:true});onClose();
    } catch {if(!controller.signal.aborted)setError('连接未完成，请检查网络后再试。');else setError('等待已结束，请重新检查登录状态。');}
    finally {clearTimeout(timer);setPassword('');request.current=null;setBusy(false);}
  }
  const standalone=session?.mode==='standalone',sites=session?.mode==='sites',pages=session?.mode==='pages';
  return <Modal title="连接助手" onClose={onClose}><div className="connection-panel">
    {pages?<><p className="connection-lead">日程与计划已经可以使用，私人 AI 尚未连接。</p><p>这个 GitHub Pages 版本提供日程、任务和资料阅读。页面内模型对话需要另外部署私人服务端；这里不会收集或保存 API 密钥。</p><p>现在可用「计划工具」整理下一步，或使用官方网页版备用入口。接入真实服务前，发送按钮保持关闭。</p></>:null}
    {standalone ? session.configured ? session.authenticated ? <><p className="connection-lead">已登录这个独立站点。</p><p>登录只用于保护你的模型调用，不会自动上传本机日程。</p><button className="button secondary" type="button" disabled={busy} onClick={e=>submit(e,true)}>退出登录</button></> : <form onSubmit={submit}><p className="connection-lead">输入你的访问密码，即可在这里聊天。</p><label>访问密码<input type="password" autoComplete="current-password" maxLength={256} required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label><button type="submit" className="button primary" disabled={busy||!password}>{busy?'正在登录…':'登录使用助手'}</button></form> : <><p className="connection-lead">先为独立站点设置访问密码。</p><p>部署时完成私人登录设置后，就能在本页登录。模型密钥由服务器保管，网页里不需要填写。</p></> : sites ? <><p className="connection-lead">先登录，保护你的私人助手。</p><p>当前预览沿用原站点的账号验证；独立部署版使用自己的访问密码。</p>{status&&!status.authenticated?<a className="button primary" href={status.signInUrl} target="_top">登录并返回助手</a>:null}</> : null}
    {!standalone&&!sites&&!pages?<p role="status">暂时无法确认登录方式，请在下方重新检查连接。</p>:null}
    {error?<p className="form-error" role="alert">{error}</p>:null}
    <details className="connection-details"><summary>服务状态</summary><dl><div><dt>模型服务</dt><dd>{status?.configured&&status.enabled?'已配置，发送消息后验证回复':'尚未就绪'}</dd></div>{status?.configured?<div><dt>当前模型</dt><dd>{status.model||status.provider}</dd></div>:null}<div><dt>单日次数上限</dt><dd>{pages?'未启用':status?.limits?.daily??'待确认'}</dd></div></dl><p>聊天通过服务器调用模型。仅勾选时附上有限安排，回复需核实；停止等待也可能已产生费用。</p><button type="button" className="button secondary" disabled={busy} onClick={onCheck}>重新检查</button></details>
  </div></Modal>;
}
