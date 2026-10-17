import {useEffect} from 'react';

// VisualViewport follows the iOS keyboard while layout viewport units may not.
// Store transient geometry in CSS, avoiding a React render on every keyboard frame.
export function useMobileViewport(){
 useEffect(()=>{
  const root=document.documentElement;
  const viewport=window.visualViewport;
  let frame=0;
  let layoutWidth=window.innerWidth;
  let layoutHeight=window.innerHeight;
  const editable=()=>{
   const target=document.activeElement;
   return target instanceof HTMLElement&&(
    target.matches('textarea,[contenteditable="true"]')||
    target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="file"]):not([type="color"])')
   );
  };
  const update=()=>{
   frame=0;
   if(Math.abs(window.innerWidth-layoutWidth)>80){
    layoutWidth=window.innerWidth;
    layoutHeight=window.innerHeight;
   }
   if(!editable())layoutHeight=Math.max(layoutHeight,window.innerHeight);
   const height=Math.round(viewport?.height||window.innerHeight);
   const keyboard=editable()&&window.innerWidth<=900&&Math.max(layoutHeight,window.innerHeight)-height>120;
   root.style.setProperty('--app-height',`${height}px`);
   root.style.setProperty('--visual-viewport-top',`${Math.round(viewport?.offsetTop||0)}px`);
   document.body.classList.toggle('keyboard-open',keyboard);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)};
  update();
  viewport?.addEventListener('resize',schedule,{passive:true});
  viewport?.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  document.addEventListener('focusin',schedule);
  document.addEventListener('focusout',schedule);
  return ()=>{
   if(frame)cancelAnimationFrame(frame);
   viewport?.removeEventListener('resize',schedule);
   viewport?.removeEventListener('scroll',schedule);
   window.removeEventListener('resize',schedule);
   document.removeEventListener('focusin',schedule);
   document.removeEventListener('focusout',schedule);
   document.body.classList.remove('keyboard-open');
   root.style.removeProperty('--app-height');
   root.style.removeProperty('--visual-viewport-top');
  };
 },[]);
}
