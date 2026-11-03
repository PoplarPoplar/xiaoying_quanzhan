import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=path.resolve(root,'docs/browser'); await mkdir(evidence,{recursive:true});
const base=process.env.BROWSER_BASE_URL||'http://localhost:3000';
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(); const faults=[]; const passed=[];let block=false;let polls=0;
page.on('pageerror',error=>faults.push(error.message));
page.on('request',request=>{if(request.method()==='GET'&&/\/api\/tasks\/[^/?]+$/.test(request.url()))polls++});
await page.route('**/api/tasks/*',route=>block&&route.request().method()==='GET'&&/\/api\/tasks\/[^/?]+$/.test(route.request().url())?route.abort():route.continue());
const png=await readFile(path.resolve(root,'backend/src/main/resources/demo-assets/postcard.png'));
const image={name:'browser.png',mimeType:'image/png',buffer:png};
try {
 await page.goto(base+'/templates');
 await expect(page.locator('.template-card')).toHaveCount(4,{timeout:30000});
 await page.getByRole('button',{name:'旅行灵感',exact:true}).click();await expect(page.locator('.template-card')).toHaveCount(2);
 await page.getByRole('button',{name:'全部模板',exact:true}).click();await expect(page.locator('.template-card')).toHaveCount(4);
 await expect.poll(()=>page.locator('.template-card img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);await page.screenshot({path:path.join(evidence,'desktop-catalog.png'),fullPage:true});passed.push('Java template list and category filtering in browser');
 await page.locator('a.template-card[href="/templates/postcard"]').click();
 await expect(page.getByRole('button',{name:/开始制作/})).toBeDisabled();
 const input=page.getByLabel('选择素材1');
 await input.setInputFiles({name:'oversize.png',mimeType:'image/png',buffer:Buffer.alloc(6*1024*1024)});
 await expect(page.locator('.upload-slot [role=alert]')).toContainText('大小限制');
 await input.setInputFiles(image); await expect(page.getByText('✓ 上传完成',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'移除素材1',exact:true}).click();await expect(page.getByRole('button',{name:/开始制作/})).toBeDisabled();
 await input.setInputFiles(image);await expect(page.getByText('✓ 上传完成',{exact:true})).toBeVisible();passed.push('required upload, oversize client validation, real upload and remove');
 await page.getByText('演示控制',{exact:true}).click();await page.getByLabel(/使用自定义模拟配置/).check();
 await page.getByLabel('每阶段耗时（毫秒）').fill('1400');
 const accepted=page.waitForResponse(response=>response.url().endsWith('/api/tasks')&&response.request().method()==='POST');
 await page.getByRole('button',{name:/开始制作/}).click();const taskA=await (await accepted).json();
 await expect(page.getByRole('button',{name:/开始制作/})).toBeEnabled();
 await page.getByLabel('失败阶段').selectOption('GENERATE');
 const acceptedB=page.waitForResponse(response=>response.url().endsWith('/api/tasks')&&response.request().method()==='POST');
 await page.getByRole('button',{name:/开始制作/}).click();const taskB=await (await acceptedB).json();expect(taskA.id).not.toBe(taskB.id);
 await expect(page.locator('.task-card')).toHaveCount(2);block=true;
 await expect(page.getByText(/查询中断：/).first()).toBeVisible({timeout:10000});
 expect(await page.locator('.task-card.failed').count()).toBe(0);block=false;
 await page.getByRole('button',{name:'恢复查询',exact:true}).first().click();
 await page.reload();await expect(page.locator('.task-card')).toHaveCount(2,{timeout:15000});
 await expect(page.locator('.task-card.succeeded')).toHaveCount(1,{timeout:30000});await expect(page.locator('.task-card.failed')).toHaveCount(1,{timeout:30000});
 await expect(page.locator('.task-card.failed')).toContainText('模拟生成');
 const atEnd=polls;await page.waitForTimeout(3000);expect(polls).toBe(atEnd);
 await page.screenshot({path:path.join(evidence,'desktop-workspace.png'),fullPage:true});passed.push('two real tasks, query failure preserved business state, GET recovery, refresh restoration, mixed outcomes, terminal polling stops');
 const preview=page.getByRole('button',{name:'预览山野来信',exact:true});await preview.click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(preview).toBeFocused();passed.push('result preview, Escape close and focus restoration');
 await page.getByRole('link',{name:'我的作品',exact:true}).click();await expect(page.locator('.task-card')).toHaveCount(2);await page.screenshot({path:path.join(evidence,'desktop-history.png'),fullPage:true});
 const other=await browser.newContext();const b=await other.newPage();await b.goto(base+'/history');await expect(b.locator('.empty')).toContainText('还没有',{timeout:15000});await expect(b.locator('.task-card')).toHaveCount(0);await other.close();passed.push('history route and isolated browser identity');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true});const m=await mobile.newPage();await m.goto(base+'/templates/city');await expect(m.getByLabel('选择素材2')).toBeAttached({timeout:15000});
 for(const label of ['选择素材1','选择素材2'])await m.getByLabel(label).setInputFiles(image);
 await expect(m.getByRole('button',{name:/开始制作/})).toBeEnabled();expect(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await m.screenshot({path:path.join(evidence,'mobile-workspace.png'),fullPage:true});await mobile.close();passed.push('mobile two-slot real upload and no horizontal overflow');
 expect(faults).toEqual([]);await writeFile(path.join(evidence,'results.json'),JSON.stringify({date:'2026-11-03',base,passed,pageErrors:faults},null,2));console.log(JSON.stringify({passed,pageErrors:faults},null,2));
} catch(error) {console.error(await page.locator('main').innerText());await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true});throw error} finally {await browser.close()}



