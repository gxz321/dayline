import {useEffect,useId,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icon.jsx';
export default function Modal({title,onClose,children,wide=false}){
  const ref=useRef(null);const id=useId();
  useEffect(()=>{const dialog=ref.current;dialog.showModal();dialog.querySelector('input:not([type=checkbox]),textarea')?.focus();const cancel=e=>{e.preventDefault();onClose()};dialog.addEventListener('cancel',cancel);const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.removeEventListener('cancel',cancel);document.body.style.overflow=previous}},[onClose]);
  return createPortal(<dialog ref={ref} className={`modal ${wide?'modal-wide':''}`} aria-labelledby={id} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose()}}}><header className="modal-header"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={onClose}><Icon name="close"/></button></header>{children}</dialog>,document.body);
}
