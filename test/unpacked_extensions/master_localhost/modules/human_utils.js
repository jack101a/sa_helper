
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const rand = (min, max) => Math.floor(Math.random()*(max-min+1)+min);

export async function humanType(el, text) {
    el.focus();
    for (let i=0;i<text.length;i++){
        el.value += text[i];
        el.dispatchEvent(new Event('input', {bubbles:true}));
        await sleep(rand(50,150));
        if (Math.random() < 0.2){
            await sleep(rand(300,800));
        }
    }
}

export async function humanClick(el){
    const rect = el.getBoundingClientRect();
    const steps = rand(10,20);
    for (let i=0;i<steps;i++){
        await sleep(rand(5,20));
    }
    await sleep(rand(300,800));
    el.click();
}

export async function waitForEl(selector, timeout=10000){
    const start = Date.now();
    while(Date.now()-start < timeout){
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) return el;
        await sleep(300);
    }
    throw new Error("Element not found: "+selector);
}
