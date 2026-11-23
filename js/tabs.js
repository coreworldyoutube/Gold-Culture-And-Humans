(() => {
 "use strict";
 const buttons=[...document.querySelectorAll("[data-tab]")];
 const pages=[...document.querySelectorAll("[data-page]")];
 function openTab(name){
  if(!pages.some(page=>page.dataset.page===name))return;
  for(const page of pages)page.hidden=page.dataset.page!==name;
  for(const button of buttons)button.setAttribute("aria-selected",String(button.dataset.tab===name));
  try{localStorage.setItem("goldClickerActiveTab",name);}catch(error){}
 }
 for(const button of buttons)button.addEventListener("click",()=>openTab(button.dataset.tab));
 let initial="economy";
 try{const saved=localStorage.getItem("goldClickerActiveTab");if(saved&&pages.some(page=>page.dataset.page===saved))initial=saved;}catch(error){}
 openTab(initial);
})();